import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  runDaemonAutostart,
  runDaemonInstall,
  runDaemonReinstall,
  runDaemonSnapshot,
  runDaemonStatus,
  runDaemonStop,
  runDaemonTeardownStrict,
  runDaemonUninstall,
} from "../src/commands/service";
import { setAuthSession } from "../src/config/auth-session";
import {
  daemonServiceContractPath,
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import type { DaemonLifecycleLockMeta } from "../src/config/daemon-state";
import { emitDaemonLifecycleEvent } from "../src/local-service/lifecycle/daemon-lifecycle-journal";
import { daemonServiceActiveBundlePath } from "../src/local-service/lifecycle/daemon-service-bundle";
import type { DaemonServiceInventory } from "../src/local-service/lifecycle/daemon-service-inventory";
import { DaemonServiceLifecycleDrainTimeoutError } from "../src/local-service/lifecycle/daemon-service-lifecycle";
import type {
  DaemonServiceManager,
  DaemonServiceManagerRuntimeStatus,
} from "../src/local-service/lifecycle/daemon-service-manager";
import { daemonRuntimeContractRepairReportPath } from "../src/local-service/state/runtime-contract-guard";
import type { CurrentReplyReadinessSnapshot } from "../src/system/current-reply-readiness-snapshot";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_CONTRACT_PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const AGENT_REINSTALL_RUNTIME_PROFILE_ID =
  "agt_22222222-2222-4222-8222-222222222222";
const AGENT_STOP_RUNTIME_PROFILE_ID =
  "agt_33333333-3333-4333-8333-333333333333";
const AGENT_RUNTIME_FALLBACK_PROFILE_ID =
  "agt_44444444-4444-4444-8444-444444444444";
const AGENT_EXPLICIT_INSTALL_PROFILE_ID =
  "agt_55555555-5555-4555-8555-555555555555";

async function runDaemonReinstallInTempHome(
  ...args: Parameters<typeof runDaemonReinstall>
): Promise<Awaited<ReturnType<typeof runDaemonReinstall>>> {
  return await withTempHome(async () => await runDaemonReinstall(...args));
}

const {
  captureDaemonServiceEvidenceBestEffortMock,
  captureDaemonServiceEvidenceMock,
  resolveDaemonServiceDependencyDiagnosticsMock,
  readDaemonStartFailureStateMock,
  clearDaemonStartFailureStateMock,
  inspectDaemonServiceInventoryMock,
  readCurrentDaemonRuntimeContextMock,
  prepareDaemonServiceBundleMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  listDaemonOwnedProcessesMock,
  resolveCurrentReplyReadinessSnapshotMock,
  runDaemonStartupPreflightMock,
  runDaemonServiceLifecycleMock,
} = vi.hoisted(() => ({
  captureDaemonServiceEvidenceBestEffortMock: vi.fn(),
  captureDaemonServiceEvidenceMock: vi.fn(),
  resolveDaemonServiceDependencyDiagnosticsMock: vi.fn(),
  readDaemonStartFailureStateMock: vi.fn(),
  clearDaemonStartFailureStateMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  readCurrentDaemonRuntimeContextMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  resolveCurrentReplyReadinessSnapshotMock: vi.fn(),
  runDaemonStartupPreflightMock: vi.fn(),
  runDaemonServiceLifecycleMock: vi.fn(),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-evidence", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-evidence")
  >("../src/local-service/lifecycle/daemon-service-evidence");
  return {
    ...actual,
    captureDaemonServiceEvidence: (
      ...args: Parameters<typeof captureDaemonServiceEvidenceMock>
    ) => captureDaemonServiceEvidenceMock(...args),
    captureDaemonServiceEvidenceBestEffort: (
      ...args: Parameters<typeof captureDaemonServiceEvidenceBestEffortMock>
    ) => captureDaemonServiceEvidenceBestEffortMock(...args),
  };
});

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

vi.mock(
  "../src/local-service/lifecycle/daemon-service-process-inventory",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-process-inventory")
    >("../src/local-service/lifecycle/daemon-service-process-inventory");
    return {
      ...actual,
      listDaemonOwnedProcesses: (...args: unknown[]) =>
        listDaemonOwnedProcessesMock(...args),
    };
  }
);

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-bundle")
  >("../src/local-service/lifecycle/daemon-service-bundle");
  return {
    ...actual,
    prepareDaemonServiceBundle: prepareDaemonServiceBundleMock,
  };
});

vi.mock(
  "../src/local-service/lifecycle/daemon-service-dependency-diagnostics",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/lifecycle/daemon-service-dependency-diagnostics")
    >("../src/local-service/lifecycle/daemon-service-dependency-diagnostics");
    return {
      ...actual,
      resolveDaemonServiceDependencyDiagnostics:
        resolveDaemonServiceDependencyDiagnosticsMock,
    };
  }
);

vi.mock("../src/local-service/state/daemon-start-failure-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/state/daemon-start-failure-state")
  >("../src/local-service/state/daemon-start-failure-state");
  return {
    ...actual,
    clearDaemonStartFailureState: clearDaemonStartFailureStateMock,
    readDaemonStartFailureState: readDaemonStartFailureStateMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-runtime")
  >("../src/local-service/lifecycle/daemon-service-runtime");
  return {
    ...actual,
    readCurrentDaemonRuntimeContext: (...args: unknown[]) =>
      readCurrentDaemonRuntimeContextMock(...args),
    readCurrentObservedDaemonRuntimeStatus:
      readCurrentObservedDaemonRuntimeStatusMock,
  };
});

vi.mock("../src/system/current-reply-readiness-snapshot", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/current-reply-readiness-snapshot")
  >("../src/system/current-reply-readiness-snapshot");
  return {
    ...actual,
    resolveCurrentReplyReadinessSnapshot:
      resolveCurrentReplyReadinessSnapshotMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-startup-preflight", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-startup-preflight")
  >("../src/local-service/lifecycle/daemon-startup-preflight");
  return {
    ...actual,
    runDaemonStartupPreflight: (...args: unknown[]) =>
      runDaemonStartupPreflightMock(...args),
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-lifecycle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-lifecycle")
  >("../src/local-service/lifecycle/daemon-service-lifecycle");
  return {
    ...actual,
    runDaemonServiceLifecycle: (...args: unknown[]) =>
      runDaemonServiceLifecycleMock(...args),
  };
});

