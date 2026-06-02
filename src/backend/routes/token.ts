import { Hono } from 'hono';

export const tokenRouter = new Hono<{ Bindings: CloudflareEnv }>();
