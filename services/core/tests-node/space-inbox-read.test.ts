import { describe, expect, it } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { mutateSpaceInboxRead } from "../src/inbox/application/space-inbox-read";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";

describe("Space read selections", () => {
  it("reads exact viewed updates out of order without clearing unseen messages or other recipients", async () => {
    const f = createInboxFeedFixture();
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
      f.close();
    }
  });

  it("freezes all main and Thread updates while preserving later arrivals, other Spaces, and pending work", async () => {
    const f = createInboxFeedFixture();
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
      const action = await f.item("action", { attention: "action_required" });
      f.space("second");
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
      f.close();
    }
  });
});
