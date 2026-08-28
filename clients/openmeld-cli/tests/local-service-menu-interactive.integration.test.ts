import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import { OpenMeldLockError } from "../src/config/lock";
import {
  buildDaemonStartDecisionPromptConfig,
  buildDaemonStartDeferredCard,
  getDaemonStartStartedTitle,
} from "../src/system/local-service-start-decision";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const {
  canUseInteractivePromptsMock,
  cancelMock,
  confirmMock,
  getAuthSessionStateMock,
  getDaemonRuntimeStatusMock,
  readCurrentDaemonRuntimeContextMock,
  readCurrentObservedDaemonRuntimeStatusMock,
  readDaemonStartFailureStateMock,
  resolveOpenMeldProfileOrNullMock,
  getDaemonStatusMock,
  inspectDaemonServiceInventoryMock,
  isCancelMock,
  maybeAutoStopIdleLocalServiceMock,
  prepareDaemonServiceBundleMock,
  runDaemonServiceLifecycleMock,
  resolveDaemonServiceDependencyDiagnosticsMock,
  resolveLocalServiceDemandMock,
  resolveAlignedDaemonActiveBundleEntryPathMock,
  resolveDaemonServiceManagerMock,
  syncDeviceRuntimeStateProjectionMock,
  spinnerMock,
  selectMock,
} = vi.hoisted(() => ({
  canUseInteractivePromptsMock: vi.fn(() => true),
  cancelMock: vi.fn(),
  confirmMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  getDaemonRuntimeStatusMock: vi.fn(),
  readCurrentDaemonRuntimeContextMock: vi.fn(),
  readCurrentObservedDaemonRuntimeStatusMock: vi.fn(),
  readDaemonStartFailureStateMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  inspectDaemonServiceInventoryMock: vi.fn(),
  isCancelMock: vi.fn((value: unknown) => value === "__cancel__"),
  maybeAutoStopIdleLocalServiceMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  runDaemonServiceLifecycleMock: vi.fn(),
  resolveDaemonServiceDependencyDiagnosticsMock: vi.fn(),
  resolveLocalServiceDemandMock: vi.fn(),
  resolveAlignedDaemonActiveBundleEntryPathMock: vi.fn(),
  resolveDaemonServiceManagerMock: vi.fn(),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
  spinnerMock: vi.fn(),
  selectMock: vi.fn(),
}));

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("@clack/prompts", () => ({
  cancel: cancelMock,
  confirm: confirmMock,
  isCancel: (value: unknown) => isCancelMock(value),
  select: selectMock,
  spinner: spinnerMock,
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: vi.fn(async ({ view }: { view?: string } = {}) => ({
    viewMode: "auto",
    resolvedView: view ?? "human",
    interactive: true,
  })),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: canUseInteractivePromptsMock,
}));

vi.mock("../src/config/resolve-openmeld-profile", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/resolve-openmeld-profile")
  >("../src/config/resolve-openmeld-profile");
  return {
    ...actual,
    resolveOpenMeldProfileOrNull: (
      ...args: Parameters<typeof resolveOpenMeldProfileOrNullMock>
    ) => resolveOpenMeldProfileOrNullMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    cleanupDaemonServiceRuntimeState: vi.fn().mockResolvedValue(undefined),
    getDaemonRuntimeStatus: getDaemonRuntimeStatusMock,
    getDaemonStatus: getDaemonStatusMock,
    withDaemonServiceRunLock: vi.fn(
      async (callback: () => Promise<unknown>) => await callback()
    ),
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

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-runtime")
  >("../src/local-service/lifecycle/daemon-service-runtime");
  return {
    ...actual,
    readCurrentDaemonRuntimeContext: (...args: unknown[]) =>
      readCurrentDaemonRuntimeContextMock(...args),
    readCurrentObservedDaemonRuntimeStatus: (...args: unknown[]) =>
      readCurrentObservedDaemonRuntimeStatusMock(...args),
    resolveDaemonRuntimeState: async (status: { installed: boolean }) => {
      if (!status.installed) {
        return null;
      }
      return await readCurrentObservedDaemonRuntimeStatusMock(status);
    },
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-bundle")
  >("../src/local-service/lifecycle/daemon-service-bundle");
  return {
    ...actual,
    prepareDaemonServiceBundle: prepareDaemonServiceBundleMock,
    resolveAlignedDaemonActiveBundleEntryPath:
      resolveAlignedDaemonActiveBundleEntryPathMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-lifecycle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-lifecycle")
  >("../src/local-service/lifecycle/daemon-service-lifecycle");
  return {
    ...actual,
    runDaemonServiceLifecycle: (
      ...args: Parameters<typeof runDaemonServiceLifecycleMock>
    ) => runDaemonServiceLifecycleMock(...args),
  };
});

vi.mock("../src/local-service/state/daemon-start-failure-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/state/daemon-start-failure-state")
  >("../src/local-service/state/daemon-start-failure-state");
  return {
    ...actual,
    readDaemonStartFailureState: (
      ...args: Parameters<typeof readDaemonStartFailureStateMock>
    ) => readDaemonStartFailureStateMock(...args),
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
      resolveDaemonServiceDependencyDiagnostics: (
        ...args: Parameters<
          typeof resolveDaemonServiceDependencyDiagnosticsMock
        >
      ) => resolveDaemonServiceDependencyDiagnosticsMock(...args),
    };
  }
);

