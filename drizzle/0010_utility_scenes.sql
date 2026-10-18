CREATE TABLE `utility_scenes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`tool` text NOT NULL,
	`config_json` text NOT NULL,
	`style_json` text NOT NULL,
	`title` text,
	`message` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_utility_scenes_order` ON `utility_scenes` (`sort_order`);