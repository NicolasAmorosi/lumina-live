CREATE TABLE `overlay_plates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`position` text NOT NULL,
	`title` text,
	`subtitle` text,
	`image_asset_id` integer,
	`style_json` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_overlay_plates_order` ON `overlay_plates` (`sort_order`);