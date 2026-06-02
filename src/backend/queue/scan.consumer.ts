import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';
import { scanAllPackages } from '@/backend/service/risk.service';
import { getDbInstance } from '@/backend/db';
import { scanJobs, scanResults } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import type { Ecosystem } from '@/types';
import logger from '@backend/util/logger';
import { indexScanResults } from '@backend/service/elastic.service';

export interface ScanMessage {
	jobId: string;
	repoUrl: string;
	platform: 'github' | 'gitlab';
	token?: string;
}

export const processScanJob = async (message: ScanMessage, env: CloudflareEnv): Promise<void> => {
	const { jobId, repoUrl, platform, token } = message;
	const db = getDbInstance(env.DB);

	const updateKV = async (data: Record<string, any>) => {
		await env.KV.put(`job:${jobId}`, JSON.stringify({ jobId, repoUrl, platform, ...data }), { expirationTtl: 86400 });
	};

	try {
		logger.info('Scan job started', { jobId, repoUrl, platform });
		await updateKV({ status: 'scanning', progress: 0, total: 0 });
		await db.update(scanJobs).set({ status: 'scanning' }).where(eq(scanJobs.id, jobId));

		// Ecosystem detect
		const ecosystem = await detectEcosystem(repoUrl, platform, token);

		if (!ecosystem.ecosystem) {
			await updateKV({ status: 'error', error: 'Could not detect ecosystem' });
			await db.update(scanJobs).set({ status: 'error', error: 'Could not detect ecosystem' }).where(eq(scanJobs.id, jobId));
			return;
		}

		await updateKV({
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
		const total = Object.keys(deps).length;

		await updateKV({ status: 'scanning', progress: 0, total });
		await db.update(scanJobs).set({ totalPackages: total }).where(eq(scanJobs.id, jobId));

		// Scan packages
		const results = await scanAllPackages(deps, ecosystem.ecosystem as Ecosystem, token ?? env.GITHUB_TOKEN, async (scanned) => {
			await updateKV({ status: 'scanning', progress: scanned, total });
			await db.update(scanJobs).set({ progress: scanned }).where(eq(scanJobs.id, jobId));
		});

		// Store results
		const summary = {
			totalPackages: results.length,
			criticalCount: results.filter((r) => r.riskLevel === 'CRITICAL').length,
			highCount: results.filter((r) => r.riskLevel === 'HIGH').length,
			mediumCount: results.filter((r) => r.riskLevel === 'MEDIUM').length,
			lowCount: results.filter((r) => r.riskLevel === 'LOW').length,
			safeCount: results.filter((r) => r.riskLevel === 'SAFE').length,
		};

		await db.insert(scanResults).values({
			id: crypto.randomUUID(),
			jobId,
			...summary,
			resultsJson: JSON.stringify(results),
		});

		await db.update(scanJobs).set({ status: 'complete', completedAt: new Date().toISOString() }).where(eq(scanJobs.id, jobId));
		logger.info('Scan job complete', { jobId, totalPackages: results.length });
		await updateKV({ status: 'complete', progress: total, total, summary, results });
		try {
			await indexScanResults(results);
			logger.info('Results indexed to Elastic', { jobId, count: results.length });
		} catch (err) {
			logger.error('Elastic indexing failed - continuing without cache', err, { jobId });
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : 'Unknown error';
		await updateKV({ status: 'error', error });
		await db.update(scanJobs).set({ status: 'error', error }).where(eq(scanJobs.id, jobId));
	}
};
