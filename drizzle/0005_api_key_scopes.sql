ALTER TABLE `api_keys` ADD `scope` text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `legacy` integer DEFAULT true NOT NULL;