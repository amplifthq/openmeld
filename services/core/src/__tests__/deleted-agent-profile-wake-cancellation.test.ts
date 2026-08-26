import {
  projectTargetWakeLifecycleIdentity,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
} from "@openmeld/schemas";
import type {
  RuntimeTransportDeliverDispatchRequest,
  RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse,
  RuntimeTransportRuntimeCoordinatorWakeStopResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { cancelDeletedAgentProfileWakesWithPorts } from "../runtime-transport/application/deleted-agent-profile-wake-cancellation";
import {
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorRunCommandState,
} from "../runtime-transport/application/runtime-coordinator-authority";

const NOW_MS = 1_700_000_000_000;
const OWNER_USER_ID = "owner-1";
const TARGET_PROFILE_ID = "agt_deleted";

const buildHeadRecord = (
  input: {
    ownerUserId?: string;
    status?: RuntimeCoordinatorHeadLifecycleRecord["status"];
    targetProfileId?: string;
  } = {}
): RuntimeCoordinatorHeadLifecycleRecord => {
  const targetProfileId = input.targetProfileId ?? TARGET_PROFILE_ID;
  const identity = projectTargetWakeLifecycleIdentity({
    clientMessageId: "client-message-head",
    dispatchId: `dispatch-${targetProfileId}`,
    sourceSignalId: `signal-${targetProfileId}`,
    spaceId: "space-head",
    targetProfileId,
  });
  return {
    createdAtMs: NOW_MS - 1000,
    duplicateDispatches: [],
    executionLinkedAtMs: null,
    modelVersion: RUNTIME_COORDINATOR_HEAD_LIFECYCLE_MODEL_VERSION,
    ownerUserId: input.ownerUserId ?? OWNER_USER_ID,
    primaryDispatchId: `dispatch-${targetProfileId}`,
    primaryIdempotencyKey: `idempotency-${targetProfileId}`,
    runtimeCoordinatorExecutionId: null,
    status: input.status ?? "waiting",
    targetDisplay: {
      targetProfileMentionLabel: "@Deleted Codex",
      targetProfileName: "Deleted Codex",
    },
    targetWakeLifecycleId: identity.targetWakeLifecycleId,
    targetWakeLifecycleIdentity: identity,
    updatedAtMs: NOW_MS,
  };
};

const buildRunCommandState = (
  input: {
    ownerUserId?: string;
    phase?: RuntimeCoordinatorRunCommandState["localProgress"]["phase"];
    runtimeCoordinatorExecutionId?: string;
    targetProfileId?: string;
  } = {}
): RuntimeCoordinatorRunCommandState => {
  const targetProfileId = input.targetProfileId ?? TARGET_PROFILE_ID;
  return {
    activeRunId: `run-${targetProfileId}`,
    attemptId: `attempt-${targetProfileId}`,
    createdAtMs: NOW_MS - 1000,
    dispatchId: `dispatch-${targetProfileId}`,
    lastCommandReasonCode: null,
    lastDeliveryProvenance: {
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      leaseEpoch: 1,
    },
    localProgress: {
      acceptedLocalAtMs: NOW_MS - 900,
      completedLocalAtMs: null,
      lastLifecycleAtMs: NOW_MS - 100,
      phase: input.phase ?? "running",
      resultReceivedAtMs:
        input.phase === "result_received" ? NOW_MS - 50 : null,
      runningAtMs: NOW_MS - 800,
    },
    modelVersion: RUNTIME_COORDINATOR_RUN_COMMAND_STATE_MODEL_VERSION,
    ownerUserId: input.ownerUserId ?? OWNER_USER_ID,
    pendingInteraction: null,
    profileId: targetProfileId,
    redeliveryCount: 0,
    runtimeCoordinatorExecutionId:
      input.runtimeCoordinatorExecutionId ?? `rce-${targetProfileId}`,
    sanitizedDeliveryRequest: {
      code: "daemon.dispatch.deliver",
      payload: {
        dispatchId: `dispatch-${targetProfileId}`,
        spaceId: "space-run",
      },
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    } as unknown as RuntimeTransportDeliverDispatchRequest,
    sourceClientMessageId: "client-message-run",
    targetProfileId,
    updatedAtMs: NOW_MS,
  };
};

const stoppedHeadResponse = (
  record: RuntimeCoordinatorHeadLifecycleRecord
): RuntimeTransportRuntimeCoordinatorHeadPreAgentStopResponse => ({
  ok: true,
  primaryDispatchId: record.primaryDispatchId,
  publicationIntentId: `wake-stopped:head:${record.targetWakeLifecycleId}`,
  reasonCode: "runtime_coordinator.pre_agent_stop_requested",
  runtimeCoordinatorExecutionId: null,
  status: "stopped_before_execution",
  targetWakeLifecycleId: record.targetWakeLifecycleId,
});

const stoppedExecutionResponse = (
  commandState: RuntimeCoordinatorRunCommandState
): RuntimeTransportRuntimeCoordinatorWakeStopResponse => ({
  ok: true,
  runtimeCoordinatorExecutionId: commandState.runtimeCoordinatorExecutionId,
  status: "cancellation_requested",
  targetProfileId: commandState.targetProfileId,
  cancellationState: {
    observedAtMs: NOW_MS,
    reasonCode: "runtime_coordinator.wake_stop_requested",
    status: "delivery_pending",
  },
});

describe("deleted Agent Profile Wake cancellation", () => {
  it("stops only the deleted target's active pre-agent heads and executions", async () => {
    const targetHead = buildHeadRecord();
    const terminalTargetHead = buildHeadRecord({
      status: "stopped_before_execution",
    });
    const otherTargetHead = buildHeadRecord({
      targetProfileId: "agt_other",
    });
    const targetRun = buildRunCommandState();
    const linkedTargetHead: RuntimeCoordinatorHeadLifecycleRecord = {
      ...buildHeadRecord({ status: "accepted" }),
      executionLinkedAtMs: NOW_MS - 800,
      runtimeCoordinatorExecutionId: targetRun.runtimeCoordinatorExecutionId,
    };
    const completedTargetRun = buildRunCommandState({
      phase: "result_received",
      runtimeCoordinatorExecutionId: "rce-completed-target",
    });
    const otherOwnerRun = buildRunCommandState({ ownerUserId: "owner-2" });
    const stopHeadBeforeExecution = vi.fn(async () =>
      stoppedHeadResponse(targetHead)
    );
    const stopRuntimeExecution = vi.fn(async () =>
      stoppedExecutionResponse(targetRun)
    );

    const response = await cancelDeletedAgentProfileWakesWithPorts({
      request: {
        ownerUserId: OWNER_USER_ID,
        targetProfileId: TARGET_PROFILE_ID,
      },
      ports: {
        readHeadLifecycleRecords: async () => [
          targetHead,
          linkedTargetHead,
          terminalTargetHead,
          otherTargetHead,
        ],
        readRunCommandStates: async () => [
          targetRun,
          completedTargetRun,
          otherOwnerRun,
        ],
        stopHeadBeforeExecution,
        stopRuntimeExecution,
      },
    });

    expect(response.status).toBe("cancellation_requested");
    expect(stopHeadBeforeExecution).toHaveBeenCalledOnce();
    expect(stopHeadBeforeExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: targetHead.primaryDispatchId,
        ownerUserId: OWNER_USER_ID,
        reason: "The Agent Profile was deleted.",
        targetProfileName: "Deleted Codex",
        targetWakeLifecycleIdentity: targetHead.targetWakeLifecycleIdentity,
      })
    );
    expect(stopRuntimeExecution).toHaveBeenCalledOnce();
    expect(stopRuntimeExecution).toHaveBeenCalledWith({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: OWNER_USER_ID,
      runtimeCoordinatorExecutionId: targetRun.runtimeCoordinatorExecutionId,
      dispatchId: targetRun.dispatchId,
      spaceId: "space-run",
      sourceClientMessageId: "client-message-run",
      targetProfileId: TARGET_PROFILE_ID,
      reason: "The Agent Profile was deleted.",
    });
  });

  it("returns inactive when the deleted target has no active Wake authority", async () => {
    const stopHeadBeforeExecution = vi.fn();
    const stopRuntimeExecution = vi.fn();

    const response = await cancelDeletedAgentProfileWakesWithPorts({
      request: {
        ownerUserId: OWNER_USER_ID,
        targetProfileId: TARGET_PROFILE_ID,
      },
      ports: {
        readHeadLifecycleRecords: async () => [],
        readRunCommandStates: async () => [],
        stopHeadBeforeExecution,
        stopRuntimeExecution,
      },
    });

    expect(response).toEqual({
      executionStopOutcomes: [],
      headStopOutcomes: [],
      status: "inactive",
      targetProfileId: TARGET_PROFILE_ID,
    });
    expect(stopHeadBeforeExecution).not.toHaveBeenCalled();
    expect(stopRuntimeExecution).not.toHaveBeenCalled();
  });
});
