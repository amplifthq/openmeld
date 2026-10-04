-- Preserve the bounded retired-owner correction when importing historical data.
-- Item identity, private state, and completed delivery receipts stay unchanged.
UPDATE "openmeld"."inbox_email_deliveries"
SET state = 'suppressed', suppressed_reason = 'item_not_urgent',
    suppressed_at_ms = GREATEST(updated_at_ms, created_at_ms),
    claim_id = NULL, claim_expires_at_ms = NULL
WHERE state = 'pending' AND inbox_item_id IN (
  SELECT id FROM "openmeld"."inbox_items"
  WHERE source_kind = 'space_signal' AND kind = 'space_message'
    AND attention = 'update' AND importance = 'urgent'
    AND source_facts_json IS NULL
    AND source_target_json::jsonb ->> 'kind' = 'space'
    AND source_target_json::jsonb -> 'agentOwnerActivity' IN ('true'::jsonb, '1'::jsonb)
);
--> statement-breakpoint
UPDATE "openmeld"."inbox_items" SET importance = 'normal'
WHERE source_kind = 'space_signal' AND kind = 'space_message'
  AND attention = 'update' AND importance = 'urgent'
  AND source_facts_json IS NULL
  AND source_target_json::jsonb ->> 'kind' = 'space'
  AND source_target_json::jsonb -> 'agentOwnerActivity' IN ('true'::jsonb, '1'::jsonb);
