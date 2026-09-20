import { env } from "cloudflare:test";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { createInboxFeedService } from "../src/inbox/application/inbox-feed-service";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";

describe("Inbox attention feed on D1", () => {
  it("executes ranked CTE batches and frozen mutations without clearing subsequently projected events", async () => {
    const db = env.OPENMELD_DB;
    const suffix = crypto.randomUUID();
    const identity = {
      organizationId: `feed-org-${suffix}`,
      recipientUserId: `feed-user-${suffix}`,
    };
    await db.batch([
      db
        .prepare(
          "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Inbox acceptance', ?, 1)"
        )
        .bind(identity.organizationId, identity.organizationId),
      db
        .prepare(
          "INSERT INTO users (id, name, email) VALUES (?, 'Inbox acceptance', ?)"
        )
        .bind(
          identity.recipientUserId,
          `${identity.recipientUserId}@example.test`
        ),
    ]);
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
    const first = await service.list(identity, { limit: 1 });
    expect(first.rows[0]).toMatchObject({
      item: { id: priority.itemId },
      dot: "yellow",
      section: "priority",
    });
    expect(first.counts).toMatchObject({ all: 2, priority: 1, needsAction: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await service.list(identity, {
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.rows[0]?.item.id).toBe(ordinary.itemId);
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
        .prepare("SELECT read_at_ms FROM inbox_items WHERE id = ?")
        .bind(later.itemId)
        .first()
    ).toEqual({ read_at_ms: null });
    expect(
      (await service.list(identity, { category: "needs_action" })).rows[0]?.dot
    ).toBe("yellow");
    await db
      .prepare(
        "UPDATE inbox_items SET resolution_status = 'resolved', resolved_at_ms = 3500 WHERE id = ?"
      )
      .bind(priority.itemId)
      .run();
    expect(
      (await service.list(identity, { category: "needs_action" })).rows
    ).toEqual([]);
  });
});
