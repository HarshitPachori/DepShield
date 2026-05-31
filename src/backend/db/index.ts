import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '@backend/db/schema';

export const getDbInstance = (runtimeD1: D1Database) => {
	return drizzle(runtimeD1, { logger: true, schema });
};

export type DB = DrizzleD1Database<typeof schema>;
export * from '@backend/db/schema';
