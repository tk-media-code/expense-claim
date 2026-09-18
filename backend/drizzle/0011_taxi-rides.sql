CREATE TABLE `receipts` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`taxi_ride_id` int unsigned NOT NULL,
	`drive_file_id` varchar(128) NOT NULL,
	`drive_url` varchar(512) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`stored_at` datetime NOT NULL,
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipts_taxi_ride_id_unique` UNIQUE(`taxi_ride_id`)
);
--> statement-breakpoint
CREATE TABLE `taxi_rides` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`project_id` int unsigned NOT NULL,
	`rode_on` date NOT NULL,
	`amount` int unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `taxi_rides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_taxi_ride_id_taxi_rides_id_fk` FOREIGN KEY (`taxi_ride_id`) REFERENCES `taxi_rides`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `taxi_rides` ADD CONSTRAINT `taxi_rides_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `taxi_rides_project_id_index` ON `taxi_rides` (`project_id`);