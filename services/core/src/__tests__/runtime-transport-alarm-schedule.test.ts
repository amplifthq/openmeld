import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type {
  DaemonExecutionCompatibility,
  RuntimeTransportCapabilities,
} from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import {
  reconcileRuntimeTransportAlarmAtMs,
  resolveNextRuntimeTransportAlarmAtMs,
} from "../runtime-transport/application/runtime-transport-alarm-schedule";
import { LEASE_TTL_MS } from "../runtime-transport/application/runtime-transport-session-service";
import {
  type CompletedDispatchResultState,
  createRuntimeTransportMutableState,
  type PendingDispatchState,
} from "../runtime-transport/application/runtime-transport-state";

const EMPTY_CAPABILITIES = {} as RuntimeTransportCapabilities;
const COMPATIBLE_EXECUTION_CONTRACT: DaemonExecutionCompatibility = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
};

const buildExecutionIdentity = (input: {
  dispatchId: string;
  targetProfileId: string;
}) => ({
  authority: "core_runtime_registry_binding_route" as const,
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: "space-1",
    dispatchId: input.dispatchId,
    targetProfileId: input.targetProfileId,
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority" as const,
      value: "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
});

const buildPendingDispatch = (
  input: Partial<PendingDispatchState> = {}
): PendingDispatchState => ({
  acceptedLocalAtMs: input.acceptedLocalAtMs ?? null,
  attemptId: input.attemptId ?? "attempt-1",
  completedLocalAtMs: input.completedLocalAtMs ?? null,
  dispatchId: input.dispatchId ?? "dispatch-1",
  daemonSessionId: input.daemonSessionId ?? "session-1",
  executionIdentity:
    input.executionIdentity ??
    buildExecutionIdentity({
      dispatchId: input.dispatchId ?? "dispatch-1",
      targetProfileId: input.profileId ?? "agt-1",
    }),
  connectionGeneration: input.connectionGeneration ?? 1,
  lastLifecycleAtMs: input.lastLifecycleAtMs ?? input.createdAtMs ?? 0,
  leaseEpoch: input.leaseEpoch ?? 1,
  phase: input.phase ?? "starting",
  profileId: input.profileId ?? "agt-1",
  runningAtMs: input.runningAtMs ?? null,
  runtimeCoordinatorExecutionId:
    input.runtimeCoordinatorExecutionId ?? "rce-dispatch-1",
  sourceClientMessageId: input.sourceClientMessageId ?? "client-message-1",
  sourceSignalId: input.sourceSignalId ?? "signal-1",
  spaceAccess:
    input.spaceAccess ??
    createDispatchContinuationSpaceAccessContext({
      dispatchId: input.dispatchId ?? "dispatch-1",
      requestContext: {
        actorContext: {
          openMeldProfileId: input.profileId ?? "agt-1",
          profileKind: "agent",
          requestId: "dispatch-access-1",
        },
      },
      sourceSignalId: "signal-1",
      spaceId: input.spaceId ?? "space-1",
      targetProfileId: input.profileId ?? "agt-1",
    }),
  spaceId: input.spaceId ?? "space-1",
  taskId: input.taskId ?? "task-1",
  targetProfileName: input.targetProfileName ?? "dev-repro-claude",
  createdAtMs: input.createdAtMs ?? 0,
});

const buildCompletedResult = (
  input: Partial<CompletedDispatchResultState> = {}
): CompletedDispatchResultState => ({
  attemptId: input.attemptId ?? "attempt-1",
  dispatchId: input.dispatchId ?? "dispatch-1",
  daemonSessionId: input.daemonSessionId ?? "session-1",
  executionIdentity:
    input.executionIdentity ??
    buildExecutionIdentity({
      dispatchId: input.dispatchId ?? "dispatch-1",
      targetProfileId: input.targetProfileId ?? "agt-1",
    }),
  connectionGeneration: input.connectionGeneration ?? 1,
  leaseEpoch: input.leaseEpoch ?? 1,
  receivedAtMs: input.receivedAtMs ?? 0,
  runtimeCoordinatorExecutionId:
    input.runtimeCoordinatorExecutionId ?? "rce-dispatch-1",
  sourceClientMessageId: input.sourceClientMessageId ?? "client-message-1",
  submittedConnectionGeneration: input.submittedConnectionGeneration ?? 1,
  taskId: input.taskId ?? "task-1",
  targetProfileId: input.targetProfileId ?? "agt-1",
  taskResult:
    input.taskResult ??
    ({
      v: 1,
      code: "service.task_result",
      payload: {
        status: "success",
        taskId: "task-1",
        sourceEventId: "evt-1",
        agentId: "agt-1",
        deduped: false,
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "ctx-1",
        output: "ok",
      },
    } as CompletedDispatchResultState["taskResult"]),
});

