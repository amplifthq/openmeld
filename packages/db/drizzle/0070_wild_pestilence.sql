PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_center_agent_connector_action_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`represented_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`service` text NOT NULL,
	`action_id` text NOT NULL,
	`connection_name` text NOT NULL,
	`connection_owner_display_name` text,
	`connection_owner_user_id` text,
	`connection_scope` text,
	`status` text NOT NULL,
	`provider_execution_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_profile_id`) REFERENCES `openmeld_profiles`(`profile_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`represented_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_connector_action_operations_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_operation_id_non_empty_check" CHECK(length(trim("operation_id")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_signature_shape_check" CHECK(length("request_signature") = 64
        and "request_signature" not glob '*[^0-9a-f]*'),
	CONSTRAINT "center_agent_connector_action_operations_service_non_empty_check" CHECK(length(trim("service")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_action_non_empty_check" CHECK(length(trim("action_id")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_connection_non_empty_check" CHECK(length(trim("connection_name")) > 0),
	CONSTRAINT "center_agent_connector_action_operations_connection_snapshot_check" CHECK((
        "connection_owner_display_name" is null
        and "connection_owner_user_id" is null
        and "connection_scope" is null
      ) or (
        "connection_owner_display_name" is not null
        and "connection_owner_user_id" is not null
        and "connection_scope" is not null
        and
        length(trim("connection_owner_display_name")) > 0
        and length(trim("connection_owner_user_id")) > 0
        and "connection_scope" in ('member', 'shared')
      )),
	CONSTRAINT "center_agent_connector_action_operations_status_check" CHECK("status" in ('pending', 'completed', 'failed', 'outcome_unknown')),
	CONSTRAINT "center_agent_connector_action_operations_pending_evidence_check" CHECK("status" != 'pending' or "provider_execution_id" is null),
	CONSTRAINT "center_agent_connector_action_operations_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_center_agent_connector_action_operations`("id", "organization_id", "actor_profile_id", "represented_user_id", "operation_id", "request_signature", "service", "action_id", "connection_name", "connection_owner_display_name", "connection_owner_user_id", "connection_scope", "status", "provider_execution_id", "created_at_ms", "updated_at_ms") SELECT "id", "organization_id", "actor_profile_id", "represented_user_id", "operation_id", "request_signature", "service", "action_id", "connection_name", "connection_owner_display_name", "connection_owner_user_id", "connection_scope", "status", "provider_execution_id", "created_at_ms", "updated_at_ms" FROM `center_agent_connector_action_operations`;--> statement-breakpoint
DROP TABLE `center_agent_connector_action_operations`;--> statement-breakpoint
ALTER TABLE `__new_center_agent_connector_action_operations` RENAME TO `center_agent_connector_action_operations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_connector_action_operations_scope_unique` ON `center_agent_connector_action_operations` (`organization_id`,`actor_profile_id`,`represented_user_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `center_agent_connector_action_operations_org_updated_idx` ON `center_agent_connector_action_operations` (`organization_id`,`updated_at_ms`);