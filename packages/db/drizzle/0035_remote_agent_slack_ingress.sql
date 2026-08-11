CREATE TABLE `openMeldRemoteAgent_slack_event_ingress` (
	`event_key` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`slack_team_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`claim_id` text,
	`claim_expires_at_ms` integer,
	`first_received_at_ms` integer NOT NULL,
	`last_received_at_ms` integer NOT NULL,
	`delivery_attempt_count` integer DEFAULT 0 NOT NULL,
	`slack_retry_num` integer,
	`slack_retry_reason` text,
	`gateway_request_id` text NOT NULL,
	`queue_message_id` text,
	`queue_attempts` integer,
	`outcome_status` text,
	`failure_code` text,
	`completed_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "openMeldRemoteAgent_slack_event_ingress_state_check" CHECK("state" in ('queued', 'processing', 'completed', 'failed')),
	CONSTRAINT "openMeldRemoteAgent_slack_event_ingress_attempt_count_check" CHECK("delivery_attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_slack_event_ingress_state_claim` ON `openMeldRemoteAgent_slack_event_ingress` (`state`,`claim_expires_at_ms`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_slack_event_ingress_team_received` ON `openMeldRemoteAgent_slack_event_ingress` (`slack_team_id`,"last_received_at_ms" desc);
