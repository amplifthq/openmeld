import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCenterAgentTaskNativeRuntimePort } from "../src/center-agent-tasks/infrastructure/remote-agent/center-agent-task-native-runtime";
import type { CoreBindings } from "../src/lib/bindings";

const requireCurrentAuthority = vi.hoisted(() => vi.fn());
const submitNativeTurn = vi.hoisted(() => vi.fn());
const stopNativeTaskDelivery = vi.hoisted(() => vi.fn());
const listDeliveriesById = vi.hoisted(() => vi.fn());
const readDeliveryById = vi.hoisted(() => vi.fn());
const readDeliveryBySubmissionId = vi.hoisted(() => vi.fn());
const resolveTaskIdentity = vi.hoisted(() => vi.fn());
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
  RemoteAgentTaskContinuationTerminalError: TaskContinuationTerminalError,
  requireCurrentCenterAgentTaskAdmissionAuthority: requireCurrentAuthority,
  resolveCenterAgentTaskNativeDeliveryIdentity: resolveTaskIdentity,
  stopRemoteAgentCenterAgentTaskDelivery: stopNativeTaskDelivery,
  submitRemoteAgentCenterAgentTaskTurn: submitNativeTurn,
}));
vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({
    listRemoteAgentNativeDeliveriesByDeliveryIds: listDeliveriesById,
    readRemoteAgentNativeDeliveryByDeliveryId: readDeliveryById,
    readRemoteAgentNativeDeliveryBySubmissionId: readDeliveryBySubmissionId,
  })
);

