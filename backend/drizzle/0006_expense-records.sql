CREATE TABLE `expense_record_legs` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`expense_record_id` int unsigned NOT NULL,
	`sort_order` smallint unsigned NOT NULL,
	`from_station_name` varchar(100) NOT NULL,
	`to_station_name` varchar(100) NOT NULL,
	`amount` int unsigned NOT NULL,
	CONSTRAINT `expense_record_legs_id` PRIMARY KEY(`id`),
	CONSTRAINT `expense_record_legs_expense_record_id_sort_order_unique` UNIQUE(`expense_record_id`,`sort_order`)
);
--> statement-breakpoint
CREATE TABLE `expense_records` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`project_id` int unsigned NOT NULL,
	`trip_type` enum('round','one_way') NOT NULL,
	`outbound_route_id` int unsigned,
	`return_route_id` int unsigned,
	`recorded_at` datetime NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `expense_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `expense_records_project_id_unique` UNIQUE(`project_id`)
);
--> statement-breakpoint
ALTER TABLE `expense_record_legs` ADD CONSTRAINT `expense_record_legs_expense_record_id_expense_records_id_fk` FOREIGN KEY (`expense_record_id`) REFERENCES `expense_records`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_records` ADD CONSTRAINT `expense_records_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_records` ADD CONSTRAINT `expense_records_outbound_route_id_routes_id_fk` FOREIGN KEY (`outbound_route_id`) REFERENCES `routes`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expense_records` ADD CONSTRAINT `expense_records_return_route_id_routes_id_fk` FOREIGN KEY (`return_route_id`) REFERENCES `routes`(`id`) ON DELETE set null ON UPDATE no action;