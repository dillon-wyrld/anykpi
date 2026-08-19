CREATE TABLE `accounts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`entity` text,
	`seats` integer DEFAULT 0,
	`activated` integer DEFAULT 0,
	`mrr` real DEFAULT 0,
	`renewal_date` integer,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_workspace_idx` ON `accounts` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`event_name` text NOT NULL,
	`event_class` text NOT NULL,
	`platform` text,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_person_timestamp_idx` ON `activity` (`person_id`,`timestamp`);--> statement-breakpoint
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
	`workspace_id` text DEFAULT 'live' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `cal_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_name` text NOT NULL,
	`source_color` text NOT NULL,
	`type` text NOT NULL,
	`emoji` text NOT NULL,
	`title` text NOT NULL,
	`badge` text NOT NULL,
	`event_date` integer NOT NULL,
	`is_future` integer DEFAULT false,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cal_events_date_idx` ON `cal_events` (`event_date`);--> statement-breakpoint
CREATE INDEX `cal_events_workspace_idx` ON `cal_events` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `config_workspace_idx` ON `config` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `metric_defs` (
	`metric_id` text PRIMARY KEY NOT NULL,
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
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_defs_workspace_idx` ON `metric_defs` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `metric_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`metric_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`value` real,
	`grain` text NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metric_points_metric_timestamp_idx` ON `metric_points` (`metric_id`,`timestamp`);--> statement-breakpoint
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
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_name` text NOT NULL,
	`last_sync` integer,
	`status` text NOT NULL,
	`error` text,
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