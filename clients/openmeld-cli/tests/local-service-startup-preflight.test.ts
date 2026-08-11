import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonActiveBundleState } from "../src/local-service/lifecycle/daemon-service-bundle";
import { runDaemonStartupPreflight } from "../src/local-service/lifecycle/daemon-startup-preflight";

const {
  inspectDaemonServiceInventoryMock,
  runDaemonServiceAutoHealMock,
  runDaemonServiceFullAlignmentMock,
} = vi.hoisted(() => ({
  inspectDaemonServiceInventoryMock: vi.fn(),
  runDaemonServiceAutoHealMock: vi.fn(),
  runDaemonServiceFullAlignmentMock: vi.fn(),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-inventory")
  >("../src/local-service/lifecycle/daemon-service-inventory");
  return {
    ...actual,
    inspectDaemonServiceInventory: (...args: unknown[]) =>
      inspectDaemonServiceInventoryMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-auto-heal", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-auto-heal")
  >("../src/local-service/lifecycle/daemon-service-auto-heal");
  return {
    ...actual,
    runDaemonServiceAutoHeal: (...args: unknown[]) =>
      runDaemonServiceAutoHealMock(...args),
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-alignment-executor",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-alignment-executor")
    >("../src/local-service/lifecycle/daemon-service-alignment-executor");
    return {
      ...actual,
      runDaemonServiceFullAlignment: (...args: unknown[]) =>
        runDaemonServiceFullAlignmentMock(...args),
    };
  }
);

describe("local service startup preflight", () => {
  beforeEach(() => {
    inspectDaemonServiceInventoryMock.mockReset();
    runDaemonServiceAutoHealMock.mockReset();
    runDaemonServiceFullAlignmentMock.mockReset();
  });

  it("returns already_aligned without running repairs when the service already matches the target", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
          definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
          commandSummary:
            "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
        },
      })
    );

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
      cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
    });

    expect(result).toEqual({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });
    expect(runDaemonServiceAutoHealMock).not.toHaveBeenCalled();
    expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
  });

  it("runs full alignment for same-version dirty services during startup", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        activeBundle: createActiveBundle({
          bundleFormat: "legacy_linked_v1",
        }),
        anomalies: [
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
        ],
      })
    );
    runDaemonServiceFullAlignmentMock.mockResolvedValue({
      status: "aligned",
      targetVersion: "0.2.0",
      inventoryBefore: createInventory(),
      inventoryAfter: createInventory(),
      reasonCodes: [],
      completedSteps: [],
      restoredBackground: false,
      backupDataPath: null,
      errorMessage: null,
    });

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
      cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
    });

    expect(result.status).toBe("aligned");
    expect(runDaemonServiceAutoHealMock).not.toHaveBeenCalled();
    expect(runDaemonServiceFullAlignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: "0.2.0",
        intent: "startup_check",
        cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
        onProgress: expect.any(Function),
      })
    );
  });

  it("runs full alignment for same-version bundle content drift during startup", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        activeBundle: createActiveBundle(),
        anomalies: [
          {
            code: "bundle_content_drift",
            message:
              "OpenMeld Service is using older local service files than this lane expects, so OpenMeld needs to update the service.",
          },
        ],
      })
    );
    runDaemonServiceFullAlignmentMock.mockResolvedValue({
      status: "aligned",
      targetVersion: "0.2.0",
      inventoryBefore: createInventory(),
      inventoryAfter: createInventory(),
      reasonCodes: [],
      completedSteps: [],
      restoredBackground: false,
      backupDataPath: null,
      errorMessage: null,
    });

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
      cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
    });

    expect(result.status).toBe("aligned");
    expect(runDaemonServiceAutoHealMock).not.toHaveBeenCalled();
    expect(runDaemonServiceFullAlignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: "0.2.0",
        intent: "startup_check",
        cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
        onProgress: expect.any(Function),
      })
    );
  });

  it("runs full alignment when only a legacy shared residual is present", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        installStatus: {
          installed: false,
          state: null,
        },
        legacySharedService: {
          present: true,
          pathInput: {
            env: {
              OPENMELD_ENV_PRESET: "prod",
            },
          },
          installStatus: {
            installed: false,
            state: null,
          },
          runtimeStatus: createRuntimeStatus({
            status: "stale",
            mode: "background",
            pid: 900,
            managedBySystemService: false,
            serviceController: "legacy-detached",
            autoStart: false,
            reason: "process_not_alive",
          }),
          serviceManager: null,
          serviceManagerStatus: {
            installed: false,
            running: false,
            enabled: false,
            definitionPath: null,
            commandSummary: null,
          },
          ownedProcesses: [],
        },
        anomalies: [
          {
            code: "legacy_shared_service_present",
            message:
              "A legacy shared OpenMeld Service from the pre-lane release is still installed and must be migrated to this lane.",
          },
        ],
      })
    );
    runDaemonServiceFullAlignmentMock.mockResolvedValue({
      status: "aligned",
      targetVersion: "0.2.0",
      inventoryBefore: createInventory(),
      inventoryAfter: createInventory(),
      reasonCodes: ["legacy_shared_service_present"],
      completedSteps: [],
      restoredBackground: false,
      backupDataPath: null,
      errorMessage: null,
    });

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
    });

    expect(result.status).toBe("aligned");
    expect(runDaemonServiceAutoHealMock).not.toHaveBeenCalled();
    expect(runDaemonServiceFullAlignmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: "0.2.0",
        intent: "startup_check",
      })
    );
  });

  it("runs safe auto-heal for low-risk startup anomalies", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        anomalies: [
          {
            code: "runtime_stale",
            message: "Runtime state is stale (process_not_alive).",
          },
        ],
        runtimeStatus: createRuntimeStatus({
          status: "stale",
          mode: "background",
          pid: 411,
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
          reason: "process_not_alive",
        }),
      })
    );
    runDaemonServiceAutoHealMock.mockResolvedValue({
      status: "repaired",
      inventoryBefore: createInventory(),
      inventoryAfter: createInventory(),
      appliedActions: ["clear_stale_runtime_state"],
      blockedAnomalyCodes: [],
      errorMessage: null,
      cooldownUntil: null,
    });

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
    });

    expect(result.status).toBe("auto_healed");
    expect(runDaemonServiceAutoHealMock).toHaveBeenCalledWith({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });
    expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
  });

  it("surfaces downgrade blocks without attempting auto-heal or alignment", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.3.0",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
      })
    );

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
    });

    expect(result).toEqual({
      status: "blocked",
      reasonCodes: ["downgrade_blocked"],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });
    expect(runDaemonServiceAutoHealMock).not.toHaveBeenCalled();
    expect(runDaemonServiceFullAlignmentMock).not.toHaveBeenCalled();
  });

  it("settles lock conflicts by re-inspecting inventory before failing startup", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          activeBundle: createActiveBundle({
            bundleFormat: "legacy_linked_v1",
          }),
          anomalies: [
            {
              code: "bundle_strategy_legacy",
              message:
                "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
          },
        })
      );
    runDaemonServiceFullAlignmentMock.mockResolvedValue({
      status: "failed",
      targetVersion: "0.2.0",
      inventoryBefore: createInventory(),
      inventoryAfter: null,
      reasonCodes: [],
      completedSteps: [],
      restoredBackground: false,
      backupDataPath: null,
      errorMessage:
        "OpenMeld service alignment is already running in another local process.",
    });

    const result = await runDaemonStartupPreflight({
      expectedVersion: "0.2.0",
    });

    expect(result.status).toBe("already_aligned");
    expect(inspectDaemonServiceInventoryMock).toHaveBeenCalledTimes(2);
  });
});

