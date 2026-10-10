import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  InboxSourceFacts,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import {
  rpcDismissInboxItem,
  rpcGetInboxItem,
  rpcGetInboxMessageNotificationPreferences,
  rpcGetInboxSummary,
  rpcGetSpaceInboxSummary,
  rpcGetSpaceInboxUnreadTargets,
  rpcListInboxFeed,
  rpcListInboxItems,
  rpcMarkInboxItemRead,
  rpcMarkSpaceInboxReadThrough,
  rpcMutateInboxFeed,
  rpcObserveInboxNotifications,
  rpcUpdateInboxMessageNotificationPreferences,
} from "../src/inbox/transport/rpc/inbox-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

describe("Inbox Core RPC", () => {
  it("returns membership kinds only to opted-in receivers without changing item identity", async () => {
    const harness = await createInboxHarness();
    try {
      const saved = await seedItem(harness.db, "user-1");
      await harness.query({
        text: `UPDATE "openmeld"."inbox_items" SET kind = 'space_joined' WHERE id = $1`,
        values: [saved.itemId],
      });
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      for (const includeMembershipNotices of [undefined, true]) {
        const request = {
          context: contextFor("user-1"),
          includeMembershipNotices,
        };
        const list = await rpcListInboxItems(env, request);
        const get = await rpcGetInboxItem(env, {
          ...request,
          itemId: saved.itemId,
        });
        const feed = await rpcListInboxFeed(env, request);
        for (const item of [list.items[0], get.item, feed.rows[0]?.item]) {
          expect(item).toMatchObject({
            id: saved.itemId,
            kind: includeMembershipNotices ? "space_joined" : "system_issue",
          });
        }
      }
    } finally {
      await harness.close();
    }
  });
  it("binds notification observations to the authenticated recipient and rejects injected scope", async () => {
    const harness = await createInboxHarness();
    try {
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      const baseline = await rpcObserveInboxNotifications(env, {
        context: contextFor("user-1"),
      });
      const saved = await seedItem(harness.db, "user-1", true, {
        version: 1,
        recipientReasons: ["thread_reply"],
        agentProfileIds: [],
      });
      const page = await rpcObserveInboxNotifications(env, {
        context: contextFor("user-1"),
        cursor: baseline.cursor,
      });
      expect(page.items.map((item) => item.id)).toEqual([saved.itemId]);
      expect(page.items[0]?.sourceTarget).toHaveProperty(
        "replyToRecipient",
        true
      );
      expect(page.items[0]?.sourceFacts?.recipientReasons).toEqual([
        "thread_reply",
      ]);
      await expect(
        rpcObserveInboxNotifications(env, {
          context: contextFor("user-2"),
          cursor: baseline.cursor,
        })
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        rpcObserveInboxNotifications(env, { context: contextFor("outsider") })
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        rpcObserveInboxNotifications(env, {
          context: contextFor("user-1"),
          // @ts-expect-error Recipients can only come from verified membership.
          recipientUserId: "user-2",
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      await harness.close();
    }
  });

  it("binds the attention feed and its frozen mutations to verified membership, not client-selected recipients", async () => {
    const harness = await createInboxHarness();
    try {
      const saved = await seedItem(harness.db, "user-1", true, {
        version: 1,
        recipientReasons: ["thread_reply"],
        agentProfileIds: ["codex"],
      });
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      const feed = await rpcListInboxFeed(env, {
        context: contextFor("user-1"),
        agentsOnly: "true",
      });
      expect(feed.rows[0]?.item.id).toBe(saved.itemId);
      await expect(
        rpcMutateInboxFeed(env, {
          context: contextFor("user-2"),
          snapshotId: feed.snapshotId,
          operation: "read",
        })
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        rpcListInboxFeed(env, { context: contextFor("outsider") })
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        rpcListInboxFeed(env, {
          context: contextFor("user-1"),
          // @ts-expect-error A recipient is derived from authentication, never from a feed query.
          recipientUserId: "user-2",
        })
      ).rejects.toMatchObject({ status: 400 });
      expect(
        await rpcMutateInboxFeed(env, {
          context: contextFor("user-1"),
          snapshotId: feed.snapshotId,
          operation: "read",
        })
      ).toEqual({ changedCount: 1 });
    } finally {
      await harness.close();
    }
  });

  it("returns durable relevance facts only to receivers that explicitly support them", async () => {
    const harness = await createInboxHarness();
    try {
      const sourceFacts: InboxSourceFacts = {
        version: 1,
        recipientReasons: ["thread_reply"],
        agentProfileIds: ["codex"],
      };
      const saved = await seedItem(harness.db, "user-1", true, sourceFacts);
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      for (const includeSourceFacts of [undefined, true]) {
        const request = {
          context: contextFor("user-1"),
          includeReplyToRecipient: true,
          includeSourceFacts,
        };
        const list = await rpcListInboxItems(env, request);
        const get = await rpcGetInboxItem(env, {
          ...request,
          itemId: saved.itemId,
        });
        const read = await rpcMarkInboxItemRead(env, {
          ...request,
          itemId: saved.itemId,
          read: false,
        });
        for (const item of [list.items[0], get.item, read.item]) {
          expect(item?.sourceFacts).toEqual(
            includeSourceFacts ? sourceFacts : undefined
          );
          expect(item?.sourceTarget).toHaveProperty("replyToRecipient", true);
        }
      }
    } finally {
      await harness.close();
    }
  });
  it("persists Human reply facts but returns them only to an opted-in RPC receiver", async () => {
    const harness = await createInboxHarness();
    try {
      const saved = await seedItem(harness.db, "user-1", true);
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      for (const includeReplyToRecipient of [undefined, true]) {
        const request = {
          context: contextFor("user-1"),
          includeReplyToRecipient,
        };
        const list = await rpcListInboxItems(env, request);
        const get = await rpcGetInboxItem(env, {
          ...request,
          itemId: saved.itemId,
        });
        const read = await rpcMarkInboxItemRead(env, {
          ...request,
          itemId: saved.itemId,
          read: false,
        });
        for (const item of [list.items[0], get.item, read.item]) {
          if (includeReplyToRecipient) {
            expect(item?.sourceTarget).toMatchObject({
              replyToRecipient: true,
            });
          } else {
            expect(item?.sourceTarget).not.toHaveProperty("replyToRecipient");
          }
        }
      }
    } finally {
      await harness.close();
    }
  });
  it("saves message preferences only for the verified member and rejects recipient injection", async () => {
    const harness = await createInboxHarness();
    try {
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      await expect(
        rpcUpdateInboxMessageNotificationPreferences(env, {
          context: contextFor("user-1"),
          preference: { scope: "account", mode: "all_messages" },
        })
      ).resolves.toMatchObject({ defaultMode: "all_messages" });
      await expect(
        rpcGetInboxMessageNotificationPreferences(env, {
          context: contextFor("user-2"),
        })
      ).resolves.toMatchObject({ defaultMode: "mentions_and_replies" });
      await expect(
        rpcUpdateInboxMessageNotificationPreferences(env, {
          context: contextFor("user-1"),
          preference: {
            scope: "account",
            mode: "all_messages",
            // @ts-expect-error Client-selected recipients are not part of this contract.
            userId: "user-2",
          },
        })
      ).rejects.toMatchObject({ status: 400 });
    } finally {
      await harness.close();
    }
  });
  it("derives the recipient from verified active membership", async () => {
    const harness = await createInboxHarness();
    try {
      const item = await seedItem(harness.db, "user-1");
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;

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
        unreadUrgentUpdateCount: 0,
        unresolvedActionCount: 0,
      });
      await expect(
        rpcGetSpaceInboxSummary(env, { context: contextFor("user-1") })
      ).resolves.toEqual({
        attention: [],
        chatUnreadCount: 0,
        chatUnreadUrgentUpdateCount: 0,
        chatUnresolvedActionCount: 0,
        ordinarySpaceUnreadCount: 1,
        organizationId: "org-1",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1000,
            spaceId: "space-1",
            unreadCount: 1,
            messageUnreadCount: 1,
          },
        ],
      });
      await expect(
        rpcGetSpaceInboxUnreadTargets(env, {
          context: contextFor("user-1"),
          spaceId: "space-1",
        })
      ).resolves.toMatchObject({
        targets: [{ signalId: "signal-1", threadRootSignalId: null }],
        totalUnreadCount: 1,
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
      await harness.close();
    }
  });

  it("rejects a caller without active Organization membership", async () => {
    const harness = await createInboxHarness();
    try {
      const env = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      await expect(
        rpcGetInboxSummary(env, { context: contextFor("outsider") })
      ).rejects.toMatchObject({
        code: "organization.membership_required",
        status: 403,
      });
    } finally {
      await harness.close();
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

async function seedItem(
  db: PostgresDatabase,
  recipientUserId: string,
  replyToRecipient?: boolean,
  sourceFacts?: InboxSourceFacts
) {
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
      sourceFacts,
      sourceTarget: {
        replyToRecipient,
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

async function createInboxHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    values: ["org-1", "Amplift", "amplift", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  await harness.query({
    values: [
      "space-1",
      "org-1",
      "private",
      "active",
      1000,
      1000,
      "space-projection",
    ],
    text: `
      INSERT INTO "openmeld"."space_index_spaces" (
        space_id,
        organization_id,
        organization_visibility,
        status,
        source_updated_at_ms,
        projected_at_ms,
        projection_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
  });
  for (const userId of ["user-1", "user-2"] as const) {
    await harness.query({
      values: [userId, userId, `${userId}@example.com`],
      text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
    });
    await harness.query({
      values: [`member-${userId}`, "org-1", userId, "member"],
      text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, "created_at") VALUES ($1, $2, $3, $4, 1700000000000)',
    });
  }
  await harness.query({
    values: [
      "space-1",
      "profile-user-1",
      "User 1",
      "user-1",
      1000,
      1000,
      1000,
      "projection-user-1",
    ],
    text: `
      INSERT INTO "openmeld"."space_index_memberships" (
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
      ) VALUES ($1, $2, 'human', $3, $4, 'active', 'joined_directly', $5, $6, $7, $8)
    `,
  });
  return harness;
}
