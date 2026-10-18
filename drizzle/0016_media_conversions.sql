CREATE TABLE `media_conversions` (
	`media_asset_id` integer PRIMARY KEY NOT NULL,
	`source_size` integer NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	`probe_version` integer NOT NULL,
	`probe_json` text,
	`output_file` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
