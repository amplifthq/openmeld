import { setupPlanAgentViewPayloadSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertSetupServiceUpdateCompleteMock,
  collectStartLocalReadinessMock,
  createPresenterMock,
  notifyDaemonRouteCatalogChangedMock,
  resolveBaseUrlMock,
  resolveRuntimeContextMock,
  resolveSelectedAgentControllerReadinessMock,
  ensureCommandAuthenticationOrCancelMock,
  resolveLocalComponentsStatusMock,
  resolveOpenMeldProfileOrNullMock,
  runDaemonServiceParticipationGateMock,
  runSetupLocalAgentConnectionMock,
  runSetupFirstBootstrapMock,
  runSkillsEnsureMock,
  runStartLocalAgentsEnableMock,
  runLocalStateAlignmentMock,
  assertSelectedAgentControllerReportSubmissionsAcceptedMock,
  writePrepareSessionSetupBootstrapResultMock,
  writeInstalledLocalComponentsSnapshotMock,
  acquireLockMock,
  isOpenMeldLockErrorMock,
  runWithHeldLockMock,
  submitSelectedAgentControllerReportsMock,
  syncLocalSetupCurrentDeviceTargetFromServiceContractMock,
  resolveControllingTerminalSessionMock,
  turnOffUnselectedLocalAgentsForSetupMock,
  registerUnselectedLocalAgentsOffForSetupMock,
} = vi.hoisted(() => ({
  assertSetupServiceUpdateCompleteMock: vi.fn(),
  collectStartLocalReadinessMock: vi.fn(),
  createPresenterMock: vi.fn(),
  notifyDaemonRouteCatalogChangedMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveRuntimeContextMock: vi.fn(),
  resolveSelectedAgentControllerReadinessMock: vi.fn(),
  ensureCommandAuthenticationOrCancelMock: vi.fn(),
  resolveLocalComponentsStatusMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  runDaemonServiceParticipationGateMock: vi.fn(),
  runSetupLocalAgentConnectionMock: vi.fn(),
  runSetupFirstBootstrapMock: vi.fn(),
  runSkillsEnsureMock: vi.fn(),
  runStartLocalAgentsEnableMock: vi.fn(),
  runLocalStateAlignmentMock: vi.fn(),
  assertSelectedAgentControllerReportSubmissionsAcceptedMock: vi.fn(),
  writePrepareSessionSetupBootstrapResultMock: vi.fn(),
  writeInstalledLocalComponentsSnapshotMock: vi.fn(),
  acquireLockMock: vi.fn(),
  isOpenMeldLockErrorMock: vi.fn(),
  runWithHeldLockMock: vi.fn(),
  submitSelectedAgentControllerReportsMock: vi.fn(),
  syncLocalSetupCurrentDeviceTargetFromServiceContractMock: vi.fn(),
  resolveControllingTerminalSessionMock: vi.fn(),
  turnOffUnselectedLocalAgentsForSetupMock: vi.fn(),
  registerUnselectedLocalAgentsOffForSetupMock: vi.fn(),
}));

vi.mock("../src/commands/setup-service-update-truth", () => ({
  assertSetupServiceUpdateComplete: assertSetupServiceUpdateCompleteMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/config/prepare-session-api", () => ({
  writePrepareSessionSetupBootstrapResult:
    writePrepareSessionSetupBootstrapResultMock,
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: resolveRuntimeContextMock,
}));

vi.mock("../src/config/lock", () => ({
  acquireLock: acquireLockMock,
  isOpenMeldLockError: isOpenMeldLockErrorMock,
  runWithHeldLock: runWithHeldLockMock,
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => false),
}));

vi.mock("../src/runtime/presenter/index", () => ({
  createPresenter: createPresenterMock,
}));

vi.mock("../src/commands/setup-local-agent-connection", () => ({
  runSetupLocalAgentConnection: runSetupLocalAgentConnectionMock,
}));

vi.mock("../src/commands/setup-bootstrap", () => ({
  runSetupFirstBootstrap: runSetupFirstBootstrapMock,
}));

vi.mock("../src/commands/skills", () => ({
  runSkillsEnsure: runSkillsEnsureMock,
}));

vi.mock("../src/local-components/manifest", () => ({
  resolveLocalComponentsStatus: resolveLocalComponentsStatusMock,
  writeInstalledLocalComponentsSnapshot:
    writeInstalledLocalComponentsSnapshotMock,
}));

vi.mock("../src/start-local/readiness", () => ({
  collectStartLocalReadiness: collectStartLocalReadinessMock,
}));

vi.mock("../src/commands/setup-current-device", () => ({
  syncLocalSetupCurrentDeviceTargetFromServiceContract:
    syncLocalSetupCurrentDeviceTargetFromServiceContractMock,
}));

vi.mock("../src/local-service/state/route-catalog-sync-notifier", () => ({
  notifyDaemonRouteCatalogChanged: notifyDaemonRouteCatalogChangedMock,
}));

vi.mock(
  "../src/local-service/reporting/selected-agent-controller-reporting",
  () => ({
    assertSelectedAgentControllerReportSubmissionsAccepted:
      assertSelectedAgentControllerReportSubmissionsAcceptedMock,
    resolveSelectedAgentControllerReadiness:
      resolveSelectedAgentControllerReadinessMock,
    submitSelectedAgentControllerReports:
      submitSelectedAgentControllerReportsMock,
  })
);

vi.mock("../src/auth/command-auth", () => ({
  ensureCommandAuthenticationOrCancel: ensureCommandAuthenticationOrCancelMock,
}));

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: vi.fn(),
}));

