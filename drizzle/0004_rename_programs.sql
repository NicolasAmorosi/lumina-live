ALTER TABLE `services` RENAME TO `programs`;--> statement-breakpoint
ALTER TABLE `programs` RENAME COLUMN `service_date` TO `program_date`;--> statement-breakpoint
ALTER TABLE `service_items` RENAME TO `program_items`;--> statement-breakpoint
ALTER TABLE `program_items` RENAME COLUMN `service_id` TO `program_id`;--> statement-breakpoint
ALTER TABLE `projection_history` RENAME COLUMN `service_id` TO `program_id`;--> statement-breakpoint
DROP INDEX `ix_services_recent`;--> statement-breakpoint
DROP INDEX `ix_items_service`;--> statement-breakpoint
CREATE INDEX `ix_programs_recent` ON `programs` (`last_opened_at`);--> statement-breakpoint
CREATE INDEX `ix_items_program` ON `program_items` (`program_id`,`position`);
