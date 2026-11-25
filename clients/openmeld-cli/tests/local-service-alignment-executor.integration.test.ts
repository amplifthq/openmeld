import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import { daemonStatePath } from "../src/config/daemon-state";
import { CONTROLLED_SHUTDOWN_REQUEST_TIMEOUT_MS } from "../src/local-service/core/constants";
import { runDaemonServiceFullAlignment } from "../src/local-service/lifecycle/daemon-service-alignment-executor";
import {
  type DaemonActiveBundleState,
  daemonServiceActiveBundlePath,
} from "../src/local-service/lifecycle/daemon-service-bundle";
import { withTempHome } from "./helpers/fs";

const DAEMON_SERVICE_LAUNCHER_PATH_PATTERN = /daemon-service-launcher\.mjs$/;

vi.mock(
  "../src/local-service/lifecycle/daemon-service-startup-wait",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-service/lifecycle/daemon-service-startup-wait")
      >();
    return {
      ...actual,
      waitForSystemServiceStartup: (
        input: Parameters<typeof actual.waitForSystemServiceStartup>[0]
      ) =>
        actual.waitForSystemServiceStartup({ ...input, waitMs: 50, pollMs: 1 }),
    };
  }
);

// Reconcile fixtures exercise service alignment without installing OS maintenance.
vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-worker-manager",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/lifecycle/daemon-service-update-worker-manager")
    >()),
    ensureDaemonServiceMaintenanceInstalled: vi.fn(async () => undefined),
  })
);

const {
  backupDaemonRuntimeDataForReinstallMock,
  captureDaemonServiceEvidenceBestEffortMock,
  clearDaemonRuntimeStateIfDefinitelyStoppedMock,
  cleanupDaemonRuntimeDataBackupMock,
  cleanupStaleDaemonRuntimeDataBackupsMock,
  restoreDaemonRuntimeDataForReinstallMock,
  clearDaemonServiceRuntimeStateMock,
  getDaemonRuntimeStatusMock,
  installDaemonMock,
  readDaemonServiceRuntimeSnapshotMock,
  uninstallDaemonMock,
  withDaemonServiceReconcileLockMock,
  prepareDaemonServiceBundleMock,
  inspectDaemonServiceInventoryMock,
  listDaemonOwnedProcessesMock,
  requestLocalDaemonShutdownMock,
  resolveDaemonServiceManagerMock,
  verifyDaemonActiveBundleIntegrityMock,
  waitForDaemonSystemServiceToStopMock,
} = vi.hoisted(() => ({
  backupDaemonRuntimeDataForReinstallMock: vi.fn(),
  captureDaemonServiceEvidenceBestEffortMock: vi.fn(),
  clearDaemonRuntimeStateIfDefinitelyStoppedMock: vi.fn(),
  cleanupDaemonRuntimeDataBackupMock: vi.fn(),
  cleanupStaleDaemonRuntimeDataBackupsMock: vi.fn(),
  restoreDaemonRuntimeDataForReinstallMock: vi.fn(),
  clearDaemonServiceRuntimeStateMock: vi.fn(),
  getDaemonRuntimeStatusMock: vi.fn(),
  installDaemonMock: vi.fn(),
  readDaemonServiceRuntimeSnapshotMock: vi.fn(),
  uninstallDaemonMock: vi.fn(),
  withDaemonServiceReconcileLockMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  requestLocalDaemonShutdownMock: vi.fn(),
  resolveDaemonServiceManagerMock: vi.fn(),
  verifyDaemonActiveBundleIntegrityMock: vi.fn(),
  waitForDaemonSystemServiceToStopMock: vi.fn(),
}));

vi.mock("../src/local-service/control-plane/client", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/control-plane/client")
  >("../src/local-service/control-plane/client");
  return {
    ...actual,
    requestLocalDaemonShutdown: requestLocalDaemonShutdownMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-evidence", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-evidence")
  >("../src/local-service/lifecycle/daemon-service-evidence");
  return {
    ...actual,
    captureDaemonServiceEvidenceBestEffort:
      captureDaemonServiceEvidenceBestEffortMock,
  };
});

