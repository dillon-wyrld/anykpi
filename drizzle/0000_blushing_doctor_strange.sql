CREATE TABLE `accounts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`entity` text,
	`activation_state` text,
	`renewal_date` integer,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_workspace_idx` ON `accounts` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` text NOT NULL,
	`date` integer NOT NULL,
	`core_count` integer DEFAULT 0,
	`search_count` integer DEFAULT 0,
	`share_count` integer DEFAULT 0,
	`pay_count` integer DEFAULT 0,
	`minutes` integer DEFAULT 0,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_person_date_idx` ON `activity` (`person_id`,`date`);--> statement-breakpoint
CREATE INDEX `activity_workspace_idx` ON `activity` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `annotations_target_idx` ON `annotations` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `annotations_workspace_idx` ON `annotations` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`hashed_key` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `cal_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`date` integer NOT NULL,
	`title` text NOT NULL,
	`amount` real,
	`badge` text,
	`url` text,
	`external_id` text,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cal_events_date_idx` ON `cal_events` (`date`);--> statement-breakpoint
CREATE INDEX `cal_events_workspace_idx` ON `cal_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `config_workspace_idx` ON `config` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `metric_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`section` text NOT NULL,
	`type` text NOT NULL,
	`good_direction` text,
	`unit` text,
	`decimals` integer DEFAULT 0,
	`target` real,
	`source_spec` text,
	`order` integer NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_defs_workspace_order_idx` ON `metric_defs` (`workspace_id`,`order`);--> statement-breakpoint
CREATE TABLE `metric_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_id` text NOT NULL,
	`grain` text NOT NULL,
	`period` text NOT NULL,
	`value` real,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_points_metric_period_idx` ON `metric_points` (`metric_id`,`period`);--> statement-breakpoint
CREATE INDEX `metric_points_workspace_idx` ON `metric_points` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `seats_account_idx` ON `seats` (`account_id`);--> statement-breakpoint
CREATE INDEX `seats_workspace_idx` ON `seats` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`connector` text PRIMARY KEY NOT NULL,
	`last_synced_at` integer,
	`status` text NOT NULL,
	`error` text,
	`stats` text,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_state_workspace_idx` ON `sync_state` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`person_id` text PRIMARY KEY NOT NULL,
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
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `users_workspace_idx` ON `users` (`workspace_id`);