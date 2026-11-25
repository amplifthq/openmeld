import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DaemonServiceContract } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonInstallState } from "../src/config/daemon-state";
import { LocalDaemonControlPlaneClientError } from "../src/local-service/control-plane/client";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import {
  DaemonServiceUpdateDeferredError,
  runDaemonServiceLifecycle,
} from "../src/local-service/lifecycle/daemon-service-lifecycle";
import type { DaemonServiceManager } from "../src/local-service/lifecycle/daemon-service-manager";

const EXPECTED_VERSION = "0.3.6";
const PREVIOUS_VERSION = "0.3.3";

// OS registration is covered by the isolated native smoke; this suite exercises
// lifecycle drain, preservation, and rollback with an injected service manager.
vi.mock(
  "../src/local-service/lifecycle/daemon-service-update-worker-manager",
  () => ({
    ensureDaemonServiceMaintenanceInstalled: vi
      .fn()
      .mockResolvedValue(undefined),
  })
);

const {
  activateDaemonServiceBundleMock,
  backupDaemonRuntimeDataForReinstallMock,
  captureDaemonServiceEvidenceBestEffortMock,
  forceKillStalledDaemonAfterStopTimeoutMock,
  cleanupDaemonRuntimeDataBackupMock,
  cleanupLegacySharedDaemonServiceStateMock,
  cleanupStaleDaemonRuntimeDataBackupsMock,
  clearDaemonRuntimeStateIfDefinitelyStoppedMock,
  ensureDaemonRuntimePathsMock,
  ensureDaemonSystemServiceCommandFilesMock,
  inspectDaemonServiceInventoryMock,
  installDaemonMock,
  listDaemonOwnedProcessesMock,
  discardPreparedDaemonServiceBundleMock,
  prepareDaemonServiceBundleMock,
  requestLocalDaemonShutdownMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  readDaemonServiceContractMock,
  readDaemonServiceRuntimeSnapshotMock,
  readVersionStateMock,
  emitDaemonLifecycleEventMock,
  resolveOpenMeldProfileOrNullMock,
  resolveDaemonDeviceIdMock,
  restoreDaemonActiveBundleStateSnapshotMock,
  restoreDaemonInstallStateSnapshotMock,
  restoreDaemonRuntimeDataForReinstallMock,
  verifyDaemonActiveBundleIntegrityMock,
  upsertDaemonServiceContractMock,
  waitForDaemonSystemServiceToStopMock,
} = vi.hoisted(() => ({
  activateDaemonServiceBundleMock: vi.fn(),
  backupDaemonRuntimeDataForReinstallMock: vi.fn(),
  captureDaemonServiceEvidenceBestEffortMock: vi.fn(),
  forceKillStalledDaemonAfterStopTimeoutMock: vi.fn(),
  cleanupDaemonRuntimeDataBackupMock: vi.fn(),
  cleanupLegacySharedDaemonServiceStateMock: vi.fn(),
  cleanupStaleDaemonRuntimeDataBackupsMock: vi.fn(),
  clearDaemonRuntimeStateIfDefinitelyStoppedMock: vi.fn(),
  ensureDaemonRuntimePathsMock: vi.fn(),
  ensureDaemonSystemServiceCommandFilesMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  installDaemonMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  discardPreparedDaemonServiceBundleMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  requestLocalDaemonShutdownMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  readDaemonServiceRuntimeSnapshotMock: vi.fn(),
  readVersionStateMock: vi.fn(),
  emitDaemonLifecycleEventMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveDaemonDeviceIdMock: vi.fn(),
  restoreDaemonActiveBundleStateSnapshotMock: vi.fn(),
  restoreDaemonInstallStateSnapshotMock: vi.fn(),
  restoreDaemonRuntimeDataForReinstallMock: vi.fn(),
  verifyDaemonActiveBundleIntegrityMock: vi.fn(),
  upsertDaemonServiceContractMock: vi.fn(),
  waitForDaemonSystemServiceToStopMock: vi.fn(),
}));

vi.mock("../src/config/daemon-service-contract", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-service-contract")
  >("../src/config/daemon-service-contract");
  return {
    ...actual,
    clearDaemonServiceContract: vi.fn(),
    readDaemonServiceContract: readDaemonServiceContractMock,
    upsertDaemonServiceContract: upsertDaemonServiceContractMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-lifecycle-journal", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-lifecycle-journal")
  >("../src/local-service/lifecycle/daemon-lifecycle-journal");
  return {
    ...actual,
    emitDaemonLifecycleEvent: emitDaemonLifecycleEventMock,
  };
});

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    installDaemon: installDaemonMock,
    readDaemonServiceRuntimeSnapshot: readDaemonServiceRuntimeSnapshotMock,
    restoreDaemonInstallStateSnapshot: restoreDaemonInstallStateSnapshotMock,
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/config/version-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/version-state")
  >("../src/config/version-state");
  return {
    ...actual,
    readVersionState: readVersionStateMock,
  };
});

vi.mock("../src/local-service/state/daemon-device-id", () => ({
  ensureDaemonRuntimePaths: ensureDaemonRuntimePathsMock,
  resolveDaemonDeviceId: resolveDaemonDeviceIdMock,
  resolvePreferredDaemonDeviceId: vi.fn(
    (input: { explicitDeviceId?: string; contractDeviceId?: string | null }) =>
      input.explicitDeviceId?.trim() || input.contractDeviceId || undefined
  ),
}));

vi.mock("../src/local-service/state/runtime-data-preservation", () => ({
  backupDaemonRuntimeDataForReinstall: backupDaemonRuntimeDataForReinstallMock,
  cleanupDaemonRuntimeDataBackup: cleanupDaemonRuntimeDataBackupMock,
  cleanupStaleDaemonRuntimeDataBackups:
    cleanupStaleDaemonRuntimeDataBackupsMock,
  restoreDaemonRuntimeDataForReinstall:
    restoreDaemonRuntimeDataForReinstallMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-bundle")
  >("../src/local-service/lifecycle/daemon-service-bundle");
  return {
    ...actual,
    activateDaemonServiceBundle: activateDaemonServiceBundleMock,
    discardPreparedDaemonServiceBundle: discardPreparedDaemonServiceBundleMock,
    prepareDaemonServiceBundle: prepareDaemonServiceBundleMock,
    restoreDaemonActiveBundleStateSnapshot:
      restoreDaemonActiveBundleStateSnapshotMock,
    verifyDaemonActiveBundleIntegrity: verifyDaemonActiveBundleIntegrityMock,
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-command-spec",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-command-spec")
    >("../src/local-service/lifecycle/daemon-service-command-spec");
    return {
      ...actual,
      ensureDaemonSystemServiceCommandFiles:
        ensureDaemonSystemServiceCommandFilesMock,
    };
  }
);

vi.mock("../src/local-service/control-plane/client", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/control-plane/client")
  >("../src/local-service/control-plane/client");
  return {
    ...actual,
    requestLocalDaemonShutdown: requestLocalDaemonShutdownMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-evidence", () => ({
  captureDaemonServiceEvidenceBestEffort:
    captureDaemonServiceEvidenceBestEffortMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-legacy-shared", () => ({
  cleanupLegacySharedDaemonServiceState:
    cleanupLegacySharedDaemonServiceStateMock,
}));

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  () => ({
    listDaemonOwnedProcesses: listDaemonOwnedProcessesMock,
  })
);

