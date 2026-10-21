import type { PermissionModeAdvisory } from "@openmeld/schemas";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
} from "@openmeld/schemas";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectionPostgresBinding } from "../../test-support/postgresql-query.test-support";
import {
  acceptRuntimeTransportRuntimeCoordinatorHead,
  buildRuntimeTransportDeliverDispatchRequest,
  deliverRuntimeTransportDispatch,
  readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace,
  readRuntimeTransportRuntimeCoordinatorInteraction,
  recordRuntimeTransportRuntimeCoordinatorHeadNoExecution,
  recordRuntimeTransportRuntimeCoordinatorHeadWaiting,
  waitRuntimeTransportDispatchResult,
} from "../dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
import {
  acquireRuntimeTransportAgentProfileExecutionTargetMutation,
  acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation,
  controlRuntimeTransportOpenMeldTools,
  discoverRuntimeTransportProjects,
  forkRuntimeTransportAgentSession,
  isRuntimeTransportProfileWorkspaceOutcomeDefinitive,
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoute,
  lookupRuntimeTransportRoutesBatch,
  readRuntimeTransportComputerFileAccessPolicy,
  readRuntimeTransportDisconnectRates,
  refreshRuntimeTransportLocalAgentCatalog,
  releaseRuntimeTransportAgentProfileExecutionTargetMutation,
  selectRuntimeTransportLocalFolders,
} from "../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../lib/bindings";
import { CORE_LOG_EVENTS } from "../shared/observability/log-events";
import { createSpaceBootstrapTimingCollector } from "../space/application/space-bootstrap-timing";

type RuntimeTransportStub = {
  fetch: ReturnType<typeof vi.fn>;
};

const createDeliverDispatchPayload = () => ({
  attemptId: "attempt-1",
  dispatchId: "dispatch-1",
  taskId: "task-1",
  spaceId: "space-1",
  sourceEventId: "evt-1",
  sourceSignal: {
    text: "hello",
    profileId: "hum-1",
    profileKind: "human" as const,
  },
  targetProfileId: "agent-1",
  dispatchContractVersion: 2,
  dispatchPolicy: "mention_only" as const,
  controllerSnapshot: {
    targetBindingState: "bound" as const,
    targetBindingEnabled: true,
    agentControllerRef: "builtin:codex",
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
});

const createDeliveryExecutionIdentity = () => ({
  authority: "core_runtime_registry_binding_route" as const,
  core: {
    modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
    spaceId: "space-1",
    dispatchId: "dispatch-1",
    targetProfileId: "agent-1",
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority" as const,
      value: "runtime-1",
    },
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
  },
});

const createDispatchQueueMessage = (): OpenMeldDaemonDispatchQueueMessage => ({
  v: 2,
  ...createDeliverDispatchPayload(),
  dispatchChainId: "dispatch-chain-1",
  autoRelayDepth: 0,
  visitedProfileIds: [],
  visitedProfileIdsHash: "hash-1",
  ruleSource: "registry",
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  transportMode: null,
  sourceSignalSnapshot: {
    text: "hello",
    profileId: "hum-1",
    profileKind: "human",
  },
  sourceMessageEnvelope: {
    activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
    referenceTargets: [],
    text: "@Codex Agent(wake) hello",
  },
  dispatchSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    targetBindingState: "bound",
    targetBindingEnabled: true,
  },
});

const COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY = {
  expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  reasonCode: "daemon.runtime_contract.compatible",
  status: "compatible",
} as const;

const createEnv = (input?: {
  forgottenDeviceId?: string | null;
  forgottenReadError?: Error;
  omitDb?: boolean;
  omitTransport?: boolean;
}) => {
  const stub: RuntimeTransportStub = { fetch: vi.fn() };
  const namespace = {
    idFromName: vi.fn().mockReturnValue("owner-shard"),
    get: vi.fn().mockReturnValue(stub),
  };
  const binding = createProjectionPostgresBinding(() => {
    if (input?.forgottenReadError) {
      throw input.forgottenReadError;
    }
    return input?.forgottenDeviceId
      ? [
          {
            owner_user_id: "owner",
            device_id: input.forgottenDeviceId,
            forgotten_at_ms: 1,
            updated_at_ms: 1,
          },
        ]
      : [];
  });

  return {
    env: {
      ...(input?.omitTransport
        ? {}
        : { OPENMELD_RUNTIME_TRANSPORT: namespace }),
      ...(input?.omitDb ? {} : { OPENMELD_POSTGRESQL: binding }),
    } as unknown as CoreBindings,
    stub,
  };
};