vi.mock("../src/local-service/state/runtime-data-preservation", () => ({
  backupDaemonRuntimeDataForReinstall: backupDaemonRuntimeDataForReinstallMock,
  cleanupDaemonRuntimeDataBackup: cleanupDaemonRuntimeDataBackupMock,
  cleanupStaleDaemonRuntimeDataBackups:
    cleanupStaleDaemonRuntimeDataBackupsMock,
  restoreDaemonRuntimeDataForReinstall:
    restoreDaemonRuntimeDataForReinstallMock,
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    clearDaemonServiceRuntimeState: clearDaemonServiceRuntimeStateMock,
    getDaemonRuntimeStatus: getDaemonRuntimeStatusMock,
    installDaemon: installDaemonMock,
    readDaemonServiceRuntimeSnapshot: readDaemonServiceRuntimeSnapshotMock,
    uninstallDaemon: uninstallDaemonMock,
    withDaemonServiceReconcileLock: withDaemonServiceReconcileLockMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-bundle")
  >("../src/local-service/lifecycle/daemon-service-bundle");
  return {
    ...actual,
    prepareDaemonServiceBundle: prepareDaemonServiceBundleMock,
    verifyDaemonActiveBundleIntegrity: verifyDaemonActiveBundleIntegrityMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-inventory")
  >("../src/local-service/lifecycle/daemon-service-inventory");
  return {
    ...actual,
    inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-manager", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-manager")
  >("../src/local-service/lifecycle/daemon-service-manager");
  return {
    ...actual,
    resolveDaemonServiceManager: resolveDaemonServiceManagerMock,
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-process-inventory")
    >("../src/local-service/lifecycle/daemon-service-process-inventory");
    return {
      ...actual,
      listDaemonOwnedProcesses: listDaemonOwnedProcessesMock,
    };
  }
);

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-runtime")
  >("../src/local-service/lifecycle/daemon-service-runtime");
  return {
    ...actual,
    clearDaemonRuntimeStateIfDefinitelyStopped:
      clearDaemonRuntimeStateIfDefinitelyStoppedMock,
    readCurrentObservedDaemonRuntimeStatus: getDaemonRuntimeStatusMock,
    waitForDaemonSystemServiceToStop: waitForDaemonSystemServiceToStopMock,
  };
});

describe("local service alignment executor", () => {
  const aliveProcessIds = new Set<number>();
  let processKillSpy: { mockRestore: () => void } | null = null;
  let previousOpenMeldHome: string | undefined;
  let previousHome: string | undefined;
  let tempHome: string | null = null;

  beforeEach(async () => {
    previousOpenMeldHome = process.env.OPENMELD_HOME;
    previousHome = process.env.HOME;
    tempHome = await mkdtemp(join(tmpdir(), "openmeld-cli-alignment-test-"));
    process.env.HOME = tempHome;
    process.env.OPENMELD_HOME = join(tempHome, ".openmeld");

    captureDaemonServiceEvidenceBestEffortMock
      .mockReset()
      .mockResolvedValue(null);
    clearDaemonRuntimeStateIfDefinitelyStoppedMock
      .mockReset()
      .mockResolvedValue({
        cleared: false,
        context: {
          status: {
            installed: true,
            state: {
              daemonVersion: "0.2.0",
            },
          },
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager: null,
          serviceManagerStatus: null,
          legacySharedService: null,
          effectiveRuntimeStatus: "not_running",
        },
      });
    backupDaemonRuntimeDataForReinstallMock.mockReset().mockResolvedValue(null);
    cleanupDaemonRuntimeDataBackupMock.mockReset().mockResolvedValue(undefined);
    cleanupStaleDaemonRuntimeDataBackupsMock
      .mockReset()
      .mockResolvedValue(undefined);
    restoreDaemonRuntimeDataForReinstallMock
      .mockReset()
      .mockResolvedValue(undefined);
    clearDaemonServiceRuntimeStateMock.mockReset().mockResolvedValue(undefined);
    getDaemonRuntimeStatusMock.mockReset().mockResolvedValue(
      createRuntimeStatus({
        status: "not_running",
      })
    );
    installDaemonMock.mockReset().mockResolvedValue({
      status: "installed",
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.2.0",
        installSource: "cli.auto_check",
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      },
    });
    readDaemonServiceRuntimeSnapshotMock.mockReset().mockResolvedValue(null);
    uninstallDaemonMock.mockReset().mockResolvedValue({
      removed: true,
    });
    withDaemonServiceReconcileLockMock
      .mockReset()
      .mockImplementation(
        async (callback: () => Promise<unknown>) => await callback()
      );
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue({
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: "fresh-bundle",
      daemonVersion: "0.2.0",
      entryScriptRelativePath: "dist/openmeld.js",
      bundleFormat: "self_contained_v1",
      sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
      sourcePackageRootPath: "/tmp/current-cli",
      sourceDistRootPath: "/tmp/current-cli/dist",
      sourceKind: "workspace",
      createdAt: "2026-03-07T00:05:00.000Z",
      updatedAt: "2026-03-07T00:05:00.000Z",
    });
    inspectDaemonServiceInventoryMock.mockReset();
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
    requestLocalDaemonShutdownMock.mockReset().mockResolvedValue({
      accepted: true,
      gracePeriodMs: 0,
      mode: "graceful",
    });
    resolveDaemonServiceManagerMock.mockReset();
    verifyDaemonActiveBundleIntegrityMock.mockReset().mockResolvedValue(false);
    waitForDaemonSystemServiceToStopMock.mockReset().mockResolvedValue(true);
    aliveProcessIds.clear();
    processKillSpy = vi.spyOn(process, "kill").mockImplementation(((
      pid: number,
      signal?: NodeJS.Signals | number
    ) => {
      if (signal === 0 || signal === undefined) {
        if (!aliveProcessIds.has(pid)) {
          const error = new Error("not running") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        return true;
      }
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        aliveProcessIds.delete(pid);
        return true;
      }
      return true;
    }) as typeof process.kill);
  });

  afterEach(async () => {
    processKillSpy?.mockRestore();
    processKillSpy = null;
    if (previousHome === undefined) {
      Reflect.deleteProperty(process.env, "HOME");
    } else {
      process.env.HOME = previousHome;
    }
    if (previousOpenMeldHome === undefined) {
      Reflect.deleteProperty(process.env, "OPENMELD_HOME");
    } else {
      process.env.OPENMELD_HOME = previousOpenMeldHome;
    }
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
      tempHome = null;
    }
    previousOpenMeldHome = undefined;
    previousHome = undefined;
    vi.restoreAllMocks();
  });

  it("blocks full alignment when OpenMeld still detects an unknown owned process", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        ownedProcesses: [
          {
            pid: 411,
            parentPid: 1,
            command: "node /tmp/openmeld-runtime/daemon/service run",
            mode: null,
            ownership: "unknown",
          },
        ],
        anomalies: [
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
        ],
      })
    );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("blocked");
    expect(result.reasonCodes).toEqual([
      "bundle_strategy_legacy",
      "unknown_owned_processes",
    ]);
    expect(backupDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
  });

  it("rebuilds a missing service contract from the runtime snapshot during upgrade reconcile", async () => {
    await withTempHome(async () => {
      const serviceManager = createServiceManager();
      resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
      readDaemonServiceRuntimeSnapshotMock.mockResolvedValue({
        v: 1,
        schema: "openmeld-daemon-service-state-v1",
        status: "running",
        pid: 222,
        mode: "background",
        command:
          "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
        gatewayUrl: "https://gateway.openmeld.invalid",
        openMeldProfileId: "agt_existing",
        stopRequestedAt: null,
        heartbeatAt: "2026-03-07T00:00:00.000Z",
        startedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
      inspectDaemonServiceInventoryMock
        .mockResolvedValueOnce(
          createInventory({
            serviceContract: null,
            runtimeStatus: createRuntimeStatus({
              status: "not_running",
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: false,
              running: false,
              enabled: false,
              definitionPath: null,
              commandSummary: null,
            },
            activeBundle: createActiveBundle({
              bundleFormat: "legacy_linked_v1",
            }),
            anomalies: [
              {
                code: "bundle_provenance_drift",
                message:
                  "The active OpenMeld Service bundle still depends on a local CLI source path that is no longer available.",
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          createInventory({
            runtimeStatus: createRuntimeStatus({
              status: "not_running",
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: false,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
            },
            activeBundle: createActiveBundle({
              bundleFormat: "self_contained_v1",
            }),
            anomalies: [],
          })
        );

      const result = await runDaemonServiceFullAlignment({
        expectedVersion: "0.2.0",
        intent: "upgrade_reconcile",
        deviceId: "device_123",
      });

      expect(result.status).toBe("aligned");
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        daemonVersion: "0.2.0",
        desiredState: "stopped",
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "agt_existing",
        deviceId: "device_123",
      });
    });
  });

  it("rebuilds a running background service and restores background mode", async () => {
    const serviceManager = createServiceManager();
    let currentRuntimeStatus = createRuntimeStatus({
      status: "not_running",
    });
    aliveProcessIds.add(222);
    aliveProcessIds.add(333);
    serviceManager.start.mockImplementation(() => {
      currentRuntimeStatus = createRuntimeStatus({
        status: "running",
        mode: "background",
        pid: 444,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
    });
    getDaemonRuntimeStatusMock.mockImplementation(
      async () => currentRuntimeStatus
    );
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    readDaemonServiceRuntimeSnapshotMock.mockResolvedValue({
      v: 1,
      schema: "openmeld-daemon-service-state-v1",
      status: "running",
      pid: 222,
      mode: "background",
      command:
        "node openmeld.js service run --mode foreground --profile agt_existing",
      gatewayUrl: "https://gateway.openmeld.invalid",
      openMeldProfileId: "agt_existing",
      stopRequestedAt: null,
      heartbeatAt: "2026-03-07T00:00:00.000Z",
      startedAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    });
    backupDaemonRuntimeDataForReinstallMock.mockResolvedValue({
      backupRootPath: "/tmp/openmeld-daemon-runtime-data-123",
      backupDataPath: "/tmp/openmeld-daemon-runtime-data-123/data",
      sourceDataPath: "/Users/felix/.openmeld/runtime/daemon/data",
    });
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 222,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          ownedProcesses: [
            {
              pid: 222,
              parentPid: 1,
              command:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
              mode: "background",
              ownership: "stable_launcher",
            },
            {
              pid: 333,
              parentPid: 1,
              command: "node legacy-detached-service.js",
              mode: null,
              ownership: "legacy_detached",
            },
          ],
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
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
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 444,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          ownedProcesses: [
            {
              pid: 444,
              parentPid: 1,
              command:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
              mode: "background",
              ownership: "stable_launcher",
            },
          ],
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(true);
    expect(serviceManager.stop).toHaveBeenCalledTimes(1);
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(serviceManager.start).toHaveBeenCalledTimes(1);
    expect(serviceManager.deactivate).not.toHaveBeenCalled();
    expect(requestLocalDaemonShutdownMock).toHaveBeenCalledWith({
      payload: {
        gracePeriodMs: 2000,
        mode: "graceful",
      },
      timeoutMs: CONTROLLED_SHUTDOWN_REQUEST_TIMEOUT_MS,
    });
    expect(process.kill).not.toHaveBeenCalledWith(222, "SIGTERM");
    expect(process.kill).not.toHaveBeenCalledWith(333, "SIGTERM");
    expect(backupDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
    expect(restoreDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
    expect(cleanupDaemonRuntimeDataBackupMock).not.toHaveBeenCalled();
    expect(cleanupStaleDaemonRuntimeDataBackupsMock).toHaveBeenCalledTimes(1);
  });

  it("treats a whitespace-only explicit device id as unset and keeps the persisted contract device id during reconcile", async () => {
    await withTempHome(async () => {
      const serviceManager = createServiceManager();
      resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
      const currentContract = await upsertDaemonServiceContract({
        daemonVersion: "0.2.0",
        bundleId: "existing-bundle",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "agt_device_reuse_contract",
        deviceId: "device-from-contract",
        heartbeatMs: 25_000,
      });
      inspectDaemonServiceInventoryMock
        .mockResolvedValueOnce(
          createInventory({
            serviceContract: currentContract,
            runtimeStatus: createRuntimeStatus({
              status: "not_running",
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: false,
              running: false,
              enabled: false,
              definitionPath: null,
              commandSummary: null,
            },
            activeBundle: createActiveBundle({
              bundleFormat: "legacy_linked_v1",
            }),
            anomalies: [
              {
                code: "bundle_provenance_drift",
                message:
                  "The active OpenMeld Service bundle still depends on a local CLI source path that is no longer available.",
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          createInventory({
            runtimeStatus: createRuntimeStatus({
              status: "not_running",
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: false,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_device_reuse_contract",
            },
            activeBundle: createActiveBundle({
              bundleFormat: "self_contained_v1",
            }),
            anomalies: [],
          })
        );

      const result = await runDaemonServiceFullAlignment({
        expectedVersion: "0.2.0",
        intent: "upgrade_reconcile",
        deviceId: "   ",
      });

      expect(result.status).toBe("aligned");
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        deviceId: "device-from-contract",
      });
    });
  });

  it("auto-repairs launchd bootstrap I/O startup failure during alignment", async () => {
    const serviceManager = createServiceManager();
    let currentRuntimeStatus = createRuntimeStatus({
      status: "not_running",
    });
    serviceManager.start
      .mockRejectedValueOnce(
        new Error("Bootstrap failed: 5: Input/output error")
      )
      .mockImplementationOnce(() => {
        currentRuntimeStatus = createRuntimeStatus({
          status: "running",
          mode: "background",
          pid: 445,
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        });
      });
    getDaemonRuntimeStatusMock.mockImplementation(
      async () => currentRuntimeStatus
    );
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 222,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
          },
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
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 445,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "upgrade_reconcile",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(true);
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(2);
    expect(serviceManager.install).toHaveBeenCalledTimes(2);
    expect(serviceManager.start).toHaveBeenCalledTimes(2);
  });

  it("restores background mode for a stale managed background runtime", async () => {
    const serviceManager = createServiceManager();
    let currentRuntimeStatus = createRuntimeStatus({
      status: "stale",
      mode: "background",
      pid: 222,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
      reason: "process_not_alive",
    });
    serviceManager.start.mockImplementation(() => {
      currentRuntimeStatus = createRuntimeStatus({
        status: "running",
        mode: "background",
        pid: 555,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
    });
    getDaemonRuntimeStatusMock.mockImplementation(
      async () => currentRuntimeStatus
    );
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "stale",
            mode: "background",
            pid: 222,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
            reason: "process_not_alive",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "legacy_linked_v1",
          }),
          anomalies: [
            {
              code: "runtime_stale",
              message: "Runtime state is stale (process_not_alive).",
            },
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
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 555,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(true);
    expect(clearDaemonRuntimeStateIfDefinitelyStoppedMock).toHaveBeenCalled();
    expect(serviceManager.start).toHaveBeenCalledTimes(1);
  });

  it("does not bypass shared runtime cleanup when stale runtime state is observed", async () => {
    const serviceManager = createServiceManager();
    let currentRuntimeStatus = createRuntimeStatus({
      status: "stale",
      mode: "background",
      pid: 222,
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
      reason: "process_not_alive",
    });
    serviceManager.start.mockImplementation(() => {
      currentRuntimeStatus = createRuntimeStatus({
        status: "running",
        mode: "background",
        pid: 555,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
    });
    getDaemonRuntimeStatusMock.mockImplementation(
      async () => currentRuntimeStatus
    );
    clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockResolvedValue({
      cleared: false,
      context: {
        status: {
          installed: true,
          state: {
            daemonVersion: "0.2.0",
          },
        },
        runtimeStatus: currentRuntimeStatus,
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          running: true,
          enabled: true,
          definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
          commandSummary:
            "node daemon-service-launcher.mjs service run --mode foreground",
        },
        legacySharedService: null,
        effectiveRuntimeStatus: "running",
      },
    });
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: currentRuntimeStatus,
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "legacy_linked_v1",
          }),
          anomalies: [
            {
              code: "runtime_stale",
              message: "Runtime state is stale (process_not_alive).",
            },
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
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 555,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("aligned");
    expect(clearDaemonRuntimeStateIfDefinitelyStoppedMock).toHaveBeenCalled();
    expect(clearDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
  });

  it("restores background mode when the service manager still reports the service as running", async () => {
    const serviceManager = createServiceManager();
    let currentRuntimeStatus = createRuntimeStatus({
      status: "not_running",
    });
    serviceManager.start.mockImplementation(() => {
      currentRuntimeStatus = createRuntimeStatus({
        status: "running",
        mode: "background",
        pid: 666,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
    });
    getDaemonRuntimeStatusMock.mockImplementation(
      async () => currentRuntimeStatus
    );
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "legacy_linked_v1",
          }),
          anomalies: [
            {
              code: "manager_running_without_runtime",
              message:
                "The OS service manager reports OpenMeld Service as running, but runtime state is not healthy.",
            },
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
          runtimeStatus: createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 666,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing --gateway-url https://gateway.openmeld.invalid",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          runtimeCommandEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          runtimeCommandPathExists: true,
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(true);
    expect(serviceManager.start).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a stopped service without starting it again", async () => {
    const serviceManager = createServiceManager();
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: false,
            running: false,
            enabled: false,
            definitionPath: null,
            commandSummary: null,
          },
          activeBundle: createActiveBundle({
            bundleFormat: "legacy_linked_v1",
          }),
          anomalies: [
            {
              code: "bundle_provenance_drift",
              message:
                "The active OpenMeld Service bundle still depends on a local CLI source path that is no longer available.",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "upgrade_reconcile",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(false);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(serviceManager.deactivate).toHaveBeenCalledTimes(1);
    expect(serviceManager.start).not.toHaveBeenCalled();
  });

  it("keeps the service stopped during alignment when background was only desired, not actually running", async () => {
    await withTempHome(async () => {
      const serviceManager = createServiceManager();
      const currentContract = await upsertDaemonServiceContract({
        daemonVersion: "0.1.9",
        bundleId: "bundle-0.1.9",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "agt_safe_rollback_profile",
        deviceId: "device-safe-rollback",
        heartbeatMs: 25_000,
        lane: "prod",
      });
      resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
      inspectDaemonServiceInventoryMock
        .mockResolvedValueOnce(
          createInventory({
            serviceContract: currentContract,
            runtimeStatus: createRuntimeStatus({
              status: "not_running",
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: false,
              running: false,
              enabled: false,
              definitionPath: null,
              commandSummary: null,
            },
            activeBundle: createActiveBundle({
              bundleId: "bundle-0.1.9",
              daemonVersion: "0.1.9",
              bundleFormat: "legacy_linked_v1",
            }),
            activeBundleEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandEntryPath: null,
            runtimeCommandPathExists: null,
            anomalies: [
              {
                code: "version_outdated",
                message:
                  "Configured OpenMeld Service version is v0.1.9, expected v0.2.0.",
              },
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
            serviceContract: {
              ...currentContract,
              daemonVersion: "0.2.0",
              bundleId: "fresh-bundle",
            },
            runtimeStatus: createRuntimeStatus({
              status: "not_running",
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: false,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
            },
            activeBundle: createActiveBundle({
              bundleId: "fresh-bundle",
              bundleFormat: "self_contained_v1",
            }),
            activeBundleEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
            runtimeCommandEntryPath: null,
            runtimeCommandPathExists: null,
            anomalies: [],
          })
        );

      const result = await runDaemonServiceFullAlignment({
        expectedVersion: "0.2.0",
        intent: "upgrade_reconcile",
      });

      expect(result.status).toBe("aligned");
      expect(result.restoredBackground).toBe(false);
      expect(serviceManager.start).not.toHaveBeenCalled();
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        daemonVersion: "0.2.0",
        desiredState: "background",
      });
    });
  });

  it("prefers service contract desiredState over stale manager-running signals when deciding whether to restore background mode", async () => {
    const serviceManager = createServiceManager();
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
          },
          serviceContract: {
            schema: "openmeld-daemon-service-contract-v1",
            v: 1,
            lane: "prod",
            daemonVersion: "0.2.0",
            bundleId: "bundle-1",
            desiredState: "stopped",
            serviceController: "launchd",
            autoStart: false,
            gatewayUrl: "https://gateway.openmeld.invalid",
            profileId: "agt_existing",
            deviceId: "device_123",
            heartbeatMs: 25_000,
            generation: 4,
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
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
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
            commandSummary:
              "node daemon-service-launcher.mjs service run --mode foreground",
          },
          serviceContract: {
            schema: "openmeld-daemon-service-contract-v1",
            v: 1,
            lane: "prod",
            daemonVersion: "0.2.0",
            bundleId: "bundle-1",
            desiredState: "stopped",
            serviceController: "launchd",
            autoStart: false,
            gatewayUrl: "https://gateway.openmeld.invalid",
            profileId: "agt_existing",
            deviceId: "device_123",
            heartbeatMs: 25_000,
            generation: 5,
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(false);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(serviceManager.deactivate).toHaveBeenCalledTimes(1);
    expect(serviceManager.start).not.toHaveBeenCalled();
  });

  it("treats install-state version drift as metadata when contract, bundle, and manager are already aligned", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.0",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
        runtimeStatus: createRuntimeStatus({
          status: "not_running",
        }),
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
          definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
          commandSummary:
            "node daemon-service-launcher.mjs service run --mode foreground",
        },
        anomalies: [],
      })
    );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("already_aligned");
    expect(prepareDaemonServiceBundleMock).not.toHaveBeenCalled();
    expect(installDaemonMock).not.toHaveBeenCalled();
  });

  it("reinstalls stopped Windows service registration without reusing quoted command summary business args", async () => {
    const serviceManager = createServiceManager({
      controller: "windows-service",
    });
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath:
              "C:\\Users\\felix\\.openmeld\\runtime\\daemon\\openmeld-daemon-runner.bat",
            commandSummary:
              '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\felix\\.openmeld\\runtime\\daemon\\service-manager\\daemon-service-launcher.mjs" "service" "run" "--mode" "foreground" "--profile" "agt_existing" "--gateway-url" "https://gateway.openmeld.invalid" "--device-id" "device-123" "--heartbeat-ms" "9000"',
          },
          activeBundle: createActiveBundle({
            bundleFormat: "legacy_linked_v1",
          }),
          anomalies: [
            {
              code: "bundle_provenance_drift",
              message:
                "The active OpenMeld Service bundle still depends on a local CLI source path that is no longer available.",
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        createInventory({
          runtimeStatus: createRuntimeStatus({
            status: "not_running",
          }),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath:
              "C:\\Users\\felix\\.openmeld\\runtime\\daemon\\openmeld-daemon-runner.bat",
            commandSummary:
              '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\felix\\.openmeld\\runtime\\daemon\\service-manager\\daemon-service-launcher.mjs" "service" "run" "--mode" "foreground" "--profile" "agt_existing" "--gateway-url" "https://gateway.openmeld.invalid" "--device-id" "device-123" "--heartbeat-ms" "9000"',
          },
          activeBundle: createActiveBundle({
            bundleFormat: "self_contained_v1",
          }),
          activeBundleEntryPath:
            "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
          anomalies: [],
        })
      );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "upgrade_reconcile",
    });

    expect(result.status).toBe("aligned");
    expect(result.restoredBackground).toBe(false);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(serviceManager.deactivate).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          expect.stringMatching(DAEMON_SERVICE_LAUNCHER_PATH_PATTERN),
          "service",
          "run",
          "--mode",
          "foreground",
        ],
      })
    );
  });

  it("keeps runtime data backup for manual recovery when restore fails", async () => {
    const serviceManager = createServiceManager();
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    backupDaemonRuntimeDataForReinstallMock.mockResolvedValue({
      backupRootPath: "/tmp/openmeld-daemon-runtime-data-999",
      backupDataPath: "/tmp/openmeld-daemon-runtime-data-999/data",
      sourceDataPath: "/Users/felix/.openmeld/runtime/daemon/data",
    });
    restoreDaemonRuntimeDataForReinstallMock.mockRejectedValue(
      new Error("restore failed")
    );
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createInventory({
        runtimeStatus: createRuntimeStatus({
          status: "not_running",
        }),
        serviceManager,
        serviceManagerStatus: {
          installed: false,
          running: false,
          enabled: false,
          definitionPath: null,
          commandSummary: null,
        },
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
        legacySharedService: {
          present: true,
          pathInput: {},
          installStatus: { installed: false, state: null },
          runtimeStatus: createRuntimeStatus({ status: "not_running" }),
          serviceManager,
          serviceManagerStatus: null,
          ownedProcesses: [],
        },
      })
    );

    const result = await runDaemonServiceFullAlignment({
      expectedVersion: "0.2.0",
      intent: "startup_check",
    });

    expect(result.status).toBe("failed");
    expect(result.backupDataPath).toBe(
      "/tmp/openmeld-daemon-runtime-data-999/data"
    );
    expect(cleanupDaemonRuntimeDataBackupMock).not.toHaveBeenCalled();
    expect(cleanupStaleDaemonRuntimeDataBackupsMock).toHaveBeenCalledWith({
      retainBackupRootPaths: ["/tmp/openmeld-daemon-runtime-data-999"],
    });
  });

  it("restores the previous install, bundle, and contract snapshots after a failed background restart", async () => {
    await withTempHome(async () => {
      verifyDaemonActiveBundleIntegrityMock.mockResolvedValue(true);
      const serviceManager = createServiceManager();
      let currentRuntimeStatus = createRuntimeStatus({
        status: "not_running",
      });
      const previousInstallState = {
        v: 1 as const,
        schema: "openmeld-daemon-install-v1" as const,
        daemonVersion: "0.1.9",
        installSource: "cli.auto_check" as const,
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      };
      const previousActiveBundle = createActiveBundle({
        bundleId: "bundle-0.1.9",
        daemonVersion: "0.1.9",
        bundleFormat: "self_contained_v1",
      });
      const previousContract = await upsertDaemonServiceContract({
        daemonVersion: "0.1.9",
        bundleId: previousActiveBundle.bundleId,
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "agt_safe_rollback_profile",
        deviceId: "device-safe-rollback",
        heartbeatMs: 25_000,
        lane: "prod",
      });
      await writeJsonFile(daemonStatePath(), previousInstallState);
      await writeJsonFile(
        daemonServiceActiveBundlePath(),
        previousActiveBundle
      );

      prepareDaemonServiceBundleMock.mockImplementation(async () => {
        const nextBundle = createActiveBundle({
          bundleFormat: "self_contained_v1",
        });
        await writeJsonFile(daemonServiceActiveBundlePath(), nextBundle);
        return nextBundle;
      });
      installDaemonMock.mockImplementation(
        async ({ daemonVersion, source }) => {
          const nextInstallState = {
            ...previousInstallState,
            daemonVersion,
            installSource: source,
            updatedAt: "2026-03-07T00:05:00.000Z",
          };
          await writeJsonFile(daemonStatePath(), nextInstallState);
          return {
            status: "installed",
            state: nextInstallState,
          };
        }
      );
      serviceManager.start
        .mockRejectedValueOnce(new Error("Sign In Needed"))
        .mockImplementationOnce(() => {
          currentRuntimeStatus = createRuntimeStatus({
            status: "running",
            mode: "background",
            pid: 909,
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          });
        });
      getDaemonRuntimeStatusMock.mockImplementation(
        async () => currentRuntimeStatus
      );
      resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
      inspectDaemonServiceInventoryMock
        .mockResolvedValueOnce(
          createInventory({
            installStatus: {
              installed: true,
              state: previousInstallState,
            },
            serviceContract: previousContract,
            runtimeStatus: createRuntimeStatus({
              status: "running",
              mode: "background",
              pid: 222,
              managedBySystemService: true,
              serviceController: "launchd",
              autoStart: true,
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: true,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
            },
            activeBundle: previousActiveBundle,
            activeBundleEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandPathExists: true,
            anomalies: [
              {
                code: "version_outdated",
                message:
                  "Configured OpenMeld Service version is v0.1.9, expected v0.2.0.",
              },
            ],
          })
        )
        .mockResolvedValue(
          createInventory({
            installStatus: {
              installed: true,
              state: previousInstallState,
            },
            serviceContract: previousContract,
            runtimeStatus: createRuntimeStatus({
              status: "running",
              mode: "background",
              pid: 909,
              managedBySystemService: true,
              serviceController: "launchd",
              autoStart: true,
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: true,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground --profile agt_existing",
            },
            activeBundle: previousActiveBundle,
            activeBundleEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandPathExists: true,
            anomalies: [],
          })
        );

      const result = await runDaemonServiceFullAlignment({
        expectedVersion: "0.2.0",
        intent: "upgrade_reconcile",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("Sign In Needed");
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        daemonVersion: "0.1.9",
        bundleId: previousActiveBundle.bundleId,
        desiredState: "background",
      });
      await expect(
        readJsonFile<{ daemonVersion: string }>(daemonStatePath())
      ).resolves.toMatchObject({
        daemonVersion: "0.1.9",
      });
      await expect(
        readJsonFile<{ daemonVersion: string; bundleId: string }>(
          daemonServiceActiveBundlePath()
        )
      ).resolves.toMatchObject({
        daemonVersion: "0.1.9",
        bundleId: previousActiveBundle.bundleId,
      });
    });
  });

  it("fails verification when runtime still points at a different bundle entry", async () => {
    await withTempHome(async () => {
      const serviceManager = createServiceManager();
      const previousInstallState = {
        v: 1 as const,
        schema: "openmeld-daemon-install-v1" as const,
        daemonVersion: "0.1.9",
        installSource: "cli.auto_check" as const,
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      };
      const previousActiveBundle = createActiveBundle({
        bundleId: "bundle-0.1.9",
        daemonVersion: "0.1.9",
        bundleFormat: "self_contained_v1",
      });
      const previousContract = {
        schema: "openmeld-daemon-service-contract-v1" as const,
        v: 1 as const,
        lane: "prod" as const,
        generation: 1,
        daemonVersion: "0.1.9",
        bundleId: previousActiveBundle.bundleId,
        desiredState: "background" as const,
        serviceController: "launchd" as const,
        autoStart: true,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "agt_existing",
        deviceId: "device_123",
        heartbeatMs: 25_000,
        updatedAt: "2026-03-07T00:00:00.000Z",
      };
      let currentRuntimeStatus = createRuntimeStatus({
        status: "not_running",
      });
      serviceManager.start.mockImplementation(() => {
        currentRuntimeStatus = createRuntimeStatus({
          status: "running",
          mode: "background",
          pid: 777,
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        });
        return Promise.resolve();
      });
      getDaemonRuntimeStatusMock.mockImplementation(
        async () => currentRuntimeStatus
      );
      resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
      inspectDaemonServiceInventoryMock
        .mockResolvedValueOnce(
          createInventory({
            installStatus: {
              installed: true,
              state: previousInstallState,
            },
            serviceContract: previousContract,
            runtimeStatus: createRuntimeStatus({
              status: "running",
              mode: "background",
              pid: 222,
              managedBySystemService: true,
              serviceController: "launchd",
              autoStart: true,
            }),
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: true,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground",
            },
            activeBundle: previousActiveBundle,
            activeBundleEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/bundle-0.1.9/dist/openmeld.js",
            runtimeCommandPathExists: true,
            anomalies: [
              {
                code: "version_outdated",
                message:
                  "Configured OpenMeld Service version is v0.1.9, expected v0.2.0.",
              },
            ],
          })
        )
        .mockResolvedValue(
          createInventory({
            installStatus: {
              installed: true,
              state: {
                ...previousInstallState,
                daemonVersion: "0.2.0",
                updatedAt: "2026-03-07T00:05:00.000Z",
              },
            },
            serviceContract: {
              ...previousContract,
              daemonVersion: "0.2.0",
              bundleId: "fresh-bundle",
            },
            runtimeStatus: createRuntimeStatus({
              status: "running",
              mode: "background",
              pid: 777,
              managedBySystemService: true,
              serviceController: "launchd",
              autoStart: true,
            }),
            activeBundle: createActiveBundle({
              bundleId: "fresh-bundle",
              daemonVersion: "0.2.0",
              bundleFormat: "self_contained_v1",
            }),
            activeBundleEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
            runtimeCommandEntryPath:
              "/Users/felix/.openmeld/runtime/daemon/bundles/drifted-bundle/dist/openmeld.js",
            runtimeCommandPathExists: true,
            serviceManager,
            serviceManagerStatus: {
              installed: true,
              running: true,
              enabled: true,
              definitionPath:
                "/Users/felix/Library/LaunchAgents/com.agent.plist",
              commandSummary:
                "node daemon-service-launcher.mjs service run --mode foreground",
            },
            anomalies: [],
          })
        );

      const result = await runDaemonServiceFullAlignment({
        expectedVersion: "0.2.0",
        intent: "startup_check",
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toContain(
        "runtime is still using /Users/felix/.openmeld/runtime/daemon/bundles/drifted-bundle/dist/openmeld.js"
      );
    });
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
  const runtimeStatus =
    overrides.runtimeStatus ??
    createRuntimeStatus({
      status: "not_running",
    });
  const hasServiceContractOverride = Object.hasOwn(
    overrides,
    "serviceContract"
  );
  const activeBundle =
    overrides.activeBundle ??
    createActiveBundle({
      bundleFormat: "self_contained_v1",
    });
  const serviceManager =
    overrides.serviceManager ??
    (runtimeStatus.serviceController === "unknown"
      ? null
      : createServiceManager({
          controller:
            runtimeStatus.serviceController === "windows-service"
              ? "windows-service"
              : "launchd",
        }));
  const desiredState =
    overrides.serviceContract?.desiredState ??
    (runtimeStatus.mode === "background" ||
    overrides.serviceManagerStatus?.running === true
      ? "background"
      : "stopped");
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
    runtimeStatus,
    ...(hasServiceContractOverride
      ? {
          serviceContract: overrides.serviceContract ?? undefined,
        }
      : {
          serviceContract: {
            schema: "openmeld-daemon-service-contract-v1",
            v: 1,
            lane: "prod",
            daemonVersion: activeBundle.daemonVersion,
            bundleId: activeBundle.bundleId,
            desiredState,
            serviceController:
              runtimeStatus.serviceController === "unknown"
                ? (serviceManager?.controller ?? "launchd")
                : runtimeStatus.serviceController,
            autoStart: desiredState === "background",
            gatewayUrl: "https://gateway.openmeld.invalid",
            profileId: "agt_existing",
            deviceId: "device_123",
            heartbeatMs: 25_000,
            generation: 1,
            updatedAt: "2026-03-07T00:00:00.000Z",
          } as const,
        }),
    legacySharedService: null,
    activeBundle,
    activeBundleSourceAvailable: true,
    activeBundleEntryPath:
      "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/Users/felix/.openmeld/runtime/daemon/bundles/fresh-bundle/dist/openmeld.js",
    runtimeCommandPathExists: true,
    serviceManager,
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

function createActiveBundle(input: {
  bundleFormat: "legacy_linked_v1" | "self_contained_v1";
  bundleId?: string;
  daemonVersion?: string;
}): DaemonActiveBundleState {
  return {
    v: 2,
    schema: "openmeld-daemon-active-bundle-v2",
    bundleId: input.bundleId ?? "bundle-1",
    daemonVersion: input.daemonVersion ?? "0.2.0",
    entryScriptRelativePath: "dist/openmeld.js",
    bundleFormat: input.bundleFormat,
    sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
    sourcePackageRootPath: "/tmp/current-cli",
    sourceDistRootPath: "/tmp/current-cli/dist",
    sourceKind: "package_install" as const,
    createdAt: "2026-03-07T00:00:00.000Z",
    updatedAt: "2026-03-07T00:00:00.000Z",
  };
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function createServiceManager(
  input: { controller?: "launchd" | "windows-service" } = {}
) {
  return {
    controller: (input.controller ?? "launchd") as
      | "launchd"
      | "windows-service",
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    enableAutostart: vi.fn().mockResolvedValue(undefined),
    disableAutostart: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    deactivate: vi.fn().mockResolvedValue(undefined),
    waitUntilAbsent: vi.fn().mockResolvedValue(undefined),
    waitUntilStopped: vi.fn().mockResolvedValue(undefined),
    waitUntilRunning: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({
      installed: true,
      running: false,
      enabled: true,
      definitionPath: "/Users/felix/Library/LaunchAgents/com.agent.plist",
      commandSummary: "node daemon-service-launcher.mjs service run",
    }),
  };
}
