import { Context } from 'hono';
import { errorResponse } from '@backend/util/response';
import logger from '@backend/util/logger';

export const globalErrorHandler = (err: Error, c: Context) => {
	if (err.name === 'ZodError') {
		logger.warn('Validation error', { message: err.message, path: c.req.path, method: c.req.method });
		return c.json(errorResponse(err.message, 400), 400);
	}

	logger.error('Internal server error', err, {
		path: c.req.path,
		method: c.req.method,
		url: c.req.url,
	});
	return c.json(errorResponse('INTERNAL_SERVER_ERROR', 500), 500);
};
