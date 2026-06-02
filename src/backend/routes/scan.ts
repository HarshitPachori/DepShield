import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDbInstance } from '@/backend/db';
import { scanJobs } from '@/backend/db/schema';
import { detectPlatform } from '@/backend/service/ecosystem.service';

const scanSchema = z.object({
	repoUrl: z.string().url(),
	token: z.string().optional(),
});

export const scanRouter = new Hono<{ Bindings: CloudflareEnv }>();

scanRouter.post('/', zValidator('json', scanSchema), async (c) => {
	const { repoUrl, token } = c.req.valid('json');

	const platform = detectPlatform(repoUrl);
	if (!platform) {
		return c.json({ error: 'Unsupported platform. Only GitHub and GitLab are supported.' }, 400);
	}

	const jobId = crypto.randomUUID();
	const db = getDbInstance(c.env.DB);

	await db.insert(scanJobs).values({
		id: jobId,
		repoUrl,
		platform,
		status: 'pending',
		progress: 0,
		totalPackages: 0,
	});

	await c.env.KV.put(`job:${jobId}`, JSON.stringify({ jobId, status: 'pending', progress: 0, total: 0, repoUrl, platform }), {
		expirationTtl: 86400,
	});

	await c.env.SCAN_QUEUE.send({ jobId, repoUrl, platform, token });

	return c.json({ jobId, status: 'pending', repoUrl, platform }, 201);
});
