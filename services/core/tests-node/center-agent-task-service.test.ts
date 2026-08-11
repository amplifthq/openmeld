import { describe, expect, it, vi } from "vitest";
import { projectCenterAgentTaskNeedsAttention } from "../src/center-agent-tasks/application/center-agent-task-attention-projector";
import {
  CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_MS,
  CenterAgentTaskApplicationError,
  type CenterAgentTaskParentDeliveryRef,
  type CenterAgentTaskRuntimePort,
  createCenterAgentTaskService,
  recoverCenterAgentTaskWork,
  resumeCenterAgentTaskPendingReplacement,
} from "../src/center-agent-tasks/application/center-agent-task-service";
import { projectCenterAgentTaskTerminal } from "../src/center-agent-tasks/application/center-agent-task-terminal-projector";
import {
  createCenterAgentTask,
  startCenterAgentTaskAttempt,
} from "../src/center-agent-tasks/infrastructure/d1/center-agent-task-repo";
import { RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE } from "../src/runtime-transport/application/runtime-coordinator-authority";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = Date.parse("2026-08-08T08:00:00.000Z");
const LARK_DESTINATION = {
  appId: "cli_aad19a1d2f389ed3",
  chatId: "oc_private_provider_chat",
  connectionId: "connection_123",
  provider: "lark",
  rootMessageId: "om_root_message_123",
  tenantKey: "tenant_123",
  threadId: "omt_thread_123",
} as const;

