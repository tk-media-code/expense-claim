CREATE TABLE `attentions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`kind` enum('mail_parse_failed','venue_code_unknown','sheet_unreachable','drive_upload_failed','rows_inserted','month_rolled_over_unsubmitted','alert_send_failed') NOT NULL,
	`detail` text NOT NULL,
	`occurred_at` datetime NOT NULL,
	`checked_at` datetime,
	CONSTRAINT `attentions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `attentions_checked_at_occurred_at_index` ON `attentions` (`checked_at`,`occurred_at`);