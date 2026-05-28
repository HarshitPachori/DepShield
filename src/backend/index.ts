import { getCloudflareContext } from '@opennextjs/cloudflare';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { globalErrorHandler } from '@backend/middleware/globalErrorHandler';
import mainRouter from '@backend/routes';

const app = new Hono<{ Bindings: CloudflareEnv }>().basePath('/api');

app.use('*', logger());
app.use('*', secureHeaders());

// ←←←  IMPORTANT: Put env fixing middleware FIRST (before CORS)
app.use('*', async (c, next) => {
	if (!c.env || Object.keys(c.env).length === 0) {
		try {
			const context = getCloudflareContext();
			c.env = { ...(c.env || {}), ...context.env };
		} catch (e) {
			console.warn('Failed to get Cloudflare context in middleware', e);
		}
	}
	await next();
});

// Now CORS can safely access c.env
app.use(
	'/*',
	cors({
		origin: (origin, c) => {
			const base = c.env?.CLIENT_BASE_URI;
			if (!base) {
				console.warn('CLIENT_BASE_URI is not set in env');
				return null;
			}
			return origin === base ? origin : null;
		},
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
	}),
);

app.use('*', async (c, next) => {
	// Optional second pass if needed in deeper routes
	await next();
});

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError(globalErrorHandler);

app.route('/', mainRouter);

export default app;
