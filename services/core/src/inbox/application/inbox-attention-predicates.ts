import { currentInboxAgentFactExistsSql } from "./inbox-current-source-facts";

/** Direct messages to the Human recipient share mention attention, not owner observations. */
export function inboxMentionSql(): string {
  const facts = "source_facts_json";
  const mentioned = currentInboxAgentFactExistsSql(
    "inbox_items",
    "mentionedAgentProfileIds"
  );
  return `coalesce((kind IN ('space_mention', 'space_reference')
    OR ${mentioned}
    OR (source_kind = 'space_signal' AND attention = 'update'
      AND ((source_target_json)::jsonb #>> '{kind}') IN ('space', 'center_agent')
      AND (EXISTS (SELECT 1 FROM jsonb_array_elements_text((${facts})::jsonb -> 'recipientReasons') AS reasons(value) WHERE value = 'direct_message')
        OR (${facts} IS NULL AND (
          ((source_target_json)::jsonb #>> '{kind}') = 'center_agent'
          OR (source_target_json::jsonb -> 'directMessage' = 'true'::jsonb
            AND coalesce(source_target_json::jsonb -> 'agentOwnerActivity', 'false'::jsonb) = 'false'::jsonb)
        ))))), false)`;
}
export const INBOX_OPEN_REQUEST =
  "attention = 'action_required' AND resolution_status = 'open'";
export const INBOX_OPEN_REVIEW = `(${INBOX_OPEN_REQUEST}) AND
  (((source_facts_json)::jsonb #>> '{requestCategory}') = 'review' OR
    (((source_facts_json)::jsonb #>> '{requestCategory}') IS NULL AND kind IN ('document_review', 'organization_request')))`;
export const INBOX_UNREAD_PRIORITY_UPDATE = `attention = 'update' AND read_at_ms IS NULL AND
  (importance = 'urgent' OR ${currentInboxAgentFactExistsSql("inbox_items", "firstContactAgentProfileIds")})`;
export const INBOX_PRIORITY = `((${INBOX_OPEN_REQUEST}) AND importance = 'urgent') OR (${INBOX_UNREAD_PRIORITY_UPDATE})`;
