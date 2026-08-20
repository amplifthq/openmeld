CREATE TABLE `agent_activity_session_inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`native_session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`connected_computer_id` text NOT NULL,
	`local_connection_id` text NOT NULL,
	`source_scope_key` text NOT NULL,
	`provider` text NOT NULL,
	`native_session_title` text,
	`status` text NOT NULL,
	`last_active_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`origin` text NOT NULL,
	`can_resume` integer NOT NULL,
	`can_fork` integer NOT NULL,
	`visible` integer NOT NULL,
	`source_reconciliation_id` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`published_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_session_inventory_connection_hash_check" CHECK(length("local_connection_id") = 71
        and substr("local_connection_id", 1, 7) = 'sha256:'
        and substr("local_connection_id", 8) not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_activity_session_inventory_time_check" CHECK("last_active_at_ms" >= 0
        and ("started_at_ms" is null or "started_at_ms" <= "last_active_at_ms")
        and "published_at_ms" >= 0
        and "updated_at_ms" >= "published_at_ms"),
	CONSTRAINT "agent_activity_session_inventory_status_check" CHECK("status" in ('working', 'idle', 'ended', 'error', 'unknown')),
	CONSTRAINT "agent_activity_session_inventory_origin_check" CHECK("origin" in ('openmeld', 'local', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_session_inventory_identity_unique` ON `agent_activity_session_inventory` (`organization_id`,`owner_user_id`,`agent_controller_ref`,`native_session_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_session_inventory_org_page_idx` ON `agent_activity_session_inventory` (`organization_id`,`visible`,"last_active_at_ms" desc,`owner_user_id`,`agent_controller_ref`,`native_session_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_session_inventory_source_idx` ON `agent_activity_session_inventory` (`source_scope_key`,`visible`,`source_reconciliation_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_session_inventory_project_idx` ON `agent_activity_session_inventory` (`organization_id`,`project_id`,`visible`,"last_active_at_ms" desc);--> statement-breakpoint
CREATE TABLE `agent_activity_session_inventory_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`source_scope_key` text NOT NULL,
	`reconciliation_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`native_session_id` text NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`connected_computer_id` text NOT NULL,
	`local_connection_id` text NOT NULL,
	`provider` text NOT NULL,
	`native_session_title` text,
	`status` text NOT NULL,
	`last_active_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`origin` text NOT NULL,
	`can_resume` integer NOT NULL,
	`can_fork` integer NOT NULL,
	`observed_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_session_candidates_time_check" CHECK("page_index" >= 0
        and "last_active_at_ms" >= 0
        and ("started_at_ms" is null or "started_at_ms" <= "last_active_at_ms")
        and "created_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_session_candidates_identity_unique` ON `agent_activity_session_inventory_candidates` (`source_scope_key`,`reconciliation_id`,`agent_controller_ref`,`native_session_id`);--> statement-breakpoint
CREATE INDEX `agent_activity_session_candidates_page_idx` ON `agent_activity_session_inventory_candidates` (`source_scope_key`,`reconciliation_id`,`page_index`);--> statement-breakpoint
CREATE TABLE `agent_activity_session_inventory_sources` (
	`source_scope_key` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`device_id` text NOT NULL,
	`connected_computer_id` text NOT NULL,
	`local_connection_id` text NOT NULL,
	`agent_controller_ref` text NOT NULL,
	`provider` text NOT NULL,
	`state` text NOT NULL,
	`current_reconciliation_id` text,
	`next_page_index` integer NOT NULL,
	`problem_code` text,
	`last_attempt_at_ms` integer,
	`last_complete_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_activity_session_sources_state_check" CHECK("state" in (
        'waiting', 'syncing', 'current', 'stale', 'unsupported', 'error', 'disconnected'
      )),
	CONSTRAINT "agent_activity_session_sources_cursor_check" CHECK("next_page_index" >= 0
        and "updated_at_ms" >= 0
        and (
          ("state" = 'syncing' and "current_reconciliation_id" is not null)
          or ("state" <> 'syncing')
        ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_activity_session_sources_scope_unique` ON `agent_activity_session_inventory_sources` (`organization_id`,`owner_user_id`,`device_id`,`project_id`,`local_connection_id`,`agent_controller_ref`);--> statement-breakpoint
CREATE INDEX `agent_activity_session_sources_org_state_idx` ON `agent_activity_session_inventory_sources` (`organization_id`,`state`,"updated_at_ms" desc);