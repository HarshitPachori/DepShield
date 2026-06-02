import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { scanAllPackages } from '@/backend/service/risk.service';
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
	results?: PackageRisk[];
}

const updateKV = async (env: CloudflareEnv, jobId: string, repoUrl: string, platform: string, data: Record<string, any>) => {
	await env.KV.put(`job:${jobId}`, JSON.stringify({ jobId, repoUrl, platform, ...data }), { expirationTtl: 86400 });
};

export const processScanJob = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	if (message.elasticOnly) {
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

const processInitial = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, token } = message;
	const db = getDbInstance(env.DB);

	try {
		logger.info('Scan job started', { jobId, repoUrl, platform });

		await updateKV(env, jobId, repoUrl, platform, { status: 'scanning', progress: 0, total: 0 });
		await db.update(scanJobs).set({ status: 'scanning' }).where(eq(scanJobs.id, jobId));

		// Ecosystem detect
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

		// Parse dependencies
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

		// Split into chunks
		const chunks: Array<Record<string, string>> = [];
		for (let i = 0; i < filtered.length; i += CHUNK_SIZE) {
			chunks.push(Object.fromEntries(filtered.slice(i, i + CHUNK_SIZE)));
		}

		logger.info('Splitting scan into chunks', { jobId, total, chunks: chunks.length });

		// Send each chunk as separate queue message
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

		// Scan this chunk
		const chunkResults = await scanAllPackages(packages!, (ecosystem as Ecosystem) ?? 'nodejs', token ?? env.GITHUB_TOKEN);

		// Fetch existing results from D1
		const existing = await db.query.scanResults.findFirst({
			where: eq(scanResults.jobId, jobId!),
		});

		const allResults: PackageRisk[] = [...(existing ? JSON.parse(existing.resultsJson ?? '[]') : []), ...chunkResults];

		// Upsert scan results
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

		// Update progress
		await updateKV(env, jobId!, repoUrl, platform, {
			status: isLastChunk ? 'complete' : 'scanning',
			progress: scannedSoFar,
			total: total!,
			ecosystem,
			packageManager,
			basePath,
			allDetected,
		});

		await db.update(scanJobs).set({ progress: scannedSoFar }).where(eq(scanJobs.id, jobId!));

		// Last chunk - finalize
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

			// Update scan_results with final summary
			await db
				.update(scanResults)
				.set({ ...summary, resultsJson: JSON.stringify(sorted) })
				.where(eq(scanResults.jobId, jobId!));

			await db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId!));

			await updateKV(env, jobId!, repoUrl, platform, {
				status: 'complete',
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
				await env.SCAN_QUEUE.send({ jobId, elasticOnly: true, results: sorted });
			} catch (err) {
				logger.error('Failed to queue elastic indexing', err, { jobId });
			}
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		logger.error('Chunk processing failed', err, { jobId, chunkIndex });
		throw err;
	}
};
