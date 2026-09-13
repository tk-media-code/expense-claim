CREATE TABLE `segments` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`from_station_id` int unsigned NOT NULL,
	`to_station_id` int unsigned NOT NULL,
	`one_way_fare` int unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `segments_id` PRIMARY KEY(`id`),
	CONSTRAINT `segments_from_station_id_to_station_id_unique` UNIQUE(`from_station_id`,`to_station_id`),
	CONSTRAINT `segments_from_to_differ` CHECK(`segments`.`from_station_id` <> `segments`.`to_station_id`)
);
--> statement-breakpoint
ALTER TABLE `segments` ADD CONSTRAINT `segments_from_station_id_stations_id_fk` FOREIGN KEY (`from_station_id`) REFERENCES `stations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `segments` ADD CONSTRAINT `segments_to_station_id_stations_id_fk` FOREIGN KEY (`to_station_id`) REFERENCES `stations`(`id`) ON DELETE restrict ON UPDATE no action;