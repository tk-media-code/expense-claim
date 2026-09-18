CREATE TABLE `projects` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`project_no` varchar(32) NOT NULL,
	`service_date` date NOT NULL,
	`venue_code` varchar(16) NOT NULL,
	`venue_name` varchar(255) NOT NULL,
	`couple_name` varchar(255) NOT NULL,
	`source` enum('mail','manual') NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_project_no_unique` UNIQUE(`project_no`)
);
--> statement-breakpoint
CREATE INDEX `projects_service_date_index` ON `projects` (`service_date`);