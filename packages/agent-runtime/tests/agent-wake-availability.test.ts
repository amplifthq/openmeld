import { describe, expect, it } from "vitest";
import {
  classifyAgentWakeAvailabilityReason,
  createAgentProfileBindingDisplayProjection,
  resolveAgentExecutionStatus,
  resolveAgentWakeAdmissionBlockReasonCode,
  resolveAgentWakeAdmissionTerminalDecision,
  resolveAgentWakeAvailability,
  resolveAgentWakeAvailabilityDisplayCategory,
  resolveHostedAgentWakeAvailability,
  type WakeRouteStatus,
} from "../src";

const agentProfileId = "agt_11111111-1111-4111-8111-111111111111";

function createPrimaryBinding() {
  return createAgentProfileBindingDisplayProjection({
    agentProfileId,
    bindingId: "bind_11111111-1111-4111-8111-111111111111",
    bindingState: "enabled_primary",
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
    },
  });
}

function createReadyWakeRouteStatus(): WakeRouteStatus {
  return {
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    deviceId: "device_11111111-1111-4111-8111-111111111111",
    lane: "dev-local",
    lastHeartbeatMs: 1_768_000_000_000,
    leaseEpoch: 1,
    status: "ready",
  };
}

function createUnauthenticatedControllerReadiness() {
  return resolveAgentExecutionStatus({
    agentProfileId,
    binding: createPrimaryBinding(),
    route: {
      deviceId: "device_11111111-1111-4111-8111-111111111111",
      observedAt: "2026-07-13T06:00:00.000Z",
      status: "online",
    },
    runtimeReadiness: {
      displayState: "needs_prepare",
      ready: false,
      reasonCodes: [
        "runtime.agent_controller_report_unavailable",
        "provider_account.access_required",
        "controller.auth.unauthenticated",
      ],
    },
  });
}

