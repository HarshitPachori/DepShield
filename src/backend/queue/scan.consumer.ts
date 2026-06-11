import { getDbInstance } from '@/backend/db';
import { scanJobs, scanResults } from '@/backend/db/schema';
import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { generateRiskExplanation, suggestAlternative } from '@/backend/service/gemini.service';
import { scanAllPackages } from '@/backend/service/risk.service';
import type { Ecosystem, PackageRisk } from '@/types';
import {
	createIndices,
	getCommunityMigrationContext,
	indexPackageSignal,
	indexRepoScan,
	indexScanResults,
} from '@backend/service/elastic.service';
import logger from '@backend/util/logger';
import { eq } from 'drizzle-orm';
import { getGoogleAccessToken, parseGithubUrl, parseGitlabUrl } from '../helper';

const CHUNK_SIZE = 3;

export interface ScanMessage {
	jobId: string;
	repoUrl: string;
	platform: 'github' | 'gitlab';
	token?: string;
	packages?: Record<string, string>;
	ecosystem?: string;
	packageManager?: string;
	basePath?: string;
	allDetected?: any[];
	chunkIndex?: number;
	totalChunks?: number;
	total?: number;
	elasticOnly?: boolean;
	geminiOnly?: boolean;
	mergeOnly?: boolean;
	results?: PackageRisk[];
	agentOnly?: boolean;
	highRiskPackages?: PackageRisk[];
	agentMode?: 'analyse' | 'create_pr';
}

const updateKV = async (env: CloudflareEnv, jobId: string, repoUrl: string, platform: string, data: Record<string, any>) => {
	const existing = ((await env.KV.get(`job:${jobId}`, 'json')) as Record<string, any>) ?? {};
	return env.KV.put(`job:${jobId}`, JSON.stringify({ ...existing, jobId, repoUrl, platform, ...data }), { expirationTtl: 86400 });
};

const computeSummary = (results: PackageRisk[]) => {
	const summary = { totalPackages: results.length, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, safeCount: 0 };
	for (const r of results) {
		if (r.riskLevel === 'CRITICAL') summary.criticalCount++;
		else if (r.riskLevel === 'HIGH') summary.highCount++;
		else if (r.riskLevel === 'MEDIUM') summary.mediumCount++;
		else if (r.riskLevel === 'LOW') summary.lowCount++;
		else summary.safeCount++;
	}
	return summary;
};

export const processScanJob = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	logger.info('processScanJob received', {
		jobId: message.jobId,
		type: message.agentOnly
			? 'agentOnly'
			: message.geminiOnly
				? 'geminiOnly'
				: message.elasticOnly
					? 'elasticOnly'
					: message.packages
						? 'chunk'
						: 'initial',
		chunkIndex: message.chunkIndex,
		totalChunks: message.totalChunks,
	});

	if (message.agentOnly) {
		if (message.agentMode === 'create_pr') {
			await processAgentPRCreation(message, env);
		} else {
			await processAgentMigration(message, env);
		}
	} else if (message.geminiOnly) {
		await processGeminiEnrichment(message, env);
	} else if (message.elasticOnly) {
		try {
			const db = getDbInstance(env.DB);
			const row = await db.select().from(scanResults).where(eq(scanResults.jobId, message.jobId)).limit(1);
			const results: PackageRisk[] = row[0]?.resultsJson ? JSON.parse(row[0].resultsJson) : [];
			await indexScanResults(results, env);
			logger.info('Elastic indexing complete', { jobId: message.jobId });
		} catch (err) {
			logger.error('Elastic indexing failed', err, { jobId: message.jobId });
		}
	} else if (message.packages) {
		await processChunk(message, env);
	} else if (message.mergeOnly) {
		await processMerge(message, env);
	} else {
		await processInitial(message, env);
	}
};

