PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_center_agent_organization_document_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`represented_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`operation_kind` text NOT NULL,
	`request_signature` text NOT NULL,
	`target_resource_id` text NOT NULL,
	`response_json` text,
	`status` text NOT NULL,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`represented_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_org_document_operations_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "center_agent_org_document_operations_operation_id_non_empty_check" CHECK(length(trim("operation_id")) > 0),
	CONSTRAINT "center_agent_org_document_operations_kind_check" CHECK("operation_kind" in ('create_folder', 'rename_folder', 'move_document', 'save_document')),
	CONSTRAINT "center_agent_org_document_operations_signature_shape_check" CHECK(length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'),
	CONSTRAINT "center_agent_org_document_operations_target_non_empty_check" CHECK(length(trim("target_resource_id")) > 0),
	CONSTRAINT "center_agent_org_document_operations_status_check" CHECK("status" in ('pending', 'completed')),
	CONSTRAINT "center_agent_org_document_operations_response_check" CHECK((
        "status" = 'pending' and "response_json" is null
      ) or (
        "status" = 'completed' and "response_json" is not null
      )),
	CONSTRAINT "center_agent_org_document_operations_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_organization_document_operations`("id", "organization_id", "actor_profile_id", "represented_user_id", "operation_id", "operation_kind", "request_signature", "target_resource_id", "response_json", "status", "claim_id", "claim_expires_at_ms", "created_at_ms", "updated_at_ms") SELECT "id", "organization_id", "actor_profile_id", "represented_user_id", "operation_id", "operation_kind", "request_signature", "target_resource_id", "response_json", "status", NULL, NULL, "created_at_ms", "updated_at_ms" FROM `center_agent_organization_document_operations`;--> statement-breakpoint
DROP TABLE `center_agent_organization_document_operations`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_organization_document_operations` RENAME TO `center_agent_organization_document_operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_org_document_operations_scope_unique` ON `center_agent_organization_document_operations` (`organization_id`,`actor_profile_id`,`represented_user_id`,`operation_kind`,`operation_id`);--> statement-breakpoint
CREATE INDEX `center_agent_org_document_operations_org_updated_idx` ON `center_agent_organization_document_operations` (`organization_id`,"updated_at_ms" desc);
