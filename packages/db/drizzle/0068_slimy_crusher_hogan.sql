CREATE TABLE `github_app_installation_states` (
	`state_digest` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`target_connection_name` text NOT NULL,
	`verification_connection_name` text,
	`installation_id` text,
	`status` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_connection_name`) REFERENCES `connector_connections`(`connection_name`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "github_app_installation_states_digest_non_empty_check" CHECK(length(trim("state_digest")) > 0),
	CONSTRAINT "github_app_installation_states_actor_non_empty_check" CHECK(length(trim("actor_profile_id")) > 0),
	CONSTRAINT "github_app_installation_states_target_name_check" CHECK(length("target_connection_name") between 1 and 64 and "target_connection_name" glob '[A-Za-z0-9]*' and "target_connection_name" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "github_app_installation_states_verifier_name_check" CHECK("verification_connection_name" is null or (length("verification_connection_name") between 1 and 64 and "verification_connection_name" glob '[A-Za-z0-9]*' and "verification_connection_name" not glob '*[^A-Za-z0-9_-]*')),
	CONSTRAINT "github_app_installation_states_installation_id_check" CHECK("installation_id" is null or ("installation_id" glob '[1-9]*' and "installation_id" not glob '*[^0-9]*')),
	CONSTRAINT "github_app_installation_states_status_check" CHECK("status" in ('installing', 'verifying', 'completed')),
	CONSTRAINT "github_app_installation_states_shape_check" CHECK((
        ("status" = 'installing' and "installation_id" is null and "verification_connection_name" is null)
        or ("status" in ('verifying', 'completed') and "installation_id" is not null and "verification_connection_name" is not null)
      )),
	CONSTRAINT "github_app_installation_states_expiry_valid_check" CHECK("expires_at_ms" > "created_at_ms"),
	CONSTRAINT "github_app_installation_states_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `github_app_installation_states_org_user_status_idx` ON `github_app_installation_states` (`organization_id`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `github_app_installation_states_expires_idx` ON `github_app_installation_states` (`expires_at_ms`);