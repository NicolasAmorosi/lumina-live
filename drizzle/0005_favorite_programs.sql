ALTER TABLE `programs` ADD `favorite` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `programs` DROP COLUMN `program_date`;
