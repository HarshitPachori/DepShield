import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDbInstance } from '@/backend/db';
import { scanJobs } from '@/backend/db/schema';
import { detectPlatform } from '@/backend/service/ecosystem.service';
import logger from '@backend/util/logger';
import { errorResponse, successResponse } from '@backend/util/response';
import { parseGithubUrl, parseGitlabUrl } from '@backend/helper';
import { desc, eq } from 'drizzle-orm';
import { encryptToken } from '@backend/util/encryption';

const validateRepo = async (repoUrl: string, platform: string, token?: string): Promise<boolean> => {
	try {
		if (platform === 'github') {
			const { owner, repo } = parseGithubUrl(repoUrl);
			const headers: Record<string, string> = { 'User-Agent': 'DepShield/1.0' };
			if (token) headers['Authorization'] = `Bearer ${token}`;
			const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
			if (!res.ok) logger.warn('GitHub repo validation failed', { repoUrl, status: res.status, hasToken: !!token });
			return res.ok;
		}
		if (platform === 'gitlab') {
			const { fullPath } = parseGitlabUrl(repoUrl);
			const headers: Record<string, string> = { 'User-Agent': 'DepShield/1.0' };
			if (token) headers['PRIVATE-TOKEN'] = token;
			const res = await fetch(`https://gitlab.com/api/v4/projects/${encodeURIComponent(fullPath)}`, { headers });
			if (!res.ok) logger.warn('GitLab repo validation failed', { repoUrl, status: res.status, hasToken: !!token });
			return res.ok;
		}
		return false;
	} catch (err) {
		logger.error('validateRepo threw', err, { repoUrl, platform });
		return false;
	}
};

const scanSchema = z.object({
	repoUrl: z.url(),
	token: z.string().optional(),
});

export const scanRouter = new Hono<{ Bindings: CloudflareEnv }>();

scanRouter.post('/', zValidator('json', scanSchema), async (c) => {
	const { repoUrl, token } = c.req.valid('json');
	const githubToken = c.env.GITHUB_TOKEN;
	const gitlabToken = c.env.GITLAB_TOKEN;

	const platform = detectPlatform(repoUrl);
	if (!platform) {
		logger.error('Unsupported platform', undefined, { repoUrl });
		return c.json(errorResponse('Unsupported platform. Only GitHub and GitLab are supported.', 400), 400);
	}

	const platformToken = token || (platform === 'github' ? githubToken : gitlabToken);

	if (!platformToken) {
		logger.warn('No platform token configured', { platform });
	}

	const exists = await validateRepo(repoUrl, platform, platformToken);
	if (!exists) {
		logger.warn('Repo not found or inaccessible', { repoUrl, platform, hasToken: !!platformToken });
		return c.json(errorResponse('Repository not found. Check the URL and try again.', 404), 404);
	}

	const jobId = crypto.randomUUID();
	const db = getDbInstance(c.env.DB);
	const existingJob = await db.select().from(scanJobs).where(eq(scanJobs.repoUrl, repoUrl)).orderBy(desc(scanJobs.createdAt)).limit(1);

	const recent = existingJob[0];
	if (recent && (recent.status === 'pending' || recent.status === 'scanning')) {
		const kvData = await c.env.KV.get(`job:${recent.id}`);
		if (kvData) {
			return c.json(successResponse({ jobId: recent.id, status: recent.status, repoUrl, platform }, 'Scan already in progress'), 200);
		}
	}

	logger.info('Creating scan job', { jobId, repoUrl, platform });

	const kvPayload = JSON.stringify({ jobId, status: 'pending', progress: 0, total: 0, repoUrl, platform });

	const promises: Promise<any>[] = [
		db.insert(scanJobs).values({
			id: jobId,
			repoUrl,
			platform,
			status: 'pending',
			progress: 0,
			totalPackages: 0,
		}),
		c.env.KV.put(`job:${jobId}`, kvPayload, { expirationTtl: 86400 }),
	];

	if (token) {
		promises.push(
			encryptToken(token, c.env.ENCRYPTION_KEY).then((encrypted) =>
				c.env.KV.put(`job-token:${jobId}`, encrypted, { expirationTtl: 86400 }),
			),
		);
	}

	await Promise.all(promises);

	try {
		await c.env.SCAN_QUEUE.send({ jobId, repoUrl, platform, token: platformToken });
		logger.info('Scan job queued', { jobId, repoUrl, platform });
	} catch (err) {
		logger.error('Failed to queue scan job', err, { jobId });
		return c.json(errorResponse('Failed to start scan. Please try again.', 500), 500);
	}

	return c.json(successResponse({ jobId, status: 'pending', repoUrl, platform }, 'Scan job created'), 201);
});
