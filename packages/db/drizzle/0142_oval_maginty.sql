CREATE TABLE `openMeldRemoteAgent_work_loop_attempts` (
	`delivery_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`submission_id` text NOT NULL,
	`worker_submit_request_json` text NOT NULL,
	`checkpoint_reason` text NOT NULL,
	`tool_call_limit` integer NOT NULL,
	`next_idempotency_key` text NOT NULL,
	`continued_at_ms` integer NOT NULL,
	PRIMARY KEY(`delivery_id`, `attempt`),
	FOREIGN KEY (`delivery_id`) REFERENCES `openMeldRemoteAgent_native_delivery_ledger`(`delivery_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openMeldRemoteAgent_work_loop_attempts_attempt_positive_check" CHECK("attempt" > 0),
	CONSTRAINT "openMeldRemoteAgent_work_loop_attempts_reason_check" CHECK("checkpoint_reason" = 'tool_call_budget_exhausted'),
	CONSTRAINT "openMeldRemoteAgent_work_loop_attempts_tool_call_limit_positive_check" CHECK("tool_call_limit" > 0),
	CONSTRAINT "openMeldRemoteAgent_work_loop_attempts_continued_at_nonnegative_check" CHECK("continued_at_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_work_loop_attempts_idempotency_key_unique` ON `openMeldRemoteAgent_work_loop_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_work_loop_attempts_submission_id_unique` ON `openMeldRemoteAgent_work_loop_attempts` (`submission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_work_loop_attempts_next_idempotency_key_unique` ON `openMeldRemoteAgent_work_loop_attempts` (`next_idempotency_key`);