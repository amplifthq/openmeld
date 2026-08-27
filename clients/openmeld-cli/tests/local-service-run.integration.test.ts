import { EventEmitter } from "node:events";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  runDaemonBackgroundStartForDecision,
  runDaemonRun,
  runDaemonStop,
} from "../src/commands/service";
import {
  readDaemonServiceContract,
  upsertDaemonServiceContract,
} from "../src/config/daemon-service-contract";
import {
  DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
  DAEMON_SERVICE_RUNTIME_MODE_ENV,
  DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV,
  daemonRuntimeBundlesPath,
} from "../src/config/daemon-state";
import { getDaemonSystemServiceLogPath } from "../src/local-service/lifecycle/daemon-service-manager";
import {
  buildDaemonStartNeedsAttentionCard,
  formatDaemonStartAutoRepairResolvedMessage,
  formatDaemonStartStartedManage,
  formatDaemonStartStartedMeaning,
  getDaemonStartStartedTitle,
} from "../src/system/local-service-start-decision";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const JAVASCRIPT_ENTRY_PATH_PATTERN = /\.js$/;

const {
  acquireDaemonServiceLifecycleLockMock,
  cancelMock,
  clearDaemonServiceContractMock,
  clearDaemonServiceRuntimeStateMock,
  clearDaemonRuntimeStateIfDefinitelyStoppedMock,
  emitDaemonLifecycleEventMock,
  ensureDaemonRuntimePathsMock,
  ensureDaemonSystemServiceCommandFilesMock,
  confirmMock,
  getAuthSessionStateMock,
  getObservedDaemonRuntimeStatusMock,
  getDaemonStatusMock,
  hasActiveDaemonOwnersMock,
  isBinaryDistributionMock,
  inspectDaemonServiceInventoryMock,
  isCancelMock,
  cleanupInactiveDaemonServiceBundlesMock,
  prepareDaemonServiceBundleMock,
  readDaemonServiceContractMock,
  readDaemonServiceRuntimeSnapshotMock,
  readCurrentDaemonOwnerSnapshotMock,
  requestLocalDaemonShutdownMock,
  resolveDaemonServiceDependencyDiagnosticsMock,
  readDaemonStartFailureStateMock,
  writeDaemonStartFailureStateMock,
  clearDaemonStartFailureStateMock,
  resolveBaseUrlMock,
  resolveAlignedDaemonActiveBundleEntryPathMock,
  resolveOpenMeldProfileOrNullMock,
  resolveDaemonDeviceIdMock,
  resolveDaemonServiceManagerMock,
  listDaemonOwnedProcessesMock,
  releaseDaemonServiceLifecycleLockMock,
  runDaemonServiceManagerActionMock,
  runAuthLoginMock,
  runDaemonServiceLoopMock,
  runDaemonStartupPreflightMock,
  selectMock,
  spinnerMock,
  spawnMock,
  upsertDaemonServiceContractMock,
  withDaemonServiceRunLockMock,
  withDaemonServiceStopLockMock,
} = vi.hoisted(() => ({
  acquireDaemonServiceLifecycleLockMock: vi.fn(async () => ({
    path: "/tmp/daemon-service-run.lock",
  })),
  cancelMock: vi.fn(),
  clearDaemonServiceContractMock: vi.fn(),
  clearDaemonServiceRuntimeStateMock: vi.fn(),
  clearDaemonRuntimeStateIfDefinitelyStoppedMock: vi.fn(),
  emitDaemonLifecycleEventMock: vi.fn(),
  ensureDaemonRuntimePathsMock: vi.fn(),
  ensureDaemonSystemServiceCommandFilesMock: vi.fn(),
  confirmMock:
    vi.fn<
      (
        message: string,
        options?: { initialValue?: boolean }
      ) => boolean | Promise<boolean>
    >(),
  getAuthSessionStateMock: vi.fn(),
  getObservedDaemonRuntimeStatusMock: vi.fn(),
  getDaemonStatusMock: vi.fn(),
  hasActiveDaemonOwnersMock: vi.fn(),
  isBinaryDistributionMock: vi.fn(() => false),
  inspectDaemonServiceInventoryMock: vi.fn(),
  isCancelMock: vi.fn<(value: unknown) => boolean>(),
  cleanupInactiveDaemonServiceBundlesMock: vi.fn(),
  prepareDaemonServiceBundleMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  readDaemonServiceRuntimeSnapshotMock: vi.fn(),
  readCurrentDaemonOwnerSnapshotMock: vi.fn(),
  requestLocalDaemonShutdownMock: vi.fn(),
  resolveDaemonServiceDependencyDiagnosticsMock: vi.fn(),
  readDaemonStartFailureStateMock: vi.fn(),
  writeDaemonStartFailureStateMock: vi.fn(),
  clearDaemonStartFailureStateMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveAlignedDaemonActiveBundleEntryPathMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveDaemonDeviceIdMock: vi.fn(),
  resolveDaemonServiceManagerMock: vi.fn(),
  listDaemonOwnedProcessesMock: vi.fn(),
  releaseDaemonServiceLifecycleLockMock: vi.fn(async () => undefined),
  runDaemonServiceManagerActionMock: vi.fn(
    async (input: { run: () => Promise<unknown> }) => await input.run()
  ),
  runAuthLoginMock: vi.fn(),
  runDaemonServiceLoopMock: vi.fn(),
  runDaemonStartupPreflightMock: vi.fn(),
  selectMock:
    vi.fn<(options: { message: string }) => string | Promise<string>>(),
  spinnerMock: vi.fn(),
  spawnMock:
    vi.fn<
      (
        command: string,
        args: string[],
        options?: {
          detached?: boolean;
          stdio?: unknown;
          env?: unknown;
          windowsHide?: boolean;
        }
      ) => EventEmitter & { pid: number; unref: () => void }
    >(),
  upsertDaemonServiceContractMock: vi.fn(),
  withDaemonServiceRunLockMock: vi.fn(
    async (callback: () => Promise<unknown>) => callback()
  ),
  withDaemonServiceStopLockMock: vi.fn(
    async (callback: () => Promise<unknown>) => callback()
  ),
}));

const processKillMock = vi.hoisted(() => vi.fn());

const DAEMON_RUNTIME_STATE = {
  installed: true,
  state: {
    v: 1,
    schema: "openmeld-daemon-install-v1",
    daemonVersion: packageJson.version,
    installSource: "daemon.command.install",
    installedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  },
} as const;

const NOT_RUNNING_RUNTIME_STATUS = {
  status: "not_running",
  mode: null,
  pid: null,
  startedAt: null,
  updatedAt: null,
  managedBySystemService: false,
  serviceController: "unknown",
  autoStart: false,
} as const;

type RuntimeContextOverride = {
  resolvedView: "human" | "agent";
  interactive: boolean;
  openMeldProfileId?: string;
};

let runtimeContext: RuntimeContextOverride = {
  resolvedView: "human",
  interactive: true,
};
type ServiceContract = NonNullable<
  Awaited<ReturnType<typeof readDaemonServiceContract>>
>;

let contractState: ServiceContract | null = null;

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: vi.fn(async () => ({
    viewMode: "auto",
    resolvedView: runtimeContext.resolvedView,
    interactive: runtimeContext.interactive,
    ...(runtimeContext.openMeldProfileId
      ? { openMeldProfileId: runtimeContext.openMeldProfileId }
      : {}),
  })),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: getAuthSessionStateMock,
}));

