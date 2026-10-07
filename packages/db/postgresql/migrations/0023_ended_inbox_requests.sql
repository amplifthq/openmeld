-- Retire only source-confirmed Agent interaction requests. Preserve failures,
-- final outcomes, existing read times, dismissals, and delivery receipts.
UPDATE "openmeld"."inbox_items"
SET read_at_ms = coalesce(read_at_ms, resolved_at_ms),
    title = 'Request ended',
    preview = 'This request no longer needs a response.'
WHERE source_kind = 'runtime_coordinator_interaction'
  AND attention = 'action_required'
  AND resolution_status = 'resolved'
  AND resolved_at_ms IS NOT NULL;
