CREATE TABLE `center_agent_connector_action_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`actor_profile_id` text NOT NULL,
	`represented_user_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_signature` text NOT NULL,
	`service` text NOT NULL,
	`action_id` text NOT NULL,
	`connection_name` text NOT NULL,
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
	CONSTRAINT "center_agent_connector_action_operations_status_check" CHECK("status" in ('pending', 'completed', 'failed', 'outcome_unknown')),
	CONSTRAINT "center_agent_connector_action_operations_pending_evidence_check" CHECK("status" != 'pending' or "provider_execution_id" is null),
	CONSTRAINT "center_agent_connector_action_operations_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_connector_action_operations_scope_unique` ON `center_agent_connector_action_operations` (`organization_id`,`actor_profile_id`,`represented_user_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `center_agent_connector_action_operations_org_updated_idx` ON `center_agent_connector_action_operations` (`organization_id`,`updated_at_ms`);