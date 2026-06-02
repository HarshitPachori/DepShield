import { Hono } from 'hono';

export const statusRouter = new Hono<{ Bindings: CloudflareEnv }>();

statusRouter.get('/:jobId', async (c) => {
	const jobId = c.req.param('jobId');
	const data = await c.env.KV.get(`job:${jobId}`, 'json');

	if (!data) {
		return c.json({ error: 'Job not found or expired' }, 404);
	}

	return c.json(data);
});
