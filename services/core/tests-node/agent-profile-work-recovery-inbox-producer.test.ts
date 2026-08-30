import { describe, expect, it } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  buildAgentProfileWorkRecoveryInboxSourceKey,
  projectAgentProfileWorkRecoveryInboxItem,
  resolveAgentProfileWorkRecoveryInboxItem,
} from "../src/runtime-transport/application/agent-profile-work-recovery-inbox-producer";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const RECOVERY_SOURCE_KEY_PATTERN =
  /^agent_profile_work_recovery_[a-f0-9]{64}$/u;

describe("Agent Profile work recovery Inbox producer", () => {
  it("projects one urgent owner action when Usage is available again", async () => {
    const harness = createInboxHarness();
    try {
      const input = {
        db: harness.db,
        interruptedClientMessageId: "message_private_task_one",
        nowMs: 2200,
        occurredAtMs: 2100,
        organizationId: "org_one",
        ownerUserId: "user_owner",
        profileId: "profile_one",
        profileName: "Release Reviewer",
        stage: "continue_interrupted_work" as const,
      };

      await projectAgentProfileWorkRecoveryInboxItem(input);
      await projectAgentProfileWorkRecoveryInboxItem({ ...input, nowMs: 2300 });

      const inbox = createInboxService({ db: harness.db });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_owner",
          view: "needs_action",
        })
      ).resolves.toMatchObject({
        items: [
          {
            attention: "action_required",
            contextLabel: "Release Reviewer",
            importance: "urgent",
            kind: "system_issue",
            organizationId: "org_one",
            preview:
              "Usage is available again. Continue the interrupted task before queued work can start.",
            recipientUserId: "user_owner",
            resolutionStatus: "open",
            sourceTarget: {
              kind: "agent_profile",
              profileId: "profile_one",
            },
            title: "Continue Release Reviewer's interrupted work",
          },
        ],
      });
      await expect(
        inbox.summary({
          organizationId: "org_one",
          recipientUserId: "user_other",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 0,
        unresolvedActionCount: 0,
      });

      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })?.count
      ).toBe(1);
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_email_deliveries",
        })?.count
      ).toBe(1);
      const stored = harness.queryFirst<{
        source_key: string;
        source_kind: string;
      }>({
        sql: "SELECT source_key, source_kind FROM inbox_items",
      });
      expect(stored).toEqual({
        source_key: await buildAgentProfileWorkRecoveryInboxSourceKey(input),
        source_kind: "agent_profile_work_recovery",
      });
      expect(stored?.source_key).not.toContain("message_private_task_one");
    } finally {
      harness.close();
    }
  });

  it("projects a separate queue approval action without exposing work details", async () => {
    const harness = createInboxHarness();
    try {
      await projectAgentProfileWorkRecoveryInboxItem({
        db: harness.db,
        interruptedClientMessageId: "message_private_task_one",
        nowMs: 3200,
        occurredAtMs: 3100,
        organizationId: "org_one",
        ownerUserId: "user_owner",
        profileId: "profile_one",
        profileName: "Release Reviewer",
        stage: "approve_queued_work",
      });

      const inbox = createInboxService({ db: harness.db });
      const result = await inbox.list({
        organizationId: "org_one",
        recipientUserId: "user_owner",
        view: "needs_action",
      });
      expect(result).toMatchObject({
        items: [
          {
            attention: "action_required",
            contextLabel: "Release Reviewer",
            importance: "urgent",
            kind: "system_issue",
            preview:
              "The interrupted task finished. Approve the queued work before it starts.",
            resolutionStatus: "open",
            sourceTarget: {
              kind: "agent_profile",
              profileId: "profile_one",
            },
            title: "Start queued work for Release Reviewer",
          },
        ],
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("message_private_task_one");
      expect(serialized).not.toContain("space_private");
      expect(serialized).not.toContain("/Users/felix/private-project");
    } finally {
      harness.close();
    }
  });

  it("resolves only the exact recovery stage and suppresses its pending email", async () => {
    const harness = createInboxHarness();
    try {
      const source = {
        interruptedClientMessageId: "message_private_task_one",
        organizationId: "org_one",
        ownerUserId: "user_owner",
        profileId: "profile_one",
        profileName: "Release Reviewer",
      };
      await projectAgentProfileWorkRecoveryInboxItem({
        ...source,
        db: harness.db,
        nowMs: 2200,
        occurredAtMs: 2100,
        stage: "continue_interrupted_work",
      });
      await projectAgentProfileWorkRecoveryInboxItem({
        ...source,
        db: harness.db,
        nowMs: 3200,
        occurredAtMs: 3100,
        stage: "approve_queued_work",
      });

      await expect(
        resolveAgentProfileWorkRecoveryInboxItem({
          db: harness.db,
          interruptedClientMessageId: source.interruptedClientMessageId,
          organizationId: source.organizationId,
          profileId: source.profileId,
          resolvedAtMs: 4000,
          stage: "continue_interrupted_work",
        })
      ).resolves.toBe(1);
      await expect(
        resolveAgentProfileWorkRecoveryInboxItem({
          db: harness.db,
          interruptedClientMessageId: source.interruptedClientMessageId,
          organizationId: source.organizationId,
          profileId: source.profileId,
          resolvedAtMs: 4100,
          stage: "continue_interrupted_work",
        })
      ).resolves.toBe(0);

      expect(
        harness.queryAll<{
          resolution_status: string;
          stage: string;
        }>({
          sql: `
            SELECT
              resolution_status,
              CASE
                WHEN title LIKE 'Continue %' THEN 'continue_interrupted_work'
                ELSE 'approve_queued_work'
              END AS stage
            FROM inbox_items
            ORDER BY stage
          `,
        })
      ).toEqual([
        { resolution_status: "open", stage: "approve_queued_work" },
        {
          resolution_status: "resolved",
          stage: "continue_interrupted_work",
        },
      ]);
      expect(
        harness.queryAll<{ state: string }>({
          sql: `
            SELECT delivery.state
            FROM inbox_email_deliveries AS delivery
            INNER JOIN inbox_items AS item ON item.id = delivery.inbox_item_id
            ORDER BY item.title
          `,
        })
      ).toEqual([{ state: "suppressed" }, { state: "pending" }]);
    } finally {
      harness.close();
    }
  });

  it("keeps source recovery open when the owner reads or dismisses the item", async () => {
    const harness = createInboxHarness();
    try {
      const projected = await projectAgentProfileWorkRecoveryInboxItem({
        db: harness.db,
        interruptedClientMessageId: "message_private_task_one",
        nowMs: 2200,
        occurredAtMs: 2100,
        organizationId: "org_one",
        ownerUserId: "user_owner",
        profileId: "profile_one",
        profileName: "Release Reviewer",
        stage: "continue_interrupted_work",
      });
      const inbox = createInboxService({ db: harness.db, nowMs: () => 3000 });

      await inbox.markRead({
        itemId: projected.itemId,
        organizationId: "org_one",
        read: true,
        recipientUserId: "user_owner",
      });
      expect(
        harness.queryFirst<{
          cleared_at_ms: number | null;
          read_at_ms: number | null;
          resolution_status: string;
        }>({
          sql: "SELECT cleared_at_ms, read_at_ms, resolution_status FROM inbox_items",
        })
      ).toEqual({
        cleared_at_ms: null,
        read_at_ms: 3000,
        resolution_status: "open",
      });

      await inbox.dismiss({
        itemId: projected.itemId,
        organizationId: "org_one",
        recipientUserId: "user_owner",
      });
      expect(
        harness.queryFirst<{
          cleared_at_ms: number | null;
          resolution_status: string;
        }>({
          sql: "SELECT cleared_at_ms, resolution_status FROM inbox_items",
        })
      ).toEqual({ cleared_at_ms: 3000, resolution_status: "open" });
    } finally {
      harness.close();
    }
  });

  it("builds stable, stage-specific source keys without raw work identity", async () => {
    const source = {
      interruptedClientMessageId: "message_private_task_one",
      profileId: "profile_one",
    };
    const first = await buildAgentProfileWorkRecoveryInboxSourceKey({
      ...source,
      stage: "continue_interrupted_work",
    });
    await expect(
      buildAgentProfileWorkRecoveryInboxSourceKey({
        ...source,
        stage: "continue_interrupted_work",
      })
    ).resolves.toBe(first);
    await expect(
      buildAgentProfileWorkRecoveryInboxSourceKey({
        ...source,
        stage: "approve_queued_work",
      })
    ).resolves.not.toBe(first);
    expect(first).toMatch(RECOVERY_SOURCE_KEY_PATTERN);
    expect(first).not.toContain(source.profileId);
    expect(first).not.toContain(source.interruptedClientMessageId);
  });
});

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
    params: ["org_one", "Recovery Org", "recovery-org", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  for (const [id, name, email] of [
    ["user_owner", "Profile Owner", "owner@example.com"],
    ["user_other", "Other Member", "other@example.com"],
  ] as const) {
    harness.run({
      params: [id, name, email],
      sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
    });
  }
  return harness;
}
