import {
  INBOX_LIST_DEFAULT_LIMIT,
  INBOX_LIST_MAX_LIMIT,
  INBOX_SPACE_SUMMARY_MAX_SPACES,
  INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS,
  inboxItemSchema,
  inboxSourceTargetSchema,
  inboxViewSchema,
} from "@openmeld/schemas";
import type {
  DismissInboxItemResponse,
  GetInboxItemResponse,
  InboxItem,
  InboxNotificationPreferencesResponse,
  InboxPresentation,
  InboxSummaryResponse,
  InboxView,
  ListInboxItemsResponse,
  MarkAllInboxItemsReadResponse,
  MarkInboxItemReadResponse,
  SpaceInboxSummaryResponse,
  SpaceInboxUnreadTargetsResponse,
} from "@openmeld/schemas/types";
import {
  OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
  OPENMELD_WELCOMING_SPACE_PURPOSE,
} from "@openmeld/space";
import { isReadPositionWithinAllowedFutureSkew } from "../../shared/read-position";
import { personalAgentOwnerAccessSql } from "./inbox-agent-owner-access";
import {
  INBOX_OPEN_REVIEW,
  INBOX_PRIORITY,
  INBOX_UNREAD_PRIORITY_UPDATE,
  inboxMentionSql,
} from "./inbox-attention-predicates";
import {
  currentInboxAgentFactExistsSql,
  currentInboxSourceFactsSql,
} from "./inbox-current-source-facts";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";

const INBOX_ITEM_NOT_FOUND_CODE = "inbox.item_not_found";
const INBOX_INVALID_CURSOR_CODE = "inbox.cursor_invalid";
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BASE64_PADDING_PATTERN = /=+$/u;
const CURRENT_SOURCE_ACCESS_FILTER =
  buildCurrentInboxSourceAccessSql("inbox_items");
const INBOX_SPACE_TARGET_FILTER = `
  json_extract(source_target_json, '$.kind') IN (
    'space',
    'center_agent'
  )
  AND json_extract(source_target_json, '$.spaceId') IS NOT NULL
`;
export const INBOX_SPACE_MESSAGE_FILTER = `
  source_kind = 'space_signal'
  AND attention = 'update'
  AND ${INBOX_SPACE_TARGET_FILTER}
`;
export const INBOX_ATTENTION_PRESENTATION_FILTER = `
  NOT (
    attention = 'update'
    AND importance = 'normal'
    AND kind NOT IN ('space_mention', 'space_reference')
    AND NOT ${currentInboxAgentFactExistsSql("inbox_items", "firstContactAgentProfileIds")}
    AND NOT ${currentInboxAgentFactExistsSql("inbox_items", "mentionedAgentProfileIds")}
    AND ${INBOX_SPACE_TARGET_FILTER}
    AND EXISTS (
      SELECT 1
      FROM inbox_conversation_notification_preferences AS attention_preference
      WHERE attention_preference.user_id = inbox_items.recipient_user_id
        AND attention_preference.organization_id = inbox_items.organization_id
        AND attention_preference.space_id =
          json_extract(inbox_items.source_target_json, '$.spaceId')
        AND attention_preference.mode = 'muted'
    )
  )
`;
const INBOX_NOTIFICATION_EFFECTIVE_MODE_SQL = `COALESCE(
  (
    SELECT mode
    FROM inbox_conversation_notification_preferences
    WHERE user_id = inbox_items.recipient_user_id
      AND organization_id = inbox_items.organization_id
      AND space_id = json_extract(inbox_items.source_target_json, '$.spaceId')
  ),
  (
    SELECT mode
    FROM inbox_message_notification_defaults
    WHERE user_id = inbox_items.recipient_user_id
  ),
  'mentions_and_replies'
)`;
const INBOX_NOTIFICATION_PREVIEW_FILTER = `
  read_at_ms IS NULL
  AND resolution_status != 'resolved'
  AND attention = 'update'
  AND source_kind = 'space_signal'
  AND json_extract(source_target_json, '$.kind') IN ('space', 'center_agent')
  AND kind IN (
    'space_message',
    'space_mention',
    'space_reference',
    'agent_reply',
    'wake_outcome',
    'center_agent_update'
  )
  AND ${INBOX_NOTIFICATION_EFFECTIVE_MODE_SQL} != 'muted'
  AND (
    ${INBOX_NOTIFICATION_EFFECTIVE_MODE_SQL} = 'all_messages'
    OR importance = 'urgent'
    OR kind IN (
      'space_mention',
      'space_reference',
      'agent_reply',
      'wake_outcome'
    )
    OR (
      kind = 'space_message'
      AND json_extract(source_target_json, '$.kind') = 'space'
      AND (
        COALESCE(json_extract(source_target_json, '$.directMessage'), 0) = 1
        OR COALESCE(json_extract(source_target_json, '$.replyToRecipient'), 0) = 1
      )
    )
  )
`;
const INBOX_CENTER_AGENT_MESSAGE_FILTER = `
  source_kind = 'space_signal'
  AND attention = 'update'
  AND json_extract(source_target_json, '$.kind') = 'center_agent'
  AND json_extract(source_target_json, '$.spaceId') IS NOT NULL
`;
const INBOX_CURRENT_DIRECT_MESSAGE_SPACE_ROW_FILTER = `
  unread_space.space_purpose IS ?
  AND unread_space.direct_message_converted_at_ms IS NULL
  AND COALESCE(
    unread_space.active_member_count,
    (
      SELECT count(*)
      FROM space_index_memberships AS unread_space_member
      WHERE unread_space_member.space_id = unread_space.space_id
        AND unread_space_member.status = 'active'
    )
  ) = 2
`;
const INBOX_CURRENT_DIRECT_MESSAGE_SPACE_FILTER = `
  EXISTS (
    SELECT 1
    FROM space_index_spaces AS unread_space
    WHERE unread_space.space_id =
        json_extract(inbox_items.source_target_json, '$.spaceId')
      AND unread_space.organization_id = inbox_items.organization_id
      AND unread_space.status = 'active'
      AND ${INBOX_CURRENT_DIRECT_MESSAGE_SPACE_ROW_FILTER}
  )
`;
const INBOX_ORDINARY_SPACE_FILTER = `
  EXISTS (
    SELECT 1
    FROM space_index_spaces AS unread_space
    WHERE unread_space.space_id =
        json_extract(inbox_items.source_target_json, '$.spaceId')
      AND unread_space.organization_id = inbox_items.organization_id
      AND unread_space.status = 'active'
      AND unread_space.space_purpose IS NOT ?
      AND NOT (${INBOX_CURRENT_DIRECT_MESSAGE_SPACE_ROW_FILTER})
  )
`;

