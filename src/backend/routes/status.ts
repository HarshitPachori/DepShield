import { Hono } from 'hono';
import { getDbInstance } from '@/backend/db';
import { scanJobs } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import { errorResponse, successResponse } from '@backend/util/response';
import logger from '@backend/util/logger';

const SCAN_TIMEOUT_MS = 10 * 60 * 1000;

export const statusRouter = new Hono<{ Bindings: CloudflareEnv }>();

statusRouter.get('/:jobId', async (c) => {
	const jobId = c.req.param('jobId');
	const data = (await c.env.KV.get(`job:${jobId}`, 'json')) as Record<string, any> | null;

	if (!data) {
		return c.json(errorResponse('Job not found or expired', 404), 404);
	}

	if (data.status === 'scanning') {
		const db = getDbInstance(c.env.DB);
		const job = await db
			.select()
			.from(scanJobs)
			.where(eq(scanJobs.id, jobId))
			.limit(1)
			.catch(() => []);
		const updatedAt = job[0]?.updatedAt;

		if (updatedAt && Date.now() - new Date(updatedAt).getTime() > SCAN_TIMEOUT_MS) {
			logger.warn('Scan job timed out', { jobId, updatedAt });

			await Promise.all([
				db
					.update(scanJobs)
					.set({ status: 'error', error: 'Scan timed out' })
					.where(eq(scanJobs.id, jobId))
					.catch(() => {}),
				c.env.KV.put(`job:${jobId}`, JSON.stringify({ ...data, status: 'error', error: 'Scan timed out' }), { expirationTtl: 86400 }).catch(
					() => {},
				),
			]);

			return c.json(successResponse({ ...data, status: 'error', error: 'Scan timed out' }));
		}
	}

	return c.json(successResponse(data));
});
