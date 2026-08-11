import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDaemonServiceAutoHeal } from "../src/local-service/lifecycle/daemon-service-auto-heal";

const {
  clearDaemonServiceRuntimeStateMock,
  cleanupInactiveDaemonServiceBundlesMock,
  inspectDaemonServiceInventoryMock,
  installDaemonMock,
  prepareDaemonServiceBundleMock,
  getDaemonServiceRepairBudgetStateMock,
  recordDaemonServiceRepairFailureMock,
  recordDaemonServiceRepairSuccessMock,
  withDaemonServiceRegistrationMutationLockMock,
} = vi.hoisted(() => ({
  clearDaemonServiceRuntimeStateMock: vi.fn(),
  cleanupInactiveDaemonServiceBundlesMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  installDaemonMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  getDaemonServiceRepairBudgetStateMock: vi.fn(),
  recordDaemonServiceRepairFailureMock: vi.fn(),
  recordDaemonServiceRepairSuccessMock: vi.fn(),
  withDaemonServiceRegistrationMutationLockMock: vi.fn(
    async (callback: () => Promise<unknown>) => await callback()
  ),
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    clearDaemonServiceRuntimeState: clearDaemonServiceRuntimeStateMock,
    installDaemon: installDaemonMock,
    withDaemonServiceRegistrationMutationLock:
      withDaemonServiceRegistrationMutationLockMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  cleanupInactiveDaemonServiceBundles: cleanupInactiveDaemonServiceBundlesMock,
  prepareDaemonServiceBundle: prepareDaemonServiceBundleMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-repair-journal", () => ({
  buildDaemonServiceRepairActionKey: vi.fn(),
  getDaemonServiceRepairBudgetState: getDaemonServiceRepairBudgetStateMock,
  recordDaemonServiceRepairFailure: recordDaemonServiceRepairFailureMock,
  recordDaemonServiceRepairSuccess: recordDaemonServiceRepairSuccessMock,
}));

