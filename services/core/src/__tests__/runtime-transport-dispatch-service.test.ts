import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import type { RuntimeTransportDeliverDispatchRequest } from "@openmeld/schemas/types";
import { createDispatchContinuationSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import {
  deliverDispatch,
  handleDispatchLifecycle,
  handleSubmitTaskResult,
} from "../runtime-transport/application/runtime-transport-dispatch-service";
import {
  buildDispatchAttemptKey,
  createRuntimeTransportMutableState,
  type PendingDispatchState,
} from "../runtime-transport/application/runtime-transport-state";
import {
  RUNTIME_TRANSPORT_DELIVER_CONVERGENCE_SAFETY_MARGIN_MS,
  RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS,
  RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS,
} from "../strategy-constants";

const COMPATIBLE_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible" as const,
  status: "compatible" as const,
};

const MISSING_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: null,
  reasonCode: "daemon.runtime_contract.missing" as const,
  status: "update_required" as const,
};

const MISMATCHED_EXECUTION_CONTRACT = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: "daemon-runtime-epoch-before-execution-token",
  reasonCode: "daemon.runtime_contract.mismatch" as const,
  status: "update_required" as const,
};

const createDeliveryExecutionIdentity = (overrides?: {
  dispatchId?: string;
  openMeldServiceRuntimeId?: string;
  targetProfileId?: string;
}) => ({
  authority: "core_runtime_registry_binding_route" as const,
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: "space-1",
    dispatchId: overrides?.dispatchId ?? "dispatch-1",
    targetProfileId: overrides?.targetProfileId ?? "agt-1",
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority" as const,
      value: overrides?.openMeldServiceRuntimeId ?? "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
});

const createResultIdentityEcho = (
  executionIdentity = createDeliveryExecutionIdentity()
) => ({
  echoSource: "daemon_delivery_context" as const,
  core: executionIdentity.core,
});

const createExecutionTokenEnvelope = () => ({
  authorityScope: {
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
    openMeldServiceRuntimeId: "runtime-1",
  },
  deliveryIdempotencyKey: "rce-dispatch-1:run-1",
  deliveryProvenance: {
    connectionGeneration: 1,
    daemonSessionId: "session-2",
    leaseEpoch: 2,
  },
  executionScope: {
    dispatchId: "dispatch-1",
    runtimeCoordinatorExecutionId: "rce-dispatch-1",
    sourceClientMessageId: "client-message-1",
    spaceId: "space-1",
    targetProfileId: "agt-1",
  },
  executionToken:
    "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  expiresAtMs: null,
  issuedAtMs: 1_700_000_000_000,
  modelVersion: "openmeld.runtime_coordinator.execution_token.v1" as const,
  runId: "run-1",
  tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  tokenStatus: "active" as const,
});

const createDispatchRequest = (overrides?: {
  attemptId?: string;
  connectionGeneration?: number;
  daemonSessionId?: string;
  leaseEpoch?: number;
}) => {
  const attemptId = overrides?.attemptId ?? "attempt-1";

  return {
    v: 1 as const,
    dispatchId: "dispatch-1",
    attemptId,
    ownerUserId: "owner-1",
    profileId: "agt-1",
    daemonSessionId: overrides?.daemonSessionId ?? "session-2",
    connectionGeneration: overrides?.connectionGeneration ?? 1,
    leaseEpoch: overrides?.leaseEpoch ?? 2,
    payload: {
      runtimeCoordinatorExecutionId: "rce-dispatch-1",
      attemptId,
      dispatchId: "dispatch-1",
      executionIdentity: createDeliveryExecutionIdentity({
        dispatchId: "dispatch-1",
        targetProfileId: "agt-1",
      }),
      taskId: "task-1",
      spaceId: "space-1",
      sourceEventId: "evt-1",
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human" as const,
      },
      targetProfileId: "agt-1",
      dispatchChainId: "chain-1",
      autoRelayDepth: 0,
      visitedProfileIds: [],
      visitedProfileIdsHash: "hash-1",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only" as const,
      transportMode: null,
      controllerSnapshot: {
        targetBindingState: "bound" as const,
        targetBindingEnabled: true,
        agentControllerRef: "codex",
      },
      contextIdMappingSpec: null,
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only" as const,
        ruleSource: "registry" as const,
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      enqueuedAtMs: 1_700_000_000_000,
      idempotencyKey: "idempotency-1",
    },
  };
};

const createState = () => {
  const state = createRuntimeTransportMutableState();
  const socket = {} as WebSocket;

  state.ownerUserId = "owner-1";
  state.sessionsById.set("session-2", {
    ownerUserId: "owner-1",
    daemonSessionId: "session-2",
    deviceId: "device-2",
    lane: "dev-local",
    connectionGeneration: 1,
    connectedAtMs: 1_700_000_000_000,
    lastHeartbeatMs: 1_700_000_000_000,
    deliveryDisconnectedAtMs: null,
    capabilities: {},
    executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
    profileIds: new Set(["agt-1"]),
    localWakeRouteReport: null,
    rejectedProfileRegistrationsByProfileId: new Map(),
    socket,
  });
  state.profileLeasesByProfileId.set("agt-1", {
    profileId: "agt-1",
    daemonSessionId: "session-2",
    deviceId: "device-2",
    lane: "dev-local",
    leaseEpoch: 2,
    lastHeartbeatMs: 1_700_000_000_000,
    capabilities: {},
    executionCompatibility: COMPATIBLE_EXECUTION_CONTRACT,
  });

  return { state, socket };
};

