CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT 'live' NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`subject` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_workspace_created_idx` ON `audit_log` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_log_workspace_actor_created_idx` ON `audit_log` (`workspace_id`,`actor`,`created_at`);