CREATE TABLE `submissions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`target_month` date NOT NULL,
	`executed_at` datetime NOT NULL,
	`written_rows` smallint unsigned NOT NULL,
	CONSTRAINT `submissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `submissions_target_month_is_first_day` CHECK(dayofmonth(`submissions`.`target_month`) = 1)
);
--> statement-breakpoint
CREATE INDEX `submissions_target_month_executed_at_index` ON `submissions` (`target_month`,`executed_at`);