vi.mock("../src/config/base-url", () => ({
  normalizeGatewayBaseUrl: (value: string) => resolveBaseUrlMock(value),
  normalizeGatewayBaseUrlOrNull: (value?: string | null) => {
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) {
      return null;
    }
    try {
      return resolveBaseUrlMock(normalizedValue);
    } catch {
      return null;
    }
  },
  resolveBaseUrl: resolveBaseUrlMock,
  resolveBaseUrlOrNull: async (value?: string) => {
    try {
      return await resolveBaseUrlMock(value);
    } catch {
      return null;
    }
  },
  resolveExplicitGatewayUrlOrThrow: async (value?: string) => {
    const explicitGatewayUrl = String(value ?? "").trim();
    if (!explicitGatewayUrl) {
      return null;
    }
    try {
      return await resolveBaseUrlMock(explicitGatewayUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid explicit gateway URL "${explicitGatewayUrl}": ${message}`
      );
    }
  },
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(
    () => runtimeContext.resolvedView === "human" && runtimeContext.interactive
  ),
}));

vi.mock("../src/local-service/carrier/service-runner", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/carrier/service-runner")
  >("../src/local-service/carrier/service-runner");
  return {
    ...actual,
    runDaemonServiceLoop: runDaemonServiceLoopMock,
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

vi.mock("../src/local-service/state/daemon-device-id", () => ({
  ensureDaemonRuntimePaths: ensureDaemonRuntimePathsMock,
  resolveDaemonDeviceId: resolveDaemonDeviceIdMock,
  resolvePreferredDaemonDeviceId: vi.fn(
    (input: { explicitDeviceId?: string; contractDeviceId?: string | null }) =>
      input.explicitDeviceId?.trim() || input.contractDeviceId || undefined
  ),
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    acquireDaemonServiceLifecycleLock: acquireDaemonServiceLifecycleLockMock,
    clearDaemonServiceRuntimeState: clearDaemonServiceRuntimeStateMock,
    getDaemonRuntimeStatus: getObservedDaemonRuntimeStatusMock,
    getDaemonStatus: getDaemonStatusMock,
    readDaemonServiceRuntimeSnapshot: readDaemonServiceRuntimeSnapshotMock,
    releaseDaemonServiceLifecycleLock: releaseDaemonServiceLifecycleLockMock,
    withDaemonServiceRunLock: withDaemonServiceRunLockMock,
    withDaemonServiceStopLock: withDaemonServiceStopLockMock,
  };
});

vi.mock("../src/config/daemon-service-contract", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-service-contract")
  >("../src/config/daemon-service-contract");
  return {
    ...actual,
    clearDaemonServiceContract: clearDaemonServiceContractMock,
    readDaemonServiceContract: readDaemonServiceContractMock,
    upsertDaemonServiceContract: upsertDaemonServiceContractMock,
  };
});

vi.mock("@clack/prompts", () => ({
  cancel: cancelMock,
  confirm: (message: string, options?: { initialValue?: boolean }) =>
    confirmMock(message, options),
  isCancel: (value: unknown) => isCancelMock(value),
  select: (options: { message: string }) => selectMock(options),
  spinner: spinnerMock,
}));

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: runAuthLoginMock,
}));

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: isBinaryDistributionMock,
  resolveOpenMeldDistribution: () =>
    isBinaryDistributionMock() ? "binary" : "npm",
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process"
    );
  return {
    ...actual,
    spawn: (
      command: string,
      args: string[],
      options?: {
        detached?: boolean;
        stdio?: unknown;
        env?: unknown;
        windowsHide?: boolean;
      }
    ) => spawnMock(command, args, options),
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

vi.mock("../src/local-service/control-plane/client", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/control-plane/client")
  >("../src/local-service/control-plane/client");
  return {
    ...actual,
    requestLocalDaemonShutdown: requestLocalDaemonShutdownMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-lifecycle-journal", () => ({
  emitDaemonLifecycleEvent: emitDaemonLifecycleEventMock,
  runDaemonServiceManagerAction: runDaemonServiceManagerActionMock,
  runWithDaemonLifecycleCommandJournal: vi.fn(
    async (input: { run: () => Promise<unknown> }) => await input.run()
  ),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-owner-snapshot", () => ({
  hasActiveDaemonOwners: hasActiveDaemonOwnersMock,
  readCurrentDaemonOwnerSnapshot: readCurrentDaemonOwnerSnapshotMock,
  resolveStoppedContractWriteBlockedReason: vi.fn(
    (snapshot: {
      ownedProcesses?: unknown[];
      serviceManagerStatus?: { enabled?: boolean; running?: boolean } | null;
    }) => {
      if ((snapshot.ownedProcesses?.length ?? 0) > 0) {
        return "owned_processes_still_active";
      }
      if (snapshot.serviceManagerStatus?.running === true) {
        return "service_manager_still_running";
      }
      if (snapshot.serviceManagerStatus?.enabled === true) {
        return "service_manager_still_enabled";
      }
      return null;
    }
  ),
  resolveDaemonStopStrategy: vi.fn(
    (snapshot: {
      activeOwnerKinds?: string[];
      mustStopManagerFirst?: boolean;
      ownedProcesses?: unknown[];
      systemServiceRegistrationPresent?: boolean;
      serviceManagerStatus?: { running?: boolean } | null;
      effectiveRuntimeStatus?: string;
    }) => {
      if (
        snapshot.effectiveRuntimeStatus !== "running" &&
        (snapshot.activeOwnerKinds?.length ?? 0) === 0 &&
        (snapshot.ownedProcesses?.length ?? 0) === 0 &&
        snapshot.serviceManagerStatus?.running !== true
      ) {
        return {
          kind: "not_running",
          requiresResidualProcessCleanup: false,
          reason: "mocked not_running",
        };
      }
      if (snapshot.activeOwnerKinds?.includes("system_service")) {
        return {
          kind: "manager_first",
          requiresResidualProcessCleanup: true,
          reason: "mocked manager-first",
        };
      }
      return snapshot.systemServiceRegistrationPresent
        ? {
            kind: "process_then_manager_cleanup",
            requiresResidualProcessCleanup: true,
            reason: "mocked process-then-manager-cleanup",
          }
        : {
            kind: "process_only",
            requiresResidualProcessCleanup: true,
            reason: "mocked process-only",
          };
    }
  ),
  summarizeDaemonOwnerSnapshot: vi.fn(() => ({
    ownerSetSummary: "single_owner",
  })),
}));

vi.mock("../src/local-service/lifecycle/daemon-service-inventory", () => ({
  inspectDaemonServiceInventory: inspectDaemonServiceInventoryMock,
}));

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
    writeDaemonStartFailureState: writeDaemonStartFailureStateMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-bundle")
  >("../src/local-service/lifecycle/daemon-service-bundle");
  return {
    ...actual,
    cleanupInactiveDaemonServiceBundles:
      cleanupInactiveDaemonServiceBundlesMock,
    prepareDaemonServiceBundle: prepareDaemonServiceBundleMock,
    resolveAlignedDaemonActiveBundleEntryPath:
      resolveAlignedDaemonActiveBundleEntryPathMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("../src/local-service/lifecycle/daemon-service-runtime")
  >("../src/local-service/lifecycle/daemon-service-runtime");
  return {
    ...actual,
    clearDaemonRuntimeStateIfDefinitelyStopped:
      clearDaemonRuntimeStateIfDefinitelyStoppedMock,
    readCurrentObservedDaemonRuntimeStatus: getObservedDaemonRuntimeStatusMock,
    readCurrentDaemonRuntimeContext: vi.fn(async () => {
      const runtimeStatus = await getObservedDaemonRuntimeStatusMock();
      const status = await getDaemonStatusMock();
      const serviceManager =
        runtimeStatus?.managedBySystemService === true
          ? await resolveDaemonServiceManagerMock(
              runtimeStatus.serviceController
            )
          : null;
      const serviceManagerStatus = serviceManager
        ? await serviceManager.status()
        : null;
      return {
        status,
        runtimeStatus,
        serviceManager,
        serviceManagerStatus,
        legacySharedService: null,
        effectiveRuntimeStatus: actual.getEffectiveDaemonRuntimeStatus({
          runtimeState: runtimeStatus,
          serviceManagerStatus,
        }),
      };
    }),
  };
});

describe("openmeld service run command", () => {
  let processKillSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    acquireDaemonServiceLifecycleLockMock.mockReset().mockResolvedValue({
      path: "/tmp/daemon-service-run.lock",
    });
    cancelMock.mockReset();
    getDaemonStatusMock.mockReset();
    getObservedDaemonRuntimeStatusMock.mockReset();
    clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockReset();
    clearDaemonServiceRuntimeStateMock.mockReset();
    emitDaemonLifecycleEventMock.mockReset().mockResolvedValue(undefined);
    hasActiveDaemonOwnersMock.mockReset().mockReturnValue(false);
    readCurrentDaemonOwnerSnapshotMock
      .mockReset()
      .mockImplementation(async () => {
        const runtimeStatus = await getObservedDaemonRuntimeStatusMock();
        const serviceManager =
          runtimeStatus?.managedBySystemService === true
            ? await resolveDaemonServiceManagerMock(
                runtimeStatus.serviceController
              )
            : null;
        const serviceManagerStatus = serviceManager
          ? await serviceManager.status()
          : null;
        let activeOwnerKinds: string[] = [];
        if (runtimeStatus?.status === "running") {
          activeOwnerKinds = runtimeStatus.managedBySystemService
            ? ["system_service"]
            : ["cli_direct"];
        }
        return {
          runtimeStatus,
          serviceManager,
          serviceManagerStatus,
          ownedProcesses: [],
          effectiveRuntimeStatus:
            runtimeStatus?.status === "running"
              ? "running"
              : runtimeStatus.status,
          systemServiceRegistrationPresent:
            runtimeStatus?.managedBySystemService === true ||
            serviceManagerStatus?.installed === true ||
            serviceManagerStatus?.running === true,
          activeOwnerKinds,
          ownerSetSummary:
            activeOwnerKinds.length === 0 ? "no_owner" : "single_owner",
          mustStopManagerFirst:
            runtimeStatus?.managedBySystemService === true ||
            serviceManagerStatus?.installed === true ||
            serviceManagerStatus?.running === true,
        };
      });
    runDaemonServiceManagerActionMock
      .mockReset()
      .mockImplementation(
        async (input: { run: () => Promise<unknown> }) => await input.run()
      );
    withDaemonServiceRunLockMock.mockClear();
    withDaemonServiceStopLockMock.mockClear();
    selectMock.mockReset();
    confirmMock.mockReset();
    isBinaryDistributionMock.mockReset().mockReturnValue(false);
    isCancelMock
      .mockReset()
      .mockImplementation((value: unknown) => value === "__cancel__");
    spinnerMock.mockReset().mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      error: vi.fn(),
      message: vi.fn(),
      clear: vi.fn(),
      isCancelled: false,
    });
    runDaemonServiceLoopMock.mockReset().mockResolvedValue(undefined);
    runDaemonStartupPreflightMock.mockReset().mockResolvedValue({
      status: "already_aligned",
      reasonCodes: [],
      errorMessage: null,
      cooldownUntil: null,
      backupDataPath: null,
    });
    spawnMock.mockReset().mockImplementation(() => {
      const child = createMockCommandChildProcess();
      return child as never;
    });
    resolveDaemonServiceManagerMock.mockReset().mockResolvedValue(null);
    listDaemonOwnedProcessesMock.mockReset().mockResolvedValue([]);
    releaseDaemonServiceLifecycleLockMock
      .mockReset()
      .mockResolvedValue(undefined);
    resolveOpenMeldProfileOrNullMock.mockReset().mockResolvedValue(null);
    runAuthLoginMock.mockReset().mockResolvedValue(undefined);
    cleanupInactiveDaemonServiceBundlesMock
      .mockReset()
      .mockResolvedValue(undefined);
    ensureDaemonRuntimePathsMock.mockReset().mockResolvedValue({
      contractMetaPath: "/tmp/daemon/contract-meta.json",
      contractRepairReportPath: "/tmp/daemon/repair-report.json",
      contextStorePath: "/tmp/daemon/context-store.json",
      dataRootPath: "/tmp/daemon/data",
      deviceIdPath: "/tmp/daemon/device-id",
      ledgerRootPath: "/tmp/daemon/ledger",
    });
    ensureDaemonSystemServiceCommandFilesMock
      .mockReset()
      .mockResolvedValue(undefined);
    resolveDaemonDeviceIdMock.mockReset().mockResolvedValue("device_123");
    contractState = null;
    clearDaemonServiceContractMock.mockReset().mockImplementation(() => {
      contractState = null;
      return Promise.resolve();
    });
    readDaemonServiceContractMock
      .mockReset()
      .mockImplementation(() => Promise.resolve(contractState));
    readDaemonServiceRuntimeSnapshotMock.mockReset().mockResolvedValue(null);
    prepareDaemonServiceBundleMock.mockReset().mockResolvedValue(undefined);
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
    writeDaemonStartFailureStateMock.mockReset().mockResolvedValue(undefined);
    clearDaemonStartFailureStateMock.mockReset().mockResolvedValue(undefined);
    upsertDaemonServiceContractMock.mockReset().mockImplementation((input) => {
      const next: ServiceContract = {
        schema: "openmeld-daemon-service-contract-v1" as const,
        v: 1 as const,
        lane: input.lane ?? "prod",
        daemonVersion: input.daemonVersion,
        bundleId: input.bundleId,
        desiredState: input.desiredState,
        serviceController: input.serviceController,
        autoStart: input.autoStart,
        gatewayUrl: input.gatewayUrl,
        ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        deviceId: input.deviceId,
        heartbeatMs: input.heartbeatMs,
        generation: contractState ? contractState.generation + 1 : 1,
        updatedAt: "2026-03-14T00:00:00.000Z",
      };
      const isSameContract =
        contractState !== null &&
        contractState.lane === next.lane &&
        contractState.daemonVersion === next.daemonVersion &&
        contractState.bundleId === next.bundleId &&
        contractState.desiredState === next.desiredState &&
        contractState.serviceController === next.serviceController &&
        contractState.autoStart === next.autoStart &&
        contractState.gatewayUrl === next.gatewayUrl &&
        contractState.ownerUserId === next.ownerUserId &&
        contractState.profileId === next.profileId &&
        contractState.deviceId === next.deviceId &&
        contractState.heartbeatMs === next.heartbeatMs;
      if (isSameContract) {
        return Promise.resolve(contractState);
      }
      contractState = next;
      return Promise.resolve(next);
    });
    resolveAlignedDaemonActiveBundleEntryPathMock
      .mockReset()
      .mockResolvedValue(
        `${daemonRuntimeBundlesPath()}/service-bundle/dist/openmeld.js`
      );
    inspectDaemonServiceInventoryMock.mockReset().mockResolvedValue({
      expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      installStatus: DAEMON_RUNTIME_STATE,
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

    getDaemonStatusMock.mockResolvedValue(DAEMON_RUNTIME_STATE);
    getObservedDaemonRuntimeStatusMock.mockResolvedValue(
      NOT_RUNNING_RUNTIME_STATUS
    );
    clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockResolvedValue({
      context: {
        status: DAEMON_RUNTIME_STATE,
        runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
        serviceManager: null,
        serviceManagerStatus: null,
        legacySharedService: null,
        effectiveRuntimeStatus: "not_running",
      },
      cleared: false,
    });
    clearDaemonServiceRuntimeStateMock.mockResolvedValue(undefined);
    getAuthSessionStateMock.mockReset().mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "test-access-token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-03-01T00:00:00.000Z",
        user: {
          id: "usr_123",
          email: "dev@openmeld.invalid",
        },
      },
    });
    resolveBaseUrlMock
      .mockReset()
      .mockResolvedValue("https://gateway.openmeld.invalid");

    runtimeContext = {
      resolvedView: "human",
      interactive: false,
      openMeldProfileId: undefined,
    };
    processKillMock.mockReset();
    processKillSpy = vi.spyOn(process, "kill").mockImplementation(((
      pid: number,
      signal?: NodeJS.Signals | number
    ) => {
      return processKillMock(pid, signal);
    }) as typeof process.kill);
  });

  afterEach(() => {
    if (processKillSpy) {
      processKillSpy.mockRestore();
      processKillSpy = null;
    }
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("defaults to background mode when non-interactive and no --mode is given", async () => {
    const childPid = process.pid;
    getObservedDaemonRuntimeStatusMock
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      })
      .mockResolvedValue({
        status: "running",
        mode: "background",
        pid: childPid,
        startedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      });

    const originalScriptPath = process.argv[1];
    process.argv[1] = "/usr/local/bin/openmeld";
    spawnMock.mockImplementation(() => {
      const child = createMockDetachedChildProcess(childPid);
      return child as never;
    });

    try {
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonRun({
          view: "human",
        });
      });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const call = spawnMock.mock.calls[0];
      expect(call?.[0]).toBe(process.execPath);
      expect(call?.[1]?.[0]).toMatch(JAVASCRIPT_ENTRY_PATH_PATTERN);
      expect(call?.[1]?.slice(1)).toEqual([
        "service",
        "run",
        "--mode",
        "foreground",
      ]);
      expect(call?.[2]).toMatchObject({
        env: expect.objectContaining({
          [DAEMON_SERVICE_RUNTIME_MODE_ENV]: "background",
          [DAEMON_SERVICE_RUNTIME_DETACHED_ENV]: "1",
        }),
      });
      expect(stdout).toContain(getDaemonStartStartedTitle());
      expect(stdout).toContain(formatDaemonStartStartedMeaning());
      expect(stdout).toContain(formatDaemonStartStartedManage());
    } finally {
      process.argv[1] = originalScriptPath ?? process.execPath;
    }
  });

  it("launches a binary distribution background daemon directly from the managed binary", async () => {
    const childPid = process.pid;
    const managedBinaryPath = "/tmp/openmeld/versions/1.2.3/openmeld";
    isBinaryDistributionMock.mockReturnValue(true);
    resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
      managedBinaryPath
    );
    getObservedDaemonRuntimeStatusMock
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      })
      .mockResolvedValue({
        status: "running",
        mode: "background",
        pid: childPid,
        startedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      });
    spawnMock.mockImplementation(() => {
      const child = createMockDetachedChildProcess(childPid);
      return child as never;
    });

    await withCapturedStdio(async () => {
      await runDaemonRun({
        view: "human",
      });
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const call = spawnMock.mock.calls[0];
    expect(call?.[0]).toBe(managedBinaryPath);
    expect(call?.[1]).toEqual(["service", "run", "--mode", "foreground"]);
    expect(call?.[2]).toMatchObject({
      env: expect.objectContaining({
        [DAEMON_SERVICE_RUNTIME_MODE_ENV]: "background",
        [DAEMON_SERVICE_RUNTIME_DETACHED_ENV]: "1",
      }),
    });
  });

  it("fails closed on an invalid explicit gateway URL instead of reusing a persisted contract gateway", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.9",
        bundleId: "service-bundle",
        desiredState: "stopped",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "https://staging.openmeld.invalid",
        profileId: "hum_existing_contract",
        deviceId: "device_install",
        heartbeatMs: 5000,
        lane: "prod",
      });
      resolveBaseUrlMock.mockImplementation((value?: string) => {
        if (value === "not a url") {
          throw new Error("invalid base url");
        }
        return "https://gateway.openmeld.invalid";
      });

      const captured = await withCapturedStdio(async () => {
        try {
          await runDaemonRun({
            view: "human",
            gatewayUrl: "not a url",
          });
          return null;
        } catch (error) {
          return error;
        }
      });

      expect(captured.result).toBeInstanceOf(Error);
      expect((captured.result as Error).message).toContain(
        'Invalid explicit gateway URL "not a url"'
      );
      expect(spawnMock).not.toHaveBeenCalled();
      await expect(readDaemonServiceContract()).resolves.toMatchObject({
        gatewayUrl: "https://staging.openmeld.invalid",
      });
    });
  });

  it("passes the resolved OpenMeld profile into background service launch args", async () => {
    runtimeContext = {
      resolvedView: "human",
      interactive: false,
      openMeldProfileId: "human-default",
    };
    const childPid = process.pid;
    getObservedDaemonRuntimeStatusMock
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      })
      .mockResolvedValue({
        status: "running",
        mode: "background",
        pid: childPid,
        startedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      });

    const originalScriptPath = process.argv[1];
    process.argv[1] = "/usr/local/bin/openmeld";
    spawnMock.mockImplementation(() => {
      const child = createMockDetachedChildProcess(childPid);
      return child as never;
    });

    try {
      await withCapturedStdio(async () => {
        await runDaemonRun({
          view: "human",
        });
      });

      expect(spawnMock.mock.calls[0]?.[1]?.[0]).toMatch(
        JAVASCRIPT_ENTRY_PATH_PATTERN
      );
      expect(spawnMock.mock.calls[0]?.[1]?.slice(1)).toEqual([
        "service",
        "run",
        "--mode",
        "foreground",
        "--profile",
        "human-default",
      ]);
    } finally {
      process.argv[1] = originalScriptPath ?? process.execPath;
    }
  });

  it("writes a background contract before detached background start succeeds", async () => {
    await withTempHome(async () => {
      runtimeContext = {
        resolvedView: "human",
        interactive: false,
        openMeldProfileId: "human-default",
      };
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );
      const childPid = process.pid;
      getObservedDaemonRuntimeStatusMock
        .mockResolvedValueOnce({
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
        })
        .mockResolvedValue({
          status: "running",
          mode: "background",
          pid: childPid,
          startedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "legacy-detached",
          autoStart: false,
        });

      const originalScriptPath = process.argv[1];
      process.argv[1] = "/usr/local/bin/openmeld";
      spawnMock.mockImplementation(() => {
        const child = createMockDetachedChildProcess(childPid);
        return child as never;
      });

      try {
        await runDaemonRun({
          view: "human",
        });

        const contract = await readDaemonServiceContract();
        expect(contract).toMatchObject({
          daemonVersion: packageJson.version,
          bundleId: "service-bundle",
          desiredState: "background",
          serviceController: "legacy-detached",
          autoStart: false,
        });
        expect(contract).not.toHaveProperty("profileId");
      } finally {
        process.argv[1] = originalScriptPath ?? process.execPath;
      }
    });
  });

  it("waits long enough for detached background startup to report running", async () => {
    await withTempHome(async () => {
      runtimeContext = {
        resolvedView: "human",
        interactive: false,
        openMeldProfileId: "human-default",
      };
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );
      const childPid = process.pid;
      processKillMock.mockImplementation(
        (pid: number, signal?: number | NodeJS.Signals) =>
          pid === childPid && signal === 0
      );
      let observedRuntimeReadCount = 0;
      getObservedDaemonRuntimeStatusMock.mockImplementation(() => {
        observedRuntimeReadCount += 1;
        if (observedRuntimeReadCount <= 30) {
          return Promise.resolve({
            status: "not_running",
            mode: null,
            pid: null,
            startedAt: null,
            updatedAt: null,
          });
        }
        return Promise.resolve({
          status: "running",
          mode: "background",
          pid: childPid,
          startedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "legacy-detached",
          autoStart: false,
        });
      });

      const originalScriptPath = process.argv[1];
      process.argv[1] = "/usr/local/bin/openmeld";
      spawnMock.mockImplementation(() => {
        const child = createMockDetachedChildProcess(childPid);
        return child as never;
      });

      try {
        const result = await runDaemonRun({
          view: "human",
          mode: "background",
        });

        expect(result).toEqual({
          ok: true,
          reason: "started",
        });
      } finally {
        process.argv[1] = originalScriptPath ?? process.execPath;
      }
    });
  });

  it("blocks background start when inventory finds duplicate OpenMeld-owned processes", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue({
      expectedVersion: "0.2.8",
      installStatus: {
        ...DAEMON_RUNTIME_STATE,
        state: {
          ...DAEMON_RUNTIME_STATE.state,
          daemonVersion: "0.2.8",
        },
      },
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
      activeBundle: null,
      activeBundleSourceAvailable: null,
      activeBundleEntryPath: null,
      runtimeCommandEntryPath: null,
      runtimeCommandPathExists: null,
      serviceManager: null,
      serviceManagerStatus: null,
      ownedProcesses: [
        {
          pid: 111,
          parentPid: 1,
          command: "openmeld service run --mode background",
          mode: "background",
          ownership: "cli_direct",
        },
        {
          pid: 222,
          parentPid: 1,
          command: "openmeld service run --mode background",
          mode: "background",
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
        {
          code: "service_manager_path_drift",
          message:
            "The OS service manager is still pointing at an old CLI path instead of the OpenMeld-managed stable launcher.",
        },
        {
          code: "bundle_content_drift",
          message:
            "OpenMeld Service is using older local service files than this lane expects.",
        },
      ],
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "human",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "cleanup_required",
    });
    expect(
      spawnMock.mock.calls.filter(([command]) => command === process.execPath)
    ).toHaveLength(0);
    expect(prepareDaemonServiceBundleMock).not.toHaveBeenCalled();
    expect(stdout).toContain("OpenMeld Service Needs Repair");
    expect(stdout).toContain(
      "Reconnect OpenMeld Service before this computer can receive local Wake work."
    );
    expect(stdout).not.toContain(
      "Found multiple OpenMeld-owned service processes"
    );
    expect(stdout).not.toContain("old CLI path");
    expect(stdout).not.toContain("older CLI build output");
    expect(stdout).toContain("Run `openmeld setup`");
  });

  it("keeps service refresh anomaly details in agent view", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    inspectDaemonServiceInventoryMock.mockResolvedValue({
      expectedVersion: "0.2.8",
      installStatus: {
        ...DAEMON_RUNTIME_STATE,
        state: {
          ...DAEMON_RUNTIME_STATE.state,
          daemonVersion: "0.2.8",
        },
      },
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
      anomalies: [
        {
          code: "service_manager_path_drift",
          message:
            "The OS service manager is still pointing at an old CLI path instead of the OpenMeld-managed stable launcher.",
        },
        {
          code: "bundle_content_drift",
          message:
            "OpenMeld Service is using older local service files than this lane expects.",
        },
      ],
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "agent",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "cleanup_required",
    });
    expect(prepareDaemonServiceBundleMock).not.toHaveBeenCalled();
    expect(stdout).toContain('"code":"daemon.run.cleanup_required"');
    expect(stdout).toContain('"cleanupPlan"');
    expect(stdout).toContain('"service_manager_path_drift"');
    expect(stdout).toContain('"bundle_content_drift"');
    expect(stdout).toContain("old CLI path");
    expect(stdout).toContain("older local service files");
    const payload = parseAgentResultEnvelope(
      stdout,
      "daemon.run.cleanup_required"
    ) as {
      nextSteps?: string[];
      requiresRepair?: boolean;
      requiresStartAfterRepair?: boolean;
      message?: string;
    } | null;
    expect(payload).toMatchObject({
      requiresRepair: true,
      requiresStartAfterRepair: true,
      nextSteps: [
        "openmeld-dev service repair --view agent",
        "openmeld-dev service start --view agent",
      ],
    });
    expect(payload?.message).toContain("repair");
    expect(payload?.message).toContain("start");
  });

  it("blocks unsafe runtime contract drift with service update guidance in human view", async () => {
    inspectDaemonServiceInventoryMock.mockResolvedValue({
      expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      installStatus: DAEMON_RUNTIME_STATE,
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
      anomalies: [
        {
          code: "runtime_contract_mismatch",
          message:
            "OpenMeld Service runtime contract compatibility was not confirmed.",
        },
      ],
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "human",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "cleanup_required",
    });
    expect(stdout).toContain("OpenMeld Service Update Required");
    expect(stdout).toContain(
      "OpenMeld Service must be updated before it can start safely."
    );
    expect(stdout).toContain("Update OpenMeld Service with `openmeld setup`.");
    expect(stdout).not.toContain("OpenMeld Service Needs Repair");
    expect(stdout).not.toContain("runtime_contract_mismatch");
  });

  it("offers direct repair when cleanup is required before background start", async () => {
    runtimeContext.interactive = true;
    selectMock.mockResolvedValueOnce("not_now");
    inspectDaemonServiceInventoryMock.mockResolvedValue({
      expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      installStatus: DAEMON_RUNTIME_STATE,
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
      activeBundle: null,
      activeBundleSourceAvailable: null,
      activeBundleEntryPath: null,
      runtimeCommandEntryPath: null,
      runtimeCommandPathExists: null,
      serviceManager: null,
      serviceManagerStatus: null,
      ownedProcesses: [
        {
          pid: 111,
          parentPid: 1,
          command: "openmeld service run --mode background",
          mode: "background",
          ownership: "cli_direct",
        },
      ],
      lifecycleLock: null,
      anomalies: [
        {
          code: "foreground_background_conflict",
          message:
            "OpenMeld found a foreground/background conflict in local service state.",
        },
      ],
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonBackgroundStartForDecision({
        view: "human",
      });
    });

    expect(result).toBe("deferred_with_card");
    expect(spawnMock).not.toHaveBeenCalled();
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Reconnect OpenMeld Service before this computer can receive local Wake work."
        ),
      })
    );
    expect(stdout).toContain("OpenMeld Service Needs Repair");
    expect(stdout).toContain("Run `openmeld setup`");
  });

  it("renders a needs-attention card when direct repair throws before background start", async () => {
    await withTempHome(async () => {
      runtimeContext.interactive = true;
      selectMock.mockResolvedValueOnce("repair");
      inspectDaemonServiceInventoryMock.mockResolvedValue({
        expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
        installStatus: DAEMON_RUNTIME_STATE,
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
        anomalies: [
          {
            code: "bundle_missing",
            message:
              "The active OpenMeld Service bundle is missing on this device.",
          },
        ],
      });
      getDaemonStatusMock.mockResolvedValue({
        ...DAEMON_RUNTIME_STATE,
        state: {
          ...DAEMON_RUNTIME_STATE.state,
          daemonVersion: "0.0.8",
        },
      });
      prepareDaemonServiceBundleMock.mockRejectedValueOnce(
        new Error("bundle preparation exploded")
      );

      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonBackgroundStartForDecision({
          view: "human",
        });
      });

      expect(result).toBe("failed_with_card");
      expect(stdout).toContain("OpenMeld Service couldn't start");
      expect(stdout).toContain(
        "OpenMeld Service couldn't start after the repair."
      );
      expect(stdout).toContain("openmeld service repair");
      expect(stdout).not.toContain("--mode foreground");
      expect(stdout).not.toContain("bundle preparation exploded");
      expect(stdout).not.toContain("latest local service log");
    });
  });

  it("includes startup output when detached background local service exits during startup", async () => {
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });

    const childPid = process.pid;
    spawnMock.mockImplementation(() => {
      const child = createMockDetachedChildProcess(childPid, {
        exitCode: 1,
        stderr: "authentication required; run `openmeld login`",
      });
      return child as never;
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonRun({
          view: "human",
        });
      });

      expect(result).toEqual({
        ok: false,
        reason: "start_failed",
      });
      expect(process.exitCode).toBe(1);
      expect(stdout).toContain("OpenMeld Service couldn't start");
      expect(stdout).toContain("What happened");
      expect(stdout).toContain("Next");
      expect(stdout).not.toContain("Last local detail");
      expect(stdout).not.toContain(
        "authentication required; run `openmeld login`"
      );
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("prompts sign-in first and then continues local service run in human view", async () => {
    runtimeContext = {
      resolvedView: "human",
      interactive: true,
    };
    getAuthSessionStateMock
      .mockResolvedValueOnce({
        state: "missing",
        session: null,
      })
      .mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "test-access-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: "2026-03-01T00:00:00.000Z",
          user: {
            id: "usr_123",
            email: "dev@openmeld.invalid",
          },
        },
      });
    selectMock.mockResolvedValueOnce("__command_auth_login__");

    const { result } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "human",
        mode: "foreground",
      });
    });

    expect(result).toEqual({
      ok: true,
      reason: "started",
    });
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
    expect(runAuthLoginMock).toHaveBeenCalledWith({
      view: "human",
    });
    expect(resolveDaemonServiceManagerMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
  });

  it("returns cancelled when the sign-in prompt is dismissed in human view", async () => {
    runtimeContext = {
      resolvedView: "human",
      interactive: true,
    };
    getAuthSessionStateMock.mockResolvedValueOnce({
      state: "missing",
      session: null,
    });
    selectMock.mockResolvedValueOnce("__command_auth_cancel__");

    const { result } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "human",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "cancelled",
    });
    expect(runAuthLoginMock).not.toHaveBeenCalled();
    expect(resolveDaemonServiceManagerMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(runDaemonServiceLoopMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("returns a structured auth-required result before startup in agent view", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "agent",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "authentication_required",
    });
    expect(resolveDaemonServiceManagerMock).not.toHaveBeenCalled();
    expect(stdout).toContain('"reason":"authentication_required"');
    expect(stdout).toContain("openmeld login");
  });

  it("shows dependency unavailable instead of Started when dev-local startup boundary fails in human view", async () => {
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
    runDaemonServiceLoopMock.mockRejectedValue(new Error("fetch failed"));

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonRun({
          view: "human",
          mode: "foreground",
        });
      });

      expect(result).toEqual({
        ok: false,
        reason: "start_failed",
      });
      expect(process.exitCode).toBe(1);
      expect(stdout).toContain("OpenMeld Dev-Local Dependencies Unavailable");
      expect(stdout).toContain(
        "OpenMeld dev-local auth and gateway are unavailable"
      );
      expect(stdout).not.toContain("OpenMeld Service Started");
      expect(stdout).not.toContain("Started");
      expect(spawnMock).not.toHaveBeenCalled();
      expect(runDaemonServiceLoopMock).toHaveBeenCalled();
      expect(writeDaemonStartFailureStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "service_dependencies_unavailable",
        })
      );
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("returns dependency unavailable instead of Started when dev-local startup boundary fails in agent view", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
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
    runDaemonServiceLoopMock.mockRejectedValue(new Error("fetch failed"));

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "agent",
        mode: "foreground",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "start_failed",
    });
    expect(stdout).toContain('"reason":"service_dependencies_unavailable"');
    expect(stdout).toContain("pnpm dev");
    expect(stdout).not.toContain('"ok":true');
    expect(spawnMock).not.toHaveBeenCalled();
    expect(runDaemonServiceLoopMock).toHaveBeenCalled();
  });

  it("diagnoses remote dependency failures after startup fails in canary agent view", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    process.env.OPENMELD_ENV_PRESET = "canary";
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "test-access-token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-03-01T00:00:00.000Z",
        user: {
          id: "usr_123",
          email: "dev@openmeld.invalid",
        },
      },
    });
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.invalid");
    resolveDaemonServiceDependencyDiagnosticsMock.mockResolvedValue({
      applicable: true,
      ready: false,
      lane: "canary",
      scopePolicy: "all",
      issues: [
        {
          kind: "gateway",
          baseUrl: "https://gateway.openmeld.invalid",
          probeUrl: "https://gateway.openmeld.invalid/health",
          scope: "remote",
          status: "unreachable",
          httpStatus: null,
        },
      ],
      checkedUrls: {
        auth: "https://auth.openmeld.invalid",
        gateway: "https://gateway.openmeld.invalid",
      },
    });
    runDaemonServiceLoopMock.mockRejectedValue(new Error("fetch failed"));

    try {
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonRun({
          view: "agent",
          mode: "foreground",
        });
      });

      expect(result).toEqual({
        ok: false,
        reason: "start_failed",
      });
      expect(stdout).toContain('"reason":"service_dependencies_unavailable"');
      expect(stdout).toContain("https://gateway.openmeld.invalid");
      expect(writeDaemonStartFailureStateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "service_dependencies_unavailable",
        })
      );
    } finally {
      process.env.OPENMELD_ENV_PRESET = undefined;
    }
  });

  it("shows a gateway mismatch card before startup when sign-in targets another OpenMeld environment", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "test-access-token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.example.com",
        clientId: "openmeld-cli",
        createdAt: "2026-03-01T00:00:00.000Z",
        user: {
          id: "usr_123",
          email: "dev@openmeld.invalid",
        },
      },
    });
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.invalid");

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "human",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "authentication_environment_mismatch",
    });
    expect(stdout).toContain("Wrong OpenMeld Environment");
    expect(stdout).toContain(
      "What happened: Sign in to the right OpenMeld environment before starting OpenMeld Service."
    );
    expect(stdout).not.toContain("https://auth.example.com");
    expect(stdout).not.toContain("https://gateway.openmeld.invalid");
  });

  it("returns a structured mismatch result before startup in agent view", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: {
        v: 1,
        accessToken: "test-access-token",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.example.com",
        clientId: "openmeld-cli",
        createdAt: "2026-03-01T00:00:00.000Z",
        user: {
          id: "usr_123",
          email: "dev@openmeld.invalid",
        },
      },
    });
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.invalid");

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "agent",
      });
    });

    expect(result).toEqual({
      ok: false,
      reason: "authentication_environment_mismatch",
    });
    expect(stdout).toContain('"reason":"authentication_environment_mismatch"');
    expect(stdout).toContain("https://gateway.openmeld.invalid");
    expect(stdout).toContain("https://auth.example.com");
    const blockedPayload = parseAgentResultEnvelope(
      stdout,
      "daemon.run.auth_required"
    ) as {
      authBaseUrl?: string;
      gatewayUrl?: string;
      guidanceReason?: string;
    } | null;
    expect(blockedPayload).toMatchObject({
      authBaseUrl: "https://auth.example.com",
      gatewayUrl: "https://gateway.openmeld.invalid",
      guidanceReason: "mismatch",
    });
  });

  it("preserves the legacy already-running reason before auth preflight when runtime is active", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 777,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "human",
      });
    });

    expect(result).toEqual({
      ok: true,
      reason: "service_already_running",
    });
    expect(stdout).toContain("Service Already Running");
    expect(stdout).toContain("OpenMeld Service is already running.");
    expect(stdout).toContain("`openmeld service start` is not the repair step");
    expect(stdout).toContain("openmeld service status");
    expect(stdout).toContain("openmeld service repair");
    expect(stdout).not.toContain("run `openmeld service stop` first");
    expect(stdout).not.toContain("Sign In Required");
  });

  it("keeps the legacy already-running token in agent output", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 777,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });

    const { result, stdout } = await withCapturedStdio(async () => {
      return await runDaemonRun({
        view: "agent",
      });
    });

    expect(result).toEqual({
      ok: true,
      reason: "service_already_running",
    });
    expect(stdout).toContain('"ok":true');
    expect(stdout).toContain('"code":"daemon.run.already_running"');
    expect(stdout).toContain('"reason":"service_already_running"');
    expect(stdout).toContain('"lifecycleState":"running"');
    expect(stdout).toContain('"nextSteps":["openmeld service status"]');
    expect(stdout).toContain("`openmeld service start` is not the repair step");
    expect(stdout).toContain("openmeld service repair");
  });

  it("treats the legacy already-running reason as a successful background-start decision", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 777,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });

    const result = await runDaemonBackgroundStartForDecision({
      view: "human",
    });

    expect(result).toBe("started");
  });

  it("does not reopen command-entry authentication during an internal background-start decision", async () => {
    runtimeContext = {
      resolvedView: "human",
      interactive: true,
    };
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 777,
      startedAt: "2026-03-06T00:00:00.000Z",
      updatedAt: "2026-03-06T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "legacy-detached",
      autoStart: false,
    });
    selectMock.mockResolvedValueOnce("__command_auth_cancel__");

    const result = await runDaemonBackgroundStartForDecision({
      view: "human",
    });

    expect(result).toBe("started");
    expect(getAuthSessionStateMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("runs foreground loop when detached runtime marker is set", async () => {
    const previousDetachedFlag =
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
    process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";

    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });

    try {
      await runDaemonRun({
        view: "human",
        mode: "background",
      });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
      expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "background",
        })
      );
      expect(withDaemonServiceRunLockMock).not.toHaveBeenCalled();
    } finally {
      if (previousDetachedFlag === undefined) {
        delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      } else {
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = previousDetachedFlag;
      }
    }
  });

  it("releases the lifecycle lock before entering the foreground local service loop", async () => {
    runtimeContext.interactive = true;
    selectMock.mockResolvedValue("foreground");
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });
    runDaemonServiceLoopMock.mockImplementationOnce(() => {
      expect(releaseDaemonServiceLifecycleLockMock).toHaveBeenCalledTimes(1);
    });

    const result = await runDaemonRun({
      view: "human",
      mode: undefined,
    });

    expect(result).toEqual({
      ok: true,
      reason: "started",
    });
    expect(acquireDaemonServiceLifecycleLockMock).toHaveBeenCalledWith({
      command: "openmeld service run",
      intent: "run_foreground",
    });
    expect(withDaemonServiceRunLockMock).not.toHaveBeenCalled();
    expect(releaseDaemonServiceLifecycleLockMock).toHaveBeenCalledTimes(1);
  });

  it("keeps detached runtime runs silent so the background child does not depend on parent stdio", async () => {
    const previousDetachedFlag =
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
    process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";

    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });
    runDaemonServiceLoopMock.mockImplementationOnce((input) => {
      input.presenter.line({
        code: "daemon.test.line",
        text: "detached daemon line",
      });
      input.presenter.event("error", "connect.closed_with_code_reason", {
        code: 1000,
        reason: "test",
      });
      input.presenter.data({
        code: "daemon.test.data",
        payload: { ok: true },
      });
    });

    try {
      const { stdout, stderr, plainStdout, plainStderr } =
        await withCapturedStdio(async () => {
          await runDaemonRun({
            view: "human",
            mode: "background",
          });
        });

      expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
      expect(plainStdout).toBe("");
      expect(plainStderr).toBe("");
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    } finally {
      if (previousDetachedFlag === undefined) {
        delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      } else {
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = previousDetachedFlag;
      }
    }
  });

  it("skips cleanup gating when bootstrapped by the system service manager", async () => {
    const previousDetachedFlag =
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
    const previousSystemServiceFlag =
      process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
    process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";
    process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the lifecycle marker assertion.
    });

    inspectDaemonServiceInventoryMock.mockResolvedValue({
      expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      installStatus: DAEMON_RUNTIME_STATE,
      runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
      activeBundle: null,
      activeBundleSourceAvailable: null,
      activeBundleEntryPath: null,
      runtimeCommandEntryPath: null,
      runtimeCommandPathExists: null,
      serviceManager: null,
      serviceManagerStatus: {
        installed: true,
        running: true,
        enabled: true,
      },
      ownedProcesses: [],
      lifecycleLock: {
        intent: "run_background",
        command: "openmeld service run",
        pid: 27_039,
        at: "2026-03-13T13:07:54.909Z",
      },
      anomalies: [
        {
          code: "manager_running_without_runtime",
          message:
            "The OS service manager reports OpenMeld Service as running, but runtime state is not healthy.",
        },
        {
          code: "lifecycle_locked",
          message:
            "Another OpenMeld Service task is already running (openmeld service run, intent run_background pid 27039).",
        },
      ],
    });
    contractState = {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      bundleId: "service-bundle",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "human-default",
      deviceId: "device-real",
      heartbeatMs: 25_000,
      generation: 1,
      updatedAt: "2026-03-14T00:00:00.000Z",
    };
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    });

    try {
      const result = await runDaemonRun({
        view: "agent",
        mode: "background",
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      expect(inspectDaemonServiceInventoryMock).not.toHaveBeenCalled();
      expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
      expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "background",
        })
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[openmeld.daemon.lifecycle_started]")
      );
      const lifecycleLogLine = String(warnSpy.mock.calls[0]?.[0]);
      expect(lifecycleLogLine.split("\n")).toHaveLength(1);
      expect(lifecycleLogLine).toContain(
        `"cliVersion":"${packageJson.version}"`
      );
      expect(lifecycleLogLine).toContain(
        '"event":"cli.daemon.lifecycle_started"'
      );
      expect(lifecycleLogLine).toContain(`"pid":${String(process.pid)}`);
    } finally {
      if (previousDetachedFlag === undefined) {
        delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      } else {
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = previousDetachedFlag;
      }
      if (previousSystemServiceFlag === undefined) {
        delete process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
      } else {
        process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] =
          previousSystemServiceFlag;
      }
    }
  });

  it("writes the system-service lifecycle marker before startup cleanup can fail", async () => {
    await withTempHome(async () => {
      const previousDetachedFlag =
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      const previousSystemServiceFlag =
        process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";
      process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] = "1";
      clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockRejectedValueOnce(
        new Error("startup cleanup read failed")
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        // Keep test output focused on the lifecycle marker assertion.
      });

      try {
        await expect(
          runDaemonRun({
            mode: "background",
            view: "agent",
          })
        ).rejects.toThrow("startup cleanup read failed");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
          "[openmeld.daemon.lifecycle_started]"
        );
      } finally {
        if (previousDetachedFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] =
            previousDetachedFlag;
        }
        if (previousSystemServiceFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] =
            previousSystemServiceFlag;
        }
      }
    });
  });

  it("fails closed during system bootstrap when the persisted contract gateway points to the auth worker", async () => {
    await withTempHome(async () => {
      const previousDetachedFlag =
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      const previousSystemServiceFlag =
        process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";
      process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] = "1";
      contractState = {
        schema: "openmeld-daemon-service-contract-v1",
        v: 1,
        lane: "canary",
        daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
        bundleId: "service-bundle",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "http://localhost:8788",
        profileId: "agt_existing",
        deviceId: "device_123",
        heartbeatMs: 25_000,
        generation: 1,
        updatedAt: "2026-04-22T00:00:00.000Z",
      };
      resolveBaseUrlMock.mockImplementation((value?: string) => {
        const normalizedValue = String(value ?? "").trim();
        if (!normalizedValue) {
          return "https://gateway.openmeld.invalid";
        }
        if (normalizedValue === "http://localhost:8788") {
          throw new Error(
            "gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker"
          );
        }
        return "https://gateway.openmeld.invalid";
      });

      try {
        const { result } = await withCapturedStdio(async () => {
          return await runDaemonRun({
            view: "agent",
            mode: "background",
          });
        });

        expect(result).toEqual({
          ok: false,
          reason: "start_failed",
        });
        expect(runDaemonServiceLoopMock).not.toHaveBeenCalled();
      } finally {
        if (previousDetachedFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] =
            previousDetachedFlag;
        }
        if (previousSystemServiceFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] =
            previousSystemServiceFlag;
        }
      }
    });
  });

  it("synthesizes a missing service contract during system bootstrap from deterministic local state", async () => {
    await withTempHome(async () => {
      const previousDetachedFlag =
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      const previousSystemServiceFlag =
        process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";
      process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] = "1";
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );

      resolveDaemonServiceManagerMock.mockResolvedValue({
        controller: "launchd",
        install: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          installed: true,
          running: true,
          enabled: true,
        })),
      });
      resolveOpenMeldProfileOrNullMock.mockResolvedValue({
        openMeldProfileId: "agt_bootstrap",
      });

      try {
        const result = await runDaemonRun({
          view: "agent",
          mode: "background",
        });

        expect(result).toEqual({
          ok: true,
          reason: "started",
        });
        expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith(
          expect.objectContaining({
            daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
            bundleId: "service-bundle",
            desiredState: "background",
            serviceController: "launchd",
            autoStart: true,
            gatewayUrl: "https://gateway.openmeld.invalid",
            deviceId: "device_123",
            heartbeatMs: 25_000,
          })
        );
        expect(contractState).toEqual(
          expect.objectContaining({
            desiredState: "background",
            serviceController: "launchd",
            gatewayUrl: "https://gateway.openmeld.invalid",
            deviceId: "device_123",
            heartbeatMs: 25_000,
          })
        );
        expect(contractState).not.toHaveProperty("profileId");
        expect(inspectDaemonServiceInventoryMock).not.toHaveBeenCalled();
        expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
          expect.objectContaining({
            baseUrl: "https://gateway.openmeld.invalid",
            deviceId: "device_123",
            mode: "background",
            heartbeatIntervalMs: 25_000,
            profile: undefined,
          })
        );
      } finally {
        if (previousDetachedFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] =
            previousDetachedFlag;
        }
        if (previousSystemServiceFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] =
            previousSystemServiceFlag;
        }
      }
    });
  });

  it("does not persist runtime openMeldProfileId into a device-level bootstrap contract", async () => {
    await withTempHome(async () => {
      const previousDetachedFlag =
        process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
      const previousSystemServiceFlag =
        process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";
      process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] = "1";
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );

      resolveDaemonServiceManagerMock.mockResolvedValue({
        controller: "launchd",
        install: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          installed: true,
          running: true,
          enabled: true,
        })),
      });
      resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);
      runtimeContext = {
        resolvedView: "agent",
        interactive: false,
        openMeldProfileId: "agt_runtime_bootstrap",
      };

      try {
        const result = await runDaemonRun({
          view: "agent",
          mode: "background",
        });

        expect(result).toEqual({
          ok: true,
          reason: "started",
        });
        expect(upsertDaemonServiceContractMock).toHaveBeenCalledWith(
          expect.not.objectContaining({
            profileId: "agt_runtime_bootstrap",
          })
        );
        expect(contractState).toEqual(
          expect.not.objectContaining({
            profileId: "agt_runtime_bootstrap",
          })
        );
        expect(contractState).not.toHaveProperty("profileId");
        expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
          expect.objectContaining({
            profile: undefined,
          })
        );
      } finally {
        if (previousDetachedFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] =
            previousDetachedFlag;
        }
        if (previousSystemServiceFlag === undefined) {
          delete process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
        } else {
          process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] =
            previousSystemServiceFlag;
        }
      }
    });
  });

  it("does not reuse a stale persisted contract profile for the foreground local service loop", async () => {
    contractState = {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      bundleId: "service-bundle",
      desiredState: "stopped",
      serviceController: "launchd",
      autoStart: false,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "agt_stale_contract_profile",
      deviceId: "device_123",
      heartbeatMs: 25_000,
      generation: 4,
      updatedAt: "2026-03-22T00:00:00.000Z",
    };
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    resolveOpenMeldProfileOrNullMock.mockResolvedValue({
      openMeldProfileId: "agt_current_profile",
    });

    await runDaemonRun({
      view: "agent",
      mode: "foreground",
    });

    expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: undefined,
      })
    );
  });

  it("re-resolves the current gateway when rewriting a dirty detached background contract", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "0.2.9",
        bundleId: "service-bundle",
        desiredState: "stopped",
        serviceController: "legacy-detached",
        autoStart: false,
        gatewayUrl: "https://gateway.old.openmeld.invalid",
        profileId: "hum_existing_contract",
        deviceId: "device_install",
        heartbeatMs: 5000,
        lane: "prod",
      });

      runtimeContext = {
        resolvedView: "human",
        interactive: false,
        openMeldProfileId: "human-default",
      };
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );
      const childPid = process.pid;
      getObservedDaemonRuntimeStatusMock
        .mockResolvedValueOnce({
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
        })
        .mockResolvedValue({
          status: "running",
          mode: "background",
          pid: childPid,
          startedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "legacy-detached",
          autoStart: false,
        });

      const originalScriptPath = process.argv[1];
      process.argv[1] = "/usr/local/bin/openmeld";
      spawnMock.mockImplementation(() => {
        const child = createMockDetachedChildProcess(childPid);
        return child as never;
      });

      try {
        await runDaemonRun({
          view: "human",
        });

        expect(await readDaemonServiceContract()).toMatchObject({
          gatewayUrl: "https://gateway.openmeld.invalid",
        });
      } finally {
        process.argv[1] = originalScriptPath ?? process.execPath;
      }
    });
  });

  it("does not run startup-check preflight inside service run background startup", async () => {
    await withTempHome(async () => {
      runtimeContext = {
        resolvedView: "human",
        interactive: false,
      };
      resolveDaemonServiceManagerMock.mockResolvedValue(null);
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );
      runDaemonStartupPreflightMock.mockRejectedValue(
        new Error("startup-check preflight should not run inside service run")
      );

      const childPid = process.pid;
      getObservedDaemonRuntimeStatusMock
        .mockResolvedValueOnce({
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
        })
        .mockResolvedValue({
          status: "running",
          mode: "background",
          pid: childPid,
          startedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "legacy-detached",
          autoStart: false,
        });
      spawnMock.mockImplementation(() => {
        const child = createMockDetachedChildProcess(childPid);
        return child as never;
      });

      const result = await runDaemonRun({
        view: "human",
        mode: "background",
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      expect(runDaemonStartupPreflightMock).not.toHaveBeenCalled();
    });
  });

  it("prompts for mode in interactive mode and starts foreground when selected", async () => {
    runtimeContext = {
      resolvedView: "human",
      interactive: true,
    };
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });
    selectMock.mockResolvedValue("foreground");

    await runDaemonRun({
      view: "human",
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
    expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "foreground",
      })
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("reuses the persisted service-contract device id for foreground runs when no explicit device id is provided", async () => {
    contractState = {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      bundleId: "service-bundle",
      desiredState: "stopped",
      serviceController: "launchd",
      autoStart: false,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "human-default",
      deviceId: "device-from-contract",
      heartbeatMs: 25_000,
      generation: 2,
      updatedAt: "2026-03-22T00:00:00.000Z",
    };
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    });
    resolveDaemonDeviceIdMock.mockResolvedValue("device-from-contract");

    await runDaemonRun({
      view: "agent",
      mode: "foreground",
    });

    expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-from-contract",
        mode: "foreground",
      })
    );
  });

  function setupDeviceIdPrecedenceTest(): void {
    contractState = {
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "prod",
      daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      bundleId: "service-bundle",
      desiredState: "stopped",
      serviceController: "launchd",
      autoStart: false,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "human-default",
      deviceId: "device-from-contract",
      heartbeatMs: 25_000,
      generation: 2,
      updatedAt: "2026-03-22T00:00:00.000Z",
    };
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    });
  }

  it.each([
    {
      explicitDeviceId: "",
      expectedDeviceId: "device-from-contract",
      resolvedDeviceId: "device-from-contract",
      title:
        "treats an empty explicit device id as unset and falls back to the persisted contract",
    },
    {
      explicitDeviceId: "   ",
      expectedDeviceId: "device-from-contract",
      resolvedDeviceId: "device-from-contract",
      title:
        "treats a whitespace-only explicit device id as unset and falls back to the persisted contract",
    },
    {
      explicitDeviceId: "device-explicit",
      expectedDeviceId: "device-explicit",
      resolvedDeviceId: "device-explicit",
      title:
        "keeps a non-empty explicit device id ahead of the persisted contract",
    },
  ])("$title", async ({
    explicitDeviceId,
    expectedDeviceId,
    resolvedDeviceId,
  }) => {
    setupDeviceIdPrecedenceTest();
    resolveDaemonDeviceIdMock.mockResolvedValue(resolvedDeviceId);

    await runDaemonRun({
      view: "agent",
      mode: "foreground",
      deviceId: explicitDeviceId,
    });

    expect(runDaemonServiceLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: expectedDeviceId,
        mode: "foreground",
      })
    );
  });

  it("treats an already-running service as an idempotent start no-op", async () => {
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "foreground",
      pid: 555,
      startedAt: "2026-03-01T00:00.000Z",
      updatedAt: "2026-03-01T00:00.000Z",
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const result = await runDaemonRun({
        view: "human",
      });
      expect(result).toEqual({
        ok: true,
        reason: "service_already_running",
      });
      expect(process.exitCode).toBeUndefined();
      expect(spawnMock).not.toHaveBeenCalled();
      expect(runDaemonServiceLoopMock).not.toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("treats advisory service update drift as already running when the local service is execution-compatible", async () => {
    const runningRuntimeStatus = {
      status: "running" as const,
      mode: "background" as const,
      pid: 777,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd" as const,
      autoStart: true,
    };
    const serviceManagerStatus = {
      installed: true,
      running: true,
      enabled: true,
    };
    const serviceManager = {
      controller: "launchd" as const,
      install: vi.fn(async () => undefined),
      uninstall: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => serviceManagerStatus),
    };
    const inventory = withVerifiedExecutionEvidence(
      createAlignedBackgroundInventory({
        runtimeStatus: runningRuntimeStatus,
        serviceManager,
        serviceManagerStatus,
        anomalies: [
          {
            code: "bundle_content_drift",
            message:
              "OpenMeld Service is using older local service files than this lane expects.",
          },
        ],
      })
    );

    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    getObservedDaemonRuntimeStatusMock.mockResolvedValue(runningRuntimeStatus);
    resolveDaemonServiceManagerMock.mockResolvedValue(serviceManager);
    inspectDaemonServiceInventoryMock.mockResolvedValue(inventory);
    clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockResolvedValue({
      context: {
        status: DAEMON_RUNTIME_STATE,
        runtimeStatus: runningRuntimeStatus,
        serviceManager,
        serviceManagerStatus,
        legacySharedService: null,
        effectiveRuntimeStatus: "running",
      },
      cleared: false,
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonRun({
          view: "agent",
        });
      });

      expect(result).toEqual({
        ok: true,
        reason: "service_already_running",
      });
      expect(process.exitCode).toBeUndefined();
      expect(stdout).toContain('"code":"daemon.run.already_running"');
      expect(stdout).not.toContain('"code":"daemon.run.cleanup_required"');
      expect(stdout).not.toContain('"bundle_content_drift"');
      expect(runDaemonServiceLoopMock).not.toHaveBeenCalled();
      expect(serviceManager.start).not.toHaveBeenCalled();
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("takes over a running runtime state when the recorded pid is dead", async () => {
    const restoreSystemBootstrapEnv = useSystemServiceBootstrapEnv();
    const activeBundleEntryPath = `${daemonRuntimeBundlesPath()}/service-bundle/dist/openmeld.js`;
    const runtimeStatus = createRunningRuntimeStatus({ pid: 5555 });
    setSystemServiceBootstrapContract();
    getObservedDaemonRuntimeStatusMock.mockResolvedValue(runtimeStatus);
    readDaemonServiceRuntimeSnapshotMock.mockResolvedValue(
      createRuntimeStateSnapshot({
        command: `${process.execPath} ${activeBundleEntryPath} service run --mode foreground`,
        pid: 5555,
      })
    );
    processKillMock.mockImplementation((pid, signal) => {
      if (pid === 5555 && signal === 0) {
        const error = new Error("no such process") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return undefined;
    });

    try {
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonRun({
          view: "agent",
          mode: "background",
        });
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      expect(stdout).not.toContain("daemon.run.already_running");
      expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
      expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "runtime_state.takeover",
          result: "cleared",
          metadata: expect.objectContaining({
            pid: 5555,
            reason: "process_not_alive",
          }),
        })
      );
      expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
    } finally {
      restoreSystemBootstrapEnv();
    }
  });

  it("takes over a running runtime state when the recorded heartbeat is stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:10:00.000Z"));
    const restoreSystemBootstrapEnv = useSystemServiceBootstrapEnv();
    const runtimeStatus = createRunningRuntimeStatus({ pid: 6666 });
    setSystemServiceBootstrapContract();
    getObservedDaemonRuntimeStatusMock.mockResolvedValue(runtimeStatus);
    readDaemonServiceRuntimeSnapshotMock.mockResolvedValue(
      createRuntimeStateSnapshot({
        heartbeatAt: "2026-03-01T00:00:00.000Z",
        pid: 6666,
        updatedAt: "2026-03-01T00:00:00.000Z",
      })
    );

    try {
      const { result, stdout } = await withCapturedStdio(async () => {
        return await runDaemonRun({
          view: "agent",
          mode: "background",
        });
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      expect(stdout).not.toContain("daemon.run.already_running");
      expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
      expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "runtime_state.takeover",
          result: "cleared",
          metadata: expect.objectContaining({
            heartbeatAt: "2026-03-01T00:00:00.000Z",
            pid: 6666,
            reason: "heartbeat_stale",
          }),
        })
      );
      expect(runDaemonServiceLoopMock).toHaveBeenCalledTimes(1);
    } finally {
      restoreSystemBootstrapEnv();
    }
  });

  it("auto-repairs launchd bootstrap I/O startup failure and retries successfully", async () => {
    getObservedDaemonRuntimeStatusMock
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      })
      .mockResolvedValue({
        status: "running",
        mode: "background",
        pid: 7788,
        startedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      });

    const installMock = vi.fn(async () => undefined);
    const uninstallMock = vi.fn(async () => undefined);
    const startMock = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("bootstrap failed: 5: input/output error")
      )
      .mockResolvedValueOnce(undefined);
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: installMock,
      uninstall: uninstallMock,
      start: startMock,
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => ({
        installed: true,
        running: true,
        enabled: true,
      })),
    });
    inspectDaemonServiceInventoryMock.mockImplementation(() => {
      if (startMock.mock.calls.length < 2) {
        return Promise.resolve({
          expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
          installStatus: DAEMON_RUNTIME_STATE,
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
      }
      return Promise.resolve(createAlignedBackgroundInventory());
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonRun({
          view: "human",
        });
      });

      expect(process.exitCode).not.toBe(1);
      expect(installMock).toHaveBeenCalledTimes(2);
      expect(uninstallMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledTimes(2);
      expect(stdout).toContain(getDaemonStartStartedTitle());
      expect(stdout).toContain(formatDaemonStartAutoRepairResolvedMessage());
      expect(stdout).toContain(formatDaemonStartStartedMeaning());
      expect(stdout).toContain(formatDaemonStartStartedManage());
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("shows needs-attention guidance when system service startup fails", async () => {
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });
    const installMock = vi.fn(async () => undefined);
    const uninstallMock = vi.fn(async () => undefined);
    const startMock = vi.fn(() =>
      Promise.reject(new Error("bootstrap failed: 5: input/output error"))
    );
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: installMock,
      uninstall: uninstallMock,
      start: startMock,
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => ({
        installed: true,
        running: false,
        enabled: true,
      })),
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonRun({
          view: "human",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(installMock).toHaveBeenCalledTimes(2);
      expect(uninstallMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledTimes(2);
      expect(stdout).toContain("OpenMeld Service couldn't start");
      expect(stdout).toContain(
        "OpenMeld could not finish starting OpenMeld Service on this Mac."
      );
      expect(stdout).toContain("launchctl enable");
      expect(stdout).not.toContain("bootstrap failed");
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("keeps local log detail out of the human startup failure card", async () => {
    await withTempHome(async () => {
      const logPath = getDaemonSystemServiceLogPath();
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        "error: Cannot find module '/tmp/old-openmeld.js'\n",
        "utf8"
      );

      getObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      });
      resolveDaemonServiceManagerMock.mockResolvedValue({
        controller: "launchd",
        install: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
        start: vi.fn(async () => {
          await appendFile(
            logPath,
            "error: no OpenMeld profile is selected for this terminal session yet\n",
            "utf8"
          );
          throw new Error("bootstrap failed: 5: input/output error");
        }),
        stop: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          installed: true,
          running: false,
          enabled: true,
        })),
      });

      const previousExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonRun({
            view: "human",
          });
        });

        expect(process.exitCode).toBe(1);
        expect(stdout).toContain("OpenMeld Service couldn't start");
        expect(stdout).not.toContain("Last local detail");
        expect(stdout).not.toContain(
          "OpenMeld Service could not find a usable OpenMeld identity for this device."
        );
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it("does not surface stale log detail when the current start attempt writes no new service log", async () => {
    await withTempHome(async () => {
      const logPath = getDaemonSystemServiceLogPath();
      await mkdir(dirname(logPath), { recursive: true });
      await writeFile(
        logPath,
        "error: Cannot find module '/tmp/old-openmeld.js'\n",
        "utf8"
      );

      getObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      });
      resolveDaemonServiceManagerMock.mockResolvedValue({
        controller: "launchd",
        install: vi.fn(async () => undefined),
        uninstall: vi.fn(async () => undefined),
        start: vi.fn(() =>
          Promise.reject(new Error("bootstrap failed: 5: input/output error"))
        ),
        stop: vi.fn(async () => undefined),
        status: vi.fn(async () => ({
          installed: true,
          running: false,
          enabled: true,
        })),
      });

      const previousExitCode = process.exitCode;
      try {
        process.exitCode = undefined;
        const { stdout } = await withCapturedStdio(async () => {
          await runDaemonRun({
            view: "human",
          });
        });

        expect(process.exitCode).toBe(1);
        expect(stdout).not.toContain("Last local detail");
        expect(stdout).not.toContain(
          "OpenMeld Service is still pointing at a local CLI file that no longer exists."
        );
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  });

  it("waits for ready state and falls back to needs-attention when system manager never becomes ready", async () => {
    getObservedDaemonRuntimeStatusMock
      .mockResolvedValueOnce({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
      })
      .mockResolvedValue({
        status: "stale",
        mode: "background",
        pid: null,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
        reason: "process_not_alive",
      });
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: vi.fn(async () => undefined),
      uninstall: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => ({
        installed: true,
        running: true,
        enabled: true,
      })),
    });
    inspectDaemonServiceInventoryMock.mockImplementation(() => {
      return Promise.resolve({
        expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
        installStatus: DAEMON_RUNTIME_STATE,
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
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { stdout } = await withCapturedStdio(async () => {
        await runDaemonRun(
          {
            view: "human",
            mode: "background",
          },
          {
            systemServiceStartupPollMs: 1,
            systemServiceStartupWaitMs: 5,
          }
        );
      });

      const attentionCard = buildDaemonStartNeedsAttentionCard({
        summary: "OpenMeld could not finish starting OpenMeld Service.",
        nextStep:
          "Run `openmeld service repair` once. OpenMeld saved the startup evidence for diagnostics.",
      });
      expect(process.exitCode).toBe(1);
      expect(stdout).toContain(attentionCard.title);
      expect(stdout).toContain(attentionCard.rows[0]?.value ?? "");
      expect(stdout).toContain(attentionCard.rows[1]?.value ?? "");
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("waits through launchd restart backoff before reporting background start success", async () => {
    let inventoryPolls = 0;

    getObservedDaemonRuntimeStatusMock.mockImplementation(() => {
      if (getObservedDaemonRuntimeStatusMock.mock.calls.length <= 1) {
        return Promise.resolve({
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
        });
      }

      if (getObservedDaemonRuntimeStatusMock.mock.calls.length < 6) {
        return Promise.resolve({
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        });
      }

      return Promise.resolve({
        status: "running",
        mode: "background",
        pid: 7788,
        startedAt: "2026-03-01T00:00:11.000Z",
        updatedAt: "2026-03-01T00:00:11.000Z",
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
    });
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: vi.fn(async () => undefined),
      uninstall: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => ({
        installed: true,
        running: true,
        enabled: true,
      })),
    });
    inspectDaemonServiceInventoryMock.mockImplementation(() => {
      inventoryPolls += 1;
      if (inventoryPolls < 6) {
        return Promise.resolve({
          expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
          installStatus: DAEMON_RUNTIME_STATE,
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
      }
      return Promise.resolve(
        createAlignedBackgroundInventory({
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 7788,
            startedAt: "2026-03-01T00:00:11.000Z",
            updatedAt: "2026-03-01T00:00:11.000Z",
            managedBySystemService: true,
            serviceController: "launchd",
            autoStart: true,
          },
        })
      );
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const serviceProgress = {
        detail: vi.fn(),
      };
      const { result, stdout } = await withCapturedStdio(() => {
        return runDaemonRun(
          {
            view: "human",
            mode: "background",
            serviceProgress,
          },
          {
            systemServiceStartupPollMs: 1,
            systemServiceStartupWaitMs: 10,
          }
        );
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      expect(serviceProgress.detail).toHaveBeenCalledWith({
        code: "daemon.service.install",
        text: "Installing OpenMeld Service launcher...",
      });
      expect(serviceProgress.detail).toHaveBeenCalledWith({
        code: "daemon.service.start",
        text: "Starting OpenMeld Service with macOS...",
      });
      expect(serviceProgress.detail).toHaveBeenCalledWith({
        code: "daemon.service.wait_running",
        text: "Waiting for OpenMeld Service to become ready (up to 1s)...",
      });
      expect(
        runDaemonServiceManagerActionMock.mock.calls.map(
          ([input]) =>
            (
              input as unknown as {
                action: string;
                command?: string;
                intent?: string;
              }
            ).action
        )
      ).toEqual(["install", "start", "wait_running"]);
      expect(runDaemonServiceManagerActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "wait_running",
          command: "openmeld service run",
          controller: "launchd",
          intent: "run_background",
        })
      );
      expect(inventoryPolls).toBeGreaterThan(1);
      expect(stdout).toContain(getDaemonStartStartedTitle());
      expect(stdout).toContain(formatDaemonStartStartedMeaning());
      expect(stdout).toContain("Ready in");
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("treats a running local service runtime as started even if launchd status has not caught up yet", async () => {
    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: vi.fn(async () => undefined),
      uninstall: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => ({
        installed: true,
        running: false,
        enabled: true,
      })),
    });
    inspectDaemonServiceInventoryMock.mockResolvedValue(
      createAlignedBackgroundInventory({
        serviceManagerStatus: {
          installed: true,
          running: false,
          enabled: true,
        },
      })
    );

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { result, stdout } = await withCapturedStdio(() => {
        return runDaemonRun(
          {
            gatewayUrl: "https://gateway.openmeld.invalid",
            profile: "human-default",
            view: "human",
            mode: "background",
          },
          {
            systemServiceStartupPollMs: 1,
            systemServiceStartupWaitMs: 10,
          }
        );
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      expect(stdout).toContain(getDaemonStartStartedTitle());
      expect(stdout).not.toContain("OpenMeld Service Needs Attention");
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("treats a running launchd service with advisory drift as a successful background start", async () => {
    let inventoryPolls = 0;

    resolveDaemonServiceManagerMock.mockResolvedValue({
      controller: "launchd",
      install: vi.fn(async () => undefined),
      uninstall: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      status: vi.fn(async () => ({
        installed: true,
        running: true,
        enabled: true,
      })),
    });
    inspectDaemonServiceInventoryMock.mockImplementation(() => {
      inventoryPolls += 1;
      if (inventoryPolls === 1) {
        return Promise.resolve({
          expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
          installStatus: DAEMON_RUNTIME_STATE,
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
      }
      return Promise.resolve(
        createAlignedBackgroundInventory({
          anomalies: [
            {
              code: "service_manager_path_drift",
              message:
                "The OS service manager is still pointing at an old CLI path instead of the OpenMeld-managed stable launcher.",
            },
          ],
        })
      );
    });

    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      const { result, stdout } = await withCapturedStdio(() => {
        return runDaemonRun(
          {
            gatewayUrl: "https://gateway.openmeld.invalid",
            profile: "human-default",
            view: "human",
            mode: "background",
          },
          {
            systemServiceStartupPollMs: 1,
            systemServiceStartupWaitMs: 10,
          }
        );
      });

      expect(result).toEqual({
        ok: true,
        reason: "started",
      });
      const contract = await readDaemonServiceContract();
      expect(contract).toMatchObject({
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
      });
      expect(contract).not.toHaveProperty("profileId");
      expect(stdout).toContain(getDaemonStartStartedTitle());
      expect(stdout).not.toContain("OpenMeld Service Needs Attention");
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

describe("openmeld service stop command", () => {
  let processKillSpy: { mockRestore: () => void } | null = null;

  beforeEach(() => {
    requestLocalDaemonShutdownMock.mockReset().mockResolvedValue({
      accepted: true,
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    getDaemonStatusMock.mockReset();
    getObservedDaemonRuntimeStatusMock.mockReset();
    clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockReset();
    clearDaemonServiceRuntimeStateMock.mockReset();
    clearDaemonServiceContractMock.mockReset().mockImplementation(() => {
      contractState = null;
    });
    readDaemonServiceContractMock
      .mockReset()
      .mockImplementation(() => Promise.resolve(contractState));
    resolveAlignedDaemonActiveBundleEntryPathMock
      .mockReset()
      .mockResolvedValue(
        "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js"
      );
    upsertDaemonServiceContractMock.mockReset().mockImplementation((input) => {
      const next: ServiceContract = {
        schema: "openmeld-daemon-service-contract-v1" as const,
        v: 1 as const,
        lane: input.lane ?? "prod",
        daemonVersion: input.daemonVersion,
        bundleId: input.bundleId,
        desiredState: input.desiredState,
        serviceController: input.serviceController,
        autoStart: input.autoStart,
        gatewayUrl: input.gatewayUrl,
        ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
        ...(input.profileId ? { profileId: input.profileId } : {}),
        deviceId: input.deviceId,
        heartbeatMs: input.heartbeatMs,
        generation: contractState ? contractState.generation + 1 : 1,
        updatedAt: "2026-03-14T00:00:00.000Z",
      };
      const isSameContract =
        contractState !== null &&
        contractState.lane === next.lane &&
        contractState.daemonVersion === next.daemonVersion &&
        contractState.bundleId === next.bundleId &&
        contractState.desiredState === next.desiredState &&
        contractState.serviceController === next.serviceController &&
        contractState.autoStart === next.autoStart &&
        contractState.gatewayUrl === next.gatewayUrl &&
        contractState.ownerUserId === next.ownerUserId &&
        contractState.profileId === next.profileId &&
        contractState.deviceId === next.deviceId &&
        contractState.heartbeatMs === next.heartbeatMs;
      if (isSameContract) {
        return Promise.resolve(contractState);
      }
      contractState = next;
      return Promise.resolve(next);
    });
    withDaemonServiceRunLockMock.mockClear();
    withDaemonServiceStopLockMock.mockClear();
    emitDaemonLifecycleEventMock.mockReset().mockResolvedValue(undefined);
    hasActiveDaemonOwnersMock.mockReset().mockReturnValue(false);
    selectMock.mockReset();
    confirmMock.mockReset();
    ensureDaemonRuntimePathsMock.mockReset().mockResolvedValue({
      contractMetaPath: "/tmp/daemon/contract-meta.json",
      contractRepairReportPath: "/tmp/daemon/repair-report.json",
      contextStorePath: "/tmp/daemon/context-store.json",
      dataRootPath: "/tmp/daemon/data",
      deviceIdPath: "/tmp/daemon/device-id",
      ledgerRootPath: "/tmp/daemon/ledger",
    });
    resolveDaemonDeviceIdMock.mockReset().mockResolvedValue("device_123");
    isCancelMock
      .mockReset()
      .mockImplementation((value: unknown) => value === "__cancel__");
    runDaemonServiceLoopMock.mockReset();
    spawnMock.mockReset();

    getDaemonStatusMock.mockResolvedValue(DAEMON_RUNTIME_STATE);
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "foreground",
      pid: 222,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    });
    readCurrentDaemonOwnerSnapshotMock
      .mockReset()
      .mockImplementation(async () => {
        const runtimeStatus = await getObservedDaemonRuntimeStatusMock();
        const serviceManager =
          runtimeStatus?.managedBySystemService === true
            ? await resolveDaemonServiceManagerMock(
                runtimeStatus.serviceController
              )
            : null;
        const serviceManagerStatus = serviceManager
          ? await serviceManager.status()
          : null;
        let activeOwnerKinds: string[] = [];
        if (runtimeStatus?.status === "running") {
          activeOwnerKinds = runtimeStatus.managedBySystemService
            ? ["system_service"]
            : ["cli_direct"];
        }
        return {
          runtimeStatus,
          serviceManager,
          serviceManagerStatus,
          ownedProcesses: [],
          effectiveRuntimeStatus:
            runtimeStatus?.status === "running"
              ? "running"
              : runtimeStatus.status,
          systemServiceRegistrationPresent:
            runtimeStatus?.managedBySystemService === true ||
            serviceManagerStatus?.installed === true ||
            serviceManagerStatus?.running === true,
          activeOwnerKinds,
          ownerSetSummary:
            activeOwnerKinds.length === 0 ? "no_owner" : "single_owner",
          mustStopManagerFirst:
            runtimeStatus?.managedBySystemService === true ||
            serviceManagerStatus?.installed === true ||
            serviceManagerStatus?.running === true,
        };
      });
    runDaemonServiceManagerActionMock
      .mockReset()
      .mockImplementation(
        async (input: { run: () => Promise<unknown> }) => await input.run()
      );
    clearDaemonRuntimeStateIfDefinitelyStoppedMock.mockResolvedValue({
      context: {
        status: DAEMON_RUNTIME_STATE,
        runtimeStatus: {
          status: "running",
          mode: "foreground",
          pid: 222,
          startedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
        serviceManager: null,
        serviceManagerStatus: null,
        legacySharedService: null,
        effectiveRuntimeStatus: "running",
      },
      cleared: false,
    });
    clearDaemonServiceRuntimeStateMock.mockResolvedValue(undefined);
    resolveBaseUrlMock
      .mockReset()
      .mockResolvedValue("https://gateway.openmeld.invalid");
    resolveOpenMeldProfileOrNullMock.mockReset().mockResolvedValue(null);
    runtimeContext = {
      resolvedView: "human",
      interactive: true,
    };
    processKillMock.mockReset();
    processKillSpy = vi.spyOn(process, "kill").mockImplementation(((
      pid: number,
      signal?: NodeJS.Signals | number
    ) => {
      return processKillMock(pid, signal);
    }) as typeof process.kill);
  });

  afterEach(() => {
    if (processKillSpy) {
      processKillSpy.mockRestore();
      processKillSpy = null;
    }
    vi.restoreAllMocks();
  });

  it("confirms in human interactive mode and sends SIGTERM by default", async () => {
    confirmMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    processKillMock.mockImplementation(
      (_pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0) {
          const error = new Error("process not found");
          (error as NodeJS.ErrnoException).code = "ESRCH";
          throw error;
        }
        return true;
      }
    );

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemonStop({
        view: "human",
      });
    });

    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(processKillMock).toHaveBeenCalledWith(222, "SIGTERM");
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
    expect(stdout).toContain(
      "Service process (pid=222) stop request sent (SIGTERM)."
    );
    expect(withDaemonServiceStopLockMock).toHaveBeenCalledTimes(1);
  });

  it("stops the direct process before clearing registered system service state", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };

    let processExited = false;
    const notRunningRuntimeStatus = {
      status: "not_running" as const,
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown" as const,
      autoStart: false,
    };
    const serviceManagerStopMock = vi.fn(async () => undefined);
    const serviceManager = {
      controller: "launchd" as const,
      install: async () => undefined,
      uninstall: async () => undefined,
      enableAutostart: async () => undefined,
      disableAutostart: async () => undefined,
      start: async () => undefined,
      stop: serviceManagerStopMock,
      deactivate: async () => undefined,
      status: async () => ({
        installed: true,
        running: false,
        enabled: !processExited,
      }),
      waitUntilAbsent: async () => undefined,
      waitUntilStopped: async () => undefined,
      waitUntilRunning: async () => undefined,
    };

    getObservedDaemonRuntimeStatusMock.mockImplementation(async () =>
      processExited
        ? notRunningRuntimeStatus
        : {
            status: "running" as const,
            mode: "foreground" as const,
            pid: 222,
            startedAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
            managedBySystemService: false,
            serviceController: "unknown" as const,
            autoStart: false,
          }
    );
    readCurrentDaemonOwnerSnapshotMock
      .mockResolvedValueOnce({
        runtimeStatus: {
          status: "running" as const,
          mode: "foreground" as const,
          pid: 222,
          startedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          managedBySystemService: false,
          serviceController: "unknown" as const,
          autoStart: false,
        },
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          enabled: true,
          running: false,
        },
        ownedProcesses: [
          {
            pid: 222,
            parentPid: 111,
            command: "openmeld service run --mode foreground",
            mode: "foreground" as const,
            ownership: "cli_direct" as const,
          },
        ],
        effectiveRuntimeStatus: "running" as const,
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: ["cli_direct"],
        ownerSetSummary: "single_owner" as const,
        mustStopManagerFirst: true,
      })
      .mockResolvedValue({
        runtimeStatus: notRunningRuntimeStatus,
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          enabled: false,
          running: false,
        },
        ownedProcesses: [],
        effectiveRuntimeStatus: "not_running",
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: [],
        ownerSetSummary: "no_owner",
        mustStopManagerFirst: false,
      });
    processKillMock.mockImplementation(
      (_pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === "SIGTERM") {
          processExited = true;
          return true;
        }
        if (signal === 0 && processExited) {
          const error = new Error("process not found");
          (error as NodeJS.ErrnoException).code = "ESRCH";
          throw error;
        }
        return true;
      }
    );

    const result = await runDaemonStop({
      view: "agent",
    });

    expect(result).toEqual({
      status: "stopped",
      pid: 222,
      signal: "SIGTERM",
    });
    expect(processKillMock).toHaveBeenCalledWith(222, "SIGTERM");
    expect(serviceManagerStopMock).toHaveBeenCalledTimes(1);
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalled();
  });

  it("drains a managed service before asking the system manager to stop it", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    const actions: string[] = [];
    requestLocalDaemonShutdownMock.mockImplementationOnce(() => {
      actions.push("drain");
      return Promise.resolve({
        accepted: true,
        gracePeriodMs: 5000,
        mode: "graceful",
      });
    });
    let managerStopped = false;
    const serviceManager = {
      controller: "launchd" as const,
      install: async () => undefined,
      uninstall: async () => undefined,
      enableAutostart: async () => undefined,
      disableAutostart: () => {
        actions.push("disable_autostart");
        return Promise.resolve();
      },
      start: async () => undefined,
      stop: () => {
        actions.push("manager_stop");
        managerStopped = true;
        return Promise.resolve();
      },
      deactivate: async () => undefined,
      status: async () => ({
        installed: true,
        running: !managerStopped,
        enabled: !managerStopped,
      }),
      waitUntilAbsent: async () => undefined,
      waitUntilStopped: async () => undefined,
      waitUntilRunning: async () => undefined,
    };
    const runningRuntimeStatus = {
      status: "running" as const,
      mode: "background" as const,
      pid: 333,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd" as const,
      autoStart: true,
    };
    readCurrentDaemonOwnerSnapshotMock
      .mockResolvedValueOnce({
        runtimeStatus: runningRuntimeStatus,
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          enabled: true,
          running: true,
        },
        ownedProcesses: [],
        effectiveRuntimeStatus: "running",
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: ["system_service"],
        ownerSetSummary: "single_owner" as const,
        mustStopManagerFirst: true,
      })
      .mockResolvedValue({
        runtimeStatus: NOT_RUNNING_RUNTIME_STATUS,
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          enabled: false,
          running: false,
        },
        ownedProcesses: [],
        effectiveRuntimeStatus: "not_running",
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: [],
        ownerSetSummary: "no_owner" as const,
        mustStopManagerFirst: false,
      });
    getObservedDaemonRuntimeStatusMock.mockResolvedValue(
      NOT_RUNNING_RUNTIME_STATUS
    );

    await runDaemonStop({
      view: "agent",
    });

    expect(actions).toEqual(["disable_autostart", "drain", "manager_stop"]);
  });

  it("keeps a managed service running and restores autostart when the final heartbeat cannot drain", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    requestLocalDaemonShutdownMock.mockRejectedValueOnce(
      new Error("final heartbeat was not accepted")
    );
    const enableAutostartMock = vi.fn(async () => undefined);
    const disableAutostartMock = vi.fn(async () => undefined);
    const serviceManagerStopMock = vi.fn(async () => undefined);
    const serviceManager = {
      controller: "launchd" as const,
      install: async () => undefined,
      uninstall: async () => undefined,
      enableAutostart: enableAutostartMock,
      disableAutostart: disableAutostartMock,
      start: async () => undefined,
      stop: serviceManagerStopMock,
      deactivate: async () => undefined,
      status: async () => ({
        installed: true,
        running: true,
        enabled: true,
      }),
      waitUntilAbsent: async () => undefined,
      waitUntilStopped: async () => undefined,
      waitUntilRunning: async () => undefined,
    };
    const runningRuntimeStatus = {
      status: "running" as const,
      mode: "background" as const,
      pid: 444,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd" as const,
      autoStart: true,
    };
    readCurrentDaemonOwnerSnapshotMock.mockResolvedValue({
      runtimeStatus: runningRuntimeStatus,
      serviceManager,
      serviceManagerStatus: {
        installed: true,
        enabled: true,
        running: true,
      },
      ownedProcesses: [],
      effectiveRuntimeStatus: "running",
      systemServiceRegistrationPresent: true,
      activeOwnerKinds: ["system_service"],
      ownerSetSummary: "single_owner" as const,
      mustStopManagerFirst: true,
    });

    await expect(
      runDaemonStop({
        view: "agent",
      })
    ).rejects.toThrow(
      "OpenMeld Service stayed running because its final offline status could not be delivered"
    );

    expect(disableAutostartMock).toHaveBeenCalledTimes(1);
    expect(enableAutostartMock).toHaveBeenCalledTimes(1);
    expect(serviceManagerStopMock).not.toHaveBeenCalled();
  });

  it("sends SIGKILL in non-interactive force-stop path and outputs structured result for agent view", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };
    confirmMock.mockResolvedValue(true);
    processKillMock.mockImplementation(() => true);
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "running",
      mode: "background",
      pid: 111,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemonStop({
        view: "agent",
        force: true,
      });
    });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(processKillMock).toHaveBeenCalledWith(111, "SIGKILL");
    const payload = parseAgentResultEnvelope(stdout, "daemon.stop.result");
    expect(payload).toMatchObject({ ok: true, signal: "SIGKILL", pid: 111 });
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
  });

  it("marks the existing service contract as stopped after a successful stop", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "1.0.0",
        bundleId: "service-bundle",
        desiredState: "background",
        serviceController: "legacy-detached",
        autoStart: true,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "human-default",
        deviceId: "device-real",
        heartbeatMs: 5000,
      });

      runtimeContext = {
        resolvedView: "agent",
        interactive: false,
      };
      processKillMock.mockImplementation(() => true);
      getObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "running",
        mode: "background",
        pid: 111,
        startedAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
        managedBySystemService: false,
        serviceController: "legacy-detached",
        autoStart: true,
      });

      await runDaemonStop({
        view: "agent",
        force: true,
      });

      expect(await readDaemonServiceContract()).toMatchObject({
        desiredState: "stopped",
        autoStart: false,
        bundleId: "service-bundle",
      });
    });
  });

  it("returns not-running payload when no process exists", async () => {
    getObservedDaemonRuntimeStatusMock.mockResolvedValue({
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
    });

    const { stdout } = await withCapturedStdio(async () => {
      await runDaemonStop({
        view: "human",
      });
    });

    expect(stdout).toContain("Service is not running.");
    expect(processKillMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(clearDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
  });

  it("migrates legacy stop state into a stopped service contract when contract is missing", async () => {
    await withTempHome(async () => {
      runtimeContext = {
        resolvedView: "agent",
        interactive: false,
        openMeldProfileId: "human-default",
      };
      contractState = null;
      resolveAlignedDaemonActiveBundleEntryPathMock.mockResolvedValue(
        `${process.env.OPENMELD_HOME}/runtime/daemon/bundles/service-bundle/dist/openmeld.js`
      );
      getObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });

      await runDaemonStop({
        view: "agent",
      });

      const contract = await readDaemonServiceContract();
      expect(contract).toMatchObject({
        daemonVersion: packageJson.version,
        bundleId: "service-bundle",
        desiredState: "stopped",
        serviceController: "launchd",
        autoStart: false,
        gatewayUrl: "https://gateway.openmeld.invalid",
        deviceId: "device_123",
      });
      expect(contract).not.toHaveProperty("profileId");
    });
  });

  it("does not write a stopped contract while another local service owner is still active", async () => {
    await withTempHome(async () => {
      await upsertDaemonServiceContract({
        daemonVersion: "1.0.0",
        bundleId: "service-bundle",
        desiredState: "background",
        serviceController: "launchd",
        autoStart: true,
        gatewayUrl: "https://gateway.openmeld.invalid",
        profileId: "human-default",
        deviceId: "device_123",
        heartbeatMs: 5000,
      });

      runtimeContext = {
        resolvedView: "agent",
        interactive: false,
        openMeldProfileId: "human-default",
      };
      getObservedDaemonRuntimeStatusMock.mockResolvedValue({
        status: "not_running",
        mode: null,
        pid: null,
        startedAt: null,
        updatedAt: null,
        managedBySystemService: true,
        serviceController: "launchd",
        autoStart: true,
      });
      readCurrentDaemonOwnerSnapshotMock.mockResolvedValue({
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: true,
          serviceController: "launchd",
          autoStart: true,
        },
        serviceManager: {
          controller: "launchd",
        },
        serviceManagerStatus: {
          installed: true,
          enabled: true,
          running: false,
        },
        ownedProcesses: [],
        effectiveRuntimeStatus: "not_running",
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: [],
        ownerSetSummary: "no_owner",
        mustStopManagerFirst: true,
      });

      await runDaemonStop({
        view: "agent",
      });

      expect(await readDaemonServiceContract()).toMatchObject({
        desiredState: "background",
        autoStart: true,
      });
    });
  });

  it("reports the final owner pid when a different local service owner remains after system service stop", async () => {
    runtimeContext = {
      resolvedView: "agent",
      interactive: false,
    };

    const initialRuntimeStatus = {
      status: "running" as const,
      mode: "background" as const,
      pid: 111,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd" as const,
      autoStart: true,
    };
    const finalRuntimeStatus = {
      status: "running" as const,
      mode: "foreground" as const,
      pid: 222,
      startedAt: "2026-03-01T00:01:00.000Z",
      updatedAt: "2026-03-01T00:01:00.000Z",
      managedBySystemService: false,
      serviceController: "unknown" as const,
      autoStart: false,
    };
    const serviceManagerStopMock = vi.fn(async () => undefined);
    const serviceManager = {
      controller: "launchd" as const,
      install: async () => undefined,
      uninstall: async () => undefined,
      enableAutostart: async () => undefined,
      disableAutostart: async () => undefined,
      start: async () => undefined,
      stop: serviceManagerStopMock,
      deactivate: async () => undefined,
      status: async () => ({
        installed: true,
        running: false,
        enabled: false,
      }),
      waitUntilAbsent: async () => undefined,
      waitUntilStopped: async () => undefined,
      waitUntilRunning: async () => undefined,
    };

    readCurrentDaemonOwnerSnapshotMock
      .mockResolvedValueOnce({
        runtimeStatus: initialRuntimeStatus,
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          enabled: true,
          running: true,
        },
        ownedProcesses: [],
        effectiveRuntimeStatus: "running",
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: ["system_service"],
        ownerSetSummary: "single_owner" as const,
        mustStopManagerFirst: true,
      })
      .mockResolvedValueOnce({
        runtimeStatus: finalRuntimeStatus,
        serviceManager,
        serviceManagerStatus: {
          installed: true,
          enabled: true,
          running: false,
        },
        ownedProcesses: [],
        effectiveRuntimeStatus: "running",
        systemServiceRegistrationPresent: true,
        activeOwnerKinds: ["cli_direct"],
        ownerSetSummary: "single_owner" as const,
        mustStopManagerFirst: true,
      });
    getObservedDaemonRuntimeStatusMock.mockResolvedValue(
      NOT_RUNNING_RUNTIME_STATUS
    );
    hasActiveDaemonOwnersMock.mockReturnValue(true);

    const result = await runDaemonStop({
      view: "agent",
    });

    expect(result).toEqual({
      status: "warning",
      pid: 222,
      reason: "stop_failed",
      runtimeStatus: finalRuntimeStatus,
      errorMessage:
        "local service owners are still active after stopping the system service",
    });
    expect(serviceManagerStopMock).toHaveBeenCalledTimes(1);
    expect(clearDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
  });
});

function createMockDetachedChildProcess(
  pid: number,
  options?: {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
  }
): EventEmitter & {
  pid: number;
  unref: () => void;
  stdout?: EventEmitter;
  stderr?: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: () => void;
    stdout?: EventEmitter;
    stderr?: EventEmitter;
  };
  child.pid = pid;
  child.unref = vi.fn();
  if (options?.stdout !== undefined) {
    const stdout = new EventEmitter();
    child.stdout = stdout;
    queueMicrotask(() => {
      stdout.emit("data", options.stdout);
    });
  }
  if (options?.stderr !== undefined) {
    const stderr = new EventEmitter();
    child.stderr = stderr;
    queueMicrotask(() => {
      stderr.emit("data", options.stderr);
    });
  }
  queueMicrotask(() => {
    child.emit("spawn");
  });
  if (typeof options?.exitCode === "number") {
    queueMicrotask(() => {
      child.emit("exit", options.exitCode, null);
    });
  }
  return child;
}

function createMockCommandChildProcess(options?: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}): EventEmitter & {
  pid: number;
  unref: () => void;
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: () => void;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.pid = 99_123;
  child.unref = vi.fn();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  queueMicrotask(() => {
    child.emit("spawn");
    if (options?.stdout) {
      child.stdout.emit("data", options.stdout);
    }
    if (options?.stderr) {
      child.stderr.emit("data", options.stderr);
    }
    const exitCode = options?.exitCode ?? 0;
    child.emit("exit", exitCode, null);
    child.emit("close", exitCode, null);
  });

  return child;
}

function parseAgentResultEnvelope(stdout: string, code: string): unknown {
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
      if (parsed.type === "result" && parsed.code === code) {
        return parsed.payload;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function createAlignedBackgroundInventory(
  overrides: Record<string, unknown> = {}
) {
  return {
    expectedVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
    installStatus: DAEMON_RUNTIME_STATE,
    runtimeStatus: {
      status: "running",
      mode: "background",
      pid: 7788,
      startedAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    },
    activeBundle: {
      v: 2,
      schema: "openmeld-daemon-active-bundle-v2",
      bundleId: "service-bundle",
      daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
      entryScriptRelativePath: "dist/openmeld.js",
      bundleFormat: "self_contained_v1",
      sourceEntryScriptPath: "/tmp/current-cli/dist/openmeld.js",
      sourcePackageRootPath: "/tmp/current-cli",
      sourceDistRootPath: "/tmp/current-cli/dist",
      sourceKind: "package_install",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
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
    ownedProcesses: [],
    lifecycleLock: null,
    anomalies: [],
    ...overrides,
  };
}

function withVerifiedExecutionEvidence(
  inventory: ReturnType<typeof createAlignedBackgroundInventory>
): ReturnType<typeof createAlignedBackgroundInventory> &
  Record<string, unknown> {
  return {
    ...inventory,
    activeBundleEntryPath:
      "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
    runtimeCommandEntryPath:
      "/tmp/.openmeld/runtime/daemon/bundles/service-bundle/dist/openmeld.js",
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
      daemonVersion: inventory.expectedVersion,
      bundleId: "service-bundle",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "https://gateway.openmeld.invalid",
      profileId: "human-default",
      deviceId: "device-test",
      heartbeatMs: 25_000,
      generation: 1,
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  };
}

function useSystemServiceBootstrapEnv(): () => void {
  const previousDetachedFlag = process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
  const previousSystemServiceFlag =
    process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
  process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = "1";
  process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] = "1";
  return () => {
    if (previousDetachedFlag === undefined) {
      delete process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV];
    } else {
      process.env[DAEMON_SERVICE_RUNTIME_DETACHED_ENV] = previousDetachedFlag;
    }
    if (previousSystemServiceFlag === undefined) {
      delete process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV];
    } else {
      process.env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] =
        previousSystemServiceFlag;
    }
  };
}

function setSystemServiceBootstrapContract(
  overrides: Partial<ServiceContract> = {}
): void {
  contractState = {
    schema: "openmeld-daemon-service-contract-v1",
    v: 1,
    lane: "prod",
    daemonVersion: DAEMON_RUNTIME_STATE.state.daemonVersion,
    bundleId: "service-bundle",
    desiredState: "background",
    serviceController: "launchd",
    autoStart: true,
    gatewayUrl: "https://gateway.openmeld.invalid",
    profileId: "human-default",
    deviceId: "device-real",
    heartbeatMs: 25_000,
    generation: 1,
    updatedAt: "2026-03-14T00:00:00.000Z",
    ...overrides,
  };
}

function createRunningRuntimeStatus(
  overrides: Partial<{
    autoStart: boolean;
    managedBySystemService: boolean;
    mode: "foreground" | "background";
    pid: number;
    serviceController: "launchd" | "systemd" | "legacy-detached" | "unknown";
    startedAt: string | null;
    updatedAt: string | null;
  }> & { pid: number }
) {
  const { pid, ...rest } = overrides;
  return {
    status: "running" as const,
    mode: "background" as const,
    pid,
    startedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    managedBySystemService: true,
    serviceController: "launchd" as const,
    autoStart: true,
    ...rest,
  };
}

function createRuntimeStateSnapshot(
  overrides: Partial<{
    autoStart: boolean;
    command: string;
    gatewayUrl: string | null;
    heartbeatAt: string | null;
    managedBySystemService: boolean;
    mode: "foreground" | "background";
    pid: number;
    serviceController: "launchd" | "systemd" | "legacy-detached" | "unknown";
    startedAt: string;
    stopRequestedAt: string | null;
    updatedAt: string;
  }> = {}
) {
  const { pid = 5555, ...rest } = overrides;
  return {
    v: 1,
    schema: "openmeld-daemon-service-state-v1",
    status: "running" as const,
    pid,
    mode: "background" as const,
    command: `${process.execPath} ${daemonRuntimeBundlesPath()}/service-bundle/dist/openmeld.js service run --mode foreground`,
    gatewayUrl: "https://gateway.openmeld.invalid",
    openMeldProfileId: "human-default",
    stopRequestedAt: null,
    heartbeatAt: "2026-03-01T00:00:00.000Z",
    startedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    managedBySystemService: true,
    serviceController: "launchd" as const,
    autoStart: true,
    ...rest,
  };
}
