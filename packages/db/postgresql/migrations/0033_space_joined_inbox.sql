ALTER TABLE "openmeld"."inbox_items" DROP CONSTRAINT "inbox_items_kind_check";--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" ADD CONSTRAINT "inbox_items_kind_check" CHECK ("kind" in ('space_joined', 'space_message', 'space_reference', 'space_mention', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'center_agent_task', 'document_review', 'organization_request', 'system_issue', 'computer_connection', 'desktop_update'));
--> statement-breakpoint
-- Establish existing membership generations as read. Reprojection must not
-- turn historical membership into a new notification after this rollout.
WITH memberships AS (
  SELECT space.organization_id, member.owner_user_id_snapshot AS recipient_user_id,
    member.space_id, member.added_at_ms AS occurred_at_ms,
    concat('space-joined:', member.space_id, ':', member.profile_id, ':', member.added_at_ms) AS source_key,
    left(coalesce(nullif(trim(space.space_name), ''), 'Space'), 160) AS context_label
  FROM "openmeld"."space_index_memberships" AS member
  JOIN "openmeld"."space_index_spaces" AS space ON space.space_id = member.space_id
  JOIN "openmeld"."users" AS recipient ON recipient.id = member.owner_user_id_snapshot
  WHERE member.status = 'active' AND member.profile_kind_snapshot = 'human'
    AND space.status = 'active' AND recipient.deleted_at IS NULL
)
INSERT INTO "openmeld"."inbox_items" (
  id, organization_id, recipient_user_id, kind, attention, importance, title,
  preview, context_label, source_kind, source_key, source_target_json,
  source_facts_json, resolution_status, read_at_ms, occurred_at_ms, created_at_ms, updated_at_ms
)
SELECT concat('inbox_item_', encode(sha256(convert_to(concat('[', to_json(organization_id)::text, ',',
  to_json(recipient_user_id)::text, ',"system_attention_event",', to_json(source_key)::text, ']'), 'UTF8')), 'hex')),
  organization_id, recipient_user_id, 'space_joined', 'update', 'normal', 'You joined a Space',
  'Open this Space to view its members and conversation.', context_label, 'system_attention_event', source_key,
  concat('{"kind":"space","spaceId":', to_json(space_id)::text, '}'),
  '{"version":1,"recipientReasons":["space_member"]}', 'not_applicable', occurred_at_ms,
  occurred_at_ms, occurred_at_ms, occurred_at_ms
FROM memberships
ON CONFLICT (organization_id, recipient_user_id, source_kind, source_key) DO NOTHING;
