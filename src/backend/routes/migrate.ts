import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDbInstance } from '@/backend/db';
import { scanResults } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import type { PackageRisk } from '@/types';
import { errorResponse, successResponse } from '@backend/util/response';
import logger from '@backend/util/logger';

export const migrateRouter = new Hono<{ Bindings: CloudflareEnv }>();

migrateRouter.post(
	'/:jobId',
	zValidator(
		'json',
		z.object({
			packageName: z.string(),
			repoUrl: z.string(),
			platform: z.enum(['github', 'gitlab']),
		}),
	),
	async (c) => {
		const { jobId } = c.req.param();
		const { packageName, repoUrl, platform } = c.req.valid('json');

		const db = getDbInstance(c.env.DB);
		const row = await db.select().from(scanResults).where(eq(scanResults.jobId, jobId)).limit(1);
		const results: PackageRisk[] = row[0]?.resultsJson ? JSON.parse(row[0].resultsJson) : [];
		const pkg = results.find((r) => r.name === packageName);

		if (!pkg) return c.json(errorResponse('Package not found', 404), 404);
		if (!pkg.agentAnalysis?.needsPR) return c.json(errorResponse('Agent analysis says no migration needed', 400), 400);
		if (pkg.agentPR) return c.json(errorResponse('PR already created', 400), 400);

		logger.info('PR creation requested', { jobId, packageName });

		await c.env.SCAN_QUEUE.send({
			jobId,
			repoUrl,
			platform,
			agentOnly: true,
			agentMode: 'create_pr',
			highRiskPackages: [pkg],
		});

		const current = ((await c.env.KV.get(`job:${jobId}`, 'json')) as Record<string, any>) ?? {};
		await c.env.KV.put(
			`job:${jobId}`,
			JSON.stringify({
				...current,
				prPending: [...(current.prPending ?? []), packageName],
			}),
			{ expirationTtl: 86400 },
		);

		return c.json(successResponse({ queued: true }, 'PR creation queued'), 202);
	},
);
