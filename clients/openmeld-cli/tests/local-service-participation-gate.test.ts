import type { DaemonServiceContract } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import type { Presenter } from "../src/runtime/presenter";
import { buildDaemonInstallDecisionPromptConfig } from "../src/system/local-service-install-attention";
import { runDaemonServiceParticipationGate } from "../src/system/local-service-participation-gate";
import { buildDaemonStartDecisionPromptConfig } from "../src/system/local-service-start-decision";

const {
  inspectDaemonServiceInventoryMock,
  readDaemonServiceContractMock,
  renderInfoCardMock,
  runDaemonBackgroundStartForDecisionMock,
  runDaemonInstallMock,
  runDaemonReinstallMock,
  selectPromptMock,
} = vi.hoisted(() => ({
  inspectDaemonServiceInventoryMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  renderInfoCardMock: vi.fn(),
  runDaemonBackgroundStartForDecisionMock: vi.fn(),
  runDaemonInstallMock: vi.fn(),
  runDaemonReinstallMock: vi.fn(),
  selectPromptMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: (...args: Parameters<typeof selectPromptMock>) =>
    selectPromptMock(...args),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: (
    ...args: Parameters<typeof inspectDaemonServiceInventoryMock>
  ) => inspectDaemonServiceInventoryMock(...args),
}));

vi.mock("../src/config/daemon-service-contract", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-service-contract")
  >("../src/config/daemon-service-contract");
  return {
    ...actual,
    readDaemonServiceContract: (
      ...args: Parameters<typeof readDaemonServiceContractMock>
    ) => readDaemonServiceContractMock(...args),
  };
});

vi.mock("../src/commands/service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/commands/service")
  >("../src/commands/service");
  return {
    ...actual,
    runDaemonBackgroundStartForDecision: (
      ...args: Parameters<typeof runDaemonBackgroundStartForDecisionMock>
    ) => runDaemonBackgroundStartForDecisionMock(...args),
    runDaemonInstall: (...args: Parameters<typeof runDaemonInstallMock>) =>
      runDaemonInstallMock(...args),
    runDaemonReinstall: (...args: Parameters<typeof runDaemonReinstallMock>) =>
      runDaemonReinstallMock(...args),
  };
});

vi.mock("../src/ui/info-card", () => ({
  renderInfoCard: (...args: Parameters<typeof renderInfoCardMock>) =>
    renderInfoCardMock(...args),
}));

function createInventory(input?: {
  installedVersion?: string | null;
  runtimeStatus?: "not_running" | "running" | "stale" | "unknown";
  anomalyCodes?: string[];
  verifiedRunning?: boolean;
}) {
  const installedVersion =
    input?.installedVersion === undefined
      ? packageJson.version
      : input.installedVersion;
  return {
    expectedVersion: packageJson.version,
    installStatus:
      installedVersion === null
        ? {
            installed: false,
            state: null,
          }
        : {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: installedVersion,
              installSource: "daemon.command.install",
              installedAt: "2026-03-01T00:00:00.000Z",
              updatedAt: "2026-03-01T00:00:00.000Z",
            },
          },
    runtimeStatus: {
      status: input?.runtimeStatus ?? "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    anomalies: (input?.anomalyCodes ?? []).map((code) => ({
      code,
      message: String(code),
    })),
    ...(input?.verifiedRunning
      ? {
          activeBundleEntryPath: "/tmp/openmeld/active/openmeld.mjs",
          runtimeCommandEntryPath: "/tmp/openmeld/active/openmeld.mjs",
          runtimeCommandPathExists: true,
          runtimeContractCompatibility: { status: "compatible" },
          serviceContract: createServiceContract(),
        }
      : {}),
  };
}

function createServiceContract(
  input: Partial<DaemonServiceContract> = {}
): DaemonServiceContract {
  return {
    schema: "openmeld-daemon-service-contract-v1",
    v: 1,
    autoStart: true,
    bundleId: "bundle-1",
    daemonVersion: packageJson.version,
    desiredState: "background",
    deviceId: "device-1",
    gatewayUrl: "http://localhost:8080",
    generation: 1,
    heartbeatMs: 25_000,
    lane: "dev-local",
    profileId: "human-1",
    serviceController: "launchd",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...input,
  };
}

function createPresenter(): Presenter {
  return {
    view: "human",
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
  };
}

function createLocalDemand(hasLocalExecutionRoute = true) {
  return {
    decision: "keep_running" as const,
    hasLocalExecutionRoute,
    repairableReplyCandidateCount: 0,
    projection: null,
    reason: hasLocalExecutionRoute
      ? "local execution routes are available"
      : "no local execution routes are available",
    localExecutionRouteCount: hasLocalExecutionRoute ? 1 : 0,
  } as const;
}

