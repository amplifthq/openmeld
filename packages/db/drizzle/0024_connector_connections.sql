CREATE TABLE `connector_connections` (
	`connection_name` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`status` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`disconnected_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "connector_connections_name_format_check" CHECK(length("connection_name") between 1 and 64 and "connection_name" glob '[A-Za-z0-9]*' and "connection_name" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "connector_connections_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "connector_connections_user_non_empty_check" CHECK(length(trim("user_id")) > 0),
	CONSTRAINT "connector_connections_service_check" CHECK("service" in ('github')),
	CONSTRAINT "connector_connections_status_check" CHECK("status" in ('pending', 'active', 'disconnected')),
	CONSTRAINT "connector_connections_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "connector_connections_disconnected_at_valid_check" CHECK(("status" = 'disconnected' and "disconnected_at_ms" is not null) or ("status" != 'disconnected' and "disconnected_at_ms" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_connections_org_user_service_unique` ON `connector_connections` (`organization_id`,`user_id`,`service`);--> statement-breakpoint
CREATE INDEX `connector_connections_org_service_status_idx` ON `connector_connections` (`organization_id`,`service`,`status`);
