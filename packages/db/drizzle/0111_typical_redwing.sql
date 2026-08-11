CREATE TABLE `openMeldRemoteAgent_conversation_generations` (
	`organization_id` text NOT NULL,
	`logical_conversation_id` text NOT NULL,
	`active_generation` integer NOT NULL,
	`started_at_ms` integer,
	`rollover_delivery_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `logical_conversation_id`),
	CONSTRAINT "openMeldRemoteAgent_conversation_generations_identity_non_empty_check" CHECK(length(trim("organization_id")) > 0 and length(trim("logical_conversation_id")) > 0 and length(trim("rollover_delivery_id")) > 0),
	CONSTRAINT "openMeldRemoteAgent_conversation_generations_active_positive_check" CHECK("active_generation" > 0),
	CONSTRAINT "openMeldRemoteAgent_conversation_generations_time_order_check" CHECK("updated_at_ms" >= "created_at_ms" and ("started_at_ms" is null or "started_at_ms" >= "created_at_ms"))
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_conversation_generations_updated` ON `openMeldRemoteAgent_conversation_generations` ("updated_at_ms" desc);