const buildPendingDispatch = (
  input: Partial<PendingDispatchState> = {}
): PendingDispatchState => {
  const createdAtMs = input.createdAtMs ?? 1_700_000_000_000;
  return {
    acceptedLocalAtMs: input.acceptedLocalAtMs ?? null,
    attemptId: input.attemptId ?? "attempt-1",
    completedLocalAtMs: input.completedLocalAtMs ?? null,
    dispatchId: input.dispatchId ?? "dispatch-1",
    daemonSessionId: input.daemonSessionId ?? "session-2",
    executionIdentity:
      input.executionIdentity ??
      createDeliveryExecutionIdentity({
        dispatchId: input.dispatchId ?? "dispatch-1",
        targetProfileId: input.profileId ?? "agt-1",
      }),
    connectionGeneration: input.connectionGeneration ?? 1,
    createdAtMs,
    lastLifecycleAtMs: input.lastLifecycleAtMs ?? createdAtMs,
    leaseEpoch: input.leaseEpoch ?? 2,
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
        attemptId: input.attemptId ?? "attempt-1",
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
  };
};

describe("runtime transport dispatch service", () => {
  const createFencedDeliveryFixture = (input?: {
    agentControllerRef?: string;
    appliedConfigurationRevision?: number;
    expectedConfigurationRevision?: number;
  }) => {
    const appliedConfigurationRevision =
      input?.appliedConfigurationRevision ?? 6;
    const expectedConfigurationRevision =
      input?.expectedConfigurationRevision ?? 7;
    const { state } = createState();
    const sendFrame = vi.fn();
    const session = state.sessionsById.get("session-2");
    if (!session) {
      throw new Error("test session missing");
    }
    session.capabilities.profileConfigurationRevision = true;
    session.localWakeRouteReport = {
      daemonSessionId: "session-2",
      deviceId: "device-2",
      includedProfileIds: ["agt-1"],
      lane: "dev-local",
      reportedAtMs: 1_700_000_000_000,
      profileConfigurationRevisions: [
        {
          bindingId: "binding-1",
          configurationRevision: appliedConfigurationRevision,
          profileId: "agt-1",
        },
      ],
      skippedProfiles: [],
    };
    const request: RuntimeTransportDeliverDispatchRequest =
      createDispatchRequest();
    request.payload.controllerSnapshot.bindingId = "binding-1";
    request.payload.controllerSnapshot.configurationRevision =
      expectedConfigurationRevision;
    if (input?.agentControllerRef) {
      request.payload.controllerSnapshot.agentControllerRef =
        input.agentControllerRef;
    }

    return { request, sendFrame, session, state };
  };

  const AGENT_CONTROLLER_REFS_UNDER_TEST = ["codex", "opencode"] as const;

  // Both representative workstation Local Agent controllers share the exact
  // same Runtime Transport admission fence; the profile revision identity is
  // controller-neutral, so each must converge and deliver identically.
  it.each(
    AGENT_CONTROLLER_REFS_UNDER_TEST
  )("waits out ordinary %s profile revision propagation and delivers once the Service applies the accepted revision", async (agentControllerRef) => {
    // Production repro: a settings save bumps Binding revision to N+1 and an
    // immediate Wake freezes that revision while the local Service still
    // reports N. Runtime Transport must wait for route-catalog convergence
    // (with a refresh nudge) instead of rejecting and forcing a second Wake.
    const fixture = createFencedDeliveryFixture({
      agentControllerRef,
    });
    let convergencePolls = 0;
    // Deterministic virtual clock: every now() read advances the timeline so
    // the bounded wait runs to completion without real time or CPU spinning.
    let virtualNowMs = 0;
    const response = await deliverDispatch(fixture.state, fixture.request, {
      cleanupCompletedResults: () => undefined,
      profileConfigurationConvergence: {
        now: () => {
          const value = virtualNowMs;
          virtualNowMs += 100;
          return value;
        },
        sleep: () => {
          convergencePolls += 1;
          // Simulate the daemon applying expected-routes v3 and re-registering.
          if (convergencePolls === 1) {
            const report = fixture.session.localWakeRouteReport;
            if (!report?.profileConfigurationRevisions?.[0]) {
              throw new Error("test report missing");
            }
            report.profileConfigurationRevisions[0].configurationRevision = 7;
            report.reportedAtMs += 1000;
          }
          return Promise.resolve();
        },
      },
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame: fixture.sendFrame,
    });

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(fixture.sendFrame).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: "daemon.route_catalog.changed",
        payload: { reason: "profile_configuration_convergence" },
      })
    );
    const deliveredRequest = fixture.sendFrame.mock.calls.find(
      (call) =>
        (call[1] as { code?: string }).code === "daemon.dispatch.deliver"
    )?.[1]?.payload as RuntimeTransportDeliverDispatchRequest | undefined;
    expect(deliveredRequest?.payload.controllerSnapshot).toMatchObject({
      agentControllerRef,
      bindingId: "binding-1",
      configurationRevision: 7,
    });
  });

  it.each(
    AGENT_CONTROLLER_REFS_UNDER_TEST
  )("%s fails closed when propagation does not converge inside the bounded window", async (agentControllerRef) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Silence the expected fence diagnostic in test output.
    });
    let virtualDeadlineMs = 0;
    try {
      const { request, sendFrame, state } = createFencedDeliveryFixture({
        agentControllerRef,
      });

      const response = await deliverDispatch(state, request, {
        cleanupCompletedResults: () => undefined,
        profileConfigurationConvergence: {
          pollIntervalMs: 1,
          now: () => {
            // Every clock read advances 100ms so the bounded deadline fires
            // without wall-clock sleeps and the loop can never spin.
            virtualDeadlineMs += 100;
            return virtualDeadlineMs;
          },
          sleep: () => Promise.resolve(),
          timeoutMs: 5,
        },
        reapExpiredLeases: () => undefined,
        resolvePendingResultWaiters: () => undefined,
        sendFrame,
      });

      expect(response).toEqual({
        accepted: false,
        reasonCode: "daemon.profile.configuration_not_synced",
        status: "rejected",
      });
      expect(sendFrame).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          code: "daemon.route_catalog.changed",
        })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.profile_configuration_not_synced]",
        expect.objectContaining({
          reasonCode: "daemon.profile.configuration_not_synced",
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("serializes a concurrent duplicate delivery behind the in-flight convergence claim", async () => {
    // Two concurrent deliveries of the same dispatch attempt while the fence
    // waits for convergence must not both reach daemon.dispatch.deliver. The
    // first caller owns one canonical wait. The duplicate must not report an
    // accepted outcome before the owner really sends the delivery.
    const fixture = createFencedDeliveryFixture();
    const armedGates: Array<() => void> = [];
    // Each gated sleep holds its caller until explicitly released below.
    const convergenceGate = () =>
      new Promise<void>((resolve) => {
        armedGates.push(resolve);
      });
    let virtualNowMs = 0;

    const firstDelivery = deliverDispatch(fixture.state, fixture.request, {
      cleanupCompletedResults: () => undefined,
      profileConfigurationConvergence: {
        now: () => {
          const value = virtualNowMs;
          virtualNowMs += 100;
          return value;
        },
        sleep: convergenceGate,
      },
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame: fixture.sendFrame,
    });
    // Let the first caller enter the convergence wait (after its nudge frame).
    await Promise.resolve();
    await Promise.resolve();

    let duplicateSettled = false;
    const duplicateDelivery = deliverDispatch(fixture.state, fixture.request, {
      cleanupCompletedResults: () => undefined,
      profileConfigurationConvergence: {
        now: () => virtualNowMs,
        sleep: () => Promise.resolve(),
      },
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame: fixture.sendFrame,
    }).finally(() => {
      duplicateSettled = true;
    });
    await Promise.resolve();
    expect(duplicateSettled).toBe(false);
    expect(fixture.sendFrame).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "daemon.dispatch.deliver" })
    );

    // The Service applies the expected revision and the first caller delivers.
    const releaseConvergence = armedGates[0];
    if (!releaseConvergence) {
      throw new Error("convergence gate was never armed");
    }
    const report = fixture.session.localWakeRouteReport;
    if (!report?.profileConfigurationRevisions?.[0]) {
      throw new Error("test report missing");
    }
    report.profileConfigurationRevisions[0].configurationRevision = 7;
    report.reportedAtMs += 1000;
    releaseConvergence();

    expect(await firstDelivery).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(await duplicateDelivery).toEqual({
      accepted: true,
      existingAttemptId: "attempt-1",
      status: "already_pending",
    });
    const deliveredFrames = fixture.sendFrame.mock.calls.filter(
      (call) =>
        (call[1] as { code?: string }).code === "daemon.dispatch.deliver"
    );
    expect(deliveredFrames).toHaveLength(1);
    expect(
      fixture.state.pendingDispatches.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toEqual(expect.objectContaining({ attemptId: "attempt-1" }));
  });

  it("releases the in-flight convergence claim when delivery fails closed", async () => {
    let virtualDeadlineMs = 0;
    const { request, state } = createFencedDeliveryFixture();

    const response = await deliverDispatch(state, request, {
      cleanupCompletedResults: () => undefined,
      profileConfigurationConvergence: {
        pollIntervalMs: 1,
        now: () => {
          virtualDeadlineMs += 100;
          return virtualDeadlineMs;
        },
        sleep: () => Promise.resolve(),
        timeoutMs: 5,
      },
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame: vi.fn(),
    });

    expect(response).toEqual({
      accepted: false,
      reasonCode: "daemon.profile.configuration_not_synced",
      status: "rejected",
    });
    // A retry (queue redrive) must see a clean slate, not a stuck transient
    // claim or a false pending delivery.
    expect(state.inFlightDispatchDeliveries.size).toBe(0);
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
  });

  it("gives a concurrent duplicate the real rejection when convergence fails", async () => {
    const fixture = createFencedDeliveryFixture();
    let releaseWait: (() => void) | undefined;
    let virtualNowMs = 0;
    const deps = {
      cleanupCompletedResults: () => undefined,
      profileConfigurationConvergence: {
        now: () => virtualNowMs,
        pollIntervalMs: 1,
        sleep: () =>
          new Promise<void>((resolve) => {
            releaseWait = () => {
              virtualNowMs = 2;
              resolve();
            };
          }),
        timeoutMs: 1,
      },
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame: fixture.sendFrame,
    };

    const firstDelivery = deliverDispatch(fixture.state, fixture.request, deps);
    await Promise.resolve();
    await Promise.resolve();
    const duplicateDelivery = deliverDispatch(
      fixture.state,
      fixture.request,
      deps
    );
    await Promise.resolve();

    if (!releaseWait) {
      throw new Error("convergence wait was never armed");
    }
    releaseWait();

    const rejection = {
      accepted: false,
      reasonCode: "daemon.profile.configuration_not_synced",
      status: "rejected",
    } as const;
    expect(await firstDelivery).toEqual(rejection);
    expect(await duplicateDelivery).toEqual(rejection);
    expect(fixture.state.inFlightDispatchDeliveries.size).toBe(0);
    expect(
      fixture.sendFrame.mock.calls.filter(
        (call) =>
          (call[1] as { code?: string }).code === "daemon.dispatch.deliver"
      )
    ).toHaveLength(0);
  });

  it("reports live transport authority instead of configuration drift when the refresh nudge cannot be sent", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Silence the expected nudge failure diagnostic in test output.
    });
    let virtualDeadlineMs = 0;
    try {
      const { request, state } = createFencedDeliveryFixture();
      // The recorded socket exists but every frame send fails (half-open).
      const failingSendFrame = vi.fn((): void => {
        throw new Error("socket write failed");
      });

      const response = await deliverDispatch(state, request, {
        cleanupCompletedResults: () => undefined,
        profileConfigurationConvergence: {
          now: () => {
            virtualDeadlineMs += 100;
            return virtualDeadlineMs;
          },
          pollIntervalMs: 1,
          sleep: () => Promise.resolve(),
          timeoutMs: 5,
        },
        reapExpiredLeases: () => undefined,
        resolvePendingResultWaiters: () => undefined,
        sendFrame: failingSendFrame,
      });

      expect(response).toEqual({
        accepted: false,
        status: "rejected",
        reasonCode: "daemon.profile.offline",
      });
      expect(failingSendFrame).toHaveBeenCalledTimes(1);
      expect(failingSendFrame).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          code: "daemon.route_catalog.changed",
        })
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.profile_configuration_convergence_nudge_failed]",
        expect.objectContaining({
          dispatchId: "dispatch-1",
          error: "Error: socket write failed",
          profileId: "agt-1",
          reasonCode: "daemon.profile.offline",
        })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("preserves the bounded convergence budget inside the outer delivery deadline", () => {
    // The convergence window is DERIVED from the owning /deliver-dispatch
    // deadline plus an explicit RTT/scheduling margin. If someone widens the
    // margin past the whole window or shrinks the window below the healthy
    // Service chain (zero-delay heartbeat + forced catalog sync ending in a
    // register report, i.e. roughly two round trips), this test fails before
    // the outer deadline can mask daemon.profile.configuration_not_synced.
    expect(RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS).toBe(
      RUNTIME_TRANSPORT_DELIVER_TIMEOUT_MS -
        RUNTIME_TRANSPORT_DELIVER_CONVERGENCE_SAFETY_MARGIN_MS
    );
    expect(
      RUNTIME_TRANSPORT_DELIVER_CONVERGENCE_SAFETY_MARGIN_MS
    ).toBeGreaterThanOrEqual(1000);
    // Healthy Service convergence needs only a couple of round trips; the
    // window keeps multiple multiples of headroom for slower but healthy
    // Services (see clients/openmeld-cli/src/strategy-constants.ts caps).
    expect(
      RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS
    ).toBeGreaterThanOrEqual(25_000);
  });

  it("delivers a register that converges late but still inside the bounded window", async () => {
    const fixture = createFencedDeliveryFixture();
    // Virtual timeline in ms; convergence applies at t=7000 (slower than the
    // old fixed 6s budget, still inside the current bounded window).
    let virtualNowMs = 0;
    const response = await deliverDispatch(fixture.state, fixture.request, {
      cleanupCompletedResults: () => undefined,
      profileConfigurationConvergence: {
        now: () => {
          const value = virtualNowMs;
          virtualNowMs += 500;
          return value;
        },
        sleep: () => {
          if (virtualNowMs >= 7000) {
            const report = fixture.session.localWakeRouteReport;
            if (!report?.profileConfigurationRevisions?.[0]) {
              throw new Error("test report missing");
            }
            report.profileConfigurationRevisions[0].configurationRevision = 7;
            report.reportedAtMs += 7000;
          }
          return Promise.resolve();
        },
      },
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame: fixture.sendFrame,
    });

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(virtualNowMs).toBeLessThan(
      RUNTIME_TRANSPORT_PROFILE_CONFIGURATION_CONVERGENCE_TIMEOUT_MS + 500
    );
  });

  it("rejects delivery until the local route has the accepted binding configuration", async () => {
    // Genuine drift: the Service reports a NEWER revision than the frozen
    // dispatch identity (something changed twice). There is nothing to wait
    // for, so Runtime Transport must fail closed immediately without nudging.
    const { request, sendFrame, state } = createFencedDeliveryFixture({
      appliedConfigurationRevision: 8,
      expectedConfigurationRevision: 7,
    });

    const response = await deliverDispatch(state, request, {
      reapExpiredLeases: () => undefined,
      sendFrame,
      resolvePendingResultWaiters: () => undefined,
      cleanupCompletedResults: () => undefined,
    });

    expect(response).toEqual({
      accepted: false,
      reasonCode: "daemon.profile.configuration_not_synced",
      status: "rejected",
    });
    expect(sendFrame).not.toHaveBeenCalled();
  });

  it("delivers the exact accepted binding configuration to a capable local service", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();
    const session = state.sessionsById.get("session-2");
    if (!session) {
      throw new Error("test session missing");
    }
    session.capabilities.profileConfigurationRevision = true;
    session.localWakeRouteReport = {
      daemonSessionId: "session-2",
      deviceId: "device-2",
      includedProfileIds: ["agt-1"],
      lane: "dev-local",
      reportedAtMs: 1_700_000_000_000,
      profileConfigurationRevisions: [
        {
          bindingId: "binding-1",
          configurationRevision: 7,
          profileId: "agt-1",
        },
      ],
      skippedProfiles: [],
    };
    const request: RuntimeTransportDeliverDispatchRequest =
      createDispatchRequest();
    request.payload.controllerSnapshot.bindingId = "binding-1";
    request.payload.controllerSnapshot.configurationRevision = 7;

    const response = await deliverDispatch(state, request, {
      reapExpiredLeases: () => undefined,
      sendFrame,
      resolvePendingResultWaiters: () => undefined,
      cleanupCompletedResults: () => undefined,
    });

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(sendFrame).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          payload: expect.objectContaining({
            controllerSnapshot: expect.objectContaining({
              bindingId: "binding-1",
              configurationRevision: 7,
            }),
          }),
        }),
      })
    );
  });

  it("keeps old local services compatible by omitting new configuration identity", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();
    const request: RuntimeTransportDeliverDispatchRequest =
      createDispatchRequest();
    request.payload.controllerSnapshot.bindingId = "binding-1";
    request.payload.controllerSnapshot.configurationRevision = 7;

    const response = await deliverDispatch(state, request, {
      reapExpiredLeases: () => undefined,
      sendFrame,
      resolvePendingResultWaiters: () => undefined,
      cleanupCompletedResults: () => undefined,
    });

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    const deliveredRequest = sendFrame.mock.calls[0]?.[1]?.payload as
      | RuntimeTransportDeliverDispatchRequest
      | undefined;
    expect(deliveredRequest?.payload.controllerSnapshot).not.toHaveProperty(
      "bindingId"
    );
    expect(deliveredRequest?.payload.controllerSnapshot).not.toHaveProperty(
      "configurationRevision"
    );
  });

  it("short-circuits completed replay without re-delivering to the daemon", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();

    state.completedDispatchResults.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        daemonSessionId: "session-2",
        executionIdentity: createDeliveryExecutionIdentity(),
        connectionGeneration: 1,
        leaseEpoch: 2,
        receivedAtMs: 1_700_000_000_100,
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        sourceClientMessageId: "client-message-1",
        submittedConnectionGeneration: 1,
        taskId: "task-1",
        targetProfileId: "agt-1",
        taskResult: {
          v: 1,
          code: "service.task_result",
          payload: {
            status: "success",
            taskId: "task-1",
            sourceEventId: "evt-1",
            agentId: "agt-1",
            deduped: false,
            output: "already completed",
          },
        },
      }
    );

    const response = await deliverDispatch(state, createDispatchRequest(), {
      reapExpiredLeases: () => undefined,
      sendFrame,
      resolvePendingResultWaiters: () => undefined,
      cleanupCompletedResults: () => undefined,
    });

    expect(response).toEqual({
      accepted: true,
      completedAttemptId: "attempt-1",
      status: "already_completed",
    });
    expect(sendFrame).not.toHaveBeenCalled();
    expect(state.pendingDispatches.has("dispatch-1")).toBe(false);
  });

  it("keeps in-flight replay idempotent while the same lease is still pending", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch()
    );

    const response = await deliverDispatch(state, createDispatchRequest(), {
      reapExpiredLeases: () => undefined,
      sendFrame,
      resolvePendingResultWaiters: () => undefined,
      cleanupCompletedResults: () => undefined,
    });

    expect(response).toEqual({
      accepted: true,
      existingAttemptId: "attempt-1",
      status: "already_pending",
    });
    expect(sendFrame).not.toHaveBeenCalled();
    expect(
      state.pendingDispatches.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toEqual(
      expect.objectContaining({
        attemptId: "attempt-1",
        daemonSessionId: "session-2",
        dispatchId: "dispatch-1",
        leaseEpoch: 2,
        profileId: "agt-1",
      })
    );
  });

  it("does not correlate a duplicate attempt before the original has local runtime ownership evidence", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({
        attemptId: "attempt-1",
        phase: "starting",
      })
    );

    const response = await deliverDispatch(
      state,
      createDispatchRequest({ attemptId: "attempt-2" }),
      {
        reapExpiredLeases: () => undefined,
        sendFrame,
        resolvePendingResultWaiters: () => undefined,
        cleanupCompletedResults: () => undefined,
      }
    );

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(sendFrame).toHaveBeenCalledTimes(1);
    expect(
      state.pendingDispatches.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-2")
      )
    ).toEqual(
      expect.objectContaining({
        attemptId: "attempt-2",
        phase: "starting",
      })
    );
  });

  it("prepares execution token delivery only after the dispatch is accepted for local send", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();
    const prepareAcceptedDelivery = vi.fn(async (request) => ({
      ok: true as const,
      request: {
        ...request,
        payload: {
          ...request.payload,
          executionToken: createExecutionTokenEnvelope(),
        },
      },
    }));

    const response = await deliverDispatch(state, createDispatchRequest(), {
      cleanupCompletedResults: () => undefined,
      prepareAcceptedDelivery,
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame,
    });

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(prepareAcceptedDelivery).toHaveBeenCalledTimes(1);
    expect(sendFrame).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: "daemon.dispatch.deliver",
        payload: expect.objectContaining({
          payload: expect.objectContaining({
            executionToken: expect.objectContaining({
              executionToken:
                "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              runId: "run-1",
              tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            }),
          }),
        }),
      })
    );
    expect(
      state.pendingDispatches.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toEqual(
      expect.objectContaining({
        executionTokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        executionTokenRunId: "run-1",
      })
    );
  });

  it("rejects delivery before token preparation when the lease is execution-incompatible", async () => {
    const { state } = createState();
    const lease = state.profileLeasesByProfileId.get("agt-1");
    if (!lease) {
      throw new Error("Expected fixture lease for agt-1.");
    }
    state.profileLeasesByProfileId.set("agt-1", {
      ...lease,
      executionCompatibility: MISSING_EXECUTION_CONTRACT,
    });

    const sendFrame = vi.fn();
    const prepareAcceptedDelivery = vi.fn(async (request) => ({
      ok: true as const,
      request,
    }));

    const response = await deliverDispatch(state, createDispatchRequest(), {
      cleanupCompletedResults: () => undefined,
      prepareAcceptedDelivery,
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame,
    });

    expect(response).toEqual({
      accepted: false,
      reasonCode: "daemon.runtime_contract.missing",
      status: "rejected",
    });
    expect(prepareAcceptedDelivery).not.toHaveBeenCalled();
    expect(sendFrame).not.toHaveBeenCalled();
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
  });

  it("rejects delivery before token preparation when the live session is execution-incompatible", async () => {
    const { state } = createState();
    const session = state.sessionsById.get("session-2");
    if (!session) {
      throw new Error("Expected fixture session session-2.");
    }
    state.sessionsById.set("session-2", {
      ...session,
      executionCompatibility: MISMATCHED_EXECUTION_CONTRACT,
    });

    const sendFrame = vi.fn();
    const prepareAcceptedDelivery = vi.fn(async (request) => ({
      ok: true as const,
      request,
    }));

    const response = await deliverDispatch(state, createDispatchRequest(), {
      cleanupCompletedResults: () => undefined,
      prepareAcceptedDelivery,
      reapExpiredLeases: () => undefined,
      resolvePendingResultWaiters: () => undefined,
      sendFrame,
    });

    expect(response).toEqual({
      accepted: false,
      reasonCode: "daemon.runtime_contract.mismatch",
      status: "rejected",
    });
    expect(prepareAcceptedDelivery).not.toHaveBeenCalled();
    expect(sendFrame).not.toHaveBeenCalled();
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toBe(false);
  });

  it("correlates a duplicate attempt after the original has local runtime ownership evidence", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({
        attemptId: "attempt-1",
        phase: "running",
        runningAtMs: 20,
      })
    );

    const response = await deliverDispatch(
      state,
      createDispatchRequest({ attemptId: "attempt-2" }),
      {
        reapExpiredLeases: () => undefined,
        sendFrame,
        resolvePendingResultWaiters: () => undefined,
        cleanupCompletedResults: () => undefined,
      }
    );

    expect(response).toEqual({
      accepted: true,
      existingAttemptId: "attempt-1",
      status: "already_pending",
    });
    expect(sendFrame).not.toHaveBeenCalled();
    expect(
      state.pendingDispatches.has(
        buildDispatchAttemptKey("dispatch-1", "attempt-2")
      )
    ).toBe(false);
  });

  it("does not let stale lease replay bypass the completed-result fence", async () => {
    const { state } = createState();
    const sendFrame = vi.fn();

    state.completedDispatchResults.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        daemonSessionId: "session-2",
        executionIdentity: createDeliveryExecutionIdentity(),
        connectionGeneration: 1,
        leaseEpoch: 2,
        receivedAtMs: 1_700_000_000_100,
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        sourceClientMessageId: "client-message-1",
        submittedConnectionGeneration: 1,
        taskId: "task-1",
        targetProfileId: "agt-1",
        taskResult: {
          v: 1,
          code: "service.task_result",
          payload: {
            status: "success",
            taskId: "task-1",
            sourceEventId: "evt-1",
            agentId: "agt-1",
            deduped: false,
            output: "already completed",
          },
        },
      }
    );

    const response = await deliverDispatch(
      state,
      createDispatchRequest({
        attemptId: "attempt-1",
        daemonSessionId: "session-1",
        leaseEpoch: 1,
      }),
      {
        reapExpiredLeases: () => undefined,
        sendFrame,
        resolvePendingResultWaiters: () => undefined,
        cleanupCompletedResults: () => undefined,
      }
    );

    expect(response).toEqual({
      accepted: false,
      reasonCode: "daemon.session.stale_lease",
      status: "rejected",
    });
    expect(sendFrame).not.toHaveBeenCalled();
    expect(state.pendingDispatches.has("dispatch-1")).toBe(false);
  });

  it("clamps lifecycle timestamps to the server receipt time", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-24T00:00:05.000Z"));
      const { state } = createState();
      state.pendingDispatches.set(
        buildDispatchAttemptKey("dispatch-1", "attempt-1"),
        buildPendingDispatch({
          createdAtMs: Date.parse("2026-03-24T00:00:00.000Z"),
          lastLifecycleAtMs: Date.parse("2026-03-24T00:00:01.000Z"),
          phase: "starting",
        })
      );

      const response = handleDispatchLifecycle(state, {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 2,
        lifecycleAtMs: Date.parse("2026-03-24T00:00:30.000Z"),
        phase: "running",
      });

      expect(response).toEqual({ ok: true });
      expect(
        state.pendingDispatches.get(
          buildDispatchAttemptKey("dispatch-1", "attempt-1")
        )
      ).toEqual(
        expect.objectContaining({
          acceptedLocalAtMs: Date.parse("2026-03-24T00:00:05.000Z"),
          lastLifecycleAtMs: Date.parse("2026-03-24T00:00:05.000Z"),
          phase: "running",
          runningAtMs: Date.parse("2026-03-24T00:00:05.000Z"),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps completed lifecycle snapshots monotonic when finishing a result", async () => {
    const { state } = createState();
    const resolvePendingResultWaiters = vi.fn();
    const cleanupCompletedResults = vi.fn();

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({
        acceptedLocalAtMs: 10,
        completedLocalAtMs: 100,
        lastLifecycleAtMs: 90,
        phase: "completed_local",
        runningAtMs: 50,
      })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "done",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult: async () => ({ ok: true, status: "accepted" }),
        cleanupCompletedResults,
        resolvePendingResultWaiters,
      }
    );

    expect(response).toEqual({ ok: true, status: "accepted" });
    expect(resolvePendingResultWaiters).toHaveBeenCalledWith(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      expect.objectContaining({
        lifecycle: expect.objectContaining({
          completedLocalAtMs: 100,
          lastLifecycleAtMs: 100,
        }),
        state: "completed",
      })
    );
  });

  it("keeps the Wake pending when atomic Space settlement requires Agent review", async () => {
    const { state } = createState();
    const session = state.sessionsById.get("session-2");
    if (!session) {
      throw new Error("test session missing");
    }
    session.capabilities.agentReplyContextReview = true;
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));
    const settleDurableDispatchResult = vi.fn(async () => ({
      ok: false as const,
      reasonCode: "space.agent_reply.context_changed" as const,
      status: "review_required" as const,
    }));

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({ phase: "running", runningAtMs: 20 })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "1",
            sourceEventId: "evt-1",
            spaceAction: {
              type: "post_message",
              observedThroughSignalId: "signal-1",
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "1",
              },
            },
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
        settleDurableDispatchResult,
      } as never
    );

    expect(response).toEqual({
      ok: false,
      reasonCode: "space.agent_reply.context_changed",
      status: "review_required",
    });
    expect(settleDurableDispatchResult).toHaveBeenCalledOnce();
    expect(acceptDispatchResult).not.toHaveBeenCalled();
    expect(
      state.pendingDispatches.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )?.phase
    ).toBe("running");
  });

  it("does not send review-required responses to Services that did not advertise support", async () => {
    const { state } = createState();
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));
    const settleDurableDispatchResult = vi.fn(async () => ({
      ok: false as const,
      reasonCode: "space.agent_reply.context_changed" as const,
      status: "review_required" as const,
    }));

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({ phase: "running", runningAtMs: 20 })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "1",
            sourceEventId: "evt-1",
            spaceAction: {
              type: "post_message",
              observedThroughSignalId: "signal-1",
              messageEnvelope: {
                activationTargets: [],
                referenceTargets: [],
                text: "1",
              },
            },
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
        settleDurableDispatchResult,
      } as never
    );

    expect(response).toEqual({ ok: true, status: "accepted" });
    expect(settleDurableDispatchResult).not.toHaveBeenCalled();
    expect(acceptDispatchResult).toHaveBeenCalledOnce();
  });

  it("accepts a result submitted on a newer connection when business identity and lease match", async () => {
    const { state } = createState();
    const resolvePendingResultWaiters = vi.fn();
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({
        acceptedLocalAtMs: 10,
        lastLifecycleAtMs: 20,
        phase: "running",
        runningAtMs: 20,
      })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 2,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "done after reconnect",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters,
      }
    );

    expect(response).toEqual({ ok: true, status: "accepted" });
    expect(acceptDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        leaseEpoch: 2,
        submittedConnectionGeneration: 2,
        targetProfileId: "agt-1",
        taskId: "task-1",
      })
    );
    expect(
      state.completedDispatchResults.get(
        buildDispatchAttemptKey("dispatch-1", "attempt-1")
      )
    ).toEqual(
      expect.objectContaining({
        connectionGeneration: 1,
        submittedConnectionGeneration: 2,
      })
    );
    expect(state.pendingDispatches.has("dispatch-1::attempt-1")).toBe(false);
  });

  it("logs result identity echo mismatch without replacing pending authority", async () => {
    const { state } = createState();
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Silence expected mismatch diagnostics in the test output.
    });

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({ phase: "running", runningAtMs: 20 })
    );

    try {
      const response = await handleSubmitTaskResult(
        state,
        {
          v: 1,
          dispatchId: "dispatch-1",
          attemptId: "attempt-1",
          executionIdentityEcho: createResultIdentityEcho(
            createDeliveryExecutionIdentity({
              openMeldServiceRuntimeId: "runtime-2",
            })
          ),
          daemonSessionId: "session-2",
          connectionGeneration: 2,
          leaseEpoch: 2,
          taskResult: {
            v: 4,
            code: "service.task_result",
            payload: {
              agentId: "agt-1",
              attemptId: "attempt-1",
              deduped: false,
              output: "done with mismatched echo",
              sourceEventId: "evt-1",
              status: "success",
              taskId: "task-1",
            },
          },
        },
        {
          acceptDispatchResult,
          cleanupCompletedResults: () => undefined,
          resolvePendingResultWaiters: () => undefined,
        }
      );

      expect(response).toEqual({ ok: true, status: "accepted" });
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport.result_identity_echo_mismatch]",
        expect.objectContaining({
          authoritativeRuntimeId: "runtime-1",
          echoedRuntimeId: "runtime-2",
          mismatchField: "openMeldServiceRuntimeId",
        })
      );
      expect(
        state.completedDispatchResults.get(
          buildDispatchAttemptKey("dispatch-1", "attempt-1")
        )?.executionIdentity.core.openMeldServiceRuntimeId.value
      ).toBe("runtime-1");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rejects a result with a different task identity", async () => {
    const { state } = createState();
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({ phase: "running", runningAtMs: 20 })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 2,
        taskResult: {
          v: 1,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            deduped: false,
            output: "wrong task",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-2",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
      }
    );

    expect(response).toEqual({
      ok: false,
      reasonCode: "daemon.result.identity_mismatch",
      status: "rejected_terminal",
    });
    expect(acceptDispatchResult).not.toHaveBeenCalled();
  });

  it("rejects a result with a different lease", async () => {
    const { state } = createState();
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({ phase: "running", runningAtMs: 20 })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 3,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "wrong lease",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
      }
    );

    expect(response).toEqual({
      ok: false,
      reasonCode: "daemon.session.stale_lease",
      status: "rejected_terminal",
    });
    expect(acceptDispatchResult).not.toHaveBeenCalled();
  });

  it("rejects a result with a different target profile identity", async () => {
    const { state } = createState();
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));

    state.pendingDispatches.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      buildPendingDispatch({ phase: "running", runningAtMs: 20 })
    );

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 1,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-2",
            attemptId: "attempt-1",
            deduped: false,
            output: "wrong agent",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
      }
    );

    expect(response).toEqual({
      ok: false,
      reasonCode: "daemon.result.identity_mismatch",
      status: "rejected_terminal",
    });
    expect(acceptDispatchResult).not.toHaveBeenCalled();
  });

  it("accepts duplicate completed result only when the payload matches", async () => {
    const { state } = createState();
    const taskResult = {
      v: 4 as const,
      code: "service.task_result" as const,
      payload: {
        agentId: "agt-1",
        attemptId: "attempt-1",
        deduped: false,
        output: "already accepted",
        sourceEventId: "evt-1",
        status: "success" as const,
        taskId: "task-1",
      },
    };

    state.completedDispatchResults.set(
      buildDispatchAttemptKey("dispatch-1", "attempt-1"),
      {
        attemptId: "attempt-1",
        connectionGeneration: 1,
        daemonSessionId: "session-2",
        dispatchId: "dispatch-1",
        executionIdentity: createDeliveryExecutionIdentity(),
        leaseEpoch: 2,
        receivedAtMs: 1_700_000_000_100,
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        sourceClientMessageId: "client-message-1",
        submittedConnectionGeneration: 1,
        targetProfileId: "agt-1",
        taskId: "task-1",
        taskResult,
      }
    );

    const samePayloadResponse = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 2,
        leaseEpoch: 2,
        taskResult,
      },
      {
        acceptDispatchResult: async () => ({
          ok: true,
          status: "already_accepted",
        }),
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
      }
    );
    expect(samePayloadResponse).toEqual({ ok: true, status: "accepted" });

    const conflictingPayloadResponse = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 2,
        leaseEpoch: 2,
        taskResult: {
          ...taskResult,
          payload: {
            ...taskResult.payload,
            output: "conflicting output",
          },
        },
      },
      {
        acceptDispatchResult: async () => ({
          ok: true,
          status: "already_accepted",
        }),
        cleanupCompletedResults: () => undefined,
        resolvePendingResultWaiters: () => undefined,
      }
    );
    expect(conflictingPayloadResponse).toEqual({
      ok: false,
      reasonCode: "daemon.result.conflict",
      status: "rejected_terminal",
    });
  });

  it("accepts a durable result after pending dispatch memory is gone", async () => {
    const { state } = createState();
    const resolveDurableDispatchResultAcceptance = vi.fn(async () => ({
      ok: true as const,
      result: {
        acceptedAtMs: 1_700_000_000_100,
        attemptId: "attempt-1",
        daemonSessionId: "session-2",
        dispatchId: "dispatch-1",
        executionTokenFingerprint: null,
        executionTokenRunId: null,
        finalizationRequired: true,
        leaseEpoch: 2,
        runtimeCoordinatorExecutionId: null,
        spaceId: "space-1",
        submittedConnectionGeneration: 3,
        targetProfileId: "agt-1",
        taskId: "task-1",
        taskResult: {
          v: 4 as const,
          code: "service.task_result" as const,
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "done after object restart",
            sourceEventId: "evt-1",
            status: "success" as const,
            taskId: "task-1",
          },
        },
      },
    }));
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));
    const finalizeDurableDispatchResult = vi.fn(async () => ({
      ok: true as const,
    }));

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 3,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "done after object restart",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        finalizeDurableDispatchResult,
        resolveDurableDispatchResultAcceptance,
        resolvePendingResultWaiters: () => undefined,
      }
    );

    expect(response).toEqual({ ok: true, status: "accepted" });
    expect(resolveDurableDispatchResultAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        connectionGeneration: 3,
        daemonSessionId: "session-2",
        dispatchId: "dispatch-1",
        leaseEpoch: 2,
      })
    );
    expect(acceptDispatchResult).toHaveBeenCalledTimes(1);
    expect(finalizeDurableDispatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        finalizationRequired: true,
        spaceId: "space-1",
      })
    );
  });

  it("keeps a durable result retryable when accepted result finalization is unavailable", async () => {
    const { state } = createState();
    const taskResult = {
      v: 4 as const,
      code: "service.task_result" as const,
      payload: {
        agentId: "agt-1",
        attemptId: "attempt-1",
        deduped: false,
        output: "done after object restart",
        sourceEventId: "evt-1",
        status: "success" as const,
        taskId: "task-1",
      },
    };
    const resolveDurableDispatchResultAcceptance = vi.fn(async () => ({
      ok: true as const,
      result: {
        acceptedAtMs: 1_700_000_000_100,
        attemptId: "attempt-1",
        daemonSessionId: "session-2",
        dispatchId: "dispatch-1",
        executionTokenFingerprint: null,
        executionTokenRunId: null,
        finalizationRequired: true,
        leaseEpoch: 2,
        runtimeCoordinatorExecutionId: null,
        spaceId: "space-1",
        submittedConnectionGeneration: 3,
        targetProfileId: "agt-1",
        taskId: "task-1",
        taskResult,
      },
    }));
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));
    const finalizeDurableDispatchResult = vi.fn(async () => ({
      ok: false as const,
      reasonCode: "daemon.result.finalization_unavailable" as const,
      status: "retry_later" as const,
    }));

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 3,
        leaseEpoch: 2,
        taskResult,
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        finalizeDurableDispatchResult,
        resolveDurableDispatchResultAcceptance,
        resolvePendingResultWaiters: () => undefined,
      }
    );

    expect(response).toEqual({
      ok: false,
      reasonCode: "daemon.result.finalization_unavailable",
      status: "retry_later",
    });
    expect(acceptDispatchResult).toHaveBeenCalledTimes(1);
    expect(finalizeDurableDispatchResult).toHaveBeenCalledTimes(1);
  });

  it("keeps a durable result retryable when the result inbox is unavailable", async () => {
    const { state } = createState();
    const resolveDurableDispatchResultAcceptance = vi.fn(async () => ({
      ok: false as const,
      reasonCode: "daemon.result.inbox_unavailable" as const,
      status: "retry_later" as const,
    }));
    const acceptDispatchResult = vi.fn(async () => ({
      ok: true as const,
      status: "accepted" as const,
    }));

    const response = await handleSubmitTaskResult(
      state,
      {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createResultIdentityEcho(),
        daemonSessionId: "session-2",
        connectionGeneration: 3,
        leaseEpoch: 2,
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "done after object restart",
            sourceEventId: "evt-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      {
        acceptDispatchResult,
        cleanupCompletedResults: () => undefined,
        resolveDurableDispatchResultAcceptance,
        resolvePendingResultWaiters: () => undefined,
      }
    );

    expect(response).toEqual({
      ok: false,
      reasonCode: "daemon.result.inbox_unavailable",
      status: "retry_later",
    });
    expect(acceptDispatchResult).not.toHaveBeenCalled();
  });
});