describe("Center Agent Task application service", () => {
  it("creates one requester-private running Task and returns it only to that requester", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await service.create({
        goal: "Research onboarding and summarize the gaps.",
        idempotencyKey: "create-one",
        organizationId: "org-one",
        parentSubmissionId: "parent-submission",
        requesterUserId: "user-one",
        title: "Review onboarding",
      });

      expect(created.task).toMatchObject({
        activeAttemptGeneration: 1,
        requesterUserId: "user-one",
        status: "running",
        version: 3,
      });
      expect(created.attempts).toMatchObject([
        { generation: 1, status: "running" },
      ]);
      expect(created.events).toMatchObject([
        {
          kind: "task_created",
          text: "Research onboarding and summarize the gaps.",
        },
      ]);
      expect(runtime.submissions).toHaveLength(1);
      await expect(
        service.list({
          limit: 40,
          organizationId: "org-one",
          requesterUserId: "user-one",
        })
      ).resolves.toMatchObject({ tasks: [{ id: created.task.id }] });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-two",
          taskId: created.task.id,
        })
      ).rejects.toMatchObject({
        code: "center_agent_task.not_found",
        status: 404,
      });

      const replay = await service.create({
        goal: "Research onboarding and summarize the gaps.",
        idempotencyKey: "create-one",
        organizationId: "org-one",
        parentSubmissionId: "parent-submission",
        requesterUserId: "user-one",
        title: "Review onboarding",
      });
      expect(replay).toEqual(created);
      expect(runtime.submissions).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("shows Working only while the execution owner supplies fresh evidence", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const deliveryId = runtime.submissions[0]?.deliveryId;
      expect(deliveryId).toBeTruthy();
      expect(created.task).toMatchObject({
        phase: null,
        state: "active",
        status: "running",
      });
      expect(created.task).not.toHaveProperty("executionEvidence");

      runtime.executionEvidenceByDeliveryId.set(deliveryId ?? "", {
        attemptGeneration: 1,
        kind: "native_delivery",
        observedAt: "2026-08-08T08:00:00.100Z",
      });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).resolves.toMatchObject({
        task: {
          executionEvidence: { attemptGeneration: 1 },
          phase: "working",
          state: "active",
        },
      });
      await expect(
        service.list({
          organizationId: "org-one",
          requesterUserId: "user-one",
        })
      ).resolves.toMatchObject({
        tasks: [
          { executionEvidence: { attemptGeneration: 1 }, phase: "working" },
        ],
      });

      runtime.executionEvidenceByDeliveryId.clear();
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).resolves.toMatchObject({ task: { phase: null, state: "active" } });

      runtime.executionEvidenceError = new Error("evidence store unavailable");
      await expect(
        service.list({
          organizationId: "org-one",
          requesterUserId: "user-one",
        })
      ).resolves.toMatchObject({ tasks: [{ phase: null, state: "active" }] });
      expect(warn).toHaveBeenCalledWith(
        "[core.center_agent_task.execution_evidence_unavailable]",
        expect.objectContaining({ organizationId: "org-one" })
      );
    } finally {
      warn.mockRestore();
      harness.close();
    }
  });

  it("replays an accepted create before current authority checks and rejects changed payloads", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      runtime.resolveParent = () =>
        Promise.reject(new Error("current parent lookup must not run"));
      runtime.authorizeTurn = () =>
        Promise.reject(new Error("current authority must not run"));

      await expect(createTask(service)).resolves.toEqual(created);
      await expect(
        service.create({
          goal: "A different goal must not reuse the accepted operation.",
          idempotencyKey: "create-one",
          organizationId: "org-one",
          parentSubmissionId: "parent-submission",
          requesterUserId: "user-one",
          title: "Review onboarding",
        })
      ).rejects.toMatchObject({ code: "center_agent_task.conflict" });
      expect(runtime.submissions).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("does not expose a Task if its initial event, attempt, and admission transaction cannot commit", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    const batch = vi
      .spyOn(harness.db, "batch")
      .mockRejectedValueOnce(new Error("simulated transaction interruption"));
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      await expect(createTask(service)).rejects.toThrow(
        "simulated transaction interruption"
      );
      expect(
        harness.queryAll<{ id: string }>({
          sql: "SELECT id FROM center_agent_tasks",
        })
      ).toEqual([]);
      expect(runtime.submissions).toHaveLength(0);
    } finally {
      batch.mockRestore();
      harness.close();
    }
  });

  it("freezes the exact Message Channel destination resolved from the parent delivery", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.resolveParent = async () => ({
      organizationId: "org-one",
      origin: {
        destination: LARK_DESTINATION,
        kind: "message_channel",
      },
      requesterUserId: "user-one",
    });
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);

      expect(created.task.origin).toEqual({
        destination: LARK_DESTINATION,
        kind: "message_channel",
      });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).resolves.toMatchObject({
        task: {
          origin: {
            destination: LARK_DESTINATION,
            kind: "message_channel",
          },
        },
      });
    } finally {
      harness.close();
    }
  });

  it("stops the current attempt before continuing in a new generation", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const continued = await service.continue({
        expectedVersion: created.task.version,
        idempotencyKey: "continue-one",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
        text: "Also compare the Slack entry point.",
      });

      expect(runtime.stoppedDeliveryIds).toEqual([
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "unexpected",
      ]);
      expect(continued.task).toMatchObject({
        activeAttemptGeneration: 2,
        status: "running",
        version: 8,
      });
      expect(continued.attempts).toMatchObject([
        { generation: 1, status: "stopped" },
        { generation: 2, status: "running" },
      ]);
      expect(
        continued.events.find(
          (event) =>
            event.kind === "requester_message" &&
            event.text === "Also compare the Slack entry point."
        )
      ).toMatchObject({
        actor: "requester",
        kind: "requester_message",
        text: "Also compare the Slack entry point.",
      });
      expect(runtime.submissions).toHaveLength(2);
      expect(runtime.submissions[1]?.parent).toEqual({
        deliveryId: runtime.stoppedDeliveryIds[0],
        kind: "delivery",
      });
    } finally {
      harness.close();
    }
  });

  it("continues a succeeded Task in the same Task Context as a new generation", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const deliveryId =
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "missing";
      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId,
          failureCode: null,
          failureDetail: null,
          finalPublicationPayload: { text: "The comparison is complete." },
          organizationId: "org-one",
          status: "completed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 100,
        taskDb: harness.db,
      });
      const succeeded = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });

      const continued = await service.continue({
        expectedVersion: succeeded.task.version,
        idempotencyKey: "follow-up-after-success",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: succeeded.task.id,
        text: "Turn that result into a five-step launch plan.",
      });

      expect(runtime.stoppedDeliveryIds).toEqual([]);
      expect(continued.task).toMatchObject({
        activeAttemptGeneration: 2,
        finishedAt: null,
        status: "running",
      });
      expect(continued.attempts).toMatchObject([
        { generation: 1, status: "succeeded" },
        { generation: 2, status: "running" },
      ]);
      expect(
        continued.events.find(
          (event) =>
            event.kind === "requester_message" &&
            event.text === "Turn that result into a five-step launch plan."
        )
      ).toMatchObject({
        actor: "requester",
        kind: "requester_message",
        text: "Turn that result into a five-step launch plan.",
      });
      expect(runtime.submissions[1]?.parent).toEqual({
        deliveryId,
        kind: "delivery",
      });
      const replay = await service.continue({
        expectedVersion: succeeded.task.version,
        idempotencyKey: "follow-up-after-success",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: succeeded.task.id,
        text: "Turn that result into a five-step launch plan.",
      });
      expect(replay).toEqual(continued);
      expect(runtime.submissions).toHaveLength(2);
      await expect(
        service.continue({
          expectedVersion: succeeded.task.version,
          idempotencyKey: "follow-up-after-success",
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: succeeded.task.id,
          text: "Silently replacing the accepted instruction is forbidden.",
        })
      ).rejects.toMatchObject({ code: "center_agent_task.conflict" });
    } finally {
      harness.close();
    }
  });

  it("lets only one same-version Stop or Continue mutation claim the Task", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);

      const results = await Promise.allSettled([
        service.stop({
          expectedVersion: created.task.version,
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        }),
        service.continue({
          expectedVersion: created.task.version,
          idempotencyKey: "continue-racing-stop",
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
          text: "Also compare the Slack entry point.",
        }),
      ]);

      const fulfilled = results.filter(
        (
          result
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<Service["get"]>>
        > => result.status === "fulfilled"
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({
        code: "center_agent_task.version_conflict",
        status: 409,
      });
      expect(runtime.stoppedDeliveryIds).toHaveLength(1);

      const current = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });
      expect(["running", "stopped"]).toContain(current.task.status);
      expect(current.task.version).toBe(
        current.task.status === "running" ? 8 : 5
      );
    } finally {
      harness.close();
    }
  });

  it("keeps an ambiguous admission queued without changing an accepted replay", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    let submissionCount = 0;
    runtime.submitTurn = (input) => {
      runtime.submissions.push({
        deliveryId: input.deliveryId,
        instruction: input.instruction,
        parent: input.parent,
        taskId: input.taskId,
      });
      submissionCount += 1;
      return Promise.resolve({
        outcome: submissionCount === 1 ? "unknown" : "accepted",
      });
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });

      const recovering = await createTask(service);

      expect(recovering.task).toMatchObject({ status: "queued", version: 2 });
      expect(recovering.attempts).toMatchObject([
        { generation: 1, status: "queued" },
      ]);
      expect(recovering.events).toMatchObject([{ kind: "task_created" }]);
      expect(
        recovering.events.some((event) => event.kind === "task_failed")
      ).toBe(false);

      const replayed = await createTask(service);
      expect(replayed.task).toMatchObject({ status: "queued", version: 2 });
      expect(replayed.attempts).toMatchObject([
        { generation: 1, status: "queued" },
      ]);
      expect(runtime.submissions).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("redrives an admission left pending after the Task transaction commits", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const created = await createCenterAgentTask({
        db: harness.db,
        goal: "Recover this admission after a process crash.",
        idempotencyKey: "crash-window-task",
        nowMs: NOW_MS,
        organizationId: "org-one",
        origin: { kind: "open_meld" },
        requesterUserId: "user-one",
        taskId: "crash-window-task",
        title: "Recover admission",
      });
      await startCenterAgentTaskAttempt({
        admission: {
          deliveryId: "crash-window-delivery",
          instruction: created.task.goal,
          operationIdempotencyKey: "crash-window-task",
          parent: {
            kind: "submission",
            submissionId: "parent-submission",
          },
          requesterUserId: "user-one",
          taskEventId: "crash-window-event",
        },
        attemptId: "crash-window-attempt",
        db: harness.db,
        event: {
          actor: "requester",
          attemptGeneration: null,
          eventId: "crash-window-event",
          idempotencyKey: "crash-window-event",
          kind: "task_created",
          observedAtMs: NOW_MS + 1,
          occurredAtMs: NOW_MS + 1,
          text: created.task.goal,
        },
        expectedTaskVersion: created.task.version,
        idempotencyKey: "attempt:crash-window-task",
        nowMs: NOW_MS + 1,
        organizationId: "org-one",
        taskHandle: {
          deliveryId: "crash-window-delivery",
          kind: "native_delivery",
          v: 1,
        },
        taskId: created.task.id,
      });

      expect(runtime.submissions).toHaveLength(0);
      expect(
        harness.queryAll<{ state: string }>({
          sql: "SELECT state FROM center_agent_task_admission_outbox",
        })
      ).toEqual([{ state: "pending" }]);

      await expect(
        recoverCenterAgentTaskWork({
          db: harness.db,
          inboxDb: harness.db,
          now: tickingClock(),
          runtime,
        })
      ).resolves.toMatchObject({
        admissionsDelivered: 1,
        errors: 0,
      });
      expect(runtime.submissions).toMatchObject([
        {
          deliveryId: "crash-window-delivery",
          instruction: created.task.goal,
          taskId: created.task.id,
        },
      ]);
      expect(
        harness.queryAll<{ attempt_count: number; state: string }>({
          sql: "SELECT attempt_count, state FROM center_agent_task_admission_outbox",
        })
      ).toEqual([{ attempt_count: 1, state: "delivered" }]);
      const service = createCenterAgentTaskService({
        db: harness.db,
        runtime,
      });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).resolves.toMatchObject({
        attempts: [{ generation: 1, status: "running" }],
        task: { status: "running" },
      });
    } finally {
      harness.close();
    }
  });

  it("rechecks current authority before Continue or Retry mutates the Task", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      runtime.authorizeTurn = () =>
        Promise.reject(new Error("remote_agent.organization_blocked"));

      await expect(
        service.continue({
          expectedVersion: created.task.version,
          idempotencyKey: "blocked-continue",
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
          text: "This must not be accepted.",
        })
      ).rejects.toThrow("remote_agent.organization_blocked");
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).resolves.toMatchObject({
        attempts: [{ generation: 1, status: "running" }],
        events: [{ kind: "task_created" }],
        task: { status: "running", version: created.task.version },
      });

      runtime.authorizeTurn = async () => undefined;
      const stopped = await service.stop({
        expectedVersion: created.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });
      runtime.authorizeTurn = () =>
        Promise.reject(new Error("remote_agent.center_agent_paused"));
      await expect(
        service.retry({
          expectedVersion: stopped.task.version,
          idempotencyKey: "blocked-retry",
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: stopped.task.id,
        })
      ).rejects.toThrow("remote_agent.center_agent_paused");
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: stopped.task.id,
        })
      ).resolves.toMatchObject({
        attempts: [{ generation: 1, status: "stopped" }],
        task: { status: "stopped", version: stopped.task.version },
      });
    } finally {
      harness.close();
    }
  });

  it("rechecks current authority before a delayed replacement creates its attempt", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stop_requested");
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const deliveryId =
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "missing";
      const stopping = await service.continue({
        expectedVersion: created.task.version,
        idempotencyKey: "delayed-replacement",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
        text: "Replace the current work with a security review.",
      });
      expect(stopping.task.status).toBe("stopping");
      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId,
          failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
          failureDetail: null,
          finalPublicationPayload: null,
          organizationId: "org-one",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 100,
        taskDb: harness.db,
      });
      runtime.authorizeTurn = () =>
        Promise.reject(new Error("remote_agent.center_agent_paused"));

      await expect(
        resumeCenterAgentTaskPendingReplacement({
          db: harness.db,
          deliveryId,
          inboxDb: harness.db,
          now: tickingClock(),
          organizationId: "org-one",
          runtime,
          taskId: created.task.id,
        })
      ).rejects.toThrow("remote_agent.center_agent_paused");
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).resolves.toMatchObject({
        attempts: [{ generation: 1, status: "stopped" }],
        task: { activeAttemptGeneration: 1, status: "stopped" },
      });
    } finally {
      harness.close();
    }
  });

  it("persists one Stop intent and stays Stopping until an ambiguous admission is authoritatively stopped", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.submitTurn = () => Promise.resolve({ outcome: "unknown" });
    const stopOutcomes = ["stop_requested", "stopped"] as const;
    let stopAttempt = 0;
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      const outcome = stopOutcomes[stopAttempt] ?? "stopped";
      stopAttempt += 1;
      return Promise.resolve(outcome);
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const recovering = await createTask(service);

      const stopping = await service.stop({
        expectedVersion: recovering.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: recovering.task.id,
      });

      expect(stopping.task).toMatchObject({
        outcome: null,
        phase: "stopping",
        state: "active",
        status: "stopping",
      });
      expect(stopping.attempts).toMatchObject([
        { generation: 1, status: "stopping" },
      ]);
      expect(
        stopping.events.filter((event) => event.kind === "stop_requested")
      ).toMatchObject([
        {
          actor: "requester",
          attemptGeneration: 1,
          text: "Stop requested. Waiting to confirm the current work has stopped.",
        },
      ]);

      const stopped = await service.stop({
        expectedVersion: stopping.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: stopping.task.id,
      });

      expect(stopped.task.status).toBe("stopped");
      expect(
        stopped.events.filter((event) => event.kind === "stop_requested")
      ).toHaveLength(1);
      expect(stopped.events.at(-1)).toMatchObject({
        kind: "task_stopped",
        text: "Task stopped.",
      });
      expect(runtime.stoppedDeliveryIds).toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("requires visible action when Stop cannot be confirmed within the bounded recovery window", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stop_requested");
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const stopping = await service.stop({
        expectedVersion: created.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });
      const timeoutClock = () =>
        NOW_MS + CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_MS + 10_000;

      await expect(
        recoverCenterAgentTaskWork({
          db: harness.db,
          inboxDb: harness.db,
          now: timeoutClock,
          runtime,
        })
      ).resolves.toMatchObject({
        errors: 0,
        stopsFailed: 1,
        stopsPending: 0,
      });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: stopping.task.id,
        })
      ).resolves.toMatchObject({
        attempts: [
          {
            failureCode: null,
            status: "needs_attention",
          },
        ],
        events: [
          expect.objectContaining({ kind: "task_created" }),
          expect.objectContaining({ kind: "stop_requested" }),
          expect.objectContaining({
            kind: "needs_attention",
            text: "Task could not confirm that its previous work stopped. Open diagnostics with code center_agent_task.stop_confirmation_timeout, then try Stop again.",
          }),
        ],
        task: { status: "needs_attention" },
      });
      expect(
        harness.queryAll<{ attention: string; importance: string }>({
          sql: "SELECT attention, importance FROM inbox_items",
        })
      ).toEqual([{ attention: "action_required", importance: "urgent" }]);

      runtime.stopDelivery = ({ deliveryId }) => {
        runtime.stoppedDeliveryIds.push(deliveryId);
        return Promise.resolve("stopped");
      };
      const needsAction = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: stopping.task.id,
      });
      await expect(
        service.stop({
          expectedVersion: needsAction.task.version,
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: needsAction.task.id,
        })
      ).resolves.toMatchObject({ task: { status: "stopped" } });
    } finally {
      harness.close();
    }
  });

  it("starts a fresh confirmation window when the requester retries a timed-out Stop", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stop_requested");
    };
    let nowMs = NOW_MS;
    const now = () => {
      nowMs += 1;
      return nowMs;
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now,
        runtime,
      });
      const created = await createTask(service);
      const firstStop = await service.stop({
        expectedVersion: created.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });

      nowMs = NOW_MS + CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_MS + 10_000;
      await recoverCenterAgentTaskWork({
        db: harness.db,
        inboxDb: harness.db,
        now,
        runtime,
      });
      const needsAction = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: firstStop.task.id,
      });
      expect(needsAction.task.status).toBe("needs_attention");

      const retrying = await service.stop({
        expectedVersion: needsAction.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: needsAction.task.id,
      });
      expect(retrying.task.status).toBe("stopping");
      expect(
        retrying.events.filter((event) => event.kind === "stop_requested")
      ).toHaveLength(2);

      await expect(
        recoverCenterAgentTaskWork({
          db: harness.db,
          inboxDb: harness.db,
          now,
          runtime,
        })
      ).resolves.toMatchObject({
        errors: 0,
        stopsFailed: 0,
        stopsPending: 1,
      });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: retrying.task.id,
        })
      ).resolves.toMatchObject({ task: { status: "stopping" } });
    } finally {
      harness.close();
    }
  });

  it("durably fences an ambiguous admission before accepting a replacement instruction", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.submitTurn = (input) => {
      runtime.submissions.push({
        deliveryId: input.deliveryId,
        instruction: input.instruction,
        parent: input.parent,
        taskId: input.taskId,
      });
      return Promise.resolve({ outcome: "unknown" });
    };
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stop_requested");
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const recovering = await createTask(service);
      const command = {
        expectedVersion: recovering.task.version,
        idempotencyKey: "replace-ambiguous-admission",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: recovering.task.id,
        text: "Replace the current work with a security-focused review.",
      };

      const stopping = await service.continue(command);

      expect(stopping.task).toMatchObject({
        outcome: null,
        phase: "stopping",
        state: "active",
        status: "stopping",
        version: recovering.task.version + 2,
      });
      expect(stopping.attempts).toMatchObject([
        { generation: 1, status: "stopping" },
      ]);
      expect(stopping.events.slice(-2)).toMatchObject([
        {
          actor: "requester",
          attemptGeneration: 1,
          kind: "stop_requested",
        },
        {
          actor: "requester",
          attemptGeneration: null,
          kind: "requester_message",
          text: command.text,
        },
      ]);
      expect(runtime.submissions).toHaveLength(1);

      const replay = await service.continue(command);
      expect(replay).toEqual(stopping);
      expect(
        replay.events.filter((event) => event.kind === "stop_requested")
      ).toHaveLength(1);
      expect(
        replay.events.filter((event) => event.kind === "requester_message")
      ).toHaveLength(1);
      expect(runtime.submissions).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("starts a saved replacement when an explicit Stop retry confirms the timed-out execution", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stop_requested");
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const stopping = await service.continue({
        expectedVersion: created.task.version,
        idempotencyKey: "replacement-after-stop-timeout",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
        text: "Run the replacement security review.",
      });
      const timeoutClock = () =>
        NOW_MS + CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_MS + 10_000;
      await recoverCenterAgentTaskWork({
        db: harness.db,
        inboxDb: harness.db,
        now: timeoutClock,
        runtime,
      });
      const needsAction = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: stopping.task.id,
      });
      expect(needsAction.task.status).toBe("needs_attention");

      runtime.stopDelivery = ({ deliveryId }) => {
        runtime.stoppedDeliveryIds.push(deliveryId);
        return Promise.resolve("stopped");
      };
      const resumed = await service.stop({
        expectedVersion: needsAction.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: needsAction.task.id,
      });

      expect(resumed).toMatchObject({
        attempts: [
          { generation: 1, status: "stopped" },
          { generation: 2, status: "running" },
        ],
        task: { activeAttemptGeneration: 2, status: "running" },
      });
      expect(runtime.submissions.at(-1)).toMatchObject({
        instruction: "Run the replacement security review.",
      });
    } finally {
      harness.close();
    }
  });

  it("uses the prior attempt delivery when retrying the same Task", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const priorDeliveryId =
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "missing";
      const stopped = await service.stop({
        expectedVersion: created.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });

      const retried = await service.retry({
        expectedVersion: stopped.task.version,
        idempotencyKey: "retry-prior-delivery",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: stopped.task.id,
      });

      expect(retried.task).toMatchObject({
        activeAttemptGeneration: 2,
        status: "running",
      });
      expect(runtime.submissions.at(-1)?.parent).toEqual({
        deliveryId: priorDeliveryId,
        kind: "delivery",
      });
    } finally {
      harness.close();
    }
  });

  it("retries the same Task after automatic conversation rollover", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const deliveryId =
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "missing";
      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId,
          failureCode: "remote_agent.conversation_history_limit_exceeded",
          failureDetail: null,
          finalPublicationPayload: null,
          organizationId: "org-one",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 100,
        taskDb: harness.db,
      });
      const failed = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });

      await expect(
        service.retry({
          expectedVersion: failed.task.version,
          idempotencyKey: "retry-history-limit",
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: failed.task.id,
        })
      ).resolves.toMatchObject({
        task: {
          activeAttemptGeneration: 2,
          status: "running",
        },
      });
      expect(runtime.submissions).toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("stops visibly and retries only a failed or stopped Task as a new attempt", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      await expect(
        service.retry({
          expectedVersion: created.task.version,
          idempotencyKey: "retry-running",
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: created.task.id,
        })
      ).rejects.toBeInstanceOf(CenterAgentTaskApplicationError);

      const stopped = await service.stop({
        expectedVersion: created.task.version,
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });
      expect(stopped.task).toMatchObject({ status: "stopped", version: 5 });
      expect(stopped.events.at(-1)).toMatchObject({
        kind: "task_stopped",
        text: "Task stopped.",
      });
      const stoppedDeliveryId = runtime.stoppedDeliveryIds[0];
      expect(stoppedDeliveryId).toBeTruthy();
      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId: stoppedDeliveryId ?? "missing",
          failureCode: RUNTIME_COORDINATOR_PRE_AGENT_STOP_REQUESTED_REASON_CODE,
          failureDetail: null,
          finalPublicationPayload: null,
          organizationId: "org-one",
          status: "failed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 100,
        taskDb: harness.db,
      });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: stopped.task.id,
        })
      ).resolves.toMatchObject({
        events: [
          expect.objectContaining({ kind: "task_created" }),
          expect.objectContaining({ kind: "stop_requested" }),
          expect.objectContaining({ kind: "task_stopped" }),
        ],
        task: { version: 5 },
      });

      const retried = await service.retry({
        expectedVersion: stopped.task.version,
        idempotencyKey: "retry-stopped",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: stopped.task.id,
      });
      expect(retried.task).toMatchObject({
        activeAttemptGeneration: 2,
        status: "running",
        version: 7,
      });
      expect(retried.attempts).toMatchObject([
        { generation: 1, status: "stopped" },
        { generation: 2, status: "running" },
      ]);
      expect(runtime.submissions.at(-1)?.parent).toEqual({
        deliveryId: stoppedDeliveryId,
        kind: "delivery",
      });
    } finally {
      harness.close();
    }
  });

  it("paginates requester Tasks without returning duplicates", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      for (const idempotencyKey of [
        "create-one",
        "create-two",
        "create-three",
      ]) {
        await service.create({
          goal: `Research ${idempotencyKey}.`,
          idempotencyKey,
          organizationId: "org-one",
          parentSubmissionId: "parent-submission",
          requesterUserId: "user-one",
          title: `Task ${idempotencyKey}`,
        });
      }

      const firstPage = await service.list({
        limit: 2,
        organizationId: "org-one",
        requesterUserId: "user-one",
      });
      expect(firstPage.tasks).toHaveLength(2);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondPage = await service.list({
        cursor: firstPage.nextCursor ?? undefined,
        limit: 2,
        organizationId: "org-one",
        requesterUserId: "user-one",
      });
      expect(secondPage.tasks).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        new Set(
          [...firstPage.tasks, ...secondPage.tasks].map((task) => task.id)
        ).size
      ).toBe(3);
    } finally {
      harness.close();
    }
  });

  it("keeps a non-durable native submission pending for recovery and redrive", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.submitTurn = () => {
      return Promise.reject(
        new Error("center_agent_task.submission_request_not_durable")
      );
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      await expect(createTask(service)).rejects.toThrow(
        "center_agent_task.submission_request_not_durable"
      );

      const listed = await service.list({
        organizationId: "org-one",
        requesterUserId: "user-one",
      });
      expect(listed.tasks).toMatchObject([
        { status: "queued", requesterUserId: "user-one" },
      ]);
      const detail = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: listed.tasks[0]?.id ?? "missing",
      });
      expect(detail.events).toMatchObject([{ kind: "task_created" }]);
      expect(
        harness.queryAll<{ state: string }>({
          sql: "SELECT state FROM center_agent_task_admission_outbox",
        })
      ).toEqual([{ state: "pending" }]);
      expect(
        harness.queryAll<{ source_kind: string }>({
          sql: "SELECT source_kind FROM inbox_items",
        })
      ).toEqual([]);

      runtime.submitTurn = (submission) => {
        runtime.submissions.push({
          deliveryId: submission.deliveryId,
          instruction: submission.instruction,
          parent: submission.parent,
          taskId: submission.taskId,
        });
        return Promise.resolve({ outcome: "accepted" });
      };
      await expect(
        recoverCenterAgentTaskWork({
          db: harness.db,
          inboxDb: harness.db,
          now: tickingClock(),
          runtime,
        })
      ).resolves.toMatchObject({ admissionsDelivered: 1, errors: 0 });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: detail.task.id,
        })
      ).resolves.toMatchObject({ task: { status: "running" } });
      expect(
        harness.queryAll<{ state: string }>({
          sql: "SELECT state FROM center_agent_task_admission_outbox",
        })
      ).toEqual([{ state: "delivered" }]);
    } finally {
      harness.close();
    }
  });

  it("settles a durable native owner rejection as one visible Task failure", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.submitTurn = () =>
      Promise.resolve({
        failureCode: "remote_agent.worker_rejected",
        failureDetail: "The native delivery owner rejected the attempt.",
        outcome: "rejected" as const,
      });
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      await expect(createTask(service)).rejects.toMatchObject({
        code: "remote_agent.worker_rejected",
      });
      const listed = await service.list({
        organizationId: "org-one",
        requesterUserId: "user-one",
      });
      expect(listed.tasks).toMatchObject([{ status: "failed" }]);
      expect(
        harness.queryAll<{ last_failure_code: string; state: string }>({
          sql: "SELECT last_failure_code, state FROM center_agent_task_admission_outbox",
        })
      ).toEqual([
        {
          last_failure_code: "remote_agent.worker_rejected",
          state: "failed",
        },
      ]);
      expect(
        harness.queryAll<{ source_kind: string }>({
          sql: "SELECT source_kind FROM inbox_items",
        })
      ).toEqual([{ source_kind: "center_agent_task_event" }]);
    } finally {
      harness.close();
    }
  });

  it("counts a durable rejection during redrive as a failed admission, not a recovery error", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.submitTurn = () =>
      Promise.reject(
        new Error("center_agent_task.submission_request_not_durable")
      );
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      await expect(createTask(service)).rejects.toThrow(
        "center_agent_task.submission_request_not_durable"
      );

      runtime.submitTurn = () =>
        Promise.resolve({
          failureCode: "remote_agent.worker_rejected",
          failureDetail: "The native delivery owner rejected the attempt.",
          outcome: "rejected" as const,
        });
      await expect(
        recoverCenterAgentTaskWork({
          db: harness.db,
          inboxDb: harness.db,
          now: tickingClock(),
          runtime,
        })
      ).resolves.toMatchObject({
        admissionsFailed: 1,
        errors: 0,
      });

      const listed = await service.list({
        organizationId: "org-one",
        requesterUserId: "user-one",
      });
      expect(listed.tasks).toMatchObject([{ status: "failed" }]);
      expect(
        harness.queryAll<{ last_failure_code: string; state: string }>({
          sql: "SELECT last_failure_code, state FROM center_agent_task_admission_outbox",
        })
      ).toEqual([
        {
          last_failure_code: "remote_agent.worker_rejected",
          state: "failed",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps a completed attempt in Needs action until the requester continues it", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("already_terminal");
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const deliveryId =
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "missing";

      await projectCenterAgentTaskNeedsAttention({
        deliveryId,
        importance: "normal",
        inboxDb: harness.db,
        nowMs: NOW_MS + 100,
        organizationId: "org-one",
        prompt: "Choose whether the release should go today or tomorrow.",
        requestId: "attention-one",
        taskDb: harness.db,
      });
      await projectCenterAgentTaskTerminal({
        delivery: {
          deliveryId,
          failureCode: null,
          failureDetail: null,
          finalPublicationPayload: {
            text: "I need your release timing decision.",
          },
          organizationId: "org-one",
          status: "completed",
        },
        inboxDb: harness.db,
        nowMs: NOW_MS + 101,
        taskDb: harness.db,
      });
      await projectCenterAgentTaskNeedsAttention({
        deliveryId,
        importance: "normal",
        inboxDb: harness.db,
        nowMs: NOW_MS + 102,
        organizationId: "org-one",
        prompt: "Choose whether the release should go today or tomorrow.",
        requestId: "attention-one",
        taskDb: harness.db,
      });

      const waiting = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });
      expect(waiting.task.status).toBe("needs_attention");
      expect(
        waiting.events.filter((event) => event.kind === "needs_attention")
      ).toMatchObject([
        {
          actor: "center_agent",
          text: "Choose whether the release should go today or tomorrow.",
        },
      ]);
      expect(
        waiting.events.some((event) => event.kind === "task_succeeded")
      ).toBe(false);
      expect(
        harness.queryAll<{ attention: string }>({
          sql: "SELECT attention FROM inbox_items",
        })
      ).toEqual([{ attention: "action_required" }]);

      const continued = await service.continue({
        expectedVersion: waiting.task.version,
        idempotencyKey: "continue-after-attention",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: waiting.task.id,
        text: "Ship tomorrow.",
      });
      expect(continued.task).toMatchObject({
        activeAttemptGeneration: 2,
        status: "running",
      });
      expect(runtime.stoppedDeliveryIds).toEqual([deliveryId]);
      expect(
        harness.queryAll<{ attention: string; resolution_status: string }>({
          sql: "SELECT attention, resolution_status FROM inbox_items",
        })
      ).toEqual([
        {
          attention: "action_required",
          resolution_status: "resolved",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("persists a Needs action answer while asynchronous Stop is still settling", async () => {
    const harness = createTaskHarness();
    const runtime = createRuntime();
    runtime.stopDelivery = ({ deliveryId }) => {
      runtime.stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stop_requested");
    };
    try {
      const service = createCenterAgentTaskService({
        db: harness.db,
        now: tickingClock(),
        runtime,
      });
      const created = await createTask(service);
      const deliveryId =
        created.attempts[0]?.taskHandle.kind === "native_delivery"
          ? created.attempts[0].taskHandle.deliveryId
          : "missing";
      await projectCenterAgentTaskNeedsAttention({
        deliveryId,
        importance: "normal",
        inboxDb: harness.db,
        nowMs: NOW_MS + 100,
        organizationId: "org-one",
        prompt: "Choose the release day.",
        requestId: "async-attention",
        taskDb: harness.db,
      });
      const waiting = await service.get({
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: created.task.id,
      });

      const stopping = await service.continue({
        expectedVersion: waiting.task.version,
        idempotencyKey: "async-attention-answer",
        organizationId: "org-one",
        requesterUserId: "user-one",
        taskId: waiting.task.id,
        text: "Ship tomorrow.",
      });
      expect(stopping.task.status).toBe("stopping");
      expect(stopping.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "requester_message",
            text: "Ship tomorrow.",
          }),
        ])
      );
      expect(runtime.submissions).toHaveLength(1);

      runtime.stopDelivery = ({ deliveryId: stoppedDeliveryId }) => {
        runtime.stoppedDeliveryIds.push(stoppedDeliveryId);
        return Promise.resolve("stopped");
      };
      let recoveryNowMs = NOW_MS + 200;
      await expect(
        recoverCenterAgentTaskWork({
          db: harness.db,
          inboxDb: harness.db,
          now: () => {
            recoveryNowMs += 1;
            return recoveryNowMs;
          },
          runtime,
        })
      ).resolves.toMatchObject({ errors: 0, stopsResolved: 1 });
      await expect(
        service.get({
          organizationId: "org-one",
          requesterUserId: "user-one",
          taskId: waiting.task.id,
        })
      ).resolves.toMatchObject({
        attempts: [
          { generation: 1, status: "stopped" },
          { generation: 2, status: "running" },
        ],
        task: { activeAttemptGeneration: 2, status: "running" },
      });
      expect(runtime.submissions).toHaveLength(2);
      expect(
        harness.queryAll<{ resolution_status: string }>({
          sql: "SELECT resolution_status FROM inbox_items",
        })
      ).toEqual([{ resolution_status: "resolved" }]);
    } finally {
      harness.close();
    }
  });
});

