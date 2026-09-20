ALTER TABLE `authorized_groups` ADD `timezone` text;--> statement-breakpoint
ALTER TABLE `reminders` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `next_retry_at` integer;