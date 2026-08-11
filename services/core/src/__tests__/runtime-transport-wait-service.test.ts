import { DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS } from "@openmeld/agent-runtime";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimeTransportMutableState,
  type PendingDispatchState,
  type RuntimeTransportProfileLeaseState,
} from "../runtime-transport/application/runtime-transport-state";
import {
  cleanupExpiredPendingDispatches,
  failPendingDispatchResultWaitersForConnectionGeneration,
  waitDispatchResult,
} from "../runtime-transport/application/runtime-transport-wait-service";

const COMPATIBLE_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible" as const,
  status: "compatible" as const,
};

const LEGACY_RUNTIME_TOTAL_TIMEOUT_MS = 120_000;

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

const createLease = (
  overrides: Partial<RuntimeTransportProfileLeaseState> = {}
): RuntimeTransportProfileLeaseState => {
  return {
    profileId: "agt-1",
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    leaseEpoch: 3,
    lastHeartbeatMs: 1000,
    capabilities: {},
    ...overrides,
    executionCompatibility:
      overrides.executionCompatibility ?? COMPATIBLE_EXECUTION_CONTRACT,
  };
};

const createPendingDispatch = (
  overrides: Partial<PendingDispatchState> = {}
): PendingDispatchState => {
  const createdAtMs = overrides.createdAtMs ?? Date.now();
  return {
    acceptedLocalAtMs: overrides.acceptedLocalAtMs ?? null,
    attemptId: overrides.attemptId ?? "attempt-1",
    completedLocalAtMs: overrides.completedLocalAtMs ?? null,
    connectionGeneration: overrides.connectionGeneration ?? 1,
    createdAtMs,
    daemonSessionId: overrides.daemonSessionId ?? "daemon-session-1",
    dispatchId: overrides.dispatchId ?? "dispatch-1",
    executionIdentity:
      overrides.executionIdentity ??
      buildExecutionIdentity({
        dispatchId: overrides.dispatchId ?? "dispatch-1",
        targetProfileId: overrides.profileId ?? "agt-1",
      }),
    lastLifecycleAtMs: overrides.lastLifecycleAtMs ?? createdAtMs,
    leaseEpoch: overrides.leaseEpoch ?? 3,
    phase: overrides.phase ?? "starting",
    profileId: overrides.profileId ?? "agt-1",
    runningAtMs: overrides.runningAtMs ?? null,
    runtimeCoordinatorExecutionId:
      overrides.runtimeCoordinatorExecutionId ?? "rce-dispatch-1",
    sourceClientMessageId:
      overrides.sourceClientMessageId ?? "client-message-1",
    sourceSignalId: overrides.sourceSignalId ?? "signal-1",
    spaceAccess:
      overrides.spaceAccess ??
      createDispatchContinuationSpaceAccessContext({
        attemptId: overrides.attemptId ?? "attempt-1",
        dispatchId: overrides.dispatchId ?? "dispatch-1",
        requestContext: {
          actorContext: {
            openMeldProfileId: overrides.profileId ?? "agt-1",
            profileKind: "agent",
            requestId: "dispatch-access-1",
          },
        },
        sourceSignalId: "signal-1",
        spaceId: overrides.spaceId ?? "space-1",
        targetProfileId: overrides.profileId ?? "agt-1",
      }),
    spaceId: overrides.spaceId ?? "space-1",
    taskId: overrides.taskId ?? "task-1",
    targetProfileName: overrides.targetProfileName ?? "dev-repro-claude",
  };
};

