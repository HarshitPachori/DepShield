import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDbInstance } from '@/backend/db';
import { scanJobs } from '@/backend/db/schema';
import { detectPlatform } from '@/backend/service/ecosystem.service';
import logger from '@backend/util/logger';
import { errorResponse, successResponse } from '@backend/util/response';
import { parseGithubUrl, parseGitlabUrl } from '@backend/helper';

const validateRepo = async (repoUrl: string, platform: string, token?: string) => {
	if (platform === 'github') {
		const { owner, repo } = parseGithubUrl(repoUrl);
		const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { 'User-Agent': 'DepShield/1.0' } });
		return res.ok;
	}
	if (platform === 'gitlab') {
		const { fullPath } = parseGitlabUrl(repoUrl);
		const res = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(fullPath)}`);
		return res.ok;
	}
	return false;
};

const scanSchema = z.object({
	repoUrl: z.url(),
	token: z.string().optional(),
});

export const scanRouter = new Hono<{ Bindings: CloudflareEnv }>();

scanRouter.post('/', zValidator('json', scanSchema), async (c) => {
	const { repoUrl, token } = c.req.valid('json');

	const platform = detectPlatform(repoUrl);
	if (!platform) {
		logger.error('Unsupported platform. Only GitHub and GitLab are supported.', undefined, { repoUrl });
		return c.json(errorResponse('Unsupported platform. Only GitHub and GitLab are supported.', 400), 400);
	}

	const exists = await validateRepo(repoUrl, platform, token);
	if (!exists) {
		return c.json(errorResponse('Repository not found. Check the URL and try again.', 404), 404);
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

	return c.json(successResponse({ jobId, status: 'pending', repoUrl, platform }, 'Scan job created'), 201);
});