describe("runtime transport split clients call fallback behavior", () => {
  it("keeps Controller mutation wire payloads strict while future settings use their own RPC", async () => {
    const acquire = vi.fn(async (request: { operationId: string }) => ({
      expiresAtMs: 1_700_000_300_000,
      operationId: request.operationId,
      status: "acquired" as const,
    }));
    const release = vi.fn(async () => ({ status: "released" as const }));
    const env = {
      OPENMELD_RUNTIME_TRANSPORT: {
        get: vi.fn(() => ({
          rpcAcquireAgentProfileControllerMutation: acquire,
          rpcAcquireAgentProfileFutureWorkSettingsMutation: acquire,
          rpcReleaseAgentProfileControllerMutation: release,
        })),
        idFromName: vi.fn(() => "owner-shard"),
      },
    } as unknown as CoreBindings;
    const request = {
      env,
      operationId: "mutation-1",
      ownerUserId: "owner-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    };

    await expect(
      acquireRuntimeTransportAgentProfileExecutionTargetMutation(request)
    ).resolves.toMatchObject({
      operationId: "mutation-1",
      status: "acquired",
    });
    await expect(
      acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation(request)
    ).resolves.toMatchObject({
      operationId: "mutation-1",
      status: "acquired",
    });
    await expect(
      releaseRuntimeTransportAgentProfileExecutionTargetMutation(request)
    ).resolves.toEqual({ status: "released" });
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenNthCalledWith(1, {
      operationId: "mutation-1",
      ownerUserId: "owner-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    expect(acquire).toHaveBeenNthCalledWith(2, {
      operationId: "mutation-1",
      ownerUserId: "owner-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed before saving future settings when an older shard lacks the dedicated RPC", async () => {
    const acquireControllerMutation = vi.fn();
    const env = {
      OPENMELD_RUNTIME_TRANSPORT: {
        get: vi.fn(() => ({
          rpcAcquireAgentProfileControllerMutation: acquireControllerMutation,
        })),
        idFromName: vi.fn(() => "owner-shard"),
      },
    } as unknown as CoreBindings;

    await expect(
      acquireRuntimeTransportAgentProfileFutureWorkSettingsMutation({
        env,
        operationId: "future-settings-on-old-shard",
        ownerUserId: "owner-1",
        targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).resolves.toEqual({
      reasonCode: "runtime_coordinator.execution_state_unavailable",
      status: "unavailable",
    });
    expect(acquireControllerMutation).not.toHaveBeenCalled();
  });

  it("keeps a pending interaction visible when the Hub is still on an earlier build", async () => {
    const { env, stub } = createEnv();
    const pendingInteraction = {
      canRespond: true,
      expiresAtMs: 1_700_028_800_100,
      interactionId: "interaction-1",
      kind: "permission" as const,
      request: null,
      requestedAtMs: 1_700_000_000_100,
    };
    stub.fetch.mockImplementation((url: string) =>
      Promise.resolve(
        new URL(url).pathname ===
          "/runtime-coordinator/interaction/read-revision"
          ? Response.json(
              {
                code: "not_found",
                message: "runtime transport path not found",
                ok: false,
              },
              { status: 404 }
            )
          : Response.json({ pendingInteraction })
      )
    );

    await expect(
      readRuntimeTransportRuntimeCoordinatorInteraction({
        env,
        ownerUserId: "owner-1",
        request: {
          actorOwnerUserId: "owner-1",
          runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        },
      })
    ).resolves.toEqual({ interactionUpdatedAtMs: null, pendingInteraction });
    expect(
      stub.fetch.mock.calls.map(([url]) => new URL(url as string).pathname)
    ).toEqual([
      "/runtime-coordinator/interaction/read-revision",
      "/runtime-coordinator/interaction/read",
    ]);
  });

  it("uses the interaction revision when the Hub serves it", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      Response.json({ interactionUpdatedAtMs: 42, pendingInteraction: null })
    );

    await expect(
      readRuntimeTransportRuntimeCoordinatorInteraction({
        env,
        ownerUserId: "owner-1",
        request: {
          actorOwnerUserId: "owner-1",
          runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        },
      })
    ).resolves.toEqual({
      interactionUpdatedAtMs: 42,
      pendingInteraction: null,
    });
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps workspace mutation admission when the local outcome is unknown", () => {
    expect(
      isRuntimeTransportProfileWorkspaceOutcomeDefinitive({
        message: "Timed out waiting for the local OpenMeld Service response.",
        reasonCode: "local_agent_control.timeout",
        status: "rejected",
      })
    ).toBe(false);
    expect(
      isRuntimeTransportProfileWorkspaceOutcomeDefinitive({
        message: "Runtime Transport returned an invalid response.",
        reasonCode: "local_agent_control.invalid_response",
        status: "rejected",
      })
    ).toBe(false);
    expect(
      isRuntimeTransportProfileWorkspaceOutcomeDefinitive({
        message: "The current local OpenMeld Service is not connected.",
        reasonCode: "local_agent_control.service_offline",
        status: "rejected",
      })
    ).toBe(true);
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps structured route data on successful lookup response", async () => {
    const { env, stub } = createEnv();
    const lookupResponse = {
      online: true as const,
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      deviceId: "device-1",
      lane: "dev-local",
      leaseEpoch: 1,
      lastHeartbeatMs: 1_700_000_000_000,
      capabilities: {},
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    };

    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(lookupResponse), { status: 200 })
    );

    const response = await lookupRuntimeTransportRoute({
      env,
      ownerUserId: "owner",
      profileId: "agent-1",
    });

    expect(response).toEqual(lookupResponse);
  });

  it("keeps fresh-lease offline route data on successful lookup response", async () => {
    const { env, stub } = createEnv();
    const lookupResponse = {
      online: false as const,
      reasonCode: "daemon.profile.offline" as const,
      lastHeartbeatMs: 1_700_000_000_000,
    };

    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(lookupResponse), { status: 200 })
    );

    const response = await lookupRuntimeTransportRoute({
      env,
      ownerUserId: "owner",
      profileId: "agent-1",
    });

    expect(response).toEqual(lookupResponse);
  });

  it("keeps fresh-lease offline route data in batch lookup responses", async () => {
    const { env, stub } = createEnv();
    const offlineRoute = {
      online: false as const,
      reasonCode: "daemon.profile.offline" as const,
      lastHeartbeatMs: 1_700_000_000_000,
    };
    const lookupResponse = {
      routes: {
        "agent-1": offlineRoute,
      },
    };

    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(lookupResponse), { status: 200 })
    );

    const response = await lookupRuntimeTransportRoutesBatch({
      env,
      ownerUserId: "owner",
      profileIds: ["agent-1"],
    });

    expect(response).toEqual(lookupResponse);
  });

  it("reads runtime transport disconnect rate diagnostics from the owner shard", async () => {
    const { env, stub } = createEnv();
    const diagnosticsResponse = {
      ok: true,
      ownerUserId: "owner",
      windowMs: 86_400_000,
      buckets: [
        {
          count: 2,
          deployAdjacentReason: "websocket_1006_abnormal_close",
          disconnectClass: "possible_deploy_or_edge_restart",
          firstObservedAtMs: 1_700_000_000_000,
          hourStartMs: 1_699_999_200_000,
          lastObservedAtMs: 1_700_000_010_000,
        },
      ],
      recentSessions: [
        {
          closeCode: 1006,
          closeReasonCode: "abnormal_closure",
          connectedAtMs: 1_700_000_000_000,
          connectionGeneration: 3,
          daemonSessionId: "session-1",
          deployAdjacentReason: "websocket_1006_abnormal_close",
          deviceId: "device-1",
          disconnectedAtMs: 1_700_000_120_000,
          disconnectClass: "possible_deploy_or_edge_restart",
          durationMs: 120_000,
          heartbeatAgeMs: 5000,
          lane: "prod",
          lastHeartbeatMs: 1_700_000_115_000,
          profileCount: 1,
          profileIds: ["agent-1"],
          serviceVersion: "0.7.94",
          wasClean: false,
        },
      ],
    };
    stub.fetch.mockResolvedValue(Response.json(diagnosticsResponse));

    const response = await readRuntimeTransportDisconnectRates({
      env,
      ownerUserId: "owner",
    });

    expect(response).toEqual(diagnosticsResponse);
    const firstCall = stub.fetch.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected runtime transport fetch call");
    }
    expect(firstCall[0]).toBe(
      "https://runtime-transport.internal/diagnostics/disconnect-rates"
    );
  });

  it("treats a forgotten device route as offline when the caller is checking readiness", async () => {
    const { env, stub } = createEnv({ forgottenDeviceId: "device-1" });
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          online: true,
          daemonSessionId: "session-1",
          connectionGeneration: 1,
          deviceId: "device-1",
          lane: "dev-local",
          leaseEpoch: 1,
          lastHeartbeatMs: 1_700_000_000_000,
          capabilities: {},
          executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
        }),
        { status: 200 }
      )
    );

    await expect(
      lookupRuntimeTransportRoute({
        blockForgottenDevices: true,
        env,
        ownerUserId: "owner",
        profileId: "agent-1",
      })
    ).resolves.toEqual({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
  });

  it("threads sourceMessageEnvelope into daemon deliver payloads", () => {
    const request = buildRuntimeTransportDeliverDispatchRequest({
      attemptId: "attempt-1",
      executionIdentity: createDeliveryExecutionIdentity(),
      ownerUserId: "owner",
      route: {
        online: true,
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: {},
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      },
      message: createDispatchQueueMessage(),
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human",
      },
      targetProfileName: "Codex Agent",
    });

    expect(request.payload.sourceMessageEnvelope).toEqual({
      activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
      referenceTargets: [],
      text: "@Codex Agent(wake) hello",
    });
    expect(request.payload.sourceClientMessageId).toBeNull();
    expect("targetProfileHandle" in request.payload).toBe(false);
  });

  it("threads the server-derived Center Agent designation fact into daemon deliver payloads", () => {
    const request = buildRuntimeTransportDeliverDispatchRequest({
      attemptId: "attempt-1",
      executionIdentity: createDeliveryExecutionIdentity(),
      ownerUserId: "owner",
      route: {
        online: true,
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: {},
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      },
      message: createDispatchQueueMessage(),
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human",
      },
      targetProfileIsCenterAgent: true,
      targetProfileName: "Codex Agent",
    });

    expect(request.payload.targetProfileIsCenterAgent).toBe(true);
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ])("carries the permission-mode advisory only for an owner-requested Wake (%s)", (requesterIsAgentOwner, carried) => {
    const permissionModeAdvisory = {
      currentPermissionMode: "claude-code:default",
      currentPermissionModeLabel: "Ask permissions",
      suggestedPermissionMode: "claude-code:acceptEdits",
      suggestedPermissionModeLabel: "Accept edits",
      topRequesterNames: ["Tali Chen"],
      waitingApprovalCount: 3,
      windowDays: 7,
    } satisfies PermissionModeAdvisory;
    const request = buildRuntimeTransportDeliverDispatchRequest({
      attemptId: "attempt-1",
      executionIdentity: createDeliveryExecutionIdentity(),
      ownerUserId: "owner",
      permissionModeAdvisory,
      requesterIsAgentOwner,
      route: {
        online: true,
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: { permissionModeAdvisoryPrompt: true },
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      },
      message: createDispatchQueueMessage(),
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human",
      },
      targetProfileName: "Codex Agent",
    });
    expect(request.payload.permissionModeAdvisory).toEqual(
      carried ? permissionModeAdvisory : undefined
    );
  });

  it("threads Organization information protection only when resolved for a capable service", () => {
    const request = buildRuntimeTransportDeliverDispatchRequest({
      attemptId: "attempt-1",
      executionIdentity: createDeliveryExecutionIdentity(),
      ownerUserId: "owner",
      route: {
        online: true,
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: { informationProtectionPrompt: true },
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      },
      message: createDispatchQueueMessage(),
      organizationProtectedInformation: "Private customer pricing.",
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human",
      },
      targetProfileName: "Codex Agent",
    });

    expect(request.payload.organizationProtectedInformation).toBe(
      "Private customer pricing."
    );
  });

  it("preserves sourceClientMessageId in daemon deliver payloads", () => {
    const request = buildRuntimeTransportDeliverDispatchRequest({
      attemptId: "attempt-1",
      executionIdentity: createDeliveryExecutionIdentity(),
      ownerUserId: "owner",
      route: {
        online: true,
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: {},
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      },
      message: {
        ...createDispatchQueueMessage(),
        sourceClientMessageId: "client-message-1",
      },
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human",
      },
      targetProfileName: "Codex Agent",
    });

    expect(request.payload.sourceClientMessageId).toBe("client-message-1");
  });

  it("returns fallback route offline code when lookup response is non-JSON 404", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(new Response("offline", { status: 404 }));

    const response = await lookupRuntimeTransportRoute({
      env,
      ownerUserId: "owner",
      profileId: "agent-1",
    });

    expect(response).toEqual({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
  });

  it("does not treat a missing owner-service endpoint as a disconnected computer", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(new Response("offline", { status: 404 }));

    await expect(
      lookupRuntimeTransportOwnerService({
        env,
        ownerUserId: "owner",
      })
    ).rejects.toThrow("Invalid Runtime Transport owner-Service response.");
    expect(stub.fetch).toHaveBeenCalledWith(
      "https://runtime-transport.internal/lookup-owner-service",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("requests current local agent catalog refresh through RuntimeTransport", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "accepted",
          payload: {
            accepted: true,
            profileIds: ["agt_00000000-0000-4000-8000-000000000001"],
            syncStatus: "unchanged",
          },
        }),
        { status: 200 }
      )
    );

    const response = await refreshRuntimeTransportLocalAgentCatalog({
      deviceId: "device-1",
      env,
      ownerUserId: "owner",
      reason: "settings_manual_check",
      runtimeLane: "dev-local",
    });

    expect(response).toEqual({
      status: "accepted",
      payload: {
        accepted: true,
        profileIds: ["agt_00000000-0000-4000-8000-000000000001"],
        syncStatus: "unchanged",
      },
    });
    expect(stub.fetch).toHaveBeenCalledWith(
      "https://runtime-transport.internal/local-agent-control/refresh-catalog",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("sends an owner-scoped OpenMeld Tools update through RuntimeTransport", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            operation: "request_update",
            result: { currentVersion: "0.3.104", status: "current" },
          },
          status: "accepted",
        }),
        { status: 200 }
      )
    );

    await expect(
      controlRuntimeTransportOpenMeldTools({
        deviceId: "device-1",
        env,
        ownerUserId: "owner-1",
        request: { operation: "request_update", requestSource: "web" },
        runtimeLane: "dev-local",
      })
    ).resolves.toMatchObject({
      result: { operation: "request_update" },
      status: "accepted",
    });
    expect(stub.fetch).toHaveBeenCalledWith(
      "https://runtime-transport.internal/openmeld-tools-control",
      expect.objectContaining({ method: "POST" })
    );
    const requestInit = stub.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      deviceId: "device-1",
      lane: "dev-local",
      ownerUserId: "owner-1",
      request: { operation: "request_update", requestSource: "web" },
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  });

  it("forks the exact native Session through its owner's selected Computer", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          agentControllerRef: "builtin:codex",
          childNativeSessionId: "child-session-1",
          operationId: "request-1",
          organizationId: "organization-1",
          profileName: "Research Agent",
          projectId: "project-1",
          sourceNativeSessionId: "source-session-1",
          status: "completed",
        }),
        { status: 200 }
      )
    );

    const result = await forkRuntimeTransportAgentSession({
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      env,
      operationId: "request-1",
      organizationId: "organization-1",
      ownerUserId: "owner-1",
      profileName: "Research Agent",
      projectId: "project-1",
      runtimeLane: "dev-local",
      sourceNativeSessionId: "source-session-1",
    });

    expect(result).toMatchObject({
      childNativeSessionId: "child-session-1",
      status: "completed",
    });
    expect(stub.fetch).toHaveBeenCalledWith(
      "https://runtime-transport.internal/local-agent-control/fork-session",
      expect.objectContaining({ method: "POST" })
    );
    const requestInit = stub.fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      agentControllerRef: "builtin:codex",
      deviceId: "device-1",
      lane: "dev-local",
      operationId: "request-1",
      organizationId: "organization-1",
      ownerUserId: "owner-1",
      profileName: "Research Agent",
      projectId: "project-1",
      sourceNativeSessionId: "source-session-1",
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
    });
  });

  it("sends canonical Project facts through the dedicated current-device operation", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          checkedAtMs: 123,
          clientGeneration: 4,
          deviceId: "device-1",
          gitStatus: "available",
          projects: [],
          requestId: "request-transport",
        }),
        { status: 200 }
      )
    );

    await expect(
      discoverRuntimeTransportProjects({
        deviceId: "device-1",
        env,
        ownerUserId: "owner",
        request: {
          clientGeneration: 4,
          expectedOrganizationId: "org-1",
          projects: [
            {
              projectId: "project-1",
              repositoryFingerprint: `sha256:${"a".repeat(64)}`,
            },
          ],
        },
        runtimeLane: "dev-local",
      })
    ).resolves.toMatchObject({ gitStatus: "available" });

    const [, init] = stub.fetch.mock.calls[0] as [string, RequestInit];
    expect(stub.fetch.mock.calls[0]?.[0]).toBe(
      "https://runtime-transport.internal/local-project-control/discover-projects"
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      deviceId: "device-1",
      lane: "dev-local",
      ownerUserId: "owner",
      request: {
        clientGeneration: 4,
        expectedOrganizationId: "org-1",
        projects: [{ projectId: "project-1" }],
      },
      requestId: expect.any(String),
      v: 1,
    });
  });

  it("sends Computer file access through the dedicated current-device operation", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          deviceId: "device-1",
          policy: {
            mode: "local_agent_settings",
            revision: 1,
            updatedAtMs: 0,
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      readRuntimeTransportComputerFileAccessPolicy({
        deviceId: "device-1",
        env,
        ownerUserId: "owner",
        request: { expectedDeviceId: "device-1" },
        runtimeLane: "dev-local",
      })
    ).resolves.toMatchObject({ deviceId: "device-1" });

    const [, init] = stub.fetch.mock.calls[0] as [string, RequestInit];
    expect(stub.fetch.mock.calls[0]?.[0]).toBe(
      "https://runtime-transport.internal/computer-file-access/read-policy"
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      deviceId: "device-1",
      lane: "dev-local",
      ownerUserId: "owner",
      request: { expectedDeviceId: "device-1" },
      requestId: expect.any(String),
      v: 1,
    });
  });

  it.each([
    [503, "computer.file_access.service_offline"],
    [500, "computer.file_access.internal_error"],
  ] as const)("keeps non-JSON Computer file access failures in the dotted error family for HTTP %i", async (status, code) => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(new Response("unavailable", { status }));

    await expect(
      readRuntimeTransportComputerFileAccessPolicy({
        deviceId: "device-1",
        env,
        ownerUserId: "owner",
        request: { expectedDeviceId: "device-1" },
        runtimeLane: "dev-local",
      })
    ).resolves.toMatchObject({ code, status: "rejected" });
  });

  it("sends Local Folder Picker requests through the dedicated current-Computer operation", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          deviceId: "device-1",
          paths: ["/Users/felix/Design Work"],
          status: "selected",
        }),
        { status: 200 }
      )
    );

    await expect(
      selectRuntimeTransportLocalFolders({
        deviceId: "device-1",
        env,
        ownerUserId: "owner",
        request: {
          allowMultiple: true,
          expectedDeviceId: "device-1",
          purpose: "computer_file_access",
        },
        runtimeLane: "dev-local",
      })
    ).resolves.toMatchObject({ status: "selected" });

    const [, init] = stub.fetch.mock.calls[0] as [string, RequestInit];
    expect(stub.fetch.mock.calls[0]?.[0]).toBe(
      "https://runtime-transport.internal/local-folder-picker/select-folders"
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      deviceId: "device-1",
      lane: "dev-local",
      ownerUserId: "owner",
      request: {
        allowMultiple: true,
        expectedDeviceId: "device-1",
        purpose: "computer_file_access",
      },
      requestId: expect.any(String),
      v: 1,
    });
  });

  it("treats forgotten device owner-service sessions as offline when blocking forgotten devices", async () => {
    const { env, stub } = createEnv({ forgottenDeviceId: "device-1" });
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          online: true,
          sessions: [
            {
              daemonSessionId: "session-1",
              deviceId: "device-1",
              lane: "dev-local",
              connectionGeneration: 1,
              lastHeartbeatMs: 1_700_000_000_000,
              capabilities: {},
              executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
            },
          ],
        }),
        { status: 200 }
      )
    );

    await expect(
      lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env,
        ownerUserId: "owner",
      })
    ).resolves.toEqual({
      online: false,
      reasonCode: "daemon.profile.offline",
    });
  });

  it("keeps the live route when the forgotten-device read fails", async () => {
    const { env, stub } = createEnv({
      forgottenReadError: new Error("d1 unavailable"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence the expected fail-open warning
    });
    const lookupResponse = {
      online: true as const,
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      deviceId: "device-1",
      lane: "dev-local",
      leaseEpoch: 1,
      lastHeartbeatMs: 1_700_000_000_000,
      capabilities: {},
      executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
    };
    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(lookupResponse), { status: 200 })
    );

    await expect(
      lookupRuntimeTransportRoute({
        blockForgottenDevices: true,
        env,
        ownerUserId: "owner",
        profileId: "agent-1",
      })
    ).resolves.toEqual(lookupResponse);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.current_device.forgotten_read_failed]",
      expect.objectContaining({ source: "daemon_route_lookup" })
    );
    warnSpy.mockRestore();
  });

  it("keeps batch routes when the forgotten-device read fails", async () => {
    const { env, stub } = createEnv({
      forgottenReadError: new Error("d1 unavailable"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence the expected fail-open warning
    });
    const lookupResponse = {
      routes: {
        "agent-1": {
          online: true as const,
          daemonSessionId: "session-1",
          connectionGeneration: 1,
          deviceId: "device-1",
          lane: "dev-local",
          leaseEpoch: 1,
          lastHeartbeatMs: 1_700_000_000_000,
          capabilities: {},
          executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
        },
      },
    };
    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(lookupResponse), { status: 200 })
    );

    await expect(
      lookupRuntimeTransportRoutesBatch({
        blockForgottenDevices: true,
        env,
        ownerUserId: "owner",
        profileIds: ["agent-1"],
      })
    ).resolves.toEqual(lookupResponse);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.current_device.forgotten_read_failed]",
      expect.objectContaining({ source: "daemon_routes_batch_lookup" })
    );
    warnSpy.mockRestore();
  });

  it("keeps owner-service sessions when the forgotten-device read fails", async () => {
    const { env, stub } = createEnv({
      forgottenReadError: new Error("d1 unavailable"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // silence the expected fail-open warning
    });
    const ownerServiceResponse = {
      online: true as const,
      sessions: [
        {
          daemonSessionId: "session-1",
          deviceId: "device-1",
          lane: "dev-local",
          connectionGeneration: 1,
          lastHeartbeatMs: 1_700_000_000_000,
          capabilities: {},
          executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
        },
      ],
    };
    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(ownerServiceResponse), { status: 200 })
    );

    await expect(
      lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env,
        ownerUserId: "owner",
      })
    ).resolves.toEqual(ownerServiceResponse);
    expect(warnSpy).toHaveBeenCalledWith(
      "[core.current_device.forgotten_read_failed]",
      expect.objectContaining({ source: "daemon_owner_service_lookup" })
    );
    warnSpy.mockRestore();
  });

  it("rejects an environment without the required PostgreSQL owner", async () => {
    const { env, stub } = createEnv({ omitDb: true });
    const ownerServiceResponse = {
      online: true as const,
      sessions: [
        {
          daemonSessionId: "session-1",
          deviceId: "device-1",
          lane: "dev-local",
          connectionGeneration: 1,
          lastHeartbeatMs: 1_700_000_000_000,
          capabilities: {},
          executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
        },
      ],
    };
    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify(ownerServiceResponse), { status: 200 })
    );

    await expect(
      lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env,
        ownerUserId: "owner",
      })
    ).rejects.toThrow("OPENMELD_POSTGRESQL Hyperdrive binding is required");
  });

  it("propagates a missing transport binding from the owner-service lookup", async () => {
    // An errored read is not offline evidence: the thrown lookup must reach
    // the readiness layer, which maps it to unavailable/lookup_failed.
    const { env } = createEnv({ omitTransport: true });

    await expect(
      lookupRuntimeTransportOwnerService({
        env,
        ownerUserId: "owner",
      })
    ).rejects.toThrow();
  });

  it("rejects malformed owner-service evidence instead of reporting a disconnected computer", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(JSON.stringify({ online: true, sessions: [] }), {
        status: 200,
      })
    );
    await expect(
      lookupRuntimeTransportOwnerService({ env, ownerUserId: "owner" })
    ).rejects.toThrow("Invalid Runtime Transport owner-Service response.");
  });

  it("propagates a missing transport binding from the route lookup", async () => {
    const { env } = createEnv({ omitTransport: true });

    await expect(
      lookupRuntimeTransportRoute({
        env,
        ownerUserId: "owner",
        profileId: "agent-1",
      })
    ).rejects.toThrow();
  });

  it("propagates a shard resolution failure instead of answering not_found", async () => {
    // The binding exists but resolving the owner shard throws: this is an
    // errored read, not offline evidence, so the route lookup must reject
    // (downstream readiness maps it to unavailable/lookup_failed) rather
    // than resolve to a forged daemon.session.not_found answer.
    const env = {
      OPENMELD_RUNTIME_TRANSPORT: {
        idFromName: vi.fn(() => {
          throw new Error("shard resolution failed");
        }),
        get: vi.fn(),
      },
    } as unknown as CoreBindings;

    await expect(
      lookupRuntimeTransportRoute({
        env,
        ownerUserId: "owner",
        profileId: "agent-1",
      })
    ).rejects.toThrow("shard resolution failed");

    await expect(
      lookupRuntimeTransportOwnerService({
        env,
        ownerUserId: "owner",
      })
    ).rejects.toThrow("shard resolution failed");
  });

  it("uses lookup timeout for owner-service lookup requests", async () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { env, stub } = createEnv();

    stub.fetch.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        });
      }
    );

    try {
      const responsePromise = lookupRuntimeTransportOwnerService({
        env,
        ownerUserId: "owner",
      });
      const failure = expect(responsePromise).rejects.toThrow(
        "Invalid Runtime Transport owner-Service response."
      );
      await vi.advanceTimersByTimeAsync(5000);
      await failure;
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport_client.request_timeout]",
        expect.objectContaining({
          event: CORE_LOG_EVENTS.runtimeTransportClientRequestTimeout,
          path: "/lookup-owner-service",
          timeoutMs: 5000,
        })
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("returns timeout reason when deliver response is non-JSON 500", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(new Response("internal", { status: 500 }));

    const response = await deliverRuntimeTransportDispatch({
      env,
      ownerUserId: "owner",
      dispatch: {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        ownerUserId: "owner",
        profileId: "agent-1",
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        leaseEpoch: 1,
        payload: {
          ...createDeliverDispatchPayload(),
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
          executionIdentity: createDeliveryExecutionIdentity(),
        },
      },
    });

    expect(response).toEqual({
      accepted: false,
      reasonCode: "daemon.delivery.timeout",
      status: "rejected",
    });
  });

  it("records split timing around RuntimeTransport delivery calls", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      Response.json({
        accepted: true,
        status: "delivered",
      })
    );
    let nowMs = 0;
    const timing = createSpaceBootstrapTimingCollector({
      nowMs: () => {
        nowMs += 1;
        return nowMs;
      },
    });

    const response = await deliverRuntimeTransportDispatch({
      env,
      ownerUserId: "owner",
      dispatch: {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        ownerUserId: "owner",
        profileId: "agent-1",
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        leaseEpoch: 1,
        payload: {
          ...createDeliverDispatchPayload(),
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
          executionIdentity: createDeliveryExecutionIdentity(),
        },
      },
      timing,
    });

    expect(response).toEqual({
      accepted: true,
      status: "delivered",
    });
    expect(timing.metrics().map((metric) => metric.name)).toEqual([
      "openmeld_dispatch_deliver_request_parse",
      "openmeld_dispatch_deliver_rpc",
      "openmeld_dispatch_deliver_response_parse",
    ]);
  });

  it("returns transport restarting when deliver response is non-JSON 503", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(new Response("deploying", { status: 503 }));

    const response = await deliverRuntimeTransportDispatch({
      env,
      ownerUserId: "owner",
      dispatch: {
        v: 1,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        ownerUserId: "owner",
        profileId: "agent-1",
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        leaseEpoch: 1,
        payload: {
          ...createDeliverDispatchPayload(),
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
          executionIdentity: createDeliveryExecutionIdentity(),
        },
      },
    });

    expect(response).toEqual({
      accepted: false,
      reasonCode: "core.transport_restarting",
      status: "rejected",
    });
  });

  it("posts RuntimeCoordinator head accept requests to the owner shard", async () => {
    const { env, stub } = createEnv();
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    stub.fetch.mockResolvedValue(
      Response.json({
        action: "create_execution",
        ok: true,
        primaryDispatchId: "dispatch-1",
        reasonCode: "runtime_coordinator.head_accepted",
        runtimeCoordinatorExecutionId: null,
        status: "accepted",
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
      })
    );

    const response = await acceptRuntimeTransportRuntimeCoordinatorHead({
      env,
      ownerUserId: "owner",
      head: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner",
        targetWakeLifecycleIdentity,
      },
    });

    expect(response).toMatchObject({
      action: "create_execution",
      ok: true,
      primaryDispatchId: "dispatch-1",
      status: "accepted",
    });
    const firstCall = stub.fetch.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected runtime transport fetch call");
    }
    const [url, init] = firstCall;
    expect(url).toBe(
      "https://runtime-transport.internal/runtime-coordinator/head/accept"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      dispatchId: "dispatch-1",
      ownerUserId: "owner",
      targetWakeLifecycleIdentity: {
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
      },
    });
  });

  it("keeps target lifecycle identity when head accept response is non-JSON 503", async () => {
    const { env, stub } = createEnv();
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    stub.fetch.mockResolvedValue(new Response("deploying", { status: 503 }));

    const response = await acceptRuntimeTransportRuntimeCoordinatorHead({
      env,
      ownerUserId: "owner",
      head: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner",
        targetWakeLifecycleIdentity,
      },
    });

    expect(response).toEqual({
      ok: false,
      primaryDispatchId: null,
      reasonCode: "core.transport_restarting",
      status: "retry_later",
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    });
  });

  it("posts RuntimeCoordinator head no-execution requests to the owner shard", async () => {
    const { env, stub } = createEnv();
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    stub.fetch.mockResolvedValue(
      Response.json({
        ok: true,
        primaryDispatchId: "dispatch-1",
        publicationIntentId: `rcpi:no_execution:${targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
        reasonCode: "agent_profile_binding.missing",
        runtimeCoordinatorExecutionId: null,
        status: "publication_intent_ready",
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
      })
    );

    const response =
      await recordRuntimeTransportRuntimeCoordinatorHeadNoExecution({
        env,
        ownerUserId: "owner",
        noExecution: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          dispatchId: "dispatch-1",
          idempotencyKey: "signal-1::agent-1",
          ownerUserId: "owner",
          publicationCategory: "binding_required",
          reasonCode: "agent_profile_binding.missing",
          targetWakeLifecycleIdentity,
          userRecoveryAction: "set_up_agent_binding",
        },
      });

    expect(response).toMatchObject({
      ok: true,
      primaryDispatchId: "dispatch-1",
      reasonCode: "agent_profile_binding.missing",
      runtimeCoordinatorExecutionId: null,
      status: "publication_intent_ready",
    });
    const firstCall = stub.fetch.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected runtime transport fetch call");
    }
    const [url, init] = firstCall;
    expect(url).toBe(
      "https://runtime-transport.internal/runtime-coordinator/head/no-execution"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      dispatchId: "dispatch-1",
      ownerUserId: "owner",
      publicationCategory: "binding_required",
      reasonCode: "agent_profile_binding.missing",
      userRecoveryAction: "set_up_agent_binding",
    });
  });

  it("posts RuntimeCoordinator head waiting requests to the owner shard", async () => {
    const { env, stub } = createEnv();
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    stub.fetch.mockResolvedValue(
      Response.json({
        deadlineAtMs: 1_700_000_300_000,
        nextTriggerAtMs: 1_700_000_030_000,
        ok: true,
        primaryDispatchId: "dispatch-1",
        reasonCode: "daemon.profile.offline",
        runtimeCoordinatorExecutionId: null,
        softDeadlineAtMs: 1_700_000_030_000,
        status: "waiting",
        targetWakeLifecycleId:
          targetWakeLifecycleIdentity.targetWakeLifecycleId,
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      })
    );

    const response = await recordRuntimeTransportRuntimeCoordinatorHeadWaiting({
      env,
      ownerUserId: "owner",
      waiting: {
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        idempotencyKey: "signal-1::agent-1",
        observedAtMs: 1_700_000_000_000,
        ownerUserId: "owner",
        reasonCode: "daemon.profile.offline",
        targetWakeLifecycleIdentity,
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      },
    });

    expect(response).toMatchObject({
      ok: true,
      primaryDispatchId: "dispatch-1",
      reasonCode: "daemon.profile.offline",
      runtimeCoordinatorExecutionId: null,
      status: "waiting",
    });
    const firstCall = stub.fetch.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected runtime transport fetch call");
    }
    const [url, init] = firstCall;
    expect(url).toBe(
      "https://runtime-transport.internal/runtime-coordinator/head/waiting"
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      dispatchId: "dispatch-1",
      ownerUserId: "owner",
      reasonCode: "daemon.profile.offline",
      userRecoveryAction: "start_or_restart_openmeld_service",
      waitingCategory: "service_not_connected",
    });
  });

  it.each([
    false,
    true,
  ])("reads owner trace without mutation fields and context opt-in %s", async (includeExecutionContext) => {
    const { env, stub } = createEnv();
    const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    stub.fetch.mockResolvedValue(
      Response.json({
        ok: true,
        readStatus: "found",
        lifecycle: {
          createdAtMs: 1_700_000_000_000,
          duplicateDispatchCount: 0,
          executionLinkedAtMs: null,
          modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
          noExecutionDecision: {
            decidedAtMs: 1_700_000_000_001,
            publicationCategory: "binding_required",
            reasonCode: "agent_profile_binding.missing",
            source: "dispatch_preflight",
            userRecoveryAction: "set_up_agent_binding",
          },
          ownerUserId: "owner",
          primaryDispatchId: "dispatch-1",
          publicationIntent: {
            intentId: `rcpi:no_execution:${targetWakeLifecycleIdentity.targetWakeLifecycleId}`,
            kind: "no_execution_failure",
            publicationCategory: "binding_required",
            readyAtMs: 1_700_000_000_002,
            reasonCode: "agent_profile_binding.missing",
            status: "ready_for_phase_6",
            userRecoveryAction: "set_up_agent_binding",
          },
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleIdentity,
          targetWakeLifecycleId:
            targetWakeLifecycleIdentity.targetWakeLifecycleId,
          updatedAtMs: 1_700_000_000_002,
          waitingBoundary: null,
        },
      })
    );

    const response =
      await readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace({
        env,
        includeExecutionContext,
        ownerUserId: "owner",
        request: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          targetWakeLifecycleIdentity,
        },
      });

    expect(response).toMatchObject({
      ok: true,
      readStatus: "found",
      lifecycle: {
        status: "publication_intent_ready",
        runtimeCoordinatorExecutionId: null,
      },
    });
    const firstCall = stub.fetch.mock.calls[0];
    if (!firstCall) {
      throw new Error("expected runtime transport fetch call");
    }
    const [url, init] = firstCall;
    expect(url).toBe(
      `https://runtime-transport.internal/runtime-coordinator/head/trace${includeExecutionContext ? "?executionContext=1" : ""}`
    );
    if (includeExecutionContext) {
      expect(response.executionContext).toEqual({
        readStatus: "authority_unavailable",
        reasonCode: "execution_context.diagnostics_not_reported",
      });
    } else {
      expect(response).not.toHaveProperty("executionContext");
    }
    expect(JSON.parse(String(init?.body))).toEqual({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      targetWakeLifecycleIdentity,
    });
  });

  it.each([
    false,
    true,
  ])("keeps the five-second Head trace deadline with context opt-in %s", async (includeExecutionContext) => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { env, stub } = createEnv();
    let signal: AbortSignal | null | undefined;
    stub.fetch.mockImplementation((_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new Error("request aborted"))
        );
      });
    });
    try {
      const pending = readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace({
        env,
        includeExecutionContext,
        ownerUserId: "owner",
        request: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
            clientMessageId: "client-message-1",
            dispatchId: "dispatch-1",
            sourceSignalId: "signal-1",
            spaceId: "space-1",
            targetProfileId: "agent-1",
          }),
        },
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(signal?.aborted).toBe(true);
      expect(await pending).toMatchObject({
        readStatus: "authority_unavailable",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport_client.request_timeout]",
        expect.objectContaining({
          path: "/runtime-coordinator/head/trace",
          timeoutMs: 5000,
        })
      );
    } finally {
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it.each([
    {
      failure: "network",
      status: 0,
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
    },
    {
      failure: "invalid_response",
      status: 200,
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
    },
    {
      failure: "server_error",
      status: 500,
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
    },
    {
      failure: "restarting",
      status: 503,
      reasonCode: "core.transport_restarting",
    },
  ])("reports unavailable Context and preserves the Head reason on $failure", async ({
    failure,
    status,
    reasonCode,
  }) => {
    const { env, stub } = createEnv();
    if (failure === "network") {
      stub.fetch.mockRejectedValue(new Error("connection unavailable"));
    } else {
      stub.fetch.mockResolvedValue(new Response("not JSON", { status }));
    }
    const request = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      targetWakeLifecycleIdentity: projectTargetWakeLifecycleIdentity({
        clientMessageId: "client-message-1",
        dispatchId: "dispatch-1",
        sourceSignalId: "signal-1",
        spaceId: "space-1",
        targetProfileId: "agent-1",
      }),
    };
    const response =
      await readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace({
        env,
        includeExecutionContext: true,
        ownerUserId: "owner",
        request,
      });
    expect(response).toMatchObject({
      ok: false,
      readStatus: "authority_unavailable",
      reasonCode,
      executionContext: { readStatus: "authority_unavailable", reasonCode },
    });
    const legacy =
      await readRuntimeTransportRuntimeCoordinatorHeadLifecycleTrace({
        env,
        ownerUserId: "owner",
        request,
      });
    expect(legacy).not.toHaveProperty("executionContext");
  });

  it("returns timeout reason when wait response is non-JSON 409", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(new Response("failed", { status: 409 }));

    const response = await waitRuntimeTransportDispatchResult({
      env,
      ownerUserId: "owner",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 1,
      timeoutMs: 1000,
    });

    expect(response).toEqual({
      reasonCode: "daemon.delivery.timeout",
      state: "failed",
    });
  });

  it("keeps structured pending lifecycle when wait response is valid JSON", async () => {
    const { env, stub } = createEnv();
    stub.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          lifecycle: {
            phase: "running",
            createdAtMs: 1000,
            acceptedLocalAtMs: 1100,
            runningAtMs: 1200,
            completedLocalAtMs: null,
            lastLifecycleAtMs: 1300,
          },
          state: "pending",
        }),
        { status: 200 }
      )
    );

    const response = await waitRuntimeTransportDispatchResult({
      env,
      ownerUserId: "owner",
      attemptId: "attempt-1",
      dispatchId: "dispatch-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 1,
      timeoutMs: 1000,
    });

    expect(response).toEqual({
      lifecycle: {
        phase: "running",
        createdAtMs: 1000,
        acceptedLocalAtMs: 1100,
        runningAtMs: 1200,
        completedLocalAtMs: null,
        lastLifecycleAtMs: 1300,
      },
      state: "pending",
    });
  });

  it("emits event field for timeout warning logs", async () => {
    vi.useFakeTimers();
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { env, stub } = createEnv();

    stub.fetch.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("request aborted"));
          });
        });
      }
    );

    try {
      const responsePromise = lookupRuntimeTransportRoute({
        env,
        ownerUserId: "owner",
        profileId: "agent-1",
      });
      await vi.advanceTimersByTimeAsync(5000);
      const response = await responsePromise;
      expect(response).toEqual({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "[core.runtime_transport_client.request_timeout]",
        expect.objectContaining({
          event: CORE_LOG_EVENTS.runtimeTransportClientRequestTimeout,
          path: "/lookup-route",
          timeoutMs: 5000,
        })
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([
    false,
    true,
  ])("preserves daemon-facing dispatch snapshots needed by the runtime (accepted clock: %s)", (hasRequestTime) => {
    const request = buildRuntimeTransportDeliverDispatchRequest({
      attemptId: "attempt-1",
      executionIdentity: createDeliveryExecutionIdentity(),
      ownerUserId: "owner",
      route: {
        online: true,
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        deviceId: "device-1",
        lane: "dev-local",
        leaseEpoch: 1,
        lastHeartbeatMs: 1_700_000_000_000,
        capabilities: {},
        executionCompatibility: COMPATIBLE_DAEMON_EXECUTION_COMPATIBILITY,
      },
      message: {
        ...createDispatchQueueMessage(),
        sourceSignalSnapshot: {
          text: "hello",
          profileId: "hum-1",
          profileKind: "human",
          ...(hasRequestTime
            ? {
                requestTimeContext: {
                  submittedAtMs: 1000,
                  userTime: {
                    timeZone: "Asia/Taipei",
                    source: "web" as const,
                    observedAtMs: 900,
                  },
                },
              }
            : {}),
        },
        replyToSnapshot: {
          signalId: "sig-1",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          profileName: "Mira",
          previewText: "hello",
        },
        spaceNameSnapshot: "OpenClaw Ops Room",
      },
      sourceSignal: {
        text: "hello",
        profileId: "hum-1",
        profileKind: "human",
      },
      targetProfileName: "OpenClaw Agent",
    });

    expect(request.payload).toMatchObject({
      sourceSignalSnapshot: {
        text: request.payload.sourceSignal.text,
        profileId: "hum-1",
        profileKind: "human",
      },
      replyToSnapshot: {
        signalId: "sig-1",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        profileName: "Mira",
        previewText: "hello",
      },
      spaceNameSnapshot: "OpenClaw Ops Room",
    });
    if (hasRequestTime) {
      expect(request.payload.sourceSignal.text).toContain(
        "Request received at UTC: 1970-01-01T00:00:01.000Z"
      );
      expect(request.payload.sourceSignal.text).toContain(
        "Request timezone: Asia/Taipei (authenticated web observation)"
      );
    } else {
      expect(request.payload.sourceSignal.text).toBe("hello");
    }
    // Installed Service snapshots are strict. Retained request data must reach
    // their existing text field without requiring a new transport field.
    expect(request.payload.sourceSignalSnapshot).not.toHaveProperty(
      "requestTimeContext"
    );
  });
});
