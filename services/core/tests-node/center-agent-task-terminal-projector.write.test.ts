import { describe, expect, it } from "vitest";
import { projectCenterAgentTaskInboxItem } from "../src/center-agent-tasks/application/center-agent-task-inbox-producer";
import { projectCenterAgentTaskTerminal } from "../src/center-agent-tasks/application/center-agent-task-terminal-projector";
import {
  appendCenterAgentTaskEvent,
  createCenterAgentTask,
  createCenterAgentTaskAttempt,
  listCenterAgentTaskEvents,
  projectCenterAgentTaskAttemptEvent,
  readCenterAgentTask,
  requestCenterAgentTaskStop,
  transitionCenterAgentTaskAttempt,
} from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../src/runtime-transport/application/runtime-coordinator-authority";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = Date.parse("2026-08-08T03:00:00.000Z");

describe("Center Agent Task terminal projector", () => {
  it("fails closed when the typed Task identity disagrees with the delivery owner", async () => {
    const harness = createHarness();
    try {
      await seedRunningTask(harness, {
        deliveryId: "delivery-task-identity",
        taskId: "task-owner",
      });

      await expect(
        projectCenterAgentTaskTerminal({
          delivery: {
            deliveryId: "delivery-task-identity",
            failureCode: null,
            failureDetail: null,
            finalPublicationPayload: { text: "Completed." },
            organizationId: "org-a",
            status: "completed",
          },
          expectedTaskId: "task-other",
          inboxDb: harness.db,
          nowMs: NOW_MS + 3,
          taskDb: harness.db,
        })
      ).rejects.toThrow("center_agent_task.delivery_identity_mismatch");
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-owner",
        })
      ).resolves.toMatchObject({ status: "running" });
    } finally {
      harness.close();
    }
  });

  it("settles the matching current attempt once and appends one visible result", async () => {
    const harness = createHarness();
    try {
      await createCenterAgentTask({
        db: harness.db,
        goal: "Research competitor onboarding.",
        idempotencyKey: "create-task",
        nowMs: NOW_MS,
        organizationId: "org-a",
        origin: { kind: "open_meld" },
        requesterUserId: null,
        taskId: "task-1",
        title: "Research onboarding",
      });
      await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: null,
        db: harness.db,
        eventId: "task-created",
        expectedTaskVersion: 1,
        idempotencyKey: "task-created",
        kind: "task_created",
        observedAtMs: NOW_MS,
        occurredAtMs: NOW_MS,
        organizationId: "org-a",
        taskId: "task-1",
        text: "Task created.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "attempt-1",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "attempt-1",
        nowMs: NOW_MS + 1,
        organizationId: "org-a",
        taskHandle: {
          deliveryId: "delivery-1",
          kind: "native_delivery",
          v: 1,
        },
        taskId: "task-1",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: null,
        generation: 1,
        nowMs: NOW_MS + 2,
        organizationId: "org-a",
        status: "running",
        taskId: "task-1",
      });

      const input = {
        delivery: {
          deliveryId: "delivery-1",
          failureCode: null,
          failureDetail: null,
          finalPublicationPayload: {
            failureCode: null,
            failureDetail: null,
            resumeStatus: "accepted" as const,
            storageVersion: 1 as const,
            text: "Competitor onboarding research is complete.",
          },
          organizationId: "org-a",
          status: "completed" as const,
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 3,
        taskDb: harness.db,
      };
      await projectCenterAgentTaskTerminal(input);
      await projectCenterAgentTaskTerminal(input);

      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject({ status: "succeeded", version: 5 });
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        {
          attemptGeneration: 1,
          kind: "task_succeeded",
          text: "Competitor onboarding research is complete.",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("bounds a long successful result before writing the terminal event", async () => {
    const harness = createHarness();
    try {
      await seedRunningTask(harness, {
        deliveryId: "delivery-long-result",
        taskId: "task-long-result",
      });

      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: "delivery-long-result",
          failureCode: null,
          failureDetail: null,
          finalPublicationPayload: { text: "A".repeat(5000) },
          organizationId: "org-a",
          status: "completed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 3,
        taskDb: harness.db,
      });

      const events = await listCenterAgentTaskEvents({
        db: harness.db,
        organizationId: "org-a",
        taskId: "task-long-result",
      });
      const result = events.at(-1);
      expect(result).toMatchObject({ kind: "task_succeeded" });
      expect(result?.text).toHaveLength(4000);
      expect(result?.text.endsWith("…")).toBe(true);
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-long-result",
        })
      ).resolves.toMatchObject({ status: "succeeded" });
    } finally {
      harness.close();
    }
  });

  it("keeps raw delivery diagnostics out of the visible failure event", async () => {
    const harness = createHarness();
    try {
      await seedRunningTask(harness, {
        deliveryId: "delivery-private-error",
        taskId: "task-private-error",
      });

      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: "delivery-private-error",
          failureCode: "provider_failure",
          failureDetail:
            "ENOENT /Users/private/.openmeld/secrets/provider-token.json",
          finalPublicationPayload: null,
          organizationId: "org-a",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 3,
        taskDb: harness.db,
      });

      const events = await listCenterAgentTaskEvents({
        db: harness.db,
        organizationId: "org-a",
        taskId: "task-private-error",
      });
      expect(events.at(-1)).toMatchObject({
        kind: "task_failed",
        text: "Center Agent could not finish this Task. Retry it or open diagnostics.",
      });
      expect(events.at(-1)?.text).not.toContain("/Users/private");
      expect(events.at(-1)?.text).not.toContain("provider-token");
    } finally {
      harness.close();
    }
  });

  it("lets the requester retry when automatic Task conversation rollover failed", async () => {
    const harness = createHarness();
    try {
      await seedRunningTask(harness, {
        deliveryId: "delivery-history-limit",
        taskId: "task-history-limit",
      });

      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: "delivery-history-limit",
          failureCode: "remote_agent.conversation_history_limit_exceeded",
          failureDetail: "The private runtime transcript exceeded its limit.",
          finalPublicationPayload: null,
          organizationId: "org-a",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 3,
        taskDb: harness.db,
      });

      const events = await listCenterAgentTaskEvents({
        db: harness.db,
        organizationId: "org-a",
        taskId: "task-history-limit",
      });
      expect(events.at(-1)).toMatchObject({
        kind: "task_failed",
        text: "Center Agent could not continue this Task automatically. Retry it or open diagnostics.",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps an untrusted terminal callback behind the Stop fence", async () => {
    const harness = createHarness();
    try {
      const running = await seedRunningTask(harness, {
        deliveryId: "delivery-stopping",
        taskId: "task-stopping",
      });
      await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "stop-requested-stopping",
        expectedTaskVersion: running.version,
        idempotencyKey: "stop-requested-stopping",
        nowMs: NOW_MS + 3,
        organizationId: "org-a",
        taskId: running.id,
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      });

      await expect(
        projectCenterAgentTaskTerminal({
          delivery: {
            deliveryId: "delivery-stopping",
            failureCode: "provider_failure",
            failureDetail: "An untrusted late callback.",
            finalPublicationPayload: null,
            organizationId: "org-a",
            status: "failed",
          },
          inboxDb: harness.db,
          nowMs: NOW_MS + 4,
          taskDb: harness.db,
        })
      ).resolves.toEqual({
        outcome: "owner_rejected",
        payloadDisposition: "erase",
        reason: "active_stop_fence",
      });

      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: running.id,
        })
      ).resolves.toMatchObject({ status: "stopping", version: 5 });
      const events = await listCenterAgentTaskEvents({
        db: harness.db,
        organizationId: "org-a",
        taskId: running.id,
      });
      expect(events.map((event) => event.kind)).toEqual([
        "task_created",
        "stop_requested",
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps the Stop fence after confirmation times out and accepts the late stopped outcome", async () => {
    const harness = createHarness();
    try {
      const running = await seedRunningTask(harness, {
        deliveryId: "delivery-stop-timeout",
        requesterUserId: "user-a",
        taskId: "task-stop-timeout",
      });
      const stopping = await requestCenterAgentTaskStop({
        actor: "requester",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "stop-requested-timeout",
        expectedTaskVersion: running.version,
        idempotencyKey: "stop-requested-timeout",
        nowMs: NOW_MS + 3,
        organizationId: "org-a",
        taskId: running.id,
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      });
      const timedOut = await projectCenterAgentTaskAttemptEvent({
        db: harness.db,
        event: {
          actor: "system",
          attemptGeneration: 1,
          eventId: "stop-confirmation-timeout",
          idempotencyKey: "stop-confirmation-timeout",
          kind: "needs_attention",
          observedAtMs: NOW_MS + 4,
          occurredAtMs: NOW_MS + 4,
          text: "Task could not confirm that its previous work stopped.",
        },
        expectedTaskVersion: stopping.task.version,
        failureCode: null,
        generation: 1,
        nowMs: NOW_MS + 4,
        organizationId: "org-a",
        status: "needs_attention",
        taskId: running.id,
      });
      await projectCenterAgentTaskInboxItem({
        db: harness.db,
        event: timedOut.event,
        importance: "urgent",
        nowMs: NOW_MS + 4,
        task: timedOut.task,
      });

      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: "delivery-stop-timeout",
          failureCode: "provider_failure",
          failureDetail: "An untrusted late callback.",
          finalPublicationPayload: null,
          organizationId: "org-a",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 5,
        taskDb: harness.db,
      });

      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: running.id,
        })
      ).resolves.toMatchObject({ status: "needs_attention" });

      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: "delivery-stop-timeout",
          failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
          failureDetail:
            "The stopped outcome arrived after recovery timed out.",
          finalPublicationPayload: null,
          organizationId: "org-a",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 6,
        taskDb: harness.db,
      });

      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: running.id,
        })
      ).resolves.toMatchObject({ status: "stopped" });
      expect(
        harness.queryAll<{ attention: string; resolution_status: string }>({
          sql: "SELECT attention, resolution_status FROM inbox_items ORDER BY occurred_at_ms ASC",
        })
      ).toEqual([
        { attention: "action_required", resolution_status: "resolved" },
        { attention: "update", resolution_status: "not_applicable" },
      ]);
    } finally {
      harness.close();
    }
  });

  it("resolves the exact Needs action item when a waiting Task fails", async () => {
    const harness = createHarness();
    try {
      const task = await seedRunningTask(harness, {
        deliveryId: "delivery-needs-action",
        requesterUserId: "user-a",
        taskId: "task-needs-action",
      });
      const waiting = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: task.version,
        failureCode: null,
        generation: 1,
        nowMs: NOW_MS + 3,
        organizationId: "org-a",
        status: "needs_attention",
        taskId: task.id,
      });
      const attention = await appendCenterAgentTaskEvent({
        actor: "center_agent",
        attemptGeneration: 1,
        db: harness.db,
        eventId: "attention-event",
        expectedTaskVersion: waiting.task.version,
        idempotencyKey: "attention-event",
        kind: "needs_attention",
        observedAtMs: NOW_MS + 4,
        occurredAtMs: NOW_MS + 4,
        organizationId: "org-a",
        taskId: task.id,
        text: "Choose a release owner.",
      });
      const waitingTask = await readCenterAgentTask({
        db: harness.db,
        organizationId: "org-a",
        taskId: task.id,
      });
      expect(waitingTask).not.toBeNull();
      if (!waitingTask) {
        throw new Error("expected waiting Task");
      }
      await projectCenterAgentTaskInboxItem({
        db: harness.db,
        event: attention.event,
        nowMs: NOW_MS + 4,
        task: waitingTask,
      });

      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: "delivery-needs-action",
          failureCode: "provider_failure",
          failureDetail: "private provider detail",
          finalPublicationPayload: null,
          organizationId: "org-a",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 5,
        taskDb: harness.db,
      });

      expect(
        harness.queryAll<{ attention: string; resolution_status: string }>({
          sql: "SELECT attention, resolution_status FROM inbox_items ORDER BY occurred_at_ms ASC",
        })
      ).toEqual([
        { attention: "action_required", resolution_status: "resolved" },
        { attention: "update", resolution_status: "not_applicable" },
      ]);
    } finally {
      harness.close();
    }
  });

  it("erases a stale generation result without changing the active attempt", async () => {
    const harness = createHarness();
    try {
      const first = await seedRunningTask(harness, {
        deliveryId: "delivery-stale-generation",
        taskId: "task-stale-generation",
      });
      const failed = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: first.version,
        failureCode: "provider_failure",
        generation: 1,
        nowMs: NOW_MS + 3,
        organizationId: "org-a",
        status: "failed",
        taskId: first.id,
      });
      const second = await createCenterAgentTaskAttempt({
        attemptId: "attempt:task-stale-generation:2",
        db: harness.db,
        expectedTaskVersion: failed.task.version,
        idempotencyKey: "attempt:task-stale-generation:2",
        nowMs: NOW_MS + 4,
        organizationId: "org-a",
        taskHandle: {
          deliveryId: "delivery-current-generation",
          kind: "native_delivery",
          v: 1,
        },
        taskId: first.id,
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: second.task.version,
        failureCode: null,
        generation: 2,
        nowMs: NOW_MS + 5,
        organizationId: "org-a",
        status: "running",
        taskId: first.id,
      });

      await expect(
        projectCenterAgentTaskTerminal({
          delivery: {
            deliveryId: "delivery-stale-generation",
            failureCode: null,
            failureDetail: null,
            finalPublicationPayload: { text: "Superseded private result." },
            organizationId: "org-a",
            status: "completed",
          },
          inboxDb: harness.db,
          nowMs: NOW_MS + 6,
          taskDb: harness.db,
        })
      ).resolves.toEqual({
        outcome: "owner_rejected",
        payloadDisposition: "erase",
        reason: "stale_generation",
      });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: first.id,
        })
      ).resolves.toMatchObject({
        activeAttemptGeneration: 2,
        status: "running",
      });
    } finally {
      harness.close();
    }
  });

  it("erases a conflicting terminal result without rewriting Task truth", async () => {
    const harness = createHarness();
    try {
      const running = await seedRunningTask(harness, {
        deliveryId: "delivery-terminal-conflict",
        taskId: "task-terminal-conflict",
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: running.version,
        failureCode: "provider_failure",
        generation: 1,
        nowMs: NOW_MS + 3,
        organizationId: "org-a",
        status: "failed",
        taskId: running.id,
      });

      await expect(
        projectCenterAgentTaskTerminal({
          delivery: {
            deliveryId: "delivery-terminal-conflict",
            failureCode: null,
            failureDetail: null,
            finalPublicationPayload: { text: "Conflicting private result." },
            organizationId: "org-a",
            status: "completed",
          },
          inboxDb: harness.db,
          nowMs: NOW_MS + 4,
          taskDb: harness.db,
        })
      ).resolves.toEqual({
        outcome: "owner_rejected",
        payloadDisposition: "erase",
        reason: "terminal_conflict",
      });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: running.id,
        })
      ).resolves.toMatchObject({
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });
});