describe("openmeld service commands", () => {
  beforeEach(() => {
    captureDaemonServiceEvidenceBestEffortMock
      .mockReset()
      .mockResolvedValue(null);
    captureDaemonServiceEvidenceMock.mockReset().mockResolvedValue({
      evidencePath: "/tmp/openmeld-evidence/service-evidence-1",
      manifestPath: "/tmp/openmeld-evidence/service-evidence-1/manifest.json",
    });
    resolveDaemonServiceDependencyDiagnosticsMock
      .mockReset()
      .mockResolvedValue({
        applicable: false,
        ready: true,
        lane: "prod",
        scopePolicy: "loopback_only",
        issues: [],
        checkedUrls: {
          auth: null,
          gateway: null,
        },
      });
    readDaemonStartFailureStateMock.mockReset().mockResolvedValue(null);
    clearDaemonStartFailureStateMock.mockReset().mockResolvedValue(undefined);
    inspectDaemonServiceInventoryMock
      .mockReset()
      .mockResolvedValue(createCleanDaemonServiceInventory());
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue({
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: "service-bundle",
      daemonVersion: "0.2.2",
      entryScriptRelativePath: "dist/openmeld.js",
      bundleFormat: "self_contained_v1",
      sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
      sourcePackageRootPath: "/tmp/current-cli",
      sourceDistRootPath: "/tmp/current-cli/dist",
      sourceKind: "package_install",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    });
    readCurrentObservedDaemonRuntimeStatusMock.mockReset().mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    });
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
    readCurrentDaemonRuntimeContextMock.mockReset().mockResolvedValue({
      status: {
        installed: false,
        state: null,
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
      serviceManager: null,
      serviceManagerStatus: null,
      legacySharedService: null,
      effectiveRuntimeStatus: "not_running",
    });
    resolveCurrentReplyReadinessSnapshotMock
      .mockReset()
      .mockResolvedValue(createReplyReadinessSnapshot());
    runDaemonStartupPreflightMock.mockReset().mockResolvedValue({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });
    runDaemonServiceLifecycleMock
      .mockReset()
      .mockImplementation(async (input) => {
        const daemonVersion =
          input && typeof input === "object" && "expectedVersion" in input
            ? String(input.expectedVersion)
            : packageJson.version;
        await writeDaemonActiveBundleState({
          bundleId: "service-bundle",
          daemonVersion,
        });
        return createAlignedDaemonServiceLifecycleOutcome({
          inventoryBefore: createCleanDaemonServiceInventory(),
          inventoryAfter: createCleanDaemonServiceInventory({
            daemonVersion,
          }),
          targetVersion: daemonVersion,
        });
      });
  });

  it("returns install result envelope in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonInstall({
          view: "agent",
          profile: HUMAN_PROFILE_ID,
        });
      });

      const payload = parseAgentResultEnvelope(stdout, "daemon.install.result");
      expect(payload?.status).toBe("installed");
      expect(typeof payload?.state?.daemonVersion).toBe("string");
      expect(payload?.runtimeProjection?.status).toBe("skipped");
      const contract = await readDaemonServiceContract();
      expect(contract).toMatchObject({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "stopped",
        autoStart: false,
        profileId: HUMAN_PROFILE_ID,
      });
    });
  });

  it("returns install result as a canonical JSON envelope with --json", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonInstall({
          json: true,
          profile: HUMAN_PROFILE_ID,
        });
      });

      const envelope = parseJsonEnvelope(stdout, "daemon.install") as
        | {
            schemaVersion?: number;
            status?: string;
            state?: { daemonVersion?: string };
          }
        | undefined;
      expect(envelope?.schemaVersion).toBe(1);
      expect(envelope?.status).toBe("installed");
      expect(typeof envelope?.state?.daemonVersion).toBe("string");
      expect(stdout).not.toContain("OpenMeld Service Installed");
    });
  });

  it("returns uninstall result envelope in agent view", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });
      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: null,
        systemServiceController: null,
        systemServiceUninstalled: false,
      });

      const removed = await withCapturedStdio(async () => {
        await runDaemonUninstall(
          {
            view: "agent",
          },
          {
            teardown: teardownMock,
          }
        );
      });
      const removePayload = parseAgentResultEnvelope(
        removed.stdout,
        "daemon.uninstall.result"
      );
      expect(removePayload?.status).toBe("removed");
      expect(teardownMock).toHaveBeenCalledWith({
        reason: "service_uninstall",
      });
      expect(await readDaemonServiceContract()).toBeNull();
      expect(daemonServiceContractPath()).toContain("service-contract.json");
    });
  });

  it("returns uninstall result as a canonical JSON envelope with --json", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });
      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: null,
        systemServiceController: null,
        systemServiceUninstalled: false,
      });
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonUninstall(
          {
            json: true,
          },
          {
            teardown: teardownMock,
          }
        );
      });
      const envelope = parseJsonEnvelope(stdout, "daemon.uninstall") as
        | { schemaVersion?: number; status?: string }
        | undefined;
      expect(envelope?.schemaVersion).toBe(1);
      expect(envelope?.status).toBe("removed");
      expect(teardownMock).toHaveBeenCalledWith({
        reason: "service_uninstall",
      });
      expect(stdout).not.toContain("OpenMeld Service Removed");
    });
  });

  it("returns stop result as a canonical JSON envelope with --json", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStop({
          json: true,
        });
      });
      const envelope = parseJsonEnvelope(stdout, "daemon.stop") as
        | { schemaVersion?: number; status?: string }
        | undefined;
      expect(envelope?.schemaVersion).toBe(1);
      expect(typeof envelope?.status).toBe("string");
    });
  });

  it("enables service autostart without starting the current service", async () => {
    await withTempHome(async () => {
      const calls: string[] = [];
      const managerStatus: DaemonServiceManagerRuntimeStatus = {
        installed: true,
        running: true,
        enabled: false,
        definitionPath: "/tmp/openmeld-service.plist",
        commandSummary: "openmeld service run",
      };
      const serviceManager = createFakeServiceManager(managerStatus, calls);
      const clearRegistrationRepairPending = vi.fn(async () => undefined);
      let reconcileLockMeta: DaemonLifecycleLockMeta | undefined;
      const withReconcileLock = async <T>(
        callback: () => Promise<T>,
        meta?: DaemonLifecycleLockMeta
      ): Promise<T> => {
        reconcileLockMeta = meta;
        return await callback();
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonAutostart(
          {
            action: "enable",
            json: true,
            view: "agent",
          },
          {
            clearRegistrationRepairPending,
            resolveServiceManager: async () => serviceManager,
            withRegistrationMutationLock: withReconcileLock,
          }
        );
      });

      const envelope = parseJsonEnvelope(stdout, "daemon.autostart") as
        | {
            action?: string;
            enabled?: boolean;
            serviceManagerStatus?: { enabled?: boolean; running?: boolean };
          }
        | undefined;
      expect(envelope?.action).toBe("enable");
      expect(envelope?.enabled).toBe(true);
      expect(envelope?.serviceManagerStatus?.enabled).toBe(true);
      expect(envelope?.serviceManagerStatus?.running).toBe(true);
      expect(clearRegistrationRepairPending).toHaveBeenCalledOnce();
      expect(reconcileLockMeta).toEqual({
        command: "openmeld service autostart enable",
        intent: "autostart",
      });
      expect(calls).toEqual(["status", "enableAutostart", "status"]);
    });
  });

  it("disables service autostart without stopping the current service", async () => {
    await withTempHome(async () => {
      const calls: string[] = [];
      const managerStatus: DaemonServiceManagerRuntimeStatus = {
        installed: true,
        running: true,
        enabled: true,
        definitionPath: "/tmp/openmeld-service.plist",
        commandSummary: "openmeld service run",
      };
      const serviceManager = createFakeServiceManager(managerStatus, calls);
      const clearRegistrationRepairPending = vi.fn(async () => undefined);
      let reconcileLockMeta: DaemonLifecycleLockMeta | undefined;
      const withReconcileLock = async <T>(
        callback: () => Promise<T>,
        meta?: DaemonLifecycleLockMeta
      ): Promise<T> => {
        reconcileLockMeta = meta;
        return await callback();
      };

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonAutostart(
          {
            action: "disable",
            json: true,
            view: "agent",
          },
          {
            clearRegistrationRepairPending,
            resolveServiceManager: async () => serviceManager,
            withRegistrationMutationLock: withReconcileLock,
          }
        );
      });

      const envelope = parseJsonEnvelope(stdout, "daemon.autostart") as
        | {
            action?: string;
            enabled?: boolean;
            serviceManagerStatus?: { enabled?: boolean; running?: boolean };
          }
        | undefined;
      expect(envelope?.action).toBe("disable");
      expect(envelope?.enabled).toBe(false);
      expect(envelope?.serviceManagerStatus?.enabled).toBe(false);
      expect(envelope?.serviceManagerStatus?.running).toBe(true);
      expect(clearRegistrationRepairPending).toHaveBeenCalledOnce();
      expect(reconcileLockMeta).toEqual({
        command: "openmeld service autostart disable",
        intent: "autostart",
      });
      expect(calls).toEqual(["status", "disableAutostart", "status"]);
    });
  });

  it("keeps repair pending when autostart confirmation cannot be read", async () => {
    await withTempHome(async () => {
      const calls: string[] = [];
      const serviceManager = createFakeServiceManager(
        {
          installed: true,
          running: true,
          enabled: true,
          definitionPath: "/tmp/openmeld-service.plist",
          commandSummary: "openmeld service run",
        },
        calls
      );
      const originalStatus = serviceManager.status;
      let statusCalls = 0;
      serviceManager.status = async () => {
        statusCalls += 1;
        if (statusCalls === 2) {
          throw new Error("launchctl print-disabled: Operation not permitted");
        }
        return await originalStatus();
      };
      const clearRegistrationRepairPending = vi.fn(async () => undefined);

      await expect(
        runDaemonAutostart(
          {
            action: "disable",
            json: true,
            view: "agent",
          },
          {
            clearRegistrationRepairPending,
            resolveServiceManager: async () => serviceManager,
            withRegistrationMutationLock: async (callback) => await callback(),
          }
        )
      ).rejects.toThrow("Operation not permitted");
      expect(clearRegistrationRepairPending).not.toHaveBeenCalled();
    });
  });

  it("fails service autostart honestly when the service is not installed", async () => {
    await withTempHome(async () => {
      const calls: string[] = [];
      const serviceManager = createFakeServiceManager(
        {
          installed: false,
          running: false,
          enabled: false,
          definitionPath: null,
          commandSummary: null,
        },
        calls
      );

      await expect(
        runDaemonAutostart(
          {
            action: "enable",
            json: true,
            view: "agent",
          },
          {
            resolveServiceManager: async () => serviceManager,
          }
        )
      ).rejects.toThrow("OpenMeld Service is not installed");

      expect(calls).toEqual(["status"]);
    });
  });

  it("returns reinstall result as a canonical JSON envelope with --json", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "9.9.9",
        pid: 123,
      })
    );
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: "started",
    });

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemonReinstallInTempHome(
        {
          json: true,
          profile: HUMAN_PROFILE_ID,
        },
        {
          daemonVersion: "9.9.9",
          teardown: teardownMock,
          runInstall: runInstallMock,
          runRun: runRunMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
          startAfterInstallMode: "always",
        }
      );
    });

    const envelope = parseJsonEnvelope(stdout, "daemon.reinstall") as
      | { schemaVersion?: number; ok?: boolean; result?: string }
      | undefined;
    expect(envelope?.schemaVersion).toBe(1);
    expect(envelope?.ok).toBe(true);
    expect(envelope?.result).toBe("completed");
  });

  it("keeps an existing background contract unchanged when install is already satisfied", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      });
      await upsertDaemonServiceContract({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: HUMAN_PROFILE_ID,
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      await runDaemonInstall({
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      });

      expect(await readDaemonServiceContract()).toMatchObject({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: false,
        profileId: HUMAN_PROFILE_ID,
      });
    });
  });

  it("runs reinstall flow with explicit background restore", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 123,
      })
    );
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    let reconcileLockHeld = false;
    const runRunMock = vi.fn().mockImplementation(() => {
      expect(reconcileLockHeld).toBe(false);
      return {
        ok: true,
        reason: "started",
      };
    });
    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "agent",
          profile: HUMAN_PROFILE_ID,
        },
        {
          teardown: teardownMock,
          runInstall: runInstallMock,
          runRun: runRunMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) => {
            reconcileLockHeld = true;
            try {
              return await callback();
            } finally {
              reconcileLockHeld = false;
            }
          },
          startAfterInstallMode: "always",
        }
      );

      expect(result).toEqual({
        ok: true,
        result: "completed",
        backupDataPath: null,
        desiredState: "background",
        forceUsed: false,
        serviceState: "running",
      });
    });

    expect(parseAgentResultEnvelope(stdout, "daemon.reinstall.result")).toEqual(
      {
        ok: true,
        result: "completed",
        backupDataPath: null,
        desiredState: "background",
        forceUsed: false,
        serviceState: "running",
      }
    );

    expect(runDaemonServiceLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredState: "stopped",
        expectedVersion: packageJson.version,
        forceKillAfterDrainTimeout: false,
        forceReinstall: false,
        installSource: "daemon.command.install",
        operation: "reinstall",
        shouldStartAfterLifecycle: false,
      })
    );
    expect(runRunMock).toHaveBeenCalledWith({
      agentOverviewHandled: true,
      entryChecksHandled: true,
      mode: "background",
      outputMode: "silent",
      suppressStartSpinner: true,
      view: "agent",
      gatewayUrl: undefined,
      profile: HUMAN_PROFILE_ID,
    });
  });

  it("retries a transient reinstall background start failure", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 123,
      })
    );
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "start_failed",
      })
      .mockResolvedValueOnce({
        ok: true,
        reason: "started",
      });

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "agent",
          profile: HUMAN_PROFILE_ID,
        },
        {
          teardown: teardownMock,
          runInstall: runInstallMock,
          runRun: runRunMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
          startAfterInstallMode: "always",
          startRetryDelayMs: 1,
        }
      );

      expect(result).toMatchObject({
        ok: true,
        result: "completed",
        serviceState: "running",
      });
    });

    expect(runRunMock).toHaveBeenCalledTimes(2);
    expect(parseAgentResultEnvelope(stdout, "daemon.reinstall.result")).toEqual(
      expect.objectContaining({
        ok: true,
        result: "completed",
        serviceState: "running",
      })
    );
  });

  it("does not immediately retry a confirmed local computer blocker", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 123,
      })
    );
    const runRunMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: "start_failed",
      startFailureVerdict: {
        controller: "launchd",
        detail: null,
        jobDiagnostics: null,
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
        message: "no space left on device",
      },
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        teardown: vi.fn().mockResolvedValue({
          removed: true,
          stopSignal: "SIGTERM",
          systemServiceController: null,
          systemServiceUninstalled: false,
        }),
        runInstall: vi.fn().mockResolvedValue(undefined),
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
        startAfterInstallMode: "always",
        startRetryDelayMs: 1,
      }
    );

    expect(runRunMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      result: "start_failed",
      startFailureVerdict: {
        localMachineIssue: {
          code: "local_machine.storage.exhausted",
        },
      },
    });
  });

  it("passes daemonVersion override through reinstall to install phase", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "9.9.9",
        pid: 123,
      })
    );
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: "started",
    });
    await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        daemonVersion: "9.9.9",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
        startAfterInstallMode: "always",
      }
    );

    expect(runDaemonServiceLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: "9.9.9",
      })
    );
  });

  it("treats reinstall auto-start service_already_running as a completed running service", async () => {
    let started = false;
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      started
        ? createAlignedRunningDaemonServiceInventory({
            daemonVersion: "0.2.2",
            pid: 456,
          })
        : createCleanDaemonServiceInventory()
    );
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockImplementation(() => {
      started = true;
      return {
        ok: true as const,
        reason: "service_already_running" as const,
      };
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result).toEqual({
      ok: true,
      result: "completed",
      backupDataPath: null,
      desiredState: "background",
      forceUsed: false,
      serviceState: "running",
    });
  });

  it("does not wait for local reply readiness after reinstall once the service is healthy", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 777,
      })
    );
    resolveCurrentReplyReadinessSnapshotMock
      .mockResolvedValueOnce(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["service.not_running"],
            reasonText: "OpenMeld Service is still starting on this device.",
            replyReadiness: "blocked",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
        })
      )
      .mockResolvedValueOnce(createReplyReadinessSnapshot());
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: "started",
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        verifyWaitMs: 500,
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result).toEqual({
      ok: true,
      result: "completed",
      backupDataPath: null,
      desiredState: "background",
      forceUsed: false,
      serviceState: "running",
    });
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
  });

  it("does not read reply-readiness snapshot during reinstall verification", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 778,
      })
    );
    resolveCurrentReplyReadinessSnapshotMock
      .mockRejectedValueOnce(new Error("snapshot unavailable"))
      .mockResolvedValueOnce(createReplyReadinessSnapshot());
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: "started",
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        verifyWaitMs: 500,
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result.result).toBe("completed");
    expect(resolveCurrentReplyReadinessSnapshotMock).not.toHaveBeenCalled();
  });

  it("propagates reinstall auto-start cancellation instead of reporting completion", async () => {
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: "cancelled",
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result).toEqual({
      ok: false,
      result: "cancelled",
    });
    expect(runRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ entryChecksHandled: true })
    );
  });

  it("maps reinstall auto-start cleanup_required to start_blocked", async () => {
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: "cleanup_required",
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result).toEqual({
      ok: false,
      result: "start_blocked",
      backupDataPath: null,
      blockReason: "cleanup_required",
      desiredState: "background",
      forceUsed: false,
    });
  });

  it("preserves reinstall auto-start auth-required as start_blocked", async () => {
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: false,
      reason: "authentication_required",
    });

    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        startAfterInstallMode: "always",
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result).toEqual({
      ok: false,
      result: "start_blocked",
      backupDataPath: null,
      blockReason: "authentication_required",
      desiredState: "background",
      forceUsed: false,
    });
  });

  it("captures a service evidence snapshot in agent view", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        const result = await runDaemonSnapshot({
          view: "agent",
        });

        expect(result).toEqual({
          evidencePath: "/tmp/openmeld-evidence/service-evidence-1",
          manifestPath:
            "/tmp/openmeld-evidence/service-evidence-1/manifest.json",
        });
      });

      expect(captureDaemonServiceEvidenceMock).toHaveBeenCalled();
      expect(
        parseAgentResultEnvelope(stdout, "daemon.snapshot.result")
      ).toEqual({
        evidencePath: "/tmp/openmeld-evidence/service-evidence-1",
        manifestPath: "/tmp/openmeld-evidence/service-evidence-1/manifest.json",
      });
    });
  });

  it("emits reinstall result envelope before unexpected-start diagnostics in agent view", async () => {
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi
      .fn()
      .mockRejectedValue(new Error("launchctl bootstrap failed"));

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "agent",
          profile: HUMAN_PROFILE_ID,
        },
        {
          skipConfirm: true,
          startAfterInstallMode: "always",
          startRetryDelayMs: 1,
          teardown: teardownMock,
          runInstall: runInstallMock,
          runRun: runRunMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
        }
      );

      expect(result).toEqual({
        ok: false,
        result: "start_failed",
        backupDataPath: null,
        desiredState: "background",
        failureStage: "reinstall-install",
        forceUsed: false,
      });
    });

    expect(parseAgentResultEnvelope(stdout, "daemon.reinstall.result")).toEqual(
      {
        ok: false,
        result: "start_failed",
        backupDataPath: null,
        desiredState: "background",
        failureStage: "reinstall-install",
        forceUsed: false,
      }
    );
  });

  it("blocks reinstall when the installed service is newer than the requested version", async () => {
    const teardownMock = vi.fn();
    const runInstallMock = vi.fn();

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "agent",
          profile: HUMAN_PROFILE_ID,
        },
        {
          daemonVersion: "1.0.0",
          teardown: teardownMock,
          runInstall: runInstallMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: "2.0.0",
              installSource: "daemon.command.install",
              installedAt: "2026-03-05T00:00:00.000Z",
              updatedAt: "2026-03-05T00:00:00.000Z",
            },
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
        }
      );

      expect(result).toEqual({
        ok: false,
        result: "downgrade_blocked",
        installedVersion: "2.0.0",
        requestedVersion: "1.0.0",
        upgradeCommand: "openmeld upgrade",
      });
    });

    const payload = parseAgentResultEnvelope(stdout, "daemon.reinstall.result");
    expect(payload?.ok).toBe(false);
    expect(payload?.result).toBe("downgrade_blocked");
    expect(payload?.installedVersion).toBe("2.0.0");
    expect(payload?.requestedVersion).toBe("1.0.0");
    expect(payload?.upgradeCommand).toBe("openmeld upgrade");
    expect(runInstallMock).not.toHaveBeenCalled();
    expect(teardownMock).not.toHaveBeenCalled();
  });

  it("allows force reinstall to continue when graceful drain times out", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 124,
      })
    );
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGKILL",
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: "started",
    });
    await runDaemonReinstallInTempHome(
      {
        view: "agent",
        force: true,
        profile: HUMAN_PROFILE_ID,
      },
      {
        teardown: teardownMock,
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(runDaemonServiceLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        forceKillAfterDrainTimeout: true,
      })
    );
  });

  it("returns a drain-timeout result when graceful drain times out and force is not set", async () => {
    runDaemonServiceLifecycleMock.mockRejectedValueOnce(
      new DaemonServiceLifecycleDrainTimeoutError(20_000)
    );
    const runInstallMock = vi.fn().mockResolvedValue(undefined);

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "agent",
          profile: HUMAN_PROFILE_ID,
        },
        {
          runInstall: runInstallMock,
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
        }
      );

      expect(result).toEqual({
        ok: false,
        result: "drain_timeout",
        forceRequired: true,
        waitMs: 20_000,
      });
    });

    const payload = parseAgentResultEnvelope(stdout, "daemon.reinstall.result");
    expect(payload).toMatchObject({
      ok: false,
      result: "drain_timeout",
      forceRequired: true,
      waitMs: 20_000,
    });
    expect(runInstallMock).not.toHaveBeenCalled();
  });

  it("returns a drain-timeout result in non-interactive mode when prompt_force cannot prompt", async () => {
    runDaemonServiceLifecycleMock.mockRejectedValueOnce(
      new DaemonServiceLifecycleDrainTimeoutError(20_000)
    );
    const result = await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        timeoutPolicy: "prompt_force",
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    );

    expect(result).toEqual({
      ok: false,
      result: "drain_timeout",
      forceRequired: true,
      waitMs: 20_000,
    });
  });

  it("renders packaged reinstall lifecycle failures with refresh guidance in human view", async () => {
    runDaemonServiceLifecycleMock.mockResolvedValueOnce({
      status: "failed",
      targetVersion: packageJson.version,
      inventoryBefore: createCleanDaemonServiceInventory(),
      inventoryAfter: null,
      reasonCodes: ["legacy_shared_service_present"],
      completedPhases: [
        "inspect",
        "backup",
        "stop_or_drain",
        "wait_stopped",
        "unregister",
        "verify_final_inventory",
      ],
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      backupDataPath: null,
      failureStage: "verify_final_inventory",
      evidencePath: "/tmp/openmeld-evidence/service-evidence-1",
      recoveryStatus: "failed_before_safe_state",
      errorCode: null,
      errorMessage:
        "Lifecycle verification failed because the service contract is missing.",
    });

    const error = await runDaemonReinstallInTempHome(
      {
        view: "human",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("OpenMeld Service repair failed");
    expect(String(error)).toContain("openmeld service repair");
    expect(String(error)).not.toContain("verify_final_inventory");
    expect(String(error)).not.toContain("service contract is missing");
  });

  it("shows the deliberate force recovery path when safe drain loses its control connection", async () => {
    runDaemonServiceLifecycleMock.mockResolvedValueOnce({
      status: "failed",
      targetVersion: packageJson.version,
      inventoryBefore: createCleanDaemonServiceInventory(),
      inventoryAfter: null,
      reasonCodes: [],
      completedPhases: ["inspect", "backup", "stop_or_drain"],
      desiredState: "background",
      shouldStartAfterLifecycle: true,
      backupDataPath: null,
      failureStage: "stop_or_drain",
      evidencePath: "/tmp/openmeld-evidence/service-control-missing",
      recoveryStatus: "failed_before_safe_state",
      errorCode: "daemon.control.endpoint_missing",
      errorMessage:
        "controlled service drain failed: daemon control endpoint is missing",
    });

    const error = await runDaemonReinstallInTempHome(
      {
        view: "human",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    ).catch((caught) => caught);

    expect(String(error)).toContain(
      "could not safely stop the existing Service because its control connection is missing"
    );
    expect(String(error)).toContain("openmeld service status");
    expect(String(error)).toContain("openmeld service repair --force");
    expect(String(error)).not.toContain("service-control-missing");
  });

  it("keeps service repair failure context visible for JSON diagnostics", async () => {
    runDaemonServiceLifecycleMock.mockResolvedValueOnce({
      status: "failed",
      targetVersion: packageJson.version,
      inventoryBefore: createCleanDaemonServiceInventory(),
      inventoryAfter: null,
      reasonCodes: ["runtime_bundle_mismatch"],
      completedPhases: [
        "inspect",
        "backup",
        "stop_or_drain",
        "wait_stopped",
        "unregister",
        "verify_final_inventory",
      ],
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      backupDataPath: null,
      failureStage: "verify_final_inventory",
      evidencePath: "/tmp/openmeld-evidence/service-evidence-json",
      recoveryStatus: "failed_before_safe_state",
      errorCode: null,
      errorMessage:
        "Lifecycle verification failed because the service contract is missing.",
    });

    const error = await runDaemonReinstallInTempHome(
      {
        json: true,
        view: "human",
        profile: HUMAN_PROFILE_ID,
      },
      {
        skipConfirm: true,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
      }
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("OpenMeld Service repair failed");
    expect(String(error)).toContain("service contract is missing");
    expect(String(error)).toContain("Failure stage: verify_final_inventory.");
    expect(String(error)).toContain(
      "Service evidence snapshot saved at /tmp/openmeld-evidence/service-evidence-json."
    );
  });

  it("does not leak lifecycle stages in human reinstall recovery cards", async () => {
    runDaemonServiceLifecycleMock.mockResolvedValueOnce({
      status: "stopped_safe",
      targetVersion: packageJson.version,
      inventoryBefore: createCleanDaemonServiceInventory(),
      inventoryAfter: createCleanDaemonServiceInventory(),
      reasonCodes: ["missing_required_contract_fields"],
      completedPhases: [
        "inspect",
        "backup",
        "stop_or_drain",
        "wait_stopped",
        "unregister",
        "wait_absent",
        "install_bundle",
        "write_contract",
      ],
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      backupDataPath: null,
      failureStage: "write_contract",
      evidencePath: "/tmp/openmeld-evidence/service-evidence-2",
      recoveryStatus: "stopped_safe_current_version",
      errorMessage:
        "OpenMeld Service contract cannot be written. reason=missing_required_contract_fields missingFields=profileId",
    });

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "human",
          profile: HUMAN_PROFILE_ID,
        },
        {
          skipConfirm: true,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
        }
      );

      expect(result.result).toBe("stopped_safe");
    });

    expect(stdout).toContain("OpenMeld Service was repaired");
    expect(stdout).not.toContain("write_contract");
    expect(stdout).not.toContain("missing_required_contract_fields");
    expect(stdout).not.toContain("service-evidence-2");
  });

  it("does not leak evidence paths in human reinstall start-failed cards", async () => {
    captureDaemonServiceEvidenceBestEffortMock.mockResolvedValueOnce(
      "/tmp/openmeld-evidence/service-evidence-start-failed"
    );
    const runRunMock = vi
      .fn()
      .mockRejectedValue(new Error("launchctl bootstrap failed"));

    const { stdout } = await withCapturedStdio(async () => {
      const result = await runDaemonReinstallInTempHome(
        {
          view: "human",
          profile: HUMAN_PROFILE_ID,
        },
        {
          skipConfirm: true,
          startAfterInstallMode: "always",
          startRetryDelayMs: 1,
          runRun: runRunMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
        }
      );

      expect(result.result).toBe("start_failed");
    });

    expect(stdout).toContain("OpenMeld Service Needs Attention");
    expect(stdout).not.toContain("OpenMeld Service Repaired");
    expect(stdout).not.toContain("service-evidence-start-failed");
    expect(stdout).not.toContain("reinstall-install");
    expect(stdout).not.toContain("verify_final_inventory");
  });

  it("retries with force when timeout policy is force", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedRunningDaemonServiceInventory({
        daemonVersion: "0.2.2",
        pid: 126,
      })
    );
    runDaemonServiceLifecycleMock
      .mockRejectedValueOnce(
        new DaemonServiceLifecycleDrainTimeoutError(20_000)
      )
      .mockImplementationOnce(async (input) => {
        const daemonVersion =
          input && typeof input === "object" && "expectedVersion" in input
            ? String(input.expectedVersion)
            : packageJson.version;
        await writeDaemonActiveBundleState({
          bundleId: "service-bundle",
          daemonVersion,
        });
        return createAlignedDaemonServiceLifecycleOutcome({
          inventoryBefore: createCleanDaemonServiceInventory(),
          inventoryAfter: createCleanDaemonServiceInventory({
            daemonVersion,
          }),
          targetVersion: daemonVersion,
        });
      });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockResolvedValue({
      ok: true,
      reason: "started",
    });
    await runDaemonReinstallInTempHome(
      {
        view: "agent",
        profile: HUMAN_PROFILE_ID,
      },
      {
        timeoutPolicy: "force",
        runInstall: runInstallMock,
        runRun: runRunMock,
        readDaemonStatus: vi.fn().mockResolvedValue({
          installed: false,
          state: null,
        }),
        withReconcileLock: async <T>(callback: () => Promise<T>) =>
          await callback(),
        startAfterInstallMode: "always",
      }
    );

    expect(runDaemonServiceLifecycleMock).toHaveBeenCalledTimes(2);
    expect(runDaemonServiceLifecycleMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        forceKillAfterDrainTimeout: false,
      })
    );
    expect(runDaemonServiceLifecycleMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        forceKillAfterDrainTimeout: true,
      })
    );
  });

  it("keeps reinstall deterministic and stopped by default when contract says stopped", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: HUMAN_PROFILE_ID,
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: null,
        systemServiceUninstalled: false,
      });
      const runInstallMock = vi.fn().mockResolvedValue(undefined);
      const runRunMock = vi.fn().mockResolvedValue({
        ok: true,
        reason: "started",
      });
      const { stdout } = await withCapturedStdio(async () => {
        const result = await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            teardown: teardownMock,
            runInstall: runInstallMock,
            runRun: runRunMock,
            readDaemonStatus: vi.fn().mockResolvedValue({
              installed: false,
              state: null,
            }),
            withReconcileLock: async <T>(callback: () => Promise<T>) =>
              await callback(),
          }
        );

        expect(result).toEqual({
          ok: true,
          backupDataPath: null,
          desiredState: "stopped",
          forceUsed: false,
          result: "completed",
          serviceState: "stopped",
        });
      });

      expect(stdout).toContain("OpenMeld Service Repaired But Not Running");
      expect(stdout).toContain(
        "Service files were repaired, but OpenMeld Service is still stopped."
      );
      expect(stdout).toContain(
        "Local Wake work will keep waiting until OpenMeld Service starts."
      );
      expect(stdout).toContain("Run `openmeld service start`");
      expect(stdout).not.toContain("No action is required.");
      expect(runRunMock).not.toHaveBeenCalled();
    });
  });

  it("marks agent repair completed stopped as not running and requiring start", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: HUMAN_PROFILE_ID,
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: null,
        systemServiceUninstalled: false,
      });
      const runInstallMock = vi.fn().mockResolvedValue(undefined);
      const runRunMock = vi.fn().mockResolvedValue({
        ok: true,
        reason: "started",
      });
      const { stdout } = await withCapturedStdio(async () => {
        const result = await runDaemonReinstall(
          {
            view: "agent",
          },
          {
            skipConfirm: true,
            teardown: teardownMock,
            runInstall: runInstallMock,
            runRun: runRunMock,
            readDaemonStatus: vi.fn().mockResolvedValue({
              installed: false,
              state: null,
            }),
            withReconcileLock: async <T>(callback: () => Promise<T>) =>
              await callback(),
          }
        );

        expect(result).toMatchObject({
          ok: true,
          result: "completed",
          desiredState: "stopped",
          serviceState: "stopped",
        });
      });

      expect(
        parseAgentResultEnvelope(stdout, "daemon.reinstall.result")
      ).toMatchObject({
        ok: true,
        result: "completed",
        desiredState: "stopped",
        serviceState: "stopped",
        operationalState: "not_running",
        requiresStart: true,
        nextSteps: ["openmeld service start --view agent"],
      });
      const payload = parseAgentResultEnvelope(
        stdout,
        "daemon.reinstall.result"
      );
      expect(payload?.message).toContain("still stopped");
      expect(payload?.message).toContain("Wake work will keep waiting");
      expect(runRunMock).not.toHaveBeenCalled();
    });
  });

  it("keeps update result copy aligned with the update command", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: HUMAN_PROFILE_ID,
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: null,
        systemServiceUninstalled: false,
      });
      const runInstallMock = vi.fn().mockResolvedValue(undefined);
      const runRunMock = vi.fn().mockResolvedValue({
        ok: true,
        reason: "started",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonReinstall(
          {
            displayAction: "update",
            view: "human",
          },
          {
            skipConfirm: true,
            teardown: teardownMock,
            runInstall: runInstallMock,
            runRun: runRunMock,
            readDaemonStatus: vi.fn().mockResolvedValue({
              installed: false,
              state: null,
            }),
            withReconcileLock: async <T>(callback: () => Promise<T>) =>
              await callback(),
          }
        );
      });

      expect(stdout).toContain("OpenMeld Service Updated");
      expect(stdout).toContain("Service files were updated");
      expect(stdout).not.toContain("OpenMeld Service Repaired");
      expect(stdout).not.toContain("was reinstalled");
      expect(stdout).not.toContain("refreshed");
      expect(runRunMock).not.toHaveBeenCalled();
    });
  });

  it("keeps stopped service contract identity device-scoped while refreshing the latest active bundle after reinstall", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "canary";
      let resolveRuntimeContextSpy: { mockRestore: () => void } | undefined;
      try {
        const runtimeContextModule = await import("../src/runtime/context");
        resolveRuntimeContextSpy = vi
          .spyOn(runtimeContextModule, "resolveRuntimeContext")
          .mockResolvedValue({
            viewMode: "auto",
            resolvedView: "agent",
            interactive: false,
            openMeldProfileId: AGENT_REINSTALL_RUNTIME_PROFILE_ID,
          });
        await upsertDaemonServiceContract({
          daemonVersion: packageJson.version,
          bundleId: "old-service-bundle",
          desiredState: "stopped",
          serviceController: "launchd",
          autoStart: false,
          gatewayUrl: "https://gateway.openmeld.invalid",
          profileId: HUMAN_PROFILE_ID,
          deviceId: "device_123",
          heartbeatMs: 5000,
          lane: "canary",
        });

        const teardownMock = vi.fn().mockResolvedValue({
          removed: true,
          stopSignal: "SIGTERM",
          systemServiceController: null,
          systemServiceUninstalled: false,
        });
        runDaemonServiceLifecycleMock.mockImplementationOnce(async (input) => {
          const daemonVersion =
            input && typeof input === "object" && "expectedVersion" in input
              ? String(input.expectedVersion)
              : packageJson.version;
          await writeDaemonActiveBundleState({
            bundleId: "fresh-service-bundle",
            daemonVersion,
            entryScriptRelativePath: "dist/openmeld-dev.js",
          });
          return createAlignedDaemonServiceLifecycleOutcome({
            inventoryBefore: createCleanDaemonServiceInventory(),
            inventoryAfter: createCleanDaemonServiceInventory({
              daemonVersion,
            }),
            targetVersion: daemonVersion,
          });
        });
        const runRunMock = vi.fn().mockResolvedValue({
          ok: true,
          reason: "started",
        });

        const result = await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            teardown: teardownMock,
            runRun: runRunMock,
            readDaemonStatus: vi.fn().mockResolvedValue({
              installed: false,
              state: null,
            }),
            withReconcileLock: async <T>(callback: () => Promise<T>) =>
              await callback(),
          }
        );

        expect(result).toEqual({
          ok: true,
          backupDataPath: null,
          desiredState: "stopped",
          forceUsed: false,
          result: "completed",
          serviceState: "stopped",
        });
        const contract = await readDaemonServiceContract();
        expect(contract).toMatchObject({
          daemonVersion: packageJson.version,
          bundleId: "fresh-service-bundle",
          desiredState: "stopped",
          autoStart: false,
          gatewayUrl: "https://gateway.openmeld.invalid",
          lane: "canary",
        });
        expect(contract).not.toHaveProperty("profileId");
        expect(runRunMock).not.toHaveBeenCalled();
      } finally {
        resolveRuntimeContextSpy?.mockRestore();
      }
    });
  });

  it("restores background by default when contract is missing but runtime is truly running in background", async () => {
    await withTempHome(async () => {
      let started = false;
      readCurrentDaemonRuntimeContextMock.mockResolvedValue({
        status: {
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.2.5",
            installSource: "daemon.command.install",
            installedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
        },
        runtimeStatus: {
          status: "running",
          mode: "background",
          pid: 123,
          startedAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
        serviceManager: null,
        serviceManagerStatus: {
          installed: true,
          running: true,
          enabled: true,
          commandSummary: "launcher",
        },
        legacySharedService: null,
        effectiveRuntimeStatus: "running",
      });
      inspectDaemonServiceInventoryMock.mockImplementation(async () =>
        started
          ? createAlignedRunningDaemonServiceInventory({
              daemonVersion: "0.2.5",
              pid: 123,
            })
          : createCleanDaemonServiceInventory()
      );

      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: null,
        systemServiceUninstalled: false,
      });
      const runInstallMock = vi.fn().mockResolvedValue(undefined);
      const runRunMock = vi.fn().mockImplementation(() => {
        started = true;
        return {
          ok: true,
          reason: "started",
        };
      });
      await runDaemonReinstall(
        {
          view: "agent",
        },
        {
          skipConfirm: true,
          teardown: teardownMock,
          runInstall: runInstallMock,
          runRun: runRunMock,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: async <T>(callback: () => Promise<T>) =>
            await callback(),
        }
      );

      expect(runRunMock).toHaveBeenCalledWith({
        agentOverviewHandled: true,
        entryChecksHandled: true,
        gatewayUrl: undefined,
        mode: "background",
        outputMode: "silent",
        profile: undefined,
        suppressStartSpinner: true,
        view: "agent",
      });
    });
  });

  it("keeps local service stop from rewriting service contract identity from a runtime profile", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      let resolveRuntimeContextSpy: { mockRestore: () => void } | undefined;
      try {
        const runtimeContextModule = await import("../src/runtime/context");
        resolveRuntimeContextSpy = vi
          .spyOn(runtimeContextModule, "resolveRuntimeContext")
          .mockResolvedValue({
            viewMode: "auto",
            resolvedView: "human",
            interactive: false,
            openMeldProfileId: AGENT_STOP_RUNTIME_PROFILE_ID,
          });

        await upsertDaemonServiceContract({
          daemonVersion: packageJson.version,
          bundleId: "stop-contract-bundle",
          desiredState: "background",
          serviceController: "launchd",
          autoStart: true,
          gatewayUrl: "https://staging.openmeld.invalid",
          profileId: "22222222-2222-4222-8222-222222222222",
          deviceId: "device_stop",
          heartbeatMs: 5000,
          lane: "dev-local",
        });

        await withCapturedStdio(async () => {
          await runDaemonStop({
            view: "human",
          });
        });

        const contract = await readDaemonServiceContract();
        expect(contract).toMatchObject({
          daemonVersion: packageJson.version,
          bundleId: "stop-contract-bundle",
          desiredState: "stopped",
          autoStart: false,
          gatewayUrl: "https://staging.openmeld.invalid",
          deviceId: "device_stop",
          lane: "dev-local",
        });
        expect(contract).not.toHaveProperty("profileId");
      } finally {
        resolveRuntimeContextSpy?.mockRestore();
      }
    });
  });

  it("keeps explicit install profile out of service contract identity", async () => {
    await withTempHome(async () => {
      let resolveRuntimeContextSpy: { mockRestore: () => void } | undefined;
      try {
        const runtimeContextModule = await import("../src/runtime/context");
        resolveRuntimeContextSpy = vi
          .spyOn(runtimeContextModule, "resolveRuntimeContext")
          .mockResolvedValue({
            viewMode: "auto",
            resolvedView: "agent",
            interactive: false,
            openMeldProfileId: AGENT_RUNTIME_FALLBACK_PROFILE_ID,
          });

        await upsertDaemonServiceContract({
          daemonVersion: "0.2.1",
          bundleId: "legacy-contract-bundle",
          desiredState: "stopped",
          serviceController: "legacy-detached",
          autoStart: false,
          gatewayUrl: "https://staging.openmeld.invalid",
          profileId: EXISTING_CONTRACT_PROFILE_ID,
          deviceId: "device_install",
          heartbeatMs: 5000,
          lane: "prod",
        });

        await withCapturedStdio(async () => {
          await runDaemonInstall({
            view: "agent",
            profile: AGENT_EXPLICIT_INSTALL_PROFILE_ID,
          });
        });

        const contract = await readDaemonServiceContract();
        expect(contract).toMatchObject({
          daemonVersion: packageJson.version,
          bundleId: "service-bundle",
          desiredState: "stopped",
          autoStart: false,
          gatewayUrl: "https://staging.openmeld.invalid",
          deviceId: "device_install",
          profileId: AGENT_EXPLICIT_INSTALL_PROFILE_ID,
        });
      } finally {
        resolveRuntimeContextSpy?.mockRestore();
      }
    });
  });

  it("installs service files without resolving a current Agent Profile identity", async () => {
    await withTempHome(async () => {
      let resolveRuntimeContextSpy: { mockRestore: () => void } | undefined;
      let resolveOpenMeldProfileSpy: { mockRestore: () => void } | undefined;
      try {
        const runtimeContextModule = await import("../src/runtime/context");
        resolveRuntimeContextSpy = vi
          .spyOn(runtimeContextModule, "resolveRuntimeContext")
          .mockResolvedValue({
            viewMode: "auto",
            resolvedView: "human",
            interactive: false,
          });
        const resolveOpenMeldProfileModule = await import(
          "../src/config/resolve-openmeld-profile"
        );
        resolveOpenMeldProfileSpy = vi
          .spyOn(resolveOpenMeldProfileModule, "resolveOpenMeldProfileOrNull")
          .mockImplementation((input?: { openMeldProfileId?: string }) => {
            if (!input?.openMeldProfileId) {
              return Promise.reject(new Error("current profile lookup failed"));
            }
            return Promise.resolve({
              openMeldProfileId: input.openMeldProfileId,
              profileHandle: "existing-contract",
              profileName: "Existing Contract Profile",
              profileKind: "human",
              status: "active",
              ownerUserId: "user-felix",
              ownerName: "Felix",
              source: "cli_test",
              createdByUserId: "user-felix",
              lastUsedAt: null,
              createdAt: "2026-03-05T00:00:00.000Z",
              updatedAt: "2026-03-05T00:00:00.000Z",
            });
          });

        await upsertDaemonServiceContract({
          daemonVersion: "0.2.1",
          bundleId: "legacy-contract-bundle",
          desiredState: "stopped",
          serviceController: "legacy-detached",
          autoStart: false,
          gatewayUrl: "https://staging.openmeld.invalid",
          profileId: EXISTING_CONTRACT_PROFILE_ID,
          deviceId: "device_install",
          heartbeatMs: 5000,
          lane: "prod",
        });

        await withCapturedStdio(async () => {
          await runDaemonInstall({
            view: "human",
          });
        });
        expect(resolveOpenMeldProfileSpy).not.toHaveBeenCalled();
        const contract = await readDaemonServiceContract();
        expect(contract).toMatchObject({
          bundleId: "service-bundle",
          desiredState: "stopped",
          deviceId: "device_install",
        });
        expect(contract).not.toHaveProperty("profileId");
      } finally {
        resolveOpenMeldProfileSpy?.mockRestore();
        resolveRuntimeContextSpy?.mockRestore();
      }
    });
  });

  it("rebuilds a missing background contract without copying runtime openMeldProfileId into service identity", async () => {
    await withTempHome(async () => {
      let started = false;
      let resolveRuntimeContextSpy: { mockRestore: () => void } | undefined;
      try {
        const runtimeContextModule = await import("../src/runtime/context");
        resolveRuntimeContextSpy = vi
          .spyOn(runtimeContextModule, "resolveRuntimeContext")
          .mockResolvedValue({
            viewMode: "auto",
            resolvedView: "agent",
            interactive: false,
            openMeldProfileId: AGENT_REINSTALL_RUNTIME_PROFILE_ID,
          });

        readCurrentDaemonRuntimeContextMock.mockResolvedValue({
          status: {
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: packageJson.version,
              installSource: "daemon.command.install",
              installedAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
            },
          },
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 321,
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          serviceManager: null,
          serviceManagerStatus: {
            installed: true,
            running: true,
            enabled: true,
            commandSummary: "launcher",
          },
          legacySharedService: null,
          effectiveRuntimeStatus: "running",
        });
        inspectDaemonServiceInventoryMock.mockImplementation(async () =>
          started
            ? createAlignedRunningDaemonServiceInventory({
                daemonVersion: packageJson.version,
                pid: 321,
              })
            : createCleanDaemonServiceInventory()
        );

        const teardownMock = vi.fn().mockResolvedValue({
          removed: true,
          stopSignal: "SIGTERM",
          systemServiceController: null,
          systemServiceUninstalled: false,
        });
        const runRunMock = vi.fn().mockImplementation(() => {
          started = true;
          return {
            ok: true,
            reason: "started",
          };
        });

        const result = await runDaemonReinstall(
          {
            view: "agent",
          },
          {
            skipConfirm: true,
            teardown: teardownMock,
            runRun: runRunMock,
            readDaemonStatus: vi.fn().mockResolvedValue({
              installed: false,
              state: null,
            }),
            withReconcileLock: async <T>(callback: () => Promise<T>) =>
              await callback(),
          }
        );

        expect(result).toEqual({
          ok: true,
          backupDataPath: null,
          desiredState: "background",
          forceUsed: false,
          result: "completed",
          serviceState: "running",
        });
        const contract = await readDaemonServiceContract();
        expect(contract).toMatchObject({
          daemonVersion: packageJson.version,
          bundleId: "service-bundle",
          desiredState: "background",
          autoStart: true,
        });
        expect(contract).not.toHaveProperty("profileId");
        expect(contract?.serviceController).not.toBe("unknown");
      } finally {
        resolveRuntimeContextSpy?.mockRestore();
      }
    });
  });

  it("returns not_installed uninstall envelope when teardown reports no removal", async () => {
    await withTempHome(async () => {
      const teardownMock = vi.fn().mockResolvedValue({
        removed: false,
        stopSignal: null,
        systemServiceController: null,
        systemServiceUninstalled: false,
      });

      const output = await withCapturedStdio(async () => {
        await runDaemonUninstall(
          {
            view: "agent",
          },
          {
            teardown: teardownMock,
          }
        );
      });
      const payload = parseAgentResultEnvelope(
        output.stdout,
        "daemon.uninstall.result"
      );
      expect(payload?.status).toBe("not_installed");
    });
  });

  it("escalates from SIGTERM to SIGKILL for non-system runtime in strict teardown", async () => {
    const stopDaemonProcessMock = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const getDaemonRuntimeStatusMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: "running",
        mode: "background",
        pid: process.pid,
        startedAt: "2026-03-04T00:00:00.000Z",
        updatedAt: "2026-03-04T00:00:00.000Z",
        managedBySystemService: false,
        serviceController: "legacy-detached",
        autoStart: false,
      })
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: false,
        serviceController: "unknown",
        autoStart: false,
      })
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: false,
        serviceController: "unknown",
        autoStart: false,
      });

    const result = await runDaemonTeardownStrict(
      {
        reason: "service_uninstall",
      },
      {
        withRegistrationMutationLock: async (callback) => await callback(),
        getDaemonStatus: vi.fn().mockResolvedValue({
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.2",
            installSource: "daemon.command.install",
            installedAt: "2026-03-04T00:00:00.000Z",
            updatedAt: "2026-03-04T00:00:00.000Z",
          },
        }),
        readCurrentObservedDaemonRuntimeStatus: getDaemonRuntimeStatusMock,
        resolveDaemonServiceManagerForRuntimeState: vi.fn().mockResolvedValue({
          serviceManager: null,
          serviceManagerStatus: null,
        }),
        clearDaemonServiceRuntimeState: vi.fn().mockResolvedValue(undefined),
        listDaemonOwnedProcesses: vi.fn().mockResolvedValue([]),
        stopDaemonProcess: stopDaemonProcessMock,
        waitForSystemServiceToStop: vi.fn().mockResolvedValue(true),
        uninstallDaemon: vi.fn().mockResolvedValue({
          removed: true,
        }),
      }
    );

    expect(result.stopSignal).toBe("SIGKILL");
    expect(stopDaemonProcessMock).toHaveBeenNthCalledWith(
      1,
      process.pid,
      "SIGTERM"
    );
    expect(stopDaemonProcessMock).toHaveBeenNthCalledWith(
      2,
      process.pid,
      "SIGKILL"
    );
  });

  it("fails strict teardown when system service remains installed after uninstall", async () => {
    vi.useFakeTimers();
    try {
      const systemManager = {
        controller: "launchd" as const,
        install: vi.fn(),
        uninstall: vi.fn().mockResolvedValue(undefined),
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        waitUntilAbsent: vi.fn().mockResolvedValue(undefined),
        waitUntilStopped: vi.fn().mockResolvedValue(undefined),
        waitUntilRunning: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({
          installed: true,
          running: false,
          enabled: false,
        }),
      };

      const resultPromise = runDaemonTeardownStrict(
        {
          reason: "reset",
        },
        {
          withRegistrationMutationLock: async (callback) => await callback(),
          getDaemonStatus: vi.fn().mockResolvedValue({
            installed: true,
            state: {
              v: 1,
              schema: "openmeld-daemon-install-v1",
              daemonVersion: "0.1.2",
              installSource: "daemon.command.install",
              installedAt: "2026-03-04T00:00:00.000Z",
              updatedAt: "2026-03-04T00:00:00.000Z",
            },
          }),
          readCurrentObservedDaemonRuntimeStatus: vi
            .fn()
            .mockResolvedValueOnce({
              status: "running",
              mode: "background",
              pid: null,
              startedAt: "2026-03-04T00:00:00.000Z",
              updatedAt: "2026-03-04T00:00:00.000Z",
              managedBySystemService: true,
              serviceController: "launchd",
              autoStart: true,
            })
            .mockResolvedValueOnce({
              status: "not_running",
              mode: null,
              pid: null,
              startedAt: null,
              updatedAt: null,
              managedBySystemService: false,
              serviceController: "unknown",
              autoStart: false,
            })
            .mockResolvedValueOnce({
              status: "not_running",
              mode: null,
              pid: null,
              startedAt: null,
              updatedAt: null,
              managedBySystemService: false,
              serviceController: "unknown",
              autoStart: false,
            }),
          resolveDaemonServiceManagerForRuntimeState: vi
            .fn()
            .mockResolvedValue({
              serviceManager: systemManager,
              serviceManagerStatus: {
                installed: true,
                running: true,
                enabled: true,
              },
            }),
          clearDaemonServiceRuntimeState: vi.fn().mockResolvedValue(undefined),
          stopDaemonProcess: vi.fn().mockResolvedValue(true),
          waitForSystemServiceToStop: vi.fn().mockResolvedValue(true),
          uninstallDaemon: vi.fn().mockResolvedValue({
            removed: true,
          }),
        }
      );

      const expectation = expect(resultPromise).rejects.toThrow(
        "system service still present after uninstall"
      );
      await vi.advanceTimersByTimeAsync(16_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears stale runtime state during strict teardown when only a dead runtime lease remains", async () => {
    const clearDaemonServiceRuntimeStateMock = vi
      .fn()
      .mockResolvedValue(undefined);

    const result = await runDaemonTeardownStrict(
      {
        reason: "service_uninstall",
      },
      {
        withRegistrationMutationLock: async (callback) => await callback(),
        getDaemonStatus: vi.fn().mockResolvedValue({
          installed: true,
          state: {
            v: 1,
            schema: "openmeld-daemon-install-v1",
            daemonVersion: "0.1.2",
            installSource: "daemon.command.install",
            installedAt: "2026-03-04T00:00:00.000Z",
            updatedAt: "2026-03-04T00:00:00.000Z",
          },
        }),
        readCurrentObservedDaemonRuntimeStatus: vi
          .fn()
          .mockResolvedValueOnce({
            status: "stale",
            mode: "background",
            pid: 41_024,
            startedAt: "2026-03-04T00:00:00.000Z",
            updatedAt: "2026-03-04T00:00:00.000Z",
            managedBySystemService: false,
            serviceController: "legacy-detached",
            autoStart: false,
            reason: "process_not_alive",
          })
          .mockResolvedValueOnce({
            status: "stale",
            mode: "background",
            pid: 41_024,
            startedAt: "2026-03-04T00:00:00.000Z",
            updatedAt: "2026-03-04T00:00:00.000Z",
            managedBySystemService: false,
            serviceController: "legacy-detached",
            autoStart: false,
            reason: "process_not_alive",
          })
          .mockResolvedValueOnce({
            status: "stale",
            mode: "background",
            pid: 41_024,
            startedAt: "2026-03-04T00:00:00.000Z",
            updatedAt: "2026-03-04T00:00:00.000Z",
            managedBySystemService: false,
            serviceController: "legacy-detached",
            autoStart: false,
            reason: "process_not_alive",
          })
          .mockResolvedValueOnce({
            status: "not_running",
            mode: null,
            pid: null,
            startedAt: null,
            updatedAt: null,
            managedBySystemService: false,
            serviceController: "unknown",
            autoStart: false,
          }),
        resolveDaemonServiceManagerForRuntimeState: vi.fn().mockResolvedValue({
          serviceManager: null,
          serviceManagerStatus: null,
        }),
        clearDaemonServiceRuntimeState: clearDaemonServiceRuntimeStateMock,
        stopDaemonProcess: vi.fn().mockResolvedValue(true),
        waitForSystemServiceToStop: vi.fn().mockResolvedValue(true),
        listDaemonOwnedProcesses: vi.fn().mockResolvedValue([]),
        uninstallDaemon: vi.fn().mockResolvedValue({
          removed: true,
        }),
      }
    );

    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      removed: true,
      stopSignal: null,
      systemServiceController: null,
      systemServiceUninstalled: false,
    });
  });

  it("includes runtime auto-fix report in agent-view service status payload", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });
      const report = {
        schema: "daemon.runtime.contract.repair.report",
        v: 1,
        status: "applied",
        reason: "contract_epoch_mismatch",
        fromEpoch: "daemon-runtime-epoch-2026-02-20",
        toEpoch: "daemon-runtime-epoch-2026-03-04",
        appliedAt: "2026-03-04T00:00:00.000Z",
        cleanedPaths: ["/tmp/one"],
        backupPaths: ["/tmp/one.bak"],
        errorMessage: null,
      };
      await writeFile(
        daemonRuntimeContractRepairReportPath(),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "agent",
        });
      });

      const payload = parseAgentResultEnvelope(stdout, "daemon.status.result");
      expect(payload?.runtimeContractRepair?.status).toBe("applied");
      expect(payload?.runtimeContractRepair?.reason).toBe(
        "contract_epoch_mismatch"
      );
      expect("autoHeal" in (payload ?? {})).toBe(false);
    });
  });

  it("emits fast local service status before full agent-view status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "agent",
        });
      });

      const localResultIndex = stdout.indexOf(
        '"code":"daemon.status.local_result"'
      );
      const fullResultIndex = stdout.indexOf('"code":"daemon.status.result"');
      expect(localResultIndex).toBeGreaterThanOrEqual(0);
      expect(fullResultIndex).toBeGreaterThan(localResultIndex);

      const localPayload = parseAgentResultEnvelope(
        stdout,
        "daemon.status.local_result"
      );
      const fullPayload = parseAgentResultEnvelope(
        stdout,
        "daemon.status.result"
      ) as {
        daemonRouteObservation?: unknown;
        deviceReplyReadiness?: unknown;
        diagnostics?: {
          localServiceDiagnostics?: {
            deviceEvidence?: unknown;
          };
        };
      } | null;

      expect(localPayload?.statusScope).toBe("local_service");
      expect(localPayload?.installed).toBe(true);
      expect(localPayload?.environmentTarget).toBeDefined();
      expect(localPayload?.runtime).toBeDefined();
      expect(localPayload).not.toHaveProperty("deviceReplyReadiness");
      expect(localPayload).not.toHaveProperty("daemonRouteObservation");
      expect(fullPayload).not.toHaveProperty("deviceReplyReadiness");
      expect(
        fullPayload?.diagnostics?.localServiceDiagnostics?.deviceEvidence
      ).toBeDefined();
      expect(fullPayload?.daemonRouteObservation).toBeDefined();
    });
  });

  it("prints one JSON object for machine-readable service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          json: true,
          view: "agent",
        });
      });

      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);

      const payload = JSON.parse(lines[0] ?? "") as {
        cliVersion?: { currentVersion?: string; latestVersion?: string | null };
        type?: string;
        localResult?: { statusScope?: string; environmentTarget?: unknown };
        result?: { diagnostics?: unknown; daemonRouteObservation?: unknown };
        runtimeProjection?: unknown;
      };
      expect(payload.type).toBe("daemon.status");
      expect(payload.cliVersion?.currentVersion).toBe(packageJson.version);
      expect(payload.cliVersion).toHaveProperty("latestVersion");
      expect(payload.localResult?.statusScope).toBe("local_service");
      expect(payload.localResult?.environmentTarget).toBeDefined();
      expect(payload.result?.diagnostics).toBeDefined();
      expect(payload.result?.daemonRouteObservation).toBeDefined();
      expect(payload).toHaveProperty("runtimeProjection");
    });
  });

  it("adds an unavailable serverRequirement block to machine-readable service status when signed out, without touching existing fields", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          json: true,
          view: "agent",
        });
      });

      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);

      const payload = JSON.parse(lines[0] ?? "") as {
        cliVersion?: { currentVersion?: string; latestVersion?: string | null };
        type?: string;
        serverRequirement?: {
          available?: boolean;
          reason?: string;
          detail?: string | null;
        };
      };
      // Existing fields are untouched (additive change only).
      expect(payload.type).toBe("daemon.status");
      expect(payload.cliVersion?.currentVersion).toBe(packageJson.version);
      expect(payload.cliVersion).toHaveProperty("latestVersion");
      // New field degrades explicitly instead of being silently absent or
      // looking like an "aligned" result.
      expect(payload.serverRequirement).toEqual({
        available: false,
        detail: null,
        reason: "signed_out",
      });
    });
  });

  it("includes the live server-required version visor in serverRequirement when signed in", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-server-requirement",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        tokenType: "Bearer",
        user: {
          email: "mira@openmeld.invalid",
          id: "user-mira",
          name: "Mira",
        },
      });

      const replyReadinessBody = {
        canReplyFromThisComputer: true,
        currentTarget: { availability: "missing" },
        generatedAt: "2026-07-10T12:00:00.000Z",
        localComponents: {
          agentSetupCommand:
            "npm install -g openmeld@latest && openmeld setup --view agent",
          cli: {
            commandContractVersion: "test-contract-v1",
            installedPackageVersion: "0.2.20",
            latestPackageVersion: "0.2.21",
            reasonCodes: ["cli.package_update_available"],
            requiredCommandContractVersion: "test-contract-v1",
            status: "update_required",
            updatePolicy: "required",
            wakeBlocked: false,
          },
          generatedAt: "2026-07-10T12:00:00.000Z",
          humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
          schemaVersion: 1,
          service: {
            installedVersion: "0.2.20",
            latestVersion: "0.2.21",
            reasonCodes: ["service.version_outdated"],
            requiredVersion: "0.2.21",
            status: "update_required",
            updatePolicy: "required",
            wakeBlocked: true,
          },
          setupAction: "update_service",
          setupActionDescription:
            "Update OpenMeld Service through setup on this computer.",
          setupActionLabel: "Update OpenMeld Service",
          skills: {
            expectedBundleHash: "abc123",
            expectedTargetCount: 1,
            installedBundleHash: "abc123",
            reasonCodes: [],
            skillContractVersion:
              "openmeld-skills-contract-2026-05-required-v1",
            status: "current",
            targetCount: 1,
            updatePolicy: "required",
            wakeBlocked: false,
          },
        },
        message: "No local runtime is registered for this account yet.",
        nextAction: "run_setup",
        primaryBlocker: "current_runtime_missing",
        runtime: {
          deviceDisplayName: null,
          deviceId: null,
          executionTargetStatus: null,
          lastObservedAtMs: null,
          reasonCodes: [],
          runtimeLane: null,
          openMeldServiceRuntimeId: null,
        },
        service: {
          connected: false,
          executionCompatibility: null,
          matchingCurrentRuntime: false,
          reasonCodes: [],
          sessionDeviceId: null,
          sessionLane: null,
        },
        status: "blocked",
      };

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: string | URL | Request) => {
          const url = String(input);
          if (url.includes("/v1/local-runtimes/current/reply-readiness")) {
            return Promise.resolve(
              new Response(JSON.stringify(replyReadinessBody), {
                headers: { "content-type": "application/json" },
                status: 200,
              })
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ service: "openmeld-gateway" }), {
              headers: { "content-type": "application/json" },
              status: 200,
            })
          );
        });

      try {
        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonStatus({
            json: true,
            view: "agent",
          });
        });

        const lines = stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        expect(lines).toHaveLength(1);

        const payload = JSON.parse(lines[0] ?? "") as {
          cliVersion?: { currentVersion?: string };
          serverRequirement?: {
            available?: boolean;
            cli?: { latestPackageVersion?: string; status?: string };
            service?: { requiredVersion?: string; status?: string };
            verdict?: { cli?: { kind?: string }; service?: { kind?: string } };
          };
        };
        // Existing field untouched.
        expect(payload.cliVersion?.currentVersion).toBe(packageJson.version);
        // New field: server visor for both components, passed through verbatim
        // from the (mocked) real projection, plus a computed verdict.
        expect(payload.serverRequirement?.available).toBe(true);
        expect(payload.serverRequirement?.cli).toMatchObject({
          latestPackageVersion: "0.2.21",
          status: "update_required",
        });
        expect(payload.serverRequirement?.service).toMatchObject({
          requiredVersion: "0.2.21",
          status: "update_required",
        });
        expect(payload.serverRequirement?.verdict?.service?.kind).toBe(
          "update_required"
        );
        expect(payload.serverRequirement?.verdict?.cli?.kind).toBeDefined();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  it("uses the shared gateway chain probe timeout for service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });

      await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "agent",
        });
      });

      expect(resolveCurrentReplyReadinessSnapshotMock).toHaveBeenCalledWith(
        expect.objectContaining({
          checkGatewayChain: true,
          gatewayChainTimeoutMs: 30_000,
        })
      );
    });
  });

  it("does not run mutating startup preflight while reading service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });

      await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(runDaemonStartupPreflightMock).not.toHaveBeenCalled();
    });
  });

  it("hides automatic repair row in human service status when no repair report exists", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).not.toContain("Automatic Repair");
    });
  });

  it("puts OpenMeld Service and runtime first in human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["service.not_running"],
            reasonText: "OpenMeld Service is not running on this device",
            replyReadiness: "blocked",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
        })
      );
      const daemonServiceInventoryModule = await import(
        "../src/local-service/lifecycle/daemon-service-inventory"
      );
      const inspectInventorySpy = vi
        .spyOn(daemonServiceInventoryModule, "inspectDaemonServiceInventory")
        .mockResolvedValue(createCleanDaemonServiceInventory());

      try {
        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonStatus({
            view: "human",
          });
        });

        expect(stdout).toContain("OpenMeld Service");
        expect(stdout).toContain("Runtime");
        expect(stdout).toContain("OpenMeld Connection");
        expect(stdout).not.toContain("Reply Route");
        expect(stdout).not.toContain("Daemon Route");
        expect(stdout).toContain(
          "OpenMeld Service: ⛔ Not running — OpenMeld Service is not running on this device"
        );
        expect(stdout).toContain(
          "Status is read-only. It does not change OpenMeld Service."
        );
        expect(stdout).toContain("Runtime Details: status unavailable");

        const runningIndex = stdout.indexOf("OpenMeld Service");
        const installedIndex = stdout.indexOf("Installed");
        expect(runningIndex).toBeGreaterThanOrEqual(0);
        expect(installedIndex).toBeGreaterThan(runningIndex);
        expect(stdout).not.toContain("Runtime control");
      } finally {
        inspectInventorySpy.mockRestore();
      }
    });
  });

  it("does not show OpenMeld Connection as checking when service status is ready without an agent profile route lookup", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonRouteObservation: {
            detail:
              "No OpenMeld profile was selected for a server route lookup.",
            observedAt: "2026-03-10T00:00:00.000Z",
            profileId: null,
            reasonCode: "profile_not_selected",
            route: null,
            status: "unavailable",
          },
          deviceReplyReadiness: {
            reasonCodes: [],
            reasonText:
              "This device is ready for Space replies from local agent profiles",
            replyReadiness: "ready",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 1,
          },
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 222,
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain("OpenMeld Service: ✅ Running");
      expect(stdout).toContain("OpenMeld Connection: 🟢 Connected");
      expect(stdout).not.toContain("OpenMeld Connection: ⚪ Checking");
    });
  });

  it("does not present route online as connected when local participation needs repair", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonRouteObservation: {
            detail: null,
            observedAt: "2026-03-10T00:00:00.000Z",
            profileId: "agt-demo",
            reasonCode: "online",
            route: {
              online: true,
              daemonSessionId: "session-1",
              deviceId: "device-1",
              lane: "dev-local",
              connectionGeneration: 1,
              leaseEpoch: 1,
              lastHeartbeatMs: 1,
              capabilities: {},
              executionCompatibility: {
                expectedEpoch: "daemon-runtime-epoch-test",
                observedEpoch: "daemon-runtime-epoch-test",
                reasonCode: "daemon.runtime_contract.compatible",
                status: "compatible",
              },
            },
            status: "online",
          },
          deviceReplyReadiness: {
            reasonCodes: ["service.gateway_chain_unhealthy"],
            reasonText: "Gateway auth chain is unhealthy.",
            replyReadiness: "blocked",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 222,
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
          displayRuntimeStatus: {
            status: "running",
            mode: "background",
            pid: 222,
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain("Runtime: 🟢 Running");
      expect(stdout).toContain("OpenMeld Service: ⚠️ Needs repair");
      expect(stdout).toContain(
        "OpenMeld Connection: 🟡 Route online; local participation needs repair"
      );
      expect(stdout).not.toContain("OpenMeld Connection: 🟢 Connected");
    });
  });

  it("points agent-profile service status repair to service start when OpenMeld Service is not running", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["service.not_running"],
            reasonText: "OpenMeld Service is not running on this device",
            replyReadiness: "blocked",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
          agentReplyReadiness: {
            deviceReplyReadiness: {
              reasonCodes: ["service.not_running"],
              reasonText: "OpenMeld Service is not running on this device",
              replyReadiness: "blocked",
              updatedAt: "2026-03-10T00:00:00.000Z",
              wakeableRouteCount: 0,
            },
            profileId: "agt-demo",
            reasonCodes: ["service.not_running"],
            reasonText: "OpenMeld Service is not running on this device",
            replyReadiness: "blocked",
            transportMode: "local-cli",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
        })
      );
      const daemonServiceInventoryModule = await import(
        "../src/local-service/lifecycle/daemon-service-inventory"
      );
      const inspectInventorySpy = vi
        .spyOn(daemonServiceInventoryModule, "inspectDaemonServiceInventory")
        .mockResolvedValue(createCleanDaemonServiceInventory());

      try {
        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonStatus({
            view: "human",
          });
        });

        expect(stdout).toContain(
          "Run `openmeld service start` to start OpenMeld Service."
        );
        expect(stdout).not.toContain("Current Agent Reply Readiness");
        expect(stdout).not.toContain("This profile can reply from Space");
        expect(stdout).not.toContain(
          "openmeld service status --profile agt-demo"
        );
        expect(stdout).not.toContain("openmeld setup --profile agt-demo");
        expect(stdout).not.toContain("then `openmeld service run` to start it");
      } finally {
        inspectInventorySpy.mockRestore();
      }
    });
  });

  it("does not expose stale runtime reason codes in human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      const staleRuntimeStatus = {
        status: "stale" as const,
        mode: null,
        pid: 123,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: false,
        serviceController: "unknown" as const,
        autoStart: false,
        reason: "runtime_lease_missing",
      };
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          inventory: {
            ...createCleanDaemonServiceInventory(),
            runtimeStatus: staleRuntimeStatus,
            anomalies: [
              {
                code: "runtime_stale",
                message: "Runtime state is stale (runtime_lease_missing).",
              },
            ],
          },
          runtimeStatus: staleRuntimeStatus,
          deviceReplyReadiness: {
            reasonCodes: ["service.not_running"],
            reasonText: "OpenMeld Service is reconnecting on this device",
            replyReadiness: "degraded",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain(
        "OpenMeld Service is reconnecting on this device"
      );
      expect(stdout).not.toContain("runtime_lease_missing");
      expect(stdout).not.toContain("Runtime note");
      expect(stdout).not.toContain("state file is behind runtime manager");
    });
  });

  it("keeps profile workspace facts out of human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          agentReplyReadiness: {
            deviceReplyReadiness: {
              reasonCodes: [],
              reasonText:
                "This device is ready for Space replies from local agent profiles",
              replyReadiness: "ready",
              updatedAt: "2026-03-10T00:00:00.000Z",
              wakeableRouteCount: 1,
            },
            profileId: "agt-demo",
            reasonCodes: [],
            reasonText: "This profile can reply from Space when mentioned",
            replyReadiness: "ready",
            transportMode: "local-cli",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
          profileWorkspaceRuntimeResolution: {
            configPath: "/tmp/local-meta.json",
            configuredWorkspacePath: "/tmp/service-status-workspace",
            effectiveRuntimeWorkingDirectory: "/tmp/service-status-workspace",
            runtimeContext: {
              providerRuntimeWorkingDirectory: "/tmp/service-status-workspace",
            },
            status: "ready",
            workspaceMode: "custom",
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).not.toContain("Workspace: Custom");
      expect(stdout).not.toContain("Workspace Type: Custom");
      expect(stdout).not.toContain(
        "Workspace Folder: /tmp/service-status-workspace"
      );
      expect(stdout).not.toContain(
        "Current Working Folder: /tmp/service-status-workspace"
      );
      expect(stdout).not.toContain("Current Agent Reply Readiness");
      expect(stdout).not.toContain(
        "This device is ready for Space replies from local agent profiles"
      );
      expect(stdout).not.toContain("This profile can reply from Space");
      expect(stdout).not.toContain("Agent Ready");
    });
  });

  it("does not present local agent setup evidence as human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          deviceReplyReadiness: {
            reasonCodes: ["controller.launch.needs_repair"],
            reasonText:
              "OpenMeld can't start one or more local agents on this device yet",
            replyReadiness: "blocked",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain(
        "OpenMeld Service: ⚠️ Needs repair — OpenMeld Service needs attention on this device."
      );
      expect(stdout).not.toContain(
        "OpenMeld can't start one or more local agents on this device yet"
      );
      expect(stdout).not.toContain("Agent Ready");
      expect(stdout).not.toContain("can reply from Space");
    });
  });

  it("shows owner path and last service change in human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      await emitDaemonLifecycleEvent({
        type: "lifecycle.command.end",
        result: "completed",
        command: "openmeld service stop",
        intent: "stop",
      });

      const serviceManagerStatus = {
        installed: true,
        running: true,
        enabled: true,
        definitionPath: "/tmp/com.openmeld.openmeld-background-service.plist",
        commandSummary:
          "node /tmp/current-cli/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
      } as const;
      const serviceManager = {
        controller: "launchd",
        install: async () => undefined,
        uninstall: async () => undefined,
        enableAutostart: async () => undefined,
        disableAutostart: async () => undefined,
        start: async () => undefined,
        stop: async () => undefined,
        deactivate: async () => undefined,
        waitUntilAbsent: async () => undefined,
        waitUntilStopped: async () => undefined,
        waitUntilRunning: async () => undefined,
        status: async () => serviceManagerStatus,
      } as const;
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          inventory: {
            ...createCleanDaemonServiceInventory(),
            runtimeStatus: {
              status: "running",
              mode: "foreground",
              pid: 222,
              startedAt: "2026-03-10T00:00:00.000Z",
              updatedAt: "2026-03-10T00:00:00.000Z",
              managedBySystemService: false,
              serviceController: "unknown",
              autoStart: false,
            },
            serviceManager,
            serviceManagerStatus,
            ownedProcesses: [
              {
                pid: 222,
                parentPid: 1,
                command:
                  "node /tmp/current-cli/dist/openmeld.js service run --mode foreground",
                mode: "foreground",
                ownership: "cli_direct",
              },
            ],
            anomalies: [
              {
                code: "multiple_active_owners",
                message:
                  "Multiple OpenMeld Service owners are active on this device: Direct CLI + System service.",
              },
            ],
          },
          runtimeStatus: {
            status: "running",
            mode: "foreground",
            pid: 222,
            startedAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            managedBySystemService: false,
            serviceController: "unknown",
            autoStart: false,
          },
          serviceManagerStatus,
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain(
        "Owner Path: ⚠️ Multiple owners — Direct CLI + System service"
      );
      expect(stdout).toContain(
        "Last Service Change: completed stop from openmeld service stop"
      );
    });
  });

  it("identifies the current lane and local data in human service status", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      await runDaemonInstall({
        view: "human",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain(
        "Current Lane: openmeld-dev — repo-local development"
      );
      expect(stdout).toContain(`Local Data: ${process.env.OPENMELD_HOME}`);
    });
  });

  it("shows authentication-required guidance from the latest connection state", async () => {
    await withTempHome(async () => {
      await emitDaemonLifecycleEvent({
        type: "connection.state",
        result: "authentication_required",
        command: "openmeld service run",
        intent: "run_background",
        metadata: {
          authState: "expired",
          detail: "connecting without credentials, session=expired",
          reason: "auth_rejected",
        },
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain("expired session");
      expect(stdout).toContain("openmeld auth login");
      expect(stdout).toContain("openmeld service repair");
    });
  });

  it("shows a service dependency warning in human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      resolveDaemonServiceDependencyDiagnosticsMock.mockResolvedValue({
        applicable: true,
        ready: false,
        lane: "dev-local",
        scopePolicy: "loopback_only",
        issues: [
          {
            kind: "auth",
            baseUrl: "http://localhost:8788",
            probeUrl: "http://localhost:8788/health",
            scope: "loopback",
            status: "unreachable",
            httpStatus: null,
          },
          {
            kind: "gateway",
            baseUrl: "http://localhost:8080",
            probeUrl: "http://localhost:8080/health",
            scope: "loopback",
            status: "unreachable",
            httpStatus: null,
          },
        ],
        checkedUrls: {
          auth: "http://localhost:8788",
          gateway: "http://localhost:8080",
        },
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain("Attention");
      expect(stdout).toContain(
        "OpenMeld dev-local auth and gateway are unavailable"
      );
      expect(stdout).toContain("http://localhost:8788");
      expect(stdout).toContain("http://localhost:8080");
      expect(stdout).toContain("pnpm dev");
      expect(stdout).toContain("openmeld service status");
      expect(stdout).not.toContain("openmeld service reinstall");
    });
  });

  it("shows service dependency attention in human service status even when service is not installed", async () => {
    await withTempHome(async () => {
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          daemonStatus: {
            installed: false,
            state: null,
          },
          deviceReplyReadiness: {
            reasonCodes: ["service.not_installed"],
            reasonText:
              "OpenMeld Service must be installed before this computer can receive local Wake work",
            replyReadiness: "blocked",
            updatedAt: "2026-03-10T00:00:00.000Z",
            wakeableRouteCount: 0,
          },
        })
      );
      resolveDaemonServiceDependencyDiagnosticsMock.mockResolvedValue({
        applicable: true,
        ready: false,
        lane: "dev-local",
        scopePolicy: "loopback_only",
        issues: [
          {
            kind: "auth",
            baseUrl: "http://localhost:8788",
            probeUrl: "http://localhost:8788/health",
            scope: "loopback",
            status: "unreachable",
            httpStatus: null,
          },
        ],
        checkedUrls: {
          auth: "http://localhost:8788",
          gateway: "http://localhost:8080",
        },
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain(
        "OpenMeld Service: ⛔ Not installed — install OpenMeld Service so this computer can receive local Wake work"
      );
      expect(stdout).toContain("Runtime: ⚪ Unknown");
      expect(stdout).toContain("Attention");
      expect(stdout).toContain("OpenMeld dev-local auth is unavailable");
      expect(stdout).toContain("pnpm dev");
      expect(stdout).toContain("service install");
    });
  });

  it("includes a service dependency warning in agent-view service status payload", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });
      resolveDaemonServiceDependencyDiagnosticsMock.mockResolvedValue({
        applicable: true,
        ready: false,
        lane: "dev-local",
        scopePolicy: "loopback_only",
        issues: [
          {
            kind: "gateway",
            baseUrl: "http://localhost:8080",
            probeUrl: "http://localhost:8080/health",
            scope: "loopback",
            status: "unreachable",
            httpStatus: null,
          },
        ],
        checkedUrls: {
          auth: "http://localhost:8788",
          gateway: "http://localhost:8080",
        },
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "agent",
        });
      });

      const payload = parseAgentResultEnvelope(
        stdout,
        "daemon.status.result"
      ) as {
        attention?: {
          code?: string;
          message?: string;
          nextStep?: string | null;
        };
      } | null;
      expect(payload?.attention?.code).toBe("service_dependencies_unavailable");
      expect(payload?.attention?.message).toContain("http://localhost:8080");
      expect(payload?.attention?.nextStep).toContain("pnpm dev");
    });
  });

  it("includes unified workspace facts in agent-view service status payload", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "agent",
      });
      resolveCurrentReplyReadinessSnapshotMock.mockResolvedValue(
        createReplyReadinessSnapshot({
          agentReplyReadiness: {
            deviceReplyReadiness: {
              reasonCodes: [],
              reasonText:
                "This device is ready for Space replies from local agent profiles",
              replyReadiness: "ready",
              updatedAt: "2026-03-10T00:00:00.000Z",
              wakeableRouteCount: 1,
            },
            profileId: "agt-demo",
            reasonCodes: [],
            reasonText: "This profile can reply from Space when mentioned",
            replyReadiness: "ready",
            transportMode: "local-cli",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
          profileWorkspaceRuntimeResolution: {
            configPath: "/tmp/local-meta.json",
            configuredWorkspacePath: "/tmp/agent-status-workspace",
            effectiveRuntimeWorkingDirectory: "/tmp/agent-status-workspace",
            runtimeContext: {
              providerRuntimeWorkingDirectory: "/tmp/agent-status-workspace",
            },
            status: "ready",
            workspaceMode: "openmeld_managed",
          },
        })
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "agent",
        });
      });

      const payload = parseAgentResultEnvelope(
        stdout,
        "daemon.status.result"
      ) as {
        agentReplyReadiness?: unknown;
        deviceReplyReadiness?: unknown;
        diagnostics?: {
          localServiceDiagnostics?: {
            agentEvidence?: {
              profileId?: string;
              replyReadiness?: string;
            } | null;
            deviceEvidence?: {
              replyReadiness?: string;
            };
            scope?: string;
            source?: string;
            meaning?: string;
          };
        };
        currentProfileWorkspace?: {
          workspace?: string;
          workspaceSource?: string;
          configuredWorkspace?: string | null;
          effectiveRuntimeWorkingDirectory?: string | null;
        } | null;
      } | null;

      expect(payload?.currentProfileWorkspace).toMatchObject({
        workspace: "OpenMeld-managed",
        workspaceSource: "OpenMeld-managed",
        configuredWorkspace: "/tmp/agent-status-workspace",
        effectiveRuntimeWorkingDirectory: "/tmp/agent-status-workspace",
      });
      expect(payload?.agentReplyReadiness).toBeUndefined();
      expect(payload?.deviceReplyReadiness).toBeUndefined();
      expect(payload?.diagnostics?.localServiceDiagnostics).toMatchObject({
        source: "local_service_diagnostics",
        scope: "diagnostic_only",
        authoritative: false,
        verdict: "not_wake_readiness",
        meaning:
          "Diagnostic-only local service evidence. It can explain local problems, but it is not the final Wake availability verdict and not a Space Wake outcome. Use daemonRouteObservation for current route evidence and service trace for a concrete Wake delivery.",
        useInstead: ["daemonRouteObservation", "openmeld service trace"],
        deviceEvidence: { replyReadiness: "ready" },
        agentEvidence: {
          profileId: "agt-demo",
          replyReadiness: "ready",
        },
      });
    });
  });

  it("includes the resolved OpenMeld environment target in agent-view service status", async () => {
    await withTempHome(async () => {
      const previousPreset = process.env.OPENMELD_ENV_PRESET;
      const previousGateway = process.env.OPENMELD_GATEWAY_URL;
      const previousAuth = process.env.OPENMELD_AUTH_URL;
      try {
        process.env.OPENMELD_ENV_PRESET = "canary";
        process.env.OPENMELD_GATEWAY_URL = "";
        process.env.OPENMELD_AUTH_URL = "";

        await runDaemonInstall({
          view: "agent",
        });

        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonStatus({
            view: "agent",
          });
        });

        const payload = parseAgentResultEnvelope(
          stdout,
          "daemon.status.result"
        ) as {
          environmentTarget?: {
            preset?: string;
            gatewayUrl?: string;
            authBaseUrl?: string;
            userFacingCommand?: string;
          };
        } | null;

        expect(payload?.environmentTarget).toEqual({
          preset: "canary",
          gatewayUrl: "http://localhost:8080",
          authBaseUrl: "http://localhost:8788",
          userFacingCommand: "openmeld-canary",
        });
      } finally {
        process.env.OPENMELD_ENV_PRESET = previousPreset;
        if (previousGateway === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_GATEWAY_URL");
        } else {
          process.env.OPENMELD_GATEWAY_URL = previousGateway;
        }
        if (previousAuth === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_AUTH_URL");
        } else {
          process.env.OPENMELD_AUTH_URL = previousAuth;
        }
      }
    });
  });

  it("reuses recorded dependency failure state for canary service status", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_ENV_PRESET = "canary";
      try {
        await runDaemonInstall({
          view: "agent",
        });
        readDaemonStartFailureStateMock.mockResolvedValue({
          schema: "daemon.start.failure.state",
          v: 1,
          recordedAt: "2026-03-16T00:00:00.000Z",
          reason: "service_dependencies_unavailable",
          detail:
            "OpenMeld gateway is unavailable at `https://gateway.openmeld.invalid`.",
          rawLogLine: "error: fetch failed",
          dependencyIssues: [
            {
              kind: "gateway",
              baseUrl: "https://gateway.openmeld.invalid",
              probeUrl: "https://gateway.openmeld.invalid/health",
              scope: "remote",
              status: "unreachable",
              httpStatus: null,
            },
          ],
          lane: "canary",
        });

        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonStatus({
            view: "agent",
          });
        });

        const payload = parseAgentResultEnvelope(
          stdout,
          "daemon.status.result"
        ) as {
          attention?: {
            code?: string;
            message?: string;
            nextStep?: string | null;
          };
        } | null;
        expect(payload?.attention?.code).toBe(
          "service_dependencies_unavailable"
        );
        expect(payload?.attention?.message).toContain(
          "https://gateway.openmeld.invalid"
        );
        expect(payload?.attention?.nextStep).toContain(
          "openmeld service start --mode foreground"
        );
      } finally {
        process.env.OPENMELD_ENV_PRESET = undefined;
      }
    });
  });

  it("shows login-first next step when service is installed before sign-in", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonInstall({
          view: "human",
        });
      });

      expect(stdout).toContain("OpenMeld Service Installed");
      expect(stdout).toContain(
        "Run `openmeld login` first, then `openmeld service start` to start OpenMeld Service in the background."
      );
      expect(stdout).toContain(
        "Local agent setup is waiting for you to sign in. Run `openmeld login` first."
      );
    });
  });

  it("shows automatic repair success in plain language in human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      const report = {
        schema: "daemon.runtime.contract.repair.report",
        v: 1,
        status: "applied",
        reason: "contract_epoch_mismatch",
        fromEpoch: "daemon-runtime-epoch-2026-02-20",
        toEpoch: "daemon-runtime-epoch-2026-03-04",
        appliedAt: "2026-03-04T00:00:00.000Z",
        cleanedPaths: ["/tmp/one"],
        backupPaths: ["/tmp/one.bak"],
        errorMessage: null,
      };
      await writeFile(
        daemonRuntimeContractRepairReportPath(),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain("Automatic Repair");
      expect(stdout).toContain(
        "OpenMeld fixed a local service issue automatically"
      );
      expect(stdout).toContain("2026-03-04T00:00:00.000Z");
      expect(stdout).toContain("No action needed.");
    });
  });

  it("shows automatic repair failure guidance in human service status", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      const report = {
        schema: "daemon.runtime.contract.repair.report",
        v: 1,
        status: "failed",
        reason: "legacy_state_without_meta",
        fromEpoch: null,
        toEpoch: "daemon-runtime-epoch-2026-03-04",
        appliedAt: "2026-03-04T00:00:00.000Z",
        cleanedPaths: ["/tmp/one"],
        backupPaths: ["/tmp/one.bak"],
        errorMessage: "write failed",
      };
      await writeFile(
        daemonRuntimeContractRepairReportPath(),
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).toContain("Automatic Repair");
      expect(stdout).toContain(
        "OpenMeld could not finish repairing a local service issue"
      );
      expect(stdout).toContain("2026-03-04T00:00:00.000Z");
      expect(stdout).toContain("openmeld service repair");
    });
  });

  it("hides automatic repair row when the repair report file is malformed", async () => {
    await withTempHome(async () => {
      await runDaemonInstall({
        view: "human",
      });
      await writeFile(
        daemonRuntimeContractRepairReportPath(),
        "{bad-json",
        "utf8"
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonStatus({
          view: "human",
        });
      });

      expect(stdout).not.toContain("Automatic Repair");
    });
  });
});