export const processMerge = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, totalChunks, total, ecosystem } = message;
	const db = getDbInstance(env.DB);

	logger.info('processMerge started', { jobId, totalChunks });

	const allResults: PackageRisk[] = [];
	for (let i = 0; i < totalChunks!; i++) {
		const raw = await env.KV.get(`chunk:${jobId}:${i}`);
		if (raw) {
			allResults.push(...(JSON.parse(raw) as PackageRisk[]));
			logger.info('Chunk merged', { jobId, chunkIndex: i });
		} else {
			logger.warn('Chunk missing during merge', { jobId, chunkIndex: i });
		}
	}

	const sorted = allResults.sort((a, b) => b.riskScore - a.riskScore);

	await createIndices(env).catch((err) => logger.error('createIndices failed', err, { jobId }));
	await indexRepoScan(jobId!, repoUrl, ecosystem ?? 'unknown', sorted, env).catch((err) =>
		logger.error('Failed to index repo scan', err, { jobId }),
	);

	const summary = computeSummary(sorted);

	logger.info('Merge summary', { jobId, ...summary });

	await Promise.all([
		db
			.insert(scanResults)
			.values({ id: crypto.randomUUID(), jobId: jobId!, resultsJson: JSON.stringify(sorted), ...summary })
			.catch(() =>
				db
					.update(scanResults)
					.set({ ...summary, resultsJson: JSON.stringify(sorted) })
					.where(eq(scanResults.jobId, jobId!)),
			),
		db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId!)),
		updateKV(env, jobId!, repoUrl, platform, {
			status: 'complete',
			aiEnriching: true,
			aiEnriched: false,
			progress: total!,
			total: total!,
			summary,
			results: sorted,
		}),
	]);

	// cleanup
	for (let i = 0; i < totalChunks!; i++) env.KV.delete(`chunk:${jobId}:${i}`).catch(() => {});
	env.KV.delete(`chunk-count:${jobId}`).catch(() => {});

	logger.info('Merge complete, queuing gemini enrichment', { jobId });

	await env.SCAN_QUEUE.send({ jobId: jobId!, repoUrl, platform, geminiOnly: true }).catch((err) =>
		logger.error('Failed to queue gemini enrichment', err, { jobId }),
	);
};

