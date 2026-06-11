import { Hono } from 'hono';
import { findCoRiskyPackages, getGlobalRiskLeaderboard, searchScans } from '../service/elastic.service';
import { errorResponse, successResponse } from '../util/response';

export const elasticRouter = new Hono<{ Bindings: CloudflareEnv }>();

elasticRouter.get('/leaderboard', async (c) => {
	const data = await getGlobalRiskLeaderboard(c.env);
	return c.json(successResponse({ data }, 'Global risk leaderboard data fetched'), 200);
});

elasticRouter.get('/search', async (c) => {
	const query = c.req.query('q') ?? '';
	const ecosystem = c.req.query('ecosystem') ?? undefined;
	const minRisk = c.req.query('minRisk') ?? undefined;

	if (!query) return c.json(errorResponse('Query required', 400), 400);

	try {
		const data = await searchScans(query, { ecosystem, minRisk }, c.env);
		return c.json(successResponse({ data }, 'Search results fetched'), 200);
	} catch {
		return c.json(errorResponse('Search failed', 500), 500);
	}
});

elasticRouter.get('/co-risky', async (c) => {
	const packageName = c.req.query('package') ?? '';

	if (!packageName) return c.json(errorResponse('Package name required', 400), 400);

	try {
		const data = await findCoRiskyPackages(packageName, c.env);
		return c.json(successResponse({ data }, 'Co-risky packages fetched'), 200);
	} catch {
		return c.json(errorResponse('Failed to fetch co-risky packages', 500), 500);
	}
});