vi.mock(
  "../src/local-service/reporting/device-runtime-state-sync",
  async () => {
    const actual = await vi.importActual<
      typeof import("../src/local-service/reporting/device-runtime-state-sync")
    >("../src/local-service/reporting/device-runtime-state-sync");
    return {
      ...actual,
      syncDeviceRuntimeStateProjection: (
        ...args: Parameters<typeof syncDeviceRuntimeStateProjectionMock>
      ) => syncDeviceRuntimeStateProjectionMock(...args),
    };
  }
);

vi.mock("../src/local-service/lifecycle/local-service-demand", () => ({
  maybeAutoStopIdleLocalService: maybeAutoStopIdleLocalServiceMock,
  resolveLocalServiceDemand: resolveLocalServiceDemandMock,
}));

import {
  runDaemon,
  runDaemonReinstall,
  runDaemonStatusFlow,
} from "../src/commands/service";

const INSTALLED_DAEMON_STATUS = {
  installed: true,
  state: {
    v: 1,
    schema: "openmeld-daemon-install-v1",
    daemonVersion: packageJson.version,
    installSource: "daemon.command.install",
    installedAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
  },
} as const;

const NOT_RUNNING_RUNTIME_STATUS = {
  status: "not_running",
  mode: null,
  pid: null,
  startedAt: null,
  updatedAt: null,
  managedBySystemService: false,
  serviceController: "legacy-detached",
  autoStart: false,
} as const;

const RUNNING_RUNTIME_STATUS = {
  status: "running",
  mode: "background",
  pid: 4321,
  startedAt: "2026-03-06T00:00:00.000Z",
  updatedAt: "2026-03-06T00:00:00.000Z",
  managedBySystemService: true,
  serviceController: "launchd",
  autoStart: true,
} as const;

