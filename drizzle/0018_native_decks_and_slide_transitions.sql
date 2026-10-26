-- Decks read straight from their source file (`image_format = 'native'`, see `ppt-binary.ts`):
-- `layers` says which pictures of the source make up each slide. And every slide's own transition,
-- read from the file; `transitions_read` marks a deck that has them, so the ones converted before
-- read theirs on next use instead of being reconverted.
ALTER TABLE `deck_slides` ADD `transition` text;--> statement-breakpoint
ALTER TABLE `deck_slides` ADD `layers` text;--> statement-breakpoint
ALTER TABLE `slide_decks` ADD `transitions_read` integer DEFAULT 0 NOT NULL;