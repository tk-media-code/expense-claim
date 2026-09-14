CREATE TABLE `google_credentials` (
	`id` tinyint unsigned NOT NULL DEFAULT 1,
	`refresh_token_encrypted` varbinary(1024) NOT NULL,
	`scopes` varchar(512) NOT NULL,
	`authorized_at` datetime NOT NULL,
	`updated_at` datetime NOT NULL,
	CONSTRAINT `google_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `google_credentials_single_row` CHECK(`google_credentials`.`id` = 1)
);
