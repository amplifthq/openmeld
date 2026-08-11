import { beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import { runServiceCheck } from "../src/command-entry-checks/check-service";
import type { CommandEntryContext } from "../src/command-entry-checks/types";

const {
  getDaemonStatusMock,
  inspectDaemonServiceInventoryMock,
  runDaemonBackgroundStartForDecisionMock,
  runDaemonStartupPreflightMock,
  runDaemonStatusMock,
  selectPromptMock,
  showHumanCheckCardMock,
} = vi.hoisted(() => ({
  getDaemonStatusMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  runDaemonBackgroundStartForDecisionMock: vi.fn(),
  runDaemonStartupPreflightMock: vi.fn(),
  runDaemonStatusMock: vi.fn(),
  selectPromptMock: vi.fn(),
  showHumanCheckCardMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  select: (...args: Parameters<typeof selectPromptMock>) =>
    selectPromptMock(...args),
}));

vi.mock("../src/command-entry-checks/show-human-check-card", () => ({
  showHumanCheckCard: (...args: Parameters<typeof showHumanCheckCardMock>) =>
    showHumanCheckCardMock(...args),
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    getDaemonStatus: (...args: Parameters<typeof getDaemonStatusMock>) =>
      getDaemonStatusMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: (
    ...args: Parameters<typeof inspectDaemonServiceInventoryMock>
  ) => inspectDaemonServiceInventoryMock(...args),
}));

vi.mock("../src/commands/service", async () => {
  const actual = await vi.importActual<
    typeof import("../src/commands/service")
  >("../src/commands/service");
  return {
    ...actual,
    runDaemonBackgroundStartForDecision: (
      ...args: Parameters<typeof runDaemonBackgroundStartForDecisionMock>
    ) => runDaemonBackgroundStartForDecisionMock(...args),
    runDaemonStatus: (...args: Parameters<typeof runDaemonStatusMock>) =>
      runDaemonStatusMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-startup-preflight", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-startup-preflight")
  >("../src/local-service/lifecycle/daemon-startup-preflight");
  return {
    ...actual,
    runDaemonStartupPreflight: (
      ...args: Parameters<typeof runDaemonStartupPreflightMock>
    ) => runDaemonStartupPreflightMock(...args),
  };
});

function createInventory(input?: {
  installedVersion?: string | null;
  runtimeStatus?: "not_running" | "running" | "stale" | "unknown";
  anomalyCodes?: string[];
  verifiedExecutionEvidence?: boolean;
}) {
  const installedVersion =
    input?.installedVersion === undefined
      ? packageJson.version
      : input.installedVersion;
  const inventory = {
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
      status: input?.runtimeStatus ?? "running",
      mode: input?.runtimeStatus === "running" ? "background" : null,
      pid: input?.runtimeStatus === "running" ? 123 : null,
      startedAt:
        input?.runtimeStatus === "running" ? "2026-03-01T00:00:00.000Z" : null,
      updatedAt:
        input?.runtimeStatus === "running" ? "2026-03-01T00:00:00.000Z" : null,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    anomalies: (input?.anomalyCodes ?? []).map((code) => ({
      code,
      message: String(code),
    })),
  };
  if (input?.verifiedExecutionEvidence) {
    return {
      ...inventory,
      activeBundleEntryPath:
        "/Users/felix/.openmeld/runtime/daemon/bundles/current/dist/openmeld.js",
      runtimeCommandEntryPath:
        "/Users/felix/.openmeld/runtime/daemon/bundles/current/dist/openmeld.js",
      runtimeCommandPathExists: true,
      runtimeContractCompatibility: {
        expectedEpoch: "daemon-runtime-epoch-test",
        observedEpoch: "daemon-runtime-epoch-test",
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      serviceContract: {
        schema: "openmeld-daemon-service-contract-v1",
        v: 1,
        lane: "prod",
        daemonVersion: packageJson.version,
        bundleId: "daemon-bundle-test",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "https://openmeld.invalid",
        profileId: "human-profile-test",
        deviceId: "device-test",
        heartbeatMs: 30_000,
        generation: 1,
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    };
  }
  return inventory;
}

function createContext(input?: {
  entryName?: "space.join" | "space.watch" | "service.trace";
  resolvedView?: "human" | "agent";
  allowPrompt?: boolean;
}): CommandEntryContext {
  const resolvedView = input?.resolvedView ?? "agent";
  return {
    entryName: input?.entryName ?? "space.watch",
    argv: [],
    runtime: {
      viewMode: resolvedView,
      resolvedView,
      interactive: resolvedView === "human",
    },
    presenter: {
      view: resolvedView,
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    },
    allowPrompt: input?.allowPrompt ?? resolvedView === "human",
    environmentTarget: {
      authBaseUrl: "http://localhost:8788",
      gatewayUrl: "http://localhost:8080",
      preset: "dev-local",
      userFacingCommand: "openmeld-dev",
    },
    gatewayUrl: "http://localhost:8080",
    profileArg: null,
    jsonOutput: false,
  };
}

describe("command entry service check", () => {
  // Re-created in beforeEach (not once here): the global afterEach in
  // setup-env.ts runs vi.restoreAllMocks(), which detaches this spy after the
  // first test. Without re-attaching, later tests observe zero console.warn
  // calls and the warning-path assertions fail depending on run order.
  let consoleWarnSpy = vi
    .spyOn(console, "warn")
    .mockImplementation(() => undefined);

  beforeEach(() => {
    consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    getDaemonStatusMock.mockReset().mockResolvedValue({
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: packageJson.version,
        installSource: "daemon.command.install",
        installedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValue(createInventory());
    runDaemonBackgroundStartForDecisionMock
      .mockReset()
      .mockResolvedValue("started");
    runDaemonStartupPreflightMock.mockReset().mockResolvedValue({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });
    runDaemonStatusMock.mockReset().mockResolvedValue(undefined);
    selectPromptMock.mockReset();
    showHumanCheckCardMock.mockReset();
  });

  it("continues immediately when service inventory reports running", async () => {
    const context = createContext();

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "required",
        stage: "before-entry",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(context.presenter.data).not.toHaveBeenCalled();
    expect(showHumanCheckCardMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("reports a not-running service in agent status-only mode", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        runtimeStatus: "not_running",
      })
    );
    const context = createContext();

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "status-only",
        stage: "status-only",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(context.presenter.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "command.entry.service.status",
        payload: expect.objectContaining({
          reason: "OpenMeld Service is installed but not running.",
          nextSteps: ["openmeld setup"],
          humanActionRequired: false,
          details: expect.objectContaining({
            installedVersion: packageJson.version,
            runtimeStatus: "not_running",
            serviceStatusKind: "not_running",
          }),
        }),
      })
    );
  });

  it("reports stale service drift as non-blocking refresh guidance", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        anomalyCodes: ["bundle_content_drift", "service_manager_path_drift"],
        runtimeStatus: "stale",
      })
    );
    const context = createContext();

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "status-only",
        stage: "status-only",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(context.presenter.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "command.entry.service.status",
        payload: expect.objectContaining({
          reason:
            "Reconnect OpenMeld Service before this computer can receive local Wake work.",
          nextSteps: ["openmeld setup"],
          details: expect.objectContaining({
            anomalyCodes: [
              "bundle_content_drift",
              "service_manager_path_drift",
            ],
            expectedVersion: packageJson.version,
            installedVersion: packageJson.version,
            runtimeStatus: "stale",
            serviceReadinessState: "refresh_needed",
            serviceStatusKind: "needs_repair",
          }),
        }),
      })
    );
  });

  it("reports running advisory service drift in agent view without blocking", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        anomalyCodes: ["bundle_content_drift"],
        verifiedExecutionEvidence: true,
      })
    );
    const context = createContext();

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "status-only",
        stage: "status-only",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(context.presenter.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "command.entry.service.status",
        payload: expect.objectContaining({
          status: "needs_attention",
          reason: expect.stringContaining(
            "OpenMeld Service is running, but its local service bundle is not current"
          ),
          nextSteps: ["openmeld setup"],
          details: expect.objectContaining({
            advisoryAnomalyCodes: ["bundle_content_drift"],
            anomalyCodes: ["bundle_content_drift"],
            runtimeStatus: "running",
            serviceReadinessState: "update_available",
            serviceStatusKind: "ready",
          }),
        }),
      })
    );
  });

  it("prompts and starts OpenMeld Service for human optional flows", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        runtimeStatus: "not_running",
      })
    );
    selectPromptMock.mockImplementationOnce(
      async (input: {
        options?: Array<{
          value: string;
        }>;
      }) => input.options?.[0]?.value ?? "__missing__"
    );
    const context = createContext({
      entryName: "service.trace",
      resolvedView: "human",
      allowPrompt: true,
    });

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "optional",
        stage: "after-profile",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(showHumanCheckCardMock).toHaveBeenCalledTimes(1);
    expect(runDaemonBackgroundStartForDecisionMock).toHaveBeenCalledWith({
      gatewayUrl: "http://localhost:8080",
      view: "human",
    });
  });

  it("surfaces startup preflight repair guidance instead of prompting a start", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        runtimeStatus: "not_running",
      })
    );
    runDaemonStartupPreflightMock.mockResolvedValueOnce({
      status: "blocked",
      reasonCodes: ["service.drifted"],
      errorMessage: "repair required",
      cooldownUntil: null,
      backupDataPath: null,
    });
    const context = createContext({
      entryName: "service.trace",
      resolvedView: "human",
      allowPrompt: true,
    });

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "optional",
        stage: "after-profile",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(showHumanCheckCardMock).toHaveBeenCalledTimes(1);
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(runDaemonBackgroundStartForDecisionMock).not.toHaveBeenCalled();
  });

  it("surfaces an explicit inspection failure when inventory resolution throws", async () => {
    inspectDaemonServiceInventoryMock.mockRejectedValue(
      new Error("inventory exploded")
    );
    const context = createContext();

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "status-only",
        stage: "status-only",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "[openmeld.command_entry.service_check.warning]",
      expect.objectContaining({
        message: "resolveDaemonServiceParticipationStatus failed",
      })
    );
    expect(context.presenter.data).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "command.entry.service.status",
        payload: expect.objectContaining({
          reason: "OpenMeld could not inspect OpenMeld Service on this device.",
          nextSteps: ["openmeld service status", "openmeld service repair"],
        }),
      })
    );
  });

  it("surfaces compatible advisory service drift in human status-only mode", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        anomalyCodes: ["bundle_content_drift"],
        verifiedExecutionEvidence: true,
      })
    );
    const context = createContext({
      entryName: "space.join",
      resolvedView: "human",
    });

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "status-only",
        stage: "status-only",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(showHumanCheckCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "OpenMeld Service",
        status: expect.stringContaining(
          "OpenMeld Service is running, but its local service bundle is not current"
        ),
        next: "Run `openmeld setup` to update OpenMeld Service.",
      })
    );
    const humanCardText = JSON.stringify(showHumanCheckCardMock.mock.calls);
    expect(humanCardText).not.toContain("bundle_content_drift");
  });

  it("no longer suppresses the standalone human card for space join", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        anomalyCodes: ["runtime_stale"],
        runtimeStatus: "stale",
      })
    );
    const context = createContext({
      entryName: "space.join",
      resolvedView: "human",
      allowPrompt: true,
    });

    const result = await runServiceCheck({
      context,
      requirement: {
        mode: "status-only",
        stage: "status-only",
      },
    });

    expect(result).toEqual({ status: "continue" });
    expect(showHumanCheckCardMock).toHaveBeenCalledTimes(1);
    expect(selectPromptMock).not.toHaveBeenCalled();
  });
});
