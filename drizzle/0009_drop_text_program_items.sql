--> Hand-written, not generated. drizzle-kit emits a bare
--> `ALTER TABLE program_items DROP COLUMN text_body`, which SQLite refuses:
--> the column is named inside the table's CHECK constraint. Dropping it means
--> rebuilding the table, and the rebuild is what also narrows `kind` from
--> four values to three — the `text` item kind existed in the schema, the DTO
--> and the projector, and never had a way to be created. Verified against the
--> real library before writing this: 0 rows with kind='text', 0 with a
--> non-null text_body.
CREATE TABLE `__new_program_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`media_asset_id` integer,
	`bible_version_id` integer,
	`bible_book_id` integer,
	`bible_chapter` integer,
	`bible_verse_from` integer,
	`bible_verse_to` integer,
	`bible_reference` text,
	`bible_text` text,
	`title` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bible_version_id`) REFERENCES `bible_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bible_book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK (
		(`kind` IN ('media','ppt') AND `media_asset_id` IS NOT NULL AND `bible_text` IS NULL) OR
		(`kind` = 'bible' AND `bible_text` IS NOT NULL AND `media_asset_id` IS NULL)
	)
);--> statement-breakpoint
--> Any surviving `text` row would violate the new CHECK and abort the whole
--> migration, so they are dropped explicitly rather than left to blow up a
--> launch. There are none today; this is what keeps that true on any machine.
DELETE FROM `program_items` WHERE `kind` = 'text';--> statement-breakpoint
INSERT INTO `__new_program_items` (
	`id`, `program_id`, `position`, `kind`, `media_asset_id`, `bible_version_id`,
	`bible_book_id`, `bible_chapter`, `bible_verse_from`, `bible_verse_to`,
	`bible_reference`, `bible_text`, `title`, `created_at`
) SELECT
	`id`, `program_id`, `position`, `kind`, `media_asset_id`, `bible_version_id`,
	`bible_book_id`, `bible_chapter`, `bible_verse_from`, `bible_verse_to`,
	`bible_reference`, `bible_text`, `title`, `created_at`
FROM `program_items`;--> statement-breakpoint
DROP TABLE `program_items`;--> statement-breakpoint
ALTER TABLE `__new_program_items` RENAME TO `program_items`;--> statement-breakpoint
CREATE INDEX `ix_items_program` ON `program_items` (`program_id`,`position`);
