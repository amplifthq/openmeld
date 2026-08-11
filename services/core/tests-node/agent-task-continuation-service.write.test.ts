import type {
  AgentTaskContinuation,
  AgentTaskHandle,
  RemoteAgentWorkerCancellationRequest,
  RemoteAgentWorkerCancellationResponse,
} from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processAgentTaskContinuationQueueMessage } from "../src/agent-task-coordination/application/agent-task-continuation-service";
import {
  recordAndEnqueueAgentTaskTerminalOutcome,
  retryReadyAgentTaskContinuations,
} from "../src/agent-task-coordination/application/agent-task-terminal-outcome-service";
import {
  activateAgentDelegationChildren,
  createAgentDelegation,
  readAgentDelegation,
} from "../src/agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import {
  claimReadyAgentTaskCompletionSubscription,
  readAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import { prepareCenterAgentWakeDelegation } from "../src/center-agent/application/center-agent-delegation-service";
import type { CoreBindings } from "../src/lib/bindings";
import { readRemoteAgentNativeDeliveryByIdempotencyKey } from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const submitContinuation = vi.hoisted(() => vi.fn());
const activateFallbackWake = vi.hoisted(() => vi.fn());
const resolveSpace = vi.hoisted(() => vi.fn());
const TaskContinuationTerminalError = vi.hoisted(
  () =>
    class extends Error {
      readonly reasonCode: string;

      constructor(reasonCode: string) {
        super(reasonCode);
        this.reasonCode = reasonCode;
      }
    }
);

vi.mock("../src/remote-agent/application/native-delivery-service", () => ({
  activateCenterAgentFallbackSpaceWake: activateFallbackWake,
  RemoteAgentTaskContinuationTerminalError: TaskContinuationTerminalError,
  submitRemoteAgentTaskContinuationDelivery: submitContinuation,
}));
vi.mock("../src/rpc/space-ref", () => ({
  resolveSpaceStub: resolveSpace,
}));

const childTask = {
  kind: "space_wake",
  sourceClientMessageId: "client-child",
  spaceId: "space-child",
  targetProfileId: "agt_00000000-0000-4000-8000-000000000002",
  v: 1,
} satisfies AgentTaskHandle;

const parentTask: AgentTaskHandle = {
  deliveryId: "delivery-parent",
  kind: "native_delivery",
  v: 1,
};

const continuation: Extract<AgentTaskContinuation, { kind: "resume_agent" }> = {
  delegationId: "delegation-1",
  instruction: "Synthesize the child result for the original requester.",
  kind: "resume_agent",
  sourceSignalId: "signal-parent",
  spaceId: "space-parent",
  threadContext: null,
};

