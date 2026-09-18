CREATE TABLE `imported_mails` (
	`id` varchar(64) NOT NULL,
	`thread_id` varchar(64),
	`result` enum('project','no_request','parse_failed') NOT NULL,
	`internal_date` datetime,
	`processed_at` datetime NOT NULL,
	CONSTRAINT `imported_mails_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `imported_mail_id` varchar(64);--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_imported_mail_id_unique` UNIQUE(`imported_mail_id`);--> statement-breakpoint
CREATE INDEX `imported_mails_processed_at_index` ON `imported_mails` (`processed_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_imported_mail_id_imported_mails_id_fk` FOREIGN KEY (`imported_mail_id`) REFERENCES `imported_mails`(`id`) ON DELETE restrict ON UPDATE no action;