const processGeminiEnrichment = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform } = message;
	if (!jobId) {
		logger.warn('processGeminiEnrichment called with no results', { jobId });
		return;
	}

	if (!env.GCP_SERVICE_ACCOUNT && !env.GROQ_API_KEY) {
		logger.warn('No AI keys configured, skipping enrichment', { jobId });
		const current = ((await env.KV.get(`job:${jobId}`, 'json')) as Record<string, any>) ?? {};
		await updateKV(env, jobId, repoUrl, platform, { ...current, aiEnriching: false, aiEnriched: true });
		return;
	}

	const db = getDbInstance(env.DB);

	const row = await db.select().from(scanResults).where(eq(scanResults.jobId, jobId)).limit(1);
	const results: PackageRisk[] = row[0]?.resultsJson ? JSON.parse(row[0].resultsJson) : [];

	logger.info('Starting Gemini enrichment', { jobId, total: results.length, hasGemini: !!env.GEMINI_API_KEY, hasGroq: !!env.GROQ_API_KEY });

	const enriched = [...results];
	const highRisk = enriched.filter((r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM').slice(0, 10);

	logger.info('Packages to enrich', { jobId, count: highRisk.length });

	for (const pkg of highRisk) {
		const idx = enriched.findIndex((r) => r.name === pkg.name);
		if (idx === -1) continue;

		try {
			const needsAlternative = pkg.signals.isDeprecated || pkg.signals.lastCommitDaysAgo > 365;

			const communityContext = await getCommunityMigrationContext(pkg.name, env).catch(() => ({
				topAlternative: null,
				migrationCount: 0,
				confidence: 0,
			}));

			const [explanation, alternative] = await Promise.all([
				generateRiskExplanation(
					pkg.name,
					pkg.ecosystem,
					pkg.signals,
					pkg.cves,
					env.GCP_SERVICE_ACCOUNT,
					env.GROQ_API_KEY,
					env.GOOGLE_CLOUD_PROJECT_ID,
				).catch((err) => {
					logger.error('generateRiskExplanation failed', err, { package: pkg.name });
					return '';
				}),
				needsAlternative
					? suggestAlternative(
							pkg.name,
							pkg.ecosystem,
							pkg.signals.isDeprecated,
							env.GCP_SERVICE_ACCOUNT,
							env.GROQ_API_KEY,
							env.GOOGLE_CLOUD_PROJECT_ID,
							communityContext,
						).catch((err) => {
							logger.error('suggestAlternative failed', err, { package: pkg.name });
							return null;
						})
					: Promise.resolve(null),
			]);

			if (explanation) enriched[idx].explanation = explanation;
			if (alternative) {
				enriched[idx].alternative = alternative.name;
				enriched[idx].alternativeReason = alternative.reason;
			}

			logger.info('AI enriched', { package: pkg.name, hasExplanation: !!explanation, hasAlternative: !!alternative });
		} catch (err) {
			logger.error('AI enrichment failed', err, { package: pkg.name });
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	const summary = computeSummary(enriched);
	logger.info('Enrichment summary', { jobId, ...summary });

	await Promise.all([
		db
			.update(scanResults)
			.set({ ...summary, resultsJson: JSON.stringify(enriched) })
			.where(eq(scanResults.jobId, jobId)),
		updateKV(env, jobId, repoUrl, platform, {
			status: 'complete',
			aiEnriching: false,
			aiEnriched: true,
			progress: enriched.length,
			total: enriched.length,
			summary,
			results: enriched,
		}),
	]);

	logger.info('Gemini enrichment complete', { jobId, enriched: highRisk.length });

	await env.SCAN_QUEUE.send({ jobId, repoUrl, platform, elasticOnly: true }).catch((err) =>
		logger.error('Failed to queue elastic indexing', err, { jobId }),
	);

	const highRiskForAgent = enriched
		.filter((r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM')
		.slice(0, 5);
	if (highRiskForAgent.length > 0) {
		await env.SCAN_QUEUE.send({
			jobId,
			repoUrl,
			platform,
			agentOnly: true,
			agentMode: 'analyse',
			highRiskPackages: highRiskForAgent,
		}).catch((err) => logger.error('Failed to queue agent analysis', err, { jobId }));
	}
};

const processInitial = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform } = message;
	const db = getDbInstance(env.DB);
	const platformToken = platform === 'github' ? env.GITHUB_TOKEN : env.GITLAB_TOKEN;
	logger.info('processInitial started', { jobId, repoUrl, platform, hasToken: !!platformToken });

	if (!platformToken) {
		logger.warn('No platform token in processInitial', { platform, jobId });
	}

	try {
		await Promise.all([
			updateKV(env, jobId, repoUrl, platform, { status: 'scanning', progress: 0, total: 0 }),
			db.update(scanJobs).set({ status: 'scanning' }).where(eq(scanJobs.id, jobId)),
		]);

		const ecosystem = await detectEcosystem(repoUrl, platform, platformToken);
		logger.info('Ecosystem detection result', {
			jobId,
			ecosystem: ecosystem.ecosystem,
			packageManager: ecosystem.packageManager,
			basePath: ecosystem.basePath,
		});

		if (!ecosystem.ecosystem) {
			logger.warn('Could not detect ecosystem', { jobId, repoUrl });
			await Promise.all([
				updateKV(env, jobId, repoUrl, platform, { status: 'error', error: 'Could not detect ecosystem' }),
				db.update(scanJobs).set({ status: 'error', error: 'Could not detect ecosystem' }).where(eq(scanJobs.id, jobId)),
			]);
			return;
		}

		await Promise.all([
			updateKV(env, jobId, repoUrl, platform, {
				status: 'scanning',
				ecosystem: ecosystem.ecosystem,
				packageManager: ecosystem.packageManager,
				basePath: ecosystem.basePath,
				dependencyFile: ecosystem.dependencyFile,
				allDetected: ecosystem.allDetected,
			}),
			db
				.update(scanJobs)
				.set({ ecosystem: ecosystem.ecosystem, packageManager: ecosystem.packageManager ?? undefined })
				.where(eq(scanJobs.id, jobId)),
		]);

		const deps = await parseDependencies(repoUrl, platform, platformToken, ecosystem);
		const filtered = Object.entries(deps).filter(([name]) => !name.startsWith('@types/'));
		const total = filtered.length;

		logger.info('Dependencies found', { jobId, total, ecosystem: ecosystem.ecosystem });

		await Promise.all([
			updateKV(env, jobId, repoUrl, platform, { status: 'scanning', progress: 0, total }),
			db.update(scanJobs).set({ totalPackages: total }).where(eq(scanJobs.id, jobId)),
		]);

		if (total === 0) {
			logger.warn('No packages found after filtering', { jobId, repoUrl });
			await Promise.all([
				updateKV(env, jobId, repoUrl, platform, {
					status: 'complete',
					progress: 0,
					total: 0,
					results: [],
					summary: { totalPackages: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, safeCount: 0 },
				}),
				db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId)),
			]);
			return;
		}

		const chunks: Array<Record<string, string>> = [];
		for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
			chunks.push(Object.fromEntries(filtered.slice(i, i + CHUNK_SIZE)));
		}

		logger.info('Splitting into chunks', { jobId, total, chunkCount: chunks.length, chunkSize: CHUNK_SIZE });

		await Promise.all(
			chunks.map((chunk, i) =>
				env.SCAN_QUEUE.send({
					jobId,
					repoUrl,
					platform,
					token: platformToken,
					packages: chunk,
					ecosystem: ecosystem.ecosystem,
					packageManager: ecosystem.packageManager,
					basePath: ecosystem.basePath,
					allDetected: ecosystem.allDetected,
					chunkIndex: i,
					totalChunks: chunks.length,
					total,
				})
					.then(() => {
						logger.info('Chunk queued', { jobId, chunkIndex: i, packageCount: Object.keys(chunk).length });
					})
					.catch((err) => {
						logger.error('Failed to queue chunk', err, { jobId, chunkIndex: i });
						throw err;
					}),
			),
		);

		logger.info('All chunks queued', { jobId, chunkCount: chunks.length });
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		logger.error('processInitial failed', err, { jobId });
		await Promise.all([
			updateKV(env, jobId, repoUrl, platform, { status: 'error', error }),
			db.update(scanJobs).set({ status: 'error', error }).where(eq(scanJobs.id, jobId)),
		]);
	}
};