function parseJsonEnvelope(
  stdout: string,
  type: string
): Record<string, unknown> | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { type?: string };
      if (parsed.type === type) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return undefined;
}

function createFakeServiceManager(
  status: DaemonServiceManagerRuntimeStatus,
  calls: string[]
): DaemonServiceManager {
  const record = (call: string): Promise<void> => {
    calls.push(call);
    return Promise.resolve();
  };

  return {
    controller: "launchd",
    install: () => record("install"),
    uninstall: () => record("uninstall"),
    enableAutostart: () => {
      calls.push("enableAutostart");
      status.enabled = true;
      return Promise.resolve();
    },
    disableAutostart: () => {
      calls.push("disableAutostart");
      status.enabled = false;
      return Promise.resolve();
    },
    start: () => {
      calls.push("start");
      status.running = true;
      status.enabled = true;
      return Promise.resolve();
    },
    stop: () => {
      calls.push("stop");
      status.running = false;
      status.enabled = false;
      return Promise.resolve();
    },
    deactivate: () => {
      calls.push("deactivate");
      status.running = false;
      return Promise.resolve();
    },
    status: () => {
      calls.push("status");
      return Promise.resolve({ ...status });
    },
    waitUntilAbsent: () => record("waitUntilAbsent"),
    waitUntilStopped: () => record("waitUntilStopped"),
    waitUntilRunning: () => record("waitUntilRunning"),
  };
}