vi.mock("../src/start-local/agents-local", () => ({
  runStartLocalAgentsEnable: runStartLocalAgentsEnableMock,
}));

vi.mock("../src/start-local/local-agent-choice", () => ({
  registerUnselectedLocalAgentsOffForSetup:
    registerUnselectedLocalAgentsOffForSetupMock,
  turnOffUnselectedLocalAgentsForSetup:
    turnOffUnselectedLocalAgentsForSetupMock,
}));

vi.mock("../src/system/local-service-participation-gate", () => ({
  runDaemonServiceParticipationGate: runDaemonServiceParticipationGateMock,
}));

vi.mock("../src/system/local-state-alignment", () => ({
  runLocalStateAlignment: runLocalStateAlignmentMock,
}));

vi.mock("../src/ui/controlling-terminal", () => ({
  resolveControllingTerminalSession: resolveControllingTerminalSessionMock,
}));

describe("setup command", () => {
  const presenter = {
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
    view: "agent",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    assertSetupServiceUpdateCompleteMock.mockResolvedValue(undefined);
    turnOffUnselectedLocalAgentsForSetupMock.mockResolvedValue({
      failedAgentIds: [],
      turnedOffAgentIds: [],
    });
    registerUnselectedLocalAgentsOffForSetupMock.mockResolvedValue([]);
    Reflect.deleteProperty(process.env, "OPENMELD_SETUP_FORCE_SERVICE_REFRESH");
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "agent",
      viewMode: "agent",
      interactive: false,
    });
    createPresenterMock.mockReturnValue(presenter);
    acquireLockMock.mockResolvedValue({
      path: "/tmp/openmeld-setup-command.lock",
    });
    isOpenMeldLockErrorMock.mockImplementation((error: unknown) =>
      Boolean(
        error &&
          typeof error === "object" &&
          (error as { code?: string }).code === "openmeld.locked"
      )
    );
    runWithHeldLockMock.mockImplementation(
      async (input: { run: () => Promise<unknown> }) => await input.run()
    );
    runLocalStateAlignmentMock.mockResolvedValue({
      cleanup: { removedTemporaryFiles: 0 },
      runtimeConfig: {
        migratedLegacyConfig: false,
        removedLegacyConfig: false,
      },
      selectedOpenMeldProfile: {
        migratedSessionSelections: 0,
        removedLegacyDirectory: false,
        removedLegacySelectionFile: false,
      },
      spaceCache: {
        backedUpCorruptFiles: 0,
        migratedAccountSpaceFiles: 0,
        migratedLegacyProfileFiles: 0,
        migratedLegacyViews: 0,
        removedLegacyAccountSpaceDirs: 0,
        removedLegacyProfilesDir: false,
        requiresRepair: false,
      },
      storageVersionUpdated: false,
    });
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.test");
    resolveOpenMeldProfileOrNullMock.mockResolvedValue({
      openMeldProfileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Mira",
      profileHandle: "mira",
      profileKind: "human",
      status: "active",
      ownerUserId: "user-mira",
      source: "test",
      createdByUserId: "user-mira",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    });
    ensureCommandAuthenticationOrCancelMock.mockResolvedValue(true);
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [
          {
            agentId: "codex",
            selectable: true,
          },
        ],
      },
    });
    runStartLocalAgentsEnableMock.mockResolvedValue({
      status: "completed",
      summary: {
        errors: [],
      },
    });
    runDaemonServiceParticipationGateMock.mockResolvedValue({
      status: "aligned",
    });
    syncLocalSetupCurrentDeviceTargetFromServiceContractMock.mockResolvedValue({
      deviceId: "device-session",
      runtimeLane: "dev-local",
    });
    resolveControllingTerminalSessionMock.mockReturnValue(null);
    resolveSelectedAgentControllerReadinessMock.mockReturnValue({
      status: "ready",
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([
      {
        agentId: "codex",
        agentControllerRef: "builtin:codex",
        localParticipationState: "ready",
        reasonCodes: ["runtime.agent_controller_report.ready"],
        runtimeReportSubmission: {
          agentControllerReportStatus: "accepted",
          openMeldServiceRuntimeId: "runtime-session",
          status: "submitted",
        },
      },
    ]);
    notifyDaemonRouteCatalogChangedMock.mockResolvedValue({
      delivery: "control_plane",
      notifiedSessions: 1,
      fallbackReason: null,
    });
    runSetupFirstBootstrapMock.mockResolvedValue({
      status: "completed",
      assistantProfile: null,
      binding: null,
      humanProfile: {
        openMeldProfileId: "human_mira",
        profileKind: "human",
        profileName: "Mira",
      },
      facts: null,
      membership: null,
      retryCommand: null,
      warnings: [],
      welcomeMessage: null,
      welcomingSpace: null,
    });
    runSkillsEnsureMock.mockResolvedValue("completed");
    writePrepareSessionSetupBootstrapResultMock.mockResolvedValue({
      snapshot: {},
    });
    writeInstalledLocalComponentsSnapshotMock.mockResolvedValue({});
    resolveLocalComponentsStatusMock.mockResolvedValue({
      schemaVersion: 1,
      generatedAt: "2026-05-30T00:00:00.000Z",
      entrypoint: "setup",
      summaryLabel: "Everything is up to date",
      summaryDescription:
        "OpenMeld local components are aligned for this computer.",
      setupAction: "none",
      setupActionLabel: "Everything is up to date",
      setupActionDescription:
        "OpenMeld local components are aligned for this computer.",
      cli: {
        commandContractVersion:
          "openmeld-cli-command-contract-2026-05-local-components-v1",
        latestPackageVersion: null,
        packageVersion: "0.6.9",
        reasonCodes: [],
        requiredCommandContractVersion: null,
        status: "ok",
      },
      service: {
        expectedBundleHash: null,
        expectedBundleVersion: "0.6.9",
        installedBundleHash: null,
        installedBundleVersion: "0.6.9",
        reasonCodes: [],
        runtimeContractEpoch:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        serviceContractVersion:
          "daemon-runtime-epoch-2026-05-runtime-coordinator-execution-token",
        status: "ok",
      },
      skills: {
        expectedBundleHash: "skill-hash",
        installedBundleHash: "skill-hash",
        reasonCodes: [],
        skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
        status: "ok",
        targetCount: 1,
      },
    });
  });

  it("emits setup.complete from the completed Web setup session selection", async () => {
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        prepareSessionId: "prepare-web",
        selectedLocalAgentIds: ["codex"],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      deviceCode: "device_code_web",
      startSession: "preptok_web",
      view: "agent",
    });

    expect(runSetupLocalAgentConnectionMock).toHaveBeenCalledWith({
      deviceCode: "device_code_web",
      startSession: "preptok_web",
      view: "agent",
    });
    expect(resolveOpenMeldProfileOrNullMock).not.toHaveBeenCalled();
    const dataEvents = presenter.data.mock.calls.map(
      ([event]) =>
        event as {
          code?: string;
          payload?: unknown;
        }
    );
    const setupPlanIndex = dataEvents.findIndex(
      (event) => event.code === "setup.plan"
    );
    const setupCompleteIndex = dataEvents.findIndex(
      (event) => event.code === "setup.complete"
    );
    expect(setupPlanIndex).toBe(-1);
    expect(setupCompleteIndex).toBeGreaterThanOrEqual(0);

    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            localAgents?: {
              selectedAgentIds?: string[];
              spaceSetupHint?: string | null;
              reportedCapabilities?: Array<{
                agentId?: string;
                openMeldServiceRuntimeId?: string;
                status?: string;
              }>;
            };
            service?: {
              deviceId?: string;
              runtimeLane?: string;
            } | null;
            localComponents?: {
              setupAction?: string;
              entrypoint?: string;
            };
            serviceGuidance?: {
              disableAutoStartCommand?: string;
              statusDescription?: string;
              stopCommand?: string;
            };
            bootstrap?: {
              status?: string;
              welcomingSpace?: null;
            };
          };
        }
      | undefined;

    expect(setupComplete?.payload?.localAgents?.selectedAgentIds).toEqual([
      "codex",
    ]);
    // The Connect page selection is the member's choice: the agents it left
    // out are turned off before any Agent is added.
    expect(turnOffUnselectedLocalAgentsForSetupMock).toHaveBeenCalledWith({
      selectedLocalAgentIds: ["codex"],
    });
    expect(setupComplete?.payload?.localAgents?.spaceSetupHint).toBe(
      "Center Agent will guide setup from OpenMeld Home"
    );
    expect(setupComplete?.payload?.localAgents?.spaceSetupHint).not.toContain(
      "Ready"
    );
    expect(
      setupComplete?.payload?.localAgents?.reportedCapabilities?.[0]
    ).toMatchObject({
      agentId: "codex",
      openMeldServiceRuntimeId: "runtime-session",
      status: "reported",
    });
    expect(setupComplete?.payload?.service).toEqual({
      deviceId: "device-session",
      runtimeLane: "dev-local",
    });
    expect(setupComplete?.payload?.localComponents).toMatchObject({
      setupAction: "none",
      entrypoint: "setup",
    });
    expect(setupComplete?.payload?.serviceGuidance).toMatchObject({
      disableAutoStartCommand: "openmeld service autostart disable",
      statusDescription: "OpenMeld Service is running in the background.",
      stopCommand: "openmeld service stop",
    });
    expect(setupComplete?.payload?.bootstrap).toMatchObject({
      status: "completed",
      assistantProfile: null,
      facts: null,
      membership: null,
      welcomeMessage: null,
      welcomingSpace: null,
    });
    expect(setupComplete?.payload).toMatchObject({
      setupStatus: "completed",
      nextAction: null,
    });
    expect(runSetupFirstBootstrapMock).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.openmeld.test",
      interactive: false,
      line: expect.any(Function),
      runtimeReports: [
        expect.objectContaining({
          agentControllerRef: "builtin:codex",
          agentId: "codex",
          runtimeReportSubmission: expect.objectContaining({
            openMeldServiceRuntimeId: "runtime-session",
          }),
        }),
      ],
      selectedLocalAgentIds: ["codex"],
    });
    expect(writePrepareSessionSetupBootstrapResultMock).toHaveBeenCalledWith({
      baseUrl: "https://gateway.openmeld.test",
      prepareSessionId: "prepare-web",
      setupBootstrap: expect.objectContaining({
        status: "completed",
        assistantProfile: null,
        facts: null,
        welcomingSpace: null,
      }),
    });
  });

  it("does not block delegated setup.complete when no local profile is selected", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        selectedLocalAgentIds: ["codex"],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "agent",
    });

    expect(runSetupLocalAgentConnectionMock).toHaveBeenCalledWith({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "agent",
    });
    const dataEvents = presenter.data.mock.calls.map(
      ([event]) =>
        event as {
          code?: string;
          payload?: unknown;
        }
    );
    expect(dataEvents.some((event) => event.code === "setup.plan")).toBe(false);
    expect(dataEvents.some((event) => event.code === "setup.complete")).toBe(
      true
    );
  });

  it("blocks a concurrent double-run and keeps structured lock detail in agent view", async () => {
    const setupLockError = Object.assign(
      new Error(
        'space is locked (/tmp/setup-command.lock). Meta: {"pid":1234,"command":"openmeld setup"}'
      ),
      {
        code: "openmeld.locked",
        metaRaw:
          '{"pid":1234,"command":"openmeld setup","at":"2026-07-03T03:36:00.000Z"}',
      }
    );
    acquireLockMock.mockRejectedValueOnce(setupLockError);
    const { runSetup } = await import("../src/commands/setup");

    await expect(runSetup({ view: "agent" })).rejects.toMatchObject({
      name: "LocalMachineFailureError",
      code: "local_machine.concurrency.active",
      issue: {
        code: "local_machine.concurrency.active",
        diagnostics: {
          detail: setupLockError.message,
          systemCode: "OPENMELD_LOCK_ACTIVE",
        },
        operation: "create_lock",
        recoveryPolicy: "user_action",
      },
    });

    expect(runSetupLocalAgentConnectionMock).not.toHaveBeenCalled();
  });

  it("blocks a concurrent double-run with a clean human message and no raw JSON", async () => {
    const setupLockError = Object.assign(new Error("locked"), {
      code: "openmeld.locked",
      metaRaw:
        '{"pid":1234,"command":"openmeld setup","at":"2026-07-03T03:36:00.000Z"}',
    });
    acquireLockMock.mockRejectedValueOnce(setupLockError);
    const { runSetup } = await import("../src/commands/setup");

    const thrown = await runSetup({ view: "human" }).catch(
      (error: unknown) => error
    );

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain("Another OpenMeld setup");
    expect(message).toContain("pid 1234");
    expect(message).not.toContain("{");
    expect(message).not.toContain("Meta:");
    expect(runSetupLocalAgentConnectionMock).not.toHaveBeenCalled();
  });

  it("emits setup.complete without requiring final Wake confirmation", async () => {
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        selectedLocalAgentIds: ["codex"],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "agent",
    });

    expect(
      presenter.data.mock.calls.some(
        ([event]) => (event as { code?: string }).code === "setup.complete"
      )
    ).toBe(true);
  });

  it("completes Web setup when an unauthenticated local agent report was accepted", async () => {
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        selectedLocalAgentIds: ["claude-code"],
      },
    });
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [{ agentId: "claude-code", selectable: true }],
      },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([
      {
        agentId: "claude-code",
        agentControllerRef: "builtin:claude-code",
        localParticipationState: "needs_agent_prepare",
        reasonCodes: ["provider_account.access_required"],
        runtimeReportSubmission: {
          agentControllerReportStatus: "accepted",
          openMeldServiceRuntimeId: "runtime-session",
          status: "submitted",
        },
      },
    ]);
    const { runSetup } = await import("../src/commands/setup");

    await expect(
      runSetup({
        startSession: "preptok_web",
        ott: "ott_web",
        view: "agent",
      })
    ).resolves.toBeUndefined();

    expect(
      assertSelectedAgentControllerReportSubmissionsAcceptedMock
    ).toHaveBeenCalledTimes(1);
    expect(
      presenter.data.mock.calls.some(
        ([event]) => (event as { code?: string }).code === "setup.complete"
      )
    ).toBe(true);
  });

  it("completes standard setup when an unauthenticated local agent report was accepted", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [{ agentId: "claude-code", selectable: true }],
      },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([
      {
        agentId: "claude-code",
        agentControllerRef: "builtin:claude-code",
        localParticipationState: "needs_agent_prepare",
        reasonCodes: ["provider_account.access_required"],
        runtimeReportSubmission: {
          agentControllerReportStatus: "accepted",
          openMeldServiceRuntimeId: "runtime-session",
          status: "submitted",
        },
      },
    ]);
    const { runSetup } = await import("../src/commands/setup");

    await expect(runSetup({ view: "agent" })).resolves.toBeUndefined();

    expect(
      assertSelectedAgentControllerReportSubmissionsAcceptedMock
    ).toHaveBeenCalledTimes(1);
  });

  it("emits setup.plan before setup.complete for the standard agent setup path", async () => {
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "agent",
    });

    const dataEvents = presenter.data.mock.calls.map(
      ([event]) =>
        event as {
          code?: string;
          payload?: unknown;
        }
    );
    const setupPlanIndex = dataEvents.findIndex(
      (event) => event.code === "setup.plan"
    );
    const setupCompleteIndex = dataEvents.findIndex(
      (event) => event.code === "setup.complete"
    );
    expect(setupPlanIndex).toBeGreaterThanOrEqual(0);
    expect(setupCompleteIndex).toBeGreaterThan(setupPlanIndex);

    const parsedSetupPlan = setupPlanAgentViewPayloadSchema.safeParse(
      dataEvents[setupPlanIndex]?.payload
    );
    expect(parsedSetupPlan.success).toBe(true);
    if (!parsedSetupPlan.success) {
      return;
    }
    expect(parsedSetupPlan.data.readOnly).toBe(false);
    expect(parsedSetupPlan.data.facts.auth).toMatchObject({
      signedIn: true,
      actingProfileId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsedSetupPlan.data.plan.summary).toBe("actions_pending");
    const lineOutput = presenter.line.mock.calls
      .map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(lineOutput).toContain(
      "Non-interactive: connecting all detected agents (use --local-agent to limit, or --local-agents none to skip)."
    );
  });

  it("refreshes OpenMeld Service when the setup bootstrap just force-installed a binary", async () => {
    process.env.OPENMELD_SETUP_FORCE_SERVICE_REFRESH = "1";
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "agent",
    });

    expect(runDaemonServiceParticipationGateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        forceRefresh: true,
      })
    );
  });

  it("preserves a structured local computer blocker from the service gate", async () => {
    runDaemonServiceParticipationGateMock.mockResolvedValueOnce({
      status: "needs_attention",
      errorMessage:
        "Your computer is out of storage space. OpenMeld can't save the local files it needs.",
      localMachineIssue: {
        schemaVersion: 1,
        code: "local_machine.storage.exhausted",
        operation: "start_background_service",
        recoveryPolicy: "user_action",
        summary:
          "Your computer is out of storage space. OpenMeld can't save the local files it needs.",
        primaryAction: "Free up storage, then try again.",
        diagnostics: {
          systemCode: "ENOSPC",
          detail: "no space left on device",
        },
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await expect(runSetup({ view: "agent" })).rejects.toMatchObject({
      code: "local_machine.storage.exhausted",
      issue: {
        operation: "start_background_service",
        recoveryPolicy: "user_action",
      },
    });
  });

  it("emits an honest partial setup payload when the post-setup bootstrap fails", async () => {
    runSetupFirstBootstrapMock.mockResolvedValueOnce({
      status: "failed",
      diagnostics: {
        errorName: "Error",
        selectedAgentIds: ["codex"],
      },
      failedStep: "space_create",
      message: "Invalid visibility",
      reason: "bootstrap_failed",
      retryCommand: "openmeld setup",
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "agent",
    });

    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            setupStatus?: string;
            nextAction?: {
              command?: string;
              reason?: string;
            } | null;
            nextCommands?: string[];
            bootstrap?: {
              failedStep?: string;
              message?: string;
              status?: string;
            };
            localAgents?: {
              spaceSetupHint?: string | null;
            };
          };
        }
      | undefined;

    expect(setupComplete?.payload).toMatchObject({
      setupStatus: "partial",
      nextAction: {
        command: "openmeld setup",
        reason: "Invalid visibility",
      },
      bootstrap: {
        status: "failed",
        failedStep: "space_create",
        message: "Invalid visibility",
      },
    });
    expect(setupComplete?.payload?.nextCommands?.[0]).toBe("openmeld setup");
    expect(setupComplete?.payload?.localAgents?.spaceSetupHint).toBe(
      "Bootstrap needs retry: space_create"
    );
    expect(JSON.stringify(setupComplete?.payload)).not.toContain(
      "Setup Complete"
    );
    expect(JSON.stringify(setupComplete?.payload)).not.toContain("🎉");
  });

  it("emits an honest partial setup payload when profile bootstrap fails", async () => {
    runSetupFirstBootstrapMock.mockResolvedValueOnce({
      status: "failed",
      diagnostics: {
        errorName: "Error",
        selectedAgentIds: ["codex"],
      },
      failedStep: "human_profile",
      message: "OpenMeld profile could not be resolved.",
      reason: "bootstrap_failed",
      retryCommand: "openmeld setup",
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "agent",
    });

    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            bootstrap?: {
              failedStep?: string;
              message?: string;
              status?: string;
            };
            localAgents?: {
              spaceSetupHint?: string | null;
            };
            nextAction?: {
              command?: string;
              failedStep?: string;
              reason?: string;
            } | null;
            setupStatus?: string;
          };
        }
      | undefined;

    expect(setupComplete?.payload).toMatchObject({
      setupStatus: "partial",
      nextAction: {
        command: "openmeld setup",
        failedStep: "human_profile",
        reason: "OpenMeld profile could not be resolved.",
      },
      bootstrap: {
        status: "failed",
        failedStep: "human_profile",
      },
    });
    expect(setupComplete?.payload?.localAgents?.spaceSetupHint).toBe(
      "Bootstrap needs retry: human_profile"
    );
  });

  it("warns and continues without prompting in agent view when no local agents are available", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [],
      },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([]);
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "agent",
    });

    expect(resolveControllingTerminalSessionMock).not.toHaveBeenCalled();
    expect(runStartLocalAgentsEnableMock).not.toHaveBeenCalled();
    const lineOutput = presenter.line.mock.calls
      .map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(lineOutput).toContain(
      "Codex, Claude Code, Grok Build, Cursor, or OpenCode"
    );
    expect(lineOutput).toContain(
      "https://gateway.openmeld.test/guides/local-agents"
    );
    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            localAgents?: {
              guideUrl?: string;
              selectedAgentIds?: string[];
            };
          };
        }
      | undefined;
    expect(setupComplete?.payload?.localAgents?.selectedAgentIds).toEqual([]);
    expect(setupComplete?.payload?.localAgents).not.toHaveProperty("guideUrl");
  });

  it("does not print the zero-agent guide notice for explicit --local-agents none", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [],
      },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([]);
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      localAgents: "none",
      view: "agent",
    });

    expect(resolveControllingTerminalSessionMock).not.toHaveBeenCalled();
    expect(runStartLocalAgentsEnableMock).not.toHaveBeenCalled();
    const lineOutput = presenter.line.mock.calls
      .map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(lineOutput).not.toContain("/guides/local-agents");
  });

  it("applies the selection to Local agents before the Service starts", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [
          { agentId: "codex", lifecycleStatus: "active", selectable: true },
        ],
      },
    });
    // Cursor was already on: setup turned it off before the Service started.
    registerUnselectedLocalAgentsOffForSetupMock.mockResolvedValue(["cursor"]);
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({ localAgent: ["codex"], view: "agent" });

    expect(registerUnselectedLocalAgentsOffForSetupMock).toHaveBeenCalledWith({
      selectedLocalAgentIds: ["codex"],
    });
    const registeredOffAt =
      registerUnselectedLocalAgentsOffForSetupMock.mock.invocationCallOrder[0];
    const serviceStartedAt =
      runDaemonServiceParticipationGateMock.mock.invocationCallOrder[0];
    expect(registeredOffAt).toBeLessThan(serviceStartedAt ?? 0);
    // And reports it through the Service before any Agent is added.
    expect(turnOffUnselectedLocalAgentsForSetupMock).toHaveBeenCalledWith({
      selectedLocalAgentIds: ["codex"],
      turnedOffBeforeServiceAgentIds: ["cursor"],
    });
  });

  it("turns every detected agent off for explicit --local-agents none", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: { candidates: [] },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([]);
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({ localAgents: "none", view: "agent" });

    expect(registerUnselectedLocalAgentsOffForSetupMock).toHaveBeenCalledWith({
      selectedLocalAgentIds: [],
    });
    expect(turnOffUnselectedLocalAgentsForSetupMock).toHaveBeenCalledWith({
      selectedLocalAgentIds: [],
      turnedOffBeforeServiceAgentIds: [],
    });
  });

  it("leaves the Agents to the next sync when an unselected agent stays on", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [
          { agentId: "codex", lifecycleStatus: "active", selectable: true },
        ],
      },
    });
    turnOffUnselectedLocalAgentsForSetupMock.mockResolvedValue({
      failedAgentIds: ["cursor"],
      turnedOffAgentIds: [],
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({ localAgent: ["codex"], view: "agent" });

    const memberAgentsLine = presenter.line.mock.calls
      .map(([line]) => line as { code: string; text: string })
      .find((line) => line.code === "setup.member_agents.failed");
    expect(memberAgentsLine?.text).toContain(
      "OpenMeld Service couldn't turn off Cursor"
    );
  });

  it("excludes suspended local agents from standard setup auto-selection", async () => {
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [
          {
            agentId: "codex",
            lifecycleStatus: "active",
            selectable: true,
          },
          {
            agentId: "openclaw",
            lifecycleStatus: "suspended",
            selectable: true,
          },
        ],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "agent",
    });

    expect(runStartLocalAgentsEnableMock).toHaveBeenCalledWith({
      agent: ["codex"],
      interactive: false,
      presentation: "handoff",
      view: "agent",
    });
    expect(runSetupFirstBootstrapMock).toHaveBeenCalledWith({
      gatewayUrl: "https://gateway.openmeld.test",
      interactive: false,
      line: expect.any(Function),
      runtimeReports: [
        expect.objectContaining({
          agentControllerRef: "builtin:codex",
          agentId: "codex",
          runtimeReportSubmission: expect.objectContaining({
            openMeldServiceRuntimeId: "runtime-session",
          }),
        }),
      ],
      selectedLocalAgentIds: ["codex"],
    });
  });

  it("emits setup.complete when route catalog sync falls back", async () => {
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        selectedLocalAgentIds: ["codex"],
      },
    });
    notifyDaemonRouteCatalogChangedMock.mockResolvedValue({
      delivery: "signal",
      fallbackReason: "control_plane_unavailable",
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "agent",
    });

    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            routeCatalogSync?: {
              delivery?: string;
              fallbackReason?: string;
            } | null;
          };
        }
      | undefined;

    expect(notifyDaemonRouteCatalogChangedMock).toHaveBeenCalledTimes(1);
    expect(setupComplete?.payload?.routeCatalogSync).toEqual({
      delivery: "signal",
      fallbackReason: "control_plane_unavailable",
    });
  });

  it.each([
    "enrolled",
    "refused",
  ])("completes profile setup only after Computer identity is %s", async (enrollment) => {
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: null,
      completionFacts: {
        openMeldServiceRuntimeIdentity: {
          deviceId: "device-profile",
          runtimeLane: "dev-local",
        },
        runtimeReports: [
          {
            agentId: "codex",
            agentControllerRef: "builtin:codex",
            localParticipationState: "ready",
            reasonCodes: [],
            runtimeReportSubmission: {
              agentControllerRef: "builtin:codex",
              agentControllerReportStatus: "accepted",
              deviceId: "device-profile",
              lane: "dev-local",
              openMeldServiceRuntimeId: "runtime-profile",
              status: "submitted",
            },
          },
        ],
        selectedLocalAgentIds: ["codex"],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    if (enrollment === "refused") {
      const failure = new Error("Computer identity could not be saved.");
      syncLocalSetupCurrentDeviceTargetFromServiceContractMock.mockRejectedValueOnce(
        failure
      );
      await expect(
        runSetup({ profile: "agt_profile_codex", view: "agent" })
      ).rejects.toBe(failure);
      expect(
        presenter.data.mock.calls.some(
          ([event]) => (event as { code?: string }).code === "setup.complete"
        )
      ).toBe(false);
      return;
    }
    syncLocalSetupCurrentDeviceTargetFromServiceContractMock.mockResolvedValueOnce(
      {
        deviceId: "device-profile",
        runtimeLane: "dev-local",
      }
    );
    await runSetup({
      profile: "agt_profile_codex",
      view: "agent",
    });

    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            localAgents?: {
              selectedAgentIds?: string[];
              reportedCapabilities?: Array<{
                agentId?: string;
                openMeldServiceRuntimeId?: string;
                status?: string;
              }>;
            };
            service?: {
              deviceId?: string;
              runtimeLane?: string;
            } | null;
          };
        }
      | undefined;

    expect(setupComplete?.payload?.localAgents?.selectedAgentIds).toEqual([
      "codex",
    ]);
    expect(
      setupComplete?.payload?.localAgents?.reportedCapabilities?.[0]
    ).toMatchObject({
      agentId: "codex",
      openMeldServiceRuntimeId: "runtime-profile",
      status: "reported",
    });
    expect(setupComplete?.payload?.service).toEqual({
      deviceId: "device-profile",
      runtimeLane: "dev-local",
    });
  });

  it("emits setup.complete from setup-session completion facts without rerunning runtime reports", async () => {
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        prepareSessionId: "prepare-web",
        selectedLocalAgentIds: ["codex"],
      },
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
              agentControllerRef: "builtin:codex",
              agentControllerReportStatus: "accepted",
              deviceId: "device-session",
              lane: "dev-local",
              openMeldServiceRuntimeId: "runtime-session",
              status: "submitted",
            },
          },
        ],
        selectedLocalAgentIds: ["codex"],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "agent",
    });

    expect(collectStartLocalReadinessMock).not.toHaveBeenCalled();
    expect(
      syncLocalSetupCurrentDeviceTargetFromServiceContractMock
    ).not.toHaveBeenCalled();
    expect(submitSelectedAgentControllerReportsMock).not.toHaveBeenCalled();
    // The live Connect session enabled every runnable agent before the page
    // chose Codex: the rest are turned off before any Agent is added.
    expect(turnOffUnselectedLocalAgentsForSetupMock).toHaveBeenCalledWith({
      selectedLocalAgentIds: ["codex"],
    });

    const setupComplete = presenter.data.mock.calls.find(
      ([event]) => (event as { code?: string }).code === "setup.complete"
    )?.[0] as
      | {
          payload?: {
            localAgents?: {
              reportedCapabilities?: Array<{
                agentId?: string;
                openMeldServiceRuntimeId?: string;
              }>;
            };
          };
        }
      | undefined;

    expect(
      setupComplete?.payload?.localAgents?.reportedCapabilities?.[0]
    ).toMatchObject({
      agentId: "codex",
      openMeldServiceRuntimeId: "runtime-session",
    });
  });

  it("reports a completed no-agent setup as connected after a transient service start failure", async () => {
    const previousExitCode = process.exitCode;
    try {
      runSetupLocalAgentConnectionMock.mockImplementationOnce(() => {
        process.exitCode = 1;
        return {
          status: "completed",
          setupSessionSnapshot: {
            deviceId: "device-session",
            prepareSessionId: "prepare-web",
            runtimeLane: "canary",
            selectedLocalAgentIds: [],
          },
        };
      });
      const { runSetup } = await import("../src/commands/setup");

      await runSetup({
        startSession: "preptok_web",
        ott: "ott_web",
        view: "agent",
      });

      const setupComplete = presenter.data.mock.calls.find(
        ([event]) => (event as { code?: string }).code === "setup.complete"
      )?.[0] as
        | {
            payload?: {
              service?: {
                deviceId?: string;
                runtimeLane?: string;
              } | null;
            };
          }
        | undefined;

      expect(setupComplete?.payload?.service).toEqual({
        deviceId: "device-session",
        runtimeLane: "canary",
      });
      expect(process.exitCode).toBe(previousExitCode);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    undefined,
    "http://wt-example.localhost:29520/",
  ])("shows background syncing and the visible return URL (%s)", async (webUrl) => {
    vi.stubEnv("OPENMELD_SETUP_WEB_URL", webUrl);
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        connectedComputerId: "computer-existing",
        deviceId: "device-session",
        prepareSessionId: "prepare-web",
        runtimeLane: "prod",
        selectedLocalAgentIds: [],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "human",
    });

    const completionLines = presenter.line.mock.calls
      .map(([line]) => line as { code: string; text: string })
      .filter((line) => line.code.startsWith("setup.complete.human"))
      .map((line) => line.text);
    expect(completionLines).toEqual([
      "",
      "🎉 Your computer is connected.",
      "",
      "Local agents are syncing in the background.",
      "",
      `Continue in OpenMeld: ${webUrl ?? "https://gateway.openmeld.test/"}`,
    ]);
    expect(completionLines.join("\n")).not.toContain("None connected");
    expect(completionLines.join("\n")).not.toContain("Install guide");
    // The Connect page has not chosen yet: Local agents stay as they are.
    expect(turnOffUnselectedLocalAgentsForSetupMock).not.toHaveBeenCalled();
  });

  it("renders a concise human setup completion with the connected agent and Web link", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    runSetupLocalAgentConnectionMock.mockResolvedValue({
      status: "completed",
      setupSessionSnapshot: {
        selectedLocalAgentIds: ["codex"],
      },
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      startSession: "preptok_web",
      ott: "ott_web",
      view: "human",
    });

    expect(presenter.data).not.toHaveBeenCalled();
    const completionLines = presenter.line.mock.calls
      .map(([line]) => line as { code: string; text: string })
      .filter((line) => line.code.startsWith("setup.complete.human"))
      .map((line) => line.text);
    expect(completionLines).toEqual([
      "",
      "🎉 Your computer is connected.",
      "",
      "Local agents connected: Codex.",
      "",
      "Continue in OpenMeld: https://gateway.openmeld.test/",
    ]);
    const output = presenter.line.mock.calls
      .map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).not.toContain("CLI version:");
    expect(output).not.toContain("Status: Running");
    expect(output).not.toContain("Auto-start:");
    expect(output).not.toContain("Stop service:");
    expect(output).not.toContain("Turn off auto-start:");
    expect(output).toContain("Updating OpenMeld skills...");
    expect(output).toContain("Saving local component status...");
    expect(output).not.toContain("Open OpenMeld Welcoming Space");
    expect(output).not.toContain("OpenMeld Welcoming Space");
    expect(output).not.toContain("OpenMeld Welcoming Assistant");
    expect(output).not.toContain("Assistant runs on:");
    expect(output).not.toContain("Welcoming Space");
    expect(output).not.toContain("AI setup agents:");
    expect(output).not.toContain("-----BEGIN OpenMeld SETUP COMPLETE-----");
    expect(output).not.toContain('"code": "setup.complete"');
  });

  it("renders partial human setup completion when the welcoming Space bootstrap fails", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    runSetupFirstBootstrapMock.mockResolvedValueOnce({
      status: "failed",
      diagnostics: {
        errorName: "Error",
        selectedAgentIds: ["codex"],
      },
      failedStep: "space_create",
      message: "Invalid visibility",
      reason: "bootstrap_failed",
      retryCommand: "openmeld setup",
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "human",
    });

    const completionLines = presenter.line.mock.calls
      .map(([line]) => line as { code: string; text: string })
      .filter((line) => line.code.startsWith("setup.complete.human"))
      .map((line) => line.text);
    expect(completionLines).toEqual([
      "",
      "⚠️ OpenMeld needs one more step.",
      "",
      "Your computer is connected, but OpenMeld could not finish preparing it.",
      "",
      "Reason: Invalid visibility.",
      "",
      "Next: Run openmeld setup.",
      "",
      "Continue in OpenMeld: https://gateway.openmeld.test/",
    ]);
    expect(completionLines.join("\n")).not.toContain("🎉");
    expect(completionLines.join("\n")).not.toContain("complete");
  });

  it("renders the standard human setup path with the brand header and step cards", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "human",
    });

    const output = presenter.line.mock.calls
      .map(([line]) => (line as { text: string }).text)
      .join("\n");
    expect(output).toContain("█████");
    expect(output).toContain("OPENMELD CLI");
    expect(output).not.toContain("ATS");
    expect(output).toContain("People and agents, working as one.");
    expect(output).toContain("Current version:");
    expect(output).toContain("Checking local agents...");
    expect(output).toContain("Enabling local agents...");
    expect(output).toContain("Preparing OpenMeld Service...");
    expect(output).not.toContain("✓ Local Agents");
    expect(output).not.toContain("✓ OpenMeld Service");
    expect(output).not.toContain(
      "OpenMeld Service is running in the background."
    );
    expect(output).toContain("Updating OpenMeld skills...");
    expect(output).toContain("Saving local component status...");
    expect(output).not.toContain("Auto-start: On - starts when you log in");
    expect(output).not.toContain(
      "Turn off auto-start: openmeld service autostart disable"
    );
    expect(output).not.toContain("Stop service: openmeld service stop");
    expect(output).not.toContain("✓ OpenMeld Skills");
    expect(output).toContain("🎉 Your computer is connected.");
    expect(output).not.toContain("AI setup agents:");
    expect(output).not.toContain("-----BEGIN OpenMeld SETUP COMPLETE-----");
    expect(runDaemonServiceParticipationGateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoRepair: true,
        serviceProgress: expect.objectContaining({
          detail: expect.any(Function),
        }),
        suppressRefreshHumanResultCard: true,
        suppressStartSpinner: true,
      })
    );
  });

  it("shows the local agent install guide in the human setup summary when no agents are connected", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [],
      },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([]);
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      view: "human",
    });

    const completionLines = presenter.line.mock.calls
      .map(([line]) => line as { code: string; text: string })
      .filter((line) => line.code.startsWith("setup.complete.human"))
      .map((line) => line.text);
    expect(completionLines).toEqual([
      "",
      "🎉 Your computer is connected.",
      "",
      "OpenMeld did not find a supported local agent on this computer.",
      "",
      "Install a local agent: https://gateway.openmeld.test/guides/local-agents",
      "",
      "Continue in OpenMeld: https://gateway.openmeld.test/",
    ]);
  });

  it("does not show the install guide when human setup explicitly skips local agents", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      resolvedView: "human",
      viewMode: "human",
      interactive: false,
    });
    collectStartLocalReadinessMock.mockResolvedValue({
      agents: {
        candidates: [],
      },
    });
    submitSelectedAgentControllerReportsMock.mockResolvedValue([]);
    const { runSetup } = await import("../src/commands/setup");

    await runSetup({
      localAgents: "none",
      view: "human",
    });

    const completionOutput = presenter.line.mock.calls
      .map(([line]) => line as { code: string; text: string })
      .filter((line) => line.code.startsWith("setup.complete.human"))
      .map((line) => line.text)
      .join("\n");
    expect(completionOutput).toContain("Local agents were skipped.");
    expect(completionOutput).not.toContain("Install a local agent");
    expect(completionOutput).not.toContain("/guides/local-agents");
  });
});
