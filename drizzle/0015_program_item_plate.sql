--> Hand-written, not generated — for 0011's two reasons: drizzle-kit emits a
--> bare `ALTER TABLE program_items ADD overlay_plate_id … REFERENCES
--> overlay_plates(id)`, which drops the `ON DELETE restrict` (deleting a plate a
--> saved program uses must be a decision the operator takes, `overlay:usages`)
--> and leaves the table's CHECK — invisible to Drizzle — rejecting every
--> `kind = 'plate'` row. Same rebuild as 0011, with a fourth CHECK branch.
CREATE TABLE `__new_program_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`media_asset_id` integer,
	`utility_scene_id` integer,
	`overlay_plate_id` integer,
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
	FOREIGN KEY (`utility_scene_id`) REFERENCES `utility_scenes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`overlay_plate_id`) REFERENCES `overlay_plates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bible_version_id`) REFERENCES `bible_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bible_book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK (
		(`kind` IN ('media','ppt') AND `media_asset_id` IS NOT NULL AND `bible_text` IS NULL AND `utility_scene_id` IS NULL AND `overlay_plate_id` IS NULL) OR
		(`kind` = 'bible' AND `bible_text` IS NOT NULL AND `media_asset_id` IS NULL AND `utility_scene_id` IS NULL AND `overlay_plate_id` IS NULL) OR
		(`kind` = 'utility' AND `utility_scene_id` IS NOT NULL AND `media_asset_id` IS NULL AND `bible_text` IS NULL AND `overlay_plate_id` IS NULL) OR
		(`kind` = 'plate' AND `overlay_plate_id` IS NOT NULL AND `media_asset_id` IS NULL AND `bible_text` IS NULL AND `utility_scene_id` IS NULL)
	)
);--> statement-breakpoint
INSERT INTO `__new_program_items` (
	`id`, `program_id`, `position`, `kind`, `media_asset_id`, `utility_scene_id`, `bible_version_id`,
	`bible_book_id`, `bible_chapter`, `bible_verse_from`, `bible_verse_to`,
	`bible_reference`, `bible_text`, `title`, `created_at`
) SELECT
	`id`, `program_id`, `position`, `kind`, `media_asset_id`, `utility_scene_id`, `bible_version_id`,
	`bible_book_id`, `bible_chapter`, `bible_verse_from`, `bible_verse_to`,
	`bible_reference`, `bible_text`, `title`, `created_at`
FROM `program_items`;--> statement-breakpoint
DROP TABLE `program_items`;--> statement-breakpoint
ALTER TABLE `__new_program_items` RENAME TO `program_items`;--> statement-breakpoint
CREATE INDEX `ix_items_program` ON `program_items` (`program_id`,`position`);
