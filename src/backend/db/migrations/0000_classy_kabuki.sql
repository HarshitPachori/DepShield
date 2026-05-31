CREATE TABLE `migration_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`scan_job_id` text NOT NULL,
	`package_name` text NOT NULL,
	`from_version` text,
	`to_package` text,
	`to_version` text,
	`strategy` text NOT NULL,
	`status` text DEFAULT 'pending',
	`branch_name` text,
	`mr_url` text,
	`pr_url` text,
	`files_changed` integer,
	`ci_status` text,
	`steps_json` text,
	`error` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`scan_job_id`) REFERENCES `scan_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pat_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`encrypted_token` text NOT NULL,
	`label` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scan_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`repo_url` text NOT NULL,
	`platform` text NOT NULL,
	`ecosystem` text,
	`package_manager` text,
	`status` text DEFAULT 'pending',
	`progress` integer DEFAULT 0,
	`total_packages` integer DEFAULT 0,
	`error` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_results` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`total_packages` integer,
	`critical_count` integer DEFAULT 0,
	`high_count` integer DEFAULT 0,
	`medium_count` integer DEFAULT 0,
	`low_count` integer DEFAULT 0,
	`safe_count` integer DEFAULT 0,
	`results_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `scan_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_id_unique` ON `users` (`google_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);