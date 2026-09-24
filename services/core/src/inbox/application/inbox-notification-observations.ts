import {
  inboxNotificationObservationCursorSchema,
  inboxNotificationObservationsQuerySchema,
} from "@openmeld/schemas";
import type {
  InboxNotificationObservationCursor as Cursor,
  InboxNotificationObservationsQuery,
  InboxNotificationObservationsResponse,
} from "@openmeld/schemas/types";
import { currentInboxSourceFactsSql } from "./inbox-current-source-facts";
import {
  type InboxItemRow,
  InboxServiceError,
  mapInboxItemRow,
} from "./inbox-service";
import { buildCurrentInboxSourceAccessSql } from "./inbox-source-access";

type Identity = { organizationId: string; recipientUserId: string };

/** Uses the existing soft-cleared Inbox ledger. A cursor is an in-memory
 * observation position, never authority, a persisted receipt, or read state.
 * Insertion order is required: delayed outbox arrivals may have old occurredAt. */
export async function observeInboxNotifications(
  input: Identity &
    InboxNotificationObservationsQuery & {
      db: D1Database;
      canManageOrganization?: boolean;
    }
): Promise<InboxNotificationObservationsResponse> {
  const query = inboxNotificationObservationsQuerySchema.parse({
    cursor: input.cursor,
    limit: input.limit,
  });
  const identity = {
    organizationId: input.organizationId,
    recipientUserId: input.recipientUserId,
  };
  const scope =
    "(organization_id = ? OR organization_id IS NULL) AND recipient_user_id = ?";
  const previous = query.cursor ? decodeCursor(query.cursor, identity) : null;
  let throughRowId = previous?.throughRowId ?? 0;
  if (!previous || previous.afterRowId === previous.throughRowId) {
    const row = await input.db
      .prepare(
        `SELECT coalesce(max(rowid), 0) AS last_row_id FROM inbox_items WHERE ${scope}`
      )
      .bind(identity.organizationId, identity.recipientUserId)
      .first<{ last_row_id: number }>();
    if (
      !(row && Number.isSafeInteger(row.last_row_id)) ||
      row.last_row_id < throughRowId
    ) {
      throw new InboxServiceError({
        code: "inbox.observation_unavailable",
        message:
          "Inbox observation position is unavailable. Reload to reconnect.",
        status: 409,
      });
    }
    throughRowId = row.last_row_id;
  }
  if (!previous) {
    return {
      organizationId: identity.organizationId,
      items: [],
      hasMore: false,
      cursor: encodeCursor({
        ...identity,
        version: 1,
        afterRowId: throughRowId,
        throughRowId,
      }),
    };
  }
  if (query.cursor && throughRowId === previous.afterRowId) {
    // Most visible-window polls are empty. The maximum row ID already proves
    // there is no new page to hydrate or access-check.
    return {
      organizationId: identity.organizationId,
      items: [],
      hasMore: false,
      cursor: query.cursor,
    };
  }
  const limit = query.limit ?? 50;
  const access = buildCurrentInboxSourceAccessSql(
    "inbox_items",
    input.canManageOrganization === true
  );
  const result = await input.db
    .prepare(`SELECT rowid AS observation_row_id,
      id, organization_id, recipient_user_id, kind, attention, importance,
      title, preview, context_label, source_target_json, resolution_status,
      read_at_ms, occurred_at_ms, created_at_ms, updated_at_ms,
      ${currentInboxSourceFactsSql("inbox_items")} AS source_facts_json
    FROM inbox_items WHERE ${scope} AND rowid > ? AND rowid <= ?
      AND cleared_at_ms IS NULL AND ${access}
    ORDER BY rowid ASC LIMIT ?`)
    .bind(
      identity.organizationId,
      identity.recipientUserId,
      previous.afterRowId,
      throughRowId,
      limit + 1
    )
    .all<InboxItemRow & { observation_row_id: number }>();
  const rows = result.results ?? [];
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return {
    organizationId: identity.organizationId,
    items: page.map(mapInboxItemRow),
    hasMore,
    cursor: encodeCursor({
      ...identity,
      version: 1,
      throughRowId,
      afterRowId: hasMore
        ? (page.at(-1)?.observation_row_id ?? previous.afterRowId)
        : throughRowId,
    }),
  };
}

function encodeCursor(cursor: Cursor): string {
  return btoa(encodeURIComponent(JSON.stringify(cursor)));
}

function decodeCursor(value: string, identity: Identity): Cursor {
  try {
    const cursor = inboxNotificationObservationCursorSchema.parse(
      JSON.parse(decodeURIComponent(atob(value)))
    );
    if (
      cursor.organizationId === identity.organizationId &&
      cursor.recipientUserId === identity.recipientUserId
    ) {
      return cursor;
    }
  } catch {
    // A client-selected or stale position cannot broaden the authenticated scope.
  }
  throw new InboxServiceError({
    code: "inbox.cursor_invalid",
    message:
      "Inbox notification cursor is invalid for this account and workspace.",
    status: 400,
  });
}
