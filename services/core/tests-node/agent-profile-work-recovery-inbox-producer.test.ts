import { describe, expect, it } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  buildAgentProfileWorkRecoveryInboxSourceKey,
  projectAgentProfileWorkRecoveryInboxItem,
  resolveAgentProfileWorkRecoveryInboxItem,
} from "../src/runtime-transport/application/agent-profile-work-recovery-inbox-producer";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const RECOVERY_SOURCE_KEY_PATTERN =
  /^agent_profile_work_recovery_[a-f0-9]{64}$/u;

describe("Agent Profile work recovery Inbox producer", () => {
  it("projects a separate queue approval action without exposing work details", async () => {
    const harness = await createInboxHarness();
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
      await harness.close();
    }
  });

  it("projects one Needs attention item that links back to the interrupted Wake", async () => {
    const harness = await createInboxHarness();
    try {
      const input = {
        db: harness.db,
        interruptedClientMessageId: "message_interrupted",
        nowMs: 3200,
        occurredAtMs: 3100,
        organizationId: "org_one",
        ownerUserId: "user_owner",
        profileId: "profile_one",
        profileName: "Release Reviewer",
        sourceTarget: {
          kind: "space" as const,
          signalId: "signal_interrupted",
          spaceId: "a".repeat(64),
        },
        stage: "review_interrupted_work" as const,
      };

      await projectAgentProfileWorkRecoveryInboxItem(input);
      await projectAgentProfileWorkRecoveryInboxItem(input);

      expect(
        await harness.queryAll<{
          attention: string;
          preview: string;
          source_target_json: string;
          title: string;
        }>({
          text: 'SELECT attention, preview, source_target_json, title FROM "openmeld"."inbox_items"',
        })
      ).toEqual([
        {
          attention: "action_required",
          preview:
            "Open the interrupted Wake to review the failure. Queued work will wait until you skip it.",
          source_target_json: JSON.stringify({
            kind: "space",
            signalId: "signal_interrupted",
            spaceId: "a".repeat(64),
          }),
          title: "Review interrupted work for Release Reviewer",
        },
      ]);
    } finally {
      await harness.close();
    }
  });

  it("resolves the exact queue approval and suppresses its pending email", async () => {
    const harness = await createInboxHarness();
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
          stage: "approve_queued_work",
        })
      ).resolves.toBe(1);
      await expect(
        resolveAgentProfileWorkRecoveryInboxItem({
          db: harness.db,
          interruptedClientMessageId: source.interruptedClientMessageId,
          organizationId: source.organizationId,
          profileId: source.profileId,
          resolvedAtMs: 4100,
          stage: "approve_queued_work",
        })
      ).resolves.toBe(0);

      expect(
        await harness.queryAll<{ resolution_status: string }>({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual([{ resolution_status: "resolved" }]);
      expect(
        await harness.queryAll<{ state: string }>({
          text: `
            SELECT delivery.state
            FROM "openmeld"."inbox_email_deliveries" AS delivery
            INNER JOIN "openmeld"."inbox_items" AS item ON item.id = delivery.inbox_item_id
            ORDER BY item.title
          `,
        })
      ).toEqual([{ state: "suppressed" }]);
    } finally {
      await harness.close();
    }
  });

  it("keeps source recovery open when the owner reads or dismisses the item", async () => {
    const harness = await createInboxHarness();
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
        stage: "approve_queued_work",
      });
      const inbox = createInboxService({ db: harness.db, nowMs: () => 3000 });

      await inbox.markRead({
        itemId: projected.itemId,
        organizationId: "org_one",
        read: true,
        recipientUserId: "user_owner",
      });
      expect(
        await harness.queryFirst<{
          cleared_at_ms: number | null;
          read_at_ms: number | null;
          resolution_status: string;
        }>({
          text: 'SELECT cleared_at_ms, read_at_ms, resolution_status FROM "openmeld"."inbox_items"',
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
        await harness.queryFirst<{
          cleared_at_ms: number | null;
          resolution_status: string;
        }>({
          text: 'SELECT cleared_at_ms, resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ cleared_at_ms: 3000, resolution_status: "open" });
    } finally {
      await harness.close();
    }
  });

  it("builds a stable source key without raw work identity", async () => {
    const source = {
      interruptedClientMessageId: "message_private_task_one",
      profileId: "profile_one",
    };
    const first = await buildAgentProfileWorkRecoveryInboxSourceKey({
      ...source,
      stage: "approve_queued_work",
    });
    await expect(
      buildAgentProfileWorkRecoveryInboxSourceKey({
        ...source,
        stage: "approve_queued_work",
      })
    ).resolves.toBe(first);
    expect(first).toMatch(RECOVERY_SOURCE_KEY_PATTERN);
    expect(first).not.toContain(source.profileId);
    expect(first).not.toContain(source.interruptedClientMessageId);
  });
});

async function createInboxHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    values: ["org_one", "Recovery Org", "recovery-org", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  for (const [id, name, email] of [
    ["user_owner", "Profile Owner", "owner@example.com"],
    ["user_other", "Other Member", "other@example.com"],
  ] as const) {
    await harness.query({
      values: [id, name, email],
      text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
    });
  }
  return harness;
}
