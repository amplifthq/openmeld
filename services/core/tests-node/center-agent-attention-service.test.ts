import { describe, expect, it } from "vitest";
import {
  createCenterAgentAttentionRequest,
  resolveCenterAgentAttentionRequestsForReply,
} from "../src/center-agent/application/center-agent-attention-service";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Center Agent attention service", () => {
  it.each([
    ["response_needed", "normal", 0],
    ["work_blocked", "urgent", 1],
    ["material_failure_risk", "urgent", 1],
  ] as const)("projects %s as a %s Inbox request and resolves it on the member's next reply", async (impact, importance, expectedEmailCount) => {
    const harness = createHarness();
    try {
      await createCenterAgentAttentionRequest({
        db: harness.db,
        impact,
        nativeDeliveryId: `delivery-${impact}`,
        nowMs: 2000,
        organizationId: "org-one",
        prompt: "Choose whether I should ship the draft.",
        recipientUserId: "user-one",
        sourceTarget: {
          kind: "center_agent",
          signalId: "signal-trigger",
          spaceId: "space-center-agent",
        },
        spaceId: "space-center-agent",
        submissionId: `submission-${impact}`,
        title: "Your decision is needed",
        triggerSignalId: "signal-trigger",
      });

      const inbox = createInboxService({ db: harness.db, nowMs: () => 3000 });
      await expect(
        inbox.list({
          organizationId: "org-one",
          recipientUserId: "user-one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({
        items: [
          {
            attention: "action_required",
            importance,
            resolutionStatus: "open",
            sourceTarget: {
              kind: "center_agent",
              signalId: "signal-trigger",
              spaceId: "space-center-agent",
            },
            title: "Your decision is needed",
          },
        ],
      });
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_email_deliveries",
        })?.count
      ).toBe(expectedEmailCount);

      await expect(
        resolveCenterAgentAttentionRequestsForReply({
          db: harness.db,
          nowMs: 4000,
          organizationId: "org-one",
          recipientUserId: "user-one",
          spaceId: "space-center-agent",
        })
      ).resolves.toBe(1);
      await expect(
        inbox.list({
          organizationId: "org-one",
          recipientUserId: "user-one",
          view: "needs_action",
        })
      ).resolves.toMatchObject({ items: [] });
    } finally {
      harness.close();
    }
  });
});

function createHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `CREATE TABLE organizations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  });
  harness.run({
    sql: `CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL
    )`,
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_attention_requests",
    "center_agent_tasks",
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_center_agent_read_watermarks",
    "space_index_spaces",
    "space_index_memberships",
  ]);
  harness.run({
    params: ["org-one", "One", "one", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: ["user-one", "One", "one@example.com"],
    sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
  });
  harness.run({
    params: [
      "space-center-agent",
      "org-one",
      "private",
      "active",
      1000,
      1000,
      "space-projection",
    ],
    sql: `INSERT INTO space_index_spaces (
      space_id, organization_id, organization_visibility, status,
      source_updated_at_ms, projected_at_ms, projection_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  });
  harness.run({
    params: [
      "space-center-agent",
      "human-profile",
      "Human",
      "user-one",
      1000,
      1000,
      1000,
      "member-projection",
    ],
    sql: `INSERT INTO space_index_memberships (
      space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
      owner_user_id_snapshot, status, member_source, added_at_ms,
      source_updated_at_ms, projected_at_ms, projection_event_id
    ) VALUES (?, ?, 'human', ?, ?, 'active', 'joined_directly', ?, ?, ?, ?)`,
  });
  return harness;
}
