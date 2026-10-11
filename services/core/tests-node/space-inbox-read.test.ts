import { describe, expect, it } from "vitest";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { mutateSpaceInboxRead } from "../src/inbox/application/space-inbox-read";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";
import { postgresTestBinding } from "./helpers/postgresql-harness.test-support";

describe("Space read selections", () => {
  it.each([
    "space",
    "center_agent",
  ] as const)("retains an exact visible-source read for %s before projection and through outbox replay", async (targetKind) => {
    const f = await createInboxFeedFixture();
    try {
      const candidate = {
        ...f.identity,
        attention: "update" as const,
        importance: "normal" as const,
        kind: "space_message" as const,
        contextLabel: "Design",
        title: "late",
        preview: "A source-owned update.",
        occurredAtMs: 1000,
        sourceKind: "space_signal" as const,
        sourceKey: "late",
        sourceTarget: {
          kind: targetKind,
          spaceId: "space",
          signalId: "late",
        },
      };
      const result = await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        body: {
          operation: "read_sources",
          spaceId: "space",
          sources: [{ signalId: "late", occurredAtMs: 1000 }],
        },
        resolveReadCandidates: async () => [candidate],
      });
      expect(result).toEqual({ operation: "read", markedReadCount: 1 });
      const replay = await ensureInboxItem({
        candidate,
        db: f.db,
        nowMs: 2000,
      });
      const service = createInboxService({ db: f.db });
      expect(
        (await service.get({ ...f.identity, itemId: replay.itemId })).item
          .readAt
      ).not.toBeNull();
      expect((await service.spaceSummary(f.identity)).spaces).toEqual([]);
      await f.item("unseen");
      await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        body: {
          operation: "read_sources",
          spaceId: "space",
          sources: [{ signalId: "unseen", occurredAtMs: 999 }],
        },
        resolveReadCandidates: async () => [],
      });
      expect(
        (await service.spaceSummary(f.identity)).spaces[0]?.unreadCount
      ).toBe(1);
    } finally {
      await f.close();
    }
  });
  it("keeps a dismissed message unread in its conversation until it is actually read", async () => {
    const f = await createInboxFeedFixture();
    try {
      const item = await f.item("dismissed");
      const service = createInboxService({ db: f.db });
      await service.dismiss({ ...f.identity, itemId: item.itemId });
      expect(
        (await service.spaceSummary(f.identity)).spaces[0]?.unreadCount
      ).toBe(1);
      expect(
        (await service.spaceUnreadTargets({ ...f.identity, spaceId: "space" }))
          .targets
      ).toHaveLength(1);
      await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        body: {
          spaceId: "space",
          operation: "read",
          items: [{ itemId: item.itemId, occurredAtMs: 1000 }],
        },
      });
      expect((await service.spaceSummary(f.identity)).spaces).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it("reads exact viewed updates out of order without clearing unseen messages or other recipients", async () => {
    const f = await createInboxFeedFixture();
    try {
      const earlier = await f.item("earlier");
      const viewed = await f.item("viewed", { occurredAtMs: 2000 });
      const other = await f.item("other", { recipientUserId: "other" });
      const result = await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        body: {
          spaceId: "space",
          operation: "read",
          items: [
            { itemId: viewed.itemId, occurredAtMs: 2000 },
            { itemId: other.itemId, occurredAtMs: 1000 },
          ],
        },
      });
      expect(result).toEqual({ operation: "read", markedReadCount: 1 });
      const service = createInboxService({ db: f.db });
      expect(
        (await service.get({ ...f.identity, itemId: earlier.itemId })).item
          .readAt
      ).toBeNull();
      expect(
        (await service.spaceSummary(f.identity)).spaces[0]?.unreadCount
      ).toBe(1);
      expect(
        (await service.spaceUnreadTargets({ ...f.identity, spaceId: "space" }))
          .totalUnreadCount
      ).toBe(1);
    } finally {
      await f.close();
    }
  });

  it("freezes all main and Thread updates while preserving later arrivals, other Spaces, and pending work", async () => {
    const f = await createInboxFeedFixture();
    try {
      await f.item("main");
      await f.item("thread", {
        sourceTarget: {
          kind: "space",
          spaceId: "space",
          signalId: "reply",
          threadRootSignalId: "root",
        },
      });
      const action = await f.item("action", {
        attention: "action_required",
        sourceKind: "system_attention_event",
      });
      await f.space("second");
      await f.item("second", {
        sourceTarget: { kind: "space", spaceId: "second", signalId: "second" },
      });
      const prepared = await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        nowMs: 10_000,
        body: { spaceId: "space", operation: "prepare" },
      });
      expect(prepared).toMatchObject({ operation: "prepare", unreadCount: 2 });
      if (prepared.operation !== "prepare") {
        throw new Error("Expected selection");
      }
      // Delayed old updates also fall outside the frozen membership.
      await f.item("late", { occurredAtMs: 500 });
      const body = {
        spaceId: "space",
        operation: "clear" as const,
        snapshotId: prepared.snapshotId,
      };
      await expect(
        mutateSpaceInboxRead({ db: f.db, ...f.identity, nowMs: 11_000, body })
      ).resolves.toEqual({ operation: "read", markedReadCount: 2 });
      await expect(
        mutateSpaceInboxRead({ db: f.db, ...f.identity, nowMs: 11_000, body })
      ).resolves.toEqual({ operation: "read", markedReadCount: 0 });
      const service = createInboxService({ db: f.db });
      expect(
        (
          await service.spaceUnreadTargets({ ...f.identity, spaceId: "space" })
        ).targets.map((t) => t.signalId)
      ).toEqual(["late"]);
      expect(
        (await service.get({ ...f.identity, itemId: action.itemId })).item
          .readAt
      ).toBeNull();
      expect(
        (await service.spaceUnreadTargets({ ...f.identity, spaceId: "second" }))
          .totalUnreadCount
      ).toBe(1);
      await expect(
        mutateSpaceInboxRead({
          db: f.db,
          ...f.identity,
          recipientUserId: "other",
          nowMs: 11_000,
          body,
        })
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        mutateSpaceInboxRead({
          db: f.db,
          ...f.identity,
          nowMs: 1_000_000,
          body,
        })
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await f.close();
    }
  });
  it("retains an updated item and rechecks current access when confirming", async () => {
    const f = await createInboxFeedFixture();
    try {
      const item = await f.item("changing");
      const selection = await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        nowMs: 10_000,
        body: { spaceId: "space", operation: "prepare" },
      });
      if (selection.operation !== "prepare") {
        throw new Error("Expected selection");
      }
      await f.query({
        text: 'UPDATE "openmeld"."inbox_items" SET occurred_at_ms=11000,updated_at_ms=11000 WHERE id=$1',
        values: [item.itemId],
      });
      const body = {
        spaceId: "space",
        operation: "clear" as const,
        snapshotId: selection.snapshotId,
      };
      expect(
        await mutateSpaceInboxRead({
          db: f.db,
          ...f.identity,
          nowMs: 12_000,
          body,
        })
      ).toMatchObject({ markedReadCount: 0 });
      await f.query({
        text: "UPDATE \"openmeld\".\"space_index_memberships\" SET status='removed' WHERE space_id='space'",
      });
      expect(
        await mutateSpaceInboxRead({
          db: f.db,
          ...f.identity,
          nowMs: 12_000,
          body: {
            spaceId: "space",
            operation: "read",
            items: [{ itemId: item.itemId, occurredAtMs: 11_000 }],
          },
        })
      ).toMatchObject({ markedReadCount: 0 });
    } finally {
      await f.close();
    }
  });
  it("reports complete scope counts and clears beyond the navigation page without changing legacy responses", async () => {
    const f = await createInboxFeedFixture();
    try {
      await withPostgresRequest(postgresTestBinding(f.db), async () => {
        for (let n = 0; n < 501; n++) {
          await f.item(`reply-${n}`, {
            sourceTarget: {
              kind: "space",
              spaceId: "space",
              signalId: `reply-${n}`,
              threadRootSignalId: "root",
            },
          });
        }
      });
      const service = createInboxService({ db: f.db });
      const legacy = await service.spaceUnreadTargets({
        ...f.identity,
        spaceId: "space",
      });
      expect(legacy).not.toHaveProperty("scopes");
      expect(legacy.targets[0]).not.toHaveProperty("itemId");
      const page = await service.spaceUnreadTargets({
        ...f.identity,
        spaceId: "space",
        includeItemIds: true,
      });
      expect(page.targets).toHaveLength(500);
      expect(page.hasMoreTargets).toBe(true);
      expect(page.scopes).toEqual([
        { threadRootSignalId: "root", unreadCount: 501 },
      ]);
      const selection = await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        nowMs: 11_000,
        body: { spaceId: "space", operation: "prepare" },
      });
      if (selection.operation !== "prepare") {
        throw new Error("Expected selection");
      }
      expect(
        await mutateSpaceInboxRead({
          db: f.db,
          ...f.identity,
          nowMs: 12_000,
          body: {
            spaceId: "space",
            operation: "clear",
            snapshotId: selection.snapshotId,
          },
        })
      ).toMatchObject({ markedReadCount: 501 });
    } finally {
      await f.close();
    }
  });
});

import { withPostgresRequest } from "@openmeld/db/postgresql";
