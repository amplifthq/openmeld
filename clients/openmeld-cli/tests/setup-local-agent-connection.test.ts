import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAgentProfileBindingApiMock,
  createCliApiClientFoundationMock,
  canUseInteractivePromptsMock,
  createPresenterMock,
  inspectDaemonServiceInventoryMock,
  prepareLocalAgentReadinessMock,
  readDaemonServiceContractMock,
  submitProfileRuntimeAgentControllerReportMock,
  resolvePrepareReadinessApiEvidenceMock,
  resolveBaseUrlMock,
  resolveCurrentDaemonExpectedVersionMock,
  resolveCurrentReplyReadinessSnapshotMock,
  resolveOpenMeldProfileOrNullMock,
  resolveRuntimeContextMock,
  runAuthLoginMock,
  runAgentsRepairMock,
  runDaemonBackgroundStartForDecisionMock,
  runDaemonInstallMock,
  runDaemonReinstallMock,
  runDaemonRunMock,
  runPrepareSessionExecutorMock,
} = vi.hoisted(() => ({
  createAgentProfileBindingApiMock: vi.fn(),
  createCliApiClientFoundationMock: vi.fn(),
  canUseInteractivePromptsMock: vi.fn(),
  createPresenterMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  prepareLocalAgentReadinessMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  submitProfileRuntimeAgentControllerReportMock: vi.fn(),
  resolvePrepareReadinessApiEvidenceMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveCurrentDaemonExpectedVersionMock: vi.fn(),
  resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveRuntimeContextMock: vi.fn(),
  runAuthLoginMock: vi.fn(),
  runAgentsRepairMock: vi.fn(),
  runDaemonBackgroundStartForDecisionMock: vi.fn(),
  runDaemonInstallMock: vi.fn(),
  runDaemonReinstallMock: vi.fn(),
  runDaemonRunMock: vi.fn(),
  runPrepareSessionExecutorMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: createAgentProfileBindingApiMock,
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: resolveRuntimeContextMock,
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: canUseInteractivePromptsMock,
}));

vi.mock("../src/runtime/presenter/index", () => ({
  createPresenter: createPresenterMock,
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/config/base-url", () => ({
  normalizeGatewayBaseUrlOrNull: (value: string | null | undefined) =>
    value ?? null,
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: readDaemonServiceContractMock,
}));

vi.mock("../src/system/local-agent-readiness-preparation", () => ({
  prepareLocalAgentReadiness: prepareLocalAgentReadinessMock,
}));

vi.mock("../src/system/prepare-readiness-api-evidence", () => ({
  resolvePrepareReadinessApiEvidence: resolvePrepareReadinessApiEvidenceMock,
}));

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-reporting-submission",
  () => ({
    submitProfileRuntimeAgentControllerReport:
      submitProfileRuntimeAgentControllerReportMock,
  })
);

vi.mock("../src/system/current-reply-readiness-snapshot", () => ({
  resolveCurrentReplyReadinessSnapshot:
    resolveCurrentReplyReadinessSnapshotMock,
}));

vi.mock("../src/local-service/lifecycle/current-daemon-version", () => ({
  resolveCurrentDaemonExpectedVersion: resolveCurrentDaemonExpectedVersionMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
}));

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: runAuthLoginMock,
}));

vi.mock("../src/commands/service", () => ({
  runDaemonBackgroundStartForDecision: runDaemonBackgroundStartForDecisionMock,
  runDaemonInstall: runDaemonInstallMock,
  runDaemonReinstall: runDaemonReinstallMock,
  runDaemonRun: runDaemonRunMock,
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: createCliApiClientFoundationMock,
}));

vi.mock("../src/commands/prepare-session-executor", () => ({
  runPrepareSessionExecutor: runPrepareSessionExecutorMock,
}));

vi.mock("../src/commands/agents", async () => {
  const actual = await vi.importActual<typeof import("../src/commands/agents")>(
    "../src/commands/agents"
  );
  return {
    ...actual,
    runAgentsRepair: runAgentsRepairMock,
  };
});

