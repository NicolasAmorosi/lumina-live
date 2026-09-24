CREATE TABLE `deck_videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deck_id` integer NOT NULL,
	`slide_index` integer NOT NULL,
	`video_file` text NOT NULL,
	`ext` text NOT NULL,
	`bytes` integer NOT NULL,
	`rect_x` real NOT NULL,
	`rect_y` real NOT NULL,
	`rect_width` real NOT NULL,
	`rect_height` real NOT NULL,
	`loop` integer DEFAULT 0 NOT NULL,
	`volume` integer,
	`playable` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `slide_decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_deck_videos` ON `deck_videos` (`deck_id`,`slide_index`);