import type { DaemonServiceContract } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonInstallState } from "../src/config/daemon-state";
import { LocalDaemonControlPlaneClientError } from "../src/local-service/control-plane/client";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import { runDaemonServiceLifecycle } from "../src/local-service/lifecycle/daemon-service-lifecycle";
import type { DaemonServiceManager } from "../src/local-service/lifecycle/daemon-service-manager";

const EXPECTED_VERSION = "0.3.6";
const PREVIOUS_VERSION = "0.3.3";

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
  inspectDaemonServiceInventoryMock,
  installDaemonMock,
  listDaemonOwnedProcessesMock,
  discardPreparedDaemonServiceBundleMock,
  prepareDaemonServiceBundleMock,
  requestLocalDaemonShutdownMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  readDaemonServiceContractMock,
  readDaemonServiceRuntimeSnapshotMock,
  emitDaemonLifecycleEventMock,
  resolveOpenMeldProfileOrNullMock,
  resolveDaemonDeviceIdMock,
  restoreDaemonActiveBundleStateSnapshotMock,
  restoreDaemonInstallStateSnapshotMock,
  restoreDaemonRuntimeDataForReinstallMock,
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
  inspectDaemonServiceInventoryMock: vi.fn(),
  installDaemonMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  discardPreparedDaemonServiceBundleMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  requestLocalDaemonShutdownMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  readDaemonServiceRuntimeSnapshotMock: vi.fn(),
  emitDaemonLifecycleEventMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveDaemonDeviceIdMock: vi.fn(),
  restoreDaemonActiveBundleStateSnapshotMock: vi.fn(),
  restoreDaemonInstallStateSnapshotMock: vi.fn(),
  restoreDaemonRuntimeDataForReinstallMock: vi.fn(),
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
  };
});

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
  let runtimeSettled = false;
  let serviceManager: DaemonServiceManager;

  beforeEach(() => {
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
    expect(
      waitForDaemonSystemServiceToStopMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      backupDaemonRuntimeDataForReinstallMock.mock
        .invocationCallOrder[0] as number
    );
    expect(
      backupDaemonRuntimeDataForReinstallMock.mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(serviceManager.uninstall).mock.invocationCallOrder[0] as number
    );
    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
    expect(serviceManager.install).toHaveBeenCalledTimes(1);
    expect(forceKillStalledDaemonAfterStopTimeoutMock).not.toHaveBeenCalled();
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
      timeoutMs: 0,
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
    waitForDaemonSystemServiceToStopMock.mockReset().mockResolvedValue(false);
    readCurrentObservedDaemonRuntimeStatusMock
      .mockReset()
      .mockResolvedValue(buildRuntimeStatus("running"));

    const result = await runDaemonServiceLifecycle({
      expectedVersion: EXPECTED_VERSION,
      operation: "reinstall",
      installSource: "daemon.command.install",
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      forceReinstall: true,
    });

    // The existing failure path stays intact: the lifecycle records the
    // wait_stopped failure and falls into its stopped-safe recovery instead
    // of killing a daemon with fresh heartbeats.
    expect(result.status).toBe("stopped_safe");
    if (result.status !== "stopped_safe") {
      return;
    }
    expect(result.failureStage).toBe("wait_stopped");
    expect(result.errorMessage).toContain("still running after stop phase");
    expect(forceKillStalledDaemonAfterStopTimeoutMock).toHaveBeenCalledWith({
      stage: "wait_stopped",
    });
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

  it("writes the packaged canary lane contract through the shared lifecycle writer", async () => {
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

  it("recovers a background upgrade when launchd is running but runtime state stays stale during final verification", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      let stoppedForRecovery = false;
      let startedAfterRecoveryStop = false;
      serviceManager.stop = vi.fn().mockResolvedValue(undefined);
      serviceManager.start = vi.fn().mockImplementation(() => {
        if (stoppedForRecovery) {
          startedAfterRecoveryStop = true;
        }
        return Promise.resolve();
      });
      serviceManager.waitUntilStopped = vi.fn().mockImplementation(() => {
        stoppedForRecovery = true;
        return Promise.resolve();
      });
      serviceManager.waitUntilRunning = vi.fn().mockResolvedValue(undefined);
      readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue(
        buildRuntimeStatus("stale")
      );
      inspectDaemonServiceInventoryMock.mockReset().mockImplementation(() => {
        if (inspectDaemonServiceInventoryMock.mock.calls.length === 1) {
          return Promise.resolve(buildInitialInventory(serviceManager));
        }
        return Promise.resolve(
          startedAfterRecoveryStop
            ? buildHealthyBackgroundInventory(serviceManager)
            : buildRecoverableStartupDriftInventory(serviceManager)
        );
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
      expect(serviceManager.stop).toHaveBeenCalled();
      expect(startedAfterRecoveryStop).toBe(true);
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
