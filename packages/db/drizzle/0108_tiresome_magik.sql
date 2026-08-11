CREATE TABLE `center_agent_context_load_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`manifest_id` text NOT NULL,
	`requested_by_profile_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`client_name` text NOT NULL,
	`schema_version` text NOT NULL,
	`selected_entries_json` text NOT NULL,
	`estimated_token_count` integer NOT NULL,
	`included_message_count` integer NOT NULL,
	`audit_entry_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`manifest_id`) REFERENCES `center_agent_context_manifests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audit_entry_id`) REFERENCES `center_agent_audit_journal`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_context_load_receipts_identity_non_empty_check" CHECK(length(trim("id")) > 0 and length(trim("manifest_id")) > 0 and length(trim("client_name")) > 0 and length(trim("audit_entry_id")) > 0),
	CONSTRAINT "center_agent_context_load_receipts_schema_version_check" CHECK("schema_version" = 'center_agent_context_load_receipt.v1'),
	CONSTRAINT "center_agent_context_load_receipts_budget_check" CHECK("estimated_token_count" >= 0 and "included_message_count" between 1 and 50),
	CONSTRAINT "center_agent_context_load_receipts_json_check" CHECK(json_valid("selected_entries_json") and json_type("selected_entries_json") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_context_load_receipts_manifest_uq_idx` ON `center_agent_context_load_receipts` (`manifest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_context_load_receipts_audit_uq_idx` ON `center_agent_context_load_receipts` (`audit_entry_id`);--> statement-breakpoint
CREATE INDEX `center_agent_context_load_receipts_org_created_idx` ON `center_agent_context_load_receipts` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `center_agent_context_load_receipts_requester_created_idx` ON `center_agent_context_load_receipts` (`requested_by_profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `center_agent_context_manifest_materializations` (
	`manifest_id` text PRIMARY KEY NOT NULL,
	`entries_json` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `center_agent_context_manifests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_context_manifest_materializations_manifest_non_empty_check" CHECK(length(trim("manifest_id")) > 0),
	CONSTRAINT "center_agent_context_manifest_materializations_json_check" CHECK(json_valid("entries_json") and json_type("entries_json") = 'array')
);
