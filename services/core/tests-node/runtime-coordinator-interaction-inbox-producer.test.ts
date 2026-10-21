import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { buildRuntimeCoordinatorExecutionId } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import {
  projectRuntimeCoordinatorInteractionInboxItem,
  resolveRuntimeCoordinatorInteractionInboxItem,
} from "../src/runtime-transport/application/runtime-coordinator-interaction-inbox-producer";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

const memberAgents = vi.hoisted(() => ({ enabled: true }));
vi.mock("../src/member-agent/member-agents-feature", async (original) => ({
  ...(await original<
    typeof import("../src/member-agent/member-agents-feature")
  >()),
  isMemberAgentsEnabled: () => memberAgents.enabled,
}));

describe("RuntimeCoordinator interaction Inbox producer", () => {
  it.each([
    "open",
    "outcome",
    "read",
    "cleared",
  ])("historical cleanup preserves %s state", async (state) => {
    const harness = await createInboxHarness();
    try {
      await projectRuntimeCoordinatorInteractionInboxItem({
        inboxDb: harness.db,
        spaceIndexDb: harness.db,
        nowMs: 2100,
        ownerUserId: "user_owner",
        interaction: buildPermissionInteraction(),
        runtimeCoordinatorExecutionId: "execution",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        targetProfileName: "Agent",
      });
      if (state !== "open") {
        await harness.query(
          `UPDATE "openmeld"."inbox_items" SET resolution_status = 'resolved', resolved_at_ms = 2300`
        );
      }
      if (state === "outcome") {
        await harness.query(
          `UPDATE "openmeld"."inbox_items" SET attention = 'update', kind = 'wake_outcome', source_kind = 'space_signal', resolution_status = 'not_applicable', resolved_at_ms = NULL`
        );
      }
      if (state === "read" || state === "cleared") {
        await harness.query(
          `UPDATE "openmeld"."inbox_items" SET read_at_ms = 2200`
        );
      }
      if (state === "cleared") {
        await harness.query(
          `UPDATE "openmeld"."inbox_items" SET cleared_at_ms = 2250`
        );
      }
      const before = await harness.queryFirst({
        text: `SELECT read_at_ms, cleared_at_ms, resolution_status, occurred_at_ms FROM "openmeld"."inbox_items"`,
      });
      await harness.query(
        await readFile(
          new URL(
            "../../../packages/db/postgresql/migrations/0026_ended_inbox_requests.sql",
            import.meta.url
          ),
          "utf8"
        )
      );
      expect(
        await harness.queryFirst({
          text: `SELECT read_at_ms, cleared_at_ms, resolution_status, occurred_at_ms FROM "openmeld"."inbox_items"`,
        })
      ).toEqual(before);
    } finally {
      await harness.close();
    }
  });
  it.each([
    "permission",
    "plan_review",
    "question",
  ] as const)("classifies %s from the source protocol, not the displayed title", async (kind) => {
    const h = await createInboxHarness();
    try {
      await projectRuntimeCoordinatorInteractionInboxItem({
        inboxDb: h.db,
        spaceIndexDb: h.db,
        nowMs: 2100,
        ownerUserId: "user_owner",
        interaction: { interactionId: "request", requestedAtMs: 2000, kind },
        runtimeCoordinatorExecutionId: "execution",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        targetProfileName: "Agent",
      });
      expect(
        await h.queryFirst({
          text: 'SELECT importance, source_facts_json FROM "openmeld"."inbox_items"',
        })
      ).toMatchObject({
        importance: "normal",
        source_facts_json: JSON.stringify({
          version: 1,
          recipientReasons: ["requester"],
          // The owner must answer every kind before the Agent continues.
          requestCategory: "action",
        }),
      });
      expect(
        await h.queryAll({
          text: 'SELECT * FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });
  it("moves an item filed as a review to Needs action on its own replay", async () => {
    const h = await createInboxHarness();
    try {
      const source = {
        inboxDb: h.db,
        spaceIndexDb: h.db,
        nowMs: 2100,
        ownerUserId: "user_owner",
        interaction: buildPermissionInteraction(),
        runtimeCoordinatorExecutionId: "execution",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        targetProfileName: "Agent",
      };
      await projectRuntimeCoordinatorInteractionInboxItem(source);
      // As written before every kind became an action.
      await h.query({
        text: `UPDATE "openmeld"."inbox_items" SET source_facts_json = replace(source_facts_json, '"requestCategory":"action"', '"requestCategory":"review"')`,
      });
      await projectRuntimeCoordinatorInteractionInboxItem({
        ...source,
        nowMs: 2200,
      });
      expect(
        await h.queryAll({
          text: 'SELECT source_facts_json FROM "openmeld"."inbox_items"',
        })
      ).toEqual([
        {
          source_facts_json: JSON.stringify({
            version: 1,
            recipientReasons: ["requester"],
            requestCategory: "action",
          }),
        },
      ]);
    } finally {
      await h.close();
    }
  });
  it("repairs only an exact legacy source replay without resetting read, dismissal, end state or accepted email receipts", async () => {
    const h = await createInboxHarness();
    try {
      const source = {
        inboxDb: h.db,
        spaceIndexDb: h.db,
        nowMs: 2100,
        ownerUserId: "user_owner",
        interaction: buildPermissionInteraction(),
        runtimeCoordinatorExecutionId: "execution",
        sourceSignalId: "signal_one",
        spaceId: "space_one",
        targetProfileName: "Agent",
      };
      await projectRuntimeCoordinatorInteractionInboxItem(source);
      await h.query({
        text: "UPDATE \"openmeld\".\"inbox_items\" SET importance = 'urgent', source_facts_json = NULL, read_at_ms = 2200, cleared_at_ms = 2300, resolution_status = 'resolved', resolved_at_ms = 2400",
      });
      await h.query({
        text: 'INSERT INTO "openmeld"."inbox_email_deliveries" (id, inbox_item_id, state, attempt_count, next_attempt_at_ms, created_at_ms, updated_at_ms, message_id, sent_at_ms) SELECT \'receipt\', id, \'sent\', 1, 2000, 2000, 2100, \'accepted-by-provider\', 2100 FROM "openmeld"."inbox_items"',
      });
      const before = await h.queryFirst({
        text: 'SELECT id, created_at_ms, occurred_at_ms, read_at_ms, cleared_at_ms, resolved_at_ms, resolution_status FROM "openmeld"."inbox_items"',
      });
      const receipt = await h.queryFirst({
        text: 'SELECT * FROM "openmeld"."inbox_email_deliveries"',
      });
      await projectRuntimeCoordinatorInteractionInboxItem({
        ...source,
        nowMs: 2600,
      });
      expect(
        await h.queryFirst({
          text: 'SELECT id, created_at_ms, occurred_at_ms, read_at_ms, cleared_at_ms, resolved_at_ms, resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual(before);
      expect(
        await h.queryFirst({
          text: 'SELECT * FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toEqual(receipt);
      expect(
        await h.queryFirst({
          text: 'SELECT importance FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ importance: "normal" });
      await expect(
        projectRuntimeCoordinatorInteractionInboxItem({
          ...source,
          sourceSignalId: "wrong-source",
        })
      ).rejects.toThrow();
    } finally {
      await h.close();
    }
  });
  it("creates one ordinary review for the exact Binding owner", async () => {
    const harness = await createInboxHarness();
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
            importance: "normal",
            sourceFacts: {
              version: 1,
              recipientReasons: ["requester"],
              requestCategory: "action",
            },
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
        unreadUrgentUpdateCount: 0,
        unresolvedActionCount: 0,
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    "source",
    "history",
  ])("reads an ended interaction via %s without deleting its history", async (mode) => {
    const harness = await createInboxHarness();
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

      if (mode === "history") {
        await harness.query(`UPDATE "openmeld"."inbox_items" SET read_at_ms = NULL,
          title = 'Approval required', preview = 'Old request'`);
        const migration = await readFile(
          new URL(
            "../../../packages/db/postgresql/migrations/0026_ended_inbox_requests.sql",
            import.meta.url
          ),
          "utf8"
        );
        await harness.query(migration);
        await harness.query(migration);
      }

      const inbox = createInboxService({ db: harness.db });
      await expect(
        inbox.list({
          organizationId: "org_one",
          recipientUserId: "user_owner",
          view: "all",
        })
      ).resolves.toMatchObject({
        items: [
          {
            resolutionStatus: "resolved",
            readAt: new Date(2300).toISOString(),
            title: "Request ended",
            preview: "This request no longer needs a response.",
          },
        ],
      });
      await expect(
        inbox.summary({
          organizationId: "org_one",
          recipientUserId: "user_owner",
        })
      ).resolves.toEqual({
        organizationId: "org_one",
        totalUnreadCount: 0,
        unreadUrgentUpdateCount: 0,
        unresolvedActionCount: 0,
      });
    } finally {
      await harness.close();
    }
  });

  it("does not create a delayed interaction item after the owner loses Space access", async () => {
    const harness = await createInboxHarness();
    try {
      await harness.query({
        values: [3000, 3000, "space_one", "profile_owner"],
        text: `
          UPDATE "openmeld"."space_index_memberships"
          SET status = 'removed', removed_at_ms = $1, source_updated_at_ms = $2
          WHERE space_id = $3 AND profile_id = $4
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
      ).resolves.toBeNull();
      expect(
        (
          await harness.queryFirst<{ count: number }>({
            text: 'SELECT count(*) AS count FROM "openmeld"."inbox_items"',
          })
        )?.count
      ).toBe(0);
    } finally {
      await harness.close();
    }
  });
});

describe("RuntimeCoordinator interaction Inbox for an observing Agent owner", () => {
  // Felix's Agent joined Tali's Space on her request; Felix only observes.
  const agentProfileId = "agt_00000000-0000-4000-8000-0000000000b1";
  async function observeThroughOwnAgent(
    h: Awaited<ReturnType<typeof createInboxHarness>>
  ) {
    await h.query({
      text: `DELETE FROM "openmeld"."space_index_memberships" WHERE profile_id = 'profile_owner'`,
    });
    await h.query({
      values: [agentProfileId],
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, created_by_user_id, organization_id, source, status) VALUES ($1, 'Claude Code', 'claude-code', 'agent', 'user_owner', 'user_owner', 'org_one', 'local_agent_create', 'active')`,
    });
    await h.query({
      text: `
        INSERT INTO "openmeld"."space_index_memberships" (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          owner_user_id_snapshot, status, member_source, added_at_ms,
          source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES (
          'space_one', $1, 'agent', 'Claude Code', 'user_owner',
          'active', 'joined_directly', 1000, 1000, 1000, 'membership_agent'
        )
      `,
      values: [agentProfileId],
    });
  }
  const colleagueQuestion = {
    interaction: buildPermissionInteraction(),
    nowMs: 2100,
    ownerUserId: "user_owner",
    runtimeCoordinatorExecutionId: buildRuntimeCoordinatorExecutionId({
      dispatchId: "dispatch_one",
      spaceId: "space_one",
      targetProfileId: agentProfileId,
    }),
    sourceSignalId: "signal_one",
    spaceId: "space_one",
    targetProfileName: "Claude Code",
  };

  it("asks the Binding owner in Inbox although they are not a member", async () => {
    const h = await createInboxHarness();
    try {
      await observeThroughOwnAgent(h);
      await projectRuntimeCoordinatorInteractionInboxItem({
        ...colleagueQuestion,
        inboxDb: h.db,
        spaceIndexDb: h.db,
      });
      // Read through the Inbox, which also gates the email.
      const ownerInbox = await createInboxService({ db: h.db }).list({
        organizationId: "org_one",
        recipientUserId: "user_owner",
        view: "all",
      });
      expect(ownerInbox.items).toMatchObject([
        {
          kind: "agent_interaction",
          sourceFacts: { personalAgentProfileIds: [agentProfileId] },
          sourceTarget: { agentOwnerActivity: true },
        },
      ]);
      // Another person sees nothing.
      expect(
        (
          await createInboxService({ db: h.db }).list({
            organizationId: "org_one",
            recipientUserId: "user_other",
            view: "all",
          })
        ).items
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("keeps the membership requirement while MemberAgents are off", async () => {
    const h = await createInboxHarness();
    memberAgents.enabled = false;
    try {
      await observeThroughOwnAgent(h);
      await expect(
        projectRuntimeCoordinatorInteractionInboxItem({
          ...colleagueQuestion,
          inboxDb: h.db,
          spaceIndexDb: h.db,
        })
      ).rejects.toThrow(
        "runtime_coordinator.interaction_inbox.membership_projection_unavailable"
      );
    } finally {
      memberAgents.enabled = true;
      await h.close();
    }
  });
});

describe("RuntimeCoordinator interaction Inbox urgency from the request chain root", () => {
  async function seedRootProfiles(
    h: Awaited<ReturnType<typeof createInboxHarness>>
  ) {
    await h.query({
      text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, created_by_user_id, source, status) VALUES
        ('00000000-0000-4000-8000-0000000000a1', 'Owner', 'owner', 'human', 'user_owner', 'user_owner', 'auth_bootstrap', 'active'),
        ('00000000-0000-4000-8000-0000000000a2', 'Other', 'other', 'human', 'user_other', 'user_other', 'auth_bootstrap', 'active')`,
    });
  }
  function question(
    index: number,
    contextId: string | null,
    rootProfileId: string
  ) {
    return {
      interaction: {
        interactionId: `interaction_${index}`,
        kind: "permission" as const,
        requestedAtMs: 2000 + index,
      },
      nowMs: 2100 + index,
      ownerUserId: "user_owner",
      requestRoot: { contextId, rootProfileId },
      runtimeCoordinatorExecutionId: `execution_${index}`,
      sourceSignalId: "signal_one",
      spaceId: "space_one",
      targetProfileName: "Agent",
    };
  }

  it("keeps owner-rooted questions normal, one item each, with no email", async () => {
    const h = await createInboxHarness();
    try {
      await seedRootProfiles(h);
      for (const index of [1, 2]) {
        await projectRuntimeCoordinatorInteractionInboxItem({
          ...question(
            index,
            "context_one",
            "00000000-0000-4000-8000-0000000000a1"
          ),
          inboxDb: h.db,
          spaceIndexDb: h.db,
        });
      }
      expect(
        await h.queryAll({
          text: 'SELECT importance FROM "openmeld"."inbox_items" ORDER BY occurred_at_ms',
        })
      ).toEqual([{ importance: "normal" }, { importance: "normal" }]);
      expect(
        await h.queryAll({
          text: 'SELECT id FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it("sends one urgent email for ten colleague-rooted questions in one Session", async () => {
    const h = await createInboxHarness();
    try {
      await seedRootProfiles(h);
      for (let index = 1; index <= 10; index += 1) {
        await projectRuntimeCoordinatorInteractionInboxItem({
          ...question(
            index,
            "context_one",
            "00000000-0000-4000-8000-0000000000a2"
          ),
          inboxDb: h.db,
          spaceIndexDb: h.db,
        });
        if (index < 10) {
          await resolveRuntimeCoordinatorInteractionInboxItem({
            ...question(
              index,
              "context_one",
              "00000000-0000-4000-8000-0000000000a2"
            ),
            inboxDb: h.db,
            resolvedAtMs: 2150 + index,
            spaceIndexDb: h.db,
          });
        }
      }
      const items = await h.queryAll<{
        importance: string;
        preview: string;
        resolution_status: string;
        source_target_json: string;
      }>({
        text: 'SELECT importance, preview, resolution_status, source_target_json FROM "openmeld"."inbox_items"',
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        importance: "urgent",
        resolution_status: "open",
      });
      expect(JSON.parse(items[0]?.source_target_json ?? "{}")).toMatchObject({
        interactionId: "interaction_10",
        runtimeCoordinatorExecutionId: "execution_10",
      });
      // The email-bearing item carries fixed copy, never command text.
      expect(items[0]?.preview).toBe(
        "Agent needs your approval before it can continue."
      );
      expect(
        await h.queryAll({
          text: 'SELECT id FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it("keeps the Session item open when an older question in it ends", async () => {
    const h = await createInboxHarness();
    try {
      await seedRootProfiles(h);
      for (const index of [1, 2]) {
        await projectRuntimeCoordinatorInteractionInboxItem({
          ...question(
            index,
            "context_one",
            "00000000-0000-4000-8000-0000000000a2"
          ),
          inboxDb: h.db,
          spaceIndexDb: h.db,
        });
      }
      await resolveRuntimeCoordinatorInteractionInboxItem({
        ...question(1, "context_one", "00000000-0000-4000-8000-0000000000a2"),
        inboxDb: h.db,
        resolvedAtMs: 2300,
        spaceIndexDb: h.db,
      });
      expect(
        await h.queryFirst({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ resolution_status: "open" });
      await resolveRuntimeCoordinatorInteractionInboxItem({
        ...question(2, "context_one", "00000000-0000-4000-8000-0000000000a2"),
        inboxDb: h.db,
        resolvedAtMs: 2400,
        spaceIndexDb: h.db,
      });
      expect(
        await h.queryFirst({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ resolution_status: "resolved" });
    } finally {
      await h.close();
    }
  });

  it("never reopens an ended question on replay or lets another task's answer close it", async () => {
    const h = await createInboxHarness();
    try {
      await seedRootProfiles(h);
      const first = question(
        1,
        "context_one",
        "00000000-0000-4000-8000-0000000000a2"
      );
      await projectRuntimeCoordinatorInteractionInboxItem({
        ...first,
        inboxDb: h.db,
        spaceIndexDb: h.db,
      });
      // Same interaction id, another task in the Session: not this question.
      await resolveRuntimeCoordinatorInteractionInboxItem({
        ...first,
        inboxDb: h.db,
        resolvedAtMs: 2200,
        runtimeCoordinatorExecutionId: "execution_other",
        spaceIndexDb: h.db,
      });
      expect(
        await h.queryFirst({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ resolution_status: "open" });
      await resolveRuntimeCoordinatorInteractionInboxItem({
        ...first,
        inboxDb: h.db,
        resolvedAtMs: 2300,
        spaceIndexDb: h.db,
      });
      await projectRuntimeCoordinatorInteractionInboxItem({
        ...first,
        inboxDb: h.db,
        nowMs: 2400,
        spaceIndexDb: h.db,
      });
      expect(
        await h.queryFirst({
          text: 'SELECT resolution_status FROM "openmeld"."inbox_items"',
        })
      ).toEqual({ resolution_status: "resolved" });
    } finally {
      await h.close();
    }
  });

  it("gives each Session its own urgent item and email", async () => {
    const h = await createInboxHarness();
    try {
      await seedRootProfiles(h);
      for (const [index, contextId] of [
        [1, "context_one"],
        [2, "context_two"],
      ] as const) {
        await projectRuntimeCoordinatorInteractionInboxItem({
          ...question(index, contextId, "00000000-0000-4000-8000-0000000000a2"),
          inboxDb: h.db,
          spaceIndexDb: h.db,
        });
      }
      expect(
        await h.queryAll({
          text: 'SELECT id FROM "openmeld"."inbox_email_deliveries"',
        })
      ).toHaveLength(2);
    } finally {
      await h.close();
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

async function createInboxHarness() {
  const harness = await createPostgresHarness();

  await harness.query({
    values: ["org_one", "One", "one", 1000],
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $2, $3, $4)',
  });
  for (const [id, name, email] of [
    ["user_owner", "Owner", "owner@example.test"],
    ["user_other", "Other", "other@example.test"],
  ] as const) {
    await harness.query({
      values: [id, name, email],
      text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $2, $3)',
    });
  }
  await harness.query({
    values: [
      "space_one",
      "org_one",
      "private",
      "active",
      1000,
      1000,
      "projection_one",
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
  await harness.query({
    values: [
      "space_one",
      "profile_owner",
      "Owner",
      "user_owner",
      1000,
      1000,
      1000,
      "membership_projection_owner",
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
