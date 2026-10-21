import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAgentControllerReportSubmission } from "../src/local-service/reporting/runtime-agent-controller-reporting-submission";

const {
  createAgentProfileBindingApiMock,
  createCliApiClientFoundationMock,
  ensurePrimaryBindingMock,
  getExecutionReadinessMock,
  notifyRouteCatalogChangedMock,
  resolveBaseUrlMock,
} = vi.hoisted(() => ({
  createAgentProfileBindingApiMock: vi.fn(),
  createCliApiClientFoundationMock: vi.fn(),
  ensurePrimaryBindingMock: vi.fn(),
  getExecutionReadinessMock: vi.fn(),
  notifyRouteCatalogChangedMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: createAgentProfileBindingApiMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: createCliApiClientFoundationMock,
}));

const AGENT_PROFILE = {
  openMeldProfileId: "agt-codex",
  profileName: "Codex",
  profileHandle: "codex",
  profileKind: "agent",
  ownerUserId: "user-1",
  source: "cli_test",
  status: "active",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-04-17T00:00:00.000Z",
  updatedAt: "2026-04-17T00:00:00.000Z",
} as const;

const SUBMITTED_RUNTIME_REPORT: RuntimeAgentControllerReportSubmission = {
  agentControllerRef: "builtin:codex",
  agentControllerReportStatus: "accepted",
  deviceId: "device-1",
  lane: "openmeld-dev",
  reasonCodes: [],
  registrationStatus: "created",
  openMeldServiceRuntimeId: "runtime_opaque_1",
  source: "runtime_reporting_api",
  status: "submitted",
};

