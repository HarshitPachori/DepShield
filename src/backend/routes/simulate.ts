import { Hono } from 'hono';

export const simulateRouter = new Hono<{ Bindings: CloudflareEnv }>();