function createInventory(
  overrides: Partial<
    Awaited<
      ReturnType<
        typeof import("../src/local-service/lifecycle/daemon-service-inventory").inspectDaemonServiceInventory
      >
    >
  > = {}
) {
  return {
    expectedVersion: "0.2.0",
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.0",
        installSource: "daemon.command.install",
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      },
    },
    runtimeStatus: createRuntimeStatus({
      status: "not_running",
    }),
    legacySharedService: null,
    activeBundle: createActiveBundle({
      bundleFormat: "self_contained_v1",
    }),
    activeBundleSourceAvailable: true,
    activeBundleEntryPath:
      "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
    runtimeCommandPathExists: true,
    serviceManager: null,
    serviceManagerStatus: null,
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
    ...overrides,
  };
}

function createRuntimeStatus(
  overrides: Partial<
    Awaited<
      ReturnType<
        typeof import("../src/config/daemon-state").getDaemonRuntimeStatus
      >
    >
  > & {
    status: "running" | "stale" | "not_running" | "unknown";
  }
) {
  return {
    status: overrides.status,
    mode: overrides.mode ?? null,
    pid: overrides.pid ?? null,
    startedAt: overrides.startedAt ?? null,
    updatedAt: overrides.updatedAt ?? null,
    managedBySystemService: overrides.managedBySystemService ?? false,
    serviceController: overrides.serviceController ?? "unknown",
    autoStart: overrides.autoStart ?? false,
    ...(overrides.reason ? { reason: overrides.reason } : {}),
  };
}

function createActiveBundle(
  input: { bundleFormat?: "legacy_linked_v1" | "self_contained_v1" } = {}
): DaemonActiveBundleState {
  return {
    v: 2,
    schema: "openmeld-daemon-active-bundle-v2",
    bundleId: "bundle-1",
    daemonVersion: "0.2.0",
    entryScriptRelativePath: "dist/openmeld.js",
    bundleFormat: input.bundleFormat ?? "self_contained_v1",
    sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
    sourcePackageRootPath: "/tmp/current-cli",
    sourceDistRootPath: "/tmp/current-cli/dist",
    sourceKind: "workspace" as const,
    createdAt: "2026-03-07T00:00:00.000Z",
    updatedAt: "2026-03-07T00:00:00.000Z",
  };
}
