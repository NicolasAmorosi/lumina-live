ALTER TABLE `bible_versions` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `bible_versions` SET `sort_order` = (
  SELECT COUNT(*) FROM `bible_versions` `v2` WHERE
    `v2`.`installed_at` < `bible_versions`.`installed_at`
    OR (`v2`.`installed_at` = `bible_versions`.`installed_at` AND `v2`.`id` < `bible_versions`.`id`)
);