describe("agent wake availability", () => {
  it("keeps public availability reason roles explicit", () => {
    expect(
      classifyAgentWakeAvailabilityReason(
        "agent_profile_binding.controller_conversation_conflict"
      )
    ).toBe("blocking_unavailable");
    expect(classifyAgentWakeAvailabilityReason("service.not_running")).toBe(
      "blocking_offline"
    );
    expect(
      classifyAgentWakeAvailabilityReason(
        "local_service.not_connected_for_account"
      )
    ).toBe("blocking_offline");
    expect(
      classifyAgentWakeAvailabilityReason("local_service.unavailable")
    ).toBe("blocking_offline");
    expect(
      classifyAgentWakeAvailabilityReason(
        "service.current_runtime_session_missing"
      )
    ).toBe("blocking_offline");
    expect(
      classifyAgentWakeAvailabilityReason("daemon.session.not_found")
    ).toBe("blocking_offline");
    expect(classifyAgentWakeAvailabilityReason("route.not_registered")).toBe(
      "transient_checking"
    );
    expect(
      classifyAgentWakeAvailabilityReason("local_service.reconnecting")
    ).toBe("transient_checking");
    expect(
      classifyAgentWakeAvailabilityReason("provider_conversation.proof_failed")
    ).toBe("diagnostic");
    expect(
      classifyAgentWakeAvailabilityReason("controller.auth.unauthenticated")
    ).toBe("blocking_unavailable");
  });

  it("projects an authoritative deleted profile as a terminal removed state", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      profile: {
        active: false,
        reasonCodes: ["agent_profile.not_found"],
        source: "profile_identity",
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "unavailable" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Removed",
      category: "unavailable",
      label: "Agent profile deleted",
      phase: "unavailable",
      reasonCode: "agent_profile.not_found",
      status: "unavailable_for_wake",
      summary: "This agent profile no longer exists.",
    });
  });

  it("keeps a transient identity lookup failure away from the removed terminal state", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      profile: {
        active: false,
        reasonCodes: ["agent_profile.identity_lookup_failed"],
        source: "unavailable",
      },
    });

    const availability = resolveAgentWakeAvailability({
      wakeRouteStatus: { status: "unavailable" },
      readiness,
    });
    expect(availability.badgeLabel).not.toBe("Removed");
    expect(availability.summary).not.toBe(
      "This agent profile no longer exists."
    );
  });

  it("projects a ready execution path as available for Wake", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "none",
      badgeLabel: "Available",
      category: "available",
      isRefreshing: false,
      label: "Available for Wake",
      phase: "available",
      reasonCode: "agent_execution.ready",
      status: "available_for_wake",
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    });
  });

  it.each([
    {
      agentControllerRef: "builtin:claude-code",
      summary:
        "Run claude in a terminal on this computer, then sign in to Claude Code.",
      tooltip:
        "Claude Code is not signed in. Run claude in a terminal on this computer.",
    },
    {
      agentControllerRef: "builtin:codex",
      summary:
        "Run codex login in a terminal on this computer to sign in to Codex.",
      tooltip:
        "Codex is not signed in. Run codex login in a terminal on this computer.",
    },
    {
      agentControllerRef: "builtin:opencode",
      summary:
        "Run opencode auth login in a terminal on this computer to sign in to OpenCode.",
      tooltip:
        "OpenCode is not signed in. Run opencode auth login in a terminal on this computer.",
    },
    {
      agentControllerRef: "builtin:openclaw",
      summary: "Check the model provider sign-in in OpenClaw on this computer.",
      tooltip:
        "OpenClaw's model provider sign-in needs attention on this computer.",
    },
  ])("blocks $agentControllerRef while showing controller-specific sign-in guidance", ({
    agentControllerRef,
    summary,
    tooltip,
  }) => {
    expect(
      resolveAgentWakeAvailability({
        agentControllerRef,
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness: createUnauthenticatedControllerReadiness(),
      })
    ).toEqual({
      action: "none",
      badgeLabel: "Sign-in needed",
      category: "unavailable",
      isRefreshing: false,
      label: "Sign-in needed",
      phase: "provider_sign_in_needed",
      reasonCode: "controller.auth.unauthenticated",
      status: "unavailable_for_wake",
      summary,
      tooltip,
    });
  });

  it.each([
    {
      label: "Wrong workspace",
      reasonCode: "organization_binding_authorization.required",
    },
    {
      label: "Workspace unavailable",
      reasonCode: "organization_binding_authorization.lookup_failed",
    },
    {
      label: "Workspace unavailable",
      reasonCode: "agent_profile.organization_context_missing",
    },
    {
      label: "Workspace unavailable",
      reasonCode: "agent_profile.organization_lookup_failed",
    },
    {
      label: "Workspace unavailable",
      reasonCode: "agent_profile.space_organization_unavailable",
    },
  ])("blocks ready routes for $reasonCode as $label", ({
    label,
    reasonCode,
  }) => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      claimDiagnostics: {
        reasonCodes: [reasonCode],
        status: "rejected",
      },
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: { reasonCodes: [], status: "online" },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: [],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toMatchObject({
      badgeLabel: label,
      category: "unavailable",
      label,
      reasonCode,
      status: "unavailable_for_wake",
    });
  });

  it("keeps hosted Remote Agent availability separate from local service updates", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      route: {
        observedAt: "2026-05-09T12:00:00.000Z",
        reasonCodes: ["remote_agent.available"],
        status: "online",
      },
      service: {
        executionCompatible: false,
        expectedEpoch: "3",
        observedEpoch: "2",
        reasonCodes: ["service.update_required"],
        source: "unavailable",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["remote_agent.available"],
      },
    });

    const availability = resolveHostedAgentWakeAvailability({ readiness });

    expect(availability).toMatchObject({
      action: "none",
      badgeLabel: "Available",
      category: "available",
      label: "Available for Wake",
      phase: "available",
      reasonCode: "remote_agent.available",
      status: "available_for_wake",
      summary: "Center Agent can answer now.",
    });
    expect(JSON.stringify(availability)).not.toContain("OpenMeld Service");
    expect(JSON.stringify(availability)).not.toContain("Update");
  });

  it("projects a hosted Center Agent missing designation as disconnected", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      runtimeReadiness: {
        displayState: "unavailable",
        ready: false,
        reasonCodes: ["center_agent.designation_required"],
      },
    });

    const availability = resolveHostedAgentWakeAvailability({ readiness });

    expect(availability).toMatchObject({
      badgeLabel: "Disconnected",
      category: "unavailable",
      label: "Disconnected",
      phase: "unavailable",
      reasonCode: "center_agent.designation_required",
      status: "unavailable_for_wake",
      summary: "Connect the Center Agent before waking it from this Space.",
    });
  });

  it("keeps a hosted Center Agent workspace mismatch explicit", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      runtimeReadiness: {
        displayState: "unavailable",
        ready: false,
        reasonCodes: ["agent_profile.organization_mismatch"],
      },
    });

    expect(resolveHostedAgentWakeAvailability({ readiness })).toMatchObject({
      badgeLabel: "Wrong workspace",
      label: "Wrong workspace",
      reasonCode: "agent_profile.organization_mismatch",
      status: "unavailable_for_wake",
      summary: "This Agent Profile belongs to a different workspace.",
      tooltip: "This Agent Profile belongs to another workspace",
    });
  });

  it("keeps a hosted Center Agent missing workspace context explicit", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      runtimeReadiness: {
        displayState: "unavailable",
        ready: false,
        reasonCodes: ["agent_profile.organization_context_missing"],
      },
    });

    expect(resolveHostedAgentWakeAvailability({ readiness })).toMatchObject({
      badgeLabel: "Workspace unavailable",
      label: "Workspace unavailable",
      reasonCode: "agent_profile.organization_context_missing",
      status: "unavailable_for_wake",
    });
  });

  it("fails closed when a ready path only has a weak ready route status", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: {
          status: "ready",
        } as WakeRouteStatus,
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Checking",
      category: "checking",
      label: "Checking connection",
      phase: "checking_route",
      reasonCode: "agent_execution.route_missing",
      status: "checking_connection",
    });
  });

  it("keeps failed provider conversation proof from changing public Wake availability", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId,
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerConversationId: "thread-ctx-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      providerConversation: {
        agentControllerConversationId: "thread-ctx-1",
        errorCode: "process.timeout",
        errorMessage: "codex app-server did not complete within 30000ms",
        errorType: "timeout",
        expiresAtMs: 1_770_003_600_000,
        method: "codex_app_server_thread_resume",
        observedAtMs: 1_770_000_000_000,
        provider: "codex",
        ready: false,
        reasonCodes: ["provider_conversation.proof_failed", "process.timeout"],
        required: true,
        source: "runtime_reporting",
        status: "failed",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "none",
      badgeLabel: "Available",
      category: "available",
      isRefreshing: false,
      label: "Available for Wake",
      phase: "available",
      reasonCode: "agent_execution.ready",
      status: "available_for_wake",
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    });
  });

  it("keeps a refreshable route gap with ready local execution evidence as checking", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "offline" },
        readiness,
      })
    ).toEqual({
      action: "check_status",
      badgeLabel: "Checking",
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_route",
      reasonCode: "agent_execution.route_missing",
      status: "checking_connection",
      summary: "Checking this agent's Wake route.",
      tooltip: "Checking Wake route",
    });
  });

  it("keeps pending Wake route registration as checking while service can refresh", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: {
          status: "pending",
          reasonCode: "wake_route.registration_pending",
          reportedAtMs: null,
          daemonSessionId: null,
          deviceId: null,
          lane: null,
          serviceVersion: null,
        },
        wakeRouteStatus: { status: "offline" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Checking",
      category: "checking",
      phase: "checking_route",
      reasonCode: "wake_route.registration_pending",
      status: "checking_connection",
    });
  });

  it("projects skipped Wake route registration as a concrete connect action", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: {
          status: "skipped",
          reasonCode: "profile.binding.unbound",
          reportedAtMs: 1_768_000_000_000,
          daemonSessionId: "daemon-session-1",
          deviceId: "device_11111111-1111-4111-8111-111111111111",
          lane: "dev-local",
          serviceVersion: "0.7.52",
        },
        wakeRouteStatus: { status: "offline" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Connect",
      category: "unavailable",
      phase: "connect_local_agent",
      reasonCode: "profile.binding.unbound",
      status: "unavailable_for_wake",
    });
  });

  it("keeps expired Wake route registration offline even when OpenMeld Service is reachable", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        agentWakeRouteRegistration: {
          status: "expired",
          reasonCode: "wake_route.registration_expired",
          reportedAtMs: 1_768_000_000_000,
          daemonSessionId: "daemon-session-1",
          deviceId: "device_11111111-1111-4111-8111-111111111111",
          lane: "dev-local",
          serviceVersion: "0.7.52",
        },
        wakeRouteStatus: { status: "offline" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Offline",
      category: "offline",
      isRefreshing: false,
      phase: "offline",
      reasonCode: "wake_route.registration_expired",
      status: "offline_for_wake",
      summary:
        "This agent's connection is offline. Check OpenMeld Service on its computer.",
      tooltip:
        "Agent connection is offline. Check OpenMeld Service on its computer.",
    });
  });

  it("keeps a refreshable route gap as checking when local execution evidence is missing", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "check_status",
      badgeLabel: "Checking",
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_route",
      reasonCode: "agent_execution.route_missing",
      status: "checking_connection",
      summary: "Checking this agent's Wake route.",
      tooltip: "Checking Wake route",
    });
  });

  it("projects stable offline evidence as offline for Wake", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["service.not_running"],
        source: "runtime_transport",
      },
      route: {
        reasonCodes: ["route.offline"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "offline" },
        readiness,
      })
    ).toEqual({
      action: "run_prepare",
      badgeLabel: "Offline",
      category: "offline",
      isRefreshing: false,
      label: "Offline for Wake",
      phase: "service_not_connected",
      reasonCode: "service.not_running",
      status: "offline_for_wake",
      summary:
        "Connect OpenMeld Service on this computer before this agent can reply.",
      tooltip: "OpenMeld Service is not connected on this computer.",
    });
  });

  it("keeps an unavailable Wake route lookup out of the offline bucket", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.not_connected_for_account"],
        source: "runtime_transport",
      },
      route: {
        reasonCodes: ["lookup_failed"],
        status: "unavailable",
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "unavailable" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Unavailable",
      category: "unavailable",
      label: "Unavailable for Wake",
      phase: "unavailable",
      reasonCode: "lookup_failed",
      status: "unavailable_for_wake",
      summary:
        "This agent's Wake route is unavailable right now. Check OpenMeld Service on its computer.",
      tooltip:
        "Wake route unavailable. Check OpenMeld Service on its computer.",
    });
  });

  it("keeps route-only offline evidence on the agent connection copy", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: false,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        reasonCodes: ["route.offline"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "offline" },
        readiness,
      })
    ).toEqual({
      action: "run_prepare",
      badgeLabel: "Offline",
      category: "offline",
      isRefreshing: false,
      label: "Offline for Wake",
      phase: "offline",
      reasonCode: "route.offline",
      status: "offline_for_wake",
      summary:
        "This agent's connection is offline. Check OpenMeld Service on its computer.",
      tooltip:
        "Agent connection is offline. Check OpenMeld Service on its computer.",
    });
  });

  it("keeps a registered Wake route available when local service diagnostics are stale", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["service.not_running"],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "none",
      badgeLabel: "Available",
      category: "available",
      isRefreshing: false,
      label: "Available for Wake",
      phase: "available",
      reasonCode: "agent_execution.ready",
      status: "available_for_wake",
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    });
  });

  it("projects local profile or service defects as unavailable for Wake", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      profile: {
        active: false,
        reasonCodes: ["profile.inactive"],
        source: "profile_identity",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "check_status",
      badgeLabel: "Unavailable",
      category: "unavailable",
      isRefreshing: false,
      label: "Unavailable for Wake",
      phase: "unavailable",
      reasonCode: "profile.inactive",
      status: "unavailable_for_wake",
      summary: "This agent cannot reply from this computer right now.",
      tooltip: "Unavailable for Wake",
    });
  });

  it("explains when the selected local agent is turned off in OpenMeld", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-07-13T06:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "needs_prepare",
        ready: false,
        reasonCodes: ["controller.registry.disabled"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Turned off",
      category: "unavailable",
      phase: "connect_local_agent",
      reasonCode: "controller.registry.disabled",
      status: "unavailable_for_wake",
      summary:
        "This local agent is turned off in OpenMeld on this computer. Turn it on before this profile can reply.",
      tooltip: "This local agent is turned off in OpenMeld on this computer.",
    });
    expect(resolveAgentWakeAdmissionBlockReasonCode(readiness)).toBe(
      "controller.registry.disabled"
    );
  });

  it("projects controller conversation conflicts as unavailable for Wake", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: {
        reasonCodes: ["agent_profile_binding.controller_conversation_conflict"],
        status: "unavailable",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Unavailable",
      category: "unavailable",
      isRefreshing: false,
      label: "Unavailable for Wake",
      phase: "unavailable",
      reasonCode: "agent_profile_binding.controller_conversation_conflict",
      summary:
        "This agent shares a reply conversation with another Agent Profile.",
      status: "unavailable_for_wake",
      tooltip: "Duplicate reply conversation",
    });
  });

  it.each([
    ["service.update_required", "update_required", "update_openmeld_service"],
    [
      "agent_profile_binding.controller_conversation_conflict",
      "binding_required",
      "repair_agent_binding",
    ],
    ["workspace.invalid", "workspace_unavailable", "review_agent_settings"],
    [
      "provider_account.organization_access_disabled",
      "provider_access_unavailable",
      "review_agent_settings",
    ],
    [
      "controller.launch.needs_repair",
      "local_agent_unavailable",
      "connect_local_agent",
    ],
    [
      "daemon.runtime_contract.missing",
      "update_required",
      "update_openmeld_service",
    ],
    ["profile.inactive", "agent_profile_unavailable", "review_agent_settings"],
    [
      "agent_execution.route_unavailable",
      "service_not_connected",
      "start_or_restart_openmeld_service",
    ],
  ] as const)("maps canonical blocker %s to one durable terminal projection", (reasonCode, publicationCategory, userRecoveryAction) => {
    expect(resolveAgentWakeAdmissionTerminalDecision(reasonCode)).toEqual({
      publicationCategory,
      reasonCode,
      userRecoveryAction,
    });
  });

  it("keeps transient controller checks out of durable admission terminals", () => {
    expect(
      resolveAgentWakeAdmissionTerminalDecision(
        "controller.interface.check_failed"
      )
    ).toBeNull();
  });

  it("keeps a registered Wake route available when local controller evidence is stale", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "stale",
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_stale"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "none",
      badgeLabel: "Available",
      category: "available",
      isRefreshing: false,
      label: "Available for Wake",
      phase: "available",
      reasonCode: "agent_execution.ready",
      status: "available_for_wake",
      summary: "Can reply from this computer in Spaces.",
      tooltip: "Available for Wake",
    });
  });

  it("fails closed while OpenMeld retries a failed local controller check", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      service: {
        executionCompatible: true,
        expectedEpoch: "1",
        observedEpoch: "1",
        reasonCodes: [],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "unavailable",
        ready: false,
        reasonCodes: ["controller.interface.check_failed"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "check_status",
      badgeLabel: "Checking",
      category: "checking",
      isRefreshing: true,
      label: "Checking connection",
      phase: "checking_status",
      reasonCode: "controller.interface.check_failed",
      status: "checking_connection",
      summary: "OpenMeld couldn't check this local agent. It will try again.",
      tooltip: "Local agent check unavailable",
    });
  });

  it("projects service compatibility defects as an update action instead of checking", () => {
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_11111111-1111-4111-8111-111111111111",
        observedAt: "2026-05-09T12:00:00.000Z",
        status: "online",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
      service: {
        executionCompatible: false,
        expectedEpoch: "v1",
        observedEpoch: null,
        reasonCodes: ["service.update_required"],
        source: "runtime_transport",
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: createReadyWakeRouteStatus(),
        readiness,
      })
    ).toEqual({
      action: "update_service",
      badgeLabel: "Update",
      category: "unavailable",
      isRefreshing: false,
      label: "Update OpenMeld Service",
      phase: "service_update_required",
      reasonCode: "service.update_required",
      status: "unavailable_for_wake",
      summary: "Update OpenMeld Service before this agent can reply.",
      tooltip: "Update OpenMeld Service",
    });
  });
});

