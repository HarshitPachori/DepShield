import { Hono } from 'hono';

export const migrateRouter = new Hono<{ Bindings: CloudflareEnv }>();
