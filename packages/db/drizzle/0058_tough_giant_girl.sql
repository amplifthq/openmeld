ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_payload_json` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_ambiguity_deadline_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_next_attempt_at_ms` integer;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `final_publication_provider_progress_sequence` integer;