describe("waitDispatchResult", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns pending without clearing pending dispatch when the same lease still owns execution", async () => {
    vi.useFakeTimers();
    const state = createRuntimeTransportMutableState();
    state.profileLeasesByProfileId.set("agt-1", createLease());
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    const createdAtMs = Date.now();
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch({ createdAtMs })
    );

    const resultPromise = waitDispatchResult(state, {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 3,
      timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({
      lifecycle: {
        acceptedLocalAtMs: null,
        completedLocalAtMs: null,
        createdAtMs,
        lastLifecycleAtMs: createdAtMs,
        phase: "starting",
        runningAtMs: null,
      },
      state: "pending",
    });
    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(true);
  });

  it("returns stale_lease and clears pending dispatch when lease ownership changes during wait", async () => {
    vi.useFakeTimers();
    const state = createRuntimeTransportMutableState();
    state.profileLeasesByProfileId.set("agt-1", createLease());
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch()
    );

    const resultPromise = waitDispatchResult(state, {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 3,
      timeoutMs: 1000,
    });
    state.profileLeasesByProfileId.set(
      "agt-1",
      createLease({
        daemonSessionId: "daemon-session-2",
        leaseEpoch: 4,
      })
    );
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({
      reasonCode: "daemon.session.stale_lease",
      state: "failed",
    });
    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(false);
  });

  it("keeps locally accepted dispatch pending when the daemon reconnects with a newer connection generation", async () => {
    vi.useFakeTimers();
    const state = createRuntimeTransportMutableState();
    const createdAtMs = Date.now();
    const acceptedAtMs = createdAtMs + 50;
    state.profileLeasesByProfileId.set("agt-1", createLease());
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 2,
      connectedAtMs: createdAtMs + 500,
      lastHeartbeatMs: createdAtMs + 500,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch({
        acceptedLocalAtMs: acceptedAtMs,
        createdAtMs,
        lastLifecycleAtMs: acceptedAtMs,
        phase: "running",
        runningAtMs: acceptedAtMs,
      })
    );

    const resultPromise = waitDispatchResult(state, {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 3,
      timeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({
      lifecycle: {
        acceptedLocalAtMs: acceptedAtMs,
        completedLocalAtMs: null,
        createdAtMs,
        lastLifecycleAtMs: acceptedAtMs,
        phase: "running",
        runningAtMs: acceptedAtMs,
      },
      state: "pending",
    });
    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(true);
  });

  it("does not clear locally accepted pending dispatches on connection-generation failure fanout", () => {
    const state = createRuntimeTransportMutableState();
    const acceptedAtMs = Date.now();
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch({
        acceptedLocalAtMs: acceptedAtMs,
        lastLifecycleAtMs: acceptedAtMs,
        phase: "running",
        runningAtMs: acceptedAtMs,
      })
    );

    failPendingDispatchResultWaitersForConnectionGeneration(
      state,
      "daemon-session-1",
      1,
      {
        reasonCode: "daemon.profile.offline",
        state: "failed",
      }
    );

    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(true);
  });

  it("keeps running dispatches beyond the legacy total timeout when lifecycle evidence is fresh", () => {
    const state = createRuntimeTransportMutableState();
    const createdAtMs = 1_700_000_000_000;
    const acceptedAtMs = createdAtMs + 50;
    const nowMs = acceptedAtMs + LEGACY_RUNTIME_TOTAL_TIMEOUT_MS + 1;
    const freshLifecycleAtMs = nowMs - 1000;
    state.profileLeasesByProfileId.set("agt-1", createLease());
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 2,
      connectedAtMs: createdAtMs + 500,
      lastHeartbeatMs: createdAtMs + 500,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch({
        acceptedLocalAtMs: acceptedAtMs,
        createdAtMs,
        lastLifecycleAtMs: freshLifecycleAtMs,
        phase: "running",
        runningAtMs: acceptedAtMs,
      })
    );

    cleanupExpiredPendingDispatches(state, nowMs);
    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(true);
  });

  it("marks running dispatches stalled only after lifecycle evidence goes stale", async () => {
    vi.useFakeTimers();
    const state = createRuntimeTransportMutableState();
    const createdAtMs = Date.now();
    const acceptedAtMs = createdAtMs + 50;
    const lastLifecycleAtMs = acceptedAtMs + 1000;
    state.profileLeasesByProfileId.set("agt-1", createLease());
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: createdAtMs,
      lastHeartbeatMs: createdAtMs,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch({
        acceptedLocalAtMs: acceptedAtMs,
        createdAtMs,
        lastLifecycleAtMs,
        phase: "running",
        runningAtMs: acceptedAtMs,
      })
    );

    const resultPromise = waitDispatchResult(state, {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 3,
      timeoutMs: 1000,
    });

    cleanupExpiredPendingDispatches(
      state,
      lastLifecycleAtMs + DEFAULT_TASK_PROGRESS_EVIDENCE_STALE_AFTER_MS + 1
    );

    await expect(resultPromise).resolves.toMatchObject({
      lifecycle: {
        lastLifecycleAtMs,
        phase: "running",
        runningAtMs: acceptedAtMs,
      },
      reasonCode: "daemon.delivery.execution_stalled",
      state: "failed",
    });
    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(false);
  });

  it("returns connection_replaced when pending dispatch is missing but the same daemon session has a newer connection generation", async () => {
    const state = createRuntimeTransportMutableState();
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 2,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });

    await expect(
      waitDispatchResult(state, {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        leaseEpoch: 3,
        timeoutMs: 1000,
      })
    ).resolves.toEqual({
      reasonCode: "daemon.session.connection_replaced",
      state: "failed",
    });
  });

  it("returns connection_replaced on timeout when pending dispatch disappears after the daemon reconnects", async () => {
    vi.useFakeTimers();
    const state = createRuntimeTransportMutableState();
    state.profileLeasesByProfileId.set("agt-1", createLease());
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      connectedAtMs: 1000,
      lastHeartbeatMs: 1000,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });
    state.pendingDispatches.set(
      "dispatch-1::attempt-1",
      createPendingDispatch()
    );

    const resultPromise = waitDispatchResult(state, {
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "daemon-session-1",
      connectionGeneration: 1,
      leaseEpoch: 3,
      timeoutMs: 1000,
    });

    state.pendingDispatches.delete("dispatch-1::attempt-1");
    state.sessionsById.set("daemon-session-1", {
      ownerUserId: "user-1",
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 2,
      connectedAtMs: 1100,
      lastHeartbeatMs: 1100,
      deliveryDisconnectedAtMs: null,
      capabilities: {},
      executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
      profileIds: new Set(["agt-1"]),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: null,
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(resultPromise).resolves.toEqual({
      reasonCode: "daemon.session.connection_replaced",
      state: "failed",
    });
  });
});
