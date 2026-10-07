import type {
  InboxFeedCategory,
  InboxFeedQuery,
} from "@openmeld/schemas/types";
import { inboxMentionSql } from "./inbox-attention-predicates";
import {
  currentInboxAgentFactExistsSql,
  currentInboxSourceFactsSql,
  INBOX_FEED_PERSONAL_AGENTS_CTE,
} from "./inbox-current-source-facts";
import { inboxAttentionPresentationFilterSql } from "./inbox-service";
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
  canManageOrganization: boolean,
  // Reads reuse classification for counts, grouping and window functions.
  // Snapshot membership and mutations should not compute unused columns.
  materializeClassification = false
): { sql: string; bindings: (string | number)[] } {
  return {
    bindings: [
      scope.organizationId,
      scope.recipientUserId,
      scope.throughRowId,
      ...(scope.snapshotId ? [scope.snapshotId] : []),
    ],
    sql: `WITH ${INBOX_FEED_PERSONAL_AGENTS_CTE}, source_rows AS (
      SELECT id, organization_id, recipient_user_id, source_kind,
        source_target_json, source_facts_json, kind, attention, importance,
        read_at_ms, resolution_status, occurred_at_ms
      FROM "openmeld"."inbox_items"
      WHERE (organization_id = $1 OR organization_id IS NULL) AND recipient_user_id = $2 AND cleared_at_ms IS NULL AND sequence <= $3
        ${scope.snapshotId ? 'AND EXISTS (SELECT 1 FROM "openmeld"."inbox_feed_snapshot_members" WHERE snapshot_id = $4 AND item_id = inbox_items.id)' : ""}
        AND ${buildCurrentInboxSourceAccessSql("inbox_items", canManageOrganization, true)}
        AND ${inboxAttentionPresentationFilterSql(true)}
    ), classified AS ${materializeClassification ? "MATERIALIZED" : "NOT MATERIALIZED"} (
      SELECT *,
        ${inboxMentionSql(true)} AS is_mention,
        (coalesce(jsonb_array_length((source_facts_json)::jsonb #> '{agentProfileIds}'), 0) > 0
          OR kind IN ('agent_reply', 'agent_interaction', 'center_agent_update', 'center_agent_task', 'wake_outcome')
          OR ((source_target_json)::jsonb #>> '{kind}') IN ('agent_profile', 'agent_interaction', 'center_agent', 'center_agent_task')) AS is_agent,
        CASE WHEN attention = 'action_required' AND resolution_status = 'open' THEN
          CASE WHEN ((source_facts_json)::jsonb #>> '{requestCategory}') = 'review'
            OR (((source_facts_json)::jsonb #>> '{requestCategory}') IS NULL AND kind IN ('document_review', 'organization_request'))
          THEN 'review' ELSE 'action' END ELSE NULL END AS request_category,
        CASE WHEN attention = 'action_required' AND resolution_status = 'open' AND importance = 'urgent' THEN 0
          WHEN attention = 'update' AND read_at_ms IS NULL AND (importance = 'urgent'
            OR ${currentInboxAgentFactExistsSql("inbox_items", "firstContactAgentProfileIds", true)}) THEN 0
          WHEN attention = 'action_required' AND resolution_status = 'open' THEN 1 ELSE 2 END AS priority_rank,
        CASE WHEN source_kind = 'space_signal' AND attention = 'update'
          AND kind IN ('space_message', 'space_mention', 'space_reference', 'agent_reply')
          AND ((source_target_json)::jsonb #>> '{kind}') IN ('space', 'center_agent')
          AND ((source_target_json)::jsonb #>> '{spaceId}') IS NOT NULL
        THEN json_build_array('conversation', organization_id, recipient_user_id, ((source_target_json)::jsonb #>> '{kind}'), ((source_target_json)::jsonb #>> '{spaceId}'), ((source_target_json)::jsonb #>> '{threadRootSignalId}'))::text
        ELSE json_build_array('item', id)::text END AS raw_group_key
      FROM source_rows AS inbox_items
    ), conversations AS (
      SELECT classified.*, (
        SELECT CASE WHEN conversation.direct_message_pair_key IS NOT NULL
          AND conversation.direct_message_converted_at_ms IS NULL THEN 'direct_messages' ELSE 'spaces' END
        FROM "openmeld"."space_index_spaces" AS conversation
        WHERE conversation.space_id = ((classified.source_target_json)::jsonb #>> '{spaceId}')
          AND conversation.organization_id = classified.organization_id
          AND conversation.status = 'active'
      ) AS conversation_type
      FROM classified
    ), filtered AS (
      SELECT * FROM conversations WHERE ${scope.unreadOnly ? "read_at_ms IS NULL" : "TRUE"}
        AND ${scope.agentsOnly ? "is_agent" : "TRUE"}
        AND ${scope.peopleOnly ? "NOT is_agent AND source_kind = 'space_signal' AND kind IN ('space_message', 'space_mention', 'space_reference')" : "TRUE"}
        AND ${conversationPredicate(scope.conversationType)}
    ), collections AS (
      SELECT *, CASE
        WHEN priority_rank != 2 THEN json_build_array('item', id)::text
        WHEN priority_rank = 2 AND ((raw_group_key)::jsonb ->> 0) = 'conversation'
          THEN json_build_array('space', organization_id, recipient_user_id, ((source_target_json)::jsonb #>> '{kind}'), ((source_target_json)::jsonb #>> '{spaceId}'))::text
        WHEN priority_rank = 2 AND (importance = 'normal' OR (attention = 'action_required' AND resolution_status = 'resolved'))
          AND kind IN ('desktop_update', 'computer_connection', 'system_issue')
          THEN json_build_array('system', recipient_user_id)::text
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
  return type === "spaces" ? "conversation_type = 'spaces'" : "TRUE";
}

function categoryPredicate(category: InboxFeedCategory): string {
  switch (category) {
    case "mentions":
      return "is_mention";
    case "needs_action":
      return "request_category = 'action'";
    case "needs_review":
      return "request_category = 'review'";
    default:
      return "TRUE";
  }
}

export const INBOX_FEED_COUNTS_SQL = `SELECT count(*) AS all_count,
  (SELECT count(*) FROM selected WHERE read_at_ms IS NULL) AS selection_unread_count,
  count(*) FILTER (WHERE is_mention) AS mention_count,
  count(*) FILTER (WHERE request_category = 'action') AS action_count,
  count(*) FILTER (WHERE request_category = 'review') AS review_count,
  count(*) FILTER (WHERE read_at_ms IS NULL) AS unread_count,
  count(*) FILTER (WHERE priority_rank = 0) AS priority_count FROM filtered`;

export function inboxFeedRowsSql(
  expanded: boolean,
  grouping?: "space",
  collectionKind?: string,
  parameterOffset = 0
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
  let key =
    partition === "id" ? "json_build_array('item', id)::text" : partition;
  if (space && collectionKind === "space") {
    key =
      "json_build_array('conversation_group', raw_group_key, collection_key)::text";
  }
  let membership = collection ? "collection_key" : "raw_group_key";
  if (space && collectionKind === "conversation_group") {
    membership =
      "json_build_array('conversation_group', raw_group_key, collection_key)::text";
  }
  const groupParameter = parameterOffset + 1;
  const cursorParameter = parameterOffset + (expanded ? 2 : 1);
  return `, collection_counts AS (
    SELECT collection_key, count(DISTINCT raw_group_key) AS conversation_count FROM selected GROUP BY collection_key
  ), grouped AS (
    SELECT selected.*, conversation_count, count(*) OVER (PARTITION BY ${partition}) AS item_count,
      count(*) FILTER (WHERE read_at_ms IS NULL) OVER (PARTITION BY ${partition}) AS unread_count,
      max(occurred_at_ms) OVER (PARTITION BY ${partition}) AS latest_occurred_at_ms,
      min(priority_rank) OVER (PARTITION BY ${partition}) AS section_rank,
      row_number() OVER (PARTITION BY ${partition} ORDER BY priority_rank, occurred_at_ms DESC, id) AS anchor_index,
      ${key} AS sort_key
    FROM selected JOIN collection_counts USING (collection_key) ${expanded ? `WHERE ${membership} = $${groupParameter}` : ""}
  ), anchors AS (SELECT *
    FROM grouped AS items WHERE anchor_index = 1
    AND ($${cursorParameter}::integer IS NULL OR section_rank > $${cursorParameter + 1} OR (section_rank = $${cursorParameter + 2} AND latest_occurred_at_ms < $${cursorParameter + 3})
      OR (section_rank = $${cursorParameter + 4} AND latest_occurred_at_ms = $${cursorParameter + 5} AND sort_key > $${cursorParameter + 6}))
    ORDER BY section_rank, latest_occurred_at_ms DESC, sort_key LIMIT $${cursorParameter + 7}
  ), page AS (
    SELECT items.*, anchors.raw_group_key, anchors.sort_key,
      anchors.section_rank, anchors.item_count, anchors.unread_count,
      anchors.latest_occurred_at_ms, anchors.request_category,
      anchors.conversation_count,
      ${currentInboxSourceFactsSql("items", true)} AS current_source_facts
    FROM anchors JOIN "openmeld"."inbox_items" AS items ON items.id = anchors.id
  ) SELECT page.*, to_jsonb(feed_counts) AS feed_counts
    FROM feed_counts LEFT JOIN page ON true
    ORDER BY section_rank, latest_occurred_at_ms DESC, sort_key`;
}
