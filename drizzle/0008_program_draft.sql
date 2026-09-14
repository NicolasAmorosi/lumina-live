CREATE TABLE `program_draft` (
	`id` integer PRIMARY KEY NOT NULL,
	`program_id` integer,
	`name` text NOT NULL,
	`notes` text,
	`items` text NOT NULL,
	`updated_at` integer NOT NULL
);
