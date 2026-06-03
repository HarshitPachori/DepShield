import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { scanAllPackages } from '@/backend/service/risk.service';
import { generateRiskExplanation, suggestAlternative } from '@/backend/service/gemini.service';
import { getDbInstance } from '@/backend/db';
import { scanJobs, scanResults } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import type { Ecosystem, PackageRisk } from '@/types';
import logger from '@backend/util/logger';
import { indexScanResults } from '@backend/service/elastic.service';

const CHUNK_SIZE = 12;

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
	results?: PackageRisk[];
}

const updateKV = async (env: CloudflareEnv, jobId: string, repoUrl: string, platform: string, data: Record<string, any>) => {
	await env.KV.put(`job:${jobId}`, JSON.stringify({ jobId, repoUrl, platform, ...data }), { expirationTtl: 86400 });
};

export const processScanJob = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	if (message.geminiOnly) {
		await processGeminiEnrichment(message, env);
	} else if (message.elasticOnly) {
		try {
			await indexScanResults(message.results ?? []);
			logger.info('Elastic indexing complete', { jobId: message.jobId });
		} catch (err) {
			logger.error('Elastic indexing failed', err, { jobId: message.jobId });
		}
	} else if (message.packages) {
		await processChunk(message, env);
	} else {
		await processInitial(message, env);
	}
};

const processGeminiEnrichment = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, results } = message;
	if (!results?.length || !jobId) return;

	const db = getDbInstance(env.DB);

	logger.info('Starting Gemini enrichment', { jobId, count: results.length });

	const enriched = [...results];
	const highRisk = enriched.filter((r) => r.riskLevel === 'CRITICAL' || r.riskLevel === 'HIGH' || r.riskLevel === 'MEDIUM');

	for (const pkg of highRisk) {
		const idx = enriched.findIndex((r) => r.name === pkg.name);
		if (idx === -1) continue;

		try {
			const explanation = await generateRiskExplanation(
				pkg.name,
				pkg.ecosystem,
				pkg.signals,
				pkg.cves,
				env.GEMINI_API_KEY,
				env.GROQ_API_KEY,
			).catch(() => '');

			await new Promise((resolve) => setTimeout(resolve, 2000));

			const alternative =
				pkg.signals.isDeprecated || pkg.signals.lastCommitDaysAgo > 365
					? await suggestAlternative(pkg.name, pkg.ecosystem, pkg.signals.isDeprecated, env.GEMINI_API_KEY, env.GROQ_API_KEY).catch(
							() => null,
						)
					: null;

			if (explanation) enriched[idx].explanation = explanation;
			if (alternative) {
				enriched[idx].alternative = alternative.name;
				enriched[idx].alternativeReason = alternative.reason;
			}

			logger.info('AI enriched', { package: pkg.name });
		} catch (err) {
			logger.error('AI enrichment failed', err, { package: pkg.name });
		}

		await new Promise((resolve) => setTimeout(resolve, 2000));
	}

	const summary = {
		totalPackages: enriched.length,
		criticalCount: enriched.filter((r) => r.riskLevel === 'CRITICAL').length,
		highCount: enriched.filter((r) => r.riskLevel === 'HIGH').length,
		mediumCount: enriched.filter((r) => r.riskLevel === 'MEDIUM').length,
		lowCount: enriched.filter((r) => r.riskLevel === 'LOW').length,
		safeCount: enriched.filter((r) => r.riskLevel === 'SAFE').length,
	};

	await db
		.update(scanResults)
		.set({ ...summary, resultsJson: JSON.stringify(enriched) })
		.where(eq(scanResults.jobId, jobId));

	await updateKV(env, jobId, repoUrl, platform, {
		status: 'complete',
		aiEnriching: false,
		aiEnriched: true,
		progress: enriched.length,
		total: enriched.length,
		summary,
		results: enriched,
	});

	logger.info('Gemini enrichment complete', { jobId, enriched: highRisk.length });

	try {
		await env.SCAN_QUEUE.send({ jobId, repoUrl, platform, elasticOnly: true, results: enriched });
	} catch (err) {
		logger.error('Failed to queue elastic indexing', err, { jobId });
	}
};