vi.mock(
  "../src/local-service/lifecycle/daemon-service-stalled-force-kill",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-stalled-force-kill")
    >("../src/local-service/lifecycle/daemon-service-stalled-force-kill");
    return {
      ...actual,
      forceKillStalledDaemonAfterStopTimeout:
        forceKillStalledDaemonAfterStopTimeoutMock,
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
    readCurrentObservedDaemonRuntimeStatus:
      readCurrentObservedDaemonRuntimeStatusMock,
    waitForDaemonSystemServiceToStop: waitForDaemonSystemServiceToStopMock,
  };
});

describe("local service lifecycle", () => {
  let testHome: string;
  let runtimeSettled = false;
  let serviceManager: DaemonServiceManager;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "openmeld-lifecycle-"));
    vi.stubEnv("OPENMELD_HOME", testHome);
    activateDaemonServiceBundleMock.mockReset().mockResolvedValue(undefined);
    discardPreparedDaemonServiceBundleMock
      .mockReset()
      .mockResolvedValue(undefined);
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");
    runtimeSettled = false;

    serviceManager = {
      controller: "launchd",
      install: vi.fn().mockResolvedValue(undefined),
      uninstall: vi.fn().mockResolvedValue(undefined),
      enableAutostart: vi.fn().mockResolvedValue(undefined),
      disableAutostart: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({
        installed: true,
        running: false,
        enabled: true,
        definitionPath: "/tmp/com.openmeld.dev-local.plist",
        commandSummary: "launchctl bootstrap",
      }),
      waitUntilAbsent: vi.fn().mockResolvedValue(undefined),
      waitUntilStopped: vi.fn().mockResolvedValue(undefined),
      waitUntilRunning: vi.fn().mockResolvedValue(undefined),
    };

    backupDaemonRuntimeDataForReinstallMock.mockReset().mockResolvedValue(null);
    captureDaemonServiceEvidenceBestEffortMock
      .mockReset()
      .mockResolvedValue(null);
    cleanupDaemonRuntimeDataBackupMock.mockReset().mockResolvedValue(undefined);
    cleanupLegacySharedDaemonServiceStateMock
      .mockReset()
      .mockResolvedValue(undefined);
    cleanupStaleDaemonRuntimeDataBackupsMock
      .mockReset()
      .mockResolvedValue(undefined);
    clearDaemonRuntimeStateIfDefinitelyStoppedMock
      .mockReset()
      .mockResolvedValue({
        cleared: true,
        context: {
          status: {
            installed: true,
            state: buildInstallState(),
          },
          runtimeStatus: buildRuntimeStatus("stale"),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath: "/tmp/com.openmeld.dev-local.plist",
            commandSummary: "launchctl bootstrap",
          },
          legacySharedService: null,
          effectiveRuntimeStatus: "not_running",
        },
      });
    ensureDaemonRuntimePathsMock.mockReset().mockResolvedValue(null);
    installDaemonMock.mockReset().mockResolvedValue({
      status: "already_installed",
      state: buildInstallState(),
    });
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue({
      bundleId: "bundle-new",
    });
    requestLocalDaemonShutdownMock.mockReset().mockResolvedValue({
      accepted: false,
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    readDaemonServiceContractMock.mockReset().mockResolvedValue(null);
    readDaemonServiceRuntimeSnapshotMock.mockReset().mockResolvedValue(null);
    readVersionStateMock.mockReset().mockResolvedValue(null);
    emitDaemonLifecycleEventMock.mockReset().mockResolvedValue(undefined);
    resolveOpenMeldProfileOrNullMock.mockReset().mockResolvedValue(null);
    resolveDaemonDeviceIdMock.mockReset().mockResolvedValue("device-123");
    restoreDaemonActiveBundleStateSnapshotMock
      .mockReset()
      .mockResolvedValue(undefined);
    restoreDaemonInstallStateSnapshotMock
      .mockReset()
      .mockResolvedValue(undefined);
    restoreDaemonRuntimeDataForReinstallMock
      .mockReset()
      .mockResolvedValue(undefined);
    verifyDaemonActiveBundleIntegrityMock.mockReset().mockResolvedValue(true);
    upsertDaemonServiceContractMock
      .mockReset()
      .mockImplementation(async (input) =>
        buildServiceContract({
          bundleId: String(input.bundleId),
          desiredState:
            input.desiredState === "background" ? "background" : "stopped",
        })
      );
    forceKillStalledDaemonAfterStopTimeoutMock.mockReset().mockResolvedValue({
      killed: false,
      verdict: {
        decision: "skip",
        reason: "heartbeat_fresh",
        pid: 18_129,
        heartbeatStalledMs: 5000,
      },
    });
    waitForDaemonSystemServiceToStopMock.mockReset().mockImplementation(() => {
      runtimeSettled = true;
      return Promise.resolve(true);
    });
    readCurrentObservedDaemonRuntimeStatusMock
      .mockReset()
      .mockImplementation(async () =>
        runtimeSettled
          ? buildRuntimeStatus("stale")
          : buildRuntimeStatus("running")
      );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(buildInitialInventory(serviceManager))
      .mockResolvedValue(buildFinalInventory(serviceManager));
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("waits for the system service runtime to settle before checking wait_stopped", async () => {
    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(waitForDaemonSystemServiceToStopMock).toHaveBeenCalledWith({
      manager: serviceManager,
      pollMs: 200,
      waitMs: 15_000,
    });
    expect(clearDaemonRuntimeStateIfDefinitelyStoppedMock).toHaveBeenCalled();
    expect(backupDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(forceKillStalledDaemonAfterStopTimeoutMock).not.toHaveBeenCalled();
  });

  it("replaces the Service without copying or restoring its retained workspaces", async () => {
    backupDaemonRuntimeDataForReinstallMock.mockRejectedValue(
      new Error("EACCES: unreadable task workspace")
    );
    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "cli.auto_check",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });
    expect(result.status).toBe("aligned");
    expect(backupDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
    expect(restoreDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: true, start: false, restoreFailure: false },
    { enabled: true, start: true, restoreFailure: false },
    { enabled: false, start: true, restoreFailure: false },
    { enabled: false, start: false, restoreFailure: false },
    { enabled: true, start: true, restoreFailure: true },
  ])("retains the original installation when legacy backup fails ($enabled / $start / $restoreFailure)", async ({
    enabled,
    start,
    restoreFailure,
  }) => {
    backupDaemonRuntimeDataForReinstallMock.mockRejectedValue(
      new Error("EACCES: unreadable legacy workspace")
    );
    const inventory = buildInitialInventory(serviceManager, {
      legacySharedServicePresent: true,
    });
    if (inventory.serviceManagerStatus) {
      inventory.serviceManagerStatus.enabled = enabled;
    }
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue(inventory);
    if (restoreFailure) {
      vi.mocked(serviceManager.enableAutostart).mockRejectedValue(
        new Error("autostart recovery failed")
      );
      vi.mocked(serviceManager.start).mockRejectedValue(
        new Error("Service restart failed")
      );
    }
    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "cli.auto_check",
      desiredState: start ? "background" : "stopped",
      shouldStartAfterLifecycle: start,
      forceReinstall: true,
    });
    expect(result).toMatchObject({ status: "failed", failureStage: "backup" });
    expect(serviceManager.uninstall).not.toHaveBeenCalled();
    expect(cleanupLegacySharedDaemonServiceStateMock).not.toHaveBeenCalled();
    expect(installDaemonMock).not.toHaveBeenCalled();
    expect(activateDaemonServiceBundleMock).not.toHaveBeenCalled();
    expect(serviceManager.enableAutostart).toHaveBeenCalledTimes(
      enabled ? 1 : 0
    );
    expect(serviceManager.start).toHaveBeenCalledTimes(start ? 1 : 0);
    if (restoreFailure) {
      expect(result.errorMessage).toContain(
        "EACCES: unreadable legacy workspace"
      );
      expect(result.errorMessage).toContain("autostart recovery failed");
      expect(result.errorMessage).toContain("Service restart failed");
    }
  });

  it("accepts a verified stopped replacement while the retired runtime snapshot is stale", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const staleRetiredRuntimeInventory = {
        ...buildFinalInventory(serviceManager),
        runtimeCommandEntryPath: "/tmp/bundles/bundle-old/dist/openmeld-dev.js",
        runtimeCommandPathExists: true,
        anomalies: [
          {
            code: "runtime_stale" as const,
            message: "Runtime state is stale (runtime_lease_missing).",
          },
          {
            code: "runtime_bundle_mismatch" as const,
            message: "The retired runtime snapshot still points at bundle-old.",
          },
        ],
      } satisfies DaemonServiceInventory;
      inspectDaemonServiceInventoryMock
        .mockReset()
        .mockResolvedValueOnce(buildInitialInventory(serviceManager))
        .mockResolvedValue(staleRetiredRuntimeInventory);

      const resultPromise = runDaemonServiceLifecycle({
        expectedVersion: EXPECTED_VERSION,
        operation: "reinstall",
        installSource: "daemon.command.install",
        desiredState: "stopped",
        shouldStartAfterLifecycle: false,
        forceReinstall: true,
      });
      const result = await settleLifecyclePromiseWithFakeTimers(resultPromise);

      expect(result.status).toBe("aligned");
      expect(serviceManager.start).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("repairs a registered system service that is already stopped without contacting its missing control socket", async () => {
    const stoppedInventory = buildInitialInventory(serviceManager);
    stoppedInventory.runtimeStatus = buildRuntimeStatus("stale");
    if (stoppedInventory.serviceManagerStatus) {
      stoppedInventory.serviceManagerStatus.running = false;
    }
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(stoppedInventory)
      .mockResolvedValue(buildFinalInventory(serviceManager));
    requestLocalDaemonShutdownMock.mockRejectedValue(
      Object.assign(new Error("connect ENOENT local-service.sock"), {
        code: "ENOENT",
      })
    );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "startup_repair",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(requestLocalDaemonShutdownMock).not.toHaveBeenCalled();
    expect(serviceManager.stop).toHaveBeenCalledTimes(1);
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
  });

  it("repairs a candidate Service when its launchd definition disappeared", async () => {
    const missingDefinitionInventory = buildInitialInventory(serviceManager);
    missingDefinitionInventory.serviceManagerStatus = {
      installed: false,
      running: false,
      enabled: false,
      definitionPath: null,
      commandSummary: null,
    };
    serviceManager.disableAutostart = vi
      .fn()
      .mockRejectedValue(
        new Error("OpenMeld Service is not installed for launchd.")
      );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(missingDefinitionInventory)
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "startup_repair",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(serviceManager.disableAutostart).not.toHaveBeenCalled();
    expect(serviceManager.stop).toHaveBeenCalledTimes(1);
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
  });

  it("drains active local work before asking the system service manager to stop an upgrade", async () => {
    let drainCompleted = false;
    requestLocalDaemonShutdownMock.mockImplementation(() => {
      drainCompleted = true;
      runtimeSettled = true;
      return Promise.resolve({
        accepted: true,
        gracePeriodMs: 2000,
        mode: "graceful",
      });
    });
    const stopMock = vi.fn().mockImplementation(() => {
      expect(drainCompleted).toBe(true);
      return Promise.resolve();
    });
    serviceManager.stop = stopMock;

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(serviceManager.disableAutostart).toHaveBeenCalledTimes(1);
    expect(requestLocalDaemonShutdownMock).toHaveBeenCalledWith({
      payload: {
        gracePeriodMs: 2000,
        mode: "graceful",
      },
      timeoutMs: 15_000,
    });
    expect(
      prepareDaemonServiceBundleMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      requestLocalDaemonShutdownMock.mock.invocationCallOrder[0] as number
    );
    expect(
      requestLocalDaemonShutdownMock.mock.invocationCallOrder[0]
    ).toBeLessThan(stopMock.mock.invocationCallOrder[0] as number);
    expect(
      vi.mocked(serviceManager.uninstall).mock.invocationCallOrder[0]
    ).toBeLessThan(
      activateDaemonServiceBundleMock.mock.invocationCallOrder[0] as number
    );
  });

  it.each([
    {
      targetOwner: "owner-a",
      legacy: false,
      expectedCause: "controlled_service_update",
    },
    {
      targetOwner: "owner-a",
      legacy: true,
      expectedCause: "controlled_service_update",
    },
    { targetOwner: "owner-b", legacy: false, expectedCause: "user_stop" },
    { targetOwner: "owner-b", legacy: true, expectedCause: "user_stop" },
  ])("carries $expectedCause into the real stop journal for $targetOwner (legacy=$legacy)", async ({
    targetOwner,
    legacy,
    expectedCause,
  }) => {
    const journal = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-lifecycle-journal")
    >("../src/local-service/lifecycle/daemon-lifecycle-journal");
    emitDaemonLifecycleEventMock.mockImplementation(
      journal.emitDaemonLifecycleEvent
    );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          serviceContract: {
            ...buildServiceContract({
              bundleId: "bundle-old",
              desiredState: "background",
            }),
            ownerUserId: "owner-a",
          },
        })
      )
      .mockResolvedValue(buildFinalInventory(serviceManager));
    resolveOpenMeldProfileOrNullMock.mockResolvedValue({
      openMeldProfileId: "target-profile",
      ownerUserId: targetOwner,
    });
    requestLocalDaemonShutdownMock.mockImplementation(async () => {
      expect(await journal.resolveRecentDaemonSignalStopCause()).toBe(
        expectedCause
      );
      if (legacy) {
        throw new LocalDaemonControlPlaneClientError(
          "daemon.control.contract_mismatch",
          "Legacy service"
        );
      }
      runtimeSettled = true;
      return { accepted: true, gracePeriodMs: 2000, mode: "graceful" };
    });
    serviceManager.stop = vi.fn(async () => {
      // The fallback SIGTERM reader must see the same cause after the control request.
      expect(await journal.resolveRecentDaemonSignalStopCause()).toBe(
        expectedCause
      );
    });
    const result = await runDaemonServiceLifecycle({
      profile: "target-profile",
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });
    expect(result.status).toBe("aligned");
    expect(requestLocalDaemonShutdownMock).toHaveBeenCalledOnce();
    expect(serviceManager.stop).toHaveBeenCalledOnce();
  });

  it("aborts an upgrade without stopping the service when controlled drain has a transient failure", async () => {
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.control.auth_token_missing",
        "daemon control token is missing"
      )
    );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result).toMatchObject({
      errorMessage:
        "controlled service drain failed: daemon control token is missing",
      failureStage: "stop_or_drain",
      recoveryStatus: "failed_before_safe_state",
      status: "failed",
    });
    expect(serviceManager.disableAutostart).toHaveBeenCalledOnce();
    expect(serviceManager.enableAutostart).toHaveBeenCalledOnce();
    expect(serviceManager.stop).not.toHaveBeenCalled();
    expect(serviceManager.uninstall).not.toHaveBeenCalled();
    expect(serviceManager.install).not.toHaveBeenCalled();
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          compatibilityFallback: false,
          errorMessage: "daemon control token is missing",
        }),
        result: "failed",
        type: "stop.controlled_drain",
      })
    );
  });

  it("preserves the control-plane error code when safe drain cannot start", async () => {
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.control.endpoint_missing",
        "daemon control endpoint is missing"
      )
    );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result).toMatchObject({
      errorCode: "daemon.control.endpoint_missing",
      failureStage: "stop_or_drain",
      recoveryStatus: "failed_before_safe_state",
      status: "failed",
    });
    expect(serviceManager.stop).not.toHaveBeenCalled();
  });

  it("repairs a crash-looping system service when no runtime or owned process is active", async () => {
    const crashLoopInventory = buildInitialInventory(serviceManager);
    crashLoopInventory.runtimeStatus = buildRuntimeStatus("stale");
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(crashLoopInventory)
      .mockResolvedValue(buildFinalInventory(serviceManager));
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.control.endpoint_missing",
        "daemon control endpoint is missing"
      )
    );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "startup_repair",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(requestLocalDaemonShutdownMock).toHaveBeenCalledTimes(1);
    expect(serviceManager.stop).toHaveBeenCalledTimes(1);
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          compatibilityFallback: true,
          compatibilityReason: "manager_running_without_runtime",
        }),
        result: "fallback",
        type: "stop.controlled_drain",
      })
    );
  });

  it("keeps the running service untouched when the replacement bundle cannot be prepared", async () => {
    prepareDaemonServiceBundleMock.mockRejectedValue(
      new Error("replacement bundle validation failed")
    );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      forceReinstall: true,
    });

    expect(result).toMatchObject({
      errorMessage: "replacement bundle validation failed",
      failureStage: "prepare_bundle",
      recoveryStatus: "failed_before_safe_state",
      status: "failed",
    });
    expect(requestLocalDaemonShutdownMock).not.toHaveBeenCalled();
    expect(serviceManager.disableAutostart).not.toHaveBeenCalled();
    expect(serviceManager.stop).not.toHaveBeenCalled();
    expect(serviceManager.uninstall).not.toHaveBeenCalled();
    expect(serviceManager.install).not.toHaveBeenCalled();
    expect(installDaemonMock).not.toHaveBeenCalled();
  });

  it("restores the verified previous binary once when the replacement never publishes a runtime lease", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const previousBinaryPath = "/tmp/versions/0.3.3/openmeld";
    const previousInventory = {
      ...buildInitialInventory(serviceManager, {
        installedVersion: PREVIOUS_VERSION,
      }),
      activeBundle: {
        ...buildActiveBundle({
          bundleId: "bundle-old",
          daemonVersion: PREVIOUS_VERSION,
        }),
        bundleFormat: "binary_v1" as const,
        entryScriptRelativePath: "openmeld",
        sourceEntryScriptPath: previousBinaryPath,
        sourcePackageRootPath: "/tmp/versions/0.3.3",
        sourceDistRootPath: "/tmp/versions/0.3.3",
      },
      activeBundleSourceAvailable: null,
      activeBundleEntryPath: previousBinaryPath,
      runtimeCommandEntryPath: previousBinaryPath,
      anomalies: [
        {
          code: "version_outdated" as const,
          message: "OpenMeld Service is older than this CLI.",
        },
        {
          code: "bundle_version_drift" as const,
          message: "The active Service bundle is the previous version.",
        },
      ],
    } satisfies DaemonServiceInventory;
    const restoredInventory = {
      ...previousInventory,
      expectedVersion: PREVIOUS_VERSION,
      anomalies: [],
    } satisfies DaemonServiceInventory;
    inspectDaemonServiceInventoryMock.mockReset().mockImplementation(() => {
      if (inspectDaemonServiceInventoryMock.mock.calls.length === 1) {
        return Promise.resolve(previousInventory);
      }
      return Promise.resolve(
        restoreDaemonInstallStateSnapshotMock.mock.calls.length > 0
          ? restoredInventory
          : buildFinalInventory(serviceManager)
      );
    });

    const result = await settleLifecyclePromiseWithFakeTimers(
      runDaemonServiceLifecycle({
        expectedVersion: EXPECTED_VERSION,
        operation: "upgrade_reconcile",
        installSource: "daemon.command.install",
        desiredState: "background",
        shouldStartAfterLifecycle: true,
        forceReinstall: true,
      })
    );

    expect(result).toMatchObject({
      failureStage: "verify_final_inventory",
      recoveryStatus: "restored_verified_previous_state",
      status: "failed",
      backupDataPath: null,
    });
    expect(backupDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
    expect(restoreDaemonRuntimeDataForReinstallMock).not.toHaveBeenCalled();
    expect(result.inventoryAfter?.installStatus).toMatchObject({
      installed: true,
      state: { daemonVersion: PREVIOUS_VERSION },
    });
    expect(restoreDaemonInstallStateSnapshotMock).toHaveBeenCalledWith(
      previousInventory.installStatus.state
    );
    expect(restoreDaemonActiveBundleStateSnapshotMock).toHaveBeenCalledWith(
      previousInventory.activeBundle
    );
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(2);
    expect(serviceManager.install).toHaveBeenCalledTimes(2);
    expect(serviceManager.waitUntilRunning).not.toHaveBeenCalled();
    expect(restoreDaemonInstallStateSnapshotMock).toHaveBeenCalledTimes(1);
    expect(restoreDaemonActiveBundleStateSnapshotMock).toHaveBeenCalledTimes(1);
    expect(ensureDaemonSystemServiceCommandFilesMock).toHaveBeenCalledTimes(2);
    expect(ensureDaemonSystemServiceCommandFilesMock).toHaveBeenNthCalledWith(
      2,
      {
        controller: "launchd",
        distribution: "binary",
      }
    );
  });

  it("does not roll back below the cached Core required version floor", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const previousInventory = buildInitialInventory(serviceManager, {
      installedVersion: PREVIOUS_VERSION,
    });
    readVersionStateMock.mockResolvedValue({
      v: 1,
      last_version: EXPECTED_VERSION,
      latest_version: EXPECTED_VERSION,
      required_floor: EXPECTED_VERSION,
      updated_at: "2026-08-27T00:00:00.000Z",
    });
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(previousInventory)
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await settleLifecyclePromiseWithFakeTimers(
      runDaemonServiceLifecycle({
        expectedVersion: EXPECTED_VERSION,
        operation: "upgrade_reconcile",
        installSource: "daemon.command.install",
        desiredState: "background",
        shouldStartAfterLifecycle: true,
        forceReinstall: true,
      })
    );

    expect(result).toMatchObject({
      recoveryStatus: "stopped_safe_current_version",
      status: "stopped_safe",
    });
    expect(result.errorMessage).toContain(
      `required version floor ${EXPECTED_VERSION}`
    );
    expect(restoreDaemonInstallStateSnapshotMock).not.toHaveBeenCalled();
    expect(restoreDaemonActiveBundleStateSnapshotMock).not.toHaveBeenCalled();
  });

  it.each([
    "busy",
    "detached busy",
    "unsupported",
    "timeout",
    "restore failed",
    "disable failed",
  ])("does not stop a running Service when an idle update is %s", async (reason) => {
    if (reason === "detached busy") {
      const inventory = buildInitialInventory(serviceManager);
      inventory.serviceManagerStatus = null;
      inventory.runtimeStatus.managedBySystemService = false;
      inspectDaemonServiceInventoryMock
        .mockReset()
        .mockResolvedValue(inventory);
    }
    if (reason === "disable failed") {
      vi.mocked(serviceManager.disableAutostart).mockRejectedValue(
        new Error("autostart change unavailable")
      );
    }
    if (
      reason === "busy" ||
      reason === "detached busy" ||
      reason === "restore failed"
    ) {
      requestLocalDaemonShutdownMock.mockResolvedValue({
        accepted: false,
        mode: "graceful",
        gracePeriodMs: 2000,
      });
      if (reason === "restore failed") {
        vi.mocked(serviceManager.enableAutostart).mockRejectedValue(
          new Error("autostart unavailable")
        );
      }
    } else {
      requestLocalDaemonShutdownMock.mockRejectedValue(
        new LocalDaemonControlPlaneClientError(
          reason === "unsupported"
            ? "daemon.control.contract_mismatch"
            : "daemon.control.timeout",
          reason
        )
      );
    }
    const update = runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "cli.auto_check",
      desiredState: "background",
      shouldStartAfterLifecycle: true,
      forceReinstall: true,
      onlyIfIdle: true,
    });
    if (reason === "busy" || reason === "detached busy") {
      await expect(update).rejects.toBeInstanceOf(
        DaemonServiceUpdateDeferredError
      );
    } else {
      expect(await update).toMatchObject({
        status: "failed",
        failureStage: "stop_or_drain",
      });
    }
    if (reason === "disable failed") {
      expect(requestLocalDaemonShutdownMock).not.toHaveBeenCalled();
    } else {
      expect(requestLocalDaemonShutdownMock).toHaveBeenCalledWith(
        expect.objectContaining({
          onlyIfIdle: true,
          payload: expect.objectContaining({
            mode: "graceful",
          }),
        })
      );
    }
    expect(serviceManager.stop).not.toHaveBeenCalled();
    expect(serviceManager.uninstall).not.toHaveBeenCalled();
    expect(installDaemonMock).not.toHaveBeenCalled();
    expect(forceKillStalledDaemonAfterStopTimeoutMock).not.toHaveBeenCalled();
    expect(serviceManager.enableAutostart).toHaveBeenCalledTimes(
      reason === "disable failed" || reason === "detached busy" ? 0 : 1
    );
  });

  it("uses the legacy stop path only when the old service does not support controlled drain", async () => {
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.control.contract_mismatch",
        "the old service does not support shutdown"
      )
    );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(serviceManager.stop).toHaveBeenCalledOnce();
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          compatibilityFallback: true,
        }),
        result: "fallback",
        type: "stop.controlled_drain",
      })
    );
  });

  it("finishes upgrading a pre-0.2.88 service after its completed drain omits the close reason", async () => {
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.run.socket_closed",
        "daemon stream closed (code=1000, reason=closed)"
      )
    );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          installedVersion: "0.2.87",
        })
      )
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(serviceManager.stop).toHaveBeenCalledOnce();
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          compatibilityFallback: true,
          compatibilityReason: "legacy_missing_close_reason",
          observedDaemonVersion: "0.2.87",
        }),
        result: "fallback",
        type: "stop.controlled_drain",
      })
    );
  });

  it.each([
    PREVIOUS_VERSION,
    EXPECTED_VERSION,
  ])("preserves a running Service when controlled shutdown times out at version %s", async (installedVersion) => {
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.control.timeout",
        "local daemon control timed out after 15000ms"
      )
    );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          installedVersion,
        })
      )
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("failed");
    expect(serviceManager.stop).not.toHaveBeenCalled();
    expect(serviceManager.uninstall).not.toHaveBeenCalled();
    expect(serviceManager.enableAutostart).toHaveBeenCalledOnce();
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          compatibilityFallback: false,
        }),
        result: "failed",
        type: "stop.controlled_drain",
      })
    );
  });

  it("does not treat the same socket close from a fixed service as a legacy drain", async () => {
    requestLocalDaemonShutdownMock.mockRejectedValue(
      new LocalDaemonControlPlaneClientError(
        "daemon.run.socket_closed",
        "daemon stream closed (code=1000, reason=closed)"
      )
    );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          installedVersion: "0.2.88",
        })
      )
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("failed");
    expect(serviceManager.stop).not.toHaveBeenCalled();
    expect(serviceManager.enableAutostart).toHaveBeenCalledOnce();
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          compatibilityFallback: false,
        }),
        result: "failed",
        type: "stop.controlled_drain",
      })
    );
  });

  it("force-kills a stalled daemon when the stop window elapses and continues the lifecycle", async () => {
    // Production incident shape: an old daemon sleeping through SIGTERM in
    // reconnect backoff never exits inside the wait_stopped window. With a
    // stalled lease heartbeat the lifecycle escalates to SIGKILL and repair
    // completes instead of failing.
    let forceKilled = false;
    waitForDaemonSystemServiceToStopMock.mockReset().mockImplementation(() => {
      if (forceKilled) {
        runtimeSettled = true;
      }
      return Promise.resolve(forceKilled);
    });
    forceKillStalledDaemonAfterStopTimeoutMock
      .mockReset()
      .mockImplementation(() => {
        forceKilled = true;
        return Promise.resolve({
          killed: true,
          verdict: {
            decision: "force_kill",
            pid: 18_129,
            heartbeatStalledMs: 3.5 * 60 * 60 * 1000,
          },
        });
      });

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(forceKillStalledDaemonAfterStopTimeoutMock).toHaveBeenCalledWith({
      stage: "wait_stopped",
    });
    expect(waitForDaemonSystemServiceToStopMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the wait_stopped failure when the stuck daemon heartbeat is fresh", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      waitForDaemonSystemServiceToStopMock.mockReset().mockResolvedValue(false);
      readCurrentObservedDaemonRuntimeStatusMock
        .mockReset()
        .mockResolvedValue(buildRuntimeStatus("running"));

      const resultPromise = runDaemonServiceLifecycle({
        expectedVersion: EXPECTED_VERSION,
        operation: "reinstall",
        installSource: "daemon.command.install",
        desiredState: "stopped",
        shouldStartAfterLifecycle: false,
        forceReinstall: true,
      });
      const result = await settleLifecyclePromiseWithFakeTimers(resultPromise);

      expect(result.status).toBe("failed");
      if (result.status !== "failed") {
        throw new Error(
          `Expected lifecycle failure, received ${result.status}.`
        );
      }
      expect(result.failureStage).toBe("wait_stopped");
      expect(result.errorMessage).toContain("still running after stop phase");
      expect(result.errorMessage).toContain("stopped-safe recovery failed");
      expect(forceKillStalledDaemonAfterStopTimeoutMock).toHaveBeenCalledWith({
        stage: "wait_stopped",
      });
      expect(installDaemonMock).not.toHaveBeenCalled();
      expect(serviceManager.install).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the inferred background intent when an old-version process exits during the second absence window", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      let ownedProcessChecks = 0;
      let startedCurrentVersion = false;
      listDaemonOwnedProcessesMock.mockImplementation(() => {
        ownedProcessChecks += 1;
        return Promise.resolve(
          ownedProcessChecks <= 76
            ? [
                {
                  pid: 18_129,
                  parentPid: 1,
                  command: "node openmeld service run --mode foreground",
                  mode: "foreground" as const,
                  ownership: "cli_direct" as const,
                },
              ]
            : []
        );
      });
      serviceManager.start = vi.fn().mockImplementation(() => {
        startedCurrentVersion = true;
        return Promise.resolve();
      });
      serviceManager.waitUntilRunning = vi.fn().mockResolvedValue(undefined);
      cleanupStaleDaemonRuntimeDataBackupsMock.mockRejectedValueOnce(
        new Error("temporary backup cleanup failed")
      );
      inspectDaemonServiceInventoryMock.mockReset().mockImplementation(() => {
        if (inspectDaemonServiceInventoryMock.mock.calls.length === 1) {
          return Promise.resolve(
            buildInitialInventory(serviceManager, {
              activeBundleSourceAvailable: false,
              installedVersion: PREVIOUS_VERSION,
            })
          );
        }
        return Promise.resolve(
          startedCurrentVersion
            ? buildHealthyBackgroundInventory(serviceManager)
            : buildFinalInventory(serviceManager)
        );
      });

      const resultPromise = runDaemonServiceLifecycle({
        expectedVersion: EXPECTED_VERSION,
        operation: "upgrade_reconcile",
        installSource: "daemon.command.install",
        forceReinstall: true,
      });
      const result = await settleLifecyclePromiseWithFakeTimers(resultPromise);

      expect(result.status).toBe("aligned");
      expect(serviceManager.waitUntilAbsent).toHaveBeenCalledTimes(2);
      expect(serviceManager.start).toHaveBeenCalled();
      expect(installDaemonMock).toHaveBeenCalledWith({
        daemonVersion: EXPECTED_VERSION,
        source: "daemon.command.install",
      });
      expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          daemonVersion: EXPECTED_VERSION,
          desiredState: "background",
        })
      );
      expect(cleanupStaleDaemonRuntimeDataBackupsMock).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[openmeld.daemon_runtime_data.cleanup_warning]",
        {
          errorMessage: "temporary backup cleanup failed",
          operation: "upgrade_reconcile",
        }
      );
      const startOrder = vi
        .mocked(serviceManager.start)
        .mock.invocationCallOrder.at(-1);
      expect(
        vi
          .mocked(serviceManager.uninstall)
          .mock.invocationCallOrder.some(
            (uninstallOrder) =>
              startOrder !== undefined && uninstallOrder > startOrder
          )
      ).toBe(false);
      if (result.status === "aligned") {
        expect(result.desiredState).toBe("background");
        expect(result.shouldStartAfterLifecycle).toBe(true);
        expect(result.completedPhases).toEqual(
          expect.arrayContaining([
            "install_bundle",
            "write_contract",
            "register_service",
            "start_if_desired",
            "wait_running",
            "verify_final_inventory",
          ])
        );
        expect(
          result.inventoryAfter.installStatus.installed &&
            result.inventoryAfter.installStatus.state.daemonVersion
        ).toBe(EXPECTED_VERSION);
        expect(result.inventoryAfter.serviceContract?.daemonVersion).toBe(
          EXPECTED_VERSION
        );
        expect(result.inventoryAfter.activeBundle?.daemonVersion).toBe(
          EXPECTED_VERSION
        );
        expect(result.inventoryAfter.runtimeStatus.status).toBe("running");
        expect(result.inventoryAfter.serviceManagerStatus?.running).toBe(true);
      }
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("retries stale backup cleanup during an already-aligned lifecycle check", async () => {
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValue(buildHealthyBackgroundInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "startup_repair",
      installSource: "cli.auto_check",
    });

    expect(result.status).toBe("already_aligned");
    expect(cleanupStaleDaemonRuntimeDataBackupsMock).toHaveBeenCalledTimes(1);
    expect(serviceManager.uninstall).not.toHaveBeenCalled();
    expect(serviceManager.start).not.toHaveBeenCalled();
  });

  it("uses only two primary absence windows before stopped-safe recovery", async () => {
    serviceManager.waitUntilAbsent = vi
      .fn()
      .mockRejectedValueOnce(new Error("first absence window expired"))
      .mockRejectedValueOnce(new Error("second absence window expired"))
      .mockResolvedValue(undefined);
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          activeBundleSourceAvailable: false,
          installedVersion: PREVIOUS_VERSION,
        })
      )
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      forceReinstall: true,
    });

    expect(result.status).toBe("stopped_safe");
    if (result.status !== "stopped_safe") {
      return;
    }
    expect(result.failureStage).toBe("wait_absent");
    expect(result.errorMessage).toContain("second absence window expired");
    expect(result.errorMessage).toContain(
      "initial absence verification failed: first absence window expired"
    );
    expect(serviceManager.waitUntilAbsent).toHaveBeenCalledTimes(3);
    expect(result.completedPhases).not.toContain("install_bundle");
    expect(result.completedPhases).not.toContain("write_contract");
    expect(result.completedPhases).not.toContain("start_if_desired");
    expect(serviceManager.start).not.toHaveBeenCalled();
  });

  it("does not rewrite the stopped-safe carrier when process inventory is unavailable", async () => {
    serviceManager.waitUntilAbsent = vi
      .fn()
      .mockRejectedValueOnce(new Error("first absence window expired"))
      .mockRejectedValueOnce(new Error("second absence window expired"))
      .mockResolvedValue(undefined);
    listDaemonOwnedProcessesMock.mockRejectedValue(
      new Error("process inventory unavailable")
    );
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          activeBundleSourceAvailable: false,
          installedVersion: PREVIOUS_VERSION,
        })
      )
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "upgrade_reconcile",
      installSource: "daemon.command.install",
      forceReinstall: true,
    });

    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("process inventory unavailable");
    expect(prepareDaemonServiceBundleMock).toHaveBeenCalledTimes(1);
    expect(installDaemonMock).not.toHaveBeenCalled();
    expect(serviceManager.install).not.toHaveBeenCalled();
    expect(upsertDaemonServiceContractMock).not.toHaveBeenCalled();
  });

  it("fails at write_contract when required contract fields are missing", async () => {
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, { serviceContract: null })
      )
      .mockResolvedValue(
        buildFinalInventory(serviceManager, { serviceContract: null })
      );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      return;
    }
    expect(result.failureStage).toBe("write_contract");
    expect(result.reasonCodes).toContain("missing_required_contract_fields");
    expect(result.errorMessage).toContain("missing_required_contract_fields");
    expect(result.errorMessage).not.toContain("service contract is missing");
    expect(upsertDaemonServiceContractMock).not.toHaveBeenCalled();
  });

  it("waits for legacy shared service cleanup to disappear before installing the replacement", async () => {
    const legacyInventory = buildInitialInventory(serviceManager, {
      legacySharedServicePresent: true,
    });
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(legacyInventory)
      .mockResolvedValueOnce(legacyInventory)
      .mockResolvedValue(buildFinalInventory(serviceManager));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(cleanupLegacySharedDaemonServiceStateMock).toHaveBeenCalledTimes(1);
    expect(inspectDaemonServiceInventoryMock).toHaveBeenCalledTimes(4);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
  });

  it("writes the packaged canary lane contract with its isolated local defaults", async () => {
    vi.stubEnv("OPENMELD_GATEWAY_URL", undefined);
    vi.stubEnv("OPENMELD_AUTH_URL", "http://localhost:8788");
    vi.stubEnv("OPENMELD_ENV_PRESET", "canary");
    const canaryContract = buildServiceContract({
      bundleId: "bundle-old",
      desiredState: "background",
      gatewayUrl: "https://gateway.openmeld.invalid",
      lane: "canary",
      profileId: "agt_canary",
    });
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          serviceContract: canaryContract,
        })
      )
      .mockResolvedValue(
        buildFinalInventory(serviceManager, {
          serviceContract: buildServiceContract({
            bundleId: "bundle-new",
            desiredState: "stopped",
            gatewayUrl: "http://localhost:8080",
            lane: "canary",
            profileId: "agt_canary",
          }),
        })
      );

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleId: "bundle-new",
        desiredState: "stopped",
        deviceId: "device-123",
        gatewayUrl: "http://localhost:8080",
        lane: "canary",
        profileId: "agt_canary",
        serviceController: "launchd",
      })
    );
    expect(installDaemonMock).toHaveBeenCalledWith({
      daemonVersion: EXPECTED_VERSION,
      source: "daemon.command.install",
    });
    expect(serviceManager.install).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          OPENMELD_AUTH_URL: "http://localhost:8788",
          OPENMELD_ENV_PRESET: "canary",
          OPENMELD_GATEWAY_URL: "http://localhost:8080",
        }),
      })
    );
  });

  it("does not reuse unsafe production service contract identity during reinstall", async () => {
    vi.stubEnv("OPENMELD_ENV_PRESET", "prod");
    const pollutedContract = buildServiceContract({
      bundleId: "bundle-old",
      desiredState: "background",
      deviceId: "device_123",
      gatewayUrl: "https://gateway.openmeld.invalid",
      lane: "prod",
      profileId: "agt_existing",
    });
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValueOnce(
        buildInitialInventory(serviceManager, {
          serviceContract: pollutedContract,
        })
      )
      .mockResolvedValue(
        buildFinalInventory(serviceManager, {
          serviceContract: buildServiceContract({
            bundleId: "bundle-new",
            desiredState: "stopped",
            deviceId: "real-device-id",
            gatewayUrl: "https://gateway.openmeld.invalid",
            lane: "prod",
            profileId: "2a6552de-1198-4671-b93c-ef1a423ee03b",
          }),
        })
      );
    ensureDaemonRuntimePathsMock.mockResolvedValue({
      deviceIdPath: "/tmp/openmeld-prod-device-id",
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValue({
      openMeldProfileId: "2a6552de-1198-4671-b93c-ef1a423ee03b",
    });
    resolveDaemonDeviceIdMock.mockResolvedValue("real-device-id");

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    expect(result.status).toBe("aligned");
    expect(resolveDaemonDeviceIdMock).toHaveBeenCalledWith({
      deviceId: undefined,
      deviceIdPath: "/tmp/openmeld-prod-device-id",
      shouldDiscardPersistedDeviceId: expect.any(Function),
    });
    expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "real-device-id",
        profileId: "2a6552de-1198-4671-b93c-ef1a423ee03b",
      })
    );
    expect(upsertDaemonServiceContractMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device_123",
      })
    );
    expect(upsertDaemonServiceContractMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: "agt_existing",
      })
    );
  });

  it("passes an explicit lifecycle gateway target into the managed service registration", async () => {
    vi.stubEnv("OPENMELD_ENV_PRESET", "canary");
    vi.stubEnv("OPENMELD_AUTH_URL", "https://auth-preview.openmeld.test");

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
      gatewayUrl: "https://gateway-preview.openmeld.test",
      profile: "agt_canary",
      deviceId: "device-123",
    });

    expect(result.status).toBe("aligned");
    expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayUrl: "https://gateway-preview.openmeld.test",
      })
    );
    expect(serviceManager.install).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          OPENMELD_AUTH_URL: "https://auth-preview.openmeld.test",
          OPENMELD_ENV_PRESET: "canary",
          OPENMELD_GATEWAY_URL: "https://gateway-preview.openmeld.test",
        }),
      })
    );
  });

  it("keeps waiting after launchd starts until the target runtime lease is published", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      const startedAtMs = Date.now();
      let managerRunning = false;
      serviceManager.start = vi.fn().mockImplementation(() => {
        setTimeout(() => {
          managerRunning = true;
        }, 51);
        return Promise.resolve();
      });
      readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue(
        buildRuntimeStatus("stale")
      );
      inspectDaemonServiceInventoryMock.mockReset().mockImplementation(() => {
        if (inspectDaemonServiceInventoryMock.mock.calls.length === 1) {
          return Promise.resolve(buildInitialInventory(serviceManager));
        }
        if (Date.now() - startedAtMs < 27_000) {
          const inventory =
            buildRecoverableStartupDriftInventory(serviceManager);
          if (inventory.serviceManagerStatus) {
            inventory.serviceManagerStatus.running = managerRunning;
          }
          return Promise.resolve(inventory);
        }
        return Promise.resolve(buildHealthyBackgroundInventory(serviceManager));
      });

      const resultPromise = runDaemonServiceLifecycle({
        expectedVersion: EXPECTED_VERSION,
        operation: "upgrade_reconcile",
        installSource: "daemon.command.install",
        desiredState: "background",
        shouldStartAfterLifecycle: true,
        forceReinstall: true,
      });
      const result = await settleLifecyclePromiseWithFakeTimers(resultPromise);

      expect(result.status).toBe("aligned");
      expect(Date.now() - startedAtMs).toBeGreaterThanOrEqual(27_000);
      expect(Date.now() - startedAtMs).toBeLessThan(90_000);
      expect(serviceManager.stop).toHaveBeenCalledTimes(1);
      expect(serviceManager.start).toHaveBeenCalledTimes(1);
      expect(serviceManager.waitUntilRunning).not.toHaveBeenCalled();
      expect(restoreDaemonInstallStateSnapshotMock).not.toHaveBeenCalled();
      expect(restoreDaemonActiveBundleStateSnapshotMock).not.toHaveBeenCalled();
      expect(result.reasonCodes).toEqual([]);
      if (result.status === "aligned") {
        expect(result.inventoryAfter.anomalies).toEqual([]);
        expect(result.inventoryAfter.runtimeStatus.status).toBe("running");
        expect(result.inventoryAfter.serviceManagerStatus?.running).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

async function settleLifecyclePromiseWithFakeTimers<T>(
  promise: Promise<T>
): Promise<T> {
  const realDeadlineMs = vi.getRealSystemTime() + 10_000;
  let settled = false;
  let resolvedValue: T | undefined;
  let rejectedError: unknown;
  const observedPromise = promise.then(
    (value) => {
      settled = true;
      resolvedValue = value;
    },
    (error: unknown) => {
      settled = true;
      rejectedError = error;
    }
  );

  while (!settled && vi.getRealSystemTime() < realDeadlineMs) {
    if (vi.getTimerCount() > 0) {
      await vi.advanceTimersToNextTimerAsync();
      continue;
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  if (!settled) {
    throw new Error(
      "local service lifecycle did not settle within the 10000ms real-time test watchdog"
    );
  }
  await observedPromise;

  if (rejectedError) {
    throw rejectedError;
  }
  return resolvedValue as T;
}

function buildInitialInventory(
  serviceManager: DaemonServiceManager,
  overrides: {
    activeBundleSourceAvailable?: boolean;
    installedVersion?: string;
    legacySharedServicePresent?: boolean;
    serviceContract?: DaemonServiceContract | null;
  } = {}
): DaemonServiceInventory {
  const installedVersion = overrides.installedVersion ?? EXPECTED_VERSION;
  const serviceContract =
    overrides.serviceContract === undefined
      ? buildServiceContract({
          bundleId: "bundle-old",
          daemonVersion: installedVersion,
          desiredState: "background",
        })
      : overrides.serviceContract;
  return {
    expectedVersion: EXPECTED_VERSION,
    installStatus: {
      installed: true,
      state: buildInstallState(installedVersion),
    },
    runtimeStatus: buildRuntimeStatus("running"),
    serviceContract,
    legacySharedService: overrides.legacySharedServicePresent
      ? {
          present: true,
          pathInput: {},
          installStatus: {
            installed: false,
            state: null,
          },
          runtimeStatus: buildRuntimeStatus("stale"),
          serviceManager,
          serviceManagerStatus: {
            installed: true,
            running: false,
            enabled: true,
            definitionPath: "/tmp/com.openmeld.legacy-shared.plist",
            commandSummary: "launchctl bootstrap legacy",
          },
          ownedProcesses: [],
        }
      : null,
    activeBundle: buildActiveBundle({
      bundleId: "bundle-old",
      daemonVersion: installedVersion,
    }),
    activeBundleSourceAvailable:
      overrides.activeBundleSourceAvailable === undefined
        ? true
        : overrides.activeBundleSourceAvailable,
    activeBundleEntryPath: "/tmp/bundles/bundle-old/dist/openmeld-dev.js",
    runtimeCommandEntryPath: "/tmp/bundles/bundle-old/dist/openmeld-dev.js",
    runtimeCommandPathExists: true,
    serviceManager,
    serviceManagerStatus: {
      installed: true,
      running: true,
      enabled: true,
      definitionPath: "/tmp/com.openmeld.dev-local.plist",
      commandSummary: "launchctl bootstrap",
    },
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [
      {
        code: overrides.legacySharedServicePresent
          ? "legacy_shared_service_present"
          : "bundle_content_drift",
        message: overrides.legacySharedServicePresent
          ? "A legacy shared OpenMeld Service is still registered."
          : "OpenMeld Service is using older local service files than this lane expects.",
      },
    ],
  };
}

function buildFinalInventory(
  serviceManager: DaemonServiceManager,
  overrides: {
    serviceContract?: DaemonServiceContract | null;
  } = {}
): DaemonServiceInventory {
  const serviceContract =
    overrides.serviceContract === undefined
      ? buildServiceContract({
          bundleId: "bundle-new",
          desiredState: "stopped",
        })
      : overrides.serviceContract;
  return {
    expectedVersion: EXPECTED_VERSION,
    installStatus: {
      installed: true,
      state: buildInstallState(),
    },
    runtimeStatus: buildRuntimeStatus("stale"),
    serviceContract,
    legacySharedService: null,
    activeBundle: buildActiveBundle({
      bundleId: "bundle-new",
    }),
    activeBundleSourceAvailable: true,
    activeBundleEntryPath: "/tmp/bundles/bundle-new/dist/openmeld-dev.js",
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    serviceManager,
    serviceManagerStatus: {
      installed: true,
      running: false,
      enabled: true,
      definitionPath: "/tmp/com.openmeld.dev-local.plist",
      commandSummary: "launchctl bootstrap",
    },
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
  };
}

function buildRecoverableStartupDriftInventory(
  serviceManager: DaemonServiceManager
): DaemonServiceInventory {
  return {
    ...buildFinalInventory(serviceManager, {
      serviceContract: buildServiceContract({
        bundleId: "bundle-new",
        desiredState: "background",
      }),
    }),
    runtimeStatus: buildRuntimeStatus("stale"),
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    serviceManagerStatus: {
      installed: true,
      running: true,
      enabled: true,
      definitionPath: "/tmp/com.openmeld.dev-local.plist",
      commandSummary: "launchctl bootstrap",
    },
    anomalies: [
      {
        code: "runtime_stale",
        message: "Runtime state is stale.",
      },
      {
        code: "manager_running_without_runtime",
        message:
          "The OS service manager reports OpenMeld Service as running, but runtime state is not healthy.",
      },
    ],
  };
}

function buildHealthyBackgroundInventory(
  serviceManager: DaemonServiceManager
): DaemonServiceInventory {
  return {
    ...buildFinalInventory(serviceManager, {
      serviceContract: buildServiceContract({
        bundleId: "bundle-new",
        desiredState: "background",
      }),
    }),
    runtimeStatus: buildRuntimeStatus("running"),
    runtimeCommandEntryPath: "/tmp/bundles/bundle-new/dist/openmeld-dev.js",
    runtimeCommandPathExists: true,
    serviceManagerStatus: {
      installed: true,
      running: true,
      enabled: true,
      definitionPath: "/tmp/com.openmeld.dev-local.plist",
      commandSummary: "launchctl bootstrap",
    },
    anomalies: [],
  };
}

function buildInstallState(
  daemonVersion: string = EXPECTED_VERSION
): DaemonInstallState {
  return {
    v: 1,
    schema: "openmeld-daemon-install-v1",
    daemonVersion,
    installSource: "daemon.command.install",
    installedAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
}

function buildRuntimeStatus(status: "running" | "stale") {
  if (status === "running") {
    return {
      status,
      mode: "background" as const,
      pid: 18_129,
      startedAt: "2026-04-20T11:22:27.819Z",
      updatedAt: "2026-04-20T13:04:53.353Z",
      managedBySystemService: true,
      serviceController: "launchd" as const,
      autoStart: true,
    };
  }

  return {
    status,
    mode: "background" as const,
    pid: 18_129,
    startedAt: null,
    updatedAt: null,
    managedBySystemService: true,
    serviceController: "launchd" as const,
    autoStart: true,
    reason: "runtime_lease_missing",
  };
}

function buildServiceContract(input: {
  bundleId: string;
  daemonVersion?: string;
  deviceId?: string;
  desiredState: "background" | "stopped";
  gatewayUrl?: string;
  lane?: DaemonServiceContract["lane"];
  profileId?: string;
}): DaemonServiceContract {
  return {
    schema: "openmeld-daemon-service-contract-v1" as const,
    v: 1 as const,
    lane: input.lane ?? ("dev-local" as const),
    daemonVersion: input.daemonVersion ?? EXPECTED_VERSION,
    bundleId: input.bundleId,
    desiredState: input.desiredState,
    serviceController: "launchd" as const,
    autoStart: input.desiredState === "background",
    gatewayUrl: input.gatewayUrl ?? "http://localhost:8080",
    profileId: input.profileId ?? "agt_existing",
    deviceId: input.deviceId ?? "device-123",
    heartbeatMs: 25_000,
    generation: 391,
    updatedAt: "2026-04-20T11:22:25.450Z",
  };
}

function buildActiveBundle(input: {
  bundleId: string;
  daemonVersion?: string;
}) {
  return {
    v: 2 as const,
    schema: "openmeld-daemon-active-bundle-v2" as const,
    bundleId: input.bundleId,
    daemonVersion: input.daemonVersion ?? EXPECTED_VERSION,
    entryScriptRelativePath: "dist/openmeld-dev.js",
    bundleFormat: "self_contained_v1" as const,
    sourceEntryScriptPath: `/tmp/${input.bundleId}/dist/openmeld-dev.js`,
    sourcePackageRootPath: `/tmp/${input.bundleId}`,
    sourceDistRootPath: `/tmp/${input.bundleId}/dist`,
    sourceDistFingerprint: `${input.bundleId}-fingerprint`,
    sourceKind: "package_install" as const,
    createdAt: "2026-04-20T11:22:07.053Z",
    updatedAt: "2026-04-20T11:22:07.053Z",
  };
}