describe("local service auto heal", () => {
  let processKillSpy: { mockRestore: () => void } | null = null;
  const aliveProcessIds = new Set<number>();

  beforeEach(() => {
    inspectDaemonServiceInventoryMock.mockReset();
    clearDaemonServiceRuntimeStateMock.mockReset().mockResolvedValue(undefined);
    cleanupInactiveDaemonServiceBundlesMock
      .mockReset()
      .mockResolvedValue(undefined);
    installDaemonMock.mockReset().mockResolvedValue({
      status: "already_installed",
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: "0.1.9",
        installSource: "cli.auto_check",
        installedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
      },
    });
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue(undefined);
    getDaemonServiceRepairBudgetStateMock.mockReset().mockResolvedValue({
      actionKey: "stop_owned_processes",
      consecutiveFailures: 0,
      cooldownUntil: null,
      lastErrorMessage: null,
      status: "ready",
    });
    recordDaemonServiceRepairFailureMock
      .mockReset()
      .mockResolvedValue(undefined);
    recordDaemonServiceRepairSuccessMock
      .mockReset()
      .mockResolvedValue(undefined);
    aliveProcessIds.clear();
    aliveProcessIds.add(200);
    aliveProcessIds.add(333);
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

  afterEach(() => {
    processKillSpy?.mockRestore();
    processKillSpy = null;
    vi.restoreAllMocks();
  });

  it("removes only legacy detached duplicates when a managed background runtime is healthy", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce({
        expectedVersion: "0.1.9",
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.9",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 200,
          startedAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
        activeBundle: null,
        activeBundleSourceAvailable: null,
        activeBundleEntryPath: null,
        serviceManager: null,
        serviceManagerStatus: null,
        ownedProcesses: [
          {
            pid: 200,
            parentPid: 1,
            command: "node openmeld.js service run --mode background",
            mode: "background",
            ownership: "cli_direct",
          },
          {
            pid: 333,
            parentPid: 1,
            command: "node legacy-detached-service.js",
            mode: null,
            ownership: "legacy_detached",
          },
        ],
        lifecycleLock: null,
        anomalies: [
          {
            code: "duplicate_owned_processes",
            message:
              "Found multiple OpenMeld-owned service processes on this device.",
          },
        ],
      })
      .mockResolvedValueOnce({
        expectedVersion: "0.1.9",
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.9",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 200,
          startedAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
        activeBundle: null,
        activeBundleSourceAvailable: null,
        activeBundleEntryPath: null,
        serviceManager: null,
        serviceManagerStatus: null,
        ownedProcesses: [
          {
            pid: 200,
            parentPid: 1,
            command: "node openmeld.js service run --mode background",
            mode: "background",
            ownership: "cli_direct",
          },
        ],
        lifecycleLock: null,
        anomalies: [],
      });

    const report = await runDaemonServiceAutoHeal({
      expectedVersion: "0.1.9",
      intent: "status_cleanup",
      requestedMode: "background",
    });

    expect(report.status).toBe("repaired");
    expect(report.appliedActions).toContain("stop_owned_processes");
    expect(process.kill).toHaveBeenCalledWith(333, "SIGTERM");
    expect(process.kill).not.toHaveBeenCalledWith(200, "SIGTERM");
    expect(recordDaemonServiceRepairSuccessMock).toHaveBeenCalledTimes(1);
    expect(recordDaemonServiceRepairFailureMock).not.toHaveBeenCalled();
  });

  it("does not stop owned processes when duplicates include non-legacy extras", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue({
      expectedVersion: "0.1.9",
      installStatus: {
        installed: true,
        state: {
          v: 1,
          schema: "openmeld-daemon-install-v1",
          daemonVersion: "0.1.9",
          installSource: "daemon.command.install",
          installedAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
      },
      runtimeStatus: {
        status: "running",
        mode: "background",
        pid: 200,
        startedAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-07T00:00:00.000Z",
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      },
      activeBundle: null,
      activeBundleSourceAvailable: null,
      activeBundleEntryPath: null,
      serviceManager: null,
      serviceManagerStatus: null,
      ownedProcesses: [
        {
          pid: 200,
          parentPid: 1,
          command: "node openmeld.js service run --mode background",
          mode: "background",
          ownership: "cli_direct",
        },
        {
          pid: 333,
          parentPid: 1,
          command: "node legacy-detached-service.js",
          mode: null,
          ownership: "legacy_detached",
        },
        {
          pid: 444,
          parentPid: 1,
          command: "node openmeld.js service run --mode foreground",
          mode: "foreground",
          ownership: "cli_direct",
        },
      ],
      lifecycleLock: null,
      anomalies: [
        {
          code: "duplicate_owned_processes",
          message:
            "Found multiple OpenMeld-owned service processes on this device.",
        },
      ],
    });

    const report = await runDaemonServiceAutoHeal({
      expectedVersion: "0.1.9",
      intent: "status_cleanup",
      requestedMode: "background",
    });

    expect(report.status).toBe("blocked");
    expect(report.appliedActions).toEqual([]);
    expect(report.blockedAnomalyCodes).toEqual(["duplicate_owned_processes"]);
    expect(process.kill).not.toHaveBeenCalledWith(333, "SIGTERM");
    expect(recordDaemonServiceRepairSuccessMock).not.toHaveBeenCalled();
    expect(recordDaemonServiceRepairFailureMock).not.toHaveBeenCalled();
  });

  it("leaves same-version legacy bundles for full alignment instead of auto-heal", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce({
        expectedVersion: "0.1.9",
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.9",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "legacy-bundle",
          daemonVersion: "0.1.9",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "legacy_linked_v1",
          sourceEntryScriptPath: "/tmp/legacy-cli/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/legacy-cli",
          sourceDistRootPath: "/tmp/legacy-cli/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
        activeBundleSourceAvailable: true,
        activeBundleEntryPath: null,
        runtimeCommandEntryPath: null,
        runtimeCommandPathExists: null,
        serviceManager: null,
        serviceManagerStatus: null,
        ownedProcesses: [],
        lifecycleLock: null,
        anomalies: [
          {
            code: "bundle_strategy_legacy",
            message:
              "The active OpenMeld Service bundle still uses the legacy linked dependency layout.",
          },
          {
            code: "bundle_path_invalid",
            message:
              "The active OpenMeld Service bundle entry file is missing.",
          },
        ],
      })
      .mockResolvedValueOnce({
        expectedVersion: "0.1.9",
        installStatus: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.9",
            installSource: "daemon.command.install",
            installedAt: "2026-03-07T00:00:00.000Z",
            updatedAt: "2026-03-07T00:00:00.000Z",
          },
        },
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "self-contained-bundle",
          daemonVersion: "0.1.9",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "self_contained_v1",
          sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/current-cli",
          sourceDistRootPath: "/tmp/current-cli/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:05:00.000Z",
          updatedAt: "2026-03-07T00:05:00.000Z",
        },
        activeBundleSourceAvailable: null,
        activeBundleEntryPath:
          "/tmp/.openmeld/runtime/daemon/bundles/self-contained-bundle/dist/openmeld.js",
        runtimeCommandEntryPath: null,
        runtimeCommandPathExists: null,
        serviceManager: null,
        serviceManagerStatus: null,
        ownedProcesses: [],
        lifecycleLock: null,
        anomalies: [],
      });

    const report = await runDaemonServiceAutoHeal({
      expectedVersion: "0.1.9",
      intent: "status_cleanup",
      cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
    });

    expect(report.status).toBe("noop");
    expect(report.appliedActions).toEqual([]);
    expect(prepareDaemonServiceBundleMock).not.toHaveBeenCalled();
    expect(installDaemonMock).not.toHaveBeenCalled();
    expect(cleanupInactiveDaemonServiceBundlesMock).not.toHaveBeenCalled();
  });

  it("leaves bundle version drift for full alignment instead of auto-heal", async () => {
    inspectDaemonServiceInventoryMock
      .mockResolvedValueOnce({
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
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "workspace-bundle",
          daemonVersion: "1.0.0",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "self_contained_v1",
          sourceEntryScriptPath: "/tmp/workspace-cli/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/workspace-cli",
          sourceDistRootPath: "/tmp/workspace-cli/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:00:00.000Z",
          updatedAt: "2026-03-07T00:00:00.000Z",
        },
        activeBundleSourceAvailable: true,
        activeBundleEntryPath:
          "/tmp/.openmeld/runtime/daemon/bundles/workspace-bundle/dist/openmeld.js",
        runtimeCommandEntryPath: null,
        runtimeCommandPathExists: null,
        serviceManager: null,
        serviceManagerStatus: null,
        ownedProcesses: [],
        lifecycleLock: null,
        anomalies: [
          {
            code: "bundle_version_drift",
            message:
              "The active OpenMeld Service bundle version is v1.0.0, but the installed service expects v0.2.0.",
          },
        ],
      })
      .mockResolvedValueOnce({
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
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
        activeBundle: {
          v: 2,
          schema: "openmeld-daemon-active-bundle-v2",
          bundleId: "service-bundle",
          daemonVersion: "0.2.0",
          entryScriptRelativePath: "dist/openmeld.js",
          bundleFormat: "self_contained_v1",
          sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
          sourcePackageRootPath: "/tmp/current-cli",
          sourceDistRootPath: "/tmp/current-cli/dist",
          sourceKind: "workspace",
          createdAt: "2026-03-07T00:05:00.000Z",
          updatedAt: "2026-03-07T00:05:00.000Z",
        },
        activeBundleSourceAvailable: null,
        activeBundleEntryPath:
          "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
        runtimeCommandEntryPath: null,
        runtimeCommandPathExists: null,
        serviceManager: null,
        serviceManagerStatus: null,
        ownedProcesses: [],
        lifecycleLock: null,
        anomalies: [],
      });

    const report = await runDaemonServiceAutoHeal({
      expectedVersion: "0.2.0",
      intent: "status_cleanup",
      cliScriptPath: "/tmp/current-cli/dist/openmeld.js",
    });

    expect(report.status).toBe("noop");
    expect(report.appliedActions).toEqual([]);
    expect(prepareDaemonServiceBundleMock).not.toHaveBeenCalled();
    expect(installDaemonMock).not.toHaveBeenCalled();
  });
});
