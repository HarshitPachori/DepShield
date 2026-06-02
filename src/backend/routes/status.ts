import { Hono } from 'hono';
import { errorResponse, successResponse } from '../util/response';

export const statusRouter = new Hono<{ Bindings: CloudflareEnv }>();

statusRouter.get('/:jobId', async (c) => {
	const jobId = c.req.param('jobId');
	const data = await c.env.KV.get(`job:${jobId}`, 'json');

	if (!data) {
		return c.json(errorResponse('Job not found or expired', 404), 404);
	}

	return c.json(successResponse(data));
});
