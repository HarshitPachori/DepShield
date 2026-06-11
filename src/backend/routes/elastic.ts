import { Hono } from 'hono';
import { getGlobalRiskLeaderboard } from '../service/elastic.service';
import { successResponse } from '../util/response';

export const elasticRouter = new Hono<{ Bindings: CloudflareEnv }>();

elasticRouter.get('/leaderboard', async (c) => {
	const data = await getGlobalRiskLeaderboard(c.env);
	return c.json(successResponse({ data }, 'Global risk leaderboard data fetched'), 200);
});
