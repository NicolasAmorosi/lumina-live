--> Hand-written, not generated. drizzle-kit emits a bare
--> `ALTER TABLE program_items ADD utility_scene_id integer REFERENCES utility_scenes(id)`,
--> which is wrong twice over: the table's CHECK constraint is INVISIBLE to
--> Drizzle (it only ever lived in SQL), so a `kind = 'utility'` row would be
--> rejected by a constraint nothing in the schema mentions; and SQLite's
--> ADD COLUMN cannot express `ON DELETE restrict`, which is the whole point of
--> the reference — deleting a scene a saved program uses has to be a decision
--> the operator takes (`utility:usages`), never a row that quietly disappears.
--> Both mean rebuilding the table, exactly like 0009 did.
CREATE TABLE `__new_program_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`media_asset_id` integer,
	`utility_scene_id` integer,
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
	FOREIGN KEY (`bible_version_id`) REFERENCES `bible_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bible_book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK (
		(`kind` IN ('media','ppt') AND `media_asset_id` IS NOT NULL AND `bible_text` IS NULL AND `utility_scene_id` IS NULL) OR
		(`kind` = 'bible' AND `bible_text` IS NOT NULL AND `media_asset_id` IS NULL AND `utility_scene_id` IS NULL) OR
		(`kind` = 'utility' AND `utility_scene_id` IS NOT NULL AND `media_asset_id` IS NULL AND `bible_text` IS NULL)
	)
);--> statement-breakpoint
--> The new column is the only one missing from the source, so it is listed
--> here and not there. Ids are carried over verbatim: nothing references
--> `program_items` today, but a program the operator has open keeps its rows'
--> identity across the upgrade rather than being renumbered under it.
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
