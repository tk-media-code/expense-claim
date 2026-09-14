CREATE TABLE `auth_state` (
	`id` tinyint unsigned NOT NULL DEFAULT 1,
	`sessions_valid_after` datetime,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `auth_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `auth_state_single_row` CHECK(`auth_state`.`id` = 1)
);
