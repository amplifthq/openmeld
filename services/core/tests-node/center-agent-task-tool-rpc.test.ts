import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  appendCenterAgentTaskEvent,
  createCenterAgentTask,
} from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import {
  rpcCenterAgentGetTaskTool,
  rpcCenterAgentListTasksTool,
} from "../src/center-agent-tasks/transport/rpc/center-agent-task-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111112";

describe("canonical Center Agent Task tool RPC", () => {
  it("lists requester-private Tasks with preserved cursor/limit/status semantics", async () => {
    const harness = createHostedTaskToolHarness();
    try {
      await seedTask(harness.db, "task-a", "user-1");
      await seedTask(harness.db, "task-b", "user-1");
      await seedTask(harness.db, "task-c", "user-1");
      await seedTask(harness.db, "task-other", "user-2");
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      const firstPage = await rpcCenterAgentListTasksTool(env, {
        context: hostedContext(),
        limit: 2,
        speakerMember: verifiedSpeaker(),
      });
      expect(firstPage.organizationId).toBe("org-1");
      expect(firstPage.tasks.map((task) => task.id)).toEqual([
        "task-c",
        "task-b",
      ]);
      expect(firstPage.nextCursor).toBeTruthy();

      const secondPage = await rpcCenterAgentListTasksTool(env, {
        context: hostedContext(),
        ...(firstPage.nextCursor ? { cursor: firstPage.nextCursor } : {}),
        limit: 2,
        speakerMember: verifiedSpeaker(),
      });
      expect(secondPage.tasks.map((task) => task.id)).toEqual(["task-a"]);
      expect(secondPage.nextCursor).toBeNull();

      const filtered = await rpcCenterAgentListTasksTool(env, {
        context: hostedContext(),
        limit: 10,
        speakerMember: verifiedSpeaker(),
        status: "queued",
      });
      expect(filtered.tasks.map((task) => task.id)).toEqual([
        "task-c",
        "task-b",
        "task-a",
      ]);
    } finally {
      harness.close();
    }
  });

  it("never leaks another requester's Tasks into the model-visible list", async () => {
    const harness = createHostedTaskToolHarness();
    try {
      await seedTask(harness.db, "task-mine", "user-1");
      await seedTask(harness.db, "task-theirs", "user-2");
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      const response = await rpcCenterAgentListTasksTool(env, {
        context: hostedContext(),
        limit: 40,
        speakerMember: verifiedSpeaker(),
      });
      expect(response).not.toHaveProperty("totalMembers");
      expect(response.tasks.map((task) => task.id)).toEqual(["task-mine"]);
    } finally {
      harness.close();
    }
  });

  it("returns the canonical detail/history projection for an owned Task", async () => {
    const harness = createHostedTaskToolHarness();
    try {
      await seedTask(harness.db, "task-detail", "user-1");
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      const detail = await rpcCenterAgentGetTaskTool(env, {
        context: hostedContext(),
        speakerMember: verifiedSpeaker(),
        taskId: "task-detail",
      });
      expect(detail.task).toMatchObject({
        id: "task-detail",
        requesterUserId: "user-1",
        status: "queued",
        title: "Review onboarding",
      });
      expect(detail.events.map((event) => event.kind)).toEqual([
        "task_created",
      ]);
      expect(detail.attempts).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("rejects reading another requester's Task without leaking existence", async () => {
    const harness = createHostedTaskToolHarness();
    try {
      await seedTask(harness.db, "task-private", "user-1");
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      await expect(
        rpcCenterAgentGetTaskTool(env, {
          context: hostedContext(),
          speakerMember: {
            memberId: "member-user-2",
            userId: "user-2",
          },
          taskId: "task-private",
        })
      ).rejects.toMatchObject({
        code: "center_agent_task.not_found",
        status: 404,
      });
    } finally {
      harness.close();
    }
  });

  it("fails closed for an unverified Message Channel speaker before any read", async () => {
    const harness = createHostedTaskToolHarness();
    try {
      await seedTask(harness.db, "task-gated", "user-1");
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      await expect(
        rpcCenterAgentListTasksTool(env, {
          context: hostedContext(),
          speakerMember: {
            displayName: "Ashley",
            kind: "anonymous_member" as const,
            messageChannelIdentity: {
              connectionId: "T123",
              provider: "slack" as const,
              providerUserId: "U123",
            },
          },
        })
      ).rejects.toMatchObject({
        code: "center_agent.openmeld_identity_required",
        status: 403,
      });
      await expect(
        rpcCenterAgentGetTaskTool(env, {
          context: hostedContext(),
          speakerMember: {
            memberId: "member-user-2",
            userId: "user-2",
          },
          taskId: "task-gated",
        })
      ).rejects.toMatchObject({
        code: "center_agent_task.not_found",
        status: 404,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a model-supplied requester identity field", async () => {
    const harness = createHostedTaskToolHarness();
    try {
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      await expect(
        rpcCenterAgentListTasksTool(env, {
          context: hostedContext(),
          requesterUserId: "user-2",
          speakerMember: verifiedSpeaker(),
        } as never)
      ).rejects.toMatchObject({ code: "invalid_payload", status: 400 });
    } finally {
      harness.close();
    }
  });
});

function hostedContext(): OpenMeldRequestContext {
  return {
    activeOrganizationId: "org-1",
    agentControllerConversationId: "flue_submission_tool_test",
    actorContext: {
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      callerPrincipalId: "user-1",
      ownerUserId: "user-1",
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: "request-task-tool-test",
      openMeldProfileId: CENTER_AGENT_PROFILE_ID,
    },
  };
}

function verifiedSpeaker(): { memberId: string; userId: string } {
  return { memberId: "member-user-1", userId: "user-1" };
}

async function seedTask(
  db: D1Database,
  taskId: string,
  requesterUserId: string
) {
  const created = await createCenterAgentTask({
    db,
    goal: "Research onboarding.",
    idempotencyKey: `seed-${taskId}`,
    nowMs: 1000,
    organizationId: "org-1",
    origin: {
      kind: "open_meld",
      requestedBy: {
        displayName: requesterUserId === "user-1" ? "User One" : "User Two",
        profileId:
          requesterUserId === "user-1"
            ? "11111111-1111-4111-8111-111111111111"
            : "22222222-2222-4222-8222-222222222222",
        userId: requesterUserId,
      },
    },
    requesterUserId,
    taskId,
    title: "Review onboarding",
  });
  await appendCenterAgentTaskEvent({
    actor: "requester",
    attemptGeneration: null,
    db,
    eventId: `event-${taskId}`,
    expectedTaskVersion: created.task.version,
    idempotencyKey: `event-${taskId}`,
    kind: "task_created",
    observedAtMs: 1000,
    occurredAtMs: 1000,
    organizationId: "org-1",
    taskId,
    text: "Research onboarding.",
  });
  return created.task;
}

function createHostedTaskToolHarness() {
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
  harness.run({
    sql: "CREATE TABLE openmeld_profiles (profile_id TEXT PRIMARY KEY NOT NULL, profile_name TEXT NOT NULL, profile_kind TEXT NOT NULL, is_default INTEGER NOT NULL, status TEXT NOT NULL, organization_id TEXT, owner_user_id TEXT NOT NULL, managed_role TEXT)",
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_attempts",
    "center_agent_task_admission_outbox",
    "center_agent_task_events",
    "openMeldRemoteAgent_native_delivery_ledger",
    "center_agent_designations",
    "center_agent_audit_journal",
    "openMeldDaemon_agent_profile_bindings",
  ]);
  harness.run({
    params: ["org-1", "Amplift", "amplift", 1000],
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
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
    params: [CENTER_AGENT_PROFILE_ID],
    sql: "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_kind, is_default, status, organization_id, owner_user_id, managed_role) VALUES ('11111111-1111-4111-8111-111111111111', 'User One', 'human', 1, 'active', 'org-1', 'user-1', NULL), ('22222222-2222-4222-8222-222222222222', 'User Two', 'human', 1, 'active', 'org-1', 'user-2', NULL), (?, 'Center Agent', 'agent', 0, 'active', 'org-1', 'user-1', 'center_agent')",
  });
  harness.run({
    params: ["org-1", CENTER_AGENT_PROFILE_ID, "user-1", 1000],
    sql: "INSERT INTO center_agent_designations (organization_id, agent_profile_id, designated_by, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: [
      "binding-1",
      "owner_account",
      "user-1",
      CENTER_AGENT_PROFILE_ID,
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      "hosted_center_agent",
      JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      null,
      "enabled_primary",
      1000,
      1000,
    ],
    sql: "INSERT INTO openMeldDaemon_agent_profile_bindings (binding_id, owner_kind, owner_id, agent_profile_id, openmeld_service_runtime_id, runtime_kind, hosted_runtime_identity_json, agent_controller_ref, agent_controller_conversation_id, binding_state, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  });
  return harness;
}
