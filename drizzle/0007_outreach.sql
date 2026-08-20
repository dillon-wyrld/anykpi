CREATE TABLE `outreach` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'live' NOT NULL,
	`person_id` text NOT NULL,
	`body` text NOT NULL,
	`state` text DEFAULT 'waiting' NOT NULL,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`approved_at` integer,
	`sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `outreach_workspace_idx` ON `outreach` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `outreach_workspace_person_idx` ON `outreach` (`workspace_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `outreach_workspace_state_idx` ON `outreach` (`workspace_id`,`state`);--> statement-breakpoint
CREATE TABLE `outreach_delivery` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`outreach_id` text NOT NULL,
	`workspace_id` text DEFAULT 'live' NOT NULL,
	`recipient` text NOT NULL,
	`approved_by` text NOT NULL,
	`sent_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outreach_delivery_workspace_sent_idx` ON `outreach_delivery` (`workspace_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `outreach_delivery_outreach_idx` ON `outreach_delivery` (`outreach_id`);