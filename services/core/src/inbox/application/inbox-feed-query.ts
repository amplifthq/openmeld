import type {
  InboxFeedCategory,
  InboxFeedQuery,
} from "@openmeld/schemas/types";
import { inboxMentionSql } from "./inbox-attention-predicates";
import { currentInboxSourceFactsSql } from "./inbox-current-source-facts";
import { INBOX_ATTENTION_PRESENTATION_FILTER } from "./inbox-service";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";

export type InboxFeedScope = {
  organizationId: string;
  recipientUserId: string;
  category: InboxFeedCategory;
  unreadOnly: boolean;
  agentsOnly: boolean;
  peopleOnly?: boolean;
  conversationType?: InboxFeedQuery["conversationType"];
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
      WHERE (organization_id = ? OR organization_id IS NULL) AND recipient_user_id = ? AND cleared_at_ms IS NULL AND rowid <= ?
        ${scope.snapshotId ? "AND EXISTS (SELECT 1 FROM inbox_feed_snapshot_members WHERE snapshot_id = ? AND item_id = inbox_items.id)" : ""}
        AND ${buildCurrentInboxSourceAccessSql("inbox_items", canManageOrganization)}
        AND ${INBOX_ATTENTION_PRESENTATION_FILTER}
    ), classified AS (
      SELECT *,
        ${inboxMentionSql("current_source_facts")} AS is_mention,
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
    ), conversations AS (
      SELECT classified.*, (
        SELECT CASE WHEN conversation.direct_message_pair_key IS NOT NULL
          AND conversation.direct_message_converted_at_ms IS NULL THEN 'direct_messages' ELSE 'spaces' END
        FROM space_index_spaces AS conversation
        WHERE conversation.space_id = json_extract(classified.source_target_json, '$.spaceId')
          AND conversation.organization_id = classified.organization_id
          AND conversation.status = 'active'
      ) AS conversation_type
      FROM classified
    ), filtered AS (
      SELECT * FROM conversations WHERE ${scope.unreadOnly ? "read_at_ms IS NULL" : "1"}
        AND ${scope.agentsOnly ? "is_agent = 1" : "1"}
        AND ${scope.peopleOnly ? "is_agent = 0 AND source_kind = 'space_signal' AND kind IN ('space_message', 'space_mention', 'space_reference')" : "1"}
        AND ${conversationPredicate(scope.conversationType)}
    ), collections AS (
      SELECT *, CASE
        WHEN priority_rank != 2 THEN json_array('item', id)
        WHEN priority_rank = 2 AND json_extract(raw_group_key, '$[0]') = 'conversation'
          THEN json_array('space', organization_id, recipient_user_id,
            json_extract(source_target_json, '$.kind'), json_extract(source_target_json, '$.spaceId'))
        WHEN priority_rank = 2 AND importance = 'normal'
          AND kind IN ('desktop_update', 'computer_connection', 'system_issue')
          THEN json_array('system', recipient_user_id)
        ELSE raw_group_key END AS collection_key
      FROM filtered
    ), selected AS (
      SELECT * FROM collections WHERE ${categoryPredicate(scope.category)}
    )`,
  };
}

function conversationPredicate(
  type: InboxFeedScope["conversationType"]
): string {
  if (type === "direct_messages") {
    return "conversation_type = 'direct_messages'";
  }
  return type === "spaces" ? "conversation_type = 'spaces'" : "1";
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
  (SELECT count(*) FROM selected WHERE read_at_ms IS NULL) AS selection_unread_count,
  coalesce(sum(is_mention), 0) AS mention_count,
  coalesce(sum(request_category = 'action'), 0) AS action_count,
  coalesce(sum(request_category = 'review'), 0) AS review_count,
  coalesce(sum(read_at_ms IS NULL), 0) AS unread_count,
  coalesce(sum(priority_rank = 0), 0) AS priority_count FROM filtered`;

export function inboxFeedRowsSql(
  expanded: boolean,
  grouping?: "space",
  collectionKind?: string
): string {
  const space = grouping === "space";
  const collection = collectionKind === "space" || collectionKind === "system";
  let partition = expanded ? "id" : "raw_group_key";
  if (space && !expanded) {
    partition = "collection_key";
  }
  if (space && collectionKind === "space") {
    partition = "raw_group_key";
  }
  let key = partition === "id" ? "json_array('item', id)" : partition;
  if (space && collectionKind === "space") {
    key = "json_array('conversation_group', raw_group_key, collection_key)";
  }
  let membership = collection ? "collection_key" : "raw_group_key";
  if (space && collectionKind === "conversation_group") {
    membership =
      "json_array('conversation_group', raw_group_key, collection_key)";
  }
  return `, collection_counts AS (
    SELECT collection_key, count(DISTINCT raw_group_key) AS conversation_count FROM selected GROUP BY collection_key
  ), grouped AS (
    SELECT selected.*, conversation_count, count(*) OVER (PARTITION BY ${partition}) AS item_count,
      sum(read_at_ms IS NULL) OVER (PARTITION BY ${partition}) AS unread_count,
      max(occurred_at_ms) OVER (PARTITION BY ${partition}) AS latest_occurred_at_ms,
      min(priority_rank) OVER (PARTITION BY ${partition}) AS section_rank,
      row_number() OVER (PARTITION BY ${partition} ORDER BY priority_rank, occurred_at_ms DESC, id) AS anchor_index,
      ${key} AS sort_key
    FROM selected JOIN collection_counts USING (collection_key) ${expanded ? `WHERE ${membership} = ?` : ""}
  ) SELECT * FROM grouped WHERE anchor_index = 1
    AND (? IS NULL OR section_rank > ? OR (section_rank = ? AND latest_occurred_at_ms < ?)
      OR (section_rank = ? AND latest_occurred_at_ms = ? AND sort_key > ?))
    ORDER BY section_rank, latest_occurred_at_ms DESC, sort_key LIMIT ?`;
}
