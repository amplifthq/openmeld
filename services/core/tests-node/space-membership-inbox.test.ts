import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { mutateSpaceInboxRead } from "../src/inbox/application/space-inbox-read";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { projectSpaceMembershipInbox } from "../src/space-index/space-membership-inbox";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";

const meta: SpaceMetaRecord = {
  v: 1,
  spaceId: "space",
  organizationId: "org",
  name: "Design",
  visibility: "private",
  accessMode: "members_only",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
function member(addedAtMs = 0): SpaceMemberRecord {
  const at = new Date(addedAtMs).toISOString();
  return {
    spaceId: "space",
    profileId: "owner-space",
    profileKindSnapshot: "human",
    profileNameSnapshot: "Owner",
    ownerUserIdSnapshot: "owner",
    ownerNameSnapshot: "Owner",
    controllerRefSnapshot: null,
    status: "active",
    memberSource: "joined_directly",
    addedAt: at,
    removedAt: null,
    addedByProfileId: null,
    addedByOwnerUserId: null,
    addedByDisplayNameSnapshot: null,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: at,
    lastEnteredAt: at,
    createdAt: at,
    updatedAt: at,
  };
}
describe("New Space membership Inbox events", () => {
  it("does not create a notice from a historical snapshot whose organization is unavailable", async () => {
    const f = await createInboxFeedFixture();
    try {
      await f.query({
        text: `UPDATE "openmeld"."space_index_spaces" SET organization_id = 'missing-organization' WHERE space_id = 'space'`,
      });
      await projectSpaceMembershipInbox({
        db: f.db,
        meta: { ...meta, organizationId: "missing-organization" },
        members: [member()],
      });
      expect(
        (await f.query({ text: `SELECT id FROM "openmeld"."inbox_items"` }))
          .rows
      ).toEqual([]);
      expect(
        (
          await f.query({
            text: `SELECT status FROM "openmeld"."space_index_spaces" WHERE space_id = 'space'`,
          })
        ).rows
      ).toEqual([{ status: "active" }]);
    } finally {
      await f.close();
    }
  });
  it("does not notify a member who added themselves", async () => {
    // Smoke: setup opened one Direct Message per Agent and the owner got a
    // "You joined a Space" item for each.
    const f = await createInboxFeedFixture();
    try {
      await projectSpaceMembershipInbox({
        db: f.db,
        meta,
        members: [
          {
            ...member(),
            addedByOwnerUserId: "owner",
            addedByProfileId: "owner-space",
            memberSource: "space_creator",
          },
        ],
      });
      expect(
        (await f.query({ text: `SELECT id FROM "openmeld"."inbox_items"` }))
          .rows
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it("shows an empty joined Space as unread and acknowledges it without reading unseen messages", async () => {
    const f = await createInboxFeedFixture();
    try {
      const project = () =>
        projectSpaceMembershipInbox({ db: f.db, meta, members: [member()] });
      await project();
      const service = createInboxService({ db: f.db });
      expect((await service.spaceSummary(f.identity)).spaces).toEqual([
        {
          spaceId: "space",
          unreadCount: 1,
          messageUnreadCount: 0,
          latestUnreadOccurredAtMs: 0,
        },
      ]);
      const unread = await service.spaceUnreadTargets({
        ...f.identity,
        spaceId: "space",
        includeItemIds: true,
      });
      expect(unread).toMatchObject({
        targets: [],
        totalUnreadCount: 0,
        joinedItems: [{ occurredAtMs: 0 }],
      });
      const prepared = await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        body: { operation: "prepare", spaceId: "space" },
      });
      expect(prepared).toMatchObject({ operation: "prepare", unreadCount: 1 });
      const joined = unread.joinedItems?.[0];
      if (!joined) {
        throw new Error("Expected membership notice");
      }
      const message = await f.item("unseen-message");
      await mutateSpaceInboxRead({
        db: f.db,
        ...f.identity,
        body: { operation: "read", spaceId: "space", items: [joined] },
      });
      // Reconnection and outbox retries retain the same durable read state.
      await project();
      expect(
        (await service.get({ ...f.identity, itemId: joined.itemId })).item
          .readAt
      ).not.toBeNull();
      expect(
        (await service.get({ ...f.identity, itemId: message.itemId })).item
          .readAt
      ).toBeNull();
      expect((await service.spaceSummary(f.identity)).spaces[0]).toMatchObject({
        unreadCount: 1,
        messageUnreadCount: 1,
      });
    } finally {
      await f.close();
    }
  });
  it("creates a new event on rejoin and rejects stale or removed membership generations", async () => {
    const f = await createInboxFeedFixture();
    try {
      await projectSpaceMembershipInbox({
        db: f.db,
        meta,
        members: [member()],
      });
      await f.query({
        text: `UPDATE "openmeld"."space_index_memberships" SET added_at_ms = 2000 WHERE space_id = 'space'`,
      });
      await projectSpaceMembershipInbox({
        db: f.db,
        meta,
        members: [member(1000)],
      });
      await projectSpaceMembershipInbox({
        db: f.db,
        meta,
        members: [member(2000)],
      });
      expect(
        (
          await f.query({
            text: `SELECT source_key FROM "openmeld"."inbox_items" ORDER BY occurred_at_ms`,
          })
        ).rows
      ).toEqual([
        { source_key: "space-joined:space:owner-space:0" },
        { source_key: "space-joined:space:owner-space:2000" },
      ]);
      await f.query({
        text: `UPDATE "openmeld"."space_index_memberships" SET status = 'removed', added_at_ms = 3000 WHERE space_id = 'space'`,
      });
      await projectSpaceMembershipInbox({
        db: f.db,
        meta,
        members: [member(3000)],
      });
      expect(
        (await f.query({ text: `SELECT id FROM "openmeld"."inbox_items"` }))
          .rows
      ).toHaveLength(2);
      expect(
        (await createInboxService({ db: f.db }).spaceSummary(f.identity)).spaces
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it("baselines historical memberships as read using the same source identity as the live producer", async () => {
    const f = await createInboxFeedFixture();
    try {
      const baseline = readFileSync(
        new URL(
          "../../../packages/db/postgresql/migrations/0033_space_joined_inbox.sql",
          import.meta.url
        ),
        "utf8"
      )
        .split("--> statement-breakpoint")
        .at(-1);
      if (!baseline) {
        throw new Error("Expected baseline SQL");
      }
      await f.query({ text: baseline });
      await projectSpaceMembershipInbox({
        db: f.db,
        meta,
        members: [member()],
      });
      const service = createInboxService({ db: f.db });
      expect((await service.spaceSummary(f.identity)).spaces).toEqual([]);
      expect(
        (
          await f.query({
            text: `SELECT read_at_ms FROM "openmeld"."inbox_items" WHERE source_key = 'space-joined:space:owner-space:0'`,
          })
        ).rows
      ).toEqual([{ read_at_ms: "0" }]);
    } finally {
      await f.close();
    }
  });
});