describe("resolveNextRuntimeTransportAlarmAtMs", () => {
  it("returns null when runtime transport has no housekeeping deadlines", () => {
    const state = createRuntimeTransportMutableState();

    expect(resolveNextRuntimeTransportAlarmAtMs(state)).toBeNull();
  });

  it("returns the earliest lease expiry across leases and stale sessions", () => {
    const state = createRuntimeTransportMutableState();
    state.profileLeasesByProfileId.set("agt-lease", {
      profileId: "agt-lease",
      daemonSessionId: "session-lease",
      deviceId: "device-lease",
      lane: "dev-local",
      leaseEpoch: 1,
      lastHeartbeatMs: 20_000,
      capabilities: EMPTY_CAPABILITIES,
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
    });
    state.sessionsById.set("session-stale", {
      ownerUserId: "owner-1",
      daemonSessionId: "session-stale",
      deviceId: "device-stale",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: 0,
      lastHeartbeatMs: 10_000,
      deliveryDisconnectedAtMs: null,
      capabilities: EMPTY_CAPABILITIES,
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set<string>(),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });

    expect(resolveNextRuntimeTransportAlarmAtMs(state)).toBe(
      10_000 + LEASE_TTL_MS
    );
  });

  it("prefers the earlier lifecycle timeout over later lease cleanup", () => {
    const state = createRuntimeTransportMutableState();
    state.profileLeasesByProfileId.set("agt-lease", {
      profileId: "agt-lease",
      daemonSessionId: "session-lease",
      deviceId: "device-lease",
      lane: "dev-local",
      leaseEpoch: 1,
      lastHeartbeatMs: 250_000,
      capabilities: EMPTY_CAPABILITIES,
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
    });
    state.pendingDispatches.set(
      "dispatch-pending",
      buildPendingDispatch({ createdAtMs: 1000 })
    );

    expect(resolveNextRuntimeTransportAlarmAtMs(state)).toBe(31_000);
  });

  it("uses completed result ttl when it is the earliest remaining deadline", () => {
    const state = createRuntimeTransportMutableState();
    state.completedDispatchResults.set(
      "dispatch-result",
      buildCompletedResult({ receivedAtMs: 5000 })
    );

    expect(resolveNextRuntimeTransportAlarmAtMs(state)).toBe(305_000);
  });
});

describe("reconcileRuntimeTransportAlarmAtMs", () => {
  it("keeps an earlier scheduled alarm instead of rewriting it later", () => {
    expect(
      reconcileRuntimeTransportAlarmAtMs({
        nowMs: 10_000,
        scheduledAlarmAtMs: 60_000,
        nextRequiredAlarmAtMs: 90_000,
      })
    ).toEqual({
      kind: "keep",
      alarmAtMs: 60_000,
    });
  });

  it("moves the alarm earlier when a nearer cleanup deadline appears", () => {
    expect(
      reconcileRuntimeTransportAlarmAtMs({
        nowMs: 10_000,
        scheduledAlarmAtMs: 90_000,
        nextRequiredAlarmAtMs: 30_000,
      })
    ).toEqual({
      kind: "set",
      alarmAtMs: 30_000,
    });
  });

  it("deletes the alarm when no housekeeping work remains", () => {
    expect(
      reconcileRuntimeTransportAlarmAtMs({
        nowMs: 10_000,
        scheduledAlarmAtMs: 90_000,
        nextRequiredAlarmAtMs: null,
      })
    ).toEqual({
      kind: "delete",
    });
  });
});