function parseAgentResultEnvelope(
  stdout: string,
  code: string
):
  | (Record<string, unknown> & {
      ok?: boolean;
      backupDataPath?: string | null;
      daemonRouteObservation?: unknown;
      deviceReplyReadiness?: unknown;
      environmentTarget?: unknown;
      evidencePath?: string | null;
      desiredState?: string;
      forceUsed?: boolean;
      installed?: boolean;
      inventory?: unknown;
      manifestPath?: string | null;
      reason?: string;
      result?: string;
      message?: string;
      nextSteps?: string[];
      operationalState?: string;
      requiresStart?: boolean;
      runtime?: unknown;
      serviceState?: string;
      statusScope?: string;
      status?: string;
      installedVersion?: string;
      requestedVersion?: string;
      upgradeCommand?: string;
      state?: { daemonVersion?: string };
      runtimeProjection?: {
        status?: string;
      };
      runtimeContractRepair?: {
        status?: string;
        reason?: string;
      };
    })
  | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        code?: string;
        payload?: unknown;
      };
      if (parsed.type !== "result" || parsed.code !== code) {
        continue;
      }
      if (!parsed.payload || typeof parsed.payload !== "object") {
        return null;
      }
      return parsed.payload as {
        status?: string;
        state?: { daemonVersion?: string };
      };
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return null;
}

