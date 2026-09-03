CREATE TABLE `bible_books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` integer NOT NULL,
	`position` integer NOT NULL,
	`abbrev` text NOT NULL,
	`name` text NOT NULL,
	`testament` text NOT NULL,
	`chapter_count` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `bible_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_book_version_position` ON `bible_books` (`version_id`,`position`);--> statement-breakpoint
CREATE TABLE `bible_favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_code` text NOT NULL,
	`book_abbrev` text NOT NULL,
	`chapter` integer NOT NULL,
	`verse_from` integer NOT NULL,
	`verse_to` integer NOT NULL,
	`reference` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bible_verses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_id` integer NOT NULL,
	`book_id` integer NOT NULL,
	`chapter` integer NOT NULL,
	`verse` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `bible_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_verse` ON `bible_verses` (`version_id`,`book_id`,`chapter`,`verse`);--> statement-breakpoint
CREATE INDEX `ix_verse_chapter` ON `bible_verses` (`book_id`,`chapter`,`verse`);--> statement-breakpoint
CREATE TABLE `bible_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`language` text DEFAULT 'es' NOT NULL,
	`is_builtin` integer DEFAULT 0 NOT NULL,
	`verse_count` integer DEFAULT 0 NOT NULL,
	`source_hash` text,
	`installed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bible_versions_code_unique` ON `bible_versions` (`code`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`path_key` text NOT NULL,
	`name` text NOT NULL,
	`ext` text NOT NULL,
	`size_bytes` integer,
	`mtime_ms` integer,
	`duration_ms` integer,
	`linked_audio_path` text,
	`in_library` integer DEFAULT 1 NOT NULL,
	`last_seen_at` integer,
	`missing_since` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_media_path` ON `media_assets` (`path_key`);--> statement-breakpoint
CREATE INDEX `ix_media_kind` ON `media_assets` (`kind`,`in_library`,`name`);--> statement-breakpoint
CREATE TABLE `ppt_slide_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_path` text NOT NULL,
	`mtime_ms` integer NOT NULL,
	`slide_index` integer NOT NULL,
	`image_path` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projection_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projected_at` integer NOT NULL,
	`kind` text NOT NULL,
	`media_asset_id` integer,
	`service_id` integer,
	`reference` text,
	`snapshot_json` text NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_history_time` ON `projection_history` (`projected_at`);--> statement-breakpoint
CREATE TABLE `service_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`service_id` integer NOT NULL,
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
	`text_body` text,
	`title` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`bible_version_id`) REFERENCES `bible_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bible_book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE set null,
	CHECK (
		(`kind` IN ('media','ppt') AND `media_asset_id` IS NOT NULL AND `bible_text` IS NULL AND `text_body` IS NULL) OR
		(`kind` = 'bible' AND `bible_text` IS NOT NULL AND `media_asset_id` IS NULL) OR
		(`kind` = 'text' AND `text_body` IS NOT NULL AND `media_asset_id` IS NULL)
	)
);
--> statement-breakpoint
CREATE INDEX `ix_items_service` ON `service_items` (`service_id`,`position`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`service_date` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_opened_at` integer
);
--> statement-breakpoint
CREATE INDEX `ix_services_recent` ON `services` (`last_opened_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- FTS5 full-text index over bible_verses.text, external-content (no duplicated 4MB of text).
-- unicode61 remove_diacritics 2 makes "espiritu" match "espíritu" and "Genesis" match "Génesis".
-- drizzle-kit's schema builder has no FTS5 primitive, so this lives here by hand.
CREATE VIRTUAL TABLE `bible_verses_fts` USING fts5(
	text,
	content='bible_verses',
	content_rowid='id',
	tokenize="unicode61 remove_diacritics 2"
);
--> statement-breakpoint
CREATE TRIGGER `bible_verses_ai` AFTER INSERT ON `bible_verses` BEGIN
	INSERT INTO `bible_verses_fts`(rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER `bible_verses_ad` AFTER DELETE ON `bible_verses` BEGIN
	INSERT INTO `bible_verses_fts`(`bible_verses_fts`, rowid, text) VALUES('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE TRIGGER `bible_verses_au` AFTER UPDATE ON `bible_verses` BEGIN
	INSERT INTO `bible_verses_fts`(`bible_verses_fts`, rowid, text) VALUES('delete', old.id, old.text);
	INSERT INTO `bible_verses_fts`(rowid, text) VALUES (new.id, new.text);
END;
