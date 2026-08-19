ALTER TABLE `activity` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_workspace_external_id_uidx` ON `activity` (`workspace_id`,`external_id`);