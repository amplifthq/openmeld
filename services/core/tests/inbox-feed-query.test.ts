import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { createInboxFeedService } from "../src/inbox/application/inbox-feed-service";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { env } from "../test-support/worker-env";

describe("Inbox attention feed on D1", () => {
  it.each([
    undefined,
    "space",
  ] as const)("executes ranked CTE batches and frozen mutations without clearing subsequently projected events (grouping=%s)", async (grouping) => {
    const db = getPostgresDatabase(env);
    const suffix = crypto.randomUUID();
    const identity = {
      organizationId: `feed-org-${suffix}`,
      recipientUserId: `feed-user-${suffix}`,
    };
    await db.transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Inbox acceptance\', $2, 1)',
              values: [],
            },
            values: [identity.organizationId, identity.organizationId],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, \'Inbox acceptance\', $2)',
              values: [],
            },
            values: [
              identity.recipientUserId,
              `${identity.recipientUserId}@example.test`,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const base: InboxSourceCandidate = {
      ...identity,
      attention: "update",
      importance: "normal",
      kind: "system_issue",
      occurredAtMs: 1000,
      contextLabel: "Device",
      title: "Device information",
      preview: "A source-confirmed fact.",
      sourceKind: "system_attention_event",
      sourceKey: "ordinary",
      sourceTarget: { kind: "settings", section: "computers" },
    };
    const ordinary = await ensureInboxItem({
      db,
      nowMs: 2000,
      candidate: base,
    });
    const priority = await ensureInboxItem({
      db,
      nowMs: 2000,
      candidate: {
        ...base,
        sourceKey: "priority",
        attention: "action_required",
        importance: "urgent",
        occurredAtMs: 1,
      },
    });
    const service = createInboxFeedService({ db, nowMs: () => 3000 });
    const first = await service.list(identity, { limit: 1, grouping });
    expect(first.rows[0]).toMatchObject({
      item: { id: priority.itemId },
      dot: "yellow",
      section: "priority",
    });
    expect(first.counts).toMatchObject({ all: 2, priority: 1, needsAction: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await service.list(identity, {
      limit: 1,
      grouping,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.rows[0]?.item.id).toBe(ordinary.itemId);
    if (grouping) {
      expect(second.rows[0]?.group?.kind).toBe("system");
    }
    const later = await ensureInboxItem({
      db,
      nowMs: 2000,
      candidate: { ...base, sourceKey: "late-source-retry", occurredAtMs: 0 },
    });
    expect(
      await service.mutate(identity, {
        snapshotId: first.snapshotId,
        operation: "read",
      })
    ).toEqual({ changedCount: 2 });
    expect(
      await db
        .query({
          ...{
            text: 'SELECT read_at_ms FROM "openmeld"."inbox_items" WHERE id = $1',
            values: [],
          },
          values: [later.itemId],
        })
        .then((result) => result.rows[0] ?? null)
    ).toEqual({ read_at_ms: null });
    expect(
      (await service.list(identity, { category: "needs_action" })).rows[0]?.dot
    ).toBe("yellow");
    await db.query({
      ...{
        text: 'UPDATE "openmeld"."inbox_items" SET resolution_status = \'resolved\', resolved_at_ms = 3500 WHERE id = $1',
        values: [],
      },
      values: [priority.itemId],
    });
    expect(
      (await service.list(identity, { category: "needs_action" })).rows
    ).toEqual([]);
    if (grouping) {
      const history = await service.list(identity, { grouping });
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]).toMatchObject({
        group: { kind: "system" },
        itemCount: 3,
        unreadCount: 1,
        section: "activity",
      });
    }
  });
});
