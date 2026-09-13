ALTER TABLE `media_assets` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `content_hash_size` integer;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `content_hash_mtime_ms` integer;--> statement-breakpoint
CREATE INDEX `ix_media_content_hash` ON `media_assets` (`content_hash`);
