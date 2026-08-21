CREATE TABLE `organization_message_channel_setup_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`resolved_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requester_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_message_channel_setup_requests_identity_check" CHECK(length(trim("id")) > 0 and length(trim("organization_id")) > 0 and length(trim("requester_user_id")) > 0),
	CONSTRAINT "organization_message_channel_setup_requests_provider_check" CHECK("provider" in ('slack', 'lark', 'feishu')),
	CONSTRAINT "organization_message_channel_setup_requests_status_check" CHECK(("status" = 'open' and "resolved_at_ms" is null) or ("status" = 'resolved' and "resolved_at_ms" is not null)),
	CONSTRAINT "organization_message_channel_setup_requests_timestamps_check" CHECK("created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("resolved_at_ms" is null or "resolved_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_message_channel_setup_requests_open_unique` ON `organization_message_channel_setup_requests` (`organization_id`,`requester_user_id`,`provider`) WHERE "organization_message_channel_setup_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX `organization_message_channel_setup_requests_resolution_idx` ON `organization_message_channel_setup_requests` (`organization_id`,`provider`,`status`);