describe("Agent Task continuation service", () => {
  beforeEach(() => {
    activateFallbackWake.mockReset();
    resolveSpace.mockReset();
    submitContinuation.mockReset();
  });

  it("submits and settles one continuation exactly once", async () => {
    const harness = createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-1");
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-continuation-1",
          kind: "native_delivery",
          v: 1,
        },
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-1"),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-1" },
      });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-1"),
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-1" },
      });

      expect(submitContinuation).toHaveBeenCalledTimes(1);
      const submittedContinuation = submitContinuation.mock.calls[0]?.[0];
      expect(submittedContinuation).not.toHaveProperty("sourceSignalId");
      expect(submittedContinuation).not.toHaveProperty("spaceId");
      expect(submittedContinuation).not.toHaveProperty("threadContext");
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-1",
        })
      ).resolves.toMatchObject({
        continuationTask: {
          deliveryId: "delivery-continuation-1",
          kind: "native_delivery",
        },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("settles a terminal continuation instead of retrying its admission", async () => {
    const harness = createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-terminal");
      submitContinuation.mockResolvedValue({
        status: "terminal",
        task: {
          deliveryId: "delivery-continuation-terminal",
          kind: "native_delivery",
          v: 1,
        },
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-terminal"),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-terminal" },
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-terminal",
        })
      ).resolves.toMatchObject({
        continuationTask: {
          deliveryId: "delivery-continuation-terminal",
          kind: "native_delivery",
        },
        state: "settled",
      });
      expect(submitContinuation).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });

  it("cancels a continuation when its frozen model route was already cleared", async () => {
    const harness = createHarness();
    try {
      await arrangeReadySubscription(
        harness.db,
        "subscription-cleared-model-route"
      );
      submitContinuation.mockRejectedValue(
        new TaskContinuationTerminalError(
          "remote_agent.task_continuation.original_model_route_unavailable"
        )
      );

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-cleared-model-route"),
          nowMs: 1200,
        })
      ).resolves.toEqual({ status: "completed", task: null });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-cleared-model-route",
        })
      ).resolves.toMatchObject({
        continuationTask: null,
        state: "cancelled",
      });
      expect(submitContinuation).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });

  it("waits for a Routine observer callback to finish before resuming it", async () => {
    const harness = createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-routine");
      await harness.db
        .prepare(
          `
            UPDATE openMeldRemoteAgent_native_delivery_ledger
            SET routine_run_id = 'routine-run-1'
            WHERE delivery_id = ?
          `
        )
        .bind(parentTask.deliveryId)
        .run();
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-routine-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-routine"),
          nowMs: 1200,
        })
      ).resolves.toEqual({ retryAfterSeconds: 5, status: "retry_later" });
      expect(submitContinuation).not.toHaveBeenCalled();

      await harness.db
        .prepare(
          `
            UPDATE openMeldRemoteAgent_native_delivery_ledger
            SET status = 'completed'
            WHERE delivery_id = ?
          `
        )
        .bind(parentTask.deliveryId)
        .run();
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-routine"),
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-routine-continuation" },
      });
      expect(submitContinuation).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("resumes a general exact-task watch without requiring a delegation", async () => {
    const harness = createHarness();
    try {
      await arrangeReadyTaskWatchSubscription(
        harness.db,
        "subscription-task-watch"
      );
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-task-watch-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-task-watch"),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-task-watch-continuation" },
      });
      const submitted = submitContinuation.mock.calls[0]?.[0];
      expect(submitted).toMatchObject({
        watchedTask: childTask,
        watchId: "watch-task-watch",
      });
      expect(submitted).not.toHaveProperty("delegation");
      expect(submitted).not.toHaveProperty("delegationId");
    } finally {
      harness.close();
    }
  });

  it("retries with the same continuation idempotency key after a crash gap", async () => {
    const harness = createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-crash-gap");
      submitContinuation
        .mockRejectedValueOnce(new Error("simulated post-submit crash"))
        .mockResolvedValueOnce({
          task: {
            deliveryId: "delivery-continuation-recovered",
            kind: "native_delivery",
            v: 1,
          },
        });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-crash-gap"),
          nowMs: 1200,
        })
      ).rejects.toThrow("simulated post-submit crash");
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-crash-gap"),
          nowMs: 1300,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-continuation-recovered" },
      });

      expect(submitContinuation).toHaveBeenCalledTimes(2);
      expect(submitContinuation.mock.calls[0]?.[0].idempotencyKey).toBe(
        "agent-task-continuation:subscription-crash-gap"
      );
      expect(submitContinuation.mock.calls[1]?.[0].idempotencyKey).toBe(
        "agent-task-continuation:subscription-crash-gap"
      );
    } finally {
      harness.close();
    }
  });

  it("redrives a durable winner if the delegation completion write was interrupted", async () => {
    const harness = createHarness();
    const subscriptionId = "subscription-winner-crash-gap";
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await harness.db
        .prepare(
          `
            UPDATE agent_delegations
            SET state = 'active', completed_at_ms = NULL
            WHERE delegation_id = ?
          `
        )
        .bind(`delegation:${subscriptionId}`)
        .run();
      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-winner-redriven",
          kind: "native_delivery",
          v: 1,
        },
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage(subscriptionId),
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        status: "completed",
        task: { deliveryId: "delivery-winner-redriven" },
      });
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: `delegation:${subscriptionId}`,
        })
      ).resolves.toMatchObject({ state: "completed" });
    } finally {
      harness.close();
    }
  });

  it("defers while another continuation claim lease is active", async () => {
    const harness = createHarness();
    try {
      await arrangeReadySubscription(harness.db, "subscription-claimed");
      await claimReadyAgentTaskCompletionSubscription({
        claimId: "claim-existing",
        claimLeaseMs: 60_000,
        db: harness.db,
        nowMs: 1200,
        subscriptionId: "subscription-claimed",
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage("subscription-claimed"),
          nowMs: 1300,
        })
      ).resolves.toEqual({
        retryAfterSeconds: 60,
        status: "retry_later",
      });
      expect(submitContinuation).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("redrives durable ready subscriptions after an enqueue gap", async () => {
    const harness = createHarness();
    const send = vi.fn(async () => undefined);
    try {
      await arrangeReadySubscription(harness.db, "subscription-redrive");

      await expect(
        retryReadyAgentTaskContinuations({
          db: harness.db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
          } as unknown as CoreBindings,
          nowMs: 1200,
        })
      ).resolves.toEqual({ enqueuedCount: 1 });

      expect(send).toHaveBeenCalledWith({
        ...buildQueueMessage("subscription-redrive"),
        enqueuedAtMs: 1200,
      });
    } finally {
      harness.close();
    }
  });

  it("keeps a continuation ready when its immediate Queue send fails", async () => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: continuation.delegationId,
        idempotencyKey: "delegation-key:enqueue-failure",
        nowMs: 999,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        db: harness.db,
        idempotencyKey: "subscription-key:enqueue-failure",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-enqueue-failure",
        watchedTask: childTask,
      });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: {
              send: vi.fn(() => Promise.reject(new Error("Queue unavailable"))),
            },
          } as unknown as CoreBindings,
          nowMs: 1100,
          outcome: {
            errorCode: null,
            eventId: "terminal:enqueue-failure",
            occurredAtMs: 1090,
            publishedSignalId: "signal-child-result",
            status: "succeeded",
          },
          task: childTask,
        })
      ).resolves.toBeUndefined();

      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-enqueue-failure",
        })
      ).resolves.toMatchObject({ state: "ready" });
    } finally {
      harness.close();
    }
  });

  it("enqueues and resumes a duplicate terminal observation exactly once", async () => {
    const harness = createHarness();
    const send = vi.fn(async () => undefined);
    const subscriptionId = "subscription-duplicate-terminal";
    const outcome = {
      errorCode: null,
      eventId: "terminal:duplicate-observation",
      occurredAtMs: 1090,
      publishedSignalId: "signal-child-result",
      status: "succeeded" as const,
    };
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: continuation.delegationId,
        idempotencyKey: "delegation-key:duplicate-terminal",
        nowMs: 999,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation,
        db: harness.db,
        idempotencyKey: "subscription-key:duplicate-terminal",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId,
        watchedTask: childTask,
      });
      const env = {
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
      } as unknown as CoreBindings;

      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1100,
        outcome,
        task: childTask,
      });
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1110,
        outcome,
        task: childTask,
      });

      expect(send).toHaveBeenCalledTimes(1);

      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-duplicate-terminal-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1200,
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1210,
      });

      expect(submitContinuation).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("resumes the exact parent controller conversation once after a local runtime is lost", async () => {
    const harness = createHarness();
    const send = vi.fn(async () => undefined);
    const subscriptionId = "subscription-local-runtime-lost";
    const outcome = {
      errorCode: "runtime.local_runtime_lost",
      eventId: "runtime-coordinator:local-runtime-lost",
      occurredAtMs: 1090,
      publishedSignalId: "signal-local-runtime-lost",
      status: "failed" as const,
    };
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: "delegation-local-runtime-lost",
        idempotencyKey: "delegation-key:local-runtime-lost",
        nowMs: 999,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          ...continuation,
          delegationId: "delegation-local-runtime-lost",
        },
        db: harness.db,
        idempotencyKey: "subscription-key:local-runtime-lost",
        nowMs: 1000,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId,
        watchedTask: childTask,
      });
      const env = {
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send },
      } as unknown as CoreBindings;

      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1100,
        outcome,
        task: childTask,
      });
      await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env,
        nowMs: 1110,
        outcome,
        task: childTask,
      });

      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith(buildQueueMessage(subscriptionId));

      submitContinuation.mockResolvedValue({
        task: {
          deliveryId: "delivery-local-runtime-lost-continuation",
          kind: "native_delivery",
          v: 1,
        },
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1200,
      });
      await processAgentTaskContinuationQueueMessage({
        db: harness.db,
        env,
        message: buildQueueMessage(subscriptionId),
        nowMs: 1210,
      });

      expect(submitContinuation).toHaveBeenCalledOnce();
      expect(submitContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          observerDelivery: expect.objectContaining({
            deliveryId: "delivery-parent",
            submissionId: "submission-parent",
          }),
          outcome,
          watchedTask: childTask,
        })
      );
    } finally {
      harness.close();
    }
  });

  it("activates a fallback only after the primary authoritatively fails", async () => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      const prepared = await prepareCenterAgentWakeDelegation({
        actorProfileId: "agt_00000000-0000-4000-8000-000000000001",
        childSpaceId: "space-child",
        clientMessageId: "client-fallback",
        completionMode: "resume_parent_when_all_terminal",
        db: harness.db,
        fallbackAgentProfileId: "agt_00000000-0000-4000-8000-000000000003",
        nowMs: 1000,
        organizationId: "org-1",
        parentSubmissionId: "submission-parent",
        targetProfileIds: [childTask.targetProfileId],
        text: "Complete the task.",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: prepared.delegationId,
        nowMs: 1010,
      });
      const primaryTask = prepared.childTasks[0]?.task;
      if (!primaryTask) {
        throw new Error("expected primary task fixture");
      }
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: "task.failed",
          eventId: "terminal:primary-failed",
          occurredAtMs: 1090,
          publishedSignalId: null,
          status: "failed",
        },
        task: primaryTask,
      });
      const fallbackTask = prepared.fallbackTask?.task;
      const activationSubscriptionId =
        prepared.fallbackTask?.activationSubscriptionId;
      if (!(fallbackTask && activationSubscriptionId)) {
        throw new Error("expected fallback task fixture");
      }
      activateFallbackWake.mockResolvedValue({
        status: "submitted",
        task: fallbackTask,
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: activationSubscriptionId,
        })
      ).resolves.toMatchObject({
        continuation: { kind: "activate_fallback" },
        outcome: { status: "failed" },
        state: "ready",
      });

      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage(activationSubscriptionId),
          nowMs: 1200,
        })
      ).resolves.toEqual({ status: "completed", task: fallbackTask });
      await expect(
        processAgentTaskContinuationQueueMessage({
          db: harness.db,
          env: {} as CoreBindings,
          message: buildQueueMessage(activationSubscriptionId),
          nowMs: 1300,
        })
      ).resolves.toEqual({ status: "completed", task: fallbackTask });

      expect(activateFallbackWake).toHaveBeenCalledTimes(1);
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: prepared.delegationId,
        })
      ).resolves.toMatchObject({
        children: [
          { role: "primary", state: "terminal" },
          { role: "fallback", state: "active" },
        ],
        state: "active",
      });
    } finally {
      harness.close();
    }
  });

  it("waits for active child cancellation before confirming the parent stop", async () => {
    const harness = createHarness();
    const postWakeStop = vi
      .fn()
      .mockResolvedValueOnce({
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: null,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "requested" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-child",
        status: "cancellation_requested" as const,
        stopMode: "controller_control" as const,
        targetProfileId: childTask.targetProfileId,
      })
      .mockResolvedValueOnce({
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: 1250,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "cancelled" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-child",
        status: "cancelled" as const,
        stopMode: "controller_control" as const,
        targetProfileId: childTask.targetProfileId,
      });
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: "delegation-parent-stop",
        idempotencyKey: "delegation-key:parent-stop",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-parent-stop",
        nowMs: 1010,
      });
      await registerAgentTaskCompletionSubscription({
        completionCondition: "terminal",
        continuation: {
          ...continuation,
          delegationId: "delegation-parent-stop",
        },
        db: harness.db,
        idempotencyKey: "subscription-key:parent-stop",
        nowMs: 1020,
        observerTask: parentTask,
        organizationId: "org-1",
        subscriptionId: "subscription-parent-stop",
        watchedTask: childTask,
      });
      resolveSpace.mockReturnValue({ rpcPostWakeStop: postWakeStop });

      const terminalInput = {
        db: harness.db,
        env: {} as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: "terminal:parent-stopped",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped" as const,
        },
        task: parentTask,
      };

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome(terminalInput)
      ).rejects.toThrow("agent_task_parent_stop.cancellation_requested");
      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome(terminalInput)
      ).resolves.toBeUndefined();

      expect(postWakeStop).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            reason: "Parent task was stopped.",
            target: {
              by: "client_message",
              clientMessageId: childTask.sourceClientMessageId,
              targetProfileId: childTask.targetProfileId,
            },
          },
          spaceId: childTask.spaceId,
        })
      );
      expect(postWakeStop).toHaveBeenCalledTimes(2);
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: "delegation-parent-stop",
        })
      ).resolves.toMatchObject({
        children: [{ state: "cancelled" }],
        state: "cancelled",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId: "subscription-parent-stop",
        })
      ).resolves.toMatchObject({ state: "cancelled" });
    } finally {
      harness.close();
    }
  });

  it("maps a missing rpcPostWakeStop receiver method to stable Space unavailable", async () => {
    const harness = createHarness();
    try {
      await arrangeActiveChildForParentStop(harness.db);
      resolveSpace.mockReturnValue(
        createProxyLikeSpaceStubWithMissingReceiverMethod("rpcPostWakeStop")
      );

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-rpc-skew",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("agent_task_parent_stop.space_unavailable");
    } finally {
      harness.close();
    }
  });

  it.each([
    ["transport", "network connection lost"],
    [
      "business",
      'HTTP 409: {"ok":false,"error":{"code":"space.wake_stop.not_stoppable","message":"Wake is already terminal."}}',
    ],
  ])("preserves an unrelated %s error from rpcPostWakeStop", async (_errorKind, errorMessage) => {
    const harness = createHarness();
    try {
      await arrangeActiveChildForParentStop(harness.db);
      resolveSpace.mockReturnValue({
        rpcPostWakeStop: vi.fn(() => Promise.reject(new Error(errorMessage))),
      });

      const rejection = await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env: {} as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: `terminal:parent-stop-${_errorKind}-error`,
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      }).then(
        () => null,
        (error: unknown) => error
      );
      const rejectionMessage =
        rejection instanceof Error ? rejection.message : String(rejection);

      expect(rejectionMessage).toContain(errorMessage);
      expect(rejectionMessage).not.toContain(
        "agent_task_parent_stop.space_unavailable"
      );
    } finally {
      harness.close();
    }
  });

  it("preserves a missing nested receiver method that is not rpcPostWakeStop", async () => {
    const harness = createHarness();
    try {
      await arrangeActiveChildForParentStop(harness.db);
      resolveSpace.mockReturnValue(
        createProxyLikeSpaceStubWithMissingReceiverMethod(
          "rpcReadWakeStopState"
        )
      );

      const rejection = await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env: {} as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: "terminal:parent-stop-nested-rpc-skew",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      }).then(
        () => null,
        (error: unknown) => error
      );
      const rejectionMessage =
        rejection instanceof Error ? rejection.message : String(rejection);

      expect(rejectionMessage).toContain(
        'The RPC receiver does not implement the method "rpcReadWakeStopState".'
      );
      expect(rejectionMessage).not.toContain(
        "agent_task_parent_stop.space_unavailable"
      );
    } finally {
      harness.close();
    }
  });

  it("attempts every child and continuation cancellation before reporting Stop failures", async () => {
    const harness = createHarness();
    const subscriptionId = "subscription-stop-all-targets";
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const activeChildTask = {
      ...childTask,
      sourceClientMessageId: "client-stop-all-first",
    } satisfies AgentTaskHandle;
    const siblingTask = {
      ...childTask,
      sourceClientMessageId: "client-stop-all-sibling",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000003",
    } satisfies AgentTaskHandle;
    const postWakeStop = vi.fn(async (request) => {
      await Promise.resolve();
      const target = request.body.target;
      if (target.clientMessageId === activeChildTask.sourceClientMessageId) {
        return {
          cancellationState: {
            acceptedAtMs: null,
            completedAtMs: null,
            reason: null,
            requestedAtMs: null,
            status: "not_requested" as const,
          },
          ok: false as const,
          reasonCode: "runtime_coordinator.wake_stop_target_not_found",
          runtimeCoordinatorExecutionId: null,
          status: "not_found" as const,
          targetProfileId: activeChildTask.targetProfileId,
        };
      }
      return {
        cancellationState: {
          acceptedAtMs: 1200,
          completedAtMs: null,
          reason: "Parent task was stopped.",
          requestedAtMs: 1200,
          status: "requested" as const,
        },
        ok: true as const,
        runtimeCoordinatorExecutionId: "execution-sibling",
        status: "cancellation_requested" as const,
        stopMode: "controller_control" as const,
        targetProfileId: siblingTask.targetProfileId,
      };
    });
    const cancelExecution = vi.fn((input) => {
      const { reason, ...identity } = input;
      return Promise.resolve({
        execution: {
          ...identity,
          acceptedAtMs: 1110,
          cancellationReason: reason ?? null,
          completedAtMs: null,
          lastProgressAtMs: 1200,
          lastProgressKind: "cancellation_requested" as const,
          status: "cancellation_requested" as const,
        },
        status: "cancellation_requested" as const,
      });
    });
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: continuationIdempotencyKey,
      });
      await createAgentDelegation({
        children: [activeChildTask, siblingTask].map((task) => ({
          agentProfileId: task.targetProfileId,
          role: "primary" as const,
          task,
        })),
        completionPolicy: { mode: "child_reports_directly" },
        db: harness.db,
        delegationId: "delegation-stop-all-targets",
        idempotencyKey: "delegation-key:stop-all-targets",
        nowMs: 1100,
        organizationId: "org-1",
        parentTask,
        spaceId: activeChildTask.spaceId,
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-stop-all-targets",
        nowMs: 1110,
      });
      resolveSpace.mockReturnValue({ rpcPostWakeStop: postWakeStop });

      const rejection = await recordAndEnqueueAgentTaskTerminalOutcome({
        db: harness.db,
        env: {
          OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
        } as unknown as CoreBindings,
        nowMs: 1200,
        outcome: {
          errorCode: null,
          eventId: "terminal:parent-stop-all-targets",
          occurredAtMs: 1190,
          publishedSignalId: null,
          status: "stopped",
        },
        task: parentTask,
      }).then(
        () => null,
        (error: unknown) => error
      );
      const rejectionMessage =
        rejection instanceof Error ? rejection.message : String(rejection);

      expect(rejectionMessage).toContain("agent_task_parent_stop.not_found");
      expect(rejectionMessage).toContain(
        "remote_agent.parent_stop_cancellation_pending"
      );

      expect(postWakeStop).toHaveBeenCalledTimes(2);
      expect(cancelExecution).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("stops active siblings after a first-success delegation already completed", async () => {
    const harness = createHarness();
    const siblingTask = {
      ...childTask,
      sourceClientMessageId: "client-sibling",
      targetProfileId: "agt_00000000-0000-4000-8000-000000000003",
    } satisfies AgentTaskHandle;
    const postWakeStop = vi.fn(async () => ({
      cancellationState: {
        acceptedAtMs: 1100,
        completedAtMs: 1110,
        reason: null,
        requestedAtMs: 1100,
        status: "not_requested" as const,
      },
      ok: false as const,
      reasonCode: "runtime_coordinator.wake_stop_execution_terminal",
      runtimeCoordinatorExecutionId: "execution-sibling",
      status: "not_stoppable" as const,
      targetProfileId: siblingTask.targetProfileId,
    }));
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
          {
            agentProfileId: siblingTask.targetProfileId,
            role: "primary",
            task: siblingTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "first_success" },
        db: harness.db,
        delegationId: "delegation-first-success-stop",
        idempotencyKey: "delegation-key:first-success-stop",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-first-success-stop",
        nowMs: 1010,
      });
      for (const [index, task] of [childTask, siblingTask].entries()) {
        await registerAgentTaskCompletionSubscription({
          completionCondition: "terminal",
          continuation: {
            ...continuation,
            delegationId: "delegation-first-success-stop",
          },
          db: harness.db,
          idempotencyKey: `subscription-key:first-success-stop:${index}`,
          nowMs: 1020,
          observerTask: parentTask,
          organizationId: "org-1",
          subscriptionId: `subscription-first-success-stop:${index}`,
          watchedTask: task,
        });
      }
      await recordAgentTaskTerminalOutcome({
        db: harness.db,
        nowMs: 1100,
        outcome: {
          errorCode: null,
          eventId: "terminal:first-success",
          occurredAtMs: 1090,
          publishedSignalId: "signal:first-success",
          status: "succeeded",
        },
        task: childTask,
      });
      resolveSpace.mockReturnValue({ rpcPostWakeStop: postWakeStop });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:first-success-parent-stopped",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).resolves.toBeUndefined();

      expect(postWakeStop).toHaveBeenCalledTimes(1);
      expect(postWakeStop).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            target: expect.objectContaining({
              clientMessageId: siblingTask.sourceClientMessageId,
            }),
          }),
        })
      );
      await expect(
        readAgentDelegation({
          db: harness.db,
          delegationId: "delegation-first-success-stop",
        })
      ).resolves.toMatchObject({
        children: [{ state: "terminal" }, { state: "cancelled" }],
        state: "cancelled",
      });
    } finally {
      harness.close();
    }
  });

  it("cancels a claimed native continuation when Parent Stop wins the race", async () => {
    const harness = createHarness();
    const subscriptionId = "subscription-native-continuation-stop";
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const cancelExecution = vi
      .fn(
        (
          input: RemoteAgentWorkerCancellationRequest
        ): Promise<RemoteAgentWorkerCancellationResponse> => {
          const {
            conversationId: _conversationId,
            reason,
            ...identity
          } = input;
          return Promise.resolve({
            execution: {
              ...identity,
              acceptedAtMs: 1110,
              cancellationReason: reason ?? null,
              completedAtMs: 1210,
              lastProgressAtMs: 1210,
              lastProgressKind: "aborted" as const,
              status: "aborted" as const,
            },
            status: "already_cancelled" as const,
          });
        }
      )
      .mockImplementationOnce((input) => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 1110,
            cancellationReason: reason ?? null,
            completedAtMs: null,
            lastProgressAtMs: 1200,
            lastProgressKind: "cancellation_requested" as const,
            status: "cancellation_requested" as const,
          },
          status: "cancellation_requested" as const,
        });
      });
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: continuationIdempotencyKey,
      });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
          } as unknown as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("remote_agent.parent_stop_cancellation_pending");

      expect(cancelExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: continuationIdempotencyKey,
          reason: "Parent task was stopped.",
          submissionId: "submission-continuation-race",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
          } as unknown as CoreBindings,
          nowMs: 1210,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation-retry",
            occurredAtMs: 1200,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).resolves.toBeUndefined();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps Parent Stop retryable when the native continuation cannot be found", async () => {
    const harness = createHarness();
    const subscriptionId = "subscription-native-continuation-missing";
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const cancelExecution = vi.fn(
      (
        input: RemoteAgentWorkerCancellationRequest
      ): Promise<RemoteAgentWorkerCancellationResponse> => {
        const { conversationId: _conversationId, reason, ...identity } = input;
        return Promise.resolve({
          execution: {
            ...identity,
            acceptedAtMs: 1110,
            cancellationReason: reason ?? null,
            completedAtMs: 1210,
            lastProgressAtMs: 1210,
            lastProgressKind: "aborted" as const,
            status: "aborted" as const,
          },
          status: "already_cancelled" as const,
        });
      }
    );
    cancelExecution.mockResolvedValueOnce({ status: "not_found" });
    try {
      await arrangeReadySubscription(harness.db, subscriptionId);
      await insertContinuationDelivery({
        db: harness.db,
        idempotencyKey: continuationIdempotencyKey,
      });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: {
              cancelExecution,
            },
          } as unknown as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation-missing",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("remote_agent.parent_stop_execution_not_found");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
      });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {
            OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
          } as unknown as CoreBindings,
          nowMs: 1210,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-native-continuation-retry",
            occurredAtMs: 1200,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).resolves.toBeUndefined();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: continuationIdempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "runtime_coordinator.pre_agent_stop_requested",
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("does not treat an unproven missing child as a successful Parent Stop", async () => {
    const harness = createHarness();
    try {
      await insertParentDelivery(harness.db);
      await createAgentDelegation({
        children: [
          {
            agentProfileId: childTask.targetProfileId,
            role: "primary",
            task: childTask,
          },
        ],
        completionPolicy: { mode: "resume_parent", when: "all_terminal" },
        db: harness.db,
        delegationId: "delegation-parent-stop-not-found",
        idempotencyKey: "delegation-key:parent-stop-not-found",
        nowMs: 1000,
        organizationId: "org-1",
        parentTask,
        spaceId: "space-child",
      });
      await activateAgentDelegationChildren({
        db: harness.db,
        delegationId: "delegation-parent-stop-not-found",
        nowMs: 1010,
      });
      resolveSpace.mockReturnValue({
        rpcPostWakeStop: vi.fn(async () => ({
          cancellationState: {
            acceptedAtMs: null,
            completedAtMs: null,
            reason: null,
            requestedAtMs: null,
            status: "not_requested" as const,
          },
          ok: false as const,
          reasonCode: "runtime_coordinator.wake_stop_target_not_found",
          runtimeCoordinatorExecutionId: null,
          status: "not_found" as const,
          targetProfileId: childTask.targetProfileId,
        })),
      });

      await expect(
        recordAndEnqueueAgentTaskTerminalOutcome({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1200,
          outcome: {
            errorCode: null,
            eventId: "terminal:parent-stop-not-found",
            occurredAtMs: 1190,
            publishedSignalId: null,
            status: "stopped",
          },
          task: parentTask,
        })
      ).rejects.toThrow("agent_task_parent_stop.not_found");
    } finally {
      harness.close();
    }
  });
});

