CREATE TABLE `authorized_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`jid` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authorized_groups_jid_unique` ON `authorized_groups` (`jid`);--> statement-breakpoint
CREATE TABLE `processed_messages` (
	`message_id` text PRIMARY KEY NOT NULL,
	`processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_jid` text NOT NULL,
	`creator_jid` text NOT NULL,
	`creator_name` text,
	`message` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`executed_at` integer
);
--> statement-breakpoint
CREATE INDEX `reminders_pending_scheduled_idx` ON `reminders` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `reminders_group_status_idx` ON `reminders` (`group_jid`,`status`);