describe("Agent Profile Runtime Binding ensure", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.test");
    createCliApiClientFoundationMock.mockReturnValue({ foundation: true });
    createAgentProfileBindingApiMock.mockReturnValue({
      ensurePrimaryBinding: ensurePrimaryBindingMock,
      getExecutionReadiness: getExecutionReadinessMock,
      notifyRouteCatalogChanged: notifyRouteCatalogChangedMock,
    });
    getExecutionReadinessMock.mockResolvedValue(readyExecutionReadiness());
    notifyRouteCatalogChangedMock.mockResolvedValue({
      notifiedSessions: 1,
      ok: true,
    });
    ensurePrimaryBindingMock.mockResolvedValue({
      binding: {
        agentProfileId: "agt-codex",
        authoritySource: "binding_truth",
        bindingId: "binding-1",
        bindingState: "enabled_primary",
        dispatchEligibility: {
          reasonCodes: ["agent_profile_binding.enabled_primary"],
          routable: true,
          status: "routable",
        },
        grantsClaimSuccess: false,
        reasonCodes: ["agent_profile_binding.enabled_primary"],
        resolutionSource: "binding_truth",
        routable: true,
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
        },
      },
      grantsClaimSuccess: false,
      outcome: "reused",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      status: "accepted",
    });
  });

  it("creates or reuses Binding truth from accepted Runtime authority evidence", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const result = await ensureAgentProfileRuntimeBinding({
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(result).toMatchObject({
      outcome: "reused",
      routable: true,
      source: "agent_profile_binding_api",
      status: "accepted",
    });
    expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-codex",
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    );
    expect(notifyRouteCatalogChangedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-codex",
        reason: "agent_profile_binding_changed",
      })
    );
    expect(getExecutionReadinessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-codex",
      })
    );
  });

  it("can write Binding truth without waiting for local execution evidence", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const result = await ensureAgentProfileRuntimeBinding({
      confirmLocalExecutionEvidence: false,
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(result).toMatchObject({
      outcome: "reused",
      routable: true,
      source: "agent_profile_binding_api",
      status: "accepted",
    });
    expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-codex",
        agentControllerRef: "builtin:codex",
      })
    );
    expect(notifyRouteCatalogChangedMock).not.toHaveBeenCalled();
    expect(getExecutionReadinessMock).not.toHaveBeenCalled();
  });

  it("passes reconnect write mode when profile update explicitly changes Binding truth", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    await ensureAgentProfileRuntimeBinding({
      agentControllerConversationId: "codex-thread-1",
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
      writeMode: "reconnect",
    });

    expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerConversationId: "codex-thread-1",
        agentProfileId: "agt-codex",
        writeMode: "reconnect",
      })
    );
  });

  it("passes explicit model selection as Binding intent", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    await ensureAgentProfileRuntimeBinding({
      modelId: "gpt-5.4-mini",
      profile: AGENT_PROFILE,
      reasoningLevel: "medium",
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-codex",
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      })
    );
  });

  it("passes explicit Agent Controller Permission Mode as Binding intent", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    await ensureAgentProfileRuntimeBinding({
      agentControllerPermissionMode: "codex:approveForMe",
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerPermissionMode: "codex:approveForMe",
        agentProfileId: "agt-codex",
      })
    );
  });

  it("passes preserved controller settings during a runtime reconnect", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );
    await ensureAgentProfileRuntimeBinding({
      agentControllerCollaborationMode: "codex:plan",
      agentControllerConversationId: "controller-thread-existing",
      agentControllerPermissionMode: "codex:customConfig",
      modelId: "gpt-5.6-sol",
      profile: AGENT_PROFILE,
      reasoningLevel: "ultra",
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
      writeMode: "reconnect",
    });

    expect(ensurePrimaryBindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerCollaborationMode: "codex:plan",
        agentControllerConversationId: "controller-thread-existing",
        agentControllerPermissionMode: "codex:customConfig",
        modelId: "gpt-5.6-sol",
        reasoningLevel: "ultra",
        writeMode: "reconnect",
      })
    );

    const openCodePermission = {
      bash: { npm: "ask" },
      edit: "allow",
    } as const;
    await ensureAgentProfileRuntimeBinding({
      openCodePermission,
      profile: AGENT_PROFILE,
      runtimeReportSubmission: {
        ...SUBMITTED_RUNTIME_REPORT,
        agentControllerRef: "builtin:opencode",
      },
      writeMode: "reconnect",
    });
    expect(ensurePrimaryBindingMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentControllerRef: "builtin:opencode",
        openCodePermission,
        writeMode: "reconnect",
      })
    );
  });

  it("skips Human Profiles without creating Binding truth", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const result = await ensureAgentProfileRuntimeBinding({
      profile: {
        ...AGENT_PROFILE,
        profileKind: "human",
      },
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(result).toMatchObject({
      reason: "profile_not_agent",
      status: "skipped",
    });
    expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
  });

  it("does not call Binding API when Runtime reporting lacks authority evidence", async () => {
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const submissions: RuntimeAgentControllerReportSubmission[] = [
      {
        ...SUBMITTED_RUNTIME_REPORT,
        openMeldServiceRuntimeId: "",
      },
      {
        ...SUBMITTED_RUNTIME_REPORT,
        agentControllerReportStatus: "rejected",
      },
      {
        agentControllerRef: "builtin:codex",
        reason: "write_failed",
        reasonCodes: ["runtime.reporting.write_failed"],
        source: "runtime_reporting_api",
        status: "failed",
      },
    ];
    for (const runtimeReportSubmission of submissions) {
      const result = await ensureAgentProfileRuntimeBinding({
        profile: AGENT_PROFILE,
        runtimeReportSubmission,
      });

      expect(result).toMatchObject({
        reason: "runtime_reporting_unavailable",
        status: "unavailable",
      });
    }
    expect(ensurePrimaryBindingMock).not.toHaveBeenCalled();
  });

  it("does not treat accepted Binding truth as runnable when no local service session was notified", async () => {
    notifyRouteCatalogChangedMock.mockResolvedValueOnce({
      notifiedSessions: 0,
      ok: true,
    });
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const result = await ensureAgentProfileRuntimeBinding({
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(result).toEqual({
      reason: "local_execution_evidence_unavailable",
      reasonCodes: ["agent_profile_binding.local_service_not_connected"],
      routable: false,
      source: "agent_profile_binding_api",
      status: "unavailable",
    });
    expect(getExecutionReadinessMock).not.toHaveBeenCalled();
  });

  it("keeps Binding rejection explicit and never reports claim success", async () => {
    ensurePrimaryBindingMock.mockResolvedValue({
      binding: {
        agentProfileId: "agt_existing",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            authority: "openmeld_service_runtime",
            value: "runtime-1",
          },
        },
      },
      grantsClaimSuccess: false,
      reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
      routable: false,
      status: "rejected",
    });
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const result = await ensureAgentProfileRuntimeBinding({
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(result).toEqual({
      existingBinding: {
        agentControllerRef: "builtin:codex",
        agentProfileId: "agt_existing",
        openMeldServiceRuntimeId: "runtime-1",
      },
      reason: "binding_rejected",
      reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
      routable: false,
      source: "agent_profile_binding_api",
      status: "rejected",
    });
  });

  it("leads the unavailable reason codes with a truthful support code, not a success code", async () => {
    getExecutionReadinessMock.mockResolvedValue(
      unreadyExecutionReadinessWithLeadingSuccessCode()
    );
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    const result = await ensureAgentProfileRuntimeBinding({
      profile: AGENT_PROFILE,
      runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
    });

    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("local_execution_evidence_unavailable");
    // A success code must never be presented as the primary support code for
    // an unavailable Binding.
    expect(result.reasonCodes[0]).toBe("route.not_registered");
    expect(result.reasonCodes[0]).not.toBe(
      "agent_profile_binding.command_eligible"
    );
    // The full list is preserved for diagnostics.
    expect(result.reasonCodes).toContain(
      "agent_profile_binding.command_eligible"
    );
  });

  it("keeps Binding API failures explicit and unavailable", async () => {
    ensurePrimaryBindingMock.mockRejectedValue(
      new Error("gateway unavailable")
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on behavior.
    });
    const { ensureAgentProfileRuntimeBinding } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    try {
      const result = await ensureAgentProfileRuntimeBinding({
        profile: AGENT_PROFILE,
        runtimeReportSubmission: SUBMITTED_RUNTIME_REPORT,
      });

      expect(result).toEqual({
        reason: "binding_write_failed",
        reasonCodes: ["agent_profile_binding.write_failed"],
        routable: false,
        source: "agent_profile_binding_api",
        status: "unavailable",
      });
    } finally {
      warnSpy.mockRestore();
    }
  });
});