describe("local setup executor", () => {
  const presenterStub = {
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
    view: "human",
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "agent",
      viewMode: "agent",
      interactive: false,
    });
    createPresenterMock.mockReturnValue(presenterStub);
    canUseInteractivePromptsMock.mockReturnValue(false);
    resolveOpenMeldProfileOrNullMock.mockImplementation(
      (input?: { openMeldProfileId?: string; profileKind?: string }) => {
        if (input?.profileKind === "human") {
          return Promise.resolve({
            openMeldProfileId: input.openMeldProfileId ?? "hum-selected",
            profileName: "Felix",
            profileHandle: "felix",
            profileKind: "human",
            ownerUserId: "user-1",
            source: "cli_test",
            status: "active",
            createdByUserId: "user-1",
            lastUsedAt: null,
            createdAt: "2026-04-17T00:00:00.000Z",
            updatedAt: "2026-04-17T00:00:00.000Z",
          });
        }

        return Promise.resolve({
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
        });
      }
    );
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.test");
    readDaemonServiceContractMock.mockResolvedValue({
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      autoStart: true,
      bundleId: "bundle-1",
      daemonVersion: "1.0.0",
      desiredState: "background",
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      generation: 1,
      heartbeatMs: 25_000,
      lane: "dev-local",
      profileId: "agt-codex",
      serviceController: "launchd",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    resolveCurrentDaemonExpectedVersionMock.mockReturnValue("1.0.0");
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createServiceInventory()
    );
    prepareLocalAgentReadinessMock.mockResolvedValue({
      status: "prepared",
      profiles: [],
    });
    runAuthLoginMock.mockResolvedValue("completed");
    runPrepareSessionExecutorMock.mockResolvedValue({
      snapshot: {
        selectedLocalAgentIds: [],
      },
      status: "completed",
    });
    runDaemonInstallMock.mockResolvedValue(undefined);
    runDaemonReinstallMock.mockResolvedValue({
      ok: true,
      result: "completed",
      desiredState: "background",
      serviceState: "running",
    });
    runDaemonBackgroundStartForDecisionMock.mockResolvedValue("started");
    runDaemonRunMock.mockResolvedValue({
      ok: true,
    });
    createCliApiClientFoundationMock.mockReturnValue({ foundation: true });
    createAgentProfileBindingApiMock.mockReturnValue({
      ensurePrimaryBinding: vi.fn().mockResolvedValue({
        binding: {
          bindingState: "enabled_primary",
          agentControllerRef: "builtin:codex",
          grantsClaimSuccess: false,
          reasonCodes: [],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
          target: {
            agentProfileId: "agt-codex",
          },
        },
        outcome: "created",
        reasonCodes: [],
        routable: true,
        status: "accepted",
      }),
      getExecutionReadiness: vi.fn().mockResolvedValue({
        agentExecutionReadiness: {
          displayState: "ready",
          facts: {},
          primaryAction: "none",
          reasonCodes: ["agent_execution.ready"],
        },
      }),
      notifyRouteCatalogChanged: vi.fn().mockResolvedValue({
        fallbackReason: null,
        notifiedSessions: 1,
        ok: true,
      }),
    });
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        replyReadiness: "not_ready",
        reasonText:
          "OpenMeld Service is installed but not running on this computer.",
        reasonCodes: ["service.not_running"],
      },
      agentReplyReadiness: {
        replyReadiness: "not_ready",
        reasonText:
          "OpenMeld Service is installed but not running on this computer.",
        reasonCodes: ["service.not_running"],
        deviceReplyReadiness: {
          replyReadiness: "not_ready",
          reasonText:
            "OpenMeld Service is installed but not running on this computer.",
          reasonCodes: ["service.not_running"],
        },
      },
      daemonRouteObservation: {
        status: "not_registered",
        detailText: "OpenMeld has not registered this computer yet.",
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    resolvePrepareReadinessApiEvidenceMock.mockResolvedValue({
      reason: "service_contract_unavailable",
      reasonCodes: ["prepare_readiness.service_contract_unavailable"],
      runnableCapabilityCount: 0,
      nonRunnableCapabilityCount: 0,
      source: "prepare_readiness_api",
      status: "unavailable",
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      reason: "service_contract_unavailable",
      reasonCodes: ["runtime.reporting.service_contract_unavailable"],
      source: "runtime_reporting_api",
      status: "unavailable",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("delegates start-session preparation to the prepare session executor", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });

    await runSetupLocalAgentConnection({
      startSession: "starttok_demo",
      view: "human",
    });

    const emittedLines = presenterStub.line.mock.calls.map(
      ([line]) => line as { code: string; text: string }
    );
    const logoIndex = emittedLines.findIndex((line) =>
      line.text.includes("█████")
    );
    const titleIndex = emittedLines.findIndex((line) =>
      line.text.includes("OPENMELD CLI")
    );
    const subtitleIndex = emittedLines.findIndex((line) =>
      line.text.includes("People and agents, working as one.")
    );

    expect(emittedLines[0]).toEqual({
      code: "setup.local_agent_connection.header.logo_spacing",
      text: "",
    });
    expect(logoIndex).toBeGreaterThan(0);
    expect(titleIndex).toBeGreaterThan(logoIndex);
    expect(subtitleIndex).toBe(titleIndex + 1);
    expect(runPrepareSessionExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway.openmeld.test",
        startSession: "starttok_demo",
        view: "human",
      })
    );
    expect(prepareLocalAgentReadinessMock).not.toHaveBeenCalled();
  });

  it("returns prepare session completion facts from start-session preparation", async () => {
    runPrepareSessionExecutorMock.mockResolvedValueOnce({
      completionFacts: {
        openMeldServiceRuntimeIdentity: {
          deviceId: "device-session",
          runtimeLane: "dev-local",
        },
        runtimeReports: [
          {
            agentId: "codex",
            agentControllerRef: "builtin:codex",
            localParticipationState: "ready",
            reasonCodes: [],
            runtimeReportSubmission: {
              agentControllerReportStatus: "accepted",
              agentControllerRef: "builtin:codex",
              openMeldServiceRuntimeId: "runtime-session",
              deviceId: "device-session",
              lane: "dev-local",
              status: "submitted",
            },
          },
        ],
        selectedLocalAgentIds: ["codex"],
      },
      snapshot: {
        prepareSessionId: "prepare-session",
        selectedLocalAgentIds: ["codex"],
      },
      status: "completed",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    const result = await runSetupLocalAgentConnection({
      startSession: "starttok_demo",
      view: "agent",
    });

    expect(result).toMatchObject({
      completionFacts: {
        openMeldServiceRuntimeIdentity: {
          deviceId: "device-session",
          runtimeLane: "dev-local",
        },
        selectedLocalAgentIds: ["codex"],
      },
      status: "completed",
    });
  });

  it("preserves start-session cancellation as a cancelled setup", async () => {
    runPrepareSessionExecutorMock.mockResolvedValueOnce({
      reason: "user_cancelled",
      status: "not_completed",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        startSession: "starttok_demo",
        view: "human",
      })
    ).resolves.toEqual({
      reason: "cancelled",
      status: "not_completed",
    });
  });

  it("keeps the setup logo out of agent-view start-session output", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      startSession: "starttok_demo",
      view: "agent",
    });

    expect(presenterStub.line).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.header.logo",
      })
    );
    expect(presenterStub.line).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.header.tagline",
      })
    );
    expect(runPrepareSessionExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway.openmeld.test",
        startSession: "starttok_demo",
        view: "agent",
      })
    );
  });

  it("passes all local-agent selection into start-session preparation", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      localAgents: "all",
      startSession: "starttok_demo",
      view: "agent",
    });

    expect(runPrepareSessionExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localAgentSelection: {
          mode: "all",
        },
        startSession: "starttok_demo",
      })
    );
  });

  it("deduplicates specific local-agent selection for start-session preparation", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      localAgent: ["codex", "codex", "claude-code"],
      startSession: "starttok_demo",
      view: "agent",
    });

    expect(runPrepareSessionExecutorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localAgentSelection: {
          localAgentIds: ["codex", "claude-code"],
          mode: "specific",
        },
      })
    );
  });

  it("fails before handoff when start-session is mixed with standalone prepare flags", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        profile: "agt-codex",
        startSession: "starttok_demo",
        view: "agent",
      })
    ).rejects.toThrow(
      "--start-session cannot be combined with --profile, --human-profile, or --agent."
    );

    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(prepareLocalAgentReadinessMock).not.toHaveBeenCalled();
    expect(runAgentsRepairMock).not.toHaveBeenCalled();
  });

  it("rejects standalone local-agent selection without a start-session token or profile", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        localAgent: ["codex"],
        view: "agent",
      })
    ).rejects.toThrow("--local-agent requires --start-session or --profile.");

    await expect(
      runSetupLocalAgentConnection({
        localAgents: "all",
        view: "agent",
      })
    ).rejects.toThrow("--local-agents requires --start-session.");
  });

  it("rejects conflicting start-session local-agent selectors", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        localAgent: ["codex"],
        localAgents: "all",
        startSession: "starttok_demo",
        view: "agent",
      })
    ).rejects.toThrow(
      "use either --local-agents <all|none> or --local-agent <id...>, not both"
    );
  });

  it("prepares a local agent profile and emits its own readiness summary", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(prepareLocalAgentReadinessMock).toHaveBeenCalledWith({
      profiles: [
        expect.objectContaining({
          openMeldProfileId: "agt-codex",
        }),
      ],
      interactive: false,
      view: "agent",
    });
    expect(resolveCurrentReplyReadinessSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checkGatewayChain: true,
        ownerUserId: "user-1",
      })
    );
    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          profile: expect.objectContaining({
            profileId: "agt-codex",
          }),
          localAgentReadiness: expect.objectContaining({
            status: "ready",
          }),
          openMeldService: expect.objectContaining({
            status: "not_running",
          }),
        }),
      })
    );
    expect(runDaemonRunMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
  });

  it("passes explicit local-agent selection into standalone profile setup", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      localAgent: ["codex"],
      profile: "agt-codex",
      view: "agent",
    });

    expect(prepareLocalAgentReadinessMock).toHaveBeenCalledWith({
      explicitLocalAgentSelections: new Map([["agt-codex", "codex"]]),
      profiles: [
        expect.objectContaining({
          openMeldProfileId: "agt-codex",
        }),
      ],
      interactive: false,
      view: "agent",
    });
  });

  it("keeps the prepared profile connection authoritative over an older readiness snapshot", async () => {
    prepareLocalAgentReadinessMock.mockResolvedValueOnce({
      preparedConnections: [
        {
          agentProfileBindingEnsure: {
            outcome: "reconnected",
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: true,
            source: "agent_profile_binding_api",
            status: "accepted",
          },
          profileId: "agt-codex",
          runtimeReport: {
            agentId: "codex",
            agentControllerRef: "builtin:codex",
            localParticipationState: "ready",
            reasonCodes: [],
            runtimeReportSubmission: {
              agentControllerRef: "builtin:codex",
              agentControllerReportStatus: "accepted",
              deviceId: "device-1",
              lane: "dev-local",
              reasonCodes: [],
              registrationStatus: "reused",
              openMeldServiceRuntimeId: "runtime_current",
              source: "runtime_reporting_api",
              status: "submitted",
            },
          },
        },
      ],
      profiles: [],
      status: "prepared",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    const result = await runSetupLocalAgentConnection({
      localAgent: ["codex"],
      profile: "agt-codex",
      view: "agent",
    });

    expect(result).toMatchObject({
      completionFacts: {
        runtimeReports: [
          {
            agentControllerRef: "builtin:codex",
            runtimeReportSubmission: {
              status: "submitted",
              openMeldServiceRuntimeId: "runtime_current",
            },
          },
        ],
        selectedLocalAgentIds: ["codex"],
        openMeldServiceRuntimeIdentity: {
          deviceId: "device-1",
          runtimeLane: "dev-local",
        },
      },
      status: "completed",
    });
    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          binding: expect.objectContaining({
            status: "accepted",
          }),
          serverConnectionReport: expect.objectContaining({
            status: "submitted",
            openMeldServiceRuntimeId: "runtime_current",
          }),
        }),
      })
    );
  });

  it("rejects multiple local-agent ids for one standalone profile setup", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        localAgent: ["codex", "claude-code"],
        profile: "agt-codex",
        view: "agent",
      })
    ).rejects.toThrow(
      "--profile setup accepts exactly one --local-agent <id>."
    );
  });

  it("starts stale service state before standalone human prepare continues", async () => {
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createServiceInventory({
          installedVersion: "0.3.49",
          runtimeStatus: "stale",
        })
      )
      .mockResolvedValueOnce(createServiceInventory());
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.openmeld.test",
      view: "human",
    });
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
    const startCallOrder =
      runDaemonBackgroundStartForDecisionMock.mock.invocationCallOrder[0];
    const prepareCallOrder =
      prepareLocalAgentReadinessMock.mock.invocationCallOrder[0];
    if (startCallOrder === undefined || prepareCallOrder === undefined) {
      throw new Error("Expected service start and local agent preparation.");
    }
    expect(startCallOrder).toBeLessThan(prepareCallOrder);
  });

  it("ensures formal Agent Profile Binding after accepted standalone Runtime reporting", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile is ready for Space replies from this device",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "registered",
        detailText: "OpenMeld has registered this computer.",
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    resolvePrepareReadinessApiEvidenceMock.mockResolvedValue({
      status: "ready",
      source: "prepare_readiness_api",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      runnableCapabilityCount: 1,
      nonRunnableCapabilityCount: 0,
      reasonCodes: [],
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "created",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(createAgentProfileBindingApiMock).toHaveBeenCalledTimes(1);
    const bindingApi = createAgentProfileBindingApiMock.mock.results[0]?.value;
    expect(bindingApi.ensurePrimaryBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileId: "agt-codex",
        agentControllerRef: "builtin:codex",
        deviceId: "device-1",
        lane: "dev-local",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    );
    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          binding: expect.objectContaining({
            label: "Connected to this computer.",
            routable: true,
            status: "accepted",
          }),
          serverConnectionReport: expect.objectContaining({
            openMeldServiceRuntimeId: "runtime_opaque_1",
            status: "submitted",
          }),
        }),
      })
    );
  });

  it("marks standalone setup unavailable for Wake when formal Binding ensure fails", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile can reply from Space when mentioned",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "online",
        detailText: null,
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "created",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    createAgentProfileBindingApiMock.mockReturnValueOnce({
      ensurePrimaryBinding: vi.fn().mockResolvedValue({
        reasonCodes: ["agent_profile_binding.owner_mismatch"],
        routable: false,
        status: "rejected",
      }),
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          binding: expect.objectContaining({
            label:
              "Reconnect needed - this agent is not connected to this computer.",
            reasonCodes: ["agent_profile_binding.owner_mismatch"],
            routable: false,
            status: "rejected",
          }),
          connection: expect.objectContaining({
            canReplyFromThisComputer: false,
            canBeWokenInSpaces: false,
            reasonCodes: ["agent_profile_binding.owner_mismatch"],
            status: "not_ready",
          }),
          guidance: expect.objectContaining({
            summary:
              "This agent is connected to a different OpenMeld account or computer setup.",
            nextSteps: [
              "Open this Agent in OpenMeld Web and reconnect it to this computer.",
              "If you are signed into the wrong OpenMeld account, run openmeld login first.",
            ],
          }),
          serverConnectionReport: expect.objectContaining({
            status: "submitted",
          }),
        }),
      })
    );
  });

  it("does not present local reply readiness as final Agent readiness in human prepare output", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile can reply from Space when mentioned",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "online",
        detailText: null,
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "reused",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    createAgentProfileBindingApiMock.mockReturnValueOnce({
      ensurePrimaryBinding: vi.fn().mockResolvedValue({
        reasonCodes: ["agent_profile_binding.primary_conflict"],
        routable: false,
        status: "rejected",
      }),
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    const output = presenterStub.line.mock.calls
      .map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain(
      "Local setup on this computer: Local setup evidence is available on this computer."
    );
    expect(output).toContain(
      "Agent connection: Reconnect needed - this agent is not connected to this computer."
    );
    expect(output).toContain(
      "Do This: Open this Agent in OpenMeld Web and reconnect it to this computer."
    );
    expect(output).not.toContain("Background replies from this computer");
    expect(output).not.toContain("This profile can reply from Space");
    expect(output).not.toContain("openmeld setup --profile agt-codex");
  });

  it("marks standalone prepare not ready when Runtime reporting auth targets the wrong environment", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile can reply from Space when mentioned",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "online",
        detailText: null,
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      authBaseUrl: "http://localhost:8788",
      agentControllerRef: "builtin:codex",
      gatewayUrl: "https://gateway.openmeld.invalid",
      guidanceReason: "mismatch",
      reason: "auth_gateway_mismatch",
      reasonCodes: ["runtime.reporting.auth_gateway_mismatch"],
      source: "runtime_reporting_api",
      status: "failed",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(createAgentProfileBindingApiMock).not.toHaveBeenCalled();
    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          binding: expect.objectContaining({
            label:
              "Setup incomplete - OpenMeld could not finish connecting this agent to this computer.",
            reasonCodes: [
              "agent_profile_binding.runtime_reporting_unavailable",
            ],
            routable: false,
            status: "unavailable",
          }),
          connection: expect.objectContaining({
            canReplyFromThisComputer: false,
            canBeWokenInSpaces: false,
            reasonCodes: [
              "agent_profile_binding.runtime_reporting_unavailable",
            ],
            status: "not_ready",
          }),
          guidance: expect.objectContaining({
            summary:
              "Wrong OpenMeld Environment: This command is using a different OpenMeld environment.",
            nextSteps: ["openmeld login", "openmeld setup --profile agt-codex"],
          }),
          serverConnectionReport: expect.objectContaining({
            reason: "auth_gateway_mismatch",
            status: "failed",
          }),
        }),
      })
    );
  });

  it("keeps detailed local reply readiness out of the default agent payload", async () => {
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile can reply from Space when mentioned",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "online",
        detailText: null,
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "reused",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    const payload = presenterStub.data.mock.calls[0]?.[0]?.payload as
      | {
          agentReplyReadiness?: unknown;
          deviceReplyReadiness?: unknown;
          detailsCommand?: string;
          diagnostics?: unknown;
        }
      | undefined;
    expect(payload?.agentReplyReadiness).toBeUndefined();
    expect(payload?.deviceReplyReadiness).toBeUndefined();
    expect(payload?.diagnostics).toBeUndefined();
    expect(payload?.detailsCommand).toBe(
      "openmeld service status --profile agt-codex --view agent"
    );
  });

  it("does not show reconnect guidance for service check failures", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValueOnce({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile can reply from Space when mentioned",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "online",
        detailText: null,
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "reused",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    createAgentProfileBindingApiMock.mockReturnValueOnce({
      ensurePrimaryBinding: vi.fn().mockResolvedValue({
        outcome: "reused",
        reasonCodes: [],
        routable: true,
        status: "accepted",
      }),
      notifyRouteCatalogChanged: vi.fn().mockResolvedValue({
        fallbackReason: "no_session",
        notifiedSessions: 0,
        ok: false,
      }),
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          binding: expect.objectContaining({
            label:
              "OpenMeld Service check needed - this computer has not checked in yet.",
            reasonCodes: ["agent_profile_binding.local_service_not_connected"],
          }),
          connection: {
            canBeWokenInSpaces: false,
            canReplyFromThisComputer: false,
            nextAction: "openmeld-dev service status",
            reasonCodes: ["agent_profile_binding.local_service_not_connected"],
            status: "not_ready",
            summary:
              "This Agent Profile cannot reply from this computer in Spaces yet.",
          },
          guidance: expect.objectContaining({
            summary:
              "OpenMeld Service on this computer has not checked in for this agent yet.",
            nextSteps: [
              "openmeld-dev service status",
              "After OpenMeld Service is running, open this Agent in OpenMeld Web and run setup for this computer.",
            ],
          }),
        }),
      })
    );
    const payload = presenterStub.data.mock.calls[0]?.[0]?.payload as
      | { guidance?: { nextSteps?: string[] } }
      | undefined;
    expect(payload?.guidance?.nextSteps?.join("\n")).not.toContain("reconnect");
    const summaryLine = presenterStub.line.mock.calls.find(
      ([line]) =>
        (line as { code?: string }).code ===
        "setup.local_agent_connection.summary"
    )?.[0] as { text?: string } | undefined;
    expect(summaryLine?.text).toContain("agent_connection=not_ready");
    expect(summaryLine?.text).toContain("can_reply_from_this_computer=false");
    expect(summaryLine?.text).toContain(
      "next_action=openmeld-dev service status"
    );
    expect(summaryLine?.text).not.toContain("Complete");
  });

  it("does not read Prepare readiness API evidence for default agent view output", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(resolvePrepareReadinessApiEvidenceMock).not.toHaveBeenCalled();
    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          localAgentReadiness: expect.objectContaining({
            status: "ready",
          }),
          detailsCommand:
            "openmeld service status --profile agt-codex --view agent",
        }),
      })
    );
    expect(runDaemonRunMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
  });

  it("does not read Prepare readiness API evidence for human view output", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(resolvePrepareReadinessApiEvidenceMock).not.toHaveBeenCalled();
    expect(presenterStub.data).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
      })
    );
  });

  it("keeps local prepare success separate when Runtime report submission fails", async () => {
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      reason: "write_failed",
      reasonCodes: ["runtime.reporting.write_failed"],
      source: "runtime_reporting_api",
      status: "failed",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "agent",
    });

    expect(submitProfileRuntimeAgentControllerReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localParticipationState: "needs_openmeld_service",
        profile: expect.objectContaining({
          openMeldProfileId: "agt-codex",
        }),
        reasonCodes: ["service.not_running"],
      })
    );
    expect(presenterStub.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
        payload: expect.objectContaining({
          localAgentReadiness: expect.objectContaining({
            status: "ready",
          }),
          serverConnectionReport: expect.objectContaining({
            reason: "write_failed",
            status: "failed",
          }),
        }),
      })
    );
  });

  it("starts OpenMeld Service after interactive local agent preparation when the service is stopped", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.openmeld.test",
      profile: "agt-codex",
      view: "human",
    });
    expect(runDaemonRunMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
  });

  it("stops standalone setup when the post-prepare service start is cancelled", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    runDaemonBackgroundStartForDecisionMock.mockImplementation(
      async (input: { profile?: string }) =>
        input.profile === "agt-codex" ? "cancelled" : "started"
    );
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        profile: "agt-codex",
        view: "human",
      })
    ).resolves.toEqual({
      reason: "cancelled",
      status: "not_completed",
    });
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.openmeld.test",
      profile: "agt-codex",
      view: "human",
    });
  });

  it("refreshes OpenMeld Service when local service run would block on bundle drift", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createServiceInventory({
          anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
          runtimeStatus: "stale",
        })
      )
      .mockResolvedValue(createServiceInventory());
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        replyReadiness: "ready",
        reasonText:
          "This device is ready for Space replies from local agent profiles",
        reasonCodes: [],
      },
      agentReplyReadiness: {
        replyReadiness: "ready",
        reasonText: "This profile is ready for Space replies from this device",
        reasonCodes: [],
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
      },
      daemonRouteObservation: {
        status: "registered",
        detailText: "OpenMeld has registered this computer.",
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "https://gateway.openmeld.test",
        view: "human",
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(runDaemonRunMock).not.toHaveBeenCalled();
  });

  it("hands healthy version drift to the background service update worker", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createServiceInventory({
        anomalyCodes: ["version_outdated", "bundle_version_drift"],
        runtimeStatus: "running",
      })
    );
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        replyReadiness: "blocked",
        reasonText: "OpenMeld Service needs an update.",
        reasonCodes: ["service.drifted"],
      },
      agentReplyReadiness: {
        replyReadiness: "blocked",
        reasonText: "OpenMeld Service needs an update.",
        reasonCodes: ["service.drifted"],
        deviceReplyReadiness: {
          replyReadiness: "blocked",
          reasonText: "OpenMeld Service needs an update.",
          reasonCodes: ["service.drifted"],
        },
      },
      daemonRouteObservation: {
        status: "registered",
        detailText: "OpenMeld has registered this computer.",
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        displayAction: "update",
      }),
      expect.objectContaining({
        skipConfirm: true,
      })
    );
  });

  it("continues the current prepare result after refreshing OpenMeld Service drift", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    resolveCurrentReplyReadinessSnapshotMock
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          replyReadiness: "blocked",
          reasonText:
            "OpenMeld Service artifact drift was detected on this device",
          reasonCodes: ["service.drifted"],
        },
        agentReplyReadiness: {
          replyReadiness: "blocked",
          reasonText:
            "OpenMeld Service artifact drift was detected on this device",
          reasonCodes: ["service.drifted"],
          deviceReplyReadiness: {
            replyReadiness: "blocked",
            reasonText:
              "OpenMeld Service artifact drift was detected on this device",
            reasonCodes: ["service.drifted"],
          },
        },
        daemonRouteObservation: {
          status: "not_registered",
          detailText: "OpenMeld has not registered this computer yet.",
        },
        openClawLocalDiagnostics: null,
        profileWorkspaceRuntimeResolution: {
          status: "ready",
          workspacePath: "/tmp/openmeld-workspace",
          source: "stored_profile",
        },
      })
      .mockResolvedValueOnce({
        deviceReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This device is ready for Space replies from local agent profiles",
          reasonCodes: [],
        },
        agentReplyReadiness: {
          replyReadiness: "ready",
          reasonText:
            "This profile is ready for Space replies from this device",
          reasonCodes: [],
          deviceReplyReadiness: {
            replyReadiness: "ready",
            reasonText:
              "This device is ready for Space replies from local agent profiles",
            reasonCodes: [],
          },
        },
        daemonRouteObservation: {
          status: "registered",
          detailText: "OpenMeld has registered this computer.",
        },
        openClawLocalDiagnostics: null,
        profileWorkspaceRuntimeResolution: {
          status: "ready",
          workspacePath: "/tmp/openmeld-workspace",
          source: "stored_profile",
        },
      });
    submitProfileRuntimeAgentControllerReportMock.mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentControllerReportStatus: "accepted",
      deviceId: "device-1",
      lane: "dev-local",
      reasonCodes: [],
      registrationStatus: "reused",
      openMeldServiceRuntimeId: "runtime_opaque_1",
      source: "runtime_reporting_api",
      status: "submitted",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(runDaemonReinstallMock).toHaveBeenCalledTimes(1);
    expect(resolveCurrentReplyReadinessSnapshotMock).toHaveBeenCalledTimes(2);
    expect(submitProfileRuntimeAgentControllerReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        localParticipationState: "ready",
        reasonCodes: [],
      })
    );
    const reinstallOrder = runDaemonReinstallMock.mock.invocationCallOrder[0];
    const submitOrder =
      submitProfileRuntimeAgentControllerReportMock.mock.invocationCallOrder[0];
    if (reinstallOrder === undefined || submitOrder === undefined) {
      throw new Error("Expected refresh and runtime report submission calls.");
    }
    expect(reinstallOrder).toBeLessThan(submitOrder);
  });

  it("does not submit fake ready runtime reporting when service refresh fails", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createServiceInventory({
        anomalyCodes: ["runtime_contract_mismatch"],
        runtimeStatus: "stale",
      })
    );
    runDaemonReinstallMock.mockRejectedValue(
      new Error("service refresh failed")
    );
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        profile: "agt-codex",
        view: "human",
      })
    ).rejects.toThrow("service refresh failed");

    expect(
      submitProfileRuntimeAgentControllerReportMock
    ).not.toHaveBeenCalled();
    expect(presenterStub.data).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
      })
    );
  });

  it("does not submit fake ready runtime reporting when service refresh returns a failed outcome", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createServiceInventory({
        anomalyCodes: ["runtime_contract_mismatch"],
        runtimeStatus: "stale",
      })
    );
    runDaemonReinstallMock.mockResolvedValue({
      backupDataPath: null,
      desiredState: "background",
      forceUsed: false,
      ok: false,
      result: "start_failed",
      serviceState: "stopped",
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        profile: "agt-codex",
        view: "human",
      })
    ).rejects.toThrow(
      "OpenMeld Service refresh did not complete: start_failed"
    );

    expect(
      submitProfileRuntimeAgentControllerReportMock
    ).not.toHaveBeenCalled();
    expect(presenterStub.data).not.toHaveBeenCalledWith(
      expect.objectContaining({
        code: "setup.local_agent_connection.result",
      })
    );
  });

  it("installs and starts OpenMeld Service after interactive preparation when the service is missing", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: true,
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue({
      deviceReplyReadiness: {
        replyReadiness: "not_ready",
        reasonText: "OpenMeld Service is not installed on this computer.",
        reasonCodes: ["service.not_installed"],
      },
      agentReplyReadiness: {
        replyReadiness: "not_ready",
        reasonText: "OpenMeld Service is not installed on this computer.",
        reasonCodes: ["service.not_installed"],
        deviceReplyReadiness: {
          replyReadiness: "not_ready",
          reasonText: "OpenMeld Service is not installed on this computer.",
          reasonCodes: ["service.not_installed"],
        },
      },
      daemonRouteObservation: {
        status: "not_registered",
        detailText: "OpenMeld has not registered this computer yet.",
      },
      openClawLocalDiagnostics: null,
      profileWorkspaceRuntimeResolution: {
        status: "ready",
        workspacePath: "/tmp/openmeld-workspace",
        source: "stored_profile",
      },
    });
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      profile: "agt-codex",
      view: "human",
    });

    expect(runDaemonInstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "https://gateway.openmeld.test",
        profile: "agt-codex",
        view: "human",
      },
      {
        suppressAgentOverview: true,
      }
    );
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.openmeld.test",
      profile: "agt-codex",
      view: "human",
    });
    expect(runDaemonRunMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
  });

  it("can target builtin local agents directly when an agent id is provided", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await runSetupLocalAgentConnection({
      agent: ["codex"],
      view: "human",
    });

    expect(runAgentsRepairMock).toHaveBeenCalledWith({
      agent: ["codex"],
      interactive: false,
      view: "human",
    });
  });

  it("retires --human-profile Web bootstrap without creating a legacy StartSession", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );

    await expect(
      runSetupLocalAgentConnection({
        humanProfile: "hum-selected",
        ott: "ott_demo",
        resetThisComputer: true,
        view: "human",
      })
    ).rejects.toThrow(
      "This OpenMeld Web setup command is retired. Run `openmeld setup` to set up this computer, or open the org-scoped Connect page in OpenMeld Web and copy a fresh setup command."
    );

    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(resolveOpenMeldProfileOrNullMock).not.toHaveBeenCalled();
    expect(prepareLocalAgentReadinessMock).not.toHaveBeenCalled();
    expect(runAgentsRepairMock).not.toHaveBeenCalled();
  });

  it("rejects a Human Profile target passed through --profile without legacy handoff", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );
    resolveOpenMeldProfileOrNullMock.mockResolvedValueOnce(
      createHumanProfile("hum-selected")
    );

    await expect(
      runSetupLocalAgentConnection({
        profile: "hum-selected",
        view: "agent",
      })
    ).rejects.toThrow(
      "`openmeld setup --profile` expects an Agent Profile, not a Human Profile. Run `openmeld setup` to set up this computer, or copy a fresh setup command from the org-scoped Connect page in OpenMeld Web."
    );

    expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
      openMeldProfileId: "hum-selected",
      allowUnauthenticated: true,
      allowDefaultFallback: false,
      persistSelection: false,
    });
    expect(prepareLocalAgentReadinessMock).not.toHaveBeenCalled();
    expect(runAgentsRepairMock).not.toHaveBeenCalled();
  });

  it("does not default human-view delegated setup into legacy Web bootstrap", async () => {
    const { runSetupLocalAgentConnection } = await import(
      "../src/commands/setup-local-agent-connection"
    );
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValueOnce(null);

    await expect(
      runSetupLocalAgentConnection({
        view: "human",
      })
    ).resolves.toEqual({
      reason: "target_selection_required",
      status: "not_completed",
    });

    expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
      openMeldProfileId: undefined,
      allowUnauthenticated: true,
      allowDefaultFallback: false,
      persistSelection: false,
    });
    expect(prepareLocalAgentReadinessMock).not.toHaveBeenCalled();
  });
});

