ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `execution_evidence_at_ms` integer;--> statement-breakpoint
UPDATE `openMeldRemoteAgent_native_delivery_ledger`
SET `execution_evidence_at_ms` = `accepted_at_ms`
WHERE `status` IN ('accepted', 'retry_observed')
  AND `accepted_at_ms` IS NOT NULL;
