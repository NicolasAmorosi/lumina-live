CREATE TABLE `deck_audio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`audio_file` text NOT NULL,
	`ext` text NOT NULL,
	`bytes` integer NOT NULL,
	`origin` text NOT NULL,
	`scope` text NOT NULL,
	`start_slide_index` integer,
	`stop_slide_index` integer,
	`loop` integer DEFAULT 0 NOT NULL,
	`volume` integer,
	`playable` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `slide_decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_deck_audio` ON `deck_audio` (`deck_id`,`start_slide_index`);--> statement-breakpoint
CREATE TABLE `deck_slides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`slide_index` integer NOT NULL,
	`image_file` text NOT NULL,
	`thumb_file` text NOT NULL,
	`width_px` integer NOT NULL,
	`height_px` integer NOT NULL,
	`bytes` integer NOT NULL,
	`advance_ms` integer,
	`advance_on_click` integer DEFAULT 1 NOT NULL,
	`transition_ms` integer,
	`hidden` integer DEFAULT 0 NOT NULL,
	`title` text,
	`notes` text,
	FOREIGN KEY (`deck_id`) REFERENCES `slide_decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_deck_slide` ON `deck_slides` (`deck_id`,`slide_index`);--> statement-breakpoint
CREATE TABLE `slide_decks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content_hash` text NOT NULL,
	`render_width` integer NOT NULL,
	`image_format` text NOT NULL,
	`converter_version` integer NOT NULL,
	`media_asset_id` integer,
	`source_path` text NOT NULL,
	`source_size_bytes` integer NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	`cache_dir` text NOT NULL,
	`slide_count` integer DEFAULT 0 NOT NULL,
	`aspect_ratio` text,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`timings_source` text DEFAULT 'none' NOT NULL,
	`bytes_on_disk` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_deck_identity` ON `slide_decks` (`content_hash`,`render_width`,`image_format`);--> statement-breakpoint
CREATE INDEX `ix_decks_lru` ON `slide_decks` (`last_used_at`);--> statement-breakpoint
CREATE INDEX `ix_decks_asset` ON `slide_decks` (`media_asset_id`);--> statement-breakpoint
DROP TABLE `ppt_slide_cache`;