function createHumanProfile(openMeldProfileId: string) {
  return {
    openMeldProfileId,
    profileName: "Felix",
    profileHandle: "felix",
    profileKind: "human",
    ownerUserId: "user-1",
    source: "cli_test",
    status: "active",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
  };
}

function createServiceInventory(
  input: {
    installedVersion?: string | null;
    runtimeStatus?: "not_running" | "running" | "stale" | "unknown";
    anomalyCodes?: string[];
  } = {}
) {
  const installedVersion =
    input.installedVersion === undefined ? "1.0.0" : input.installedVersion;
  return {
    activeBundleEntryPath: "/tmp/openmeld/active/openmeld.mjs",
    anomalies: (input.anomalyCodes ?? []).map((code) => ({
      code,
      message: String(code),
    })),
    expectedVersion: "1.0.0",
    installStatus:
      installedVersion === null
        ? {
            installed: false,
            state: null,
          }
        : {
            installed: true,
            state: {
              daemonVersion: installedVersion,
            },
          },
    runtimeStatus: {
      status: input.runtimeStatus ?? "running",
    },
    runtimeCommandEntryPath: "/tmp/openmeld/active/openmeld.mjs",
    runtimeCommandPathExists: true,
    runtimeContractCompatibility: {
      status: "compatible",
    },
    serviceContract: {
      autoStart: true,
      bundleId: "bundle-1",
      daemonVersion: installedVersion ?? "0.0.0",
      desiredState: "background",
      deviceId: "device-1",
      gatewayUrl: "https://gateway.openmeld.test",
      generation: 1,
      heartbeatMs: 25_000,
      lane: "dev-local",
      profileId: "agt-codex",
      schema: "openmeld-daemon-service-contract-v1",
      serviceController: "launchd",
      updatedAt: "2026-03-01T00:00:00.000Z",
      v: 1,
    },
  };
}
