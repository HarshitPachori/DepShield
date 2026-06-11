import { migrateRouter } from '@backend/routes/migrate';
import { scanRouter } from '@backend/routes/scan';
import { simulateRouter } from '@backend/routes/simulate';
import { statusRouter } from '@backend/routes/status';
import { tokenRouter } from '@backend/routes/token';
import { successResponse } from '@backend/util/response';
import { Hono } from 'hono';
import { mcpRouter } from './mcp';
import { elasticRouter } from './elastic';

const mainRouter = new Hono();

mainRouter.get('/', (c) => c.json({ message: 'Hello from main router!' }, 200));

mainRouter.get('/health', (c) => c.json(successResponse('OK', 'Server is healthy!'), 200));
mainRouter.route('/scan', scanRouter);
mainRouter.route('/status', statusRouter);
mainRouter.route('/simulate', simulateRouter);
mainRouter.route('/migrate', migrateRouter);
mainRouter.route('/tokens', tokenRouter);
mainRouter.route('/mcp', mcpRouter);
mainRouter.route('/elastic', elasticRouter);

export default mainRouter;
