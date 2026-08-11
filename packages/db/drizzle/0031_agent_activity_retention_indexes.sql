CREATE INDEX `agent_activity_digests_expiry_idx` ON `agent_activity_digests` (`expires_at_ms`);--> statement-breakpoint
CREATE INDEX `agent_activity_execution_links_created_idx` ON `agent_activity_execution_links` (`created_at_ms`);--> statement-breakpoint
CREATE INDEX `agent_activity_sessions_expiry_idx` ON `agent_activity_sessions` (`expires_at_ms`);
