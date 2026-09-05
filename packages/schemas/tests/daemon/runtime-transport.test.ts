import { describe, expect, it } from "vitest";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  daemonExecutionCompatibilitySchema,
  daemonStreamErrorFrameSchema,
  daemonStreamFrameSchema,
  localWakeRouteReportSchema,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  runtimeTransportAgentProfileExecutionStateRequestSchema,
  runtimeTransportAgentProfileExecutionStateResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema,
  runtimeTransportAgentProfileExecutionTargetMutationRequestSchema,
  runtimeTransportAgentProfileOperationalContextSchema,
  runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema,
  runtimeTransportAgentProfileWorkContinuationAuthorizeResponseSchema,
  runtimeTransportAgentProfileWorkContinuationNeedsAttentionRequestSchema,
  runtimeTransportAgentProfileWorkQueueApproveRequestSchema,
  runtimeTransportAgentProfileWorkQueueApproveResponseSchema,
  runtimeTransportAgentProfileWorkRecoveryReadResponseSchema,
  runtimeTransportAgentProfileWorkUsageAvailableRequestSchema,
  runtimeTransportAgentProfileWorkUsageAvailableResponseSchema,
  runtimeTransportCapabilitiesSchema,
  runtimeTransportDeliverDispatchPayloadSchema,
  runtimeTransportDeliverDispatchRequestSchema,
  runtimeTransportDeliverDispatchResponseSchema,
  runtimeTransportDisconnectRatesResponseSchema,
  runtimeTransportDispatchInteractionDeliveredRequestSchema,
  runtimeTransportDispatchInteractionRequestSchema,
  runtimeTransportDispatchInteractionResponseFramePayloadSchema,
  runtimeTransportDispatchLifecycleRequestSchema,
  runtimeTransportDispatchPreviewEndRequestSchema,
  runtimeTransportDispatchPreviewRequestSchema,
  runtimeTransportDispatchRuntimeEvidenceRequestSchema,
  runtimeTransportDispatchToolActivityRequestSchema,
  runtimeTransportErrorCodeSchema,
  runtimeTransportHeartbeatRequestSchema,
  runtimeTransportLocalAgentControlCancelFramePayloadSchema,
  runtimeTransportLocalAgentControlInterruptFramePayloadSchema,
  runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema,
  runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema,
  runtimeTransportLocalAgentControlResultFramePayloadSchema,
  runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema,
  runtimeTransportLookupOwnerServiceResponseSchema,
  runtimeTransportLookupRouteResponseSchema,
  runtimeTransportManageLocalAgentInstallationRequestSchema,
  runtimeTransportManageLocalAgentInstallationResponseSchema,
  runtimeTransportOpenMeldToolsControlFramePayloadSchema,
  runtimeTransportOpenMeldToolsControlRequestSchema,
  runtimeTransportOpenMeldToolsControlResponseSchema,
  runtimeTransportOpenMeldToolsControlResultFramePayloadSchema,
  runtimeTransportPreExecutionHandoffResponseSchema,
  runtimeTransportRefreshLocalAgentCatalogRequestSchema,
  runtimeTransportRefreshLocalAgentCatalogResponseSchema,
  runtimeTransportRegisterSessionRequestSchema,
  runtimeTransportRuntimeCoordinatorDecisionRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema,
  runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema,
  runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema,
  runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema,
  runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema,
  runtimeTransportRuntimeCoordinatorWakeStopRequestSchema,
  runtimeTransportRuntimeCoordinatorWakeStopResponseSchema,
  runtimeTransportSessionDisconnectDiagnosticSchema,
  runtimeTransportSetProfileWorkspaceRequestSchema,
  runtimeTransportSetProfileWorkspaceResponseSchema,
  runtimeTransportSubmitTaskResultRequestSchema,
} from "../../src/index";

const createDeliverDispatchPayload = () => ({
  attemptId: "attempt-1",
  dispatchId: "dispatch-1",
  runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
  executionIdentity: createDeliveryExecutionIdentity(),
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
  enqueuedAtMs: 1_700_000_000_123,
  idempotencyKey: "idempotency-1",
  executionToken: createExecutionTokenEnvelope(),
});

const createExecutionIdentityCore = () => ({
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
});

const createDeliveryExecutionIdentity = () => ({
  authority: "core_runtime_registry_binding_route" as const,
  core: createExecutionIdentityCore(),
});

const createRuntimeEvidenceIdentityEcho = () => ({
  echoSource: "daemon_delivery_context" as const,
  core: createExecutionIdentityCore(),
});

const createResultIdentityEcho = () => ({
  echoSource: "daemon_delivery_context" as const,
  core: createExecutionIdentityCore(),
});

