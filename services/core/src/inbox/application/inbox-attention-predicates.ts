import { currentInboxSourceFactsSql } from "./inbox-current-source-facts";

const facts = currentInboxSourceFactsSql("inbox_items");

/** Direct messages to the Human recipient share mention attention, not owner observations. */
export function inboxMentionSql(currentFacts = facts): string {
  return `coalesce((kind IN ('space_mention', 'space_reference')
    OR coalesce(json_array_length(${currentFacts}, '$.mentionedAgentProfileIds'), 0) > 0
    OR (source_kind = 'space_signal' AND attention = 'update'
      AND json_extract(source_target_json, '$.kind') IN ('space', 'center_agent')
      AND (EXISTS (SELECT 1 FROM json_each(${currentFacts}, '$.recipientReasons') WHERE value = 'direct_message')
        OR (${currentFacts} IS NULL AND (
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
  (importance = 'urgent' OR coalesce(json_array_length(${facts}, '$.firstContactAgentProfileIds'), 0) > 0)`;
export const INBOX_PRIORITY = `((${INBOX_OPEN_REQUEST}) AND importance = 'urgent') OR (${INBOX_UNREAD_PRIORITY_UPDATE})`;
