ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_state` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_claim_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_claimed_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_claim_expires_at_ms` integer;--> statement-breakpoint
UPDATE `openMeldRemoteAgent_native_delivery_ledger`
SET `final_publication_state` = 'published'
WHERE `conversation_kind` = 'slack'
	AND `status` = 'completed'
	AND length(trim(coalesce(`published_signal_id`, ''))) > 0;--> statement-breakpoint
UPDATE `openMeldRemoteAgent_native_delivery_ledger`
SET
	`status` = 'accepted',
	`failure_code` = 'remote_agent.callback_publication_outcome_unknown',
	`final_publication_state` = 'outcome_unknown',
	`completed_at_ms` = NULL
WHERE `conversation_kind` = 'slack'
	AND `status` = 'completed'
	AND length(trim(coalesce(`published_signal_id`, ''))) = 0;