const processInitial = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, token } = message;
	const db = getDbInstance(env.DB);

	try {
		logger.info('Scan job started', { jobId, repoUrl, platform });

		await updateKV(env, jobId, repoUrl, platform, { status: 'scanning', progress: 0, total: 0 });
		await db.update(scanJobs).set({ status: 'scanning' }).where(eq(scanJobs.id, jobId));

		const ecosystem = await detectEcosystem(repoUrl, platform, token);

		if (!ecosystem.ecosystem) {
			await updateKV(env, jobId, repoUrl, platform, { status: 'error', error: 'Could not detect ecosystem' });
			await db.update(scanJobs).set({ status: 'error', error: 'Could not detect ecosystem' }).where(eq(scanJobs.id, jobId));
			return;
		}

		await updateKV(env, jobId, repoUrl, platform, {
			status: 'scanning',
			ecosystem: ecosystem.ecosystem,
			packageManager: ecosystem.packageManager,
			basePath: ecosystem.basePath,
			allDetected: ecosystem.allDetected,
		});

		await db
			.update(scanJobs)
			.set({ ecosystem: ecosystem.ecosystem, packageManager: ecosystem.packageManager ?? undefined })
			.where(eq(scanJobs.id, jobId));

		const deps = await parseDependencies(repoUrl, platform, token);
		const filtered = Object.entries(deps).filter(([name]) => !name.startsWith('@types/'));
		const total = filtered.length;

		await updateKV(env, jobId, repoUrl, platform, { status: 'scanning', progress: 0, total });
		await db.update(scanJobs).set({ totalPackages: total }).where(eq(scanJobs.id, jobId));

		if (total === 0) {
			await updateKV(env, jobId, repoUrl, platform, {
				status: 'complete',
				progress: 0,
				total: 0,
				results: [],
				summary: { totalPackages: 0, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, safeCount: 0 },
			});
			await db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId));
			return;
		}

		const chunks: Array<Record<string, string>> = [];
		for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
			chunks.push(Object.fromEntries(filtered.slice(i, i + CHUNK_SIZE)));
		}

		logger.info('Splitting scan into chunks', { jobId, total, chunks: chunks.length });

		for (let i = 0; i < chunks.length; i++) {
			await env.SCAN_QUEUE.send({
				jobId,
				repoUrl,
				platform,
				token,
				packages: chunks[i],
				ecosystem: ecosystem.ecosystem,
				packageManager: ecosystem.packageManager,
				basePath: ecosystem.basePath,
				allDetected: ecosystem.allDetected,
				chunkIndex: i,
				totalChunks: chunks.length,
				total,
			});
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		logger.error('Scan initial failed', err, { jobId });
		await updateKV(env, jobId, repoUrl, platform, { status: 'error', error });
		await db.update(scanJobs).set({ status: 'error', error }).where(eq(scanJobs.id, jobId));
	}
};

const processChunk = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, token, packages, ecosystem, packageManager, basePath, allDetected, chunkIndex, totalChunks, total } =
		message;

	const db = getDbInstance(env.DB);

	try {
		logger.info('Processing chunk', { jobId, chunkIndex, totalChunks });

		const chunkResults = await scanAllPackages(
			packages!,
			(ecosystem as Ecosystem) ?? 'nodejs',
			token ?? env.GITHUB_TOKEN,
			undefined,
			undefined,
			undefined,
		);

		const existing = await db.query.scanResults.findFirst({
			where: eq(scanResults.jobId, jobId!),
		});

		const allResults: PackageRisk[] = [...(existing ? JSON.parse(existing.resultsJson ?? '[]') : []), ...chunkResults];

		if (existing) {
			await db
				.update(scanResults)
				.set({ resultsJson: JSON.stringify(allResults) })
				.where(eq(scanResults.jobId, jobId!));
		} else {
			await db.insert(scanResults).values({
				id: crypto.randomUUID(),
				jobId: jobId!,
				resultsJson: JSON.stringify(allResults),
				totalPackages: 0,
				criticalCount: 0,
				highCount: 0,
				mediumCount: 0,
				lowCount: 0,
				safeCount: 0,
			});
		}

		const scannedSoFar = Math.min((chunkIndex! + 1) * CHUNK_SIZE, total!);
		const isLastChunk = chunkIndex === totalChunks! - 1;

		await updateKV(env, jobId!, repoUrl, platform, {
			status: 'scanning',
			progress: scannedSoFar,
			total: total!,
			ecosystem,
			packageManager,
			basePath,
			allDetected,
		});

		await db.update(scanJobs).set({ progress: scannedSoFar }).where(eq(scanJobs.id, jobId!));

		if (isLastChunk) {
			const sorted = allResults.sort((a, b) => b.riskScore - a.riskScore);

			const summary = {
				totalPackages: sorted.length,
				criticalCount: sorted.filter((r) => r.riskLevel === 'CRITICAL').length,
				highCount: sorted.filter((r) => r.riskLevel === 'HIGH').length,
				mediumCount: sorted.filter((r) => r.riskLevel === 'MEDIUM').length,
				lowCount: sorted.filter((r) => r.riskLevel === 'LOW').length,
				safeCount: sorted.filter((r) => r.riskLevel === 'SAFE').length,
			};

			await db
				.update(scanResults)
				.set({ ...summary, resultsJson: JSON.stringify(sorted) })
				.where(eq(scanResults.jobId, jobId!));

			await db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId!));

			await updateKV(env, jobId!, repoUrl, platform, {
				status: 'complete',
				aiEnriching: true,
				aiEnriched: false,
				progress: total!,
				total: total!,
				ecosystem,
				packageManager,
				basePath,
				allDetected,
				summary,
				results: sorted,
			});

			logger.info('Scan job complete', { jobId, totalPackages: sorted.length });

			try {
				await env.SCAN_QUEUE.send({
					jobId: jobId!,
					repoUrl,
					platform,
					geminiOnly: true,
					results: sorted,
				});
			} catch (err) {
				logger.error('Failed to queue gemini enrichment', err, { jobId });
			}
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		logger.error('Chunk processing failed', err, { jobId, chunkIndex });
		throw err;
	}
};
