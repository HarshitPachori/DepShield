import { integer } from 'drizzle-orm/gel-core';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	googleId: text('google_id').unique().notNull(),
	email: text('email').unique().notNull(),
	name: text('name'),
	avatarUrl: text('avatar_url'),
	createdAt: text('created_at')
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	updatedAt: text('updated_at')
		.$defaultFn(() => new Date().toISOString())
		.$onUpdateFn(() => new Date().toISOString())
		.notNull(),
});

export const patTokens = sqliteTable('pat_tokens', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	platform: text('platform').notNull(),
	encryptedToken: text('encrypted_token').notNull(),
	label: text('label'),
	lastUsedAt: text('last_user_at'),
	createdAt: text('created_at')
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	updatedAt: text('updated_at')
		.$defaultFn(() => new Date().toISOString())
		.$onUpdateFn(() => new Date().toISOString())
		.notNull(),
});

export const scanJobs = sqliteTable('scan_jobs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id').references(() => users.id),
	repoUrl: text('repo_url').notNull(),
	platform: text('platform').notNull(),
	ecosystem: text('ecosystem'),
	packageManager: text('package_manager'),
	status: text('status').default('pending'),
	progress: integer('progress').default(0),
	totalPackages: integer('total_packages').default(0),
	error: text('error'),
	completedAt: text('completed_at'),
	createdAt: text('created_at')
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	updatedAt: text('updated_at')
		.$defaultFn(() => new Date().toISOString())
		.$onUpdateFn(() => new Date().toISOString())
		.notNull(),
});

export const scanResults = sqliteTable('scan_results', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	jobId: text('job_id')
		.notNull()
		.references(() => scanJobs.id, { onDelete: 'cascade' }),
	totalPackages: integer('total_packages'),
	criticalCount: integer('critical_count').default(0),
	highCount: integer('high_count').default(0),
	mediumCount: integer('medium_count').default(0),
	lowCount: integer('low_count').default(0),
	safeCount: integer('safe_count').default(0),
	resultsJson: text('results_json'),
	createdAt: text('created_at')
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	createdAt: text('created_at')
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	updatedAt: text('updated_at')
		.$defaultFn(() => new Date().toISOString())
		.$onUpdateFn(() => new Date().toISOString())
		.notNull(),
});

export const migrationJobs = sqliteTable('migration_jobs', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	userId: text('user_id')
		.notNull()
		.references(() => users.id),
	scanJobId: text('scan_job_id')
		.notNull()
		.references(() => scanJobs.id),
	packageName: text('package_name').notNull(),
	fromVersion: text('from_version'),
	toPackage: text('to_package'),
	toVersion: text('to_version'),
	strategy: text('strategy').notNull(),
	status: text('status').default('pending'),
	branchName: text('branch_name'),
	mrUrl: text('mr_url'),
	prUrl: text('pr_url'),
	filesChanged: integer('files_changed'),
	ciStatus: text('ci_status'),
	stepsJson: text('steps_json'),
	error: text('error'),
	completedAt: text('completed_at'),
	createdAt: text('created_at')
		.$defaultFn(() => new Date().toISOString())
		.notNull(),
	updatedAt: text('updated_at')
		.$defaultFn(() => new Date().toISOString())
		.$onUpdateFn(() => new Date().toISOString())
		.notNull(),
});

export type User = typeof users.$inferSelect;
export type PatToken = typeof patTokens.$inferSelect;
export type ScanJob = typeof scanJobs.$inferSelect;
export type ScanResult = typeof scanResults.$inferSelect;
export type MigrationJob = typeof migrationJobs.$inferSelect;
