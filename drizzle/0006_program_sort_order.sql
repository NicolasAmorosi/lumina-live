ALTER TABLE `programs` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `programs` SET `sort_order` = (
  SELECT COUNT(*) FROM `programs` `p2` WHERE
    (`p2`.`last_opened_at` IS NOT NULL AND `programs`.`last_opened_at` IS NULL)
    OR (`p2`.`last_opened_at` > `programs`.`last_opened_at`)
    OR (
      COALESCE(`p2`.`last_opened_at`, -1) = COALESCE(`programs`.`last_opened_at`, -1)
      AND `p2`.`updated_at` > `programs`.`updated_at`
    )
    OR (
      COALESCE(`p2`.`last_opened_at`, -1) = COALESCE(`programs`.`last_opened_at`, -1)
      AND `p2`.`updated_at` = `programs`.`updated_at`
      AND `p2`.`id` < `programs`.`id`
    )
);--> statement-breakpoint
CREATE INDEX `ix_programs_order` ON `programs` (`sort_order`);
