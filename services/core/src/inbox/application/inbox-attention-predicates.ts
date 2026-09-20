import { currentInboxSourceFactsSql } from "./inbox-current-source-facts";

const facts = currentInboxSourceFactsSql("inbox_items");
export const INBOX_OPEN_REQUEST =
  "attention = 'action_required' AND resolution_status = 'open'";
export const INBOX_OPEN_REVIEW = `(${INBOX_OPEN_REQUEST}) AND
  (json_extract(source_facts_json, '$.requestCategory') = 'review' OR
    (json_extract(source_facts_json, '$.requestCategory') IS NULL AND kind IN ('document_review', 'organization_request')))`;
export const INBOX_UNREAD_PRIORITY_UPDATE = `attention = 'update' AND read_at_ms IS NULL AND
  (importance = 'urgent' OR coalesce(json_array_length(${facts}, '$.firstContactAgentProfileIds'), 0) > 0)`;
export const INBOX_PRIORITY = `((${INBOX_OPEN_REQUEST}) AND importance = 'urgent') OR (${INBOX_UNREAD_PRIORITY_UPDATE})`;