async function arrangeActiveChildForParentStop(db: D1Database): Promise<void> {
  await insertParentDelivery(db);
  await createAgentDelegation({
    children: [
      {
        agentProfileId: childTask.targetProfileId,
        role: "primary",
        task: childTask,
      },
    ],
    completionPolicy: { mode: "child_reports_directly" },
    db,
    delegationId: "delegation-parent-stop-rpc-skew",
    idempotencyKey: "delegation-key:parent-stop-rpc-skew",
    nowMs: 1000,
    organizationId: "org-1",
    parentTask,
    spaceId: childTask.spaceId,
  });
  await activateAgentDelegationChildren({
    db,
    delegationId: "delegation-parent-stop-rpc-skew",
    nowMs: 1010,
  });
}

function createProxyLikeSpaceStubWithMissingReceiverMethod(
  methodName: string
): object {
  return new Proxy(
    {},
    {
      get: () => () =>
        Promise.reject(
          new Error(
            `The RPC receiver does not implement the method "${methodName}".`
          )
        ),
    }
  );
}

async function arrangeReadySubscription(
  db: D1Database,
  subscriptionId: string
): Promise<void> {
  await insertParentDelivery(db);
  await createAgentDelegation({
    children: [
      {
        agentProfileId: childTask.targetProfileId,
        role: "primary",
        task: childTask,
      },
    ],
    completionPolicy: { mode: "resume_parent", when: "all_terminal" },
    db,
    delegationId: `delegation:${subscriptionId}`,
    idempotencyKey: `delegation-key:${subscriptionId}`,
    nowMs: 999,
    organizationId: "org-1",
    parentTask,
    spaceId: "space-child",
  });
  await registerAgentTaskCompletionSubscription({
    completionCondition: "terminal",
    continuation: {
      ...continuation,
      delegationId: `delegation:${subscriptionId}`,
    },
    db,
    idempotencyKey: `subscription-key:${subscriptionId}`,
    nowMs: 1000,
    observerTask: parentTask,
    organizationId: "org-1",
    subscriptionId,
    watchedTask: childTask,
  });
  await recordAgentTaskTerminalOutcome({
    db,
    nowMs: 1100,
    outcome: {
      errorCode: null,
      eventId: `terminal:${subscriptionId}`,
      occurredAtMs: 1090,
      publishedSignalId: "signal-child-result",
      status: "succeeded",
    },
    task: childTask,
  });
}

