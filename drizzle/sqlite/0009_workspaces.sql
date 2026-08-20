CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
INSERT OR IGNORE INTO `workspaces` (`id`, `name`, `created_at`)
SELECT `id`, `name`, `created_at` FROM (
	SELECT 'demo' AS `id`, 'Demo' AS `name`, CAST(strftime('%s', 'now') AS INTEGER) AS `created_at`
	UNION
	SELECT 'live', 'Live', CAST(strftime('%s', 'now') AS INTEGER)
	UNION
	SELECT DISTINCT `workspace_id`, `workspace_id`, CAST(strftime('%s', 'now') AS INTEGER) FROM `users` WHERE `workspace_id` IS NOT NULL
	UNION
	SELECT DISTINCT `workspace_id`, `workspace_id`, CAST(strftime('%s', 'now') AS INTEGER) FROM `accounts` WHERE `workspace_id` IS NOT NULL
	UNION
	SELECT DISTINCT `workspace_id`, `workspace_id`, CAST(strftime('%s', 'now') AS INTEGER) FROM `metric_defs` WHERE `workspace_id` IS NOT NULL
	UNION
	SELECT DISTINCT `workspace_id`, `workspace_id`, CAST(strftime('%s', 'now') AS INTEGER) FROM `config` WHERE `workspace_id` IS NOT NULL
	UNION
	SELECT DISTINCT `workspace_id`, `workspace_id`, CAST(strftime('%s', 'now') AS INTEGER) FROM `api_keys` WHERE `workspace_id` IS NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_config` (
	`key` text NOT NULL,
	`value` text NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_config`("key", "value", "workspace_id") SELECT "key", "value", "workspace_id" FROM `config`;--> statement-breakpoint
DROP TABLE `config`;--> statement-breakpoint
ALTER TABLE `__new_config` RENAME TO `config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `config_workspace_idx` ON `config` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`entity` text,
	`seats` integer DEFAULT 0,
	`activated` integer DEFAULT 0,
	`mrr` real DEFAULT 0,
	`renewal_date` integer,
	`workspace_id` text DEFAULT 'demo' NOT NULL,
	PRIMARY KEY(`workspace_id`, `account_id`)
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("account_id", "name", "entity", "seats", "activated", "mrr", "renewal_date", "workspace_id") SELECT "account_id", "name", "entity", "seats", "activated", "mrr", "renewal_date", "workspace_id" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
CREATE INDEX `accounts_workspace_idx` ON `accounts` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_metric_defs` (
	`metric_id` text NOT NULL,
	`name` text NOT NULL,
	`section` text NOT NULL,
	`section_order` text NOT NULL,
	`owner` text NOT NULL,
	`type` text NOT NULL,
	`unit` text,
	`target` real,
	`good_dir` text NOT NULL,
	`status` text NOT NULL,
	`status_reason` text,
	`workspace_id` text DEFAULT 'demo' NOT NULL,
	PRIMARY KEY(`workspace_id`, `metric_id`)
);
--> statement-breakpoint
INSERT INTO `__new_metric_defs`("metric_id", "name", "section", "section_order", "owner", "type", "unit", "target", "good_dir", "status", "status_reason", "workspace_id") SELECT "metric_id", "name", "section", "section_order", "owner", "type", "unit", "target", "good_dir", "status", "status_reason", "workspace_id" FROM `metric_defs`;--> statement-breakpoint
DROP TABLE `metric_defs`;--> statement-breakpoint
ALTER TABLE `__new_metric_defs` RENAME TO `metric_defs`;--> statement-breakpoint
CREATE INDEX `metric_defs_workspace_idx` ON `metric_defs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_users` (
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`avatar` text,
	`emoji` text,
	`platform` text,
	`country` text,
	`income_band` text,
	`traits` text,
	`signup_date` integer,
	`cluster` text,
	`account_id` text,
	`workspace_id` text DEFAULT 'demo' NOT NULL,
	PRIMARY KEY(`workspace_id`, `person_id`)
);
--> statement-breakpoint
INSERT INTO `__new_users`("person_id", "name", "email", "avatar", "emoji", "platform", "country", "income_band", "traits", "signup_date", "cluster", "account_id", "workspace_id") SELECT "person_id", "name", "email", "avatar", "emoji", "platform", "country", "income_band", "traits", "signup_date", "cluster", "account_id", "workspace_id" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE INDEX `users_workspace_idx` ON `users` (`workspace_id`);