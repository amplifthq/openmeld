import type { InboxFeedCategory } from "@openmeld/schemas/types";
import { currentInboxSourceFactsSql } from "./inbox-current-source-facts";
import { INBOX_ATTENTION_PRESENTATION_FILTER } from "./inbox-service";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";

export type InboxFeedScope = {
  organizationId: string;
  recipientUserId: string;
  category: InboxFeedCategory;
  unreadOnly: boolean;
  agentsOnly: boolean;
  throughRowId: number;
  snapshotId?: string;
};

/** All relevance, permissions and ordering predicates precede LIMIT. */
export function inboxFeedCte(
  scope: InboxFeedScope,
  canManageOrganization: boolean
): { sql: string; bindings: (string | number)[] } {
  return {
    bindings: [
      scope.organizationId,
      scope.recipientUserId,
      scope.throughRowId,
      ...(scope.snapshotId ? [scope.snapshotId] : []),
    ],
    sql: `WITH source_rows AS (
      SELECT inbox_items.*, ${currentInboxSourceFactsSql("inbox_items")} AS current_source_facts
      FROM inbox_items
      WHERE organization_id = ? AND recipient_user_id = ? AND cleared_at_ms IS NULL AND rowid <= ?
        ${scope.snapshotId ? "AND EXISTS (SELECT 1 FROM inbox_feed_snapshot_members WHERE snapshot_id = ? AND item_id = inbox_items.id)" : ""}
        AND ${buildCurrentInboxSourceAccessSql("inbox_items", canManageOrganization)}
        AND ${INBOX_ATTENTION_PRESENTATION_FILTER}
    ), classified AS (
      SELECT *,
        (kind IN ('space_mention', 'space_reference') OR coalesce(json_array_length(current_source_facts, '$.mentionedAgentProfileIds'), 0) > 0) AS is_mention,
        (coalesce(json_array_length(current_source_facts, '$.agentProfileIds'), 0) > 0
          OR kind IN ('agent_reply', 'agent_interaction', 'center_agent_update', 'center_agent_task', 'wake_outcome')
          OR json_extract(source_target_json, '$.kind') IN ('agent_profile', 'agent_interaction', 'center_agent', 'center_agent_task')) AS is_agent,
        CASE WHEN attention = 'action_required' AND resolution_status = 'open' THEN
          CASE WHEN json_extract(current_source_facts, '$.requestCategory') = 'review'
            OR (json_extract(current_source_facts, '$.requestCategory') IS NULL AND kind IN ('document_review', 'organization_request'))
          THEN 'review' ELSE 'action' END ELSE NULL END AS request_category,
        CASE WHEN attention = 'action_required' AND resolution_status = 'open' AND importance = 'urgent' THEN 0
          WHEN attention = 'update' AND read_at_ms IS NULL AND (importance = 'urgent'
            OR coalesce(json_array_length(current_source_facts, '$.firstContactAgentProfileIds'), 0) > 0) THEN 0
          WHEN attention = 'action_required' AND resolution_status = 'open' THEN 1 ELSE 2 END AS priority_rank,
        CASE WHEN source_kind = 'space_signal' AND attention = 'update'
          AND kind IN ('space_message', 'space_mention', 'space_reference', 'agent_reply')
          AND json_extract(source_target_json, '$.kind') IN ('space', 'center_agent')
          AND json_extract(source_target_json, '$.spaceId') IS NOT NULL
        THEN json_array('conversation', organization_id, recipient_user_id,
          json_extract(source_target_json, '$.kind'), json_extract(source_target_json, '$.spaceId'),
          json_extract(source_target_json, '$.threadRootSignalId'))
        ELSE json_array('item', id) END AS raw_group_key
      FROM source_rows
    ), filtered AS (
      SELECT * FROM classified WHERE ${scope.unreadOnly ? "read_at_ms IS NULL" : "1"}
        AND ${scope.agentsOnly ? "is_agent = 1" : "1"}
    ), selected AS (
      SELECT * FROM filtered WHERE ${categoryPredicate(scope.category)}
    )`,
  };
}

function categoryPredicate(category: InboxFeedCategory): string {
  switch (category) {
    case "mentions":
      return "is_mention = 1";
    case "needs_action":
      return "request_category = 'action'";
    case "needs_review":
      return "request_category = 'review'";
    default:
      return "1";
  }
}

export const INBOX_FEED_COUNTS_SQL = `SELECT count(*) AS all_count,
  coalesce(sum(is_mention), 0) AS mention_count,
  coalesce(sum(request_category = 'action'), 0) AS action_count,
  coalesce(sum(request_category = 'review'), 0) AS review_count,
  coalesce(sum(read_at_ms IS NULL), 0) AS unread_count,
  coalesce(sum(priority_rank = 0), 0) AS priority_count FROM filtered`;

export function inboxFeedRowsSql(expanded: boolean): string {
  const partition = expanded ? "id" : "raw_group_key";
  return `, grouped AS (
    SELECT *, count(*) OVER (PARTITION BY ${partition}) AS item_count,
      sum(read_at_ms IS NULL) OVER (PARTITION BY ${partition}) AS unread_count,
      max(occurred_at_ms) OVER (PARTITION BY ${partition}) AS latest_occurred_at_ms,
      min(priority_rank) OVER (PARTITION BY ${partition}) AS section_rank,
      row_number() OVER (PARTITION BY ${partition} ORDER BY priority_rank, occurred_at_ms DESC, id) AS anchor_index,
      ${expanded ? "json_array('item', id)" : "raw_group_key"} AS sort_key
    FROM selected ${expanded ? "WHERE raw_group_key = ?" : ""}
  ) SELECT * FROM grouped WHERE anchor_index = 1
    AND (? IS NULL OR section_rank > ? OR (section_rank = ? AND latest_occurred_at_ms < ?)
      OR (section_rank = ? AND latest_occurred_at_ms = ? AND sort_key > ?))
    ORDER BY section_rank, latest_occurred_at_ms DESC, sort_key LIMIT ?`;
}
