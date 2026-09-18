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

type Identity = { organizationId: string; recipientUserId: string };
type Snapshot = InboxFeedScope & { id: string; expiresAtMs: number };
type SnapshotRow = {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  category: InboxFeedScope["category"];
  unread_only: number;
  agents_only: number;
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
};
type CountRow = {
  all_count: number;
  mention_count: number;
  action_count: number;
  review_count: number;
  unread_count: number;
  priority_count: number;
};
const SNAPSHOT_TTL_MS = 15 * 60 * 1000;

export function createInboxFeedService(input: {
  db: D1Database;
  nowMs?: () => number;
  canManageOrganization?: boolean;
}) {
  const now = input.nowMs ?? Date.now;

  async function readSnapshot(
    identity: Identity,
    id: string
  ): Promise<Snapshot> {
    const row = await input.db
      .prepare(`SELECT * FROM inbox_feed_snapshots
      WHERE id = ? AND organization_id = ? AND recipient_user_id = ? AND expires_at_ms > ?`)
      .bind(id, identity.organizationId, identity.recipientUserId, now())
      .first<SnapshotRow>();
    if (!row) {
      throw new InboxServiceError({
        code: "inbox.snapshot_expired",
        status: 409,
        message:
          "This Inbox view has expired. Refresh before changing its items.",
      });
    }
    return {
      id: row.id,
      organizationId: row.organization_id,
      recipientUserId: row.recipient_user_id,
      category: row.category,
      unreadOnly: row.unread_only === 1,
      agentsOnly: row.agents_only === 1,
      throughRowId: row.through_row_id,
      expiresAtMs: row.expires_at_ms,
      snapshotId: row.id,
    };
  }

  async function createSnapshot(
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
      throughRowId: Number.MAX_SAFE_INTEGER,
    } as const;
    const cte = inboxFeedCte(seedScope, input.canManageOrganization === true);
    await input.db.batch([
      input.db
        .prepare(
          "DELETE FROM inbox_feed_snapshots WHERE id IN (SELECT id FROM inbox_feed_snapshots WHERE expires_at_ms <= ? LIMIT 100)"
        )
        .bind(created),
      input.db
        .prepare(`INSERT INTO inbox_feed_snapshots
        (id, organization_id, recipient_user_id, category, unread_only, agents_only, through_row_id, created_at_ms, expires_at_ms)
        SELECT ?, ?, ?, ?, ?, ?, coalesce(max(rowid), 0), ?, ? FROM inbox_items`)
        .bind(
          id,
          identity.organizationId,
          identity.recipientUserId,
          query.category ?? "all",
          query.unreadOnly === "true" ? 1 : 0,
          query.agentsOnly === "true" ? 1 : 0,
          created,
          created + SNAPSHOT_TTL_MS
        ),
      input.db
        .prepare(`${cte.sql} INSERT INTO inbox_feed_snapshot_members (snapshot_id, item_id)
        SELECT ?, id FROM filtered`)
        .bind(...cte.bindings, id),
    ]);
    return readSnapshot(identity, id);
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
      const cte = inboxFeedCte(snapshot, input.canManageOrganization === true);
      const limit = query.limit ?? 40;
      const results = await input.db.batch([
        input.db
          .prepare(`${cte.sql} ${INBOX_FEED_COUNTS_SQL}`)
          .bind(...cte.bindings),
        input.db
          .prepare(`${cte.sql} ${inboxFeedRowsSql(Boolean(query.groupKey))}`)
          .bind(
            ...cte.bindings,
            ...(query.groupKey ? [decodeInboxFeedKey(query.groupKey)] : []),
            cursor?.rank ?? null,
            cursor?.rank ?? null,
            cursor?.rank ?? null,
            cursor?.occurredAtMs ?? null,
            cursor?.rank ?? null,
            cursor?.occurredAtMs ?? null,
            cursor?.key ?? null,
            limit + 1
          ),
      ]);
      const { counts, candidates } = readQueryResults(results);
      const page = candidates.slice(0, limit);
      const last = page.at(-1);
      return inboxFeedResponseSchema.parse({
        organizationId: identity.organizationId,
        snapshotId: snapshot.id,
        snapshotExpiresAt: new Date(snapshot.expiresAtMs).toISOString(),
        counts,
        rows: page.map(mapFeedRow),
        nextCursor:
          candidates.length > limit && last
            ? encodeInboxFeedCursor({
                snapshotId: snapshot.id,
                rank: last.section_rank,
                occurredAtMs: last.latest_occurred_at_ms,
                key: last.sort_key,
                expandedGroup: query.groupKey ?? null,
              })
            : null,
      });
    },

    async mutate(
      identity: Identity,
      rawBody: MutateInboxFeedBody
    ): Promise<{ changedCount: number }> {
      const body = mutateInboxFeedBodySchema.parse(rawBody);
      const snapshot = await readSnapshot(identity, body.snapshotId);
      const cte = inboxFeedCte(snapshot, input.canManageOrganization === true);
      const timestamp = now();
      const column = body.operation === "read" ? "read_at_ms" : "cleared_at_ms";
      const result = await input.db
        .prepare(`${cte.sql}
        UPDATE inbox_items SET ${column} = max(?, created_at_ms), updated_at_ms = max(?, updated_at_ms)
        WHERE ${column} IS NULL AND id IN (SELECT id FROM selected ${body.groupKey ? "WHERE raw_group_key = ?" : ""})`)
        .bind(
          ...cte.bindings,
          timestamp,
          timestamp,
          ...(body.groupKey ? [decodeInboxFeedKey(body.groupKey)] : [])
        )
        .run();
      return { changedCount: Math.max(0, Number(result.meta.changes ?? 0)) };
    },
  };
}

function assertMatchingSnapshot(
  snapshot: Snapshot,
  query: InboxFeedQuery,
  cursor: InboxFeedCursor | null
): void {
  if (
    snapshot.category !== (query.category ?? "all") ||
    snapshot.unreadOnly !== (query.unreadOnly === "true") ||
    snapshot.agentsOnly !== (query.agentsOnly === "true")
  ) {
    throw invalidInboxFeedCursor();
  }
  if (
    cursor &&
    (cursor.snapshotId !== snapshot.id ||
      cursor.expandedGroup !== (query.groupKey ?? null))
  ) {
    throw invalidInboxFeedCursor();
  }
}

function readQueryResults(results: D1Result[]): {
  counts: InboxFeedCounts;
  candidates: FeedItemRow[];
} {
  const [countResult, pageResult] = results;
  if (
    !(
      countResult?.success &&
      pageResult?.success &&
      Array.isArray(countResult.results) &&
      Array.isArray(pageResult.results) &&
      countResult.results.length === 1
    )
  ) {
    throw new Error("Inbox query did not return a complete snapshot page");
  }
  return {
    counts: mapCounts(countResult.results[0] as CountRow),
    candidates: pageResult.results as FeedItemRow[],
  };
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

function mapFeedRow(row: FeedItemRow): InboxFeedRow {
  const item = mapInboxItemRow({
    ...row,
    source_facts_json: row.current_source_facts,
  });
  return {
    groupKey: encodeInboxFeedKey(row.raw_group_key),
    item,
    itemCount: row.item_count,
    unreadCount: row.unread_count,
    latestOccurredAt: new Date(row.latest_occurred_at_ms).toISOString(),
    section: feedSection(row.section_rank),
    requestCategory: row.request_category,
    dot: feedDot(row.section_rank, row.unread_count),
  };
}
