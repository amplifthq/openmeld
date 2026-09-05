import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  createCenterAgentTask,
  createCenterAgentTaskAttempt,
  transitionCenterAgentTaskAttempt,
} from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import { createCenterAgentTaskNativeRuntimePort } from "../src/center-agent-tasks/infrastructure/remote-agent/center-agent-task-native-runtime";
import {
  rpcContinueCenterAgentTask,
  rpcGetCenterAgentTask,
  rpcListCenterAgentTasks,
  rpcStopCenterAgentTask,
} from "../src/center-agent-tasks/transport/rpc/center-agent-task-rpc";
import type { CoreBindings } from "../src/lib/bindings";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../src/runtime-transport/application/runtime-coordinator-authority";
import {
  applyDrizzleMigrationForTable,
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Center Agent Task Core RPC", () => {
  it("derives requester-private Task reads from verified active membership", async () => {
    const harness = createTaskHarness();
    try {
      const task = await seedTask(harness.db);
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
      } as unknown as CoreBindings;

      await expect(
        rpcListCenterAgentTasks(env, {
          context: contextFor("user-1"),
          limit: 40,
        })
      ).resolves.toMatchObject({
        organizationId: "org-1",
        tasks: [{ id: task.id, requesterUserId: "user-1" }],
      });
      await expect(
        rpcGetCenterAgentTask(env, {
          context: contextFor("user-1"),
          taskId: task.id,
        })
      ).resolves.toMatchObject({ task: { id: task.id } });
      await expect(
        rpcGetCenterAgentTask(env, {
          context: contextFor("user-2"),
          taskId: task.id,
        })
      ).rejects.toMatchObject({
        code: "center_agent_task.not_found",
        status: 404,
      });
    } finally {
      harness.close();
    }
  });

  it("projects strict v1 and v2 Task responses while v3 keeps provenance", async () => {
    const harness = createTaskHarness();
    try {
      const running = await seedTaskWithCompletedDelivery(
        harness.db,
        "running"
      );
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      const versionOne = await rpcGetCenterAgentTask(env, {
        context: contextFor("user-1"),
        taskId: running.id,
      });
      const versionTwo = await rpcGetCenterAgentTask(env, {
        context: contextFor("user-1"),
        responseContractVersion: 2,
        taskId: running.id,
      });
      const versionThree = await rpcGetCenterAgentTask(env, {
        context: contextFor("user-1"),
        responseContractVersion: 3,
        taskId: running.id,
      });

      expect(versionOne.task).toMatchObject({
        phase: "working",
        status: "running",
      });
      expect(versionOne.task).not.toHaveProperty("executionEvidence");
      expect(versionOne.task.origin).toEqual({ kind: "open_meld" });
      expect(versionTwo.task).toMatchObject({
        phase: null,
        status: "running",
      });
      expect(versionTwo.task.origin).toEqual({ kind: "open_meld" });
      expect(versionThree.task.origin).toEqual({
        kind: "open_meld",
        localAgent: { client: "codex", kind: "local_agent" },
        requestedBy: {
          displayName: "User One",
          profileId: "human-profile-1",
          userId: "user-1",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("rejects unknown RPC input and callers without active membership", async () => {
    const harness = createTaskHarness();
    try {
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
      } as unknown as CoreBindings;
      await expect(
        rpcListCenterAgentTasks(env, {
          context: contextFor("user-1"),
          unexpected: true,
        } as never)
      ).rejects.toMatchObject({ code: "invalid_payload", status: 400 });
      await expect(
        rpcListCenterAgentTasks(env, {
          context: contextFor("outsider"),
        })
      ).rejects.toMatchObject({
        code: "organization.membership_required",
        status: 403,
      });
    } finally {
      harness.close();
    }
  });

  it("does not report an unrelated terminal native delivery as stopped", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;
    const runtime = createCenterAgentTaskNativeRuntimePort({
      deliveryDb: harness.db,
      env,
    });
    try {
      for (const status of [
        "callback_rejected",
        "completed",
        "failed",
        "flag_rejected",
        "guardrail_rejected",
        "worker_unavailable",
      ] as const) {
        const delivery = await seedNativeDelivery(harness.db, {
          failureCode: status === "completed" ? null : `remote_agent.${status}`,
          id: `terminal-${status}`,
          status,
        });

        await expect(
          runtime.stopDelivery({
            deliveryId: delivery.deliveryId,
            organizationId: "org-1",
            requesterUserId: "user-1",
          })
        ).resolves.toBe("already_terminal");
      }
    } finally {
      harness.close();
    }
  });

  it("replays true only for a delivery already terminalized by Stop", async () => {
    const harness = createSqliteD1Harness();
    harness.run({
      sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY NOT NULL)",
    });
    harness.run({
      sql: "CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL)",
    });
    applyDrizzleMigrationsForTables(harness, [
      "openMeldRemoteAgent_native_delivery_ledger",
      "center_agent_tasks",
      "center_agent_task_attempts",
      "agent_task_completion_subscriptions",
    ]);
    const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;
    const runtime = createCenterAgentTaskNativeRuntimePort({
      deliveryDb: harness.db,
      env,
    });
    try {
      const delivery = await seedNativeDelivery(harness.db, {
        failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
        id: "terminal-stopped",
        status: "failed",
      });

      await expect(
        runtime.stopDelivery({
          deliveryId: delivery.deliveryId,
          organizationId: "org-1",
          requesterUserId: "user-1",
        })
      ).resolves.toBe("stopped");
    } finally {
      harness.close();
    }
  });

  it("stops a Needs action Task after its completed turn is already terminal", async () => {
    const harness = createTaskHarness();
    try {
      const waiting = await seedWaitingTaskWithCompletedDelivery(harness.db);
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      await expect(
        rpcStopCenterAgentTask(env, {
          context: contextFor("user-1"),
          expectedVersion: waiting.version,
          taskId: waiting.id,
        })
      ).resolves.toMatchObject({
        task: { id: waiting.id, status: "stopped" },
      });
    } finally {
      harness.close();
    }
  });

  it("does not report Stopped when a running Task delivery is already terminal", async () => {
    const harness = createTaskHarness();
    try {
      const running = await seedTaskWithCompletedDelivery(
        harness.db,
        "running"
      );
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      await expect(
        rpcStopCenterAgentTask(env, {
          context: contextFor("user-1"),
          expectedVersion: running.version,
          taskId: running.id,
        })
      ).rejects.toMatchObject({
        code: "center_agent_task.conflict",
        status: 409,
      });
      await expect(
        rpcGetCenterAgentTask(env, {
          context: contextFor("user-1"),
          taskId: running.id,
        })
      ).resolves.toMatchObject({
        events: [expect.objectContaining({ kind: "stop_requested" })],
        task: {
          id: running.id,
          phase: "stopping",
          status: "stopping",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("returns Stopping instead of 409 when native admission is still unknown", async () => {
    const harness = createTaskHarness();
    try {
      const queued = await seedTaskWithSubmittedDelivery(harness.db);
      const env = { OPENMELD_DB: harness.db } as unknown as CoreBindings;

      const stopping = await rpcStopCenterAgentTask(env, {
        context: contextFor("user-1"),
        expectedVersion: queued.version,
        taskId: queued.id,
      });

      expect(stopping).toMatchObject({
        events: [
          expect.objectContaining({
            kind: "stop_requested",
            text: "Stop requested. Waiting to confirm the current work has stopped.",
          }),
        ],
        task: {
          outcome: null,
          phase: "stopping",
          state: "active",
          status: "stopping",
        },
      });
      await expect(
        rpcStopCenterAgentTask(env, {
          context: contextFor("user-1"),
          expectedVersion: stopping.task.version,
          taskId: queued.id,
        })
      ).resolves.toMatchObject({
        events: [expect.objectContaining({ kind: "stop_requested" })],
        task: { status: "stopping", version: stopping.task.version },
      });
    } finally {
      harness.close();
    }
  });

  it("returns a durable replacement intent while native admission is still unknown", async () => {
    const harness = createTaskHarness();
    try {
      const queued = await seedTaskWithSubmittedDelivery(harness.db);
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
      } as unknown as CoreBindings;
      const request = {
        context: contextFor("user-1"),
        expectedVersion: queued.version,
        idempotencyKey: "replace-submitted-delivery",
        taskId: queued.id,
        text: "Replace this work with a security-focused review.",
      };

      const stopping = await rpcContinueCenterAgentTask(env, request);

      expect(stopping).toMatchObject({
        attempts: [{ generation: 1, status: "stopping" }],
        events: [
          expect.objectContaining({
            attemptGeneration: 1,
            kind: "stop_requested",
          }),
          expect.objectContaining({
            kind: "requester_message",
            text: request.text,
          }),
        ],
        task: {
          outcome: null,
          phase: "stopping",
          state: "active",
          status: "stopping",
          version: queued.version + 2,
        },
      });
      await expect(rpcContinueCenterAgentTask(env, request)).resolves.toEqual(
        stopping
      );
    } finally {
      harness.close();
    }
  });

  it("returns a typed RPC conflict when current Task admission authority is disabled", async () => {
    const harness = createTaskHarness();
    try {
      const queued = await seedTaskWithSubmittedDelivery(harness.db);
      const env = {
        OPENMELD_DB: harness.db,
        OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "false",
      } as unknown as CoreBindings;

      await expect(
        rpcContinueCenterAgentTask(env, {
          context: contextFor("user-1"),
          expectedVersion: queued.version,
          idempotencyKey: "continue-while-runtime-disabled",
          taskId: queued.id,
          text: "This mutation must fail closed.",
        })
      ).rejects.toMatchObject({
        code: "remote_agent.runtime_disabled",
        status: 409,
      });
      await expect(
        rpcGetCenterAgentTask(env, {
          context: contextFor("user-1"),
          taskId: queued.id,
        })
      ).resolves.toMatchObject({
        events: [],
        task: { status: "queued", version: queued.version },
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
      profileName: "Task tester",
      requestId: `request-${userId}`,
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    },
  };
}

async function seedTask(db: D1Database) {
  const created = await createCenterAgentTask({
    db,
    goal: "Research onboarding.",
    idempotencyKey: "seed-task",
    nowMs: 1000,
    organizationId: "org-1",
    origin: {
      kind: "open_meld",
      localAgent: { client: "codex", kind: "local_agent" },
      requestedBy: {
        displayName: "User One",
        profileId: "human-profile-1",
        userId: "user-1",
      },
    },
    requesterUserId: "user-1",
    taskId: "task-1",
    title: "Review onboarding",
  });
  return created.task;
}

async function seedNativeDelivery(
  db: D1Database,
  input: {
    failureCode: string | null;
    id: string;
    status:
      | "callback_rejected"
      | "completed"
      | "failed"
      | "flag_rejected"
      | "guardrail_rejected"
      | "submitted"
      | "worker_unavailable";
  }
) {
  return await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: null,
    bindingId: "binding-1",
    db,
    deliveryId: input.id,
    dispatchId: input.id,
    failureCode: input.failureCode,
    idempotencyKey: input.id,
    nowMs: 1000,
    onBehalfOfUserId: "user-1",
    onBehalfOfProfileId: "human-profile-1",
    organizationId: "org-1",
    profileId: "center-agent-1",
    spaceId: "center-agent-task:task-1",
    status: input.status,
    triggerMessageId: input.id,
  });
}

async function seedWaitingTaskWithCompletedDelivery(db: D1Database) {
  return await seedTaskWithCompletedDelivery(db, "needs_attention");
}

async function seedTaskWithSubmittedDelivery(db: D1Database) {
  const task = await seedTask(db);
  const deliveryId = "submitted-delivery";
  const attempt = await createCenterAgentTaskAttempt({
    attemptId: "submitted-attempt",
    db,
    expectedTaskVersion: task.version,
    idempotencyKey: "submitted-attempt",
    nowMs: 1001,
    organizationId: "org-1",
    taskHandle: { deliveryId, kind: "native_delivery", v: 1 },
    taskId: task.id,
  });
  await seedNativeDelivery(db, {
    failureCode: null,
    id: deliveryId,
    status: "submitted",
  });
  return attempt.task;
}

async function seedTaskWithCompletedDelivery(
  db: D1Database,
  status: "needs_attention" | "running"
) {
  const task = await seedTask(db);
  const deliveryId = `${status}-completed-delivery`;
  const attempt = await createCenterAgentTaskAttempt({
    attemptId: `${status}-attempt`,
    db,
    expectedTaskVersion: task.version,
    idempotencyKey: `${status}-attempt`,
    nowMs: 1001,
    organizationId: "org-1",
    taskHandle: { deliveryId, kind: "native_delivery", v: 1 },
    taskId: task.id,
  });
  const waiting = await transitionCenterAgentTaskAttempt({
    db,
    expectedTaskVersion: attempt.task.version,
    failureCode: null,
    generation: attempt.attempt.generation,
    nowMs: 1002,
    organizationId: "org-1",
    status,
    taskId: task.id,
  });
  await seedNativeDelivery(db, {
    failureCode: null,
    id: deliveryId,
    status: "completed",
  });
  return waiting.task;
}

function createTaskHarness() {
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
    sql: "CREATE TABLE openmeld_profiles (profile_id TEXT PRIMARY KEY NOT NULL, profile_name TEXT NOT NULL, profile_kind TEXT NOT NULL, status TEXT NOT NULL, organization_id TEXT, owner_user_id TEXT NOT NULL, managed_role TEXT)",
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_attempts",
    "center_agent_task_admission_outbox",
    "center_agent_task_events",
    "openMeldRemoteAgent_native_delivery_ledger",
    "center_agent_designations",
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
    sql: "INSERT INTO openmeld_profiles (profile_id, profile_name, profile_kind, status, organization_id, owner_user_id, managed_role) VALUES ('human-profile-1', 'User One', 'human', 'active', 'org-1', 'user-1', NULL), ('center-agent-1', 'Center Agent', 'agent', 'active', 'org-1', 'user-1', 'center_agent')",
  });
  harness.run({
    params: ["org-1", "center-agent-1", "user-1", 1000],
    sql: "INSERT INTO center_agent_designations (organization_id, agent_profile_id, designated_by, created_at) VALUES (?, ?, ?, ?)",
  });
  harness.run({
    params: [
      "binding-1",
      "owner_account",
      "user-1",
      "center-agent-1",
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
