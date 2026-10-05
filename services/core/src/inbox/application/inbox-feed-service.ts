import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  inboxFeedQuerySchema,
  inboxFeedResponseSchema,
  mutateInboxFeedBodySchema,
} from "@openmeld/schemas";
import type {
  InboxFeedCounts,
  InboxFeedQuery,
  InboxFeedResponse,
  InboxFeedRow,
  MutateInboxFeedBody,
} from "@openmeld/schemas/types";
import {
  decodeInboxFeedCursor,
  decodeInboxFeedKey,
  encodeInboxFeedCursor,
  encodeInboxFeedKey,
  type InboxFeedCursor,
  invalidInboxFeedCursor,
} from "./inbox-feed-cursor";
import {
  INBOX_FEED_COUNTS_SQL,
  type InboxFeedScope,
  inboxFeedCte,
  inboxFeedRowsSql,
} from "./inbox-feed-query";
import {
  type InboxItemRow,
  InboxServiceError,
  mapInboxItemRow,
} from "./inbox-service";

type Identity = {
  organizationId: string;
  recipientUserId: string;
};
type Snapshot = InboxFeedScope & {
  id: string;
  expiresAtMs: number;
};
type SnapshotRow = {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  category: InboxFeedScope["category"];
  unread_only: number;
  agents_only: number;
  people_only: number;
  conversation_type: InboxFeedScope["conversationType"];
  through_row_id: number;
  expires_at_ms: number;
};
type FeedItemRow = InboxItemRow & {
  current_source_facts: string | null;
  raw_group_key: string;
  sort_key: string;
  section_rank: number;
  item_count: number;
  unread_count: number;
  latest_occurred_at_ms: number;
  request_category: "action" | "review" | null;
  conversation_count: number;
};
type CountRow = {
  selection_unread_count: number;
  all_count: number;
  mention_count: number;
  action_count: number;
  review_count: number;
  unread_count: number;
  priority_count: number;
};
const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export function createInboxFeedService(input: {
  db: PostgresDatabase;
  nowMs?: () => number;
  canManageOrganization?: boolean;
}) {
  const now = input.nowMs ?? Date.now;
  async function readSnapshot(
    identity: Identity,
    id: string
  ): Promise<Snapshot> {
    const row = await input.db
      .query<SnapshotRow>({
        text: `SELECT * FROM "openmeld"."inbox_feed_snapshots"
      WHERE id = $1 AND organization_id = $2 AND recipient_user_id = $3 AND expires_at_ms > $4`,
        values: [id, identity.organizationId, identity.recipientUserId, now()],
      })
      .then((result) => result.rows[0] ?? null);
    if (!row) {
      throw new InboxServiceError({
        code: "inbox.snapshot_expired",
        status: 409,
        message:
          "This Inbox view has expired. Refresh before changing its items.",
      });
    }
    return mapSnapshot(row);
  }
  function mapSnapshot(row: SnapshotRow): Snapshot {
    return {
      id: row.id,
      organizationId: row.organization_id,
      recipientUserId: row.recipient_user_id,
      category: row.category,
      unreadOnly: row.unread_only === 1,
      agentsOnly: row.agents_only === 1,
      peopleOnly: row.people_only === 1,
      conversationType: row.conversation_type,
      throughRowId: row.through_row_id,
      expiresAtMs: row.expires_at_ms,
      snapshotId: row.id,
    };
  }
  function createSnapshot(
    identity: Identity,
    query: InboxFeedQuery
  ): Promise<Snapshot> {
    const id = crypto.randomUUID();
    const created = now();
    const seedScope = {
      ...identity,
      category: query.category ?? "all",
      unreadOnly: query.unreadOnly === "true",
      agentsOnly: query.agentsOnly === "true",
      peopleOnly: query.peopleOnly === "true",
      conversationType: query.conversationType ?? "all",
      throughRowId: Number.MAX_SAFE_INTEGER,
    } as const;
    const cte = inboxFeedCte(seedScope, input.canManageOrganization === true);
    // One statement is atomic and shares one MVCC snapshot. RETURNING links
    // the header to its members without five serial transaction round trips.
    return input.db
      .query<SnapshotRow>({
        text: `${cte.sql},
        expired AS (
          DELETE FROM "openmeld"."inbox_feed_snapshots"
          WHERE id IN (SELECT id FROM "openmeld"."inbox_feed_snapshots" WHERE expires_at_ms <= $10 LIMIT 100)
        ), header AS (
          INSERT INTO "openmeld"."inbox_feed_snapshots"
          (id, organization_id, recipient_user_id, category, unread_only, agents_only, people_only, conversation_type, through_row_id, created_at_ms, expires_at_ms)
          SELECT $4, $1, $2, $5, $6, $7, $8, $9, coalesce(max(sequence), 0), $10, $11
          FROM "openmeld"."inbox_items" RETURNING *
        ), members AS (
          INSERT INTO "openmeld"."inbox_feed_snapshot_members" (snapshot_id, item_id)
          SELECT header.id, filtered.id FROM filtered CROSS JOIN header
        )
        SELECT * FROM header`,
        values: [
          ...cte.bindings,
          id,
          query.category ?? "all",
          query.unreadOnly === "true" ? 1 : 0,
          query.agentsOnly === "true" ? 1 : 0,
          query.peopleOnly === "true" ? 1 : 0,
          query.conversationType ?? "all",
          created,
          created + SNAPSHOT_TTL_MS,
        ],
      })
      .then(({ rows }) => {
        const row = rows[0];
        if (!row) {
          throw new Error("Inbox snapshot insert did not return its header");
        }
        return mapSnapshot(row);
      });
  }
  return {
    async list(
      identity: Identity,
      rawQuery: InboxFeedQuery = {}
    ): Promise<InboxFeedResponse> {
      const query = inboxFeedQuerySchema.parse(rawQuery);
      const cursor = decodeInboxFeedCursor(query.cursor);
      const snapshotId = query.snapshotId ?? cursor?.snapshotId;
      if (query.groupKey && !snapshotId) {
        throw invalidInboxFeedCursor();
      }
      const snapshot = snapshotId
        ? await readSnapshot(identity, snapshotId)
        : await createSnapshot(identity, query);
      assertMatchingSnapshot(snapshot, query, cursor);
      const cte = inboxFeedCte(
        snapshot,
        input.canManageOrganization === true,
        true
      );
      const limit = query.limit ?? 40;
      const expandedKey = query.groupKey
        ? decodeInboxFeedKey(query.groupKey)
        : undefined;
      const collectionKind = expandedKey
        ? readGroupKind(expandedKey)
        : undefined;
      const result = await input.db.query<
        FeedItemRow & { feed_counts: CountRow }
      >({
        text: `${cte.sql}, feed_counts AS (${INBOX_FEED_COUNTS_SQL}) ${inboxFeedRowsSql(Boolean(query.groupKey), query.grouping, collectionKind, cte.bindings.length)}`,
        values: [
          ...cte.bindings,
          ...(expandedKey ? [expandedKey] : []),
          ...cursorBindings(cursor),
          limit + 1,
        ],
      });
      const { counts, candidates, selectionUnreadCount } = readQueryResults(
        result.rows
      );
      const page = candidates.slice(0, limit);
      return inboxFeedResponseSchema.parse({
        organizationId: identity.organizationId,
        snapshotId: snapshot.id,
        snapshotExpiresAt: new Date(snapshot.expiresAtMs).toISOString(),
        counts,
        ...selectionCountProjection(query, selectionUnreadCount),
        rows: page.map((row) => mapFeedRow(row, query.grouping)),
        nextCursor: nextPageCursor(candidates, limit, snapshot.id, query),
      });
    },
    async mutate(
      identity: Identity,
      rawBody: MutateInboxFeedBody
    ): Promise<{
      changedCount: number;
    }> {
      const body = mutateInboxFeedBodySchema.parse(rawBody);
      const snapshot = await readSnapshot(identity, body.snapshotId);
      const cte = inboxFeedCte(snapshot, input.canManageOrganization === true);
      const timestamp = now();
      const column = body.operation === "read" ? "read_at_ms" : "cleared_at_ms";
      const result = await input.db.query({
        text: `${cte.sql}
        UPDATE "openmeld"."inbox_items" SET ${column} = GREATEST($5, created_at_ms), updated_at_ms = GREATEST($6, updated_at_ms)
        WHERE ${column} IS NULL AND id IN (SELECT id FROM selected ${body.groupKey ? "WHERE raw_group_key = $7 OR collection_key = $8 OR json_build_array('conversation_group', raw_group_key, collection_key)::text = $9" : ""})`,
        values: [
          ...cte.bindings,
          timestamp,
          timestamp,
          ...(body.groupKey
            ? [
                decodeInboxFeedKey(body.groupKey),
                decodeInboxFeedKey(body.groupKey),
                decodeInboxFeedKey(body.groupKey),
              ]
            : []),
        ],
      });
      return { changedCount: Math.max(0, Number(result.rowCount ?? 0)) };
    },
  };
}
function selectionCountProjection(
  query: InboxFeedQuery,
  selectionUnreadCount: number
) {
  return query.includeSelectionUnreadCount === "true"
    ? { selectionUnreadCount }
    : {};
}
function assertMatchingSnapshot(
  snapshot: Snapshot,
  query: InboxFeedQuery,
  cursor: InboxFeedCursor | null
): void {
  if (
    snapshot.category !== (query.category ?? "all") ||
    snapshot.unreadOnly !== (query.unreadOnly === "true") ||
    snapshot.agentsOnly !== (query.agentsOnly === "true") ||
    snapshot.peopleOnly !== (query.peopleOnly === "true") ||
    snapshot.conversationType !== (query.conversationType ?? "all")
  ) {
    throw invalidInboxFeedCursor();
  }
  if (
    cursor &&
    (cursor.snapshotId !== snapshot.id ||
      cursor.grouping !== query.grouping ||
      cursor.expandedGroup !== (query.groupKey ?? null))
  ) {
    throw invalidInboxFeedCursor();
  }
}
function readQueryResults(
  rows: Array<FeedItemRow & { feed_counts: CountRow }>
): {
  selectionUnreadCount: number;
  counts: InboxFeedCounts;
  candidates: FeedItemRow[];
} {
  const countRow = rows[0]?.feed_counts;
  if (!countRow) {
    throw new Error("Inbox query did not return a complete snapshot page");
  }
  return {
    selectionUnreadCount: Number(countRow.selection_unread_count),
    counts: mapCounts(countRow),
    candidates: rows.filter((row) => row.id !== null),
  };
}
function cursorBindings(cursor: InboxFeedCursor | null) {
  const rank = cursor?.rank ?? null;
  const occurredAt = cursor?.occurredAtMs ?? null;
  return [rank, rank, rank, occurredAt, rank, occurredAt, cursor?.key ?? null];
}
function nextPageCursor(
  rows: FeedItemRow[],
  limit: number,
  snapshotId: string,
  query: InboxFeedQuery
) {
  const last = rows[limit - 1];
  if (rows.length <= limit || !last) {
    return null;
  }
  return encodeInboxFeedCursor({
    snapshotId,
    rank: last.section_rank,
    occurredAtMs: last.latest_occurred_at_ms,
    key: last.sort_key,
    expandedGroup: query.groupKey ?? null,
    ...(query.grouping ? { grouping: query.grouping } : {}),
  });
}
function feedSection(rank: number): InboxFeedRow["section"] {
  if (rank === 0) {
    return "priority";
  }
  return rank === 1 ? "open" : "activity";
}
function feedDot(rank: number, unreadCount: number): InboxFeedRow["dot"] {
  if (rank === 0) {
    return "yellow";
  }
  return unreadCount > 0 ? "blue" : null;
}
function mapCounts(row?: CountRow): InboxFeedCounts {
  return {
    all: Number(row?.all_count ?? 0),
    mentions: Number(row?.mention_count ?? 0),
    needsAction: Number(row?.action_count ?? 0),
    needsReview: Number(row?.review_count ?? 0),
    unread: Number(row?.unread_count ?? 0),
    priority: Number(row?.priority_count ?? 0),
  };
}
function mapFeedRow(row: FeedItemRow, grouping?: "space"): InboxFeedRow {
  const item = mapInboxItemRow({
    ...row,
    source_facts_json: row.current_source_facts,
  });
  return {
    groupKey: encodeInboxFeedKey(grouping ? row.sort_key : row.raw_group_key),
    item,
    itemCount: row.item_count,
    unreadCount: row.unread_count,
    latestOccurredAt: new Date(row.latest_occurred_at_ms).toISOString(),
    section: feedSection(row.section_rank),
    requestCategory: row.request_category,
    dot: feedDot(row.section_rank, row.unread_count),
    ...groupProjection(row, grouping),
  };
}
function groupProjection(
  row: FeedItemRow,
  grouping?: "space"
): Pick<InboxFeedRow, "group"> {
  if (!grouping) {
    return {};
  }
  const kind = readGroupKind(row.sort_key);
  if (kind === "space" || kind === "system") {
    return { group: { kind, conversationCount: row.conversation_count } };
  }
  if (kind === "conversation_group") {
    return { group: { kind: "conversation", conversationCount: 1 } };
  }
  return {};
}
function readGroupKind(key: string): string {
  try {
    const parts: unknown = JSON.parse(key);
    if (Array.isArray(parts) && typeof parts[0] === "string") {
      return parts[0];
    }
  } catch {
    // Opaque client keys must not escape as JSON parse failures.
  }
  throw invalidInboxFeedCursor();
}
