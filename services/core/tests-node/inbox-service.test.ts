import { describe, expect, it } from "vitest";
import { ensureInboxItem } from "../src/inbox/application/inbox-item-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Inbox service", () => {
  it("reads Task items from the Task-owned access projection instead of source metadata", async () => {
    const harness = createInboxHarness();
    try {
      const item = await ensureInboxItem({
        candidate: {
          attention: "update",
          contextLabel: "Center Agent Task",
          importance: "normal",
          kind: "center_agent_task",
          occurredAtMs: 1000,
          organizationId: "org_one",
          preview: "The research is complete.",
          recipientUserId: "user_one",
          sourceKey: "task_one:event_one",
          sourceKind: "center_agent_task_event",
          sourceTarget: {
            kind: "center_agent_task",
            taskId: "task_one",
          },
          title: "Research onboarding",
        },
        db: harness.db,
        nowMs: 2000,
      });
      harness.run({
        params: ["task_one", "org_one", "user_one"],
        sql: `
          INSERT INTO center_agent_tasks (
            id,
            organization_id,
            requester_user_id,
            idempotency_key,
            title,
            goal,
            origin_kind,
            status,
            active_attempt_generation,
            version,
            created_at_ms,
            updated_at_ms,
            finished_at_ms
          ) VALUES (?, ?, ?, 'create:task_one', 'Research onboarding',
            'Research onboarding', 'open_meld', 'queued', NULL, 1, 1000, 1000, NULL)
        `,
      });
      harness.run({
        params: ["task_one", "org_one", "user_one"],
        sql: `
          INSERT INTO center_agent_task_authorized_readers (
            task_id,
            organization_id,
            user_id,
            access_scope,
            updated_at_ms
          ) VALUES (?, ?, ?, 'requester_private', 2000)
        `,
      });

      await expect(
        createInboxService({ db: harness.db }).list({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({
        items: [
          {
            id: item.itemId,
            sourceTarget: {
              kind: "center_agent_task",
              taskId: "task_one",
            },
          },
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("isolates list and summary state by organization and recipient", async () => {
    const harness = createInboxHarness();
    try {
      const item = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_one",
      });
      await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_two",
        sourceKey: "interaction_two",
      });
      await seedItem(harness.db, {
        organizationId: "org_two",
        recipientUserId: "user_one",
        sourceKey: "interaction_three",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.get({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({ item: { id: item.itemId } });

      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({
        organizationId: "org_one",
        items: [
          {
            organizationId: "org_one",
            recipientUserId: "user_one",
          },
        ],
      });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 1,
        unresolvedActionCount: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("marks only the authenticated recipient item read and keeps action unresolved", async () => {
    const harness = createInboxHarness();
    try {
      const item = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.markRead({
          itemId: item.itemId,
          organizationId: "org_one",
          read: true,
          recipientUserId: "user_two",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      const response = await service.markRead({
        itemId: item.itemId,
        organizationId: "org_one",
        read: true,
        recipientUserId: "user_one",
      });
      expect(response.item).toMatchObject({
        readAt: "1970-01-01T00:00:04.000Z",
        resolutionStatus: "open",
      });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toMatchObject({
        totalUnreadCount: 0,
        unresolvedActionCount: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("dismisses only the recipient projection without resolving its source action", async () => {
    const harness = createInboxHarness();
    try {
      const item = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_to_dismiss",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.dismiss({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_two",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.dismiss({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ dismissedItemId: item.itemId });
      await expect(
        service.dismiss({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ dismissedItemId: item.itemId });

      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({ items: [] });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
      });
      await expect(
        service.get({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });

      const stored = harness.queryFirst<{
        cleared_at_ms: number | null;
        resolution_status: string;
      }>({
        params: [item.itemId],
        sql: "SELECT cleared_at_ms, resolution_status FROM inbox_items WHERE id = ?",
      });
      expect(stored).toEqual({
        cleared_at_ms: 4000,
        resolution_status: "open",
      });
      const delivery = harness.queryFirst<{
        state: string;
        suppressed_reason: string | null;
      }>({
        params: [item.itemId],
        sql: "SELECT state, suppressed_reason FROM inbox_email_deliveries WHERE inbox_item_id = ?",
      });
      expect(delivery).toEqual({
        state: "suppressed",
        suppressed_reason: "item_cleared",
      });
    } finally {
      harness.close();
    }
  });

  it("fails closed for Space items after the recipient membership is removed", async () => {
    const harness = createInboxHarness();
    try {
      const item = await seedSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "signal_one",
        spaceId: "space_one",
      });
      const centerAgentItem = await seedCenterAgentSpaceItem(harness.db, {
        recipientUserId: "user_one",
        sourceKey: "center_agent_signal_one",
        spaceId: "space_one",
      });
      const interaction = await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "interaction_after_membership",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ id: item.itemId }),
          expect.objectContaining({ id: centerAgentItem.itemId }),
          expect.objectContaining({ id: interaction.itemId }),
        ]),
      });

      harness.run({
        params: [5000, 5000, "space_one", "profile_one"],
        sql: `
          UPDATE space_index_memberships
          SET status = 'removed', removed_at_ms = ?, source_updated_at_ms = ?
          WHERE space_id = ? AND profile_id = ?
        `,
      });

      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "all",
        })
      ).resolves.toMatchObject({ items: [] });
      await expect(
        service.get({
          itemId: item.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.get({
          itemId: centerAgentItem.itemId,
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.summary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
      });
      await expect(
        service.markRead({
          itemId: item.itemId,
          organizationId: "org_one",
          read: true,
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.markRead({
          itemId: interaction.itemId,
          organizationId: "org_one",
          read: true,
          recipientUserId: "user_one",
        })
      ).rejects.toMatchObject({ code: "inbox.item_not_found" });
      await expect(
        service.markAllRead({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ markedReadCount: 0 });
    } finally {
      harness.close();
    }
  });

  it("defaults a missing account preference on and propagates read failures", async () => {
    const harness = createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db });
      await expect(
        service.getPreferences({ userId: "user_one" })
      ).resolves.toEqual({ urgentEmailEnabled: true, updatedAt: null });
    } finally {
      harness.close();
    }

    const storageError = new Error("D1 unavailable");
    const failingDb = {
      prepare: () => ({
        bind: () => ({ first: () => Promise.reject(storageError) }),
      }),
    } as unknown as D1Database;
    await expect(
      createInboxService({ db: failingDb }).getPreferences({
        userId: "user_one",
      })
    ).rejects.toBe(storageError);
  });

  it("persists an account preference independently of organization", async () => {
    const harness = createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db, nowMs: () => 5000 });
      await expect(
        service.updatePreferences({
          urgentEmailEnabled: false,
          userId: "user_one",
        })
      ).resolves.toEqual({
        urgentEmailEnabled: false,
        updatedAt: "1970-01-01T00:00:05.000Z",
      });
    } finally {
      harness.close();
    }
  });

  it("tracks Center Agent unread replies with a monotonic visible-through watermark", async () => {
    const harness = createInboxHarness();
    try {
      seedCenterAgentDirectMessageSpace(harness, {
        recipientProfileId: "profile_one",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "center_agent_visible_reply",
        spaceId: "space_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.centerAgentSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ organizationId: "org_one", unreadCount: 1 });

      await expect(
        service.markCenterAgentReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toEqual({
        markedReadCount: 1,
        readThroughAt: "1970-01-01T00:00:04.000Z",
      });

      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "center_agent_late_old_reply",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1100,
        recipientUserId: "user_one",
        sourceKey: "center_agent_new_reply",
        spaceId: "space_one",
      });

      await expect(
        service.centerAgentSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({ organizationId: "org_one", unreadCount: 1 });
      expect(
        harness.queryAll<{
          read_at_ms: number | null;
          source_key: string;
        }>({
          params: ["center_agent_late_old_reply", "center_agent_new_reply"],
          sql: `
            SELECT source_key, read_at_ms
            FROM inbox_items
            WHERE source_key IN (?, ?)
            ORDER BY source_key
          `,
        })
      ).toEqual([
        { read_at_ms: 4000, source_key: "center_agent_late_old_reply" },
        { read_at_ms: null, source_key: "center_agent_new_reply" },
      ]);
    } finally {
      harness.close();
    }
  });

  it("summarizes unread Inbox updates by accessible Space", async () => {
    const harness = createInboxHarness();
    try {
      seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "space_two",
      });
      seedActiveSpaceMembership(harness, {
        profileId: "profile_one_space_two",
        recipientUserId: "user_one",
        spaceId: "space_two",
      });
      seedSpaceIndex(harness, {
        organizationId: "org_one",
        spaceId: "space_hidden",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "space_one_message_one",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1100,
        recipientUserId: "user_one",
        sourceKey: "space_one_message_two",
        spaceId: "space_one",
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1050,
        recipientUserId: "user_one",
        sourceKey: "space_one_center_agent_reply",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 2000,
        recipientUserId: "user_one",
        sourceKey: "space_two_message",
        spaceId: "space_two",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 3000,
        recipientUserId: "user_one",
        sourceKey: "space_hidden_message",
        spaceId: "space_hidden",
      });
      await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "space_action_not_a_message",
      });

      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        spaces: [
          {
            latestUnreadOccurredAtMs: 2000,
            spaceId: "space_two",
            unreadCount: 1,
          },
          {
            latestUnreadOccurredAtMs: 1100,
            spaceId: "space_one",
            unreadCount: 3,
          },
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("marks viewed Space messages without hiding unresolved work", async () => {
    const harness = createInboxHarness();
    try {
      await seedSpaceItem(harness.db, {
        occurredAtMs: 900,
        recipientUserId: "user_one",
        sourceKey: "space_old_message",
        spaceId: "space_one",
      });
      await seedItem(harness.db, {
        organizationId: "org_one",
        recipientUserId: "user_one",
        sourceKey: "space_action_required",
      });
      await ensureInboxItem({
        candidate: {
          attention: "action_required",
          contextLabel: "Center Agent",
          importance: "normal",
          kind: "agent_interaction",
          occurredAtMs: 950,
          organizationId: "org_one",
          preview: "The Center Agent needs a decision.",
          recipientUserId: "user_one",
          sourceKey: "space_target_action_required",
          sourceKind: "runtime_coordinator_interaction",
          sourceTarget: {
            kind: "space",
            signalId: "space_target_action_required",
            spaceId: "space_one",
          },
          title: "Decision needed",
        },
        db: harness.db,
        nowMs: 2000,
      });
      await seedCenterAgentSpaceItem(harness.db, {
        occurredAtMs: 1000,
        recipientUserId: "user_one",
        sourceKey: "space_center_agent_reply",
        spaceId: "space_one",
      });
      await seedSpaceItem(harness.db, {
        occurredAtMs: 1100,
        recipientUserId: "user_one",
        sourceKey: "space_new_message",
        spaceId: "space_one",
      });
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.markSpaceReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 1000,
        })
      ).resolves.toEqual({
        markedReadCount: 2,
        readThroughAt: "1970-01-01T00:00:04.000Z",
      });
      expect(
        harness.queryFirst<{ read_at_ms: number | null }>({
          params: ["space_target_action_required"],
          sql: "SELECT read_at_ms FROM inbox_items WHERE source_key = ?",
        })
      ).toEqual({ read_at_ms: null });

      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1100,
            spaceId: "space_one",
            unreadCount: 1,
          },
        ],
      });
      await expect(
        service.list({
          organizationId: "org_one",
          recipientUserId: "user_one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({
            readAt: null,
            resolutionStatus: "open",
            sourceTarget: expect.objectContaining({
              kind: "agent_interaction",
              spaceId: "space_one",
            }),
          }),
          expect.objectContaining({
            readAt: null,
            resolutionStatus: "open",
            sourceTarget: expect.objectContaining({
              kind: "space",
              spaceId: "space_one",
            }),
          }),
        ]),
      });

      await seedSpaceItem(harness.db, {
        occurredAtMs: 800,
        recipientUserId: "user_one",
        sourceKey: "space_delayed_old_message",
        spaceId: "space_one",
      });
      await expect(
        service.spaceSummary({
          organizationId: "org_one",
          recipientUserId: "user_one",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        spaces: [
          {
            latestUnreadOccurredAtMs: 1100,
            spaceId: "space_one",
            unreadCount: 1,
          },
        ],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects the legacy Center Agent read endpoint for an ordinary Space", async () => {
    const harness = createInboxHarness();
    try {
      const service = createInboxService({ db: harness.db, nowMs: () => 4000 });

      await expect(
        service.markCenterAgentReadThrough({
          organizationId: "org_one",
          recipientUserId: "user_one",
          spaceId: "space_one",
          throughOccurredAtMs: 9000,
        })
      ).rejects.toMatchObject({
        code: "inbox.center_agent_space_unavailable",
        status: 404,
      });
      expect(
        harness.queryFirst({
          params: ["org_one", "user_one", "space_one"],
          sql: `
            SELECT through_occurred_at_ms
            FROM inbox_center_agent_read_watermarks
            WHERE organization_id = ?
              AND recipient_user_id = ?
              AND space_id = ?
          `,
        })
      ).toBeNull();
    } finally {
      harness.close();
    }
  });
});

async function seedItem(
  db: D1Database,
  identity: {
    organizationId: string;
    recipientUserId: string;
    sourceKey: string;
  }
) {
  return await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: "Build failures",
      importance: "urgent",
      kind: "agent_interaction",
      occurredAtMs: 1000,
      organizationId: identity.organizationId,
      preview: "The agent needs approval to continue.",
      recipientUserId: identity.recipientUserId,
      sourceKey: identity.sourceKey,
      sourceKind: "runtime_coordinator_interaction",
      sourceTarget: {
        interactionId: identity.sourceKey,
        kind: "agent_interaction",
        runtimeCoordinatorExecutionId: `runtime_${identity.sourceKey}`,
        spaceId: "space_one",
      },
      title: "Approval required",
    },
    db,
    nowMs: 2000,
  });
}