function readyExecutionReadiness() {
  return {
    agentExecutionReadiness: {
      displayState: "ready",
      facts: {
        binding: {
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          source: "binding_truth",
        },
        claim: {
          executionBlocked: false,
          grantsClaimSuccess: false,
          reasonCodes: ["claim.eligible"],
          source: "claim_diagnostics",
        },
        localService: {
          reachable: true,
          reasonCodes: ["runtime_transport.session_reachable"],
          refreshable: false,
          source: "runtime_transport",
        },
        profile: {
          active: true,
          reasonCodes: ["agent_profile.active"],
          source: "profile_identity",
        },
        route: {
          deviceId: "device-1",
          lane: "openmeld-dev",
          observedAt: "2026-05-14T00:00:00.000Z",
          online: true,
          reasonCodes: ["daemon_route.online"],
          source: "daemon_route",
        },
        runtime: {
          ready: true,
          reasonCodes: ["runtime.ready"],
          source: "prepare_readiness",
        },
        service: {
          executionCompatible: true,
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCodes: ["service.execution_compatible"],
          source: "runtime_transport",
        },
      },
      primaryAction: "none",
      reasonCodes: ["agent_execution.ready"],
    },
    agentProfileId: "agt-codex",
    agentControllerRef: "builtin:codex",
    daemonRouteObservation: {
      observedAt: "2026-05-14T00:00:00.000Z",
      reasonCode: "online",
      status: "online",
    },
    generatedAt: "2026-05-14T00:00:00.000Z",
    ownerUserId: "user-1",
    primaryActionPlan: {
      action: "none",
      target: null,
    },
    profileName: "Codex",
    routeDeviceId: "device-1",
    routeLane: "openmeld-dev",
    runtimeDeviceDisplayName: "Felix's MacBook Pro",
  };
}

function unreadyExecutionReadinessWithLeadingSuccessCode() {
  const base = readyExecutionReadiness();
  return {
    ...base,
    agentExecutionReadiness: {
      ...base.agentExecutionReadiness,
      displayState: "blocked",
      // Readiness assembles codes profile -> binding -> ... so the healthy
      // Binding's success code lands first while the real blocker comes later.
      reasonCodes: [
        "agent_profile_binding.command_eligible",
        "route.not_registered",
      ],
      primaryAction: "connect_this_computer",
    },
  };
}

describe("formatAgentProfileBindingUpdateFailure", () => {
  it("explains that an Agent's Profile cannot change harness", async () => {
    const { formatAgentProfileBindingUpdateFailure } = await import(
      "../src/system/ensure-agent-profile-runtime-binding"
    );

    expect(
      formatAgentProfileBindingUpdateFailure([
        "agent_profile_binding.member_agent_harness_locked",
      ])
    ).toBe(
      "This Agent Profile belongs to an Agent and cannot move to another harness. Create a Profile under that harness's Agent instead. (agent_profile_binding.member_agent_harness_locked)"
    );
    expect(
      formatAgentProfileBindingUpdateFailure([
        "agent_profile_binding.primary_conflict",
      ])
    ).toBe(
      "Agent Profile Binding update failed: agent_profile_binding.primary_conflict"
    );
  });
});