export type InboxItemRow = {
  attention: InboxItem["attention"];
  context_label: string | null;
  created_at_ms: number;
  id: string;
  importance: InboxItem["importance"];
  kind: InboxItem["kind"];
  occurred_at_ms: number;
  organization_id: string | null;
  preview: string;
  read_at_ms: number | null;
  recipient_user_id: string;
  resolution_status: InboxItem["resolutionStatus"];
  source_kind: string;
  source_key: string;
  source_target_json: string;
  source_facts_json: string | null;
  title: string;
  updated_at_ms: number;
};

type InboxListCursor = {
  id: string;
  occurredAtMs: number;
};

export class InboxServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(input: { code: string; message: string; status: number }) {
    super(input.message);
    this.name = "InboxServiceError";
    this.code = input.code;
    this.status = input.status;
  }
}

export function createInboxService(input: {
  db: D1Database;
  includeAccountItems?: boolean;
  nowMs?: () => number;
  canManageOrganization?: boolean;
}) {
  const nowMs = input.nowMs ?? Date.now;
  const ITEM_SCOPE_FILTER = inboxItemScopeSql(input.includeAccountItems);
  const CURRENT_SOURCE_ACCESS_FILTER = buildCurrentInboxSourceAccessSql(
    "inbox_items",
    input.canManageOrganization === true
  );

  return {
    async centerAgentSummary(summaryInput: {
      organizationId: string;
      recipientUserId: string;
    }): Promise<{ organizationId: string; unreadCount: number }> {
      requireIdentifier(summaryInput.organizationId, "organizationId");
      requireIdentifier(summaryInput.recipientUserId, "recipientUserId");
      const row = await input.db
        .prepare(
          `
            SELECT count(*) AS unread_count
            FROM inbox_items
            WHERE organization_id = ?
              AND recipient_user_id = ?
              AND cleared_at_ms IS NULL
              AND read_at_ms IS NULL
              AND ${INBOX_CENTER_AGENT_MESSAGE_FILTER}
              AND ${CURRENT_SOURCE_ACCESS_FILTER}
              AND ${INBOX_CURRENT_DIRECT_MESSAGE_SPACE_FILTER}
          `
        )
        .bind(
          summaryInput.organizationId,
          summaryInput.recipientUserId,
          OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
        )
        .first<{ unread_count: number }>();
      return {
        organizationId: summaryInput.organizationId,
        unreadCount: countValue(row?.unread_count),
      };
    },

    async spaceSummary(summaryInput: {
      organizationId: string;
      recipientUserId: string;
    }): Promise<SpaceInboxSummaryResponse> {
      requireIdentifier(summaryInput.organizationId, "organizationId");
      requireIdentifier(summaryInput.recipientUserId, "recipientUserId");
      const result = await input.db
        .prepare(
          `
            SELECT
              json_extract(source_target_json, '$.spaceId') AS space_id,
              count(*) AS unread_count,
              max(occurred_at_ms) AS latest_unread_occurred_at_ms
            FROM inbox_items
            WHERE organization_id = ?
              AND recipient_user_id = ?
              AND cleared_at_ms IS NULL
              AND read_at_ms IS NULL
              AND ${INBOX_SPACE_MESSAGE_FILTER}
              AND ${CURRENT_SOURCE_ACCESS_FILTER}
            GROUP BY json_extract(source_target_json, '$.spaceId')
            ORDER BY latest_unread_occurred_at_ms DESC, space_id ASC
            LIMIT ?
          `
        )
        .bind(
          summaryInput.organizationId,
          summaryInput.recipientUserId,
          INBOX_SPACE_SUMMARY_MAX_SPACES
        )
        .all<{
          latest_unread_occurred_at_ms: number;
          space_id: string;
          unread_count: number;
        }>();
      const ordinarySpaceUnreadRow = await input.db
        .prepare(
          `
            SELECT count(*) AS unread_count
            FROM inbox_items
            WHERE organization_id = ?
              AND recipient_user_id = ?
              AND cleared_at_ms IS NULL
              AND read_at_ms IS NULL
              AND ${INBOX_SPACE_MESSAGE_FILTER}
              AND ${CURRENT_SOURCE_ACCESS_FILTER}
              AND ${INBOX_ORDINARY_SPACE_FILTER}
          `
        )
        .bind(
          summaryInput.organizationId,
          summaryInput.recipientUserId,
          OPENMELD_WELCOMING_SPACE_PURPOSE,
          OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
        )
        .first<{ unread_count: number }>();
      const attentionResult = await input.db
        .prepare(`
        SELECT json_extract(source_target_json, '$.spaceId') AS space_id,
          sum(CASE WHEN attention = 'action_required' AND resolution_status = 'open' THEN 1 ELSE 0 END) AS actions,
          sum(CASE WHEN ${UNREAD_URGENT_UPDATE_FILTER} AND COALESCE(json_extract(source_target_json, '$.agentOwnerActivity'), 0) != 1 THEN 1 ELSE 0 END) AS urgent
        FROM inbox_items
        WHERE organization_id = ? AND recipient_user_id = ?
          AND cleared_at_ms IS NULL AND ${CURRENT_SOURCE_ACCESS_FILTER}
          AND json_extract(source_target_json, '$.spaceId') IS NOT NULL
          AND ((attention = 'action_required' AND resolution_status = 'open')
            OR (${UNREAD_URGENT_UPDATE_FILTER}))
        GROUP BY json_extract(source_target_json, '$.spaceId')
      `)
        .bind(summaryInput.organizationId, summaryInput.recipientUserId)
        .all<{ space_id: string; actions: number; urgent: number }>();
      const chatCounts = await input.db
        .prepare(`
        SELECT
          sum(CASE WHEN read_at_ms IS NULL AND ${INBOX_SPACE_MESSAGE_FILTER} THEN 1 ELSE 0 END) AS unread,
          sum(CASE WHEN attention = 'action_required' AND resolution_status = 'open' THEN 1 ELSE 0 END) AS actions,
          sum(CASE WHEN ${UNREAD_URGENT_UPDATE_FILTER} AND COALESCE(json_extract(source_target_json, '$.agentOwnerActivity'), 0) != 1 THEN 1 ELSE 0 END) AS urgent
        FROM inbox_items
        WHERE organization_id = ? AND recipient_user_id = ?
          AND cleared_at_ms IS NULL AND ${CURRENT_SOURCE_ACCESS_FILTER}
          AND ${INBOX_CURRENT_DIRECT_MESSAGE_SPACE_FILTER}
      `)
        .bind(
          summaryInput.organizationId,
          summaryInput.recipientUserId,
          OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
        )
        .first<{ unread: number; actions: number; urgent: number }>();
      return {
        chatUnreadCount: countValue(chatCounts?.unread),
        chatUnresolvedActionCount: countValue(chatCounts?.actions),
        chatUnreadUrgentUpdateCount: countValue(chatCounts?.urgent),
        attention: (attentionResult.results ?? []).map((row) => ({
          spaceId: row.space_id,
          unresolvedActionCount: countValue(row.actions),
          unreadUrgentUpdateCount: countValue(row.urgent),
        })),
        ordinarySpaceUnreadCount: countValue(
          ordinarySpaceUnreadRow?.unread_count
        ),
        organizationId: summaryInput.organizationId,
        spaces: (result.results ?? []).map((row) => ({
          latestUnreadOccurredAtMs: nonnegativeIntegerValue(
            row.latest_unread_occurred_at_ms
          ),
          spaceId: row.space_id,
          unreadCount: countValue(row.unread_count),
        })),
      };
    },

    async spaceUnreadTargets(targetInput: {
      includeItemIds?: boolean;
      organizationId: string;
      recipientUserId: string;
      spaceId: string;
    }): Promise<SpaceInboxUnreadTargetsResponse> {
      requireIdentifier(targetInput.organizationId, "organizationId");
      requireIdentifier(targetInput.recipientUserId, "recipientUserId");
      requireIdentifier(targetInput.spaceId, "spaceId");
      const filters = `
        organization_id = ?
        AND recipient_user_id = ?
        AND cleared_at_ms IS NULL
        AND read_at_ms IS NULL
        AND ${INBOX_SPACE_MESSAGE_FILTER}
        AND json_extract(source_target_json, '$.spaceId') = ?
        AND ${CURRENT_SOURCE_ACCESS_FILTER}
      `;
      const countRow = await input.db
        .prepare(
          `SELECT count(*) AS unread_count FROM inbox_items WHERE ${filters}`
        )
        .bind(
          targetInput.organizationId,
          targetInput.recipientUserId,
          targetInput.spaceId
        )
        .first<{ unread_count: number }>();
      const targetResult = await input.db
        .prepare(
          `
            SELECT id, occurred_at_ms, source_target_json
            FROM inbox_items
            WHERE ${filters}
              AND json_extract(source_target_json, '$.signalId') IS NOT NULL
            ORDER BY occurred_at_ms ASC, id ASC
            LIMIT ?
          `
        )
        .bind(
          targetInput.organizationId,
          targetInput.recipientUserId,
          targetInput.spaceId,
          INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS + 1
        )
        .all<{
          occurred_at_ms: number;
          source_target_json: string;
        }>();
      const scopeRows = targetInput.includeItemIds
        ? await input.db
            .prepare(
              `SELECT json_extract(source_target_json, '$.threadRootSignalId') AS thread_root_signal_id, count(*) AS unread_count FROM inbox_items WHERE ${filters} GROUP BY json_extract(source_target_json, '$.threadRootSignalId')`
            )
            .bind(
              targetInput.organizationId,
              targetInput.recipientUserId,
              targetInput.spaceId
            )
            .all<{
              thread_root_signal_id: string | null;
              unread_count: number;
            }>()
        : null;
      const totalUnreadCount = countValue(countRow?.unread_count);
      const rows = (targetResult.results ?? []) as Array<{
        id: string;
        occurred_at_ms: number;
        source_target_json: string;
      }>;
      const targets = rows
        .slice(0, INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS)
        .map((row) => {
          const parsed = inboxSourceTargetSchema.safeParse(
            JSON.parse(row.source_target_json)
          );
          if (
            !parsed.success ||
            (parsed.data.kind !== "space" &&
              parsed.data.kind !== "center_agent") ||
            parsed.data.signalId === undefined
          ) {
            return null;
          }
          return {
            ...(targetInput.includeItemIds ? { itemId: row.id } : {}),
            occurredAtMs: nonnegativeIntegerValue(row.occurred_at_ms),
            signalId: parsed.data.signalId,
            threadRootSignalId:
              parsed.data.kind === "space"
                ? (parsed.data.threadRootSignalId ?? null)
                : null,
          };
        })
        .filter((target) => target !== null);
      return {
        ...(scopeRows
          ? {
              scopes: (scopeRows.results ?? []).map((row) => ({
                threadRootSignalId: row.thread_root_signal_id,
                unreadCount: countValue(row.unread_count),
              })),
            }
          : {}),
        hasMoreTargets:
          rows.length > INBOX_SPACE_UNREAD_TARGETS_MAX_ITEMS ||
          targets.length < totalUnreadCount,
        organizationId: targetInput.organizationId,
        spaceId: targetInput.spaceId,
        targets,
        totalUnreadCount,
      };
    },

    async dismiss(dismissInput: {
      itemId: string;
      organizationId: string;
      recipientUserId: string;
    }): Promise<DismissInboxItemResponse> {
      requireIdentifier(dismissInput.itemId, "itemId");
      requireIdentifier(dismissInput.organizationId, "organizationId");
      requireIdentifier(dismissInput.recipientUserId, "recipientUserId");
      const timestamp = readNowMs(nowMs);
      const [itemResult] = await input.db.batch([
        input.db
          .prepare(
            `
              UPDATE inbox_items
              SET
                cleared_at_ms = coalesce(cleared_at_ms, ?),
                updated_at_ms = max(updated_at_ms, ?)
              WHERE id = ?
                AND ${ITEM_SCOPE_FILTER}
                AND recipient_user_id = ?
                AND cleared_at_ms IS NULL
                AND ${CURRENT_SOURCE_ACCESS_FILTER}
            `
          )
          .bind(
            timestamp,
            timestamp,
            dismissInput.itemId,
            dismissInput.organizationId,
            dismissInput.recipientUserId
          ),
        input.db
          .prepare(
            `
              UPDATE inbox_email_deliveries
              SET
                state = 'suppressed',
                suppressed_reason = 'item_cleared',
                suppressed_at_ms = ?,
                claim_id = NULL,
                claim_expires_at_ms = NULL,
                updated_at_ms = max(updated_at_ms, ?)
              WHERE inbox_item_id = ?
                AND state = 'pending'
                AND EXISTS (
                  SELECT 1
                  FROM inbox_items
                  WHERE id = ?
                    AND ${ITEM_SCOPE_FILTER}
                    AND recipient_user_id = ?
                    AND cleared_at_ms IS NOT NULL
                    AND ${CURRENT_SOURCE_ACCESS_FILTER}
                )
            `
          )
          .bind(
            timestamp,
            timestamp,
            dismissInput.itemId,
            dismissInput.itemId,
            dismissInput.organizationId,
            dismissInput.recipientUserId
          ),
      ]);
      if (!itemResult) {
        throw new Error("Inbox dismiss mutation did not return a result");
      }
      if (changedRows(itemResult) === 0) {
        const existing = await hasAccessibleInboxItem({
          canManageOrganization: input.canManageOrganization,
          includeAccountItems: input.includeAccountItems,
          db: input.db,
          itemId: dismissInput.itemId,
          organizationId: dismissInput.organizationId,
          recipientUserId: dismissInput.recipientUserId,
        });
        if (!existing) {
          throw new InboxServiceError({
            code: INBOX_ITEM_NOT_FOUND_CODE,
            message: "Inbox item was not found.",
            status: 404,
          });
        }
      }
      return { dismissedItemId: dismissInput.itemId };
    },

    async get(getInput: {
      itemId: string;
      organizationId: string;
      recipientUserId: string;
    }): Promise<GetInboxItemResponse> {
      requireIdentifier(getInput.itemId, "itemId");
      requireIdentifier(getInput.organizationId, "organizationId");
      requireIdentifier(getInput.recipientUserId, "recipientUserId");
      const item = await readInboxItem({
        canManageOrganization: input.canManageOrganization,
        includeAccountItems: input.includeAccountItems,
        db: input.db,
        itemId: getInput.itemId,
        organizationId: getInput.organizationId,
        recipientUserId: getInput.recipientUserId,
      });
      if (!item) {
        throw new InboxServiceError({
          code: INBOX_ITEM_NOT_FOUND_CODE,
          message: "Inbox item was not found.",
          status: 404,
        });
      }
      return { item };
    },

    async getPreferences(preferenceInput: {
      userId: string;
    }): Promise<InboxNotificationPreferencesResponse> {
      requireIdentifier(preferenceInput.userId, "userId");
      const row = await input.db
        .prepare(
          `
            SELECT urgent_email_enabled, updated_at_ms
            FROM inbox_notification_preferences
            WHERE user_id = ?
            LIMIT 1
          `
        )
        .bind(preferenceInput.userId)
        .first<{ urgent_email_enabled: number; updated_at_ms: number }>();
      if (!row) {
        return { updatedAt: null, urgentEmailEnabled: true };
      }
      return {
        updatedAt: toIsoTimestamp(row.updated_at_ms, "updated_at_ms"),
        urgentEmailEnabled: row.urgent_email_enabled === 1,
      };
    },

    async list(listInput: {
      cursor?: string;
      limit?: number;
      notificationPreview?: boolean;
      organizationId: string;
      presentation?: InboxPresentation;
      recipientUserId: string;
      view?: InboxView;
    }): Promise<ListInboxItemsResponse> {
      requireIdentifier(listInput.organizationId, "organizationId");
      requireIdentifier(listInput.recipientUserId, "recipientUserId");
      const parsedView = inboxViewSchema.safeParse(listInput.view ?? "all");
      if (!parsedView.success) {
        throw invalidInputError("Inbox view is invalid.");
      }
      const limit = normalizeLimit(listInput.limit);
      const cursor = decodeCursor(listInput.cursor);
      const filters = [
        ITEM_SCOPE_FILTER,
        "recipient_user_id = ?",
        "cleared_at_ms IS NULL",
        CURRENT_SOURCE_ACCESS_FILTER,
      ];
      const bindings: Array<number | string> = [
        listInput.organizationId,
        listInput.recipientUserId,
      ];
      if (listInput.presentation === "attention") {
        filters.push(INBOX_ATTENTION_PRESENTATION_FILTER);
      }
      appendViewFilter(filters, parsedView.data, listInput.presentation);
      if (listInput.notificationPreview) {
        filters.push(INBOX_NOTIFICATION_PREVIEW_FILTER);
      }
      if (cursor) {
        filters.push("(occurred_at_ms < ? OR (occurred_at_ms = ? AND id < ?))");
        bindings.push(cursor.occurredAtMs, cursor.occurredAtMs, cursor.id);
      }
      bindings.push(limit + 1);
      const result = await input.db
        .prepare(
          `
            SELECT
              id,
              organization_id,
              recipient_user_id,
              kind,
              attention,
              importance,
              title,
              preview,
              context_label,
              source_kind,
              source_key,
              source_target_json,
              ${currentInboxSourceFactsSql("inbox_items")} AS source_facts_json,
              resolution_status,
              read_at_ms,
              occurred_at_ms,
              created_at_ms,
              updated_at_ms
            FROM inbox_items
            WHERE ${filters.join(" AND ")}
            ORDER BY occurred_at_ms DESC, id DESC
            LIMIT ?
          `
        )
        .bind(...bindings)
        .all<InboxItemRow>();
      const rows = result.results ?? [];
      const itemRows = rows.slice(0, limit);
      const items = itemRows.map(mapInboxItemRow);
      const lastRow = itemRows.at(-1);
      return {
        items,
        nextCursor:
          rows.length > limit && lastRow
            ? encodeCursor({
                id: lastRow.id,
                occurredAtMs: lastRow.occurred_at_ms,
              })
            : null,
        organizationId: listInput.organizationId,
      };
    },

    async markAllRead(markAllInput: {
      organizationId: string;
      presentation?: InboxPresentation;
      recipientUserId: string;
    }): Promise<MarkAllInboxItemsReadResponse> {
      requireIdentifier(markAllInput.organizationId, "organizationId");
      requireIdentifier(markAllInput.recipientUserId, "recipientUserId");
      const timestamp = readNowMs(nowMs);
      const result = await input.db
        .prepare(
          `
            UPDATE inbox_items
            SET read_at_ms = ?, updated_at_ms = max(updated_at_ms, ?)
            WHERE organization_id = ?
              AND recipient_user_id = ?
              AND cleared_at_ms IS NULL
              AND read_at_ms IS NULL
              AND ${CURRENT_SOURCE_ACCESS_FILTER}
              ${
                markAllInput.presentation === "attention"
                  ? `AND ${INBOX_ATTENTION_PRESENTATION_FILTER}`
                  : ""
              }
          `
        )
        .bind(
          timestamp,
          timestamp,
          markAllInput.organizationId,
          markAllInput.recipientUserId
        )
        .run();
      return { markedReadCount: changedRows(result) };
    },

    async markCenterAgentReadThrough(readInput: {
      organizationId: string;
      recipientUserId: string;
      spaceId: string;
      throughOccurredAtMs: number;
    }): Promise<{ markedReadCount: number; readThroughAt: string }> {
      return await markSpaceInboxReadThrough({
        ...readInput,
        db: input.db,
        invalidWatermarkMessage: "Center Agent read watermark is invalid.",
        itemScope: "center_agent",
        mutationDescription: "Center Agent Inbox read mutation",
        nowMs,
        unavailableCode: "inbox.center_agent_space_unavailable",
        unavailableMessage: "Center Agent conversation was not found.",
      });
    },

    async markSpaceReadThrough(readInput: {
      organizationId: string;
      recipientUserId: string;
      spaceId: string;
      threadRootSignalId?: string;
      throughOccurredAtMs: number;
    }): Promise<{ markedReadCount: number; readThroughAt: string }> {
      return await markSpaceInboxReadThrough({
        ...readInput,
        db: input.db,
        invalidWatermarkMessage: "Space read watermark is invalid.",
        itemScope: "space",
        mutationDescription: "Space Inbox read mutation",
        nowMs,
        unavailableCode: "inbox.space_unavailable",
        unavailableMessage: "Space was not found.",
      });
    },

    async markRead(markInput: {
      itemId: string;
      organizationId: string;
      read: boolean;
      recipientUserId: string;
    }): Promise<MarkInboxItemReadResponse> {
      requireIdentifier(markInput.itemId, "itemId");
      requireIdentifier(markInput.organizationId, "organizationId");
      requireIdentifier(markInput.recipientUserId, "recipientUserId");
      const timestamp = readNowMs(nowMs);
      const result = await input.db
        .prepare(
          `
            UPDATE inbox_items
            SET
              read_at_ms = CASE
                WHEN ? = 1 THEN coalesce(read_at_ms, ?)
                ELSE NULL
              END,
              updated_at_ms = max(updated_at_ms, ?)
            WHERE id = ?
              AND ${ITEM_SCOPE_FILTER}
              AND recipient_user_id = ?
              AND cleared_at_ms IS NULL
              AND ${CURRENT_SOURCE_ACCESS_FILTER}
          `
        )
        .bind(
          markInput.read ? 1 : 0,
          timestamp,
          timestamp,
          markInput.itemId,
          markInput.organizationId,
          markInput.recipientUserId
        )
        .run();
      if (changedRows(result) === 0) {
        const existing = await readInboxItem({
          canManageOrganization: input.canManageOrganization,
          includeAccountItems: input.includeAccountItems,
          db: input.db,
          itemId: markInput.itemId,
          organizationId: markInput.organizationId,
          recipientUserId: markInput.recipientUserId,
        });
        if (!existing) {
          throw new InboxServiceError({
            code: INBOX_ITEM_NOT_FOUND_CODE,
            message: "Inbox item was not found.",
            status: 404,
          });
        }
        return { item: existing };
      }
      const item = await readInboxItem({
        canManageOrganization: input.canManageOrganization,
        includeAccountItems: input.includeAccountItems,
        db: input.db,
        itemId: markInput.itemId,
        organizationId: markInput.organizationId,
        recipientUserId: markInput.recipientUserId,
      });
      if (!item) {
        throw new Error("Inbox read mutation did not produce an item");
      }
      return { item };
    },

    async summary(summaryInput: {
      organizationId: string;
      presentation?: InboxPresentation;
      recipientUserId: string;
    }): Promise<InboxSummaryResponse> {
      requireIdentifier(summaryInput.organizationId, "organizationId");
      requireIdentifier(summaryInput.recipientUserId, "recipientUserId");
      const row = await input.db
        .prepare(
          `
            SELECT
              coalesce(sum(CASE WHEN read_at_ms IS NULL THEN 1 ELSE 0 END), 0)
                AS unread_count,
              coalesce(sum(CASE WHEN ${INBOX_PRIORITY} THEN 1 ELSE 0 END), 0) AS priority_count,
              coalesce(sum(CASE WHEN ${INBOX_OPEN_REVIEW} THEN 1 ELSE 0 END), 0) AS review_count,
              coalesce(sum(CASE WHEN ${INBOX_UNREAD_PRIORITY_UPDATE} THEN 1 ELSE 0 END), 0) AS priority_update_count,
              coalesce(sum(CASE
                WHEN attention = 'action_required' AND resolution_status = 'open'
                THEN 1 ELSE 0 END), 0) AS action_count,
              coalesce(sum(CASE WHEN ${UNREAD_URGENT_UPDATE_FILTER}
                THEN 1 ELSE 0 END), 0) AS urgent_update_count,
              coalesce(sum(CASE WHEN ${UNREAD_MENTION_UPDATE_FILTER}
                THEN 1 ELSE 0 END), 0) AS mention_count,
              coalesce(sum(CASE WHEN ${ORDINARY_UNREAD_ATTENTION_FILTER}
                THEN 1 ELSE 0 END), 0) AS ordinary_unread_count
            FROM inbox_items
            WHERE ${ITEM_SCOPE_FILTER}
              AND recipient_user_id = ?
              AND cleared_at_ms IS NULL
              AND ${CURRENT_SOURCE_ACCESS_FILTER}
              ${
                summaryInput.presentation === "attention"
                  ? `AND ${INBOX_ATTENTION_PRESENTATION_FILTER}`
                  : ""
              }
          `
        )
        .bind(summaryInput.organizationId, summaryInput.recipientUserId)
        .first<{
          action_count: number;
          priority_count: number;
          review_count: number;
          priority_update_count: number;
          mention_count: number;
          ordinary_unread_count: number;
          unread_count: number;
          urgent_update_count: number;
        }>();
      return {
        organizationId: summaryInput.organizationId,
        totalUnreadCount: countValue(row?.unread_count),
        unresolvedActionCount: countValue(row?.action_count),
        ...(input.includeAccountItems &&
        summaryInput.presentation === "attention"
          ? {
              priorityCount: countValue(row?.priority_count),
              needsReviewCount: countValue(row?.review_count),
              needsActionCount:
                countValue(row?.action_count) - countValue(row?.review_count),
              unreadPriorityUpdateCount: countValue(row?.priority_update_count),
            }
          : {}),
        unreadUrgentUpdateCount: countValue(row?.urgent_update_count),
        ...(summaryInput.presentation === "attention"
          ? {
              unreadMentionCount: countValue(row?.mention_count),
              ordinaryUnreadCount: countValue(row?.ordinary_unread_count),
            }
          : {}),
      };
    },

    async updatePreferences(preferenceInput: {
      urgentEmailEnabled: boolean;
      userId: string;
    }): Promise<InboxNotificationPreferencesResponse> {
      requireIdentifier(preferenceInput.userId, "userId");
      const timestamp = readNowMs(nowMs);
      await input.db
        .prepare(
          `
            INSERT INTO inbox_notification_preferences (
              user_id,
              urgent_email_enabled,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              urgent_email_enabled = excluded.urgent_email_enabled,
              updated_at_ms = excluded.updated_at_ms
          `
        )
        .bind(
          preferenceInput.userId,
          preferenceInput.urgentEmailEnabled ? 1 : 0,
          timestamp,
          timestamp
        )
        .run();
      return {
        updatedAt: new Date(timestamp).toISOString(),
        urgentEmailEnabled: preferenceInput.urgentEmailEnabled,
      };
    },
  };
}

