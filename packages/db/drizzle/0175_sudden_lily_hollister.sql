ALTER TABLE `inbox_items` ADD `source_facts_json` text;
--> statement-breakpoint
-- Repair only the retired personal-Agent observer writer. Keep item identity,
-- occurrence, read/Dismiss/resolution state, and terminal delivery receipts.
UPDATE `inbox_email_deliveries`
SET `state` = 'suppressed', `suppressed_reason` = 'item_not_urgent',
    `suppressed_at_ms` = max(`updated_at_ms`, `created_at_ms`),
    `claim_id` = NULL, `claim_expires_at_ms` = NULL
WHERE `state` = 'pending' AND `inbox_item_id` IN (
  SELECT `id` FROM `inbox_items`
  WHERE `source_kind` = 'space_signal' AND `kind` = 'space_message'
    AND `attention` = 'update' AND `importance` = 'urgent'
    AND `source_facts_json` IS NULL
    AND json_extract(`source_target_json`, '$.kind') = 'space'
    AND json_extract(`source_target_json`, '$.agentOwnerActivity') = 1
);
--> statement-breakpoint
UPDATE `inbox_items` SET `importance` = 'normal'
WHERE `source_kind` = 'space_signal' AND `kind` = 'space_message'
  AND `attention` = 'update' AND `importance` = 'urgent'
  AND `source_facts_json` IS NULL
  AND json_extract(`source_target_json`, '$.kind') = 'space'
  AND json_extract(`source_target_json`, '$.agentOwnerActivity') = 1;
