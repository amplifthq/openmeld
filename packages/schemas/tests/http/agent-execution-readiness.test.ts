import { describe, expect, it } from "vitest";
import {
  agentExecutionReadinessRouteParamsSchema,
  agentExecutionReadinessSchema,
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  getAgentExecutionReadinessBatchBodySchema,
  getAgentExecutionReadinessBatchResponseSchema,
  getAgentExecutionReadinessResponseSchema,
} from "../../src/schemas";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("agent execution readiness http schemas", () => {
  it("accepts native runtime facts without workstation readiness evidence", () => {
    const readiness = readyExecutionReadiness();

    const parsed = agentExecutionReadinessSchema.parse({
      ...readiness,
      displayState: "not_ready",
      facts: {
        ...readiness.facts,
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: [],
          source: "not_checked",
        },
        route: {
          deviceId: null,
          lane: null,
          observedAt: "2026-05-10T00:00:00.000Z",
          online: false,
          reasonCodes: ["remote_agent.worker_unavailable"],
          source: "hosted_route",
        },
        runtime: {
          ready: false,
          reasonCodes: ["remote_agent.worker_unavailable"],
          source: "native_runtime",
        },
        service: {
          executionCompatible: true,
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: null,
          reasonCodes: [],
          source: "not_checked",
        },
      },
      primaryAction: "check_status",
    });

    expect(parsed.facts.route.source).toBe("hosted_route");
    expect(parsed.facts.runtime.source).toBe("native_runtime");
    expect(parsed.primaryAction).toBe("check_status");
  });

  it("accepts the canonical Core Agent Execution Readiness response", () => {
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: readyExecutionReadiness(),
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: enabledPrimaryBinding(),
      primaryActionPlan: {
        action: "none",
        target: null,
      },
      profileName: "Codex",
      publicProfileConfiguration: {
        agentControllerCollaborationMode: "codex:default",
        agentControllerPermissionMode: "codex:askForApproval",
        agentControllerRef: "builtin:codex",
        modelSelection: {
          modelId: "gpt-5.5",
          reasoningLevel: "high",
        },
      },
      agentWakeAvailability: buildAgentWakeAvailability("available_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.agentExecutionReadiness.displayState).toBe("ready");
    expect(parsed.agentExecutionReadiness.reasonCodes).toEqual([
      "agent_execution.ready",
    ]);
    expect(parsed.publicProfileConfiguration?.agentControllerRef).toBe(
      "builtin:codex"
    );
  });

  it("accepts a response without the compatibility-added primary binding field", () => {
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: readyExecutionReadiness(),
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryActionPlan: {
        action: "none",
        target: null,
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("available_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.primaryBinding).toBeUndefined();
  });

  it("rejects blank reason codes", () => {
    const parsed = getAgentExecutionReadinessResponseSchema.safeParse({
      agentExecutionReadiness: {
        ...readyExecutionReadiness(),
        reasonCodes: [""],
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "none",
        target: null,
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("available_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.success).toBe(false);
  });

  it("requires a primary repair action", () => {
    const parsed = getAgentExecutionReadinessResponseSchema.safeParse({
      agentExecutionReadiness: {
        ...readyExecutionReadiness(),
        primaryAction: undefined,
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "none",
        target: null,
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("available_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts the OpenMeld Service update primary repair action", () => {
    const baseReadiness = readyExecutionReadiness();
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: {
        ...baseReadiness,
        displayState: "not_ready",
        facts: {
          ...baseReadiness.facts,
          service: {
            executionCompatible: false,
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: null,
            reasonCodes: [
              "service.update_required",
              "daemon.runtime_contract.missing",
            ],
            source: "runtime_transport",
          },
        },
        primaryAction: "update_service",
        reasonCodes: [
          "service.update_required",
          "daemon.runtime_contract.missing",
        ],
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "update_service",
        target: {
          kind: "openmeld_service",
        },
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("unavailable_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.agentExecutionReadiness.primaryAction).toBe("update_service");
    expect(parsed.primaryActionPlan).toEqual({
      action: "update_service",
      target: {
        kind: "openmeld_service",
      },
    });
  });

  it("accepts the OpenMeld Service connection primary repair action", () => {
    const baseReadiness = readyExecutionReadiness();
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: {
        ...baseReadiness,
        displayState: "not_ready",
        facts: {
          ...baseReadiness.facts,
          localService: {
            reachable: false,
            refreshable: false,
            reasonCodes: ["local_service.not_connected_for_account"],
            source: "runtime_transport",
          },
        },
        primaryAction: "connect_service",
        reasonCodes: ["local_service.not_connected_for_account"],
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "route.not_registered",
        status: "offline",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "connect_service",
        target: {
          kind: "openmeld_service_connection",
        },
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("offline_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.agentExecutionReadiness.primaryAction).toBe(
      "connect_service"
    );
    expect(parsed.primaryActionPlan).toEqual({
      action: "connect_service",
      target: {
        kind: "openmeld_service_connection",
      },
    });
  });

  it("accepts the profile Binding reconnect action target", () => {
    const baseReadiness = readyExecutionReadiness();
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: {
        ...baseReadiness,
        displayState: "blocked",
        facts: {
          ...baseReadiness.facts,
          binding: {
            reasonCodes: ["agent_profile_binding.missing"],
            routable: false,
            source: "missing",
          },
        },
        primaryAction: "reconnect_binding",
        reasonCodes: ["agent_profile_binding.missing"],
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "reconnect_binding",
        target: {
          agentControllerRef: "builtin:codex",
          kind: "local_agent_connection",
        },
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("unavailable_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.primaryActionPlan).toEqual({
      action: "reconnect_binding",
      target: {
        agentControllerRef: "builtin:codex",
        kind: "local_agent_connection",
      },
    });
  });

  it("accepts Codex provider account attention readiness", () => {
    const baseReadiness = readyExecutionReadiness();
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: {
        ...baseReadiness,
        displayState: "blocked",
        facts: {
          ...baseReadiness.facts,
          providerAccount: {
            blocked: true,
            expiresAtMs: 1_770_003_600_000,
            observedAtMs: 1_770_000_000_000,
            provider: "codex",
            reasonCodes: ["provider_account.subscription_access_unavailable"],
            source: "wake_failure",
          },
        },
        primaryAction: "fix_provider_account",
        reasonCodes: ["provider_account.subscription_access_unavailable"],
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "fix_provider_account",
        target: {
          kind: "provider_account",
          provider: "codex",
        },
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("unavailable_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.agentExecutionReadiness.primaryAction).toBe(
      "fix_provider_account"
    );
    expect(parsed.primaryActionPlan).toEqual({
      action: "fix_provider_account",
      target: {
        kind: "provider_account",
        provider: "codex",
      },
    });
  });

  it("accepts Core readiness impact from a recent Wake failure", () => {
    const baseReadiness = readyExecutionReadiness();
    const parsed = getAgentExecutionReadinessResponseSchema.parse({
      agentExecutionReadiness: {
        ...baseReadiness,
        displayState: "blocked",
        facts: {
          ...baseReadiness.facts,
          readinessImpact: {
            blocked: true,
            expiresAtMs: 1_770_001_800_000,
            impactKind: "local_execution",
            observedAtMs: 1_770_000_000_000,
            reasonCodes: ["controller.client.upgrade_required"],
            source: "wake_failure",
          },
        },
        primaryAction: "run_prepare",
        reasonCodes: ["controller.client.upgrade_required"],
      },
      agentProfileId: AGENT_PROFILE_ID,
      agentControllerRef: "builtin:codex",
      wakeRouteEvidence: {
        observedAt: "2026-05-10T00:00:00.000Z",
        reasonCode: "online",
        status: "online",
      },
      wakeRouteStatus: buildWakeRouteStatus("ready"),
      generatedAt: "2026-05-10T00:00:00.000Z",
      ownerUserId: "owner-1",
      primaryBinding: null,
      primaryActionPlan: {
        action: "run_prepare",
        target: {
          kind: "current_computer",
        },
      },
      profileName: "Codex",
      agentWakeAvailability: buildAgentWakeAvailability("unavailable_for_wake"),
      agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
      routeDeviceId: "device-1",
      routeLane: "dev-local",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
    });

    expect(parsed.agentExecutionReadiness.facts.readinessImpact).toEqual({
      blocked: true,
      expiresAtMs: 1_770_001_800_000,
      impactKind: "local_execution",
      observedAtMs: 1_770_000_000_000,
      reasonCodes: ["controller.client.upgrade_required"],
      source: "wake_failure",
    });
    expect(parsed.agentExecutionReadiness.primaryAction).toBe("run_prepare");
  });

  it("validates Agent Profile route params", () => {
    expect(
      agentExecutionReadinessRouteParamsSchema.safeParse({
        agentProfileId: AGENT_PROFILE_ID,
      }).success
    ).toBe(true);
    expect(
      agentExecutionReadinessRouteParamsSchema.safeParse({
        agentProfileId: "not-a-profile",
      }).success
    ).toBe(false);
  });

  it("accepts a batch request and response", () => {
    const body = getAgentExecutionReadinessBatchBodySchema.parse({
      agentProfileIds: [AGENT_PROFILE_ID],
    });
    const response = getAgentExecutionReadinessBatchResponseSchema.parse({
      items: [
        {
          agentExecutionReadiness: readyExecutionReadiness(),
          agentProfileId: AGENT_PROFILE_ID,
          agentControllerRef: "builtin:codex",
          wakeRouteEvidence: {
            observedAt: "2026-05-10T00:00:00.000Z",
            reasonCode: "online",
            status: "online",
          },
          wakeRouteStatus: buildWakeRouteStatus("ready"),
          generatedAt: "2026-05-10T00:00:00.000Z",
          ownerUserId: "owner-1",
          primaryBinding: null,
          primaryActionPlan: {
            action: "none",
            target: null,
          },
          profileName: "Codex",
          agentWakeAvailability:
            buildAgentWakeAvailability("available_for_wake"),
          agentWakeRouteRegistration: buildAgentWakeRouteRegistration(),
          routeDeviceId: "device-1",
          routeLane: "dev-local",
          runtimeDeviceDisplayName: "Felix's MacBook Pro",
        },
      ],
    });

    expect(body.agentProfileIds).toEqual([AGENT_PROFILE_ID]);
    expect(response.items).toHaveLength(1);
  });
});

function buildAgentWakeAvailability(
  status:
    | "available_for_wake"
    | "checking_connection"
    | "offline_for_wake"
    | "unavailable_for_wake"
) {
  const availability = {
    available_for_wake: {
      action: "none",
      badgeLabel: "Available",
      category: "available",
      isRefreshing: false,
      label: "Available for Wake",
      phase: "available",
      reasonCode: "agent_execution.ready",
      status,
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    },
    checking_connection: {
      action: "check_status",
      badgeLabel: "Checking",
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_status",
      reasonCode: "agent_execution.check_status",
      status,
      summary: "Checking this agent's Wake availability.",
      tooltip: "Checking Wake availability",
    },
    offline_for_wake: {
      action: "connect_service",
      badgeLabel: "Offline",
      category: "offline",
      isRefreshing: false,
      label: "Offline for Wake",
      phase: "service_not_connected",
      reasonCode: "service.not_running",
      status,
      summary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      tooltip: "OpenMeld Service is not connected on this computer.",
    },
    unavailable_for_wake: {
      action: "reconnect_binding",
      badgeLabel: "Connect",
      category: "unavailable",
      isRefreshing: false,
      label: "Connect local agent",
      phase: "connect_local_agent",
      reasonCode: "agent_profile_binding.missing",
      status,
      summary: "Connect a local agent before this profile can reply.",
      tooltip: "Connect local agent",
    },
  } as const;

  return availability[status];
}

function buildWakeRouteStatus(status: "ready" | "offline" = "ready") {
  if (status === "offline") {
    return { status: "offline" } as const;
  }

  return {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    lastHeartbeatMs: 1_770_000_000_000,
    leaseEpoch: 1,
    status: "ready",
  } as const;
}

function enabledPrimaryBinding() {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    authoritySource: "binding_truth",
    bindingId: "binding-1",
    bindingState: "enabled_primary",
    dispatchEligibility: {
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      status: "routable",
    },
    grantsClaimSuccess: false,
    agentControllerPermissionMode: "codex:askForApproval",
    modelSelection: {
      modelId: "gpt-5",
      reasoningLevel: "medium",
    },
    reasonCodes: ["agent_profile_binding.enabled_primary"],
    resolutionSource: "binding_truth",
    routable: true,
    executionTarget: {
      agentControllerConversationId: "conversation-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
    },
  };
}

function readyExecutionReadiness() {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    displayState: "ready",
    facts: {
      profile: {
        active: true,
        reasonCodes: [],
        source: "profile_identity",
      },
      binding: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        source: "binding_truth",
      },
      claim: {
        executionBlocked: false,
        grantsClaimSuccess: false,
        reasonCodes: ["claim.not_checked"],
        source: "not_checked",
      },
      providerAccount: {
        blocked: false,
        expiresAtMs: null,
        observedAtMs: null,
        provider: null,
        reasonCodes: [],
        source: "not_checked",
      },
      providerConversation: {
        agentControllerConversationId: null,
        errorCode: null,
        errorMessage: null,
        errorType: null,
        expiresAtMs: null,
        method: null,
        observedAtMs: null,
        provider: null,
        ready: true,
        reasonCodes: [],
        required: false,
        source: "not_required",
        status: "not_required",
      },
      readinessImpact: {
        blocked: false,
        expiresAtMs: null,
        impactKind: null,
        observedAtMs: null,
        reasonCodes: [],
        source: "not_checked",
      },
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["service.ready"],
        source: "runtime_transport",
      },
      service: {
        executionCompatible: true,
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device-1",
        lane: "dev-local",
        observedAt: "2026-05-10T00:00:00.000Z",
        online: true,
        reasonCodes: ["daemon_route.online"],
        source: "daemon_route",
      },
      runtime: {
        ready: true,
        reasonCodes: ["runtime.ready"],
        source: "prepare_readiness",
      },
    },
    primaryAction: "none",
    reasonCodes: ["agent_execution.ready"],
  };
}

function buildAgentWakeRouteRegistration() {
  return {
    status: "registered",
    reasonCode: null,
    reportedAtMs: 1_777_000_000_000,
    daemonSessionId: "daemon-session-1",
    deviceId: "device-1",
    lane: "dev-local",
    serviceVersion: "0.7.57",
  };
}