function createCleanDaemonServiceInventory(input?: {
  daemonVersion?: string;
}): DaemonServiceInventory {
  const daemonVersion = input?.daemonVersion ?? packageJson.version;
  return {
    expectedVersion: daemonVersion,
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion,
        installSource: "daemon.command.install",
        installedAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
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
    legacySharedService: null,
    activeBundle: null,
    activeBundleSourceAvailable: null,
    activeBundleEntryPath: null,
    runtimeCommandEntryPath: null,
    runtimeCommandPathExists: null,
    serviceManager: null,
    serviceManagerStatus: null,
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
  };
}

function createAlignedDaemonServiceLifecycleOutcome(input?: {
  targetVersion?: string;
  inventoryBefore?: DaemonServiceInventory;
  inventoryAfter?: DaemonServiceInventory;
}) {
  return {
    status: "aligned" as const,
    targetVersion: input?.targetVersion ?? packageJson.version,
    inventoryBefore:
      input?.inventoryBefore ?? createCleanDaemonServiceInventory(),
    inventoryAfter:
      input?.inventoryAfter ?? createCleanDaemonServiceInventory(),
    reasonCodes: [],
    completedPhases: [
      "inspect",
      "backup",
      "stop_or_drain",
      "wait_stopped",
      "unregister",
      "wait_absent",
      "install_bundle",
      "write_contract",
      "register_service",
      "restore_runtime_data",
      "verify_final_inventory",
    ],
    desiredState: "stopped" as const,
    shouldStartAfterLifecycle: false,
    backupDataPath: null,
    errorMessage: null,
  };
}

