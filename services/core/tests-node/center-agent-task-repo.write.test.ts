import { describe, expect, it } from "vitest";
import {
  appendCenterAgentTaskEvent,
  CenterAgentTaskConflictError,
  CenterAgentTaskEventConflictError,
  CenterAgentTaskVersionConflictError,
  claimCenterAgentTaskMutation,
  createCenterAgentTask,
  createCenterAgentTaskAttempt,
  listCenterAgentTaskAttempts,
  listCenterAgentTaskEvents,
  listCenterAgentTasksByRequesterUserId,
  projectCenterAgentTaskAttemptEvent,
  readActiveCenterAgentTaskStopIntentByDeliveryId,
  readCenterAgentTask,
  requestCenterAgentTaskStop,
  startCenterAgentTaskAttempt,
  transitionCenterAgentTaskAttempt,
} from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CREATED_AT_MS = Date.parse("2026-08-08T01:00:00.000Z");
const LARK_DESTINATION = {
  appId: "cli_aad19a1d2f389ed3",
  chatId: "oc_private_provider_chat",
  connectionId: "connection_123",
  provider: "lark",
  rootMessageId: "om_root_message_123",
  tenantKey: "tenant_123",
  threadId: "omt_thread_123",
} as const;

describe("Center Agent Task repository", () => {
  it("claims one Task mutation before external side effects", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      await expect(
        claimCenterAgentTaskMutation({
          db: harness.db,
          expectedTaskVersion: 1,
          nowMs: CREATED_AT_MS + 1,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject({ version: 2 });
      await expect(
        claimCenterAgentTaskMutation({
          db: harness.db,
          expectedTaskVersion: 1,
          nowMs: CREATED_AT_MS + 2,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).rejects.toBeInstanceOf(CenterAgentTaskVersionConflictError);
    } finally {
      harness.close();
    }
  });

  it("creates one canonical task per idempotency key and rejects changed replays", async () => {
    const harness = createTaskHarness();
    try {
      const input = createTaskInput(harness.db);
      const created = await createCenterAgentTask(input);

      expect(created).toMatchObject({
        outcome: "created",
        task: {
          activeAttemptGeneration: null,
          id: "task-1",
          requesterUserId: "user-a",
          status: "queued",
          version: 1,
        },
      });
      await expect(createCenterAgentTask(input)).resolves.toEqual({
        outcome: "replay",
        task: created.task,
      });
      await expect(
        createCenterAgentTask({
          ...input,
          title: "Changed title",
        })
      ).rejects.toBeInstanceOf(CenterAgentTaskConflictError);
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toEqual(created.task);
    } finally {
      harness.close();
    }
  });

  it("round-trips the exact immutable Message Channel destination", async () => {
    const harness = createTaskHarness();
    try {
      const created = await createCenterAgentTask({
        ...createTaskInput(harness.db),
        origin: {
          destination: LARK_DESTINATION,
          kind: "message_channel",
        },
      });

      expect(created.task.origin).toEqual({
        destination: LARK_DESTINATION,
        kind: "message_channel",
      });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject({
        origin: {
          destination: LARK_DESTINATION,
          kind: "message_channel",
        },
      });
    } finally {
      harness.close();
    }
  });

  it("scopes create idempotency to the exact requester", async () => {
    const harness = createTaskHarness();
    try {
      const requesterATask = await createCenterAgentTask(
        createTaskInput(harness.db)
      );
      const requesterBTask = await createCenterAgentTask({
        ...createTaskInput(harness.db),
        requesterUserId: "user-b",
        taskId: "task-user-b",
      });

      expect(requesterATask.task.requesterUserId).toBe("user-a");
      expect(requesterBTask).toMatchObject({
        outcome: "created",
        task: { id: "task-user-b", requesterUserId: "user-b" },
      });
    } finally {
      harness.close();
    }
  });

  it("lists only tasks attributed to the exact requester", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      await createCenterAgentTask({
        ...createTaskInput(harness.db),
        idempotencyKey: "create-task-2",
        nowMs: CREATED_AT_MS + 100,
        taskId: "task-2",
        title: "Second task",
      });
      await createCenterAgentTask({
        ...createTaskInput(harness.db),
        idempotencyKey: "create-task-unlinked",
        nowMs: CREATED_AT_MS + 200,
        origin: {
          destination: LARK_DESTINATION,
          kind: "message_channel",
        },
        requesterUserId: null,
        taskId: "task-unlinked",
        title: "Unlinked channel task",
      });
      await createCenterAgentTask({
        ...createTaskInput(harness.db),
        idempotencyKey: "create-task-user-b",
        nowMs: CREATED_AT_MS + 300,
        requesterUserId: "user-b",
        taskId: "task-user-b",
        title: "Another member task",
      });

      const listed = await listCenterAgentTasksByRequesterUserId({
        db: harness.db,
        limit: 10,
        organizationId: "org-a",
        requesterUserId: "user-a",
      });

      expect(listed.map((task) => task.id)).toEqual(["task-2", "task-1"]);
    } finally {
      harness.close();
    }
  });

  it("appends visible events idempotently and never changes an existing event", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      const input = {
        actor: "center_agent" as const,
        attemptGeneration: null,
        db: harness.db,
        eventId: "event-created",
        expectedTaskVersion: 1,
        idempotencyKey: "task-created-event",
        kind: "task_created" as const,
        observedAtMs: CREATED_AT_MS + 1,
        occurredAtMs: CREATED_AT_MS,
        organizationId: "org-a",
        taskId: "task-1",
        text: "Task created.",
      };
      const appended = await appendCenterAgentTaskEvent(input);

      expect(appended).toMatchObject({
        event: { id: "event-created", kind: "task_created" },
        outcome: "appended",
      });
      await expect(appendCenterAgentTaskEvent(input)).resolves.toEqual({
        event: appended.event,
        outcome: "replay",
      });
      await expect(
        readCenterAgentTask({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject({ version: 2 });
      await expect(
        appendCenterAgentTaskEvent({ ...input, text: "Changed event text." })
      ).rejects.toBeInstanceOf(CenterAgentTaskEventConflictError);
      await expect(
        appendCenterAgentTaskEvent({
          ...input,
          eventId: "event-stale",
          idempotencyKey: "task-stale-event",
        })
      ).rejects.toBeInstanceOf(CenterAgentTaskVersionConflictError);
      await appendCenterAgentTaskEvent({
        ...input,
        eventId: "event-update",
        expectedTaskVersion: 2,
        idempotencyKey: "task-update-event",
        kind: "center_agent_update",
        observedAtMs: CREATED_AT_MS + 11,
        occurredAtMs: CREATED_AT_MS + 10,
        text: "Research started.",
      });

      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject([
        { id: "event-created", text: "Task created." },
        { id: "event-update", text: "Research started." },
      ]);
    } finally {
      harness.close();
    }
  });

  it("atomically creates the accepted event and attempt with one Task revision", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      const input = {
        admission: {
          deliveryId: "delivery-atomic-start",
          instruction:
            "Research the current onboarding flow and summarize the gaps.",
          operationIdempotencyKey: "operation-atomic-start",
          parent: {
            kind: "submission" as const,
            submissionId: "submission-parent",
          },
          requesterUserId: "user-a",
          taskEventId: "event-atomic-start",
        },
        attemptId: "attempt-atomic-start",
        db: harness.db,
        event: {
          actor: "requester" as const,
          attemptGeneration: null,
          eventId: "event-atomic-start",
          idempotencyKey: "event-atomic-start",
          kind: "task_created" as const,
          observedAtMs: CREATED_AT_MS,
          occurredAtMs: CREATED_AT_MS,
          text: "Research the current onboarding flow and summarize the gaps.",
        },
        expectedTaskVersion: 1,
        idempotencyKey: "attempt-atomic-start",
        nowMs: CREATED_AT_MS + 1,
        organizationId: "org-a",
        taskHandle: {
          deliveryId: "delivery-atomic-start",
          kind: "native_delivery" as const,
          v: 1 as const,
        },
        taskId: "task-1",
      };

      const started = await startCenterAgentTaskAttempt(input);

      expect(started).toMatchObject({
        attempt: { generation: 1, status: "queued" },
        event: { kind: "task_created" },
        outcome: "created",
        task: { activeAttemptGeneration: 1, status: "queued", version: 2 },
      });
      await expect(startCenterAgentTaskAttempt(input)).resolves.toMatchObject({
        outcome: "replay",
        task: { version: 2 },
      });
      await expect(
        listCenterAgentTaskAttempts({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject([{ generation: 1, status: "queued" }]);
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject([{ kind: "task_created" }]);
    } finally {
      harness.close();
    }
  });

  it("atomically exposes Needs action with its visible event", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      await appendCenterAgentTaskEvent({
        actor: "requester",
        attemptGeneration: null,
        db: harness.db,
        eventId: "event-created-for-attention",
        expectedTaskVersion: 1,
        idempotencyKey: "event-created-for-attention",
        kind: "task_created",
        observedAtMs: CREATED_AT_MS,
        occurredAtMs: CREATED_AT_MS,
        organizationId: "org-a",
        taskId: "task-1",
        text: "Research the current onboarding flow and summarize the gaps.",
      });
      await createCenterAgentTaskAttempt({
        attemptId: "attempt-attention",
        db: harness.db,
        expectedTaskVersion: 2,
        idempotencyKey: "attempt-attention",
        nowMs: CREATED_AT_MS + 1,
        organizationId: "org-a",
        taskHandle: {
          deliveryId: "delivery-attention",
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
        nowMs: CREATED_AT_MS + 2,
        organizationId: "org-a",
        status: "running",
        taskId: "task-1",
      });

      const projected = await projectCenterAgentTaskAttemptEvent({
        db: harness.db,
        event: {
          actor: "center_agent",
          attemptGeneration: 1,
          eventId: "event-needs-attention",
          idempotencyKey: "event-needs-attention",
          kind: "needs_attention",
          observedAtMs: CREATED_AT_MS + 3,
          occurredAtMs: CREATED_AT_MS + 3,
          text: "Choose a release owner.",
        },
        expectedTaskVersion: 4,
        failureCode: null,
        generation: 1,
        nowMs: CREATED_AT_MS + 3,
        organizationId: "org-a",
        status: "needs_attention",
        taskId: "task-1",
      });

      expect(projected).toMatchObject({
        attempt: { status: "needs_attention" },
        event: { kind: "needs_attention", text: "Choose a release owner." },
        outcome: "projected",
        task: { status: "needs_attention", version: 5 },
      });
      await expect(
        listCenterAgentTaskEvents({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject([
        { kind: "task_created" },
        { kind: "needs_attention" },
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps an older generation terminal outcome from overwriting the current task", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      const first = await createCenterAgentTaskAttempt({
        attemptId: "attempt-1",
        db: harness.db,
        expectedTaskVersion: 1,
        idempotencyKey: "attempt-create-1",
        nowMs: CREATED_AT_MS + 100,
        organizationId: "org-a",
        taskHandle: { deliveryId: "delivery-1", kind: "native_delivery", v: 1 },
        taskId: "task-1",
      });
      expect(first).toMatchObject({
        attempt: { generation: 1, status: "queued" },
        outcome: "created",
        task: { activeAttemptGeneration: 1, status: "queued", version: 2 },
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 2,
        failureCode: null,
        generation: 1,
        nowMs: CREATED_AT_MS + 200,
        organizationId: "org-a",
        status: "running",
        taskId: "task-1",
      });
      const failed = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 3,
        failureCode: "execution_failed",
        generation: 1,
        nowMs: CREATED_AT_MS + 300,
        organizationId: "org-a",
        status: "failed",
        taskId: "task-1",
      });
      expect(failed.task).toMatchObject({ status: "failed", version: 4 });

      const second = await createCenterAgentTaskAttempt({
        attemptId: "attempt-2",
        db: harness.db,
        expectedTaskVersion: 4,
        idempotencyKey: "attempt-create-2",
        nowMs: CREATED_AT_MS + 400,
        organizationId: "org-a",
        taskHandle: { deliveryId: "delivery-2", kind: "native_delivery", v: 1 },
        taskId: "task-1",
      });
      expect(second.task).toMatchObject({
        activeAttemptGeneration: 2,
        status: "queued",
        version: 5,
      });
      await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 5,
        failureCode: null,
        generation: 2,
        nowMs: CREATED_AT_MS + 500,
        organizationId: "org-a",
        status: "running",
        taskId: "task-1",
      });

      const lateOldTerminal = await transitionCenterAgentTaskAttempt({
        db: harness.db,
        expectedTaskVersion: 6,
        failureCode: null,
        generation: 1,
        nowMs: CREATED_AT_MS + 600,
        organizationId: "org-a",
        status: "succeeded",
        taskId: "task-1",
      });

      expect(lateOldTerminal).toMatchObject({
        attempt: { generation: 1, status: "failed" },
        outcome: "terminal_conflict",
        task: {
          activeAttemptGeneration: 2,
          status: "running",
          version: 6,
        },
      });
      await expect(
        listCenterAgentTaskAttempts({
          db: harness.db,
          organizationId: "org-a",
          taskId: "task-1",
        })
      ).resolves.toMatchObject([
        { generation: 1, status: "failed" },
        { generation: 2, status: "running" },
      ]);
    } finally {
      harness.close();
    }
  });

  it("atomically records one active Stop intent and exposes it by native delivery", async () => {
    const harness = createTaskHarness();
    try {
      await createCenterAgentTask(createTaskInput(harness.db));
      const attempt = await createCenterAgentTaskAttempt({
        attemptId: "attempt-stop-1",
        db: harness.db,
        expectedTaskVersion: 1,
        idempotencyKey: "attempt-stop-1",
        nowMs: CREATED_AT_MS + 1,
        organizationId: "org-a",
        taskHandle: {
          deliveryId: "delivery-stop-1",
          kind: "native_delivery",
          v: 1,
        },
        taskId: "task-1",
      });
      const input = {
        actor: "requester" as const,
        attemptGeneration: attempt.attempt.generation,
        db: harness.db,
        eventId: "stop-requested-event-1",
        expectedTaskVersion: attempt.task.version,
        idempotencyKey: "stop-requested:task-1:1",
        nowMs: CREATED_AT_MS + 2,
        organizationId: "org-a",
        taskId: "task-1",
        text: "Stop requested. Waiting to confirm the current work has stopped.",
      };

      const requested = await requestCenterAgentTaskStop(input);

      expect(requested).toMatchObject({
        attempt: { generation: 1, status: "stopping" },
        event: { kind: "stop_requested" },
        outcome: "requested",
        task: { phase: "stopping", status: "stopping", version: 3 },
      });
      await expect(
        readActiveCenterAgentTaskStopIntentByDeliveryId({
          db: harness.db,
          deliveryId: "delivery-stop-1",
        })
      ).resolves.toEqual({
        attemptGeneration: 1,
        eventId: "stop-requested-event-1",
        taskId: "task-1",
      });
      await expect(requestCenterAgentTaskStop(input)).resolves.toMatchObject({
        event: { id: "stop-requested-event-1" },
        outcome: "replay",
        task: { status: "stopping", version: 3 },
      });
    } finally {
      harness.close();
    }
  });
});

function createTaskInput(db: D1Database) {
  return {
    db,
    goal: "Research the current onboarding flow and summarize the gaps.",
    idempotencyKey: "create-task-1",
    nowMs: CREATED_AT_MS,
    organizationId: "org-a",
    origin: { kind: "open_meld" } as const,
    requesterUserId: "user-a",
    taskId: "task-1",
    title: "Review onboarding flow",
  };
}

function createTaskHarness(): ReturnType<typeof createSqliteD1Harness> {
  const harness = createSqliteD1Harness();
  for (const sql of [
    "CREATE TABLE users (id text PRIMARY KEY NOT NULL)",
    "CREATE TABLE organizations (id text PRIMARY KEY NOT NULL)",
    "INSERT INTO users (id) VALUES ('user-a'), ('user-b')",
    "INSERT INTO organizations (id) VALUES ('org-a')",
  ]) {
    harness.run({ sql });
  }
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_attempts",
    "center_agent_task_admission_outbox",
    "center_agent_task_events",
  ]);
  return harness;
}