describe("openmeld service interactive menu", () => {
  beforeEach(() => {
    canUseInteractivePromptsMock.mockReset();
    canUseInteractivePromptsMock.mockReturnValue(true);
    cancelMock.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    getDaemonRuntimeStatusMock
      .mockReset()
      .mockResolvedValue(NOT_RUNNING_RUNTIME_STATUS);
    resolveOpenMeldProfileOrNullMock.mockReset().mockResolvedValue(null);
    readCurrentDaemonRuntimeContextMock.mockReset().mockResolvedValue({
      status: {
        installed: false,
        state: null,
      },
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
      serviceManager: null,
      serviceManagerStatus: null,
      legacySharedService: null,
      effectiveRuntimeStatus: "not_running",
    });
    readCurrentObservedDaemonRuntimeStatusMock
      .mockReset()
      .mockImplementation(async () => await getDaemonRuntimeStatusMock());
    readDaemonStartFailureStateMock.mockReset().mockResolvedValue(null);
    getDaemonStatusMock.mockReset();
    isCancelMock.mockReset().mockImplementation((value: unknown) => {
      return value === "__cancel__";
    });
    resolveDaemonServiceManagerMock.mockReset();
    resolveDaemonServiceManagerMock.mockResolvedValue(null);
    maybeAutoStopIdleLocalServiceMock.mockReset().mockResolvedValue({
      autoStopped: false,
      effectiveRuntimeStatus: "not_running",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: true,
        repairableReplyCandidateCount: 0,
        reason: "local execution routes are available",
        localExecutionRouteCount: 1,
        projection: null,
      },
    });
    resolveLocalServiceDemandMock.mockReset().mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: true,
      repairableReplyCandidateCount: 0,
      reason: "local execution routes are available",
      localExecutionRouteCount: 1,
      projection: null,
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
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue(undefined);
    runDaemonServiceLifecycleMock
      .mockReset()
      .mockResolvedValue(createAlignedDaemonLifecycleOutcome());
    resolveAlignedDaemonActiveBundleEntryPathMock
      .mockReset()
      .mockResolvedValue(
        "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js"
      );
    syncDeviceRuntimeStateProjectionMock.mockReset().mockResolvedValue({
      status: "ok",
      mode: "check",
      projectedControllerIds: [],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "No local agents on this device need OpenMeld Service right now",
    });
    selectMock.mockReset();
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue({
      expectedVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
      installStatus: INSTALLED_DAEMON_STATUS,
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
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
    });
    spinnerMock.mockReset().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      error: vi.fn(),
      message: vi.fn(),
      clear: vi.fn(),
      isCancelled: false,
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows status without offering to start the service right after status", async () => {
    const installMock = vi.fn().mockResolvedValue(undefined);
    let started = false;
    const startMock = vi.fn().mockImplementation(() => {
      started = true;
    });
    const statusMock = vi.fn().mockResolvedValue({
      installed: true,
      enabled: true,
      running: true,
    });
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockImplementation(async () =>
      started ? RUNNING_RUNTIME_STATUS : NOT_RUNNING_RUNTIME_STATUS
    );
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: installMock,
      uninstall: vi.fn(),
      start: startMock,
      stop: vi.fn(),
      status: statusMock,
    });
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      started
        ? createAlignedBackgroundInventory()
        : {
            expectedVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
            installStatus: INSTALLED_DAEMON_STATUS,
            runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
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
          }
    );
    selectMock.mockResolvedValueOnce("status").mockResolvedValueOnce("exit");

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemon({ view: "human" });
    });

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(maybeAutoStopIdleLocalServiceMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
    expect(stdout).toContain("OpenMeld Service Status");
    expect(stdout).not.toContain(getDaemonStartStartedTitle());
  });

  it("does not ask to start when the service is already running", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 4321,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });
    readCurrentObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 4321,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });
    resolveDaemonServiceManagerMock.mockResolvedValue(null);
    selectMock
      .mockResolvedValueOnce("status")
      .mockResolvedValueOnce("__cancel__");

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemon({ view: "human" });
    });

    const startPromptMessage =
      buildDaemonStartDecisionPromptConfig().message ?? "";
    const startPromptCalls = selectMock.mock.calls.filter((call) => {
      const prompt = call[0] as { message?: string } | undefined;
      return prompt?.message === startPromptMessage;
    });

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(startPromptCalls).toHaveLength(0);
    expect(stdout).toContain("OpenMeld Service Status");
    expect(stdout).not.toContain("Background Service Warming Up");
  });

  it("keeps direct service status flow purely diagnostic", async () => {
    const installMock = vi.fn().mockResolvedValue(undefined);
    let started = false;
    const startMock = vi.fn().mockImplementation(() => {
      started = true;
    });
    const statusMock = vi.fn().mockResolvedValue({
      installed: true,
      enabled: true,
      running: true,
    });
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockImplementation(async () =>
      started ? RUNNING_RUNTIME_STATUS : NOT_RUNNING_RUNTIME_STATUS
    );
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: installMock,
      uninstall: vi.fn(),
      start: startMock,
      stop: vi.fn(),
      status: statusMock,
    });
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      started
        ? createAlignedBackgroundInventory()
        : {
            expectedVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
            installStatus: INSTALLED_DAEMON_STATUS,
            runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
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
          }
    );
    const { stdout } = await withCapturedStdio(async () => {
      await runDaemonStatusFlow({
        view: "human",
      });
    });

    expect(selectMock).not.toHaveBeenCalled();
    expect(maybeAutoStopIdleLocalServiceMock).not.toHaveBeenCalled();
    expect(installMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
    expect(stdout).toContain("OpenMeld Service Status");
    expect(stdout).not.toContain(getDaemonStartStartedTitle());
  });

  it("skips the follow-up start prompt when no local execution routes remain", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockResolvedValue(NOT_RUNNING_RUNTIME_STATUS);
    maybeAutoStopIdleLocalServiceMock.mockResolvedValue({
      autoStopped: true,
      effectiveRuntimeStatus: "not_running",
      localDemand: {
        decision: "keep_running",
        hasLocalExecutionRoute: false,
        repairableReplyCandidateCount: 0,
        reason: "no local execution routes are available",
        localExecutionRouteCount: 0,
        projection: null,
      },
    });
    resolveLocalServiceDemandMock.mockResolvedValue({
      decision: "keep_running",
      hasLocalExecutionRoute: false,
      repairableReplyCandidateCount: 0,
      reason: "no local execution routes are available",
      localExecutionRouteCount: 0,
      projection: null,
    });

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemonStatusFlow({
        view: "human",
      });
    });

    expect(selectMock).not.toHaveBeenCalled();
    expect(stdout).toContain("OpenMeld Service Status");
  });

  it("shows status from the menu without a deferred start card", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockResolvedValue(NOT_RUNNING_RUNTIME_STATUS);
    resolveDaemonServiceManagerMock.mockResolvedValue(null);
    selectMock.mockResolvedValueOnce("status").mockResolvedValueOnce("exit");

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemon({ view: "human" });
    });

    expect(stdout).toContain("OpenMeld Service Status");
    expect(stdout).not.toContain(buildDaemonStartDeferredCard().title);
  });

  it("returns from run mode selection back to the service menu", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockResolvedValue(NOT_RUNNING_RUNTIME_STATUS);
    resolveDaemonServiceManagerMock.mockResolvedValue(null);
    selectMock
      .mockResolvedValueOnce("run")
      .mockResolvedValueOnce("back")
      .mockResolvedValueOnce("exit");

    await withCapturedStdio(async () => {
      await runDaemon({ view: "human" });
    });

    const modePrompt = selectMock.mock.calls[1]?.[0] as
      | { options?: Array<{ label: string }> }
      | undefined;
    expect(modePrompt?.options?.some((option) => option.label === "Back")).toBe(
      true
    );
    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("does not repeat command-entry authentication after Start is chosen from the service menu", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    getDaemonRuntimeStatusMock.mockResolvedValue(NOT_RUNNING_RUNTIME_STATUS);
    resolveDaemonServiceManagerMock.mockResolvedValue(null);
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });
    selectMock.mockResolvedValueOnce("run");

    await withCapturedStdio(async () => {
      await runDaemon({ view: "human" });
    });

    expect(getAuthSessionStateMock).not.toHaveBeenCalledWith({
      validateRemote: true,
    });
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("retries background start once after reinstall auto-start when the first start throws", async () => {
    await withTempHome(async () => {
      getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
      let started = false;
      const teardownMock = vi.fn().mockResolvedValue({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: "launchd",
        systemServiceUninstalled: true,
      });
      const runInstallMock = vi.fn().mockResolvedValue(undefined);
      const runRunMock = vi
        .fn()
        .mockRejectedValueOnce(new Error("transient local start error"))
        .mockImplementationOnce(() => {
          started = true;
          return {
            ok: true,
            reason: "started",
          };
        });
      inspectDaemonServiceInventoryMock.mockImplementation(async () =>
        started
          ? createAlignedBackgroundInventory()
          : {
              expectedVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
              installStatus: INSTALLED_DAEMON_STATUS,
              runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
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
            }
      );

      await withCapturedStdio(async () => {
        const result = await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            forceReinstall: true,
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
          ok: true,
          backupDataPath: null,
          desiredState: "background",
          forceUsed: false,
          result: "completed",
          serviceState: "running",
        });
      });

      expect(runRunMock).toHaveBeenCalledTimes(2);
    });
  });

  it("finishes a healthy repair as a no-op without prompting or restarting the service", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    let reconcileLockHeld = false;
    inspectDaemonServiceInventoryMock.mockImplementation(() => {
      expect(reconcileLockHeld).toBe(true);
      return Promise.resolve(createAlignedBackgroundInventory());
    });
    const runRunMock = vi.fn();

    await withTempHome(async () => {
      const { result, stdout } = await withCapturedStdio(
        async () =>
          await runDaemonReinstall(
            { view: "human" },
            {
              runRun: runRunMock,
              withReconcileLock: async <T>(callback: () => Promise<T>) => {
                reconcileLockHeld = true;
                try {
                  return await callback();
                } finally {
                  reconcileLockHeld = false;
                }
              },
            }
          )
      );

      expect(result).toEqual({
        ok: true,
        desiredState: "background",
        result: "already_healthy",
        serviceState: "running",
      });
      expect(confirmMock).not.toHaveBeenCalled();
      expect(runDaemonServiceLifecycleMock).not.toHaveBeenCalled();
      expect(runRunMock).not.toHaveBeenCalled();
      expect(stdout).toContain("OpenMeld Service Is Already Healthy");
    });
  });

  it("starts an aligned service that should be running but is stopped", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    const stoppedInventory = {
      ...createAlignedBackgroundInventory(),
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
      serviceManagerStatus: {
        installed: true,
        running: false,
        enabled: true,
        definitionPath:
          "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
        commandSummary:
          "node /tmp/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
      },
    };
    let started = false;
    const runRunMock = vi.fn().mockImplementation(() => {
      started = true;
      return { ok: true, reason: "started" };
    });
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      started ? createAlignedBackgroundInventory() : stoppedInventory
    );
    runDaemonServiceLifecycleMock.mockResolvedValue({
      status: "already_aligned",
      targetVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
      inventoryBefore: stoppedInventory,
      inventoryAfter: stoppedInventory,
      reasonCodes: [],
      completedPhases: [],
      desiredState: "stopped",
      shouldStartAfterLifecycle: false,
      backupDataPath: null,
      errorMessage: null,
    });

    await withTempHome(async () => {
      const { result } = await withCapturedStdio(
        async () =>
          await runDaemonReinstall(
            { view: "agent" },
            {
              skipConfirm: true,
              startAfterInstallMode: "always",
              suppressAgentOverview: true,
              runRun: runRunMock,
              withReconcileLock: async <T>(callback: () => Promise<T>) =>
                await callback(),
            }
          )
      );

      expect(result).toMatchObject({
        ok: true,
        desiredState: "background",
        result: "completed",
        serviceState: "running",
      });
    });

    expect(runDaemonServiceLifecycleMock).toHaveBeenCalledOnce();
    expect(runRunMock).toHaveBeenCalledOnce();
  });

  it("leaves an aligned intentionally stopped service stopped", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    const stoppedInventory = {
      ...createAlignedBackgroundInventory(),
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
      serviceManagerStatus: {
        installed: true,
        running: false,
        enabled: false,
        definitionPath:
          "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
        commandSummary:
          "node /tmp/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
      },
      serviceContract: {
        ...createAlignedBackgroundInventory().serviceContract,
        autoStart: false,
        desiredState: "stopped" as const,
      },
    };
    inspectDaemonServiceInventoryMock.mockResolvedValue(stoppedInventory);
    const runRunMock = vi.fn();

    await withTempHome(async () => {
      const { result } = await withCapturedStdio(
        async () =>
          await runDaemonReinstall(
            { view: "agent" },
            {
              skipConfirm: true,
              runRun: runRunMock,
              suppressAgentOverview: true,
              withReconcileLock: async <T>(callback: () => Promise<T>) =>
                await callback(),
            }
          )
      );

      expect(result).toEqual({
        ok: true,
        desiredState: "stopped",
        result: "already_healthy",
        serviceState: "stopped",
      });
    });

    expect(runDaemonServiceLifecycleMock).not.toHaveBeenCalled();
    expect(runRunMock).not.toHaveBeenCalled();
  });

  it("shows a diagnostic card when reinstall auto-start keeps throwing", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: "launchd",
      systemServiceUninstalled: true,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi
      .fn()
      .mockRejectedValue(new Error("launchctl bootstrap failed"));

    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        const result = await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            forceReinstall: true,
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

        expect(result).toMatchObject({
          ok: false,
          result: "start_failed",
          desiredState: "background",
          forceUsed: false,
          backupDataPath: null,
          failureStage: "reinstall-install",
        });
        expect(result).toEqual(
          expect.objectContaining({
            evidencePath: expect.any(String),
          })
        );
      });

      expect(runRunMock).toHaveBeenCalledTimes(2);
      expect(stdout).toContain("OpenMeld Service couldn't start");
      expect(stdout).toContain("openmeld service repair");
      expect(stdout).not.toContain("--mode foreground");
      expect(stdout).not.toContain("daemon-system-service.log");
    });
  });

  it("offers to run the repaired service when reinstall keeps it stopped", async () => {
    let started = false;
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: "launchd",
      systemServiceUninstalled: true,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn().mockImplementation(() => {
      started = true;
      return {
        ok: true as const,
        reason: "started" as const,
      };
    });
    inspectDaemonServiceInventoryMock.mockImplementation(async () =>
      started
        ? createAlignedBackgroundInventory()
        : {
            expectedVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
            installStatus: INSTALLED_DAEMON_STATUS,
            runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
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
          }
    );

    await withTempHome(async () => {
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            forceReinstall: true,
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

      expect(result).toEqual({
        ok: true,
        backupDataPath: null,
        desiredState: "background",
        forceUsed: false,
        result: "completed",
        serviceState: "running",
      });
      expect(stdout).not.toContain("OpenMeld Service Status");
      expect(stdout).toContain(
        "OpenMeld Service was repaired and is now running."
      );
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "OpenMeld Service is repaired but not running yet. Start it now?",
          initialValue: true,
        })
      );
      expect(runRunMock).toHaveBeenCalledWith({
        agentOverviewHandled: true,
        entryChecksHandled: true,
        gatewayUrl: undefined,
        mode: "background",
        outputMode: "silent",
        profile: undefined,
        suppressStartSpinner: true,
        view: "human",
      });
    });
  });

  it("keeps the repaired service stopped when the user declines the follow-up start", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    confirmMock.mockResolvedValueOnce(false);
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: "launchd",
      systemServiceUninstalled: true,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn();

    await withTempHome(async () => {
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            forceReinstall: true,
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

      expect(result).toEqual({
        ok: true,
        backupDataPath: null,
        desiredState: "stopped",
        forceUsed: false,
        result: "completed",
        serviceState: "stopped",
      });
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "OpenMeld Service is repaired but not running yet. Start it now?",
          initialValue: true,
        })
      );
      expect(runRunMock).not.toHaveBeenCalled();
      expect(stdout).toContain("OpenMeld Service Repaired But Not Running");
      expect(stdout).toContain("Local Wake work will keep waiting");
      expect(stdout).toContain("openmeld service start");
    });
  });

  it("does not prompt or auto-start when agent view repair leaves the service stopped", async () => {
    getDaemonStatusMock.mockResolvedValue(INSTALLED_DAEMON_STATUS);
    const teardownMock = vi.fn().mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: "launchd",
      systemServiceUninstalled: true,
    });
    const runInstallMock = vi.fn().mockResolvedValue(undefined);
    const runRunMock = vi.fn();

    await withTempHome(async () => {
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonReinstall(
          {
            view: "agent",
          },
          {
            skipConfirm: true,
            forceReinstall: true,
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

      expect(result).toEqual({
        ok: true,
        backupDataPath: null,
        desiredState: "stopped",
        forceUsed: false,
        result: "completed",
        serviceState: "stopped",
      });
      expect(confirmMock).not.toHaveBeenCalled();
      expect(runRunMock).not.toHaveBeenCalled();
      expect(stdout).toContain('"operationalState":"not_running"');
      expect(stdout).toContain('"requiresStart":true');
      expect(stdout).toContain(
        '"nextSteps":["openmeld service start --view agent"]'
      );
    });
  });

  it("shows the lock holder when another OpenMeld process is already repairing the service", async () => {
    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(async () => {
        const result = await runDaemonReinstall(
          {
            view: "human",
          },
          {
            skipConfirm: true,
            forceReinstall: true,
            readDaemonStatus: vi.fn().mockResolvedValue({
              installed: false,
              state: null,
            }),
            withReconcileLock: () => {
              throw new OpenMeldLockError({
                path: "/tmp/daemon-service-run.lock",
                key: "daemon-service-run",
                metaRaw: JSON.stringify({
                  pid: 22_929,
                  sessionId: "terminal-ppid-20572",
                  at: "2026-03-06T10:30:00.000Z",
                }),
              });
            },
          }
        );

        expect(result).toEqual({
          ok: false,
          result: "in_progress",
          heldBy: "OpenMeld process pid 22929 (terminal-ppid-20572)",
          retryCommand: "openmeld service repair",
          startedAt: "2026-03-06T10:30:00.000Z",
        });
      });

      expect(stdout).toContain("OpenMeld Service Repair In Progress");
      expect(stdout).toContain("OpenMeld process pid 22929");
      expect(stdout).toContain("terminal-ppid-20572");
      expect(stdout).toContain("2026-03-06T10:30:00.000Z");
    });
  });

  it("reports repair guidance instead of in-progress for an orphaned legacy service lock", async () => {
    await withTempHome(async () => {
      const error = await runDaemonReinstall(
        {
          view: "human",
        },
        {
          skipConfirm: true,
          forceReinstall: true,
          readDaemonStatus: vi.fn().mockResolvedValue({
            installed: false,
            state: null,
          }),
          withReconcileLock: () => {
            throw new OpenMeldLockError({
              path: "/tmp/daemon-service-run.lock",
              key: "daemon-service-run",
              metaRaw: JSON.stringify({
                pid: 22_929,
                sessionId: "terminal-ppid-20572",
                at: "2026-03-06T10:30:00.000Z",
              }),
              contentionState: "orphaned",
            });
          },
        }
      ).catch((caught) => caught);

      expect(error).toBeInstanceOf(OpenMeldLockError);
      expect(error.message).toContain("lock left by an older version");
      expect(error.message).toContain("`openmeld repair local-state`");
    });
  });
});