const createExecutionTokenEnvelope = () => ({
  authorityScope: {
    bindingId: "binding-1",
    agentControllerRef: "builtin:codex",
    openMeldServiceRuntimeId: "runtime-1",
  },
  deliveryIdempotencyKey: "rce-space-1-dispatch-1-agent-1:run-1",
  deliveryProvenance: {
    connectionGeneration: 1,
    daemonSessionId: "session-1",
    leaseEpoch: 2,
  },
  executionScope: {
    dispatchId: "dispatch-1",
    runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
    sourceClientMessageId: null,
    spaceId: "space-1",
    targetProfileId: "agent-1",
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

const createExecutionTokenEcho = () => ({
  executionToken:
    "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runId: "run-1",
  runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
  tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
});

const createLocalComponentsStatus = () => ({
  schemaVersion: 1,
  generatedAt: "2026-06-04T00:00:00.000Z",
  entrypoint: "setup" as const,
  summaryLabel: "Everything is up to date",
  summaryDescription:
    "OpenMeld local components are aligned for this computer.",
  setupAction: "none" as const,
  setupActionLabel: "Everything is up to date",
  setupActionDescription:
    "OpenMeld local components are aligned for this computer.",
  cli: {
    commandContractVersion: "cli-contract-v1",
    latestPackageVersion: "0.7.94",
    packageVersion: "0.7.94",
    reasonCodes: [],
    requiredCommandContractVersion: null,
    status: "ok" as const,
  },
  service: {
    expectedBundleHash: "a".repeat(64),
    expectedBundleVersion: "0.7.94",
    installedBundleHash: "a".repeat(64),
    installedBundleVersion: "0.7.94",
    reasonCodes: [],
    runtimeContractEpoch: "daemon-epoch-v1",
    serviceContractVersion: "daemon-epoch-v1",
    status: "ok" as const,
  },
  skills: {
    expectedBundleHash: "b".repeat(64),
    installedBundleHash: "b".repeat(64),
    reasonCodes: [],
    skillContractVersion: "skills-contract-v1",
    status: "ok" as const,
    targetCount: 1,
  },
});

describe("runtime transport schema", () => {
  const createV4RouteReport = (observation: Record<string, unknown>) => ({
    expectedRoutesContractVersion: "v4",
    reportedAtMs: 1_700_000_000_000,
    daemonSessionId: "session-1",
    deviceId: "device-1",
    lane: "prod",
    includedProfileIds: ["agent-1"],
    profileConfigurationRevisions: [
      {
        bindingId: "binding-1",
        configurationRevision: 3,
        profileId: "agent-1",
      },
    ],
    skippedProfiles: [],
    workingFolderObservations: [observation],
  });

  const observationIdentity = {
    bindingId: "binding-1",
    configurationRevision: 3,
    observedAtMs: 1_700_000_000_000,
    profileId: "agent-1",
  };

  it.each([
    {
      ...observationIdentity,
      defaultProjectId: "project-1",
      localProjectBindingGeneration: "binding-generation-2",
      reasonCode: null,
      source: "default_project",
      status: "ready",
    },
    {
      ...observationIdentity,
      defaultProjectId: "project-1",
      localProjectBindingGeneration: null,
      reasonCode: "project.local_connection.missing",
      source: "default_project",
      status: "missing",
    },
    {
      ...observationIdentity,
      defaultProjectId: "project-1",
      localProjectBindingGeneration: "binding-generation-2",
      reasonCode: "project.local_connection.folder_missing",
      source: "default_project",
      status: "missing",
    },
    {
      ...observationIdentity,
      defaultProjectId: "project-1",
      localProjectBindingGeneration: "binding-generation-2",
      reasonCode: "project.local_connection.invalid",
      source: "default_project",
      status: "invalid",
    },
    {
      ...observationIdentity,
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      reasonCode: null,
      source: "profile_workspace",
      status: "ready",
    },
    {
      ...observationIdentity,
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      reasonCode: "profile.workspace.missing",
      source: "profile_workspace",
      status: "missing",
    },
    {
      ...observationIdentity,
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      reasonCode: "profile.workspace.invalid",
      source: "profile_workspace",
      status: "invalid",
    },
  ])("accepts one of the six path-free v4 working-folder facts", (observation) => {
    const report = localWakeRouteReportSchema.parse(
      createV4RouteReport(observation)
    );

    expect("workingFolderObservations" in report).toBe(true);
    if ("workingFolderObservations" in report) {
      expect(report.workingFolderObservations[0]).toEqual(observation);
    }
  });

  it.each([
    {
      ...observationIdentity,
      defaultProjectId: null,
      localProjectBindingGeneration: "binding-generation-2",
      reasonCode: null,
      source: "default_project",
      status: "ready",
    },
    {
      ...observationIdentity,
      defaultProjectId: "project-1",
      localProjectBindingGeneration: "binding-generation-2",
      reasonCode: "project.local_connection.missing",
      source: "default_project",
      status: "missing",
    },
    {
      ...observationIdentity,
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      reasonCode: "project.local_connection.folder_missing",
      source: "profile_workspace",
      status: "missing",
    },
  ])("rejects an impossible v4 working-folder fact", (observation) => {
    expect(
      localWakeRouteReportSchema.safeParse(createV4RouteReport(observation))
        .success
    ).toBe(false);
  });

  it("requires v4 observations only on the negotiated v4 report branch", () => {
    const observation = {
      ...observationIdentity,
      defaultProjectId: null,
      localProjectBindingGeneration: null,
      reasonCode: null,
      source: "profile_workspace",
      status: "ready",
    };
    const legacyReport = {
      reportedAtMs: 1_700_000_000_000,
      daemonSessionId: "session-1",
      deviceId: "device-1",
      lane: "prod",
      includedProfileIds: ["agent-1"],
      skippedProfiles: [],
    };

    expect(localWakeRouteReportSchema.safeParse(legacyReport).success).toBe(
      true
    );
    expect(
      localWakeRouteReportSchema.safeParse({
        ...legacyReport,
        workingFolderObservations: [observation],
      }).success
    ).toBe(false);
    expect(
      localWakeRouteReportSchema.safeParse({
        ...legacyReport,
        expectedRoutesContractVersion: "v3",
      }).success
    ).toBe(false);
    expect(
      localWakeRouteReportSchema.safeParse({
        ...legacyReport,
        expectedRoutesContractVersion: "v4",
      }).success
    ).toBe(false);
  });

  it("reads account-wide Agent execution state without a Space selector", () => {
    expect(
      runtimeTransportAgentProfileExecutionStateRequestSchema.parse({
        ownerUserId: "owner-1",
        targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).toEqual({
      ownerUserId: "owner-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    expect(
      runtimeTransportAgentProfileExecutionStateResponseSchema.parse({
        status: "active",
      })
    ).toEqual({ status: "active" });
    expect(
      runtimeTransportAgentProfileExecutionStateResponseSchema.parse({
        reasonCode: "runtime_coordinator.execution_state_unavailable",
        status: "unavailable",
      })
    ).toEqual({
      reasonCode: "runtime_coordinator.execution_state_unavailable",
      status: "unavailable",
    });
  });

  it("validates account-wide Controller mutation admission without a Space selector", () => {
    const request = {
      operationId: "controller-mutation-1",
      ownerUserId: "owner-1",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    };
    expect(
      runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.parse(
        request
      )
    ).toEqual(request);
    expect(() =>
      runtimeTransportAgentProfileExecutionTargetMutationRequestSchema.parse({
        ...request,
        mutationKind: "future_work_settings",
      })
    ).toThrow();
    expect(
      runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema.parse(
        {
          expiresAtMs: 1_700_000_300_000,
          operationId: request.operationId,
          status: "acquired",
        }
      )
    ).toEqual({
      expiresAtMs: 1_700_000_300_000,
      operationId: request.operationId,
      status: "acquired",
    });
    expect(
      runtimeTransportAgentProfileExecutionTargetMutationAcquireResponseSchema.parse(
        {
          reasonCode: "runtime_coordinator.agent_profile_execution_active",
          status: "blocked",
        }
      )
    ).toEqual({
      reasonCode: "runtime_coordinator.agent_profile_execution_active",
      status: "blocked",
    });
    expect(
      runtimeTransportAgentProfileExecutionTargetMutationReleaseResponseSchema.parse(
        { status: "released" }
      )
    ).toEqual({ status: "released" });
  });

  it("accepts bounded per-session disconnect diagnostics and legacy responses without them", () => {
    const legacy = runtimeTransportDisconnectRatesResponseSchema.safeParse({
      ok: true,
      ownerUserId: "owner-1",
      windowMs: 86_400_000,
      buckets: [],
    });
    const current = runtimeTransportDisconnectRatesResponseSchema.safeParse({
      ok: true,
      ownerUserId: "owner-1",
      windowMs: 86_400_000,
      buckets: [],
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
    });

    expect(legacy.success).toBe(true);
    if (legacy.success) {
      expect(legacy.data.recentSessions).toBeUndefined();
    }
    expect(
      current.success,
      current.success ? undefined : JSON.stringify(current.error.issues)
    ).toBe(true);
    expect(
      runtimeTransportSessionDisconnectDiagnosticSchema.safeParse({
        ...(current.success ? current.data.recentSessions?.[0] : {}),
        daemonSessionId: "s".repeat(129),
      }).success
    ).toBe(false);
  });

  it("accepts registerSession request", () => {
    const parsed = runtimeTransportRegisterSessionRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      profileIds: ["agent-1"],
      capabilities: {},
      runtimeContract: {
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      },
      connectedAtMs: 1_700_000_000_000,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts legacy registerSession request without runtime contract", () => {
    const parsed = runtimeTransportRegisterSessionRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      profileIds: ["agent-1"],
      capabilities: {},
      connectedAtMs: 1_700_000_000_000,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts registerSession request with runtime adapter capabilities", () => {
    const parsed = runtimeTransportRegisterSessionRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      profileIds: ["agent-1"],
      capabilities: {
        runtimeAdapters: [
          {
            adapterId: "codex",
            capabilityDeclaration: {
              continuationCapability: "standard",
              preparationRequirement: "none",
              runtimeWorkingDirectoryMode: "spawn_cwd",
              streamingCapability: "preview_capable",
              workspaceResumeBehavior: "transparent",
            },
            defaultStreamingMode: "final",
            transportModes: ["local-cli"],
          },
        ],
      },
      connectedAtMs: 1_700_000_000_000,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects registerSession request when connectedAtMs is negative", () => {
    const parsed = runtimeTransportRegisterSessionRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      connectionGeneration: 0,
      profileIds: ["agent-1"],
      capabilities: {},
      connectedAtMs: -1,
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts heartbeat request", () => {
    const parsed = runtimeTransportHeartbeatRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      leases: [{ profileId: "agent-1", leaseEpoch: 2 }],
      runtimeContract: {
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      },
      sentAtMs: 1_700_000_000_123,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts heartbeat request with local component capabilities", () => {
    const parsed = runtimeTransportHeartbeatRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      leases: [{ profileId: "agent-1", leaseEpoch: 2 }],
      capabilities: {
        localComponents: createLocalComponentsStatus(),
      },
      runtimeContract: {
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      },
      sentAtMs: 1_700_000_000_123,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts legacy heartbeat request without runtime contract", () => {
    const parsed = runtimeTransportHeartbeatRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local",
      daemonSessionId: "session-1",
      leases: [{ profileId: "agent-1", leaseEpoch: 2 }],
      sentAtMs: 1_700_000_000_123,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts daemon execution compatibility evidence", () => {
    const parsed = daemonExecutionCompatibilitySchema.safeParse({
      status: "update_required",
      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      observedEpoch: null,
      reasonCode: "daemon.runtime_contract.missing",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts lookupRoute response when online", () => {
    const parsed = runtimeTransportLookupRouteResponseSchema.safeParse({
      online: true,
      daemonSessionId: "session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      leaseEpoch: 2,
      lastHeartbeatMs: 1_700_000_000_456,
      capabilities: {},
      executionCompatibility: {
        status: "compatible",
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts owner service response with update-required session", () => {
    const parsed = runtimeTransportLookupOwnerServiceResponseSchema.safeParse({
      online: true,
      sessions: [
        {
          daemonSessionId: "session-1",
          deviceId: "device-1",
          lane: "dev-local",
          connectionGeneration: 1,
          lastHeartbeatMs: 1_700_000_000_456,
          capabilities: {},
          executionCompatibility: {
            status: "update_required",
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: null,
            reasonCode: "daemon.runtime_contract.missing",
          },
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts lookupRoute response when online with runtime adapter capabilities", () => {
    const parsed = runtimeTransportLookupRouteResponseSchema.safeParse({
      online: true,
      daemonSessionId: "session-1",
      deviceId: "device-1",
      lane: "dev-local",
      connectionGeneration: 1,
      leaseEpoch: 2,
      lastHeartbeatMs: 1_700_000_000_456,
      capabilities: {
        runtimeAdapters: [
          {
            adapterId: "openclaw",
            capabilityDeclaration: {
              continuationCapability: "provider_specific",
              preparationRequirement: "required",
              runtimeWorkingDirectoryMode: "spawn_cwd",
              streamingCapability: "final_only",
              workspaceResumeBehavior: "provider_specific_switch",
            },
            defaultStreamingMode: "final",
            transportModes: ["local-cli"],
          },
        ],
      },
      executionCompatibility: {
        status: "compatible",
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects lookupRoute response when offline reasonCode is missing", () => {
    const parsed = runtimeTransportLookupRouteResponseSchema.safeParse({
      online: false,
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts lookupRoute response with fresh owner service evidence for pending first report", () => {
    const parsed = runtimeTransportLookupRouteResponseSchema.safeParse({
      online: false,
      reasonCode: "daemon.profile.pending_first_report",
      ownerService: {
        daemonSessionId: "session-1",
        deviceId: "device-1",
        lane: "dev-local",
        connectionGeneration: 1,
        lastHeartbeatMs: 1_700_000_000_456,
        capabilities: {},
        executionCompatibility: {
          status: "compatible",
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible",
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects lookupRoute response with internal delivery state", () => {
    const internalDeliveryState = ["re", "connecting"].join("");
    const parsed = runtimeTransportLookupRouteResponseSchema.safeParse({
      online: false,
      reasonCode: "daemon.profile.offline",
      lastHeartbeatMs: 1_700_000_000_456,
      deliveryState: internalDeliveryState,
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts deliverDispatch request", () => {
    const parsed = runtimeTransportDeliverDispatchRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      ownerUserId: "owner-1",
      profileId: "agent-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      payload: createDeliverDispatchPayload(),
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts execution-incompatible deliverDispatch rejection reasons", () => {
    const parsed = runtimeTransportDeliverDispatchResponseSchema.safeParse({
      accepted: false,
      reasonCode: "daemon.runtime_contract.mismatch",
      status: "rejected",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts token validation rejection reason codes on daemon responses", () => {
    expect(
      runtimeTransportErrorCodeSchema.safeParse("execution_token_missing")
        .success
    ).toBe(true);
    expect(
      runtimeTransportErrorCodeSchema.safeParse("execution_token_superseded")
        .success
    ).toBe(true);
    expect(
      runtimeTransportErrorCodeSchema.safeParse("execution_token_unknown")
        .success
    ).toBe(true);
  });

  it("accepts runtime coordinator execution token only on daemon delivery and echo boundaries", () => {
    const delivery = runtimeTransportDeliverDispatchPayloadSchema.safeParse(
      createDeliverDispatchPayload()
    );
    expect(delivery.success).toBe(true);
    if (!delivery.success) {
      return;
    }
    expect(delivery.data.executionToken?.executionToken).toBe(
      "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );

    const lifecycle = runtimeTransportDispatchLifecycleRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      phase: "running",
      lifecycleAtMs: 1_700_000_000_100,
    });
    expect(lifecycle.success).toBe(true);

    const runtimeEvidence =
      runtimeTransportDispatchRuntimeEvidenceRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
        executionTokenEcho: createExecutionTokenEcho(),
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        leaseEpoch: 2,
        phase: "runtime_started",
        evidenceAtMs: 1_700_000_000_100,
        taskId: "task-1",
        spaceId: "space-1",
        sourceSignalId: "signal-1",
        targetProfileId: "agent-1",
      });
    expect(runtimeEvidence.success).toBe(true);
  });

  it("accepts deliverDispatch payload sourceClientMessageId for claim diagnostics", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      sourceClientMessageId: "client-message-1",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.sourceClientMessageId).toBe("client-message-1");
  });

  it("accepts deliverDispatch payload without sourceClientMessageId", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse(
      createDeliverDispatchPayload()
    );

    expect(parsed.success).toBe(true);
  });

  it("accepts a canonical Default Project on daemon delivery", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      defaultProjectId: "project-1",
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.defaultProjectId).toBe("project-1");
  });

  it("negotiates and carries the Organization information protection prompt", () => {
    const capabilities = runtimeTransportCapabilitiesSchema.parse({
      informationProtectionPrompt: true,
    });
    expect(capabilities.informationProtectionPrompt).toBe(true);

    const delivery = runtimeTransportDeliverDispatchPayloadSchema.parse({
      ...createDeliverDispatchPayload(),
      organizationProtectedInformation: "Private customer pricing.",
    });
    expect(delivery.organizationProtectedInformation).toBe(
      "Private customer pricing."
    );
  });

  it("rejects caller-local fields beside the Default Project id", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      defaultProjectId: "project-1",
      defaultProjectPath: "/private/local/path",
    });

    expect(parsed.success).toBe(false);
  });

  it("requires authoritative delivery execution identity on deliverDispatch payloads", () => {
    const payload: Record<string, unknown> = {
      ...createDeliverDispatchPayload(),
    };
    payload.executionIdentity = undefined;

    const parsed =
      runtimeTransportDeliverDispatchPayloadSchema.safeParse(payload);

    expect(parsed.success).toBe(false);
  });

  it("accepts deliverDispatch payload with null sourceClientMessageId", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      sourceClientMessageId: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects empty deliverDispatch payload sourceClientMessageId", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      sourceClientMessageId: "",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects overlong deliverDispatch payload sourceClientMessageId", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      sourceClientMessageId: "c".repeat(201),
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts deliverDispatch request with delivery recovery reason", () => {
    const sourceMessageEnvelope = {
      activationTargets: ["agt_33333333-3333-4333-8333-333333333333"],
      referenceTargets: [],
      text: "@Codex Agent(wake) hello",
    };
    const parsed = runtimeTransportDeliverDispatchRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      ownerUserId: "owner-1",
      profileId: "agent-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      deliveryRecoveryReason: "connection_replaced",
      payload: {
        ...createDeliverDispatchPayload(),
        deliveryRecoveryReason: "connection_replaced",
        dispatchChainId: "dispatch-chain-1",
        autoRelayDepth: 0,
        visitedProfileIds: [],
        visitedProfileIdsHash: "stable32:11111111",
        transportMode: null,
        streamingMode: "final",
        spaceNameSnapshot: "Ops Room",
        sourceSignalSnapshot: {
          text: "hello",
          profileId: "hum-1",
          profileKind: "human",
        },
        sourceMessageEnvelope,
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.payload.sourceMessageEnvelope).toEqual(
      sourceMessageEnvelope
    );
  });

  it("accepts deliverDispatch payload with an optional space name snapshot", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      spaceNameSnapshot: "YC Agent Lab",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects hosted admission recovery metadata at the workstation boundary", () => {
    const parsed = runtimeTransportDeliverDispatchRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      ownerUserId: "owner-1",
      profileId: "agent-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      deliveryRecoveryReason: "hosted_admission_incomplete",
      payload: {
        ...createDeliverDispatchPayload(),
        deliveryRecoveryReason: "hosted_admission_incomplete",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects deliverDispatch payload with unknown fields", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      unknownField: "nope",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects deliverDispatch payload with legacy targetProfileHandle", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      targetProfileHandle: "legacy-helper",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects deliverDispatch payload when sourceSignal.text is missing", () => {
    const parsed = runtimeTransportDeliverDispatchPayloadSchema.safeParse({
      ...createDeliverDispatchPayload(),
      sourceSignal: {
        profileId: "hum-1",
        profileKind: "human",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts submitTaskResult request", () => {
    const parsed = runtimeTransportSubmitTaskResultRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      dispatchId: "dispatch-1",
      executionIdentityEcho: createResultIdentityEcho(),
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      taskResult: {
        v: 1,
        code: "service.task_result",
        payload: {
          status: "success",
          taskId: "task-1",
          sourceEventId: "signal-1",
          agentId: "agent-1",
          deduped: false,
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "ctx-1",
          output: "ok",
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts RuntimeCoordinator queue intake claim decisions as evidence", () => {
    const claimDecisions = [
      "continue_existing",
      "reset_existing",
      "claim_recovery",
      "claim_existing_inside_window",
      "reclaim_stale_dispatching",
      "reclaim_stale_queued",
    ] as const;

    for (const claimDecision of claimDecisions) {
      const parsed =
        runtimeTransportRuntimeCoordinatorDecisionRequestSchema.safeParse({
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          claimDecision,
          dispatchId: "dispatch-1",
          eventKind:
            claimDecision === "claim_recovery" ||
            claimDecision === "claim_existing_inside_window"
              ? "retry"
              : "reclaim",
          idempotencyKey: `queue:dispatch-1:${claimDecision}`,
          reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
          runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
          spaceId: "space-1",
          sourceClientMessageId: null,
          targetProfileId: "agent-1",
          trigger: "queue",
        });

      expect(parsed.success).toBe(true);
    }
  });

  it("accepts RuntimeCoordinator target Wake head accept requests", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner-1",
        targetWakeLifecycleIdentity: identity,
      });

    expect(parsed.success).toBe(true);
  });

  it("keeps RuntimeCoordinator head admission compatible with the v1 wire", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadAcceptRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        executionTargetRevision: {
          agentControllerRef: "builtin:codex",
          bindingId: "binding-1",
          configurationRevision: 3,
        },
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner-1",
        targetWakeLifecycleIdentity: identity,
      });

    expect(parsed.success).toBe(false);
  });

  it("accepts RuntimeCoordinator head dedupe responses with a linked execution", () => {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema.safeParse({
        action: "skip_duplicate",
        ok: true,
        primaryDispatchId: "dispatch-1",
        reasonCode: "runtime_coordinator.head_execution_already_linked",
        runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
        status: "execution_linked",
        targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|7:agent-1",
      });

    expect(parsed.success).toBe(true);
  });

  it("accepts Agent Profile Work Coordinator queue responses", () => {
    expect(
      runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema.safeParse({
        action: "wait_in_queue",
        ok: true,
        primaryDispatchId: "dispatch-2",
        queuePosition: 1,
        reasonCode: "agent_profile_work_coordinator.queued",
        runtimeCoordinatorExecutionId: null,
        status: "queued",
        targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-2|7:agent-1",
        waitingCount: 1,
      }).success
    ).toBe(true);
  });

  it("accepts Agent Profile Work Coordinator full-queue responses", () => {
    expect(
      runtimeTransportRuntimeCoordinatorHeadAcceptResponseSchema.safeParse({
        ok: false,
        primaryDispatchId: null,
        reasonCode: "agent_profile_work_coordinator.queue_full",
        status: "queue_full",
        targetWakeLifecycleId: "twl_v1|7:space-1|9:signal-52|7:agent-1",
        waitingCount: 50,
      }).success
    ).toBe(true);
  });

  it("accepts a privacy-safe paused Agent Profile workload", () => {
    expect(
      runtimeTransportAgentProfileOperationalContextSchema.parse({
        currentWorkReference: {
          sourceSignalId: "signal-current",
          spaceId: "space-current",
        },
        queuedWorkReferences: [
          { sourceSignalId: "signal-next", spaceId: "space-next" },
        ],
        status: "paused",
        waitingCount: 1,
      })
    ).toEqual({
      currentWorkReference: {
        sourceSignalId: "signal-current",
        spaceId: "space-current",
      },
      queuedWorkReferences: [
        { sourceSignalId: "signal-next", spaceId: "space-next" },
      ],
      status: "paused",
      waitingCount: 1,
    });

    expect(
      runtimeTransportAgentProfileOperationalContextSchema.safeParse({
        gateReason: "usage_recovered",
        status: "paused",
        waitingCount: 0,
      }).success
    ).toBe(false);
  });

  it("accepts strict Agent Profile work recovery commands", () => {
    const firstProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const secondProfileId = "agt_22222222-2222-4222-8222-222222222222";
    expect(
      runtimeTransportAgentProfileWorkUsageAvailableRequestSchema.parse({
        ownerUserId: "owner-1",
        targetProfileIds: [firstProfileId, secondProfileId],
      })
    ).toEqual({
      ownerUserId: "owner-1",
      targetProfileIds: [firstProfileId, secondProfileId],
    });
    expect(
      runtimeTransportAgentProfileWorkUsageAvailableResponseSchema.parse({
        changedProfileIds: [firstProfileId],
        continuationProfileIds: [firstProfileId, secondProfileId],
        status: "updated",
      })
    ).toEqual({
      changedProfileIds: [firstProfileId],
      continuationProfileIds: [firstProfileId, secondProfileId],
      status: "updated",
    });
    expect(
      runtimeTransportAgentProfileWorkUsageAvailableResponseSchema.parse({
        changedProfileIds: [],
        status: "updated",
      })
    ).toEqual({
      changedProfileIds: [],
      continuationProfileIds: [],
      status: "updated",
    });
    expect(
      runtimeTransportAgentProfileWorkRecoveryReadResponseSchema.parse({
        action: "continue_interrupted_work",
        authorizedContinuationClientMessageId: null,
        interruptedClientMessageId: "client-interrupted",
        interruptedDispatchId: "dispatch-interrupted",
        interruptedTargetWakeLifecycleId: "wake-lifecycle-interrupted",
        spaceId: "space-interrupted",
        status: "available",
      })
    ).toEqual({
      action: "continue_interrupted_work",
      authorizedContinuationClientMessageId: null,
      interruptedClientMessageId: "client-interrupted",
      interruptedDispatchId: "dispatch-interrupted",
      interruptedTargetWakeLifecycleId: "wake-lifecycle-interrupted",
      spaceId: "space-interrupted",
      status: "available",
    });
    expect(
      runtimeTransportAgentProfileWorkRecoveryReadResponseSchema.parse({
        action: "continue_interrupted_work",
        authorizedContinuationClientMessageId: null,
        interruptedClientMessageId: "client-interrupted",
        interruptedDispatchId: "dispatch-interrupted",
        spaceId: "space-interrupted",
        status: "available",
      })
    ).toEqual({
      action: "continue_interrupted_work",
      authorizedContinuationClientMessageId: null,
      interruptedClientMessageId: "client-interrupted",
      interruptedDispatchId: "dispatch-interrupted",
      spaceId: "space-interrupted",
      status: "available",
    });
    expect(
      runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema.parse({
        continuationClientMessageId: "client-continuation-1",
        currentAgentControllerRef: "builtin:codex",
        currentBindingId: "binding-1",
        currentConfigurationRevision: 2,
        currentDefaultProjectId: "project-1",
        expectedInterruptedTargetWakeLifecycleId: "wake-lifecycle-interrupted",
        ownerUserId: "owner-1",
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: firstProfileId,
      })
    ).toEqual({
      continuationClientMessageId: "client-continuation-1",
      currentAgentControllerRef: "builtin:codex",
      currentBindingId: "binding-1",
      currentConfigurationRevision: 2,
      currentDefaultProjectId: "project-1",
      expectedInterruptedTargetWakeLifecycleId: "wake-lifecycle-interrupted",
      ownerUserId: "owner-1",
      requireAcceptedExecutionTargetRevision: true,
      targetProfileId: firstProfileId,
    });
    expect(
      runtimeTransportAgentProfileWorkContinuationAuthorizeResponseSchema.parse(
        { status: "needs_attention" }
      )
    ).toEqual({ status: "needs_attention" });
    expect(
      runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema.parse({
        continuationClientMessageId: "client-continuation-legacy",
        currentAgentControllerRef: "builtin:codex",
        currentBindingId: "binding-1",
        currentConfigurationRevision: 2,
        expectedInterruptedTargetWakeLifecycleId: "wake-lifecycle-interrupted",
        ownerUserId: "owner-1",
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: firstProfileId,
      })
    ).not.toHaveProperty("currentDefaultProjectId");
    expect(
      runtimeTransportAgentProfileWorkContinuationNeedsAttentionRequestSchema.parse(
        {
          expectedInterruptedTargetWakeLifecycleId:
            "wake-lifecycle-interrupted",
          ownerUserId: "owner-1",
          targetProfileId: firstProfileId,
        }
      )
    ).toEqual({
      expectedInterruptedTargetWakeLifecycleId: "wake-lifecycle-interrupted",
      ownerUserId: "owner-1",
      targetProfileId: firstProfileId,
    });
    expect(
      runtimeTransportAgentProfileWorkQueueApproveRequestSchema.parse({
        ownerUserId: "owner-1",
        targetProfileId: firstProfileId,
      })
    ).toEqual({ ownerUserId: "owner-1", targetProfileId: firstProfileId });
    expect(
      runtimeTransportAgentProfileWorkQueueApproveResponseSchema.parse({
        status: "approved",
      })
    ).toEqual({ status: "approved" });
    expect(
      runtimeTransportAgentProfileWorkContinuationAuthorizeRequestSchema.safeParse(
        {
          continuationClientMessageId: "client-continuation-1",
          ownerUserId: "owner-1",
          targetProfileId: firstProfileId,
          queuedTaskIds: ["private-task-1"],
        }
      ).success
    ).toBe(false);
  });

  it("accepts RuntimeCoordinator no-execution publication intent requests", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner-1",
        publicationCategory: "binding_required",
        reasonCode: "agent_profile_binding.missing",
        targetWakeLifecycleIdentity: identity,
        userRecoveryAction: "set_up_agent_binding",
      });

    expect(parsed.success).toBe(true);
  });

  it("accepts RuntimeCoordinator owner-mismatch no-execution publication intent requests", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-owner-mismatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-owner-mismatch-1",
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner-1",
        publicationCategory: "binding_required",
        reasonCode: "agent_profile_binding.owner_mismatch",
        targetWakeLifecycleIdentity: identity,
        userRecoveryAction: "repair_agent_binding",
      });

    expect(parsed.success).toBe(true);
  });

  it("accepts RuntimeCoordinator service-update no-execution publication intent requests", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-service-update-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        decisionSource: "dispatch_delivery_pre_execution",
        dispatchId: "dispatch-service-update-1",
        idempotencyKey: "signal-1::agent-1",
        ownerUserId: "owner-1",
        publicationCategory: "update_required",
        reasonCode: "service.update_required",
        targetWakeLifecycleIdentity: identity,
        userRecoveryAction: "update_openmeld_service",
      });

    expect(parsed.success).toBe(true);
  });

  it.each([
    {
      publicationCategory: "local_agent_unavailable",
      reasonCode: "controller.registry.disabled",
      userRecoveryAction: "enable_local_agent",
    },
    {
      publicationCategory: "provider_usage_unavailable",
      reasonCode: "usage_exhausted",
      userRecoveryAction: "wait_for_usage_reset",
    },
    {
      publicationCategory: "provider_usage_unavailable",
      reasonCode: "usage_checking",
      userRecoveryAction: "wait_for_usage_report",
    },
    {
      publicationCategory: "workspace_unavailable",
      reasonCode: "workspace.invalid",
      userRecoveryAction: "review_agent_settings",
    },
  ] as const)("accepts $reasonCode as an exact RuntimeCoordinator no-execution reason", ({
    publicationCategory,
    reasonCode,
    userRecoveryAction,
  }) => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-readiness-blocked-1",
      dispatchId: "dispatch-readiness-blocked-1",
      sourceSignalId: "signal-readiness-blocked-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    expect(
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        decisionSource: "dispatch_preflight",
        dispatchId: "dispatch-readiness-blocked-1",
        idempotencyKey: "signal-readiness-blocked-1::agent-1",
        ownerUserId: "owner-1",
        publicationCategory,
        reasonCode,
        targetWakeLifecycleIdentity: identity,
        userRecoveryAction,
      }).success
    ).toBe(true);
  });

  it("accepts RuntimeCoordinator head waiting boundary requests", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-offline-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-offline-1",
        idempotencyKey: "signal-1::agent-1",
        observedAtMs: 1_700_000_000_010,
        ownerUserId: "owner-1",
        reasonCode: "daemon.profile.offline",
        targetWakeLifecycleIdentity: identity,
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      });

    expect(parsed.success).toBe(true);
  });

  it("accepts RuntimeCoordinator head waiting boundary responses", () => {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema.safeParse({
        deadlineAtMs: 1_700_000_300_000,
        nextTriggerAtMs: 1_700_000_030_000,
        ok: true,
        primaryDispatchId: "dispatch-offline-1",
        reasonCode: "daemon.profile.offline",
        runtimeCoordinatorExecutionId: null,
        softDeadlineAtMs: 1_700_000_030_000,
        status: "waiting",
        targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|7:agent-1",
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      });

    expect(parsed.success).toBe(true);
  });

  it("keeps pending first-report waiting semantics distinct from service-offline recovery", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-pending-first-report-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    const request = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-pending-first-report-1",
      idempotencyKey: "signal-1::agent-1",
      observedAtMs: 1_700_000_000_010,
      ownerUserId: "owner-1",
      reasonCode: "daemon.profile.pending_first_report",
      targetWakeLifecycleIdentity: identity,
      userRecoveryAction: "wait_for_wake_route_report",
      waitingCategory: "wake_route_registration_pending",
    };

    expect(
      runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema.safeParse(
        request
      ).success
    ).toBe(true);
    expect(
      runtimeTransportRuntimeCoordinatorHeadWaitingResponseSchema.safeParse({
        deadlineAtMs: 1_700_000_300_000,
        nextTriggerAtMs: 1_700_000_030_000,
        ok: true,
        primaryDispatchId: "dispatch-pending-first-report-1",
        reasonCode: "daemon.profile.pending_first_report",
        runtimeCoordinatorExecutionId: null,
        softDeadlineAtMs: 1_700_000_030_000,
        status: "waiting",
        targetWakeLifecycleId: identity.targetWakeLifecycleId,
        userRecoveryAction: "wait_for_wake_route_report",
        waitingCategory: "wake_route_registration_pending",
      }).success
    ).toBe(true);
    expect(
      runtimeTransportRuntimeCoordinatorHeadWaitingRequestSchema.safeParse({
        ...request,
        userRecoveryAction: "start_or_restart_openmeld_service",
        waitingCategory: "service_not_connected",
      }).success
    ).toBe(false);
  });

  it("accepts legacy pre-execution handoff evidence-only responses", () => {
    const parsed = runtimeTransportPreExecutionHandoffResponseSchema.safeParse({
      deadlineAtMs: 1_700_000_030_000,
      ok: true,
      reasonCode: "daemon.profile.offline",
      status: "legacy_evidence_only",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts RuntimeCoordinator no-execution publication intent ready responses", () => {
    const parsed =
      runtimeTransportRuntimeCoordinatorHeadNoExecutionResponseSchema.safeParse(
        {
          ok: true,
          primaryDispatchId: "dispatch-1",
          publicationIntentId:
            "rcpi:no_execution:twl_v1|7:space-1|8:signal-1|7:agent-1",
          reasonCode: "agent_profile_binding.missing",
          runtimeCoordinatorExecutionId: null,
          status: "publication_intent_ready",
          targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|7:agent-1",
        }
      );

    expect(parsed.success).toBe(true);
  });

  it("accepts read-only RuntimeCoordinator head lifecycle trace responses", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const request =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceRequestSchema.safeParse(
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          targetWakeLifecycleIdentity: identity,
        }
      );
    expect(request.success).toBe(true);

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema.safeParse(
        {
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
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: {
              intentId:
                "rcpi:no_execution:twl_v1|7:space-1|8:signal-1|7:agent-1",
              kind: "no_execution_failure",
              publicationCategory: "binding_required",
              readyAtMs: 1_700_000_000_002,
              reasonCode: "agent_profile_binding.missing",
              status: "ready_for_phase_6",
              userRecoveryAction: "set_up_agent_binding",
            },
            runtimeCoordinatorExecutionId: null,
            status: "publication_intent_ready",
            targetWakeLifecycleIdentity: identity,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_000_002,
            waitingBoundary: null,
          },
        }
      );

    expect(parsed.success).toBe(true);
  });

  it("accepts pre-agent RuntimeCoordinator head Stop contracts", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    expect(
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopRequestSchema.safeParse(
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          ownerUserId: "owner-1",
          dispatchId: "dispatch-1",
          idempotencyKey: "wake-stop:dispatch-1",
          reason: "User stopped this Wake.",
          targetWakeLifecycleIdentity: identity,
        }
      ).success
    ).toBe(true);

    expect(
      runtimeTransportRuntimeCoordinatorHeadPreAgentStopResponseSchema.safeParse(
        {
          ok: true,
          primaryDispatchId: "dispatch-1",
          publicationIntentId:
            "rcpi:stopped:twl_v1|7:space-1|8:signal-1|7:agent-1",
          reasonCode: "runtime_coordinator.pre_agent_stop_requested",
          runtimeCoordinatorExecutionId: null,
          status: "stopped_before_execution",
          targetWakeLifecycleId: identity.targetWakeLifecycleId,
        }
      ).success
    ).toBe(true);
  });

  it("accepts stopped-before-execution RuntimeCoordinator head trace responses", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema.safeParse(
        {
          ok: true,
          readStatus: "found",
          lifecycle: {
            createdAtMs: 1_700_000_000_000,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: null,
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-1",
            publicationIntent: {
              intentId: "rcpi:stopped:twl_v1|7:space-1|8:signal-1|7:agent-1",
              kind: "stopped_notice",
              readyAtMs: 1_700_000_000_002,
              reasonCode: "runtime_coordinator.pre_agent_stop_requested",
              status: "ready_for_phase_6",
            },
            runtimeCoordinatorExecutionId: null,
            status: "stopped_before_execution",
            targetWakeLifecycleIdentity: identity,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_000_002,
            waitingBoundary: null,
          },
        }
      );

    expect(parsed.success).toBe(true);
  });

  it("accepts read-only RuntimeCoordinator head waiting lifecycle trace responses", () => {
    const identity = projectTargetWakeLifecycleIdentity({
      clientMessageId: "client-message-1",
      dispatchId: "dispatch-offline-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    const parsed =
      runtimeTransportRuntimeCoordinatorHeadLifecycleTraceResponseSchema.safeParse(
        {
          ok: true,
          readStatus: "found",
          lifecycle: {
            createdAtMs: 1_700_000_000_000,
            duplicateDispatchCount: 0,
            executionLinkedAtMs: null,
            modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
            noExecutionDecision: null,
            ownerUserId: "owner-1",
            primaryDispatchId: "dispatch-offline-1",
            publicationIntent: null,
            runtimeCoordinatorExecutionId: null,
            status: "waiting",
            targetWakeLifecycleIdentity: identity,
            targetWakeLifecycleId: identity.targetWakeLifecycleId,
            updatedAtMs: 1_700_000_000_010,
            waitingBoundary: {
              deadlineAtMs: 1_700_000_300_000,
              deadlineOutcome: "publication_intent_ready",
              observedAtMs: 1_700_000_000_010,
              reasonCode: "daemon.profile.offline",
              softDeadlineAtMs: 1_700_000_030_000,
              trigger: "openmeld_service_route_connected",
              triggerOwner: "runtime_coordinator",
              userRecoveryAction: "start_or_restart_openmeld_service",
              userVisibleState: "waiting_for_openmeld_service",
              waitingCategory: "service_not_connected",
              waitingFor: "openmeld_service_route_connection",
              waitingSinceMs: 1_700_000_000_000,
            },
          },
        }
      );

    expect(parsed.success).toBe(true);
  });

  it("accepts dispatch preview request", () => {
    const parsed = runtimeTransportDispatchPreviewRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      previewText: "preview text",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts privacy-bounded dispatch tool activity with execution authority echoes", () => {
    const parsed = runtimeTransportDispatchToolActivityRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      sequence: 1,
      observedAtMs: 1_700_000_000_100,
      taskId: "task-1",
      spaceId: "space-1",
      sourceSignalId: "signal-1",
      targetProfileId: "agent-1",
      part: {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "agent_run_command",
        state: "input-available",
        work: {
          v: 1,
          key: "repository.clone",
          subject: {
            kind: "repository",
            label: "amplifthq/reply",
          },
        },
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts an authorized dispatch interaction request and delivery lifecycle", () => {
    const interaction = {
      v: 1 as const,
      interactionId: "interaction-1",
      requestedAtMs: 1_700_000_000_100,
      expiresAtMs: 1_700_028_800_100,
      kind: "permission" as const,
      title: "Allow this command?",
      subject: {
        type: "command" as const,
        command: "pnpm test",
        cwd: "/workspace",
      },
      options: [
        {
          optionId: "accept",
          label: "Allow once",
          intent: "allow_once" as const,
        },
        {
          optionId: "decline",
          label: "Deny",
          intent: "deny" as const,
        },
      ],
    };
    const authority = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
    };

    expect(
      runtimeTransportDispatchInteractionRequestSchema.safeParse({
        ...authority,
        taskId: "task-1",
        interaction,
      }).success
    ).toBe(true);
    expect(
      runtimeTransportDispatchInteractionResponseFramePayloadSchema.safeParse({
        runtimeCoordinatorExecutionId: authority.runtimeCoordinatorExecutionId,
        dispatchId: authority.dispatchId,
        attemptId: authority.attemptId,
        interactionId: interaction.interactionId,
        response: {
          kind: "permission",
          optionId: "accept",
        },
        respondedAtMs: 1_700_000_000_200,
      }).success
    ).toBe(true);
    expect(
      runtimeTransportDispatchInteractionDeliveredRequestSchema.safeParse({
        ...authority,
        interactionId: interaction.interactionId,
        deliveredAtMs: 1_700_000_000_300,
      }).success
    ).toBe(true);
  });

  it("requires execution authority for dispatch interactions", () => {
    const parsed = runtimeTransportDispatchInteractionRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      taskId: "task-1",
      interaction: {
        v: 1,
        interactionId: "interaction-1",
        requestedAtMs: 1_700_000_000_100,
        expiresAtMs: 1_700_028_800_100,
        kind: "question",
        title: "Choose a target",
        questions: [
          {
            questionId: "target",
            prompt: "Which target should I use?",
            options: [],
            multiple: false,
            allowOther: true,
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("supports owner-scoped interaction reads and responses", () => {
    const pendingInteraction = {
      interactionId: "interaction-1",
      kind: "plan_review" as const,
      requestedAtMs: 1_700_000_000_100,
      expiresAtMs: 1_700_028_800_100,
      canRespond: true,
      request: {
        v: 1 as const,
        interactionId: "interaction-1",
        requestedAtMs: 1_700_000_000_100,
        expiresAtMs: 1_700_028_800_100,
        kind: "plan_review" as const,
        title: "Review the plan",
        plan: "1. Inspect the code\n2. Make the change",
        allowFeedback: true,
      },
    };

    expect(
      runtimeTransportRuntimeCoordinatorReadInteractionResponseSchema.safeParse(
        {
          pendingInteraction,
        }
      ).success
    ).toBe(true);
    expect(
      runtimeTransportRuntimeCoordinatorRespondInteractionRequestSchema.safeParse(
        {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          actorOwnerUserId: "owner-1",
          runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
          interactionId: "interaction-1",
          response: {
            kind: "plan_review",
            action: "request_changes",
            feedback: "Keep the public API stable.",
          },
        }
      ).success
    ).toBe(true);
  });

  it("rejects private tool input and output from dispatch tool activity", () => {
    const parsed = runtimeTransportDispatchToolActivityRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      sequence: 1,
      observedAtMs: 1_700_000_000_100,
      taskId: "task-1",
      spaceId: "space-1",
      sourceSignalId: "signal-1",
      targetProfileId: "agent-1",
      part: {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "agent_run_command",
        state: "output-available",
        input: { command: "private command" },
        output: "private output",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects provider-specific tool names from dispatch tool activity", () => {
    const parsed = runtimeTransportDispatchToolActivityRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      sequence: 1,
      observedAtMs: 1_700_000_000_100,
      taskId: "task-1",
      spaceId: "space-1",
      sourceSignalId: "signal-1",
      targetProfileId: "agent-1",
      part: {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "Bash",
        state: "input-available",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts dispatch lifecycle local queue diagnostics", () => {
    const parsed = runtimeTransportDispatchLifecycleRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      phase: "accepted_local",
      lifecycleAtMs: 1_700_000_000_000,
      localQueue: {
        activeForLane: 1,
        activeGlobal: 2,
        globalConcurrency: 5,
        queueDepth: 1,
        queueMax: 50,
        queuePosition: 1,
        status: "queued",
        waitReason: "local_execution_lane_concurrency",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts only versioned Agent Controller conversation occupancy on lifecycle evidence", () => {
    const base = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      executionTokenEcho: createExecutionTokenEcho(),
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      phase: "running",
      lifecycleAtMs: 1_700_000_000_000,
    } as const;
    expect(
      runtimeTransportDispatchLifecycleRequestSchema.safeParse({
        ...base,
        agentControllerConversationOccupancy: {
          agentControllerConversationId: "thread-1",
          contractVersion: 1,
          state: "occupied",
        },
      }).success
    ).toBe(true);
    expect(
      runtimeTransportDispatchLifecycleRequestSchema.safeParse({
        ...base,
        agentControllerConversationOccupancy: {
          agentControllerConversationId: "thread-1",
          contractVersion: 2,
          state: "occupied",
        },
      }).success
    ).toBe(false);
  });

  it("accepts dispatch preview end request with target profile name", () => {
    const parsed = runtimeTransportDispatchPreviewEndRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      attemptId: "attempt-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      targetProfileName: "Demo Bot",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts dispatch runtime evidence request", () => {
    const parsed =
      runtimeTransportDispatchRuntimeEvidenceRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        leaseEpoch: 2,
        phase: "runtime_started",
        evidenceAtMs: 1_700_000_000_123,
        taskId: "task-1",
        spaceId: "space-1",
        sourceSignalId: "signal-1",
        sourceClientMessageId: "client-message-1",
        targetProfileId: "agent-1",
        durationMs: 42,
      });

    expect(parsed.success).toBe(true);
  });

  it("rejects legacy optional identity fields on dispatch runtime evidence", () => {
    const parsed =
      runtimeTransportDispatchRuntimeEvidenceRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        dispatchId: "dispatch-1",
        attemptId: "attempt-1",
        executionIdentityEcho: createRuntimeEvidenceIdentityEcho(),
        daemonSessionId: "session-1",
        connectionGeneration: 1,
        leaseEpoch: 2,
        phase: "runtime_started",
        evidenceAtMs: 1_700_000_000_123,
        taskId: "task-1",
        spaceId: "space-1",
        sourceSignalId: "signal-1",
        targetProfileId: "agent-1",
        openMeldServiceRuntimeId: "runtime-1",
      });

    expect(parsed.success).toBe(false);
  });

  it("requires result identity echo on submitTaskResult requests", () => {
    const parsed = runtimeTransportSubmitTaskResultRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: 2,
      taskResult: {
        v: 1,
        code: "service.task_result",
        payload: {
          status: "success",
          taskId: "task-1",
          sourceEventId: "signal-1",
          agentId: "agent-1",
          deduped: false,
          agentControllerRef: "builtin:codex",
          agentControllerConversationId: "ctx-1",
          output: "ok",
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts daemon stream frame with dispatch runtime evidence code", () => {
    const parsed = daemonStreamFrameSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: "daemon.dispatch.runtime_evidence",
      payload: {
        dispatchId: "dispatch-1",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects submitTaskResult when leaseEpoch is not number", () => {
    const parsed = runtimeTransportSubmitTaskResultRequestSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      dispatchId: "dispatch-1",
      executionIdentityEcho: createResultIdentityEcho(),
      daemonSessionId: "session-1",
      connectionGeneration: 1,
      leaseEpoch: "2",
      taskResult: {
        v: 1,
        code: "service.task_result",
        payload: {
          status: "failed",
          taskId: "task-1",
          sourceEventId: "signal-1",
          agentId: "agent-1",
          deduped: false,
          errorType: "internal",
        },
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts daemon stream frame", () => {
    const parsed = daemonStreamFrameSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: "daemon.dispatch.result",
      payload: {
        dispatchId: "dispatch-1",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects unknown daemon error code", () => {
    const parsed = runtimeTransportErrorCodeSchema.safeParse("daemon.unknown");
    expect(parsed.success).toBe(false);
  });

  it("accepts daemon stream error frame with known payload code", () => {
    const parsed = daemonStreamErrorFrameSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: "daemon.error",
      payload: {
        code: "daemon.profile.offline",
        message: "profile is offline",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects daemon stream error frame with unknown payload code", () => {
    const parsed = daemonStreamErrorFrameSchema.safeParse({
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      code: "daemon.error",
      payload: {
        code: "daemon.unknown",
        message: "bad",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps legacy local agent control capabilities valid without cancel", () => {
    const result = runtimeTransportCapabilitiesSchema.safeParse({
      localAgentControl: {
        setEnabled: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts explicit local agent interaction capability", () => {
    const result = runtimeTransportCapabilitiesSchema.safeParse({
      localAgentInteraction: true,
    });

    expect(result.success).toBe(true);
  });

  it("accepts local agent control cancel capability when the service supports it", () => {
    const result = runtimeTransportCapabilitiesSchema.safeParse({
      localAgentControl: {
        cancel: true,
        interrupt: true,
        manageInstallations: true,
        manageInstallationsSafely: true,
        refreshCatalog: true,
        setEnabled: true,
        setProfileWorkspace: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts owner installation list and selection control payloads", () => {
    const request = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      ownerUserId: "owner-1",
      deviceId: "device-1",
      lane: "dev-local" as const,
      request: {
        agentId: "claude-code",
        operation: "select" as const,
        installationId: "install-homebrew",
      },
    };
    expect(
      runtimeTransportManageLocalAgentInstallationRequestSchema.safeParse(
        request
      ).success
    ).toBe(true);
    expect(
      runtimeTransportLocalAgentControlManageInstallationFramePayloadSchema.safeParse(
        {
          requestId: "install-1",
          payload: request.request,
        }
      ).success
    ).toBe(true);

    const payload = {
      accepted: true as const,
      agentControllerRef: "builtin:claude-code",
      agentId: "claude-code",
      changed: true,
      installations: [
        {
          details: "Claude Code installed with Homebrew",
          installationId: "install-homebrew",
          name: "Homebrew installation",
          selected: true,
        },
      ],
      reportSyncStatus: "submitted" as const,
      selectionStatus: "available" as const,
      selectedInstallationId: "install-homebrew",
      status: "updated" as const,
    };
    expect(
      runtimeTransportLocalAgentControlResultFramePayloadSchema.safeParse({
        requestId: "install-1",
        payload,
      }).success
    ).toBe(true);
    expect(
      runtimeTransportManageLocalAgentInstallationResponseSchema.safeParse({
        status: "accepted",
        payload,
      }).success
    ).toBe(true);
  });

  it("accepts OpenMeld Tools control capability, requests, and results", () => {
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        openMeldToolsControl: {
          requestAutomaticUpdate: true,
          requestUpdate: true,
          setAutomaticUpdates: true,
        },
      }).success
    ).toBe(true);
    expect(
      runtimeTransportCapabilitiesSchema.safeParse({
        openMeldToolsControl: {
          requestUpdate: true,
          setAutomaticUpdates: true,
        },
      }).success
    ).toBe(true);

    const request = {
      v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
      deviceId: "device-1",
      lane: "dev-local" as const,
      ownerUserId: "owner-1",
      requestId: "tools-1",
      request: {
        operation: "request_update" as const,
        requestSource: "web" as const,
      },
    };
    expect(
      runtimeTransportOpenMeldToolsControlRequestSchema.safeParse(request)
        .success
    ).toBe(true);
    expect(
      runtimeTransportOpenMeldToolsControlRequestSchema.safeParse({
        ...request,
        request: {
          operation: "request_update",
          requestSource: "automatic",
        },
      }).success
    ).toBe(true);
    expect(
      runtimeTransportOpenMeldToolsControlFramePayloadSchema.safeParse({
        requestId: request.requestId,
        request: request.request,
      }).success
    ).toBe(true);

    const result = {
      operation: "request_update" as const,
      result: { currentVersion: "0.9.1", status: "current" as const },
    };
    expect(
      runtimeTransportOpenMeldToolsControlResultFramePayloadSchema.safeParse({
        requestId: request.requestId,
        result,
      }).success
    ).toBe(true);
    expect(
      runtimeTransportOpenMeldToolsControlResponseSchema.safeParse({
        status: "accepted",
        result,
      }).success
    ).toBe(true);
  });

  it("accepts refresh-catalog local agent control request and result payloads", () => {
    expect(
      runtimeTransportRefreshLocalAgentCatalogRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: "owner-1",
        deviceId: "device-1",
        lane: "dev-local",
        reason: "settings_manual_check",
      }).success
    ).toBe(true);
    expect(
      runtimeTransportLocalAgentControlRefreshCatalogFramePayloadSchema.safeParse(
        {
          requestId: "refresh-1",
          payload: {
            reason: "settings_manual_check",
          },
        }
      ).success
    ).toBe(true);
    expect(
      runtimeTransportLocalAgentControlResultFramePayloadSchema.safeParse({
        requestId: "refresh-1",
        payload: {
          accepted: true,
          profileIds: ["agt_00000000-0000-4000-8000-000000000001"],
          syncStatus: "unchanged",
        },
      }).success
    ).toBe(true);
    expect(
      runtimeTransportRefreshLocalAgentCatalogResponseSchema.safeParse({
        status: "accepted",
        payload: {
          accepted: true,
          profileIds: ["agt_00000000-0000-4000-8000-000000000001"],
          syncStatus: "unchanged",
        },
      }).success
    ).toBe(true);
  });

  it("accepts set-profile-workspace local agent control request and result payloads", () => {
    const targetProfileId = "agt_00000000-0000-4000-8000-000000000001";
    const workspacePath = "/Users/felix/Desktop/work/openmeld";

    expect(
      runtimeTransportSetProfileWorkspaceRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: "owner-1",
        deviceId: "device-1",
        lane: "dev-local",
        targetProfileId,
        workspaceMode: "custom",
        workspacePath,
      }).success
    ).toBe(true);
    expect(
      runtimeTransportLocalAgentControlSetProfileWorkspaceFramePayloadSchema.safeParse(
        {
          requestId: "workspace-1",
          payload: {
            targetProfileId,
            workspaceMode: "custom",
            workspacePath,
          },
        }
      ).success
    ).toBe(true);
    expect(
      runtimeTransportLocalAgentControlResultFramePayloadSchema.safeParse({
        requestId: "workspace-1",
        payload: {
          accepted: true,
          targetProfileId,
          status: "updated",
          workspaceMode: "custom",
          workspacePath,
        },
      }).success
    ).toBe(true);
    expect(
      runtimeTransportSetProfileWorkspaceResponseSchema.safeParse({
        status: "accepted",
        payload: {
          accepted: true,
          targetProfileId,
          status: "updated",
          workspaceMode: "custom",
          workspacePath,
        },
      }).success
    ).toBe(true);
  });

  it("accepts cancel frames with a RuntimeCoordinator execution authority echo", () => {
    const result =
      runtimeTransportLocalAgentControlCancelFramePayloadSchema.safeParse({
        requestId: "wake-stop-request-1",
        payload: {
          runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
          target: {
            by: "dispatch",
            dispatchId: "dispatch-1",
          },
          reason: "user_requested_stop",
        },
      });

    expect(result.success).toBe(true);
  });

  it("accepts interrupt frames with a RuntimeCoordinator execution authority echo", () => {
    const result =
      runtimeTransportLocalAgentControlInterruptFramePayloadSchema.safeParse({
        requestId: "wake-stop-request-1",
        payload: {
          mode: "force",
          reason: "user_requested_stop",
          runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
          target: {
            by: "dispatch",
            dispatchId: "dispatch-1",
          },
        },
      });

    expect(result.success).toBe(true);
  });

  it("accepts cancel results with resolved RuntimeCoordinator execution identity", () => {
    const result =
      runtimeTransportLocalAgentControlResultFramePayloadSchema.safeParse({
        requestId: "wake-stop-request-1",
        payload: {
          accepted: true,
          resolvedDispatchId: "dispatch-1",
          resolvedRuntimeCoordinatorExecutionId:
            "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
          resolvedTaskId: "task-1",
          reasonCode: "adapter.cancel.accepted",
          target: {
            by: "dispatch",
            dispatchId: "dispatch-1",
          },
        },
      });

    expect(result.success).toBe(true);
  });

  it("accepts interrupt results with resolved RuntimeCoordinator execution identity", () => {
    const result =
      runtimeTransportLocalAgentControlResultFramePayloadSchema.safeParse({
        requestId: "wake-stop-request-1",
        payload: {
          accepted: true,
          resolvedDispatchId: "dispatch-1",
          resolvedRuntimeCoordinatorExecutionId:
            "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
          resolvedTaskId: "task-1",
          reasonCode: "adapter.interrupt.accepted",
          target: {
            by: "dispatch",
            dispatchId: "dispatch-1",
          },
        },
      });

    expect(result.success).toBe(true);
  });

  it("accepts RuntimeCoordinator Wake Stop requests resolved from Space selectors", () => {
    const result =
      runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: "user-1",
        runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
        sourceClientMessageId: "msg_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
        targetProfileId: "profile-1",
        reason: "user_requested_stop",
      });

    expect(result.success).toBe(true);
  });

  it("accepts RuntimeCoordinator Wake Stop requests with explicit legacy null source client message scope", () => {
    const result =
      runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: "user-1",
        runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
        sourceClientMessageId: null,
        targetProfileId: "profile-1",
      });

    expect(result.success).toBe(true);
  });

  it("rejects RuntimeCoordinator Wake Stop requests without source client message scope", () => {
    const result =
      runtimeTransportRuntimeCoordinatorWakeStopRequestSchema.safeParse({
        v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
        ownerUserId: "user-1",
        runtimeCoordinatorExecutionId: "rce_01HZX6ZAQ2JX1K7K3X3HYD6P8C",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
        targetProfileId: "profile-1",
      });

    expect(result.success).toBe(false);
  });

  it("reuses the strict Space Wake Stop response invariant", () => {
    const result =
      runtimeTransportRuntimeCoordinatorWakeStopResponseSchema.safeParse({
        ok: true,
        runtimeCoordinatorExecutionId: null,
        status: "cancellation_requested",
        targetProfileId: "profile-1",
        cancellationState: {
          requestedAtMs: 1,
          reasonCode: "runtime_coordinator.wake_stop_requested",
          status: "requested",
        },
      });

    expect(result.success).toBe(false);
  });
});