const processChunk = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, packages, ecosystem, packageManager, basePath, allDetected, chunkIndex, totalChunks, total } = message;

	const db = getDbInstance(env.DB);
	const githubToken = env.GITHUB_TOKEN;

	logger.info('processChunk started', {
		jobId,
		chunkIndex,
		totalChunks,
		packageCount: Object.keys(packages ?? {}).length,
		hasGithubToken: !!githubToken,
	});

	try {
		const chunkResults = await scanAllPackages(packages!, (ecosystem as Ecosystem) ?? 'nodejs', env, githubToken);
		logger.info('Chunk scan complete', { jobId, chunkIndex, scanned: chunkResults.length });

		await env.KV.put(`chunk:${jobId}:${chunkIndex}`, JSON.stringify(chunkResults), { expirationTtl: 3600 });
		logger.info('Chunk results stored in KV', { jobId, chunkIndex });

		const scannedSoFar = chunkIndex! * CHUNK_SIZE + chunkResults.length;
		const currentKV = (await env.KV.get(`job:${jobId}`, 'json')) as any;
		const safeProgress = Math.max(currentKV?.progress ?? 0, scannedSoFar);

		await Promise.all([
			updateKV(env, jobId!, repoUrl, platform, {
				status: 'scanning',
				progress: safeProgress,
				total: total!,
				ecosystem,
				packageManager,
				basePath,
				allDetected,
			}),
			db.update(scanJobs).set({ progress: safeProgress }).where(eq(scanJobs.id, jobId!)),
		]);

		logger.info('Chunk progress updated', { jobId, chunkIndex, safeProgress, total });

		const chunkKeys = await Promise.all(Array.from({ length: totalChunks! }, (_, i) => env.KV.get(`chunk:${jobId}:${i}`)));
		const completedCount = chunkKeys.filter(Boolean).length;

		logger.info('Chunks completed so far', { jobId, completedCount, totalChunks });

		if (completedCount === totalChunks) {
			logger.info('All chunks present, queuing merge', { jobId });
			await env.SCAN_QUEUE.send({ jobId: jobId!, repoUrl, platform, mergeOnly: true, totalChunks, total, ecosystem });
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		logger.error('processChunk failed', err, { jobId, chunkIndex });
		await updateKV(env, jobId!, repoUrl, platform, { status: 'error', error: `Chunk ${chunkIndex} failed: ${error}` }).catch(() => {});
		throw err;
	}
};