describe("local service participation gate", () => {
  beforeEach(() => {
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValue(createInventory());
    readDaemonServiceContractMock
      .mockReset()
      .mockResolvedValue(createServiceContract());
    renderInfoCardMock.mockReset();
    runDaemonBackgroundStartForDecisionMock
      .mockReset()
      .mockResolvedValue("started");
    runDaemonInstallMock.mockReset().mockResolvedValue(undefined);
    runDaemonReinstallMock.mockReset().mockResolvedValue({
      ok: true,
      result: "completed",
      backupDataPath: null,
      desiredState: "background",
      forceUsed: false,
      serviceState: "running",
    });
    selectPromptMock.mockReset();
  });

  it("keeps the Service participation gate available when no local agent is installed yet", async () => {
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      localDemand: createLocalDemand(false),
      view: "human",
    });

    expect(result).toEqual({ status: "declined" });
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("auto-starts a stopped service without prompting when prepare owns repair", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "not_running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      suppressStartSpinner: true,
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: undefined,
      suppressStartSpinner: true,
      view: "human",
    });
  });

  it.each([
    true,
    false,
  ])("preserves startup evidence for account recovery (autoRepair=%s)", async (autoRepair) => {
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({ runtimeStatus: "not_running" })
    );
    selectPromptMock.mockResolvedValueOnce("start");
    const failure = {
      outcome: "failed_with_card",
      errorMessage:
        "macOS registered OpenMeld Service but hasn't started it.\nlaunchd job: state=not running, runs=0, pended nondemand spawn=speculative",
      localMachineIssue: {
        schemaVersion: 1,
        code: "local_machine.failure.unknown",
        operation: "start_background_service",
        recoveryPolicy: "diagnostics",
        summary: "macOS registered OpenMeld Service but hasn't started it.",
        primaryAction: "Run `openmeld service snapshot --view agent`.",
        diagnostics: {
          systemCode: "SERVICE_SPAWN_PENDING",
          detail: "pended nondemand spawn=speculative",
        },
      },
    };
    runDaemonBackgroundStartForDecisionMock.mockResolvedValueOnce(failure);

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter: createPresenter(),
      resolvedView: "human",
      allowPrompt: !autoRepair,
      autoRepair,
      forcePrompt: true,
      view: "human",
    });

    expect(result).toEqual({
      status: "needs_attention",
      errorMessage: failure.errorMessage,
      localMachineIssue: failure.localMachineIssue,
    });
  });

  it("auto-refreshes service bundle drift before starting because run would block", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
          runtimeStatus: "not_running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "http://localhost:8080",
        view: "human",
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("starts service when repair finishes at the current version but the service is still stopped", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
          runtimeStatus: "not_running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    runDaemonReinstallMock.mockResolvedValueOnce({
      ok: true,
      result: "completed",
      backupDataPath: null,
      desiredState: "background",
      forceUsed: false,
      serviceState: "stopped",
    });
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "http://localhost:8080",
        view: "human",
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });
  });

  it("stops setup when service repair startup is cancelled", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({
        anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
        runtimeStatus: "not_running",
      })
    );
    runDaemonReinstallMock.mockResolvedValueOnce({
      ok: false,
      result: "cancelled",
    });
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("starts service when repair recovers to stopped_safe", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
          runtimeStatus: "not_running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    runDaemonReinstallMock.mockResolvedValueOnce({
      ok: true,
      result: "stopped_safe",
      backupDataPath: null,
      desiredState: "background",
      forceUsed: false,
      serviceState: "stopped",
      errorMessage:
        "Lifecycle verification failed because background service did not recover.",
    });
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      suppressStartSpinner: true,
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "http://localhost:8080",
      suppressStartSpinner: true,
      view: "human",
    });
  });

  it("does not auto-refresh an outdated running service when prepare owns repair", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({
        installedVersion: "0.1.5",
        runtimeStatus: "running",
      })
    );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
  });

  it("does not auto-refresh start-only bundle drift while the current service is already running", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({
        anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
        runtimeStatus: "running",
      })
    );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("keeps Web setup incomplete after scheduling a healthy running Service update", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        anomalyCodes: ["version_outdated", "bundle_version_drift"],
        installedVersion: "0.3.96",
        runtimeStatus: "running",
        verifiedRunning: true,
      })
    );
    runDaemonReinstallMock.mockResolvedValueOnce({
      ok: true,
      result: "scheduled",
      jobId: "update-1",
      targetVersion: packageJson.version,
    });
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({
      errorMessage:
        "OpenMeld Service update started in the background. Run `openmeld setup` again after it finishes.",
      status: "needs_attention",
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

  it("force-refreshes a running service so prepare can switch to the current account", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      openMeldProfileId: "human-1",
      forcePrompt: true,
      forceRefresh: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "http://localhost:8080",
        profile: "human-1",
        view: "human",
      },
      {
        forceReinstall: true,
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("refreshes a ready service when it is connected to a different OpenMeld account", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    readDaemonServiceContractMock
      .mockResolvedValueOnce(
        createServiceContract({
          profileId: "human-old",
        })
      )
      .mockResolvedValueOnce(
        createServiceContract({
          profileId: "human-new",
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      openMeldProfileId: "human-new",
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "http://localhost:8080",
        profile: "human-new",
        view: "human",
      },
      {
        forceReinstall: true,
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "start.service.account_alignment_refresh",
        data: { reasonCode: "service_contract.profile_mismatch" },
      })
    );
  });

  it("keeps a ready same-owner service aligned without any reinstall", async () => {
    // A fresh login into the same account must not force-refresh a healthy
    // service: alignment is decided by owner expectation, never by comparing
    // auth-session and contract timestamps.
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({
        runtimeStatus: "running",
      })
    );
    readDaemonServiceContractMock.mockResolvedValueOnce(
      createServiceContract({
        ownerUserId: "owner-same",
        profileId: undefined,
      })
    );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      expectedOwnerUserId: "owner-same",
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
  });

  it("refreshes a ready service when its owner belongs to a different OpenMeld account", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    readDaemonServiceContractMock
      .mockResolvedValueOnce(
        createServiceContract({
          ownerUserId: "owner-old",
          profileId: undefined,
        })
      )
      .mockResolvedValueOnce(
        createServiceContract({
          ownerUserId: "owner-new",
          profileId: "human-new",
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      openMeldProfileId: "human-new",
      expectedOwnerUserId: "owner-new",
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "http://localhost:8080",
        profile: "human-new",
        view: "human",
      },
      {
        forceReinstall: true,
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "start.service.account_alignment_refresh",
        data: { reasonCode: "service_contract.owner_mismatch" },
      })
    );
  });

  it("refreshes a ready service when Web setup cannot verify the service owner", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "running",
        })
      );
    readDaemonServiceContractMock
      .mockResolvedValueOnce(
        createServiceContract({
          ownerUserId: undefined,
          profileId: undefined,
        })
      )
      .mockResolvedValueOnce(
        createServiceContract({
          ownerUserId: "owner-new",
          profileId: "human-new",
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      openMeldProfileId: "human-new",
      expectedOwnerUserId: "owner-new",
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "human-new",
      }),
      expect.objectContaining({
        startAfterInstallMode: "always",
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "start.service.account_alignment_refresh",
        data: { reasonCode: "service_contract.owner_unverified" },
      })
    );
  });

  it("does not report a ready service as aligned when account repair is not allowed", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({
        runtimeStatus: "running",
      })
    );
    readDaemonServiceContractMock.mockResolvedValueOnce(
      createServiceContract({
        profileId: "human-old",
      })
    );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      openMeldProfileId: "human-new",
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({ status: "needs_attention" });
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "start.service.account_alignment_failed",
        data: { reasonCode: "service_contract.profile_mismatch" },
      })
    );
  });

  it("uses the shared start prompt for start + keep_running + not_running", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        runtimeStatus: "not_running",
      })
    );
    selectPromptMock.mockResolvedValueOnce("not_now");
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      localDemand: createLocalDemand(),
      view: "human",
    });

    expect(result).toEqual({ status: "declined" });
    expect(selectPromptMock.mock.calls[0]?.[0]).toEqual(
      buildDaemonStartDecisionPromptConfig()
    );
    expect(renderInfoCardMock).toHaveBeenCalledTimes(1);
  });

  it("uses the shared install prompt for space join when OpenMeld Service is missing", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        installedVersion: null,
      })
    );
    selectPromptMock.mockResolvedValueOnce("not_now");
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "space_join",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      gatewayUrl: "http://localhost:8080",
      localDemand: createLocalDemand(),
      view: "human",
    });

    expect(result).toEqual({ status: "declined" });
    expect(selectPromptMock.mock.calls[0]?.[0]).toEqual(
      buildDaemonInstallDecisionPromptConfig({
        kind: "missing",
        expectedVersion: packageJson.version,
      })
    );
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
  });

  it.each([
    "start",
    "space_join",
    "space_create_join",
    "space_add_members",
  ] as const)("runs repair and continues for %s when service drift is detected", async (intent) => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          installedVersion: packageJson.version,
          runtimeStatus: "running",
          anomalyCodes: ["runtime_contract_mismatch"],
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          installedVersion: packageJson.version,
          runtimeStatus: "running",
          anomalyCodes: [],
        })
      );
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent,
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      gatewayUrl: "http://localhost:8080",
      localDemand: createLocalDemand(),
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).toHaveBeenCalledWith(
      {
        agentOverviewHandled: true,
        gatewayUrl: "http://localhost:8080",
        view: "human",
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        suppressAgentOverview: true,
        suppressInstallOutput: true,
      }
    );
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("does not report aligned when OpenMeld Service is still not running after a background start attempt", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "not_running",
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: "not_running",
        })
      );
    selectPromptMock.mockResolvedValueOnce("start");
    runDaemonBackgroundStartForDecisionMock.mockResolvedValueOnce("started");
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      gatewayUrl: "http://localhost:8080",
      localDemand: createLocalDemand(),
      view: "human",
    });

    expect(result).toEqual({ status: "needs_attention" });
    expect(renderInfoCardMock).toHaveBeenCalledTimes(1);
  });

  it("starts an outdated stopped service instead of requiring an update first", async () => {
    let serviceStarted = false;
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      createInventory({
        installedVersion: "0.1.5",
        runtimeStatus: serviceStarted ? "running" : "not_running",
      })
    );
    runDaemonBackgroundStartForDecisionMock.mockImplementation(() => {
      serviceStarted = true;
      return "started";
    });
    selectPromptMock.mockResolvedValueOnce("start");
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      localDemand: createLocalDemand(),
      view: "human",
    });

    expect(result).toEqual({ status: "aligned" });
    expect(runDaemonInstallMock).not.toHaveBeenCalled();
    expect(runDaemonReinstallMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: undefined,
      view: "human",
    });
    expect(selectPromptMock.mock.calls[0]?.[0]).toEqual(
      buildDaemonStartDecisionPromptConfig()
    );
  });

  it("returns cancelled when the shared prompt is cancelled", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        runtimeStatus: "not_running",
      })
    );
    selectPromptMock.mockResolvedValueOnce("__cancel__");
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "space_join",
      presenter,
      resolvedView: "human",
      allowPrompt: true,
      localDemand: createLocalDemand(),
      view: "human",
    });

    expect(result).toEqual({ status: "cancelled" });
  });

  it("surfaces the never-spawned verdict card when a repair start is blocked by macOS", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValueOnce(
      createInventory({
        anomalyCodes: ["bundle_id_drift", "bundle_version_drift"],
        runtimeStatus: "not_running",
      })
    );
    runDaemonReinstallMock.mockResolvedValueOnce({
      ok: false,
      result: "start_failed",
      desiredState: "background",
      forceUsed: false,
      backupDataPath: null,
      startFailureVerdict: {
        controller: "launchd",
        message: "startup timed out",
        detail: null,
        jobDiagnostics: {
          controller: "launchd",
          loaded: true,
          runs: 0,
          state: "not running",
          lastExitCodeText: "(never exited)",
          lastExitCode: null,
          pendedNondemandSpawn: "speculative",
          keepaliveRunAtLoad: true,
        },
        localMachineIssue: {
          schemaVersion: 1,
          code: "local_machine.background_execution.blocked",
          operation: "start_background_service",
          recoveryPolicy: "user_action",
          summary:
            "macOS blocked OpenMeld Service from running in the background.",
          primaryAction:
            "Open System Settings > General > Login Items & Extensions, enable OpenMeld, then try again.",
          diagnostics: {
            systemCode: "BACKGROUND_EXECUTION_BLOCKED",
            detail: "launchd never spawned the job",
          },
        },
      },
    });
    const presenter = createPresenter();

    const result = await runDaemonServiceParticipationGate({
      intent: "start",
      presenter,
      resolvedView: "human",
      allowPrompt: false,
      autoRepair: true,
      forcePrompt: true,
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });

    expect(result).toEqual({
      status: "needs_attention",
      errorMessage: expect.stringContaining(
        "pended nondemand spawn=speculative"
      ),
      localMachineIssue: expect.objectContaining({
        code: "local_machine.background_execution.blocked",
      }),
    });
    const cardCall = renderInfoCardMock.mock.calls.at(-1)?.[0] as {
      title: string;
      rows: Array<{ label: string; value: string }>;
    };
    expect(cardCall.title).toBe("OpenMeld Service couldn't start");
    expect(
      cardCall.rows.some((row) =>
        row.value.includes(
          "macOS blocked OpenMeld Service from running in the background"
        )
      )
    ).toBe(true);
    const nextRow = cardCall.rows.find((row) => row.label.includes("Next"));
    expect(nextRow?.value).toContain("Login Items & Extensions");
    expect(nextRow?.value).toContain("try again");
    expect(nextRow?.value).not.toContain("--mode foreground");
    // The generic "was repaired, but not running yet" copy must NOT appear.
    expect(
      cardCall.rows.some((row) =>
        row.value.includes("was repaired, but it is not running yet")
      )
    ).toBe(false);
  });
});