type Service = ReturnType<typeof createCenterAgentTaskService>;

async function createTask(service: Service) {
  return await service.create({
    goal: "Research onboarding and summarize the gaps.",
    idempotencyKey: "create-one",
    organizationId: "org-one",
    parentSubmissionId: "parent-submission",
    requesterUserId: "user-one",
    title: "Review onboarding",
  });
}

type TestCenterAgentTaskRuntime = CenterAgentTaskRuntimePort & {
  executionEvidenceByDeliveryId: Map<
    string,
    {
      attemptGeneration: number;
      kind: "native_delivery";
      observedAt: string;
    }
  >;
  executionEvidenceError: Error | null;
  stoppedDeliveryIds: string[];
  submissions: Array<{
    deliveryId: string;
    instruction: string;
    parent: CenterAgentTaskParentDeliveryRef;
    taskId: string;
  }>;
};

function createRuntime(): TestCenterAgentTaskRuntime {
  const executionEvidenceByDeliveryId = new Map<
    string,
    {
      attemptGeneration: number;
      kind: "native_delivery";
      observedAt: string;
    }
  >();
  const stoppedDeliveryIds: string[] = [];
  const submissions: Array<{
    deliveryId: string;
    instruction: string;
    parent: CenterAgentTaskParentDeliveryRef;
    taskId: string;
  }> = [];
  const runtime: TestCenterAgentTaskRuntime = {
    authorizeTurn: async () => undefined,
    executionEvidenceByDeliveryId,
    executionEvidenceError: null,
    resolveExecutionEvidence: ({ attempts }) => {
      if (runtime.executionEvidenceError) {
        return Promise.reject(runtime.executionEvidenceError);
      }
      return Promise.resolve(
        attempts.flatMap((attempt) => {
          const evidence = executionEvidenceByDeliveryId.get(
            attempt.deliveryId
          );
          return evidence ? [{ ...evidence, taskId: attempt.taskId }] : [];
        })
      );
    },
    resolveParent: async () => ({
      organizationId: "org-one",
      origin: { kind: "open_meld" },
      requesterUserId: "user-one",
    }),
    resolveDeliveryParent: ({ deliveryId }) =>
      Promise.resolve({ deliveryId, kind: "delivery" }),
    stopDelivery: ({ deliveryId }) => {
      stoppedDeliveryIds.push(deliveryId);
      return Promise.resolve("stopped");
    },
    stoppedDeliveryIds,
    submitTurn: (input) => {
      submissions.push({
        deliveryId: input.deliveryId,
        instruction: input.instruction,
        parent: input.parent,
        taskId: input.taskId,
      });
      return Promise.resolve({ outcome: "accepted" });
    },
    submissions,
  };
  return runtime;
}

function tickingClock(): () => number {
  let nowMs = NOW_MS;
  return () => {
    nowMs += 1;
    return nowMs;
  };
}

function createTaskHarness(): ReturnType<typeof createSqliteD1Harness> {
  const harness = createSqliteD1Harness();
  for (const sql of [
    "CREATE TABLE users (id text PRIMARY KEY NOT NULL)",
    "CREATE TABLE organizations (id text PRIMARY KEY NOT NULL)",
    "INSERT INTO users (id) VALUES ('user-one'), ('user-two')",
    "INSERT INTO organizations (id) VALUES ('org-one')",
  ]) {
    harness.run({ sql });
  }
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_tasks",
    "center_agent_task_attempts",
    "center_agent_task_admission_outbox",
    "center_agent_task_events",
    "inbox_items",
    "inbox_email_deliveries",
    "inbox_notification_preferences",
    "inbox_center_agent_read_watermarks",
  ]);
  return harness;
}