async function arrangeReadyTaskWatchSubscription(
  db: D1Database,
  subscriptionId: string
): Promise<void> {
  await insertParentDelivery(db);
  await registerAgentTaskCompletionSubscription({
    completionCondition: "terminal",
    continuation: {
      instruction: "Continue after the exact parallel task completes.",
      kind: "resume_task_watch",
      sourceSignalId: "signal-parent",
      spaceId: "space-parent",
      threadContext: null,
      watchId: "watch-task-watch",
    },
    db,
    idempotencyKey: `task-watch-key:${subscriptionId}`,
    nowMs: 1000,
    observerTask: parentTask,
    organizationId: "org-1",
    subscriptionId,
    watchedTask: childTask,
  });
  await recordAgentTaskTerminalOutcome({
    db,
    nowMs: 1100,
    outcome: {
      errorCode: null,
      eventId: `terminal:${subscriptionId}`,
      occurredAtMs: 1090,
      publishedSignalId: "signal-child-result",
      status: "succeeded",
    },
    task: childTask,
  });
}

function buildQueueMessage(subscriptionId: string) {
  return {
    enqueuedAtMs: 1100,
    idempotencyKey: `agent-task-continuation-event:${subscriptionId}`,
    kind: "agent_task_continuation" as const,
    subscriptionId,
    v: 4 as const,
  };
}

