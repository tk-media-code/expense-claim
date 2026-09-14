CREATE TABLE `venues` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(16) NOT NULL,
	`name` varchar(255) NOT NULL,
	`source` enum('master','manual') NOT NULL,
	`created_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `venues_id` PRIMARY KEY(`id`),
	CONSTRAINT `venues_code_unique` UNIQUE(`code`)
);
