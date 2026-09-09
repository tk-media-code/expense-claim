CREATE TABLE `sync_state` (
	`id` tinyint unsigned NOT NULL DEFAULT 1,
	`last_imported_at` datetime,
	`last_seen_target_month` date,
	`last_alert_sent_on` date,
	`last_cron_run_at` datetime,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `sync_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `sync_state_single_row` CHECK(`sync_state`.`id` = 1),
	CONSTRAINT `sync_state_target_month_is_first_day` CHECK(`sync_state`.`last_seen_target_month` is null or dayofmonth(`sync_state`.`last_seen_target_month`) = 1)
);