describe("Center Agent Task native runtime", () => {
  beforeEach(() => {
    requireCurrentAuthority.mockReset();
    submitNativeTurn.mockReset();
    stopNativeTaskDelivery.mockReset();
    listDeliveriesById.mockReset();
    readDeliveryById.mockReset();
    readDeliveryBySubmissionId.mockReset();
    resolveTaskIdentity.mockReset();
  });

  it("preserves an exact submission conflict while the native ledger is only submitted", async () => {
    const conflict = new Error("center_agent_task.submission_payload_mismatch");
    submitNativeTurn.mockRejectedValue(conflict);
    readDeliveryById.mockResolvedValue(nativeDelivery("submitted"));

    await expect(runtime().submitTurn(turnRequest())).rejects.toBe(conflict);
  });

  it("freezes the requester and Local Agent carrier from the parent delivery", async () => {
    readDeliveryBySubmissionId.mockResolvedValue(
      nativeDelivery("accepted", {
        onBehalfOfDisplayName: "Mira",
        onBehalfOfProfileId: "human-one",
        workerSubmitRequest: {
          turnEnvelope: {
            centerAgentInteractionSource: {
              client: "codex",
              kind: "local_agent",
              sessionId: "private-thread-id",
            },
          },
        },
      })
    );

    await expect(
      runtime().resolveParent({ parentSubmissionId: "submission-one" })
    ).resolves.toEqual({
      organizationId: "org-one",
      origin: {
        kind: "open_meld",
        localAgent: { client: "codex", kind: "local_agent" },
        requestedBy: {
          displayName: "Mira",
          profileId: "human-one",
          userId: "user-one",
        },
      },
      requesterUserId: "user-one",
    });
  });

  it("recovers the Local Agent carrier after the private worker request is cleared", async () => {
    readDeliveryBySubmissionId.mockResolvedValue(
      nativeDelivery("accepted", {
        executionRecoverySubmitRequest: {
          turnEnvelope: {
            centerAgentInteractionSource: {
              client: "claude-code",
              kind: "local_agent",
              sessionId: "private-recovery-thread-id",
            },
          },
        },
        onBehalfOfDisplayName: "Mira",
        onBehalfOfProfileId: "human-one",
        workerSubmitRequest: null,
      })
    );

    await expect(
      runtime().resolveParent({ parentSubmissionId: "submission-one" })
    ).resolves.toEqual({
      organizationId: "org-one",
      origin: {
        kind: "open_meld",
        localAgent: { client: "claude-code", kind: "local_agent" },
        requestedBy: {
          displayName: "Mira",
          profileId: "human-one",
          userId: "user-one",
        },
      },
      requesterUserId: "user-one",
    });
  });

  it("preserves a pre-watchdog persistence failure while the native ledger is only submitted", async () => {
    const persistenceFailure = new Error(
      "center_agent_task.submission_request_not_durable"
    );
    submitNativeTurn.mockRejectedValue(persistenceFailure);
    readDeliveryById.mockResolvedValue(nativeDelivery("submitted"));

    await expect(runtime().submitTurn(turnRequest())).rejects.toBe(
      persistenceFailure
    );
  });

  it("accepts an error replay only after the native owner has a durable worker acknowledgement", async () => {
    submitNativeTurn.mockRejectedValue(new Error("response_lost_after_ack"));
    readDeliveryById.mockResolvedValue(nativeDelivery("accepted"));

    await expect(runtime().submitTurn(turnRequest())).resolves.toEqual({
      outcome: "accepted",
    });
  });

  it("returns a terminal rejection when authority is revoked before a delivery owner exists", async () => {
    submitNativeTurn.mockRejectedValue(
      new TaskContinuationTerminalError(
        "center_agent_task.requester_membership_unavailable"
      )
    );
    readDeliveryById.mockResolvedValue(null);

    await expect(runtime().submitTurn(turnRequest())).resolves.toEqual({
      failureCode: "center_agent_task.requester_membership_unavailable",
      failureDetail:
        "The native delivery owner rejected this Task attempt before execution started.",
      outcome: "rejected",
    });
  });

  it("confirms Stop when no native delivery was ever admitted", async () => {
    readDeliveryById.mockResolvedValue(null);

    await expect(
      runtime().stopDelivery({
        deliveryId: "delivery-one",
        organizationId: "org-one",
        requesterUserId: "user-one",
      })
    ).resolves.toBe("stopped");
    expect(stopNativeTaskDelivery).not.toHaveBeenCalled();
  });

  it("routes admitted Stop through the native terminal-effects owner", async () => {
    const delivery = nativeDelivery("accepted");
    readDeliveryById.mockResolvedValue(delivery);
    stopNativeTaskDelivery.mockResolvedValue("stopped");

    await expect(
      runtime().stopDelivery({
        deliveryId: delivery.deliveryId,
        organizationId: "org-one",
        requesterUserId: "user-one",
      })
    ).resolves.toBe("stopped");
    expect(stopNativeTaskDelivery).toHaveBeenCalledWith({
      db: expect.anything(),
      delivery,
      env: expect.anything(),
      nowMs: expect.any(Number),
    });
  });

  it("returns execution evidence only for the fresh exact Task delivery", async () => {
    listDeliveriesById.mockResolvedValue([
      nativeDelivery("accepted", {
        deliveryId: "delivery-fresh",
        executionEvidenceAtMs: 1_999_000,
        taskId: "task-fresh",
        updatedAtMs: 2_000_000,
      }),
      nativeDelivery("accepted", {
        deliveryId: "delivery-stale",
        executionEvidenceAtMs: 100_000,
        taskId: "task-stale",
        updatedAtMs: 2_000_000,
      }),
      nativeDelivery("accepted", {
        deliveryId: "delivery-other-owner",
        executionEvidenceAtMs: 1_999_000,
        onBehalfOfUserId: "user-two",
        taskId: "task-other-owner",
        updatedAtMs: 2_000_000,
      }),
      nativeDelivery("submitted", {
        deliveryId: "delivery-submitted",
        executionEvidenceAtMs: 1_999_000,
        taskId: "task-submitted",
        updatedAtMs: 2_000_000,
      }),
    ]);
    resolveTaskIdentity.mockImplementation((delivery) => ({
      taskId: delivery.taskId,
    }));

    await expect(
      runtime().resolveExecutionEvidence({
        attempts: [
          {
            attemptGeneration: 1,
            deliveryId: "delivery-fresh",
            taskId: "task-fresh",
          },
          {
            attemptGeneration: 1,
            deliveryId: "delivery-stale",
            taskId: "task-stale",
          },
          {
            attemptGeneration: 1,
            deliveryId: "delivery-other-owner",
            taskId: "task-other-owner",
          },
          {
            attemptGeneration: 1,
            deliveryId: "delivery-submitted",
            taskId: "task-submitted",
          },
        ],
        nowMs: 2_000_000,
        organizationId: "org-one",
        requesterUserId: "user-one",
      })
    ).resolves.toEqual([
      {
        attemptGeneration: 1,
        kind: "native_delivery",
        observedAt: new Date(1_999_000).toISOString(),
        taskId: "task-fresh",
      },
    ]);
  });
});

function runtime() {
  return createCenterAgentTaskNativeRuntimePort({
    deliveryDb: {} as D1Database,
    env: {} as CoreBindings,
  });
}

function turnRequest() {
  return {
    deliveryId: "delivery-one",
    idempotencyKey: "center-agent-task-turn:operation-one",
    instruction: "Review the release safety contract.",
    nowMs: 1000,
    organizationId: "org-one",
    parent: { kind: "submission" as const, submissionId: "parent-one" },
    requesterUserId: "user-one",
    taskEventId: "event-one",
    taskId: "task-one",
  };
}

function nativeDelivery(
  status: "accepted" | "submitted",
  overrides: Record<string, unknown> = {}
) {
  return {
    deliveryId: "delivery-one",
    failureCode: null,
    failureDetail: null,
    onBehalfOfUserId: "user-one",
    organizationId: "org-one",
    status,
    taskId: "task-one",
    executionEvidenceAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}
