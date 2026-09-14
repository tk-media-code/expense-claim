CREATE TABLE `route_segments` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`route_id` int unsigned NOT NULL,
	`sort_order` smallint unsigned NOT NULL,
	`segment_id` int unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `route_segments_id` PRIMARY KEY(`id`),
	CONSTRAINT `route_segments_route_id_sort_order_unique` UNIQUE(`route_id`,`sort_order`)
);
--> statement-breakpoint
CREATE TABLE `routes` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`venue_id` int unsigned NOT NULL,
	`name` varchar(100) NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `routes_id` PRIMARY KEY(`id`),
	CONSTRAINT `routes_venue_id_name_unique` UNIQUE(`venue_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `route_segments` ADD CONSTRAINT `route_segments_route_id_routes_id_fk` FOREIGN KEY (`route_id`) REFERENCES `routes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `route_segments` ADD CONSTRAINT `route_segments_segment_id_segments_id_fk` FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `routes` ADD CONSTRAINT `routes_venue_id_venues_id_fk` FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON DELETE restrict ON UPDATE no action;