describe("resolveAgentWakeAvailabilityDisplayCategory", () => {
  it("shows checking before an availability verdict arrives", () => {
    expect(resolveAgentWakeAvailabilityDisplayCategory(null)).toBe("checking");
    expect(resolveAgentWakeAvailabilityDisplayCategory(undefined)).toBe(
      "checking"
    );
  });

  it("passes through the resolved category", () => {
    expect(
      resolveAgentWakeAvailabilityDisplayCategory({ category: "available" })
    ).toBe("available");
    expect(
      resolveAgentWakeAvailabilityDisplayCategory({ category: "offline" })
    ).toBe("offline");
    expect(
      resolveAgentWakeAvailabilityDisplayCategory({ category: "unavailable" })
    ).toBe("unavailable");
  });
});

describe("delivery reconnect availability", () => {
  it("keeps an explicit reconnecting route on the checking path instead of offline", () => {
    // RuntimeTransport has already bounded this delivery reconnect as transient.
    // Availability consumes that Core-owned route verdict; it does not infer
    // socket replacement from lease freshness.
    const readiness = resolveAgentExecutionStatus({
      agentProfileId,
      binding: createPrimaryBinding(),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["local_service.reconnecting"],
        source: "runtime_transport",
      },
      route: {
        observedAt: "2026-06-12T10:58:55.000Z",
        reasonCodes: ["route.not_registered"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(
      resolveAgentWakeAvailability({
        wakeRouteStatus: { status: "checking" },
        readiness,
      })
    ).toMatchObject({
      badgeLabel: "Reconnecting",
      category: "checking",
      isRefreshing: true,
      label: "Reconnecting OpenMeld Service",
      phase: "checking_route",
      reasonCode: "local_service.reconnecting",
      status: "checking_connection",
      summary: "OpenMeld Service is reconnecting on this computer.",
      tooltip: "Reconnecting OpenMeld Service",
    });
  });
});
