PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_center_agent_publication_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`represented_user_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`operation_key` text DEFAULT 'source' NOT NULL,
	`destination_kind` text NOT NULL,
	`destination_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`status` text NOT NULL,
	`response_json` text,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`represented_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_publication_operations_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "center_agent_publication_operations_source_kind_check" CHECK("source_kind" in ('organization_document', 'remote_agent_execution', 'routine_run')),
	CONSTRAINT "center_agent_publication_operations_source_id_non_empty_check" CHECK(length(trim("source_id")) > 0),
	CONSTRAINT "center_agent_publication_operations_source_revision_shape_check" CHECK(length("source_revision") = 64
        and "source_revision" not glob '*[^0-9a-f]*'),
	CONSTRAINT "center_agent_publication_operations_operation_key_non_empty_check" CHECK(length(trim("operation_key")) > 0),
	CONSTRAINT "center_agent_publication_operations_destination_kind_check" CHECK("destination_kind" in ('slack_channel', 'slack_file')),
	CONSTRAINT "center_agent_publication_operations_destination_id_non_empty_check" CHECK(length(trim("destination_id")) > 0),
	CONSTRAINT "center_agent_publication_operations_signature_shape_check" CHECK(length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'),
	CONSTRAINT "center_agent_publication_operations_status_check" CHECK("status" in ('pending', 'completed', 'failed', 'outcome_unknown')),
	CONSTRAINT "center_agent_publication_operations_state_check" CHECK((
        "status" = 'pending'
        and "response_json" is null
        and "claim_id" is not null
        and "claim_expires_at_ms" is not null
      ) or (
        "status" = 'completed'
        and "response_json" is not null
        and "claim_id" is null
        and "claim_expires_at_ms" is null
      ) or (
        "status" in ('failed', 'outcome_unknown')
        and "response_json" is null
        and "claim_id" is null
        and "claim_expires_at_ms" is null
      )),
	CONSTRAINT "center_agent_publication_operations_claim_expiry_check" CHECK("claim_expires_at_ms" is null
        or "claim_expires_at_ms" > "updated_at_ms"),
	CONSTRAINT "center_agent_publication_operations_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_publication_operations`("id", "organization_id", "actor_profile_id", "represented_user_id", "source_kind", "source_id", "source_revision", "operation_key", "destination_kind", "destination_id", "request_signature", "status", "response_json", "claim_id", "claim_expires_at_ms", "created_at_ms", "updated_at_ms") SELECT "id", "organization_id", "actor_profile_id", "represented_user_id", "source_kind", "source_id", "source_revision", 'source', "destination_kind", "destination_id", "request_signature", "status", "response_json", "claim_id", "claim_expires_at_ms", "created_at_ms", "updated_at_ms" FROM `center_agent_publication_operations`;--> statement-breakpoint
DROP TABLE `center_agent_publication_operations`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_publication_operations` RENAME TO `center_agent_publication_operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_publication_operations_scope_unique` ON `center_agent_publication_operations` (`organization_id`,`actor_profile_id`,`source_kind`,`source_id`,`source_revision`,`operation_key`,`destination_kind`,`destination_id`);--> statement-breakpoint
CREATE INDEX `center_agent_publication_operations_org_updated_idx` ON `center_agent_publication_operations` (`organization_id`,`updated_at_ms`);
