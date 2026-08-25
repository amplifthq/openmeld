import { describe, expect, it } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  projectRuntimeCoordinatorInteractionInboxItem,
  resolveRuntimeCoordinatorInteractionInboxItem,
} from "../src/runtime-transport/application/runtime-coordinator-interaction-inbox-producer";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("RuntimeCoordinator interaction Inbox producer", () => {
  it("creates one urgent action for the exact Binding owner", async () => {
    const harness = createInboxHarness();
    try {
      await projectRuntimeCoordinatorInteractionInboxItem({
        inboxDb: harness.db,
        interaction: buildPermissionInteraction(),
        nowMs: 2100,
        ownerUserId: "user_owner",
        runtimeCoordinatorExecutionId: "runtime_execution_one",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        spaceIndexDb: harness.db,
        targetProfileName: "Codex Agent",
        threadRootSignalId: "thread_root_one",
      });
      await projectRuntimeCoordinatorInteractionInboxItem({
        inboxDb: harness.db,
        interaction: buildPermissionInteraction(),
        nowMs: 2200,
        ownerUserId: "user_owner",
        runtimeCoordinatorExecutionId: "runtime_execution_one",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        spaceIndexDb: harness.db,
        targetProfileName: "Codex Agent",
        threadRootSignalId: "thread_root_one",
      });

      const inbox = createInboxService({ db: harness.db });
      const ownerInbox = await inbox.list({
        organizationId: "org_one",
        recipientUserId: "user_owner",
        view: "all",
      });
      expect(ownerInbox).toMatchObject({
        items: [
          {
            attention: "action_required",
            contextLabel: "Codex Agent",
            importance: "urgent",
            kind: "agent_interaction",
            organizationId: "org_one",
            preview: "Codex Agent needs your approval before it can continue.",
            recipientUserId: "user_owner",
            resolutionStatus: "open",
            sourceTarget: {
              interactionId: "interaction_one",
              kind: "agent_interaction",
              runtimeCoordinatorExecutionId: "runtime_execution_one",
              sourceSignalId: "signal_one",
              spaceId: "space_one",
              threadRootSignalId: "thread_root_one",
            },
            title: "Approval required",
          },
        ],
      });
      const serializedInbox = JSON.stringify(ownerInbox);
      expect(serializedInbox).not.toContain("rm -rf");
      expect(serializedInbox).not.toContain("/Users/felix/private-project");
      expect(serializedInbox).not.toContain("launch-plan.md");
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
    } finally {
      harness.close();
    }
  });

  it("resolves the owner action when the interaction source completes", async () => {
    const harness = createInboxHarness();
    try {
      const source = {
        interaction: buildPermissionInteraction(),
        ownerUserId: "user_owner",
        runtimeCoordinatorExecutionId: "runtime_execution_one",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        targetProfileName: "Codex Agent",
      };
      await projectRuntimeCoordinatorInteractionInboxItem({
        ...source,
        inboxDb: harness.db,
        nowMs: 2100,
        spaceIndexDb: harness.db,
      });

      await resolveRuntimeCoordinatorInteractionInboxItem({
        ...source,
        inboxDb: harness.db,
        resolvedAtMs: 2300,
        spaceIndexDb: harness.db,
      });
      await resolveRuntimeCoordinatorInteractionInboxItem({
        ...source,
        inboxDb: harness.db,
        resolvedAtMs: 2400,
        spaceIndexDb: harness.db,
      });

      const inbox = createInboxService({ db: harness.db });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_owner",
          view: "all",
        })
      ).resolves.toMatchObject({
        items: [{ resolutionStatus: "resolved" }],
      });
      await expect(
        inbox.summary({
          organizationId: "org_one",
          recipientUserId: "user_owner",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 1,
        unresolvedActionCount: 0,
      });
    } finally {
      harness.close();
    }
  });

  it("does not create a delayed interaction item after the owner loses Space access", async () => {
    const harness = createInboxHarness();
    try {
      harness.run({
        params: [3000, 3000, "space_one", "profile_owner"],
        sql: `
          UPDATE space_index_memberships
          SET status = 'removed', removed_at_ms = ?, source_updated_at_ms = ?
          WHERE space_id = ? AND profile_id = ?
        `,
      });

      await expect(
        projectRuntimeCoordinatorInteractionInboxItem({
          inboxDb: harness.db,
          interaction: buildPermissionInteraction(),
          nowMs: 3100,
          ownerUserId: "user_owner",
          runtimeCoordinatorExecutionId: "runtime_execution_delayed",
          sourceSignalId: "signal_one",
          spaceId: "space_one",
          spaceIndexDb: harness.db,
          targetProfileName: "Codex Agent",
        })
      ).resolves.toBeUndefined();
      expect(
        harness.queryFirst<{ count: number }>({
          sql: "SELECT count(*) AS count FROM inbox_items",
        })?.count
      ).toBe(0);
    } finally {
      harness.close();
    }
  });
});

function buildPermissionInteraction() {
  return {
    description:
      "Run rm -rf /Users/felix/private-project after reading launch-plan.md.",
    expiresAtMs: 10_000,
    interactionId: "interaction_one",
    kind: "permission" as const,
    options: [
      {
        intent: "allow_once" as const,
        label: "Allow once",
        optionId: "allow_once",
      },
      {
        intent: "deny" as const,
        label: "Deny",
        optionId: "deny",
      },
    ],
    requestedAtMs: 2000,
    subject: {
      command: "rm -rf /Users/felix/private-project",
      cwd: "/Users/felix/private-project",
      type: "command" as const,
    },
    title: "Approve rm -rf /Users/felix/private-project?",
    v: 1 as const,
  };
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
    "space_index_spaces",
    "space_index_memberships",
    "inbox_items",
    "inbox_email_deliveries",
  ]);
  harness.run({
    params: ["org_one", "One", "one", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
  });
  for (const [id, name, email] of [
    ["user_owner", "Owner", "owner@example.test"],
    ["user_other", "Other", "other@example.test"],
  ] as const) {
    harness.run({
      params: [id, name, email],
      sql: "INSERT INTO users (id, name, email) VALUES (?, ?, ?)",
    });
  }
  harness.run({
    params: [
      "space_one",
      "org_one",
      "private",
      "active",
      1000,
      1000,
      "projection_one",
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
  harness.run({
    params: [
      "space_one",
      "profile_owner",
      "Owner",
      "user_owner",
      1000,
      1000,
      1000,
      "membership_projection_owner",
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
