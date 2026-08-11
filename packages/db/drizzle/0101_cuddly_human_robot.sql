CREATE TABLE `center_agent_task_admission_outbox` (
	`task_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`attempt_generation` integer NOT NULL,
	`delivery_id` text NOT NULL,
	`operation_idempotency_key` text NOT NULL,
	`task_event_id` text NOT NULL,
	`requester_user_id` text NOT NULL,
	`instruction` text NOT NULL,
	`parent_kind` text NOT NULL,
	`parent_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`last_attempt_at_ms` integer,
	`last_failure_code` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `center_agent_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "center_agent_task_admission_outbox_generation_check" CHECK("attempt_generation" > 0),
	CONSTRAINT "center_agent_task_admission_outbox_parent_kind_check" CHECK("parent_kind" in ('delivery', 'submission')),
	CONSTRAINT "center_agent_task_admission_outbox_state_check" CHECK("state" in ('pending', 'delivered', 'failed')),
	CONSTRAINT "center_agent_task_admission_outbox_attempt_count_check" CHECK("attempt_count" >= 0),
	CONSTRAINT "center_agent_task_admission_outbox_instruction_non_empty_check" CHECK(length(trim("instruction")) > 0),
	CONSTRAINT "center_agent_task_admission_outbox_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_task_admission_outbox_task_attempt_unique` ON `center_agent_task_admission_outbox` (`task_id`,`attempt_generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `center_agent_task_admission_outbox_delivery_unique` ON `center_agent_task_admission_outbox` (`delivery_id`);--> statement-breakpoint
CREATE INDEX `center_agent_task_admission_outbox_pending_idx` ON `center_agent_task_admission_outbox` (`state`,`updated_at_ms`,`task_id`);