function createHarness() {
  const harness = createSqliteD1Harness();
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
  applyDrizzleMigrationForTable(harness, "agent_task_terminal_outcomes");
  applyDrizzleMigrationForTable(harness, "agent_task_completion_subscriptions");
  applyDrizzleMigrationForTable(harness, "agent_delegations");
  applyDrizzleMigrationForTable(harness, "agent_delegation_children");
  return harness;
}

async function insertParentDelivery(db: D1Database): Promise<void> {
  await db
    .prepare(
      `
        INSERT OR IGNORE INTO openMeldRemoteAgent_native_delivery_ledger (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, 'space', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "delivery-parent",
      "org-1",
      "space-parent",
      "agt_00000000-0000-4000-8000-000000000001",
      "binding-parent",
      "signal-parent",
      "dispatch-parent",
      "idempotency-parent",
      "submission-parent",
      "human-parent",
      "user-parent",
      "Felix",
      900,
      900
    )
    .run();
}

async function insertContinuationDelivery(input: {
  db: D1Database;
  idempotencyKey: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
          delivery_id,
          organization_id,
          conversation_kind,
          space_id,
          profile_id,
          binding_id,
          trigger_message_id,
          dispatch_id,
          idempotency_key,
          submission_id,
          status,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, 'space', ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?)
      `
    )
    .bind(
      "delivery-continuation-race",
      "org-1",
      "space-parent",
      "agt_00000000-0000-4000-8000-000000000001",
      "binding-parent",
      "signal-parent",
      "dispatch-continuation-race",
      input.idempotencyKey,
      "submission-continuation-race",
      "human-parent",
      "user-parent",
      "Felix",
      1110,
      1110
    )
    .run();
}
