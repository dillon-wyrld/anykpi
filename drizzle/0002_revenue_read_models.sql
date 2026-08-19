CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`as_of` integer NOT NULL,
	`cash_balance` real NOT NULL,
	`monthly_burn` real NOT NULL,
	`runway_months` real NOT NULL,
	`source` text DEFAULT 'demo' NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_workspace_idx` ON `balance_snapshots` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `balance_snapshots_workspace_as_of_uidx` ON `balance_snapshots` (`workspace_id`,`as_of`);--> statement-breakpoint
CREATE TABLE `mrr_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`period` integer NOT NULL,
	`grain` text NOT NULL,
	`mrr` real NOT NULL,
	`subscriber_count` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'demo' NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mrr_snapshots_workspace_idx` ON `mrr_snapshots` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mrr_snapshots_workspace_grain_period_uidx` ON `mrr_snapshots` (`workspace_id`,`grain`,`period`);--> statement-breakpoint
CREATE TABLE `person_revenue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` text NOT NULL,
	`account_id` text,
	`status` text NOT NULL,
	`plan` text,
	`mrr` real DEFAULT 0 NOT NULL,
	`ltv` real DEFAULT 0 NOT NULL,
	`first_paid_at` integer,
	`last_charge_at` integer,
	`charge_count` integer DEFAULT 0 NOT NULL,
	`last_charge_amount` real,
	`currency` text DEFAULT 'usd' NOT NULL,
	`source` text DEFAULT 'demo' NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `person_revenue_workspace_idx` ON `person_revenue` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `person_revenue_workspace_person_uidx` ON `person_revenue` (`workspace_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` text NOT NULL,
	`account_id` text,
	`event_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`mrr_delta` real DEFAULT 0 NOT NULL,
	`plan` text,
	`source` text DEFAULT 'demo' NOT NULL,
	`source_event_id` text NOT NULL,
	`workspace_id` text DEFAULT 'demo' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subscription_events_workspace_idx` ON `subscription_events` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `subscription_events_person_idx` ON `subscription_events` (`person_id`);--> statement-breakpoint
CREATE INDEX `subscription_events_occurred_idx` ON `subscription_events` (`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_events_workspace_source_event_uidx` ON `subscription_events` (`workspace_id`,`source`,`source_event_id`);