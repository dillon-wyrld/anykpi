CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text DEFAULT 'live' NOT NULL,
	`source` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sources_workspace_idx` ON `sources` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sources_workspace_source_uidx` ON `sources` (`workspace_id`,`source`);