const processAgentMigration = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, highRiskPackages } = message;

	if (!highRiskPackages?.length) {
		logger.warn('No high risk packages for agent analysis', { jobId });
		return;
	}

	if (!env.GCP_SERVICE_ACCOUNT || !env.GOOGLE_CLOUD_PROJECT_ID || !env.GOOGLE_CLOUD_ENGINE_ID) {
		logger.warn('Agent not configured', { jobId });
		return;
	}

	try {
		logger.info('Starting agent analysis', { jobId, packageCount: highRiskPackages.length });

		const projectId = env.GOOGLE_CLOUD_PROJECT_ID;
		const engineId = env.GOOGLE_CLOUD_ENGINE_ID;
		const base = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/reasoningEngines/${engineId}`;
		const accessToken = await getGoogleAccessToken(env.GCP_SERVICE_ACCOUNT);

		const sessionRes = await fetch(`${base}/sessions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: jobId }),
		});
		if (!sessionRes.ok) throw new Error(`Session failed: ${sessionRes.status}`);
		const sessionData: any = await sessionRes.json();
		const sessionId = sessionData.response?.name?.split('/').pop() ?? sessionData.name?.split('/').pop();
		if (!sessionId) throw new Error('Failed to extract session ID');

		logger.info('Agent session created', { jobId, sessionId });

		const packageList = highRiskPackages
			.map(
				(p) =>
					`- ${p.name}: risk=${p.riskLevel}, score=${p.riskScore}, ecosystem=${p.ecosystem}, deprecated=${p.signals.isDeprecated}, lastCommit=${p.signals.lastCommitDaysAgo}d ago, alternative=${p.alternative ?? 'unknown'}`,
			)
			.join('\n');

		const queryRes = await fetch(`${base}:streamQuery`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				input: {
					message: `ANALYSIS PHASE ONLY - do NOT create any PRs or MRs.

Repository ecosystem: ${highRiskPackages[0]?.ecosystem ?? 'unknown'}
Platform: ${platform}

For each package:
1. Use query_elastic with query_type="health"
2. Use query_elastic with query_type="alternatives"
3. Use search_scan_history to find community patterns
4. Use get_risk_leaderboard for community intelligence
5. Use Google Search if Elastic has no data


Analyze these risky packages:
${packageList}

Repository: ${repoUrl} (${platform})

For each package:
1. Use query_elastic with query_type="health" to get health score
2. Use query_elastic with query_type="alternatives" to find migration targets
3. Decide: needs_pr=true/false, best alternative, confidence, complexity

Respond ONLY with valid JSON, no other text:
{
  "analyses": [
    {
      "package": "package-name",
      "needs_pr": true,
      "recommended_alternative": "alternative-name",
      "confidence": 85,
      "reason": "one sentence why migration is needed",
      "complexity": "low",
      "breaking_changes": "what might break"
    }
  ]
}`,
					session_id: sessionId,
					user_id: jobId,
				},
			}),
		});

		if (!queryRes.ok) throw new Error(`Agent query failed: ${queryRes.status}`);

		const raw = await queryRes.text();
		logger.info('Agent analysis raw response', { jobId, raw: raw.substring(0, 2000) });

		let analyses: any[] = [];
		try {
			const lines = raw.split('\n').filter(Boolean);
			for (const line of lines) {
				try {
					const parsed = JSON.parse(line);
					const textParts = parsed?.content?.parts?.filter((p: any) => p.text) ?? [];
					for (const part of textParts) {
						const jsonMatch = part.text.match(/\{[\s\S]*"analyses"[\s\S]*\}/);
						if (jsonMatch) {
							analyses = JSON.parse(jsonMatch[0]).analyses ?? [];
							break;
						}
					}
					if (analyses.length) break;
				} catch {
					continue;
				}
			}
		} catch {
			logger.warn('Agent analysis JSON parse failed', { jobId });
		}

		const db = getDbInstance(env.DB);
		const row = await db.select().from(scanResults).where(eq(scanResults.jobId, jobId)).limit(1);
		const currentResults: PackageRisk[] = row[0]?.resultsJson ? JSON.parse(row[0].resultsJson) : [];

		const updatedResults = currentResults.map((pkg) => {
			const analysis = analyses.find((a: any) => a.package === pkg.name);
			if (!analysis) return pkg;
			return {
				...pkg,
				agentAnalysis: {
					needsPR: analysis.needs_pr,
					recommendedAlternative: analysis.recommended_alternative ?? pkg.alternative,
					confidence: analysis.confidence,
					reason: analysis.reason,
					complexity: analysis.complexity,
					breakingChanges: analysis.breaking_changes,
					migration_guide_url: analysis.migration_guide_url ?? null,
					ecosystem: analysis.ecosystem ?? pkg.ecosystem,
				},
			};
		});

		const existingKV = ((await env.KV.get(`job:${jobId}`, 'json')) as Record<string, any>) ?? {};

		await Promise.all([
			db
				.update(scanResults)
				.set({ resultsJson: JSON.stringify(updatedResults) })
				.where(eq(scanResults.jobId, jobId)),
			updateKV(env, jobId, repoUrl, platform, {
				...existingKV,
				agentComplete: true,
				agentAnalysisDone: true,
				results: updatedResults,
			}),
		]);

		logger.info('Agent analysis complete', { jobId, analysed: analyses.length });
	} catch (err: any) {
		logger.error('Agent analysis failed', err, { jobId });
		const existingKV = ((await env.KV.get(`job:${jobId}`, 'json')) as Record<string, any>) ?? {};
		await updateKV(env, jobId, repoUrl, platform, {
			...existingKV,
			agentComplete: false,
			agentError: err.message || 'Agent analysis failed',
		});
	}
};