async function seedRunningTask(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    deliveryId: string;
    requesterUserId?: string | null;
    taskId: string;
  }
) {
  await createCenterAgentTask({
    db: harness.db,
    goal: "Research competitor onboarding.",
    idempotencyKey: `create:${input.taskId}`,
    nowMs: NOW_MS,
    organizationId: "org-a",
    origin: { kind: "open_meld" },
    requesterUserId: input.requesterUserId ?? null,
    taskId: input.taskId,
    title: "Research onboarding",
  });
  await appendCenterAgentTaskEvent({
    actor: "center_agent",
    attemptGeneration: null,
    db: harness.db,
    eventId: `created:${input.taskId}`,
    expectedTaskVersion: 1,
    idempotencyKey: `created:${input.taskId}`,
    kind: "task_created",
    observedAtMs: NOW_MS,
    occurredAtMs: NOW_MS,
    organizationId: "org-a",
    taskId: input.taskId,
    text: "Task created.",
  });
  await createCenterAgentTaskAttempt({
    attemptId: `attempt:${input.taskId}`,
    db: harness.db,
    expectedTaskVersion: 2,
    idempotencyKey: `attempt:${input.taskId}`,
    nowMs: NOW_MS + 1,
    organizationId: "org-a",
    taskHandle: {
      deliveryId: input.deliveryId,
      kind: "native_delivery",
      v: 1,
    },
    taskId: input.taskId,
  });
  const running = await transitionCenterAgentTaskAttempt({
    db: harness.db,
    expectedTaskVersion: 3,
    failureCode: null,
    generation: 1,
    nowMs: NOW_MS + 2,
    organizationId: "org-a",
    status: "running",
    taskId: input.taskId,
  });
  return running.task;
}

function createHarness() {
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
  harness.run({
    sql: "INSERT INTO organizations (id, name, slug, created_at) VALUES ('org-a', 'Org A', 'org-a', 1000)",
  });
  harness.run({
    sql: "INSERT INTO users (id, name, email) VALUES ('user-a', 'User A', 'user-a@example.test')",
  });
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_attempts",
    "center_agent_task_admission_outbox",
    "center_agent_task_events",
    "space_index_spaces",
    "space_index_memberships",
    "inbox_items",
    "inbox_email_deliveries",
  ]);
  return harness;
}
