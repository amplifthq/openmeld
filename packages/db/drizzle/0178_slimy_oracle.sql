CREATE TABLE `desktop_update_installations` (
	`owner_user_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`lane` text NOT NULL,
	`sequence` integer NOT NULL,
	`observation_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`owner_user_id`, `installation_id`, `lane`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "desktop_update_installations_sequence_check" CHECK("sequence" > 0 and "updated_at_ms" >= 0),
	CONSTRAINT "desktop_update_installations_json_check" CHECK(json_valid("observation_json") and json_type("observation_json") = 'object'),
	CONSTRAINT "desktop_update_installations_lane_check" CHECK("lane" in ('prod', 'dev-local', 'canary'))
);