const processAgentPRCreation = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, highRiskPackages } = message;
	const pkg = highRiskPackages![0];

	if (!env.GCP_SERVICE_ACCOUNT || !env.GOOGLE_CLOUD_PROJECT_ID || !env.GOOGLE_CLOUD_ENGINE_ID) {
		logger.warn('Agent not configured for PR creation', { jobId });
		return;
	}

	try {
		logger.info('Starting agent PR creation', { jobId, package: pkg.name });

		const projectId = env.GOOGLE_CLOUD_PROJECT_ID;
		const engineId = env.GOOGLE_CLOUD_ENGINE_ID;
		const base = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/reasoningEngines/${engineId}`;
		const accessToken = await getGoogleAccessToken(env.GCP_SERVICE_ACCOUNT);

		const sessionRes = await fetch(`${base}/sessions`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId: `${jobId}-pr` }),
		});
		if (!sessionRes.ok) throw new Error(`Session failed: ${sessionRes.status}`);
		const sessionData: any = await sessionRes.json();
		const sessionId = sessionData.response?.name?.split('/').pop() ?? sessionData.name?.split('/').pop();
		if (!sessionId) throw new Error('Failed to extract session ID');

		const toPackage = pkg.agentAnalysis?.recommendedAlternative ?? pkg.alternative ?? '';
		const platformTool = platform === 'github' ? 'create_github_pr' : 'create_gitlab_mr';

		let ownerRepoPart = '';
		if (platform === 'github') {
			const { owner, repo } = parseGithubUrl(repoUrl);
			ownerRepoPart = `- owner: ${owner}\n- repo: ${repo}`;
		} else {
			const { fullPath } = parseGitlabUrl(repoUrl);
			ownerRepoPart = `- repo: ${fullPath}`;
		}

		const queryRes = await fetch(`${base}:streamQuery`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				input: {
					message: `CREATE PR PHASE.

Package migration: ${pkg.name} to ${toPackage}
Ecosystem: ${pkg.ecosystem}
Repository: ${repoUrl} (${platform})
Job ID: ${jobId}
Risk: ${pkg.riskLevel} (score: ${pkg.riskScore})
Breaking changes: ${pkg.agentAnalysis?.breakingChanges ?? 'unknown'}
Migration guide: ${pkg.agentAnalysis?.migration_guide_url ?? 'none'}

Use ${platformTool} tool with these exact parameters:
- from_pkg: ${pkg.name}
- to_pkg: ${toPackage}
- job_id: ${jobId}
${ownerRepoPart}

The tool will:
1. Detect the correct manifest file for ${pkg.ecosystem} ecosystem
2. Resolve the best compatible version for ${toPackage} based on existing dependencies
3. Scan all source files and apply AI-powered code transformation
4. Commit all changes and create the PR/MR

Report the PR/MR URL when done.`,
					session_id: sessionId,
					user_id: `${jobId}-pr`,
				},
			}),
		});

		if (!queryRes.ok) throw new Error(`Agent PR query failed: ${queryRes.status}`);

		const raw = await queryRes.text();
		logger.info('Agent PR creation response', { jobId, raw: raw.substring(0, 2000) });

		const prUrlMatch = raw.match(/https:\/\/github\.com\/[^\s"']+\/pull\/\d+/);
		const mrUrlMatch = raw.match(/https:\/\/gitlab\.com\/[^\s"']+\/-\/merge_requests\/\d+/);
		const prUrl = prUrlMatch?.[0] ?? mrUrlMatch?.[0];

		if (prUrl) {
			await indexPackageSignal(
				{
					package_name: pkg.name,
					ecosystem: pkg.ecosystem,
					signal_type: 'migration',
					signal_text: `Successfully migrated from ${pkg.name} to ${toPackage} via automated PR`,
					source: 'depshield-agent',
					date: new Date().toISOString(),
					sentiment_score: 0.9,
					alternatives: [toPackage],
				},
				env,
			).catch(() => {});
		}

		const db = getDbInstance(env.DB);
		const row = await db.select().from(scanResults).where(eq(scanResults.jobId, jobId)).limit(1);
		const currentResults: PackageRisk[] = row[0]?.resultsJson ? JSON.parse(row[0].resultsJson) : [];

		const updatedResults = currentResults.map((r) =>
			r.name === pkg.name
				? {
						...r,
						agentPR: prUrl
							? {
									url: prUrl,
									number: parseInt(prUrl.split('/').pop() ?? '0'),
									title: `Migrate ${pkg.name} → ${toPackage}`,
									ci_status: 'pending' as const,
								}
							: undefined,
					}
				: r,
		);

		const existingKV = ((await env.KV.get(`job:${jobId}`, 'json')) as Record<string, any>) ?? {};
		await Promise.all([
			db
				.update(scanResults)
				.set({ resultsJson: JSON.stringify(updatedResults) })
				.where(eq(scanResults.jobId, jobId)),
			updateKV(env, jobId, repoUrl, platform, {
				...existingKV,
				results: updatedResults,
				prPending: (existingKV.prPending ?? []).filter((n: string) => n !== pkg.name),
				agentPRCreated: true,
			}),
		]);

		logger.info('Agent PR creation complete', { jobId, package: pkg.name, prUrl });
	} catch (err: any) {
		logger.error('Agent PR creation failed', err, { jobId, package: pkg.name });
	}
};
