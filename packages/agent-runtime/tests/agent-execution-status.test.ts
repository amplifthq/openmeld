import { describe, expect, it } from "vitest";
import {
  createAgentProfileBindingDisplayProjection,
  isAgentExecutionLocalReadinessRefreshingReasonCode,
  isAgentExecutionReadyOrConnecting,
  isAgentExecutionSelfHealingReadiness,
  resolveAgentExecutionStatus,
} from "../src";

describe("agent execution status projection", () => {
  const onlineRoute = {
    deviceId: "device_11111111-1111-4111-8111-111111111111",
    observedAt: "2026-05-09T12:00:00.000Z",
    status: "online" as const,
  };

  it("shows ready only when Binding truth, Runtime readiness, and route are ready", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      displayState: "ready",
      primaryAction: "none",
      facts: {
        binding: {
          routable: true,
          source: "binding_truth",
        },
        claim: {
          executionBlocked: false,
          grantsClaimSuccess: false,
        },
        route: {
          online: true,
          source: "daemon_route",
        },
        runtime: {
          ready: true,
          source: "prepare_readiness",
        },
      },
    });
  });

  it("projects ready when blocking readiness facts are absent", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection.displayState).toBe("ready");
    expect(projection.facts.claim.executionBlocked).toBe(false);
    expect(projection.facts.providerAccount.blocked).toBe(false);
    expect(projection.facts.readinessImpact.blocked).toBe(false);
    expect(projection.facts.binding.routable).toBe(true);
  });

  it.each([
    ["claude-code", "builtin:claude-code"],
    ["codex", "builtin:codex"],
    ["opencode", "builtin:opencode"],
    ["openclaw", "builtin:openclaw"],
  ] as const)("keeps an earlier %s provider failure diagnostic when current facts are ready", (provider, agentControllerRef) => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef,
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      providerAccount: {
        blocked: true,
        expiresAtMs: 1_770_003_600_000,
        observedAtMs: 1_770_000_000_000,
        provider,
        reasonCodes: ["provider_account.subscription_access_unavailable"],
        source: "wake_failure",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
      facts: {
        providerAccount: {
          blocked: true,
          provider,
          reasonCodes: ["provider_account.subscription_access_unavailable"],
          source: "wake_failure",
        },
      },
    });
    expect(projection.reasonCodes).not.toContain(
      "provider_account.subscription_access_unavailable"
    );
  });

  it("does not turn an earlier hard quota failure into current provider availability", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:opencode",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      providerAccount: {
        blocked: true,
        expiresAtMs: 1_770_003_600_000,
        observedAtMs: 1_770_000_000_000,
        provider: "opencode",
        reasonCodes: ["provider_account.capacity_exhausted"],
        source: "wake_failure",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
    });
    expect(projection.reasonCodes).not.toContain(
      "provider_account.capacity_exhausted"
    );
  });

  it("keeps failed provider conversation proof as diagnostics without blocking Wake readiness", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
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
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
      facts: {
        providerConversation: {
          ready: false,
          reasonCodes: [
            "provider_conversation.proof_failed",
            "process.timeout",
          ],
          status: "failed",
        },
      },
    });
    expect(projection.reasonCodes).not.toContain(
      "provider_conversation.proof_failed"
    );
  });

  it("keeps historical Wake failure impact diagnostic without deciding current Wakeability", () => {
    for (const reasonCode of [
      "controller.launch.choice_required",
      "controller.launch.needs_repair",
      "controller.client.upgrade_required",
      "controller.runtime.missing",
      "runtime_coordinator.delivery_expired",
      "workspace.invalid",
      "workspace.missing",
    ] as const) {
      const projection = resolveAgentExecutionStatus({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          bindingId: "bind_11111111-1111-4111-8111-111111111111",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        readinessImpact: {
          blocked: true,
          expiresAtMs: 1_770_001_800_000,
          impactKind: "local_execution",
          observedAtMs: 1_770_000_000_000,
          reasonCodes: [reasonCode],
          source: "wake_failure",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      });

      expect(projection).toMatchObject({
        displayState: "ready",
        primaryAction: "none",
        facts: {
          readinessImpact: {
            blocked: true,
            impactKind: "local_execution",
            reasonCodes: [reasonCode],
            source: "wake_failure",
          },
        },
      });
      expect(projection.reasonCodes).not.toContain(reasonCode);
    }
  });

  it("keeps missing Binding non-routable even when Runtime readiness is ready", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "reconnect_binding",
      facts: {
        binding: {
          reasonCodes: ["agent_profile_binding.missing"],
          routable: false,
          source: "missing",
        },
      },
    });
  });

  it("keeps unavailable profile identity separate from missing Binding setup", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_profile_lookup_unavailable",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_profile_lookup_unavailable",
        bindingId: "bind_profile_lookup_unavailable",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      profile: {
        active: false,
        reasonCodes: ["agent_profile.identity_lookup_failed"],
        source: "unavailable",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "unknown",
      primaryAction: "check_status",
      facts: {
        profile: {
          active: false,
          reasonCodes: ["agent_profile.identity_lookup_failed"],
          source: "unavailable",
        },
        binding: {
          routable: true,
          source: "binding_truth",
        },
      },
    });
    expect(projection.reasonCodes).toContain(
      "agent_profile.identity_lookup_failed"
    );
    expect(projection.reasonCodes).not.toContain(
      "agent_profile_binding.missing"
    );
  });

  it("blocks ready when current profile identity is not an active agent", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_inactive",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_inactive",
        bindingId: "bind_inactive",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      profile: {
        active: false,
        reasonCodes: ["agent_profile.inactive"],
        source: "profile_identity",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "check_status",
      facts: {
        profile: {
          active: false,
          reasonCodes: ["agent_profile.inactive"],
        },
      },
    });
  });

  it("keeps an offline route not ready even when Binding and Runtime readiness are ready", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_23232323-2323-4232-8232-232323232323",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_23232323-2323-4232-8232-232323232323",
        bindingId: "bind_23232323-2323-4232-8232-232323232323",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: {
        reasonCodes: ["agent_execution.route_offline"],
        status: "offline",
      },
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["local_service.refresh_in_progress"],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "check_status",
      facts: {
        route: {
          online: false,
          reasonCodes: ["agent_execution.route_offline"],
          source: "daemon_route",
        },
      },
      reasonCodes: expect.arrayContaining(["agent_execution.route_offline"]),
    });
  });

  it("auto-checks missing Runtime readiness when OpenMeld Service is reachable", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
        bindingId: "bind_33333333-3333-4333-8333-333333333333",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: null,
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "check_status",
      facts: {
        localService: {
          reachable: true,
          refreshable: true,
        },
        runtime: {
          ready: false,
          reasonCodes: ["runtime.projection_missing"],
        },
      },
    });
  });

  it("treats only ready execution readiness as usable after Binding changes", () => {
    const readyProjection = resolveAgentExecutionStatus({
      agentProfileId: "agt_ready",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_ready",
        bindingId: "bind_ready",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });
    const refreshingProjection = resolveAgentExecutionStatus({
      agentProfileId: "agt_refreshing",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_refreshing",
        bindingId: "bind_refreshing",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerConversationId: "thread-refreshing",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["local_service.refresh_in_progress"],
        source: "runtime_transport",
      },
      route: {
        reasonCodes: ["route.not_registered"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
      providerConversation: {
        agentControllerConversationId: "thread-refreshing",
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
    });
    const unavailableProjection = resolveAgentExecutionStatus({
      agentProfileId: "agt_unavailable",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_unavailable",
        bindingId: "bind_unavailable",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.not_connected_for_account"],
        source: "unavailable",
      },
      route: {
        reasonCodes: ["route.not_registered"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(isAgentExecutionReadyOrConnecting(readyProjection)).toBe(true);
    expect(isAgentExecutionReadyOrConnecting(refreshingProjection)).toBe(false);
    expect(isAgentExecutionReadyOrConnecting(unavailableProjection)).toBe(
      false
    );
  });

  it("keeps provider conversation proof missing out of local readiness refresh triggers", () => {
    expect(
      isAgentExecutionLocalReadinessRefreshingReasonCode(
        "runtime.agent_controller_report_missing"
      )
    ).toBe(true);
    expect(
      isAgentExecutionLocalReadinessRefreshingReasonCode(
        "provider_conversation.proof_missing"
      )
    ).toBe(false);
  });

  it("sends users to connect OpenMeld Service when the same-account service is not connected", () => {
    const staleRuntimeReadiness = {
      displayState: "stale" as const,
      ready: false,
      reasonCodes: ["runtime.agent_controller_report_stale"],
    };

    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
        bindingId: "bind_33333333-3333-4333-8333-333333333333",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.not_connected_for_account"],
        source: "runtime_transport",
      },
      route: {
        reasonCodes: ["route.not_registered"],
        status: "offline",
      },
      runtimeReadiness: staleRuntimeReadiness,
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "connect_service",
      facts: {
        binding: {
          routable: true,
          source: "binding_truth",
        },
        localService: {
          reachable: false,
          refreshable: false,
          reasonCodes: ["local_service.not_connected_for_account"],
        },
        runtime: {
          ready: false,
        },
      },
    });
  });

  it("does not send users back to setup when only the Agent Controller availability report is stale", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
        bindingId: "bind_34343434-3434-4343-8343-343434343434",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: ["local_service.refresh_in_progress"],
        source: "runtime_transport",
      },
      runtimeReadiness: {
        displayState: "stale",
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_stale"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "check_status",
      facts: {
        binding: {
          routable: true,
          source: "binding_truth",
        },
        route: {
          online: true,
          source: "daemon_route",
        },
        runtime: {
          ready: false,
          reasonCodes: ["runtime.agent_controller_report_stale"],
          source: "prepare_readiness",
        },
      },
    });
  });

  it("treats a failed controller check as self-healing instead of setup repair", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_35353535-3535-4353-8353-353535353535",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_35353535-3535-4353-8353-353535353535",
        bindingId: "bind_35353535-3535-4353-8353-353535353535",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:opencode",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: true,
        refreshable: true,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "unavailable",
        ready: false,
        reasonCodes: ["controller.interface.check_failed"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "check_status",
      facts: {
        runtime: {
          ready: false,
          reasonCodes: ["controller.interface.check_failed"],
        },
      },
    });
    expect(isAgentExecutionSelfHealingReadiness(projection)).toBe(true);
    expect(
      isAgentExecutionLocalReadinessRefreshingReasonCode(
        "controller.interface.check_failed"
      )
    ).toBe(true);
  });

  it.each([
    "service.update_required",
    "background_helper.update_required",
    "daemon.runtime_contract.mismatch",
  ])("uses update_service when Runtime readiness explicitly reports %s", (reasonCode) => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
        bindingId: "bind_34343434-3434-4343-8343-343434343434",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "needs_repair",
        ready: false,
        reasonCodes: [reasonCode],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "update_service",
      facts: {
        binding: {
          routable: true,
          source: "binding_truth",
        },
        runtime: {
          ready: false,
          reasonCodes: [reasonCode],
          source: "prepare_readiness",
        },
      },
    });
  });

  it("keeps missing runtime contract evidence out of the service update path", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
        bindingId: "bind_34343434-3434-4343-8343-343434343434",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "needs_repair",
        ready: false,
        reasonCodes: ["daemon.runtime_contract.missing"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "run_prepare",
      facts: {
        runtime: {
          ready: false,
          reasonCodes: ["daemon.runtime_contract.missing"],
          source: "prepare_readiness",
        },
      },
    });
  });

  it("blocks Ready when OpenMeld Service execution contract reports a mismatch", () => {
    const reasonCode = "daemon.runtime_contract.mismatch";
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_35353535-3535-4353-8353-353535353535",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_35353535-3535-4353-8353-353535353535",
        bindingId: "bind_35353535-3535-4353-8353-353535353535",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: true,
        refreshable: false,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
      service: {
        executionCompatible: false,
        expectedEpoch: "daemon-runtime-epoch-current",
        observedEpoch: null,
        reasonCodes: ["service.update_required", reasonCode],
        source: "runtime_transport",
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "update_service",
      facts: {
        service: {
          executionCompatible: false,
          reasonCodes: ["service.update_required", reasonCode],
          source: "runtime_transport",
        },
      },
    });
  });

  it("does not treat route refresh as self-healing when OpenMeld Service needs an update", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_36363636-3636-4363-8363-363636363636",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_36363636-3636-4363-8363-363636363636",
        bindingId: "bind_36363636-3636-4363-8363-363636363636",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: true,
        refreshable: false,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: {
        reasonCodes: ["route.not_registered"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
      service: {
        executionCompatible: false,
        expectedEpoch: "daemon-runtime-epoch-current",
        observedEpoch: null,
        reasonCodes: [
          "service.update_required",
          "daemon.runtime_contract.mismatch",
        ],
        source: "runtime_transport",
      },
    });

    expect(projection.primaryAction).toBe("update_service");
    expect(isAgentExecutionSelfHealingReadiness(projection)).toBe(false);
  });

  it("keeps advisory service drift from blocking Wake when the service execution contract is compatible", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_34343434-3434-4343-8343-343434343434",
        bindingId: "bind_34343434-3434-4343-8343-343434343434",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "needs_repair",
        ready: false,
        reasonCodes: ["service.drifted"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "ready",
      primaryAction: "none",
      facts: {
        binding: {
          routable: true,
          source: "binding_truth",
        },
        runtime: {
          ready: true,
          reasonCodes: ["service.drifted"],
          source: "prepare_readiness",
        },
      },
    });
  });

  it("fails closed when Binding truth belongs to a different Agent Profile", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
        bindingId: "bind_44444444-4444-4444-8444-444444444444",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "reconnect_binding",
      facts: {
        binding: {
          reasonCodes: ["agent_execution.binding_agent_profile_mismatch"],
          routable: false,
          source: "blocked",
        },
        runtime: {
          ready: true,
          source: "prepare_readiness",
        },
      },
    });
  });

  it("keeps Binding read failures unavailable instead of pretending Binding is missing", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_48484848-4848-4848-8848-484848484848",
      binding: {
        reasonCodes: ["agent_profile_binding.read_unavailable"],
        status: "unavailable",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      facts: {
        binding: {
          reasonCodes: ["agent_profile_binding.read_unavailable"],
          routable: false,
          source: "unavailable",
        },
      },
    });
  });

  it("marks rejected claim diagnostics as not executable without granting claim success", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
        bindingId: "bind_44444444-4444-4444-8444-444444444444",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      claimDiagnostics: {
        reasonCodes: ["claim_eligibility.binding_missing"],
        status: "rejected",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      facts: {
        claim: {
          executionBlocked: true,
          grantsClaimSuccess: false,
          reasonCodes: ["claim_eligibility.binding_missing"],
          source: "claim_diagnostics",
        },
      },
    });
  });

  it.each([
    "claim_eligibility.binding_runtime_mismatch",
    "claim_eligibility.openmeld_service_runtime_id_mismatch",
    "claim_eligibility.owner_mismatch",
    "claim_eligibility.binding_capability_mismatch",
  ])("uses reconnect action when claim diagnostics report %s", (reasonCode) => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_57575757-5757-4757-8757-575757575757",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_57575757-5757-4757-8757-575757575757",
        bindingId: "bind_57575757-5757-4757-8757-575757575757",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      claimDiagnostics: {
        reasonCodes: [reasonCode],
        status: "mismatch",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "reconnect_binding",
      facts: {
        claim: {
          executionBlocked: true,
          reasonCodes: [reasonCode],
          source: "claim_diagnostics",
        },
      },
    });
  });

  it("uses reconnect action when stale binding runtime readiness hides the current ready runtime", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_57575757-5757-4757-8757-575757575757",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_57575757-5757-4757-8757-575757575757",
        bindingId: "bind_57575757-5757-4757-8757-575757575757",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      claimDiagnostics: {
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        status: "mismatch",
      },
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.identity_mismatch"],
        source: "runtime_transport",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "stale",
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_stale"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "reconnect_binding",
      facts: {
        claim: {
          executionBlocked: true,
          reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        },
        runtime: {
          ready: false,
          reasonCodes: ["runtime.agent_controller_report_stale"],
        },
      },
    });
  });

  it("uses reconnect action when OpenMeld Service is connected to a different local runtime", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_57575757-5757-4757-8757-575757575757",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_57575757-5757-4757-8757-575757575757",
        bindingId: "bind_57575757-5757-4757-8757-575757575757",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      localService: {
        reachable: false,
        refreshable: true,
        reasonCodes: ["local_service.identity_mismatch"],
        source: "runtime_transport",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "not_ready",
      primaryAction: "reconnect_binding",
      facts: {
        localService: {
          reachable: false,
          reasonCodes: ["local_service.identity_mismatch"],
        },
      },
    });
  });

  it("keeps binding reconnect ahead of setup repair when the old route is offline", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_58585858-5858-4858-8858-585858585858",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_58585858-5858-4858-8858-585858585858",
        bindingId: "bind_58585858-5858-4858-8858-585858585858",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      claimDiagnostics: {
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        status: "mismatch",
      },
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.identity_mismatch"],
        source: "runtime_transport",
      },
      route: {
        deviceId: "device_22222222-2222-4222-8222-222222222222",
        observedAt: "2026-05-09T12:00:00.000Z",
        reasonCodes: ["route.offline"],
        status: "offline",
      },
      runtimeReadiness: {
        displayState: "stale",
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_stale"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "reconnect_binding",
      facts: {
        route: {
          online: false,
          reasonCodes: ["route.offline"],
        },
      },
    });
  });

  it("does not use check_status for claim blockers that cannot be auto-refreshed", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_59595959-5959-4959-8959-595959595959",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_59595959-5959-4959-8959-595959595959",
        bindingId: "bind_59595959-5959-4959-8959-595959595959",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      claimDiagnostics: {
        reasonCodes: ["claim_eligibility.unexpected_policy_blocker"],
        status: "rejected",
      },
      localService: {
        reachable: true,
        refreshable: false,
        reasonCodes: [],
        source: "runtime_transport",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "run_prepare",
      facts: {
        claim: {
          executionBlocked: true,
          reasonCodes: ["claim_eligibility.unexpected_policy_blocker"],
        },
      },
    });
    expect(isAgentExecutionSelfHealingReadiness(projection)).toBe(false);
  });

  it("keeps update_service ahead of setup repair when claim and Runtime diagnostics both block execution", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_58585858-5858-4858-8858-585858585858",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_58585858-5858-4858-8858-585858585858",
        bindingId: "bind_58585858-5858-4858-8858-585858585858",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      claimDiagnostics: {
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        status: "mismatch",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "needs_repair",
        ready: false,
        reasonCodes: ["daemon.runtime_contract.mismatch"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      primaryAction: "update_service",
      facts: {
        claim: {
          executionBlocked: true,
          reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        },
        runtime: {
          ready: false,
          reasonCodes: ["daemon.runtime_contract.mismatch"],
        },
      },
    });
  });

  it("keeps claim diagnostics as non-success lease evidence only", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
        bindingId: "bind_66666666-6666-4666-8666-666666666666",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      route: onlineRoute,
      claimDiagnostics: {
        reasonCodes: ["runtime_coordinator.execution_authority_present"],
        status: "accepted",
      },
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "ready",
      facts: {
        claim: {
          executionBlocked: false,
          grantsClaimSuccess: false,
          reasonCodes: ["runtime_coordinator.execution_authority_present"],
          source: "claim_diagnostics",
        },
      },
    });
    expect(projection).not.toHaveProperty("runtimeExecutionStarted");
    expect(projection).not.toHaveProperty("runtimeExecutionSucceeded");
  });

  it("blocks rejected claim diagnostics", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_77777777-7777-4777-8777-777777777777",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_77777777-7777-4777-8777-777777777777",
        bindingId: "bind_77777777-7777-4777-8777-777777777777",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      claimDiagnostics: {
        reasonCodes: ["execution_authority.missing"],
        status: "rejected",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(projection).toMatchObject({
      displayState: "blocked",
      facts: {
        claim: {
          executionBlocked: true,
          grantsClaimSuccess: false,
          reasonCodes: ["execution_authority.missing"],
          source: "claim_diagnostics",
        },
      },
    });
  });
});