async function markSpaceInboxReadThrough(input: {
  db: D1Database;
  invalidWatermarkMessage: string;
  itemScope: "center_agent" | "space";
  mutationDescription: string;
  nowMs: () => number;
  organizationId: string;
  recipientUserId: string;
  spaceId: string;
  threadRootSignalId?: string;
  throughOccurredAtMs: number;
  unavailableCode: string;
  unavailableMessage: string;
}): Promise<{ markedReadCount: number; readThroughAt: string }> {
  requireIdentifier(input.organizationId, "organizationId");
  requireIdentifier(input.recipientUserId, "recipientUserId");
  requireIdentifier(input.spaceId, "spaceId");
  if (input.threadRootSignalId !== undefined) {
    requireIdentifier(input.threadRootSignalId, "threadRootSignalId");
  }
  const timestamp = readNowMs(input.nowMs);
  if (
    !isReadPositionWithinAllowedFutureSkew({
      nowMs: timestamp,
      positionMs: input.throughOccurredAtMs,
    })
  ) {
    throw invalidInputError(input.invalidWatermarkMessage);
  }
  const centerAgentDesignationJoin =
    input.itemScope === "center_agent"
      ? `LEFT JOIN center_agent_designations AS center_agent_designation
          ON center_agent_designation.organization_id =
            inbox_space.organization_id`
      : "";
  const centerAgentSpaceFilter =
    input.itemScope === "center_agent"
      ? `inbox_space.space_purpose = ?
        AND inbox_space.direct_message_pair_key IN (
          center_agent_designation.agent_profile_id || ':' ||
            inbox_space_membership.profile_id,
          inbox_space_membership.profile_id || ':' ||
            center_agent_designation.agent_profile_id
        )`
      : "1 = 1";
  const membership = await input.db
    .prepare(
      `
        SELECT 1 AS allowed
        FROM space_index_spaces AS inbox_space
        INNER JOIN space_index_memberships AS inbox_space_membership
          ON inbox_space_membership.space_id = inbox_space.space_id
        ${centerAgentDesignationJoin}
        WHERE inbox_space.space_id = ?
          AND inbox_space.organization_id = ?
          AND inbox_space.status = 'active'
          AND inbox_space_membership.owner_user_id_snapshot = ?
          AND (inbox_space_membership.profile_kind_snapshot = 'human'
            OR (${input.itemScope === "space" ? personalAgentOwnerAccessSql("inbox_space.space_id", "inbox_space_membership.owner_user_id_snapshot") : "0"}))
          AND inbox_space_membership.status = 'active'
          AND ${centerAgentSpaceFilter}
        LIMIT 1
      `
    )
    .bind(
      input.spaceId,
      input.organizationId,
      input.recipientUserId,
      ...(input.itemScope === "center_agent"
        ? [OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE]
        : [])
    )
    .first<{ allowed: number }>();
  if (!membership) {
    throw new InboxServiceError({
      code: input.unavailableCode,
      message: input.unavailableMessage,
      status: 404,
    });
  }
  const itemTargetFilter =
    input.itemScope === "space"
      ? INBOX_SPACE_MESSAGE_FILTER
      : INBOX_CENTER_AGENT_MESSAGE_FILTER;
  const threadScoped =
    input.itemScope === "space" && input.threadRootSignalId !== undefined;
  let itemThreadFilter = "";
  if (input.itemScope === "space") {
    itemThreadFilter = threadScoped
      ? "AND json_extract(source_target_json, '$.threadRootSignalId') = ?"
      : "AND json_type(source_target_json, '$.threadRootSignalId') IS NULL";
  }
  const watermarkStatement = threadScoped
    ? input.db
        .prepare(
          `
            INSERT INTO inbox_space_thread_read_watermarks (
              organization_id,
              recipient_user_id,
              space_id,
              thread_root_signal_id,
              through_occurred_at_ms,
              read_at_ms,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(
              organization_id,
              recipient_user_id,
              space_id,
              thread_root_signal_id
            ) DO UPDATE SET
              through_occurred_at_ms = max(
                inbox_space_thread_read_watermarks.through_occurred_at_ms,
                excluded.through_occurred_at_ms
              ),
              read_at_ms = CASE
                WHEN excluded.through_occurred_at_ms >
                  inbox_space_thread_read_watermarks.through_occurred_at_ms
                THEN excluded.read_at_ms
                ELSE inbox_space_thread_read_watermarks.read_at_ms
              END,
              updated_at_ms = max(
                inbox_space_thread_read_watermarks.updated_at_ms,
                excluded.updated_at_ms
              )
          `
        )
        .bind(
          input.organizationId,
          input.recipientUserId,
          input.spaceId,
          input.threadRootSignalId,
          input.throughOccurredAtMs,
          timestamp,
          timestamp,
          timestamp
        )
    : input.db
        .prepare(
          `
            INSERT INTO inbox_center_agent_read_watermarks (
              organization_id,
              recipient_user_id,
              space_id,
              through_occurred_at_ms,
              read_at_ms,
              created_at_ms,
              updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(organization_id, recipient_user_id, space_id)
            DO UPDATE SET
              through_occurred_at_ms = max(
                inbox_center_agent_read_watermarks.through_occurred_at_ms,
                excluded.through_occurred_at_ms
              ),
              read_at_ms = CASE
                WHEN excluded.through_occurred_at_ms >
                  inbox_center_agent_read_watermarks.through_occurred_at_ms
                THEN excluded.read_at_ms
                ELSE inbox_center_agent_read_watermarks.read_at_ms
              END,
              updated_at_ms = max(
                inbox_center_agent_read_watermarks.updated_at_ms,
                excluded.updated_at_ms
              )
          `
        )
        .bind(
          input.organizationId,
          input.recipientUserId,
          input.spaceId,
          input.throughOccurredAtMs,
          timestamp,
          timestamp,
          timestamp
        );
  const [, itemResult] = await input.db.batch([
    watermarkStatement,
    input.db
      .prepare(
        `
          UPDATE inbox_items
          SET
            read_at_ms = coalesce(read_at_ms, ?),
            updated_at_ms = max(updated_at_ms, ?)
          WHERE organization_id = ?
            AND recipient_user_id = ?
            AND cleared_at_ms IS NULL
            AND read_at_ms IS NULL
            AND occurred_at_ms <= ?
            AND ${itemTargetFilter}
            AND json_extract(source_target_json, '$.spaceId') = ?
            ${itemThreadFilter}
            AND ${CURRENT_SOURCE_ACCESS_FILTER}
        `
      )
      .bind(
        timestamp,
        timestamp,
        input.organizationId,
        input.recipientUserId,
        input.throughOccurredAtMs,
        input.spaceId,
        ...(threadScoped ? [input.threadRootSignalId as string] : [])
      ),
  ]);
  if (!itemResult) {
    throw new Error(`${input.mutationDescription} did not return a result`);
  }
  return {
    markedReadCount: changedRows(itemResult),
    readThroughAt: toIsoTimestamp(timestamp, "read_at_ms"),
  };
}