async function writeDaemonActiveBundleState(input: {
  bundleId: string;
  daemonVersion: string;
  entryScriptRelativePath?: string;
}): Promise<void> {
  await mkdir(dirname(daemonServiceActiveBundlePath()), {
    recursive: true,
  });
  await writeFile(
    daemonServiceActiveBundlePath(),
    `${JSON.stringify(
      {
        v: 2,
        schema: "openmeld-daemon-active-bundle-v2",
        bundleId: input.bundleId,
        daemonVersion: input.daemonVersion,
        entryScriptRelativePath:
          input.entryScriptRelativePath ?? "dist/openmeld.js",
        bundleFormat: "self_contained_v1",
        sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
        sourcePackageRootPath: "/tmp/current-cli",
        sourceDistRootPath: "/tmp/current-cli/dist",
        sourceKind: "package_install",
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function createReplyReadinessSnapshot(
  overrides: Partial<CurrentReplyReadinessSnapshot> = {}
): CurrentReplyReadinessSnapshot {
  return {
    daemonRouteObservation: {
      detail: "No OpenMeld profile was selected for a server route lookup.",
      observedAt: "2026-03-10T00:00:00.000Z",
      profileId: null,
      reasonCode: "profile_not_selected",
      route: null,
      status: "unavailable",
    },
    observedAt: "2026-03-10T00:00:00.000Z",
    daemonStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: packageJson.version,
        installSource: "daemon.command.install",
        installedAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
    },
    inventory: null,
    runtimeProjection: null,
    runtimeStatus: null,
    displayRuntimeStatus: null,
    serviceManagerStatus: null,
    gatewayChainReadiness: null,
    deviceReplyReadiness: {
      reasonCodes: [],
      reasonText:
        "This device is ready for Space replies from local agent profiles",
      replyReadiness: "ready",
      updatedAt: "2026-03-10T00:00:00.000Z",
      wakeableRouteCount: 1,
    },
    agentReplyReadiness: null,
    openClawLocalDiagnostics: null,
    profileWorkspaceRuntimeResolution: null,
    ...overrides,
  };
}

function createAlignedRunningDaemonServiceInventory(input: {
  daemonVersion: string;
  pid: number;
}): DaemonServiceInventory {
  return {
    expectedVersion: input.daemonVersion,
    installStatus: {
      installed: true,
      state: {
        v: 1,
        schema: "openmeld-daemon-install-v1",
        daemonVersion: input.daemonVersion,
        installSource: "daemon.command.install",
        installedAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
    },
    runtimeStatus: {
      status: "running",
      mode: "background",
      pid: input.pid,
      startedAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    legacySharedService: null,
    activeBundle: {
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: "service-bundle",
      daemonVersion: input.daemonVersion,
      entryScriptRelativePath: "dist/openmeld.js",
      bundleFormat: "self_contained_v1",
      sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
      sourcePackageRootPath: "/tmp/current-cli",
      sourceDistRootPath: "/tmp/current-cli/dist",
      sourceKind: "package_install",
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    activeBundleSourceAvailable: null,
    activeBundleEntryPath:
      "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
    runtimeCommandPathExists: true,
    serviceManager: null,
    serviceManagerStatus: {
      installed: true,
      running: true,
      enabled: true,
      commandSummary:
        "node /tmp/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
      definitionPath:
        "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
    },
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
  };
}
