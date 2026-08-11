ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `breaker_source` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `metered_spend_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `metered_window_start_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `last_metered_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `first_meter_failure_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `last_meter_failure_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `last_meter_failure_code` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_org_guardrails` ADD `meter_failure_streak` integer DEFAULT 0 NOT NULL;