import { getDbInstance } from '@/backend/db';
import { scanJobs, scanResults } from '@/backend/db/schema';
import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { generateRiskExplanation, suggestAlternative } from '@/backend/service/gemini.service';
import { scanAllPackages } from '@/backend/service/risk.service';
import type { Ecosystem, PackageRisk } from '@/types';
import { indexScanResults } from '@backend/service/elastic.service';
import logger from '@backend/util/logger';
import { eq } from 'drizzle-orm';

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
}

const updateKV = (env: CloudflareEnv, jobId: string, repoUrl: string, platform: string, data: Record<string, any>) =>
	env.KV.put(`job:${jobId}`, JSON.stringify({ jobId, repoUrl, platform, ...data }), { expirationTtl: 86400 });

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
		type: message.geminiOnly ? 'geminiOnly' : message.elasticOnly ? 'elasticOnly' : message.packages ? 'chunk' : 'initial',
		chunkIndex: message.chunkIndex,
		totalChunks: message.totalChunks,
	});

	if (message.geminiOnly) {
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
	const { jobId, repoUrl, platform, totalChunks, total } = message;
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

	if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
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

			const [explanation, alternative] = await Promise.all([
				generateRiskExplanation(pkg.name, pkg.ecosystem, pkg.signals, pkg.cves, env.GEMINI_API_KEY, env.GROQ_API_KEY).catch((err) => {
					logger.error('generateRiskExplanation failed', err, { package: pkg.name });
					return '';
				}),
				needsAlternative
					? suggestAlternative(pkg.name, pkg.ecosystem, pkg.signals.isDeprecated, env.GEMINI_API_KEY, env.GROQ_API_KEY).catch((err) => {
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

		// const scannedSoFar = Math.min((chunkIndex! + 1) * CHUNK_SIZE, total!);
		// const isLastChunk = chunkIndex === totalChunks! - 1;

		// await Promise.all([
		// 	updateKV(env, jobId!, repoUrl, platform, {
		// 		status: 'scanning',
		// 		progress: scannedSoFar,
		// 		total: total!,
		// 		ecosystem,
		// 		packageManager,
		// 		basePath,
		// 		allDetected,
		// 	}),
		// 	db.update(scanJobs).set({ progress: scannedSoFar }).where(eq(scanJobs.id, jobId!)),
		// ]);

		// logger.info('Chunk progress updated', { jobId, chunkIndex, scannedSoFar, total, isLastChunk });

		// if (isLastChunk) {
		// 	logger.info('Last chunk — polling for all chunk keys', { jobId, totalChunks });

		// 	let attempts = 0;
		// 	while (attempts < 15) {
		// 		const keys = await Promise.all(Array.from({ length: totalChunks! }, (_, i) => env.KV.get(`chunk:${jobId}:${i}`)));
		// 		const missingCount = keys.filter((k) => k === null).length;

		// 		if (missingCount === 0) {
		// 			logger.info('All chunk keys present', { jobId, attempts });
		// 			break;
		// 		}

		// 		logger.info('Waiting for chunks', { jobId, attempt: attempts, missingCount, totalChunks });
		// 		await new Promise((r) => setTimeout(r, 1000));
		// 		attempts++;
		// 	}

		// 	if (attempts === 15) {
		// 		logger.warn('Chunk polling timed out — some chunks may be missing', { jobId, totalChunks });
		// 	}

		// 	const allResults: PackageRisk[] = [];
		// 	for (let i = 0; i < totalChunks!; i++) {
		// 		const raw = await env.KV.get(`chunk:${jobId}:${i}`);
		// 		if (raw) {
		// 			const parsed = JSON.parse(raw) as PackageRisk[];
		// 			allResults.push(...parsed);
		// 			logger.info('Chunk merged', { jobId, chunkIndex: i, count: parsed.length });
		// 		} else {
		// 			logger.warn('Chunk key missing during merge', { jobId, chunkIndex: i });
		// 		}
		// 	}

		// 	logger.info('All chunks merged', { jobId, totalResults: allResults.length });

		// 	const sorted = allResults.sort((a, b) => b.riskScore - a.riskScore);
		// 	const summary = computeSummary(sorted);

		// 	logger.info('Final scan summary', { jobId, ...summary });

		// 	await Promise.all([
		// 		db
		// 			.insert(scanResults)
		// 			.values({
		// 				id: crypto.randomUUID(),
		// 				jobId: jobId!,
		// 				resultsJson: JSON.stringify(sorted),
		// 				...summary,
		// 			})
		// 			.catch(async (err) => {
		// 				logger.warn('scanResults insert failed, trying update', { jobId, error: err instanceof Error ? err.message : err });
		// 				await db
		// 					.update(scanResults)
		// 					.set({ ...summary, resultsJson: JSON.stringify(sorted) })
		// 					.where(eq(scanResults.jobId, jobId!));
		// 			}),
		// 		db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId!)),
		// 		updateKV(env, jobId!, repoUrl, platform, {
		// 			status: 'complete',
		// 			aiEnriching: true,
		// 			aiEnriched: false,
		// 			progress: total!,
		// 			total: total!,
		// 			ecosystem,
		// 			packageManager,
		// 			basePath,
		// 			allDetected,
		// 			summary,
		// 			results: sorted,
		// 		}),
		// 	]);

		// 	for (let i = 0; i < totalChunks!; i++) {
		// 		env.KV.delete(`chunk:${jobId}:${i}`).catch(() => {});
		// 	}

		// 	logger.info('Scan job complete', { jobId, totalPackages: sorted.length });

		// 	await env.SCAN_QUEUE.send({ jobId: jobId!, repoUrl, platform, geminiOnly: true }).catch((err) =>
		// 		logger.error('Failed to queue gemini enrichment', err, { jobId }),
		// 	);
		// }

		const scannedSoFar = Math.min((chunkIndex! + 1) * CHUNK_SIZE, total!);

		// read current progress from KV, never go backwards
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

		// atomic counter — whichever chunk finishes last triggers merge
		const countKey = `chunk-count:${jobId}`;
		const currentCount = parseInt((await env.KV.get(countKey)) ?? '0');
		const newCount = currentCount + 1;
		await env.KV.put(countKey, String(newCount), { expirationTtl: 3600 });

		logger.info('Chunk complete', { jobId, chunkIndex, newCount, totalChunks });

		if (newCount === totalChunks) {
			logger.info('All chunks done, queuing merge', { jobId });
			await env.SCAN_QUEUE.send({ jobId: jobId!, repoUrl, platform, mergeOnly: true, totalChunks, total });
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		logger.error('processChunk failed', err, { jobId, chunkIndex });
		updateKV(env, jobId!, repoUrl, platform, { status: 'error', error: `Chunk ${chunkIndex} failed: ${error}` }).catch(() => {});
		throw err;
	}
};
