CREATE TABLE `center_agent_context_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`requested_by_profile_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`conversation_space_id` text NOT NULL,
	`client_name` text NOT NULL,
	`view` text NOT NULL,
	`schema_version` text NOT NULL,
	`requested_token_budget` integer NOT NULL,
	`estimated_token_count` integer NOT NULL,
	`included_message_count` integer NOT NULL,
	`truncated` integer NOT NULL,
	`truncation_reasons_json` text NOT NULL,
	`continuation_cursor` text,
	`source_refs_json` text NOT NULL,
	`audit_entry_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audit_entry_id`) REFERENCES `center_agent_audit_journal`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_context_manifests_identity_non_empty_check" CHECK(length(trim("id")) > 0 and length(trim("conversation_space_id")) > 0 and length(trim("client_name")) > 0 and length(trim("audit_entry_id")) > 0),
	CONSTRAINT "center_agent_context_manifests_view_check" CHECK("view" = 'messages'),
	CONSTRAINT "center_agent_context_manifests_schema_version_check" CHECK("schema_version" = 'center_agent_context_manifest.v1'),
	CONSTRAINT "center_agent_context_manifests_budget_check" CHECK("requested_token_budget" between 256 and 32768 and "estimated_token_count" >= 0 and "included_message_count" between 0 and 50),
	CONSTRAINT "center_agent_context_manifests_json_check" CHECK(json_valid("truncation_reasons_json") and json_type("truncation_reasons_json") = 'array' and json_valid("source_refs_json") and json_type("source_refs_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_context_manifests_audit_uq_idx` ON `center_agent_context_manifests` (`audit_entry_id`);--> statement-breakpoint
CREATE INDEX `center_agent_context_manifests_org_created_idx` ON `center_agent_context_manifests` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `center_agent_context_manifests_requester_created_idx` ON `center_agent_context_manifests` (`requested_by_profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `center_agent_context_manifests_conversation_created_idx` ON `center_agent_context_manifests` (`conversation_space_id`,`created_at`);