async function seedSpaceItem(
  db: D1Database,
  identity: {
    occurredAtMs?: number;
    recipientUserId: string;
    sourceKey: string;
    spaceId: string;
  }
) {
  return await ensureInboxItem({
    candidate: {
      attention: "update",
      contextLabel: "Launch Room",
      importance: "normal",
      kind: "space_message",
      occurredAtMs: identity.occurredAtMs ?? 1000,
      organizationId: "org_one",
      preview: "A private Space update.",
      recipientUserId: identity.recipientUserId,
      sourceKey: identity.sourceKey,
      sourceKind: "space_signal",
      sourceTarget: {
        kind: "space",
        signalId: identity.sourceKey,
        spaceId: identity.spaceId,
      },
      title: "New message in Launch Room",
    },
    db,
    nowMs: 2000,
  });
}

async function seedCenterAgentSpaceItem(
  db: D1Database,
  identity: {
    occurredAtMs?: number;
    recipientUserId: string;
    sourceKey: string;
    spaceId: string;
  }
) {
  return await ensureInboxItem({
    candidate: {
      attention: "update",
      contextLabel: "Center Agent",
      importance: "normal",
      kind: "agent_reply",
      occurredAtMs: identity.occurredAtMs ?? 1000,
      organizationId: "org_one",
      preview: "A private Center Agent reply.",
      recipientUserId: identity.recipientUserId,
      sourceKey: identity.sourceKey,
      sourceKind: "space_signal",
      sourceTarget: {
        kind: "center_agent",
        signalId: identity.sourceKey,
        spaceId: identity.spaceId,
      },
      title: "Center Agent replied",
    },
    db,
    nowMs: 2000,
  });
}

function createInboxHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      )
    `,
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_authorized_readers",
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_notification_preferences",
    "inbox_center_agent_read_watermarks",
    "space_index_spaces",
    "space_index_memberships",
  ]);
  harness.run({
    sql: `
      CREATE TABLE center_agent_designations (
        organization_id TEXT PRIMARY KEY NOT NULL,
        agent_profile_id TEXT NOT NULL,
        designated_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  for (const [id, name, slug] of [
    ["org_one", "One", "one"],
    ["org_two", "Two", "two"],
  ] as const) {
    harness.run({
      params: [id, name, slug, 1000],
      sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
    });
  }
  seedSpaceIndex(harness, { organizationId: "org_one", spaceId: "space_one" });
  for (const [id, name, email] of [
    ["user_one", "One", "one@example.com"],
    ["user_two", "Two", "two@example.com"],
  ] as const) {
    harness.run({
      params: [id, name, email],
      sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
    });
  }
  seedActiveSpaceMembership(harness, {
    profileId: "profile_one",
    recipientUserId: "user_one",
    spaceId: "space_one",
  });
  seedActiveSpaceMembership(harness, {
    profileId: "profile_two",
    recipientUserId: "user_two",
    spaceId: "space_one",
  });
  return harness;
}

function seedCenterAgentDirectMessageSpace(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { recipientProfileId: string; spaceId: string }
): void {
  harness.run({
    params: [
      "openmeld_dm_space",
      `agt_center:${input.recipientProfileId}`,
      input.spaceId,
    ],
    sql: `
      UPDATE space_index_spaces
      SET space_purpose = ?, direct_message_pair_key = ?
      WHERE space_id = ?
    `,
  });
  harness.run({
    params: ["org_one", "agt_center", "user_one", 1000],
    sql: `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      ) VALUES (?, ?, ?, ?)
    `,
  });
}

function seedSpaceIndex(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { organizationId: string; spaceId: string }
): void {
  harness.run({
    params: [
      input.spaceId,
      input.organizationId,
      "private",
      "active",
      1000,
      1000,
      `space_projection_${input.spaceId}`,
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
}

function seedActiveSpaceMembership(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { profileId: string; recipientUserId: string; spaceId: string }
): void {
  harness.run({
    params: [
      input.spaceId,
      input.profileId,
      input.profileId,
      input.recipientUserId,
      1000,
      1000,
      1000,
      `projection_${input.profileId}`,
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
}
