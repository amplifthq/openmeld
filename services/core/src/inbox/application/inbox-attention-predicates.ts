import { currentInboxAgentFactExistsSql } from "./inbox-current-source-facts";

// Older message projections identified incoming DMs and addressed replies on
// the target. Once source facts exist, use their recipient-specific reasons.
const LEGACY_INCOMING_DM = `source_facts_json IS NULL AND (
  source_target_json::jsonb ->> 'kind' = 'center_agent'
  OR (source_target_json::jsonb -> 'directMessage' = 'true'::jsonb
    AND coalesce(source_target_json::jsonb -> 'agentOwnerActivity', 'false'::jsonb) = 'false'::jsonb))`;

export const INBOX_PERSONAL_MESSAGE = `source_kind = 'space_signal'
  AND source_target_json::jsonb ->> 'kind' IN ('space', 'center_agent')
  AND (kind IN ('space_mention', 'space_reference')
    OR source_facts_json::jsonb -> 'recipientReasons' ?| ARRAY['human_mention', 'direct_message', 'thread_reply', 'requester']
    OR (${LEGACY_INCOMING_DM})
    OR source_target_json::jsonb -> 'replyToRecipient' = 'true'::jsonb)`;

/** Direct messages to the Human recipient share mention attention, not owner observations. */
export function inboxMentionSql(useFeedAgentScope = false): string {
  const mentioned = currentInboxAgentFactExistsSql(
    "inbox_items",
    "mentionedAgentProfileIds",
    useFeedAgentScope
  );
  return `coalesce((kind IN ('space_mention', 'space_reference')
    OR ${mentioned}
    OR (source_kind = 'space_signal' AND attention = 'update'
      AND ((source_target_json)::jsonb #>> '{kind}') IN ('space', 'center_agent')
      AND ((source_facts_json::jsonb -> 'recipientReasons') ? 'direct_message'
        OR (${LEGACY_INCOMING_DM})))), false)`;
}
export const INBOX_OPEN_REQUEST =
  "attention = 'action_required' AND resolution_status = 'open'";
export const INBOX_OPEN_REVIEW = `(${INBOX_OPEN_REQUEST}) AND
  (((source_facts_json)::jsonb #>> '{requestCategory}') = 'review' OR
    (((source_facts_json)::jsonb #>> '{requestCategory}') IS NULL AND kind IN ('document_review', 'organization_request')))`;
function inboxUnreadPriorityUpdateSql(useFeedAgentScope = false): string {
  return `attention = 'update' AND read_at_ms IS NULL AND
    (importance = 'urgent' OR ${currentInboxAgentFactExistsSql("inbox_items", "firstContactAgentProfileIds", useFeedAgentScope)})`;
}
export const INBOX_UNREAD_PRIORITY_UPDATE = inboxUnreadPriorityUpdateSql();
export function inboxPrioritySql(useFeedAgentScope = false): string {
  return `(${INBOX_OPEN_REQUEST}) OR (${inboxUnreadPriorityUpdateSql(useFeedAgentScope)})`;
}
