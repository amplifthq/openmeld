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
      AND json_extract(source_target_json, '$.kind') IN ('space', 'center_agent')
      AND (EXISTS (SELECT 1 FROM json_each(${facts}, '$.recipientReasons') WHERE value = 'direct_message')
        OR (${facts} IS NULL AND (
          json_extract(source_target_json, '$.kind') = 'center_agent'
          OR (json_extract(source_target_json, '$.directMessage') = 1
            AND coalesce(json_extract(source_target_json, '$.agentOwnerActivity'), 0) = 0)
        ))))), 0)`;
}
export const INBOX_OPEN_REQUEST =
  "attention = 'action_required' AND resolution_status = 'open'";
export const INBOX_OPEN_REVIEW = `(${INBOX_OPEN_REQUEST}) AND
  (json_extract(source_facts_json, '$.requestCategory') = 'review' OR
    (json_extract(source_facts_json, '$.requestCategory') IS NULL AND kind IN ('document_review', 'organization_request')))`;
export const INBOX_UNREAD_PRIORITY_UPDATE = `attention = 'update' AND read_at_ms IS NULL AND
  (importance = 'urgent' OR ${currentInboxAgentFactExistsSql("inbox_items", "firstContactAgentProfileIds")})`;
export const INBOX_PRIORITY = `((${INBOX_OPEN_REQUEST}) AND importance = 'urgent') OR (${INBOX_UNREAD_PRIORITY_UPDATE})`;