function createAlignedBackgroundInventory() {
  return {
    expectedVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
    installStatus: INSTALLED_DAEMON_STATUS,
    runtimeStatus: RUNNING_RUNTIME_STATUS,
    activeBundle: {
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: "service-bundle",
      daemonVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
      entryScriptRelativePath: "dist/openmeld.js",
      bundleFormat: "self_contained_v1",
      sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
      sourcePackageRootPath: "/tmp/current-cli",
      sourceDistRootPath: "/tmp/current-cli/dist",
      sourceKind: "package_install" as const,
      createdAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
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
      definitionPath:
        "/Users/felix/Library/LaunchAgents/com.openmeld.openmeld-background-service.plist",
      commandSummary:
        "node /tmp/.openmeld/runtime/daemon/service-manager/daemon-service-launcher.mjs service run --mode foreground",
    },
    serviceContract: {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: packageJson.version,
      bundleId: "service-bundle",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "https://openmeld.invalid",
      profileId: "human-profile-test",
      deviceId: "device-test",
      heartbeatMs: 30_000,
      generation: 1,
      updatedAt: "2026-03-06T00:00:00.000Z",
    },
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
  };
}

function createAlignedDaemonLifecycleOutcome() {
  return {
    status: "aligned" as const,
    targetVersion: INSTALLED_DAEMON_STATUS.state.daemonVersion,
    inventoryBefore: createAlignedBackgroundInventory(),
    inventoryAfter: createAlignedBackgroundInventory(),
    reasonCodes: [],
    completedPhases: [],
    desiredState: "stopped" as const,
    shouldStartAfterLifecycle: false,
    backupDataPath: null,
    errorMessage: null,
  };
}
