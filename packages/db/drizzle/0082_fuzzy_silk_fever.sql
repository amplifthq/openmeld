CREATE TABLE `connector_app_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text,
	`requester_member_id` text,
	`provider_key` text NOT NULL,
	`provider_id` text,
	`provider_name` text NOT NULL,
	`requested_capabilities` text DEFAULT '[]' NOT NULL,
	`use_case` text,
	`source` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`available_at_ms` integer,
	`notified_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requester_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "connector_app_requests_provider_key_non_empty_check" CHECK(length(trim("provider_key")) between 1 and 160),
	CONSTRAINT "connector_app_requests_provider_id_length_check" CHECK("provider_id" is null or length(trim("provider_id")) between 1 and 160),
	CONSTRAINT "connector_app_requests_provider_name_length_check" CHECK(length(trim("provider_name")) between 1 and 120),
	CONSTRAINT "connector_app_requests_capabilities_length_check" CHECK(length("requested_capabilities") between 2 and 2000 and json_valid("requested_capabilities") and json_type("requested_capabilities") = 'array'),
	CONSTRAINT "connector_app_requests_use_case_length_check" CHECK("use_case" is null or length("use_case") between 1 and 2000),
	CONSTRAINT "connector_app_requests_source_check" CHECK("source" in ('openconnector_catalog', 'freeform')),
	CONSTRAINT "connector_app_requests_source_provider_check" CHECK(("source" = 'openconnector_catalog' and "provider_id" is not null) or ("source" = 'freeform' and "provider_id" is null)),
	CONSTRAINT "connector_app_requests_status_check" CHECK("status" in ('requested', 'available', 'declined')),
	CONSTRAINT "connector_app_requests_available_at_check" CHECK(("status" = 'available' and "available_at_ms" is not null) or ("status" != 'available')),
	CONSTRAINT "connector_app_requests_notified_at_check" CHECK("notified_at_ms" is null or "available_at_ms" is not null),
	CONSTRAINT "connector_app_requests_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_app_requests_org_requester_provider_unique` ON `connector_app_requests` (`organization_id`,`requester_user_id`,`provider_key`);--> statement-breakpoint
CREATE INDEX `connector_app_requests_status_created_idx` ON `connector_app_requests` (`status`,`created_at_ms`);--> statement-breakpoint
CREATE INDEX `connector_app_requests_requester_created_idx` ON `connector_app_requests` (`organization_id`,`requester_user_id`,`created_at_ms`);