async function hasAccessibleInboxItem(input: {
  canManageOrganization?: boolean;
  includeAccountItems?: boolean;
  db: D1Database;
  itemId: string;
  organizationId: string;
  recipientUserId: string;
}): Promise<boolean> {
  const CURRENT_SOURCE_ACCESS_FILTER = buildCurrentInboxSourceAccessSql(
    "inbox_items",
    input.canManageOrganization === true
  );
  const row = await input.db
    .prepare(
      `
        SELECT id
        FROM inbox_items
        WHERE id = ?
          AND ${inboxItemScopeSql(input.includeAccountItems)}
          AND recipient_user_id = ?
          AND ${CURRENT_SOURCE_ACCESS_FILTER}
        LIMIT 1
      `
    )
    .bind(input.itemId, input.organizationId, input.recipientUserId)
    .first<{ id: string }>();
  return row !== null;
}

async function readInboxItem(input: {
  canManageOrganization?: boolean;
  includeAccountItems?: boolean;
  db: D1Database;
  itemId: string;
  organizationId: string;
  recipientUserId: string;
}): Promise<InboxItem | null> {
  const CURRENT_SOURCE_ACCESS_FILTER = buildCurrentInboxSourceAccessSql(
    "inbox_items",
    input.canManageOrganization === true
  );
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          recipient_user_id,
          kind,
          attention,
          importance,
          title,
          preview,
          context_label,
          source_kind,
          source_key,
          source_target_json,
          ${currentInboxSourceFactsSql("inbox_items")} AS source_facts_json,
          resolution_status,
          read_at_ms,
          occurred_at_ms,
          created_at_ms,
          updated_at_ms
        FROM inbox_items
        WHERE id = ?
          AND ${inboxItemScopeSql(input.includeAccountItems)}
          AND recipient_user_id = ?
          AND cleared_at_ms IS NULL
          AND ${CURRENT_SOURCE_ACCESS_FILTER}
        LIMIT 1
      `
    )
    .bind(input.itemId, input.organizationId, input.recipientUserId)
    .first<InboxItemRow>();
  return row ? mapInboxItemRow(row) : null;
}

function inboxItemScopeSql(includeAccountItems = false): string {
  return includeAccountItems
    ? "(organization_id = ? OR organization_id IS NULL)"
    : "organization_id = ?";
}

export function mapInboxItemRow(row: InboxItemRow): InboxItem {
  let sourceTargetValue: unknown;
  try {
    sourceTargetValue = JSON.parse(row.source_target_json);
  } catch (error) {
    throw new Error(`Inbox item ${row.id} has invalid source target JSON`, {
      cause: error,
    });
  }
  const sourceTarget = inboxSourceTargetSchema.safeParse(sourceTargetValue);
  if (!sourceTarget.success) {
    throw new Error(`Inbox item ${row.id} has an invalid source target`, {
      cause: sourceTarget.error,
    });
  }
  const sourceFacts = row.source_facts_json
    ? JSON.parse(row.source_facts_json)
    : undefined;
  let target = sourceTarget.data;
  // The retired continuation producer put a child result id in its parent's
  // Space. Old rows may never be replayed by that producer. Correct only their
  // reader presentation, after source authorization; preserve stored evidence,
  // recipient choices and action counts until explicit Dismiss/source repair.
  const legacyContinuation =
    row.source_kind === "remote_agent_native_delivery" &&
    row.source_key.endsWith(":admission_retry_exhausted") &&
    row.kind === "system_issue" &&
    row.attention === "action_required" &&
    row.importance === "urgent" &&
    target.kind === "space";
  if (legacyContinuation && target.kind === "space") {
    const { signalId: _misplacedSignalId, ...conversationTarget } = target;
    target = conversationTarget;
  }
  if (
    sourceFacts &&
    target.kind === "space" &&
    !sourceFacts.personalAgentProfileIds?.length
  ) {
    const { agentOwnerActivity: _ownerActivity, ...currentTarget } = target;
    target = currentTarget;
  }
  return inboxItemSchema.parse({
    attention: row.attention,
    contextLabel: row.context_label,
    createdAt: toIsoTimestamp(row.created_at_ms, "created_at_ms"),
    id: row.id,
    importance: row.importance,
    kind: row.kind,
    occurredAt: toIsoTimestamp(row.occurred_at_ms, "occurred_at_ms"),
    organizationId: row.organization_id,
    preview: legacyContinuation
      ? "An earlier attempt to continue this task ended without a confirmed reply. Open the conversation to review the outcome, or remove this reminder from Inbox."
      : row.preview,
    readAt:
      row.read_at_ms === null
        ? null
        : toIsoTimestamp(row.read_at_ms, "read_at_ms"),
    recipientUserId: row.recipient_user_id,
    resolutionStatus: row.resolution_status,
    ...(sourceFacts ? { sourceFacts } : {}),
    sourceTarget: target,
    title: row.title,
    updatedAt: toIsoTimestamp(row.updated_at_ms, "updated_at_ms"),
  });
}

// Disjoint from open actions: an urgent action is counted once, as an action.
const UNREAD_URGENT_UPDATE_FILTER =
  "importance = 'urgent' AND attention = 'update' AND resolution_status != 'resolved' AND read_at_ms IS NULL";
const UNREAD_MENTION_UPDATE_FILTER = `(${inboxMentionSql()}) AND importance = 'normal' AND attention = 'update' AND read_at_ms IS NULL`;
const LEGACY_UNREAD_MENTION_UPDATE_FILTER =
  "kind IN ('space_mention', 'space_reference') AND importance = 'normal' AND attention = 'update' AND read_at_ms IS NULL";
const ORDINARY_UNREAD_ATTENTION_FILTER = `
  read_at_ms IS NULL
  AND NOT (attention = 'action_required' AND resolution_status = 'open')
  AND NOT (${UNREAD_URGENT_UPDATE_FILTER})
  AND NOT (${UNREAD_MENTION_UPDATE_FILTER})
`;

function appendViewFilter(
  filters: string[],
  view: InboxView,
  presentation?: InboxPresentation
): void {
  if (view === "unread") {
    filters.push("read_at_ms IS NULL");
  } else if (view === "needs_action") {
    filters.push(
      "attention = 'action_required'",
      "resolution_status = 'open'",
      "kind NOT IN ('document_review', 'organization_request')"
    );
  } else if (view === "needs_review") {
    filters.push(
      "attention = 'action_required'",
      "resolution_status = 'open'",
      "kind IN ('document_review', 'organization_request')"
    );
  } else if (view === "mentions") {
    filters.push(
      presentation === "attention"
        ? UNREAD_MENTION_UPDATE_FILTER
        : LEGACY_UNREAD_MENTION_UPDATE_FILTER
    );
  } else if (view === "urgent_updates") {
    filters.push(UNREAD_URGENT_UPDATE_FILTER);
  } else if (view === "recent_updates") {
    filters.push(
      "read_at_ms IS NULL",
      "NOT (attention = 'action_required' AND resolution_status = 'open')",
      `NOT (${UNREAD_URGENT_UPDATE_FILTER})`
    );
    if (presentation === "attention") {
      filters.push(`NOT (${UNREAD_MENTION_UPDATE_FILTER})`);
    }
  } else if (view === "updates") {
    filters.push(
      "NOT (attention = 'action_required' AND resolution_status = 'open')"
    );
  }
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? INBOX_LIST_DEFAULT_LIMIT;
  if (
    !(
      Number.isSafeInteger(limit) &&
      limit >= 1 &&
      limit <= INBOX_LIST_MAX_LIMIT
    )
  ) {
    throw invalidInputError("Inbox list limit is invalid.");
  }
  return limit;
}

function encodeCursor(cursor: InboxListCursor): string {
  const json = JSON.stringify(cursor);
  return bytesToBase64Url(new TextEncoder().encode(json));
}

function decodeCursor(value: string | undefined): InboxListCursor | null {
  if (value === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(value))
    ) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("id" in parsed) ||
      !("occurredAtMs" in parsed) ||
      typeof parsed.id !== "string" ||
      !parsed.id.trim() ||
      parsed.id.length > 256 ||
      !Number.isSafeInteger(parsed.occurredAtMs) ||
      (parsed.occurredAtMs as number) < 0
    ) {
      throw new Error("Cursor payload is invalid");
    }
    return { id: parsed.id, occurredAtMs: parsed.occurredAtMs as number };
  } catch {
    throw new InboxServiceError({
      code: INBOX_INVALID_CURSOR_CODE,
      message: "Inbox cursor is invalid.",
      status: 400,
    });
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64_URL_PATTERN.test(value)) {
    throw new Error("Cursor is not base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function changedRows(result: D1Result<unknown>): number {
  return Math.max(0, Math.trunc(Number(result.meta.changes ?? 0)));
}

function countValue(value: unknown): number {
  return nonnegativeIntegerValue(value ?? 0);
}

function nonnegativeIntegerValue(value: unknown): number {
  const numberValue = Number(value);
  if (!(Number.isSafeInteger(numberValue) && numberValue >= 0)) {
    throw new Error("Inbox nonnegative integer projection is invalid");
  }
  return numberValue;
}

function readNowMs(nowMs: () => number): number {
  const value = nowMs();
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Inbox clock returned an invalid timestamp");
  }
  return value;
}

function requireIdentifier(value: string, fieldName: string): void {
  if (!(value.trim() && value.length <= 256)) {
    throw invalidInputError(`${fieldName} must be a non-empty identifier.`);
  }
}

function invalidInputError(message: string): InboxServiceError {
  return new InboxServiceError({
    code: "inbox.invalid_input",
    message,
    status: 400,
  });
}

function toIsoTimestamp(value: number, fieldName: string): string {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error(`Inbox ${fieldName} is invalid`);
  }
  return new Date(value).toISOString();
}
