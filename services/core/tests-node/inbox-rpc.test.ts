import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import {
  rpcDismissInboxItem,
  rpcGetInboxItem,
  rpcGetInboxSummary,
  rpcGetSpaceInboxSummary,
  rpcListInboxItems,
  rpcMarkSpaceInboxReadThrough,
} from "../src/inbox/transport/rpc/inbox-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Inbox Core RPC", () => {
  it("derives the recipient from verified active membership", async () => {
    const harness = createInboxHarness();
    try {
      const item = await seedItem(harness.db, "user-1");
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      await expect(
        rpcListInboxItems(env, {
          context: contextFor("user-1"),
          view: "all",
        })
      ).resolves.toMatchObject({
        items: [{ recipientUserId: "user-1" }],
        organizationId: "org-1",
      });
      await expect(
        rpcGetInboxItem(env, {
          context: contextFor("user-1"),
          itemId: "inbox_item_missing",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found", status: 404 });
      await expect(
        rpcGetInboxSummary(env, { context: contextFor("user-2") })
      ).resolves.toEqual({
        organizationId: "org-1",
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
      });
      await expect(
        rpcGetSpaceInboxSummary(env, { context: contextFor("user-1") })
      ).resolves.toEqual({
        ordinarySpaceUnreadCount: 1,
        organizationId: "org-1",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1000,
            spaceId: "space-1",
            unreadCount: 1,
          },
        ],
      });
      await expect(
        rpcMarkSpaceInboxReadThrough(env, {
          context: contextFor("user-1"),
          spaceId: "space-1",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toEqual({
        markedReadCount: 1,
        readThroughAt: expect.any(String),
      });
      await expect(
        rpcDismissInboxItem(env, {
          context: contextFor("user-1"),
          itemId: item.itemId,
        })
      ).resolves.toEqual({ dismissedItemId: item.itemId });
      await expect(
        rpcGetInboxItem(env, {
          context: contextFor("user-1"),
          itemId: item.itemId,
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found", status: 404 });
    } finally {
      harness.close();
    }
  });

  it("rejects a caller without active Organization membership", async () => {
    const harness = createInboxHarness();
    try {
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;
      await expect(
        rpcGetInboxSummary(env, { context: contextFor("outsider") })
      ).rejects.toMatchObject({
        code: "organization.membership_required",
        status: 403,
      });
    } finally {
      harness.close();
    }
  });
});

function contextFor(userId: string): OpenMeldRequestContext {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "human",
      profileName: "Inbox tester",
      requestId: `request-${userId}`,
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    },
  };
}

async function seedItem(db: D1Database, recipientUserId: string) {
  return await ensureInboxItem({
    candidate: {
      attention: "update",
      contextLabel: "Product",
      importance: "normal",
      kind: "space_message",
      occurredAtMs: 1000,
      organizationId: "org-1",
      preview: "A new message is waiting.",
      recipientUserId,
      sourceKey: "signal-1",
      sourceKind: "space_signal",
      sourceTarget: {
        kind: "space",
        signalId: "signal-1",
        spaceId: "space-1",
      },
      title: "New message",
    },
    db,
    nowMs: 1000,
  });
}

function createInboxHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, created_at INTEGER NOT NULL)",
  });
  harness.run({
    sql: "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL)",
  });
  harness.run({
    sql: "CREATE TABLE members (id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL)",
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_notification_preferences",
    "inbox_center_agent_read_watermarks",
    "space_index_spaces",
    "space_index_memberships",
  ]);
  harness.run({
    params: ["org-1", "Amplift", "amplift", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: [
      "space-1",
      "org-1",
      "private",
      "active",
      1000,
      1000,
      "space-projection",
    ],
    sql: `
      INSERT INTO space_index_spaces (
        space_id,
        organization_id,
        organization_visibility,
        status,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  });
  for (const userId of ["user-1", "user-2"] as const) {
    harness.run({
      params: [userId, userId, `${userId}@example.com`],
      sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
    });
    harness.run({
      params: [`member-${userId}`, "org-1", userId, "member"],
      sql: "INSERT INTO members (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)",
    });
  }
  harness.run({
    params: [
      "space-1",
      "profile-user-1",
      "User 1",
      "user-1",
      1000,
      1000,
      1000,
      "projection-user-1",
    ],
    sql: `
      INSERT INTO space_index_memberships (
        space_id,
        profile_id,
        profile_kind_snapshot,
        profile_name_snapshot,
        owner_user_id_snapshot,
        status,
        member_source,
        added_at_ms,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES (?, ?, 'human', ?, ?, 'active', 'joined_directly', ?, ?, ?, ?)
    `,
  });
  return harness;
}
