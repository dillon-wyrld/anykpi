CREATE TABLE `tombstones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tombstones_workspace_idx` ON `tombstones` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tombstones_workspace_external_uidx` ON `tombstones` (`workspace_id`,`external_id`);