import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  createManagedAgentActivityIntegrationRefreshScheduler,
  refreshManagedAgentActivityIntegrations,
} from "../src/agent-activity/integration-refresh";
import type { startLocalAgentActivitySyncLoop } from "../src/agent-activity/local-sync";
import { defaultManagedIntegrationPaths } from "../src/agent-activity/managed-integrations";
import { bindProject } from "../src/agent-activity/project-bindings";
import {
  isAgentActivityRouteRegistered,
  registerAgentActivityRoute,
} from "../src/agent-activity/route-registry";
import type { StoredAuthSession } from "../src/config/auth-session";
import {
  AuthRequestCredentialError,
  fingerprintRequestAuthorization,
} from "../src/config/request-headers";
import {
  createControlledShutdownCoordinator,
  runDaemonServiceLoop,
} from "../src/local-service/carrier/service-runner";
import { DAEMON_STREAM_CONNECT_TIMEOUT_MS } from "../src/local-service/core/constants";
import type { RouteCatalog } from "../src/local-service/core/types";
import { ExecutionHostError } from "../src/local-service/execution-host/channel";
import type { launchExecutionHost } from "../src/local-service/execution-host/launch";
import type {
  ExecutionHostEvent,
  ExecutionHostPort,
} from "../src/local-service/execution-host/port";
import { withTempHome } from "./helpers/fs";

const DAEMON_STREAM_URL_PATTERN =
  /^ws:\/\/localhost:8080\/v1\/daemon\/stream\?connectionId=/;

function sourceCatalog(profileIds: string[]): RouteCatalog {
  return {
    profileIds,
    routeByProfileId: new Map(
      profileIds.map((profileId) => [
        profileId,
        {
          profileId,
          agentControllerRef: "builtin:codex",
          contextIdMappingSpec: {
            sourceField: "OPENMELD_CLI_CONTEXT_ID",
            mappingVersion: 1,
          },
          streamingMode: "final",
          transportMode: "local-cli",
        },
      ])
    ),
    skippedProfiles: [],
  };
}

function createAuthSession(
  overrides: Partial<StoredAuthSession> = {}
): StoredAuthSession {
  return {
    v: 1,
    accessToken: "valid-token",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost:8080",
    clientId: "openmeld-cli",
    createdAt: "2026-07-03T00:00:00.000Z",
    expiresAt: "2026-07-03T01:00:00.000Z",
    ...overrides,
    user: {
      id: "usr_123",
      name: "Felix",
      ...overrides.user,
    },
  };
}

function createConnectedSocket(close = vi.fn()) {
  return {
    close,
    onClose: vi.fn(),
  };
}

function requestServiceSigterm(): void {
  const listener = process
    .listeners("SIGTERM")
    .find((candidate) => candidate.name === "onSigterm");
  if (!listener) {
    throw new Error("expected the local Service SIGTERM handler to be active");
  }
  listener("SIGTERM");
}

async function stopServiceThroughSigterm(input: {
  shutdownRequested?: Promise<unknown>;
}): Promise<void> {
  requestServiceSigterm();
  await input.shutdownRequested;
}

const {
  buildOpenMeldProfileRequestHeadersWithAuthMock,
  buildRequestAuthHeadersMock,
  clearDaemonServiceRuntimeStateMock,
  connectWebSocketMock,
  createManagedAgentActivityIntegrationRefreshSchedulerMock,
  createLocalAdapterContainerMock,
  createLocalAdapterEntriesMock,
  emitDaemonLifecycleEventMock,
  ensureDaemonRuntimeContractStateMock,
  ensureDaemonRuntimePathsMock,
  getAuthSessionStateMock,
  getConfiguredDaemonDispatchLimitsMock,
  loadContextStoreMock,
  loadDaemonRouteCatalogMock,
  readDaemonRouteCatalogCacheMock,
  readDaemonActiveBundleStateMock,
  readDaemonServiceContractMock,
  requestLocalAgentActivitySyncMock,
  requestManagedAgentActivityIntegrationRefreshMock,
  resolveRecentDaemonSignalStopCauseMock,
  resolveSystemLocalFolderPickerHelperMock,
  refreshManagedAgentActivityIntegrationsMock,
  resolveOpenMeldProfileOrNullMock,
  resolveBaseUrlMock,
  resolveDaemonBundleEntryPathFromStateMock,
  resolveDaemonDeviceIdMock,
  runDaemonSocketSessionMock,
  setAgentRegistrationEnabledMock,
  setDaemonServiceRuntimeStateMock,
  startLocalAgentActivitySyncLoopMock,
  startLocalDaemonControlPlaneServerMock,
  stopLocalAgentActivitySyncLoopMock,
  stopManagedAgentActivityIntegrationRefreshSchedulerMock,
  syncDeviceRuntimeStateProjectionMock,
  syncLocalServiceRuntimeAgentControllerReportsMock,
  writeDaemonRouteCatalogCacheMock,
  writeDaemonRuntimeLeaseMock,
  evidenceFlushes,
} = vi.hoisted(() => ({
  buildOpenMeldProfileRequestHeadersWithAuthMock: vi.fn(),
  buildRequestAuthHeadersMock: vi.fn(),
  clearDaemonServiceRuntimeStateMock: vi.fn(),
  connectWebSocketMock: vi.fn(),
  createManagedAgentActivityIntegrationRefreshSchedulerMock:
    vi.fn<typeof createManagedAgentActivityIntegrationRefreshScheduler>(),
  createLocalAdapterContainerMock: vi.fn(),
  createLocalAdapterEntriesMock: vi.fn(),
  emitDaemonLifecycleEventMock: vi.fn(),
  ensureDaemonRuntimeContractStateMock: vi.fn(),
  ensureDaemonRuntimePathsMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  getConfiguredDaemonDispatchLimitsMock: vi.fn(),
  loadContextStoreMock: vi.fn(),
  loadDaemonRouteCatalogMock: vi.fn(),
  readDaemonRouteCatalogCacheMock: vi.fn(),
  readDaemonActiveBundleStateMock: vi.fn(),
  readDaemonServiceContractMock: vi.fn(),
  requestLocalAgentActivitySyncMock: vi.fn(),
  requestManagedAgentActivityIntegrationRefreshMock: vi.fn(),
  resolveRecentDaemonSignalStopCauseMock: vi.fn(),
  resolveSystemLocalFolderPickerHelperMock: vi.fn(),
  refreshManagedAgentActivityIntegrationsMock:
    vi.fn<typeof refreshManagedAgentActivityIntegrations>(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveDaemonBundleEntryPathFromStateMock: vi.fn(),
  resolveDaemonDeviceIdMock: vi.fn(),
  runDaemonSocketSessionMock: vi.fn(),
  setAgentRegistrationEnabledMock: vi.fn(),
  setDaemonServiceRuntimeStateMock: vi.fn(),
  startLocalAgentActivitySyncLoopMock:
    vi.fn<typeof startLocalAgentActivitySyncLoop>(),
  startLocalDaemonControlPlaneServerMock: vi.fn(),
  stopLocalAgentActivitySyncLoopMock: vi.fn(),
  stopManagedAgentActivityIntegrationRefreshSchedulerMock: vi.fn(),
  syncDeviceRuntimeStateProjectionMock: vi.fn(),
  syncLocalServiceRuntimeAgentControllerReportsMock: vi.fn(),
  writeDaemonRouteCatalogCacheMock: vi.fn(),
  writeDaemonRuntimeLeaseMock: vi.fn(),
  evidenceFlushes: [] as Array<() => Promise<void>>,
}));

vi.mock("../src/agent-activity/integration-refresh", () => ({
  createManagedAgentActivityIntegrationRefreshScheduler:
    createManagedAgentActivityIntegrationRefreshSchedulerMock,
  refreshManagedAgentActivityIntegrations:
    refreshManagedAgentActivityIntegrationsMock,
}));

vi.mock("../src/agent-activity/local-sync", () => ({
  startLocalAgentActivitySyncLoop: startLocalAgentActivitySyncLoopMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/agents/registry", () => ({
  setAgentRegistrationEnabled: setAgentRegistrationEnabledMock,
}));

vi.mock("../src/config/auth-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config/auth-session")>()),
  getAuthSessionState: getAuthSessionStateMock,
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  requireOpenMeldProfile: vi.fn(),
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock(
  "../src/local-service/folder-picker/local-folder-picker-helper-process",
  () => ({
    resolveSystemLocalFolderPickerHelper:
      resolveSystemLocalFolderPickerHelperMock,
  })
);

vi.mock("../src/config/request-headers", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/request-headers")
  >("../src/config/request-headers");
  return {
    ...actual,
    buildOpenMeldProfileRequestHeadersWithAuth:
      buildOpenMeldProfileRequestHeadersWithAuthMock,
    buildRequestAuthHeaders: buildRequestAuthHeadersMock,
  };
});

vi.mock("../src/config/runtime-config", () => ({
  getConfiguredDaemonDispatchLimits: getConfiguredDaemonDispatchLimitsMock,
}));

vi.mock("../src/local-service/lifecycle/daemon-lifecycle-journal", () => ({
  emitDaemonLifecycleEvent: (...args: unknown[]) =>
    emitDaemonLifecycleEventMock(...args) ?? Promise.resolve(),
  resolveRecentDaemonSignalStopCause: () =>
    resolveRecentDaemonSignalStopCauseMock(),
}));

vi.mock("../src/config/daemon-service-contract", () => ({
  readDaemonServiceContract: readDaemonServiceContractMock,
}));

vi.mock("../src/config/daemon-runtime-lease", () => ({
  writeDaemonRuntimeLease: writeDaemonRuntimeLeaseMock,
}));

vi.mock("../src/config/daemon-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/daemon-state")
  >("../src/config/daemon-state");
  return {
    ...actual,
    clearDaemonServiceRuntimeState: clearDaemonServiceRuntimeStateMock,
    resolveDaemonServiceRuntimeMetadata: vi.fn(() => ({
      managedBySystemService: true,
      serviceController: "launchd",
      autoStart: true,
    })),
    setDaemonServiceRuntimeState: setDaemonServiceRuntimeStateMock,
  };
});

vi.mock("../src/local-service/lifecycle/daemon-service-bundle", () => ({
  readDaemonActiveBundleState: readDaemonActiveBundleStateMock,
  resolveDaemonBundleEntryPathFromState:
    resolveDaemonBundleEntryPathFromStateMock,
}));

vi.mock("../src/local-service/reporting/device-runtime-state-sync", () => ({
  syncDeviceRuntimeStateProjection: syncDeviceRuntimeStateProjectionMock,
}));

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-report-sync",
  () => ({
    syncLocalServiceRuntimeAgentControllerReports:
      syncLocalServiceRuntimeAgentControllerReportsMock,
  })
);

vi.mock("../src/transport/ws", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/transport/ws")>()),
  connectWebSocket: connectWebSocketMock,
}));

vi.mock("@openmeld/local-service", async () => {
  const actual = await vi.importActual<
    typeof import("@openmeld/local-service")
  >("@openmeld/local-service");
  return {
    ...actual,
    createLocalAdapterContainer: createLocalAdapterContainerMock,
    createLocalAdapterEntries: createLocalAdapterEntriesMock,
  };
});

vi.mock("../src/local-service/routing/route-catalog", () => ({
  createMutableRouteCatalogState: vi.fn((catalog) => ({
    fingerprint: "test-fingerprint",
    profileIds: catalog.profileIds,
    routeByProfileId: catalog.routeByProfileId ?? new Map(),
    skippedProfiles: catalog.skippedProfiles ?? [],
  })),
  loadDaemonRouteCatalog: loadDaemonRouteCatalogMock,
  summarizeSkippedDaemonProfiles: vi.fn(() => ""),
  syncDaemonRouteCatalogState: vi.fn(),
}));

vi.mock("../src/local-service/state/route-catalog-cache", () => ({
  readDaemonRouteCatalogCache: readDaemonRouteCatalogCacheMock,
  writeDaemonRouteCatalogCache: writeDaemonRouteCatalogCacheMock,
}));

vi.mock("../src/local-service/carrier/run-socket-session", async () => {
  const { createExecutionHostSocketLink } = await import(
    "../src/local-service/execution-host/socket-link"
  );
  const generations = new WeakMap<ExecutionHostPort, number>();
  return {
    runDaemonSocketSession: async (
      input: Parameters<
        typeof import("../src/local-service/carrier/run-socket-session").runDaemonSocketSession
      >[0]
    ) => {
      const connectionGeneration =
        (generations.get(input.executionHost) ?? 0) + 1;
      generations.set(input.executionHost, connectionGeneration);
      const link = createExecutionHostSocketLink({
        host: input.executionHost,
        socket: { send: () => undefined },
        onAdmissionChanged: () => undefined,
        onInvalidation: () => undefined,
        onAuthenticationFailure: (failure) => {
          input.onRuntimeReportingAuthenticationFailure?.(failure);
        },
        onError: (error) => {
          throw error;
        },
      });
      await link.configure({
        executionAdmissionConfirmation: true,
        connectionGeneration,
        catalogRevision: 0,
        leases: [],
      });
      try {
        await runDaemonSocketSessionMock(input);
      } finally {
        await link.detach();
      }
    },
  };
});

// Substitute only the OS process transport. Actual Host resource, catalog,
// control and lifecycle handlers execute under isolated fixture state.
vi.mock("../src/local-service/execution-host/launch", async () => {
  const { createInProcessExecutionHost } = await import(
    "./helpers/execution-host"
  );
  const { createExecutionHostResources } = await import(
    "../src/local-service/execution-host/runtime"
  );
  return {
    launchExecutionHost: (input: Parameters<typeof launchExecutionHost>[0]) => {
      let current: Awaited<
        ReturnType<typeof createInProcessExecutionHost>
      > | null = null;
      const listeners = new Set<(event: ExecutionHostEvent) => void>();
      const ready = (async () => {
        const presenter = {
          view: "agent" as const,
          line: () => undefined,
          event: () => undefined,
          data: () => undefined,
        };
        const resources = await createExecutionHostResources({
          runtimePaths: await ensureDaemonRuntimePathsMock(),
          presenter,
        });
        current = await createInProcessExecutionHost({
          resources,
          presenter,
          stateRoot: input.identity.stateRoot,
          ownerUserId: input.identity.ownerUserId,
          deviceId: input.identity.deviceId,
          daemonSessionId: input.identity.daemonSessionId,
          profileOwnerName: "Felix",
          serviceBundleId: "service-bundle-1",
        });
        current.port.onEvent((event) => {
          for (const listener of listeners) {
            listener(event);
          }
        });
        return current;
      })();
      const port: ExecutionHostPort = {
        call: async (method, payload, options) =>
          (await ready).port.call(method, payload, options),
        available: () => current !== null,
        snapshot: () => current?.port.snapshot() ?? null,
        onEvent: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        onAvailabilityChanged: () => () => undefined,
      };
      return {
        ...port,
        initialized: ready.then((value) => value.port.call("health", {})),
        close: async () => {
          await (await ready).close();
        },
        hostInstanceId: "fixture-process",
      };
    },
  };
});

vi.mock("../src/local-service/control-plane/server", () => ({
  startLocalDaemonControlPlaneServer: startLocalDaemonControlPlaneServerMock,
}));

vi.mock("../src/local-service/state/context-store", () => ({
  loadContextStore: loadContextStoreMock,
}));

vi.mock("../src/local-service/state/daemon-device-id", () => ({
  buildLedgerPaths: vi.fn((rootDirPath: string) => ({
    backupStateFilePath: `${rootDirPath}/state.backup.json`,
    historyFilePath: `${rootDirPath}/history.ndjson`,
    historyTempFilePath: `${rootDirPath}/history.tmp`,
    rootDirPath,
    stateFilePath: `${rootDirPath}/state.json`,
    stateTempFilePath: `${rootDirPath}/state.tmp`,
  })),
  ensureDaemonRuntimePaths: ensureDaemonRuntimePathsMock,
  resolveDaemonDeviceId: resolveDaemonDeviceIdMock,
}));

vi.mock("../src/local-service/state/runtime-contract-guard", () => ({
  ensureDaemonRuntimeContractState: ensureDaemonRuntimeContractStateMock,
}));

// Diagnostic disk writes intentionally outlive transport observations. Await
// the real recorder's pending writes before removing this test's state root.
vi.mock(
  "../src/local-service/lifecycle/service-connection-evidence",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/local-service/lifecycle/service-connection-evidence")
      >();
    return {
      ...actual,
      createServiceConnectionEvidenceRecorder: (
        input: Parameters<
          typeof actual.createServiceConnectionEvidenceRecorder
        >[0]
      ) => {
        const recorder = actual.createServiceConnectionEvidenceRecorder(input);
        evidenceFlushes.push(() => recorder.flush());
        return recorder;
      },
    };
  }
);

async function flushPendingPromises(count = 20): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function waitForFakeTimerCondition(
  description: string,
  condition: () => boolean
): Promise<void> {
  for (let index = 0; index < 200; index += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await flushPendingPromises();
    if (condition()) {
      return;
    }
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe("local service runner dual-write", () => {
  let isolatedHome: string;
  beforeEach(async () => {
    isolatedHome = await mkdtemp(join(tmpdir(), "openmeld-host-runner-"));
    vi.stubEnv("OPENMELD_HOME", isolatedHome);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    resolveBaseUrlMock.mockReset().mockResolvedValue("http://localhost:8080");
    getAuthSessionStateMock.mockReset().mockResolvedValue({
      state: "valid",
      session: createAuthSession(),
    });
    resolveOpenMeldProfileOrNullMock.mockReset().mockResolvedValue(null);
    buildOpenMeldProfileRequestHeadersWithAuthMock
      .mockReset()
      .mockResolvedValue({ Authorization: "Bearer test" });
    buildRequestAuthHeadersMock
      .mockReset()
      .mockResolvedValue({ Authorization: "Bearer test" });
    getConfiguredDaemonDispatchLimitsMock
      .mockReset()
      .mockResolvedValue({ globalConcurrency: 1, queueMax: 4 });
    readDaemonServiceContractMock.mockReset().mockResolvedValue({
      schema: "openmeld-daemon-service-contract-v1",
      v: 1,
      lane: "dev-local",
      daemonVersion: "1.0.0",
      bundleId: "service-bundle-1",
      desiredState: "background",
      serviceController: "launchd",
      autoStart: true,
      gatewayUrl: "http://localhost:8080",
      profileId: "hum_felix",
      deviceId: "device_123",
      heartbeatMs: 5000,
      generation: 4,
      ownerUserId: "usr_123",
      updatedAt: "2026-03-14T00:00:00.000Z",
    });
    resolveRecentDaemonSignalStopCauseMock
      .mockReset()
      .mockResolvedValue("controlled_service_update");
    resolveSystemLocalFolderPickerHelperMock
      .mockReset()
      .mockReturnValue(vi.fn().mockResolvedValue({ status: "cancelled" }));
    refreshManagedAgentActivityIntegrationsMock.mockReset().mockResolvedValue({
      reason: "no_project_bindings",
      status: "skipped",
    });
    readDaemonActiveBundleStateMock.mockReset().mockResolvedValue({
      bundleId: "service-bundle-1",
    });
    resolveDaemonBundleEntryPathFromStateMock
      .mockReset()
      .mockResolvedValue(
        "/tmp/.openmeld-dev/runtime/daemon/bundles/service-bundle-1/dist/openmeld.js"
      );
    syncDeviceRuntimeStateProjectionMock
      .mockReset()
      .mockResolvedValue({ repairedControllerIds: [] });
    syncLocalServiceRuntimeAgentControllerReportsMock
      .mockReset()
      .mockResolvedValue({
        failedCount: 0,
        reasonCodes: [],
        reportCount: 1,
        status: "submitted",
        submittedCount: 1,
      });
    connectWebSocketMock.mockReset().mockResolvedValue(createConnectedSocket());
    createLocalAdapterEntriesMock.mockReset().mockReturnValue([
      {
        adapterId: "local-cli",
      },
    ]);
    createLocalAdapterContainerMock.mockReset().mockReturnValue({
      listAdapters: () => [
        {
          adapterId: "local-cli",
        },
      ],
    });
    loadDaemonRouteCatalogMock
      .mockReset()
      .mockResolvedValue(
        sourceCatalog(["agt_11111111-1111-4111-8111-111111111111"])
      );
    readDaemonRouteCatalogCacheMock.mockReset().mockResolvedValue(null);
    writeDaemonRouteCatalogCacheMock.mockReset().mockResolvedValue(undefined);
    loadContextStoreMock.mockReset().mockResolvedValue(new Map());
    ensureDaemonRuntimePathsMock.mockReset().mockResolvedValue({
      contractMetaPath: join(isolatedHome, "contract-meta.json"),
      contractRepairReportPath: join(isolatedHome, "repair-report.json"),
      contextStorePath: join(isolatedHome, "context-store.json"),
      dataRootPath: join(isolatedHome, "data"),
      deviceIdPath: join(isolatedHome, "device-id"),
      ledgerRootPath: join(isolatedHome, "ledger"),
    });
    ensureDaemonRuntimeContractStateMock.mockReset().mockResolvedValue({
      action: "none",
      meta: {
        v: 1,
        schema: "openmeld-daemon-runtime-contract-meta-v1",
        contractEpoch: "2026-03-14",
        updatedAt: "2026-03-14T00:00:00.000Z",
      },
    });
    resolveDaemonDeviceIdMock.mockReset().mockResolvedValue("device_123");
    setAgentRegistrationEnabledMock.mockReset().mockResolvedValue({
      agentControllerRef: "builtin:codex",
      agentId: "codex",
      changed: false,
      displayName: "Codex",
      enabled: true,
      status: "unchanged",
    });
    setDaemonServiceRuntimeStateMock.mockReset().mockResolvedValue(undefined);
    stopLocalAgentActivitySyncLoopMock.mockReset().mockResolvedValue(undefined);
    startLocalAgentActivitySyncLoopMock.mockReset().mockReturnValue({
      requestSync: requestLocalAgentActivitySyncMock,
      stop: stopLocalAgentActivitySyncLoopMock,
    });
    requestLocalAgentActivitySyncMock.mockReset();
    stopManagedAgentActivityIntegrationRefreshSchedulerMock
      .mockReset()
      .mockResolvedValue(undefined);
    createManagedAgentActivityIntegrationRefreshSchedulerMock
      .mockReset()
      .mockReturnValue({
        request: requestManagedAgentActivityIntegrationRefreshMock,
        stop: stopManagedAgentActivityIntegrationRefreshSchedulerMock,
      });
    requestManagedAgentActivityIntegrationRefreshMock.mockReset();
    startLocalDaemonControlPlaneServerMock.mockReset().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    });
    writeDaemonRuntimeLeaseMock.mockReset().mockResolvedValue(undefined);
    clearDaemonServiceRuntimeStateMock.mockReset().mockResolvedValue(undefined);
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      input.onLocalProjectConnectionsChanged?.();
      await input.touchRuntimeState(
        {
          heartbeatAt: "2026-03-14T00:00:05.000Z",
        },
        {
          forcePersist: true,
        }
      );
      await stopServiceThroughSigterm(input);
    });
    emitDaemonLifecycleEventMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(evidenceFlushes.splice(0).map((flush) => flush()));
    vi.restoreAllMocks();
    vi.useRealTimers();
    await rm(isolatedHome, { recursive: true, force: true });
  });

  it("writes running runtime state after the control plane without waiting for the catalog scan", async () => {
    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    expect(setDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(2);
    expect(writeDaemonRuntimeLeaseMock).toHaveBeenCalledTimes(2);
    const firstRuntimeWriteOrder =
      setDaemonServiceRuntimeStateMock.mock.invocationCallOrder[0];
    const controlPlaneReadyOrder =
      startLocalDaemonControlPlaneServerMock.mock.invocationCallOrder[0];
    expect(firstRuntimeWriteOrder).toBeDefined();
    expect(controlPlaneReadyOrder).toBeDefined();
    expect(controlPlaneReadyOrder as number).toBeLessThan(
      firstRuntimeWriteOrder as number
    );
    // The account-wide catalog scan no longer gates startup: boot hands the
    // socket session an unresolved placeholder plus a loader, and the first
    // in-session sync resolves the real catalog.
    expect(loadDaemonRouteCatalogMock).not.toHaveBeenCalled();
    const sessionInput = runDaemonSocketSessionMock.mock.calls[0]?.[0];
    // The fixture requests a Project refresh after the startup refresh.
    expect(
      requestManagedAgentActivityIntegrationRefreshMock
    ).toHaveBeenCalledTimes(2);
    expect(requestLocalAgentActivitySyncMock).toHaveBeenCalledWith({
      reconcile: true,
      refreshContext: true,
    });
    expect(sessionInput?.routeCatalogState?.profileIds).toEqual([]);
    expect(typeof sessionInput?.loadRouteCatalog).toBe("function");
    expect(sessionInput?.isRouteCatalogResolved?.()).toBe(false);
    expect(syncDeviceRuntimeStateProjectionMock).not.toHaveBeenCalled();
    expect(connectWebSocketMock).toHaveBeenCalledWith(
      expect.stringMatching(DAEMON_STREAM_URL_PATTERN),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-openmeld-local-folder-picker-capability": "local-folder-picker-v1",
          "x-openmeld-runtime-capabilities": "computer-file-access-v1",
        }),
        openTimeoutMs: DAEMON_STREAM_CONNECT_TIMEOUT_MS,
      })
    );
    expect(sessionInput?.selectLocalFolders).toEqual(expect.any(Function));
    expect(writeDaemonRuntimeLeaseMock.mock.calls[0]?.[0]).toMatchObject({
      generation: 4,
      bundleId: "service-bundle-1",
      mode: "background",
      heartbeatAt: null,
      serviceController: "launchd",
      managedBySystemService: true,
    });
    expect(writeDaemonRuntimeLeaseMock.mock.calls[1]?.[0]).toMatchObject({
      generation: 4,
      bundleId: "service-bundle-1",
      heartbeatAt: "2026-03-14T00:00:05.000Z",
    });
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
  });

  it("installs Activity observers when the first Project connects after an empty startup", async () => {
    const actual = await vi.importActual<
      typeof import("../src/agent-activity/integration-refresh")
    >("../src/agent-activity/integration-refresh");
    const initialRefresh = Promise.withResolvers<void>();
    const route = {
      globalRootDir: join(isolatedHome, "activity-registry"),
      rootDir: isolatedHome,
    };
    const paths = defaultManagedIntegrationPaths(isolatedHome);
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    createManagedAgentActivityIntegrationRefreshSchedulerMock.mockImplementation(
      (options) =>
        actual.createManagedAgentActivityIntegrationRefreshScheduler({
          ...options,
          refresh: () =>
            actual.refreshManagedAgentActivityIntegrations({
              homeDir: isolatedHome,
              rootDir: isolatedHome,
              register: () => registerAgentActivityRoute(route),
            }),
          onResult: (result) => {
            options.onResult?.(result);
            initialRefresh.resolve();
          },
        })
    );
    const connected = Promise.withResolvers<() => void>();
    runDaemonSocketSessionMock.mockImplementation(async (input) => {
      connected.resolve(() => input.onLocalProjectConnectionsChanged?.());
      await input.shutdownRequested;
    });
    const loop = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });
    try {
      const projectChanged = await connected.promise;
      await initialRefresh.promise;
      await expect(isAgentActivityRouteRegistered(route)).resolves.toBe(false);
      await expect(
        readFile(paths.cursorHooksPath, "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      const repositoryPath = join(isolatedHome, "first-project");
      await mkdir(repositoryPath);
      await bindProject({
        organizationId: "org-1",
        projectId: "project-1",
        projectSlug: "first-project",
        repositoryFingerprint: null,
        repositoryPath,
        rootDir: isolatedHome,
      });
      projectChanged();
      // Assert the actual lane registration and managed configuration, not a
      // scheduler call count. All integration writes stay in the disposable home.
      await vi.waitFor(async () => {
        expect(await isAgentActivityRouteRegistered(route)).toBe(true);
        expect(await readFile(paths.cursorHooksPath, "utf8")).toContain(
          "openmeld-dev activity hook --provider cursor"
        );
      });
    } finally {
      requestServiceSigterm();
      await loop;
    }
  });

  it("does not advertise Folder Picker when this Service has no system dialog provider", async () => {
    resolveSystemLocalFolderPickerHelperMock.mockReturnValue(null);

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    const headers = connectWebSocketMock.mock.calls[0]?.[1]?.headers;
    expect(headers).not.toHaveProperty(
      "x-openmeld-local-folder-picker-capability"
    );
    expect(headers).toHaveProperty(
      "x-openmeld-runtime-capabilities",
      "computer-file-access-v1"
    );
  });

  it.each([
    "shutdownHandler",
    "shutdownIfIdleHandler",
  ])("acknowledges a controlled shutdown only after the active socket session drains (%s)", async (handler) => {
    const socketSessionStarted = Promise.withResolvers<void>();
    let observedStopCause: string | null = null;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      socketSessionStarted.resolve();
      observedStopCause = await input.shutdownRequested;
    });

    const loop = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });
    await socketSessionStarted.promise;

    const serverInput =
      startLocalDaemonControlPlaneServerMock.mock.calls[0]?.[0];
    const context = await serverInput.getContext();
    expect(await context.serviceUpdateReadinessHandler?.()).toEqual({
      acceptedWakeCount: 0,
      safeToSwitch: true,
      unacknowledgedResultCount: 0,
    });
    const shutdownResult = await context[handler]({
      gracePeriodMs: 5000,
      ...(handler === "shutdownHandler" ? { mode: "graceful" } : {}),
    });
    await loop;

    expect(observedStopCause).toBe("controlled_service_update");
    expect(shutdownResult).toEqual({
      accepted: true,
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "busy",
    "reconnect",
    "disconnected",
    "stopping",
  ])("keeps idle-stop admission with its Host through %s", async (state) => {
    const entered = Promise.withResolvers<void>();
    const decision = Promise.withResolvers<boolean>();
    let stopped = false;
    const markStopping = vi.fn(() => {
      stopped = true;
    });
    const oldSession = vi.fn();
    const replacementSession = vi.fn();
    const admitted = vi.fn();
    const coordinator = createControlledShutdownCoordinator({
      drainHost: async () => undefined,
      hasUndrainedWork: () => false,
      isStopRequested: () => stopped,
      markStopping,
    });
    coordinator.attachSession(oldSession);
    const request = coordinator.requestIfIdle({
      gracePeriodMs: 2000,
      onAdmitted: admitted,
      tryBeginDrain: async () => {
        entered.resolve();
        return await decision.promise;
      },
    });
    await entered.promise;
    expect(coordinator.isDraining()).toBe(false);
    if (state !== "busy") {
      coordinator.detachSession(oldSession);
    }
    if (state === "reconnect") {
      coordinator.attachSession(replacementSession);
    }
    if (state === "stopping") {
      stopped = true;
    }
    decision.resolve(state !== "busy");
    if (state === "reconnect") {
      await vi.waitFor(() => expect(replacementSession).toHaveBeenCalledOnce());
      coordinator.handleSessionCompleted();
    }
    expect(await request).toMatchObject({ accepted: state !== "busy" });
    expect(oldSession).not.toHaveBeenCalled();
    expect(markStopping).toHaveBeenCalledTimes(
      state === "busy" || state === "stopping" ? 0 : 1
    );
    expect(admitted).toHaveBeenCalledTimes(state === "busy" ? 0 : 1);
  });

  it.each([
    "accepted",
    "failed",
  ])("shares the %s admission result when a concurrent idle request sees host.draining", async (outcome) => {
    const entered = Promise.withResolvers<void>();
    const decision = Promise.withResolvers<boolean>();
    const admitted = Promise.withResolvers<void>();
    let enteredCount = 0;
    let stopped = false;
    const markStopping = vi.fn(() => {
      stopped = true;
    });
    const coordinator = createControlledShutdownCoordinator({
      drainHost: async () => undefined,
      hasUndrainedWork: () => false,
      isStopRequested: () => stopped,
      markStopping,
    });
    coordinator.attachSession(() => undefined);
    const onAdmitted = vi.fn(() => admitted.resolve());
    const results = Promise.allSettled(
      [0, 1].map(() =>
        coordinator.requestIfIdle({
          gracePeriodMs: 2000,
          tryBeginDrain: async () => {
            if (++enteredCount === 2) {
              entered.resolve();
              throw new ExecutionHostError(
                "host.draining",
                "The Host already has an admitted stop."
              );
            }
            return await decision.promise;
          },
          onAdmitted,
        })
      )
    );
    await entered.promise;
    if (outcome === "failed") {
      const error = new ExecutionHostError(
        "host.channel_closed",
        "Host reply lost"
      );
      decision.reject(error);
      expect(await results).toEqual([
        { status: "rejected", reason: error },
        { status: "rejected", reason: error },
      ]);
      expect(onAdmitted).not.toHaveBeenCalled();
      expect(markStopping).not.toHaveBeenCalled();
      expect(coordinator.isDraining()).toBe(false);
      return;
    }
    decision.resolve(true);
    await admitted.promise;
    expect(coordinator.isDraining()).toBe(true);
    coordinator.handleSessionCompleted();
    expect(await results).toEqual([
      {
        status: "fulfilled",
        value: { accepted: true, gracePeriodMs: 2000, mode: "graceful" },
      },
      {
        status: "fulfilled",
        value: { accepted: true, gracePeriodMs: 2000, mode: "graceful" },
      },
    ]);
    expect(onAdmitted).toHaveBeenCalledTimes(2);
    expect(markStopping).toHaveBeenCalledOnce();
  });

  it("does not accept host.draining without an overlapping idle admission", async () => {
    const error = new ExecutionHostError(
      "host.draining",
      "Host already draining"
    );
    const markStopping = vi.fn();
    const onAdmitted = vi.fn();
    const coordinator = createControlledShutdownCoordinator({
      drainHost: async () => undefined,
      hasUndrainedWork: () => false,
      isStopRequested: () => false,
      markStopping,
    });
    await expect(
      coordinator.requestIfIdle({
        gracePeriodMs: 2000,
        tryBeginDrain: () => Promise.reject(error),
        onAdmitted,
      })
    ).rejects.toBe(error);
    expect(onAdmitted).not.toHaveBeenCalled();
    expect(markStopping).not.toHaveBeenCalled();
    expect(coordinator.isDraining()).toBe(false);
  });

  it("ends a disconnected stop only after the Host has no local work", async () => {
    let hasWork = true;
    let stopped = false;
    const admitted = Promise.withResolvers<void>();
    const coordinator = createControlledShutdownCoordinator({
      drainHost: async () => undefined,
      hasUndrainedWork: () => hasWork,
      isStopRequested: () => stopped,
      markStopping: () => {
        stopped = true;
      },
    });
    const resolver = () => admitted.resolve();
    coordinator.attachSession(resolver);
    const request = coordinator.request({
      mode: "graceful",
      gracePeriodMs: 2000,
    });
    await admitted.promise;
    coordinator.detachSession(resolver);
    expect(await coordinator.completeQuiescentStop()).toBe(false);
    expect(stopped).toBe(false);
    hasWork = false;
    expect(await coordinator.completeQuiescentStop()).toBe(true);
    await expect(request).resolves.toMatchObject({ accepted: true });
    expect(stopped).toBe(true);
  });

  it("shares one Host drain across repeated connector replacements", async () => {
    const hostWork = Promise.withResolvers<void>();
    const drainHost = vi.fn(() => hostWork.promise);
    const coordinator = createControlledShutdownCoordinator({
      drainHost,
      hasUndrainedWork: () => true,
      isStopRequested: () => false,
      markStopping: () => undefined,
    });
    const wait = coordinator.waitForDrain();
    for (let connection = 0; connection < 100; connection += 1) {
      const stop = () => undefined;
      coordinator.attachSession(stop);
      expect(coordinator.waitForDrain()).toBe(wait);
      coordinator.detachSession(stop);
    }
    expect(drainHost).toHaveBeenCalledTimes(1);
    hostWork.resolve();
    await wait;
  });

  it.each([
    "drain",
    "beginDrain",
    "settleResults",
  ] as const)("reports a failed Host %s and allows a later stop", async (failedMethod) => {
    const failure = new Error(
      "Host request capacity exhausted; drain was not admitted"
    );
    const drainHost = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);
    let stopping = false;
    const coordinator = createControlledShutdownCoordinator({
      drainHost,
      hasUndrainedWork: () => true,
      isStopRequested: () => stopping,
      markStopping: () => {
        stopping = true;
      },
    });
    const admitted = Promise.withResolvers<void>();
    coordinator.attachSession(() => admitted.resolve());
    const firstStop = coordinator.request({
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    const rejectedStop = expect(firstStop).rejects.toBe(failure);
    await admitted.promise;
    expect(coordinator.isDraining()).toBe(true);
    if (failedMethod === "drain") {
      await expect(coordinator.waitForDrain()).rejects.toBe(failure);
    } else {
      expect(() => coordinator.failHostShutdown(failure)).toThrow(failure);
      drainHost.mockReset().mockResolvedValue(undefined);
    }
    await rejectedStop;
    expect(stopping).toBe(false);

    const readmitted = Promise.withResolvers<void>();
    coordinator.attachSession(() => readmitted.resolve());
    const nextStop = coordinator.request({
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    await readmitted.promise;
    await coordinator.waitForDrain();
    coordinator.handleSessionCompleted();
    await expect(nextStop).resolves.toMatchObject({ accepted: true });
    expect(drainHost).toHaveBeenCalledTimes(failedMethod === "drain" ? 2 : 1);
    expect(stopping).toBe(true);
  });

  it("joins repeated controlled shutdown requests to the admitted drain", async () => {
    let stopping = false;
    let shutdownRequestCount = 0;
    const shutdownAdmitted = Promise.withResolvers<void>();
    const coordinator = createControlledShutdownCoordinator({
      drainHost: async () => undefined,
      hasUndrainedWork: () => false,
      isStopRequested: () => stopping,
      markStopping: () => {
        stopping = true;
      },
    });
    coordinator.attachSession(() => {
      shutdownRequestCount += 1;
      shutdownAdmitted.resolve();
    });
    const initialStop = coordinator.request({
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    await shutdownAdmitted.promise;
    const recoveryStop = coordinator.request({
      gracePeriodMs: 5000,
      mode: "graceful",
    });

    expect(shutdownRequestCount).toBe(1);

    coordinator.handleSessionCompleted();
    await expect(Promise.all([initialStop, recoveryStop])).resolves.toEqual([
      {
        accepted: true,
        gracePeriodMs: 5000,
        mode: "graceful",
      },
      {
        accepted: true,
        gracePeriodMs: 5000,
        mode: "graceful",
      },
    ]);

    expect(shutdownRequestCount).toBe(2);
  });

  it("preserves an explicit user stop cause through the controlled shutdown handshake", async () => {
    resolveRecentDaemonSignalStopCauseMock.mockResolvedValueOnce("user_stop");
    const socketSessionStarted = Promise.withResolvers<void>();
    let observedStopCause: string | null = null;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      socketSessionStarted.resolve();
      observedStopCause = await input.shutdownRequested;
    });

    const loop = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });
    await socketSessionStarted.promise;

    const serverInput =
      startLocalDaemonControlPlaneServerMock.mock.calls[0]?.[0];
    const context = await serverInput.getContext();
    await context.shutdownHandler({
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    await loop;

    expect(observedStopCause).toBe("user_stop");
  });

  it("finishes an idle admitted stop when the final heartbeat fails without reconnecting", async () => {
    const firstSessionStarted = Promise.withResolvers<void>();
    const stopCauses: unknown[] = [];
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      firstSessionStarted.resolve();
      stopCauses.push(await input.shutdownRequested);
      throw new Error("drain heartbeat failed");
    });

    const loop = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });
    await firstSessionStarted.promise;

    const serverInput =
      startLocalDaemonControlPlaneServerMock.mock.calls[0]?.[0];
    const context = await serverInput.getContext();
    let completed = false;
    const shutdown = context
      .shutdownHandler({
        gracePeriodMs: 5000,
        mode: "graceful",
      })
      .then((result: unknown) => {
        completed = true;
        return result;
      });
    await expect(shutdown).resolves.toMatchObject({ accepted: true });
    await loop;
    expect(completed).toBe(true);
    expect(stopCauses).toEqual(["controlled_service_update"]);
    expect(runDaemonSocketSessionMock).toHaveBeenCalledTimes(1);
    expect(clearDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(1);
  });

  it("records continued recovery after repeated connection failures", async () => {
    vi.useFakeTimers();
    const recoveredSessionStarted = Promise.withResolvers<void>();
    const presenter = {
      view: "agent" as const,
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    };
    connectWebSocketMock
      .mockRejectedValueOnce(new Error("daemon stream handshake timed out"))
      .mockRejectedValueOnce(new Error("daemon stream handshake timed out"))
      .mockResolvedValueOnce(createConnectedSocket());
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      await input.touchRuntimeState({ heartbeatAt: new Date().toISOString() });
      recoveredSessionStarted.resolve();
      await input.shutdownRequested;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the structured reason assertion.
    });

    const loop = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter,
    });
    await waitForFakeTimerCondition(
      "first reconnect",
      () => connectWebSocketMock.mock.calls.length === 1
    );
    await vi.advanceTimersByTimeAsync(1000);
    await waitForFakeTimerCondition("reconnect exhaustion diagnostic", () =>
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes('"reasonCode":"service_reconnecting"')
      )
    );
    await vi.advanceTimersByTimeAsync(2000);
    await recoveredSessionStarted.promise;
    const serverInput =
      startLocalDaemonControlPlaneServerMock.mock.calls[0]?.[0];
    const context = await serverInput.getContext();
    const shutdown = context.shutdownHandler({
      gracePeriodMs: 5000,
      mode: "graceful",
    });
    await loop;
    await shutdown;

    expect(connectWebSocketMock).toHaveBeenCalledTimes(3);
    expect(
      presenter.data.mock.calls.some(
        (call) =>
          call[0]?.payload?.payload?.reasonCode === "service_reconnecting"
      )
    ).toBe(true);
  });

  it("starts each outage at the first retry and correlates its recovery after an acknowledged heartbeat", async () => {
    vi.useFakeTimers();
    let sessions = 0;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      sessions += 1;
      await input.touchRuntimeState({ heartbeatAt: new Date().toISOString() });
      if (sessions < 3) {
        throw new Error("socket closed");
      }
      await stopServiceThroughSigterm(input);
    });
    const loop = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });
    await waitForFakeTimerCondition("first outage", () => sessions === 1);
    await vi.advanceTimersByTimeAsync(1000);
    await waitForFakeTimerCondition("second outage", () => sessions === 2);
    await vi.advanceTimersByTimeAsync(1000);
    await loop;
    expect(
      runDaemonSocketSessionMock.mock.calls.map(
        ([input]) => input.reconnectAttempt
      )
    ).toEqual([0, 1, 1]);
    const events = emitDaemonLifecycleEventMock.mock.calls.map(
      ([event]) => event
    );
    const scheduled = events.filter((event) => event.result === "degraded");
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((event) => event.metadata.attempt)).toEqual([1, 1]);
    expect(
      new Set(scheduled.map((event) => event.metadata.recoveryId)).size
    ).toBe(2);
    for (const event of scheduled) {
      expect(events).toContainEqual(
        expect.objectContaining({
          result: "online",
          metadata: expect.objectContaining({
            recoveryId: event.metadata.recoveryId,
            elapsedMs: 1000,
          }),
        })
      );
    }
  });

  it("persists the first socket heartbeat without waiting for the runtime state throttle", async () => {
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      await input.touchRuntimeState({
        heartbeatAt: "2026-03-14T00:00:05.000Z",
      });
      await stopServiceThroughSigterm(input);
    });

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    expect(setDaemonServiceRuntimeStateMock).toHaveBeenCalledTimes(2);
    expect(writeDaemonRuntimeLeaseMock).toHaveBeenCalledTimes(2);
    expect(writeDaemonRuntimeLeaseMock.mock.calls[1]?.[0]).toMatchObject({
      generation: 4,
      bundleId: "service-bundle-1",
      heartbeatAt: "2026-03-14T00:00:05.000Z",
    });
  });

  it("signals controlled shutdown to the socket session without closing its cloud connection first", async () => {
    const close = vi.fn();
    connectWebSocketMock.mockResolvedValue(createConnectedSocket(close));
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      requestServiceSigterm();
      await expect(input.shutdownRequested).resolves.toBe(
        "controlled_service_update"
      );
    });

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    expect(close).not.toHaveBeenCalled();
  });

  it("requests one carrier handshake for repeated reporting authentication failures", async () => {
    const close = vi.fn();
    connectWebSocketMock.mockResolvedValue(createConnectedSocket(close));
    let sessionCount = 0;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      sessionCount += 1;
      if (sessionCount > 1) {
        await stopServiceThroughSigterm(input);
        return;
      }
      const failure = {
        credentialFingerprint: fingerprintRequestAuthorization("Bearer test"),
        message: "authentication required",
        reasonCode: "runtime.reporting.authentication_required",
      };
      await input.onRuntimeReportingAuthenticationFailure(failure);
      await input.onRuntimeReportingAuthenticationFailure(failure);
    });

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    expect(
      close.mock.calls.filter(
        ([code, reason]) =>
          code === 1012 && reason === "runtime_reporting_auth_recovery"
      )
    ).toHaveLength(1);
    expect(connectWebSocketMock).toHaveBeenCalledTimes(2);
    expect(runDaemonSocketSessionMock).toHaveBeenCalledTimes(2);
    const firstExecutionHost =
      runDaemonSocketSessionMock.mock.calls[0]?.[0]?.executionHost;
    const replacementExecutionHost =
      runDaemonSocketSessionMock.mock.calls[1]?.[0]?.executionHost;
    expect(firstExecutionHost).toBeDefined();
    expect(replacementExecutionHost).toBe(firstExecutionHost);
    expect(close).not.toHaveBeenCalledWith(1000, "shutdown");
  });

  it("does not let a stale reporting failure close the replacement socket", async () => {
    const firstSocketClose = vi.fn();
    const replacementSocketClose = vi.fn();
    connectWebSocketMock
      .mockResolvedValueOnce(createConnectedSocket(firstSocketClose))
      .mockResolvedValueOnce(createConnectedSocket(replacementSocketClose));
    let staleAuthenticationFailureHandler:
      | ((failure: {
          credentialFingerprint?: string;
          message: string;
          reasonCode: string;
        }) => Promise<void>)
      | null = null;
    let sessionCount = 0;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      sessionCount += 1;
      if (sessionCount === 1) {
        staleAuthenticationFailureHandler =
          input.onRuntimeReportingAuthenticationFailure;
        return;
      }
      await staleAuthenticationFailureHandler?.({
        credentialFingerprint: fingerprintRequestAuthorization("Bearer test"),
        message: "OpenMeld rejected the local authentication session.",
        reasonCode: "runtime.reporting.authentication_required",
      });
      await stopServiceThroughSigterm(input);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the stale-socket assertion.
    });

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    expect(firstSocketClose).not.toHaveBeenCalled();
    expect(replacementSocketClose).not.toHaveBeenCalledWith(
      1012,
      "runtime_reporting_auth_recovery"
    );
    expect(replacementSocketClose).not.toHaveBeenCalledWith(1000, "shutdown");
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      '"reason":"stale_socket"'
    );
  });

  it("binds a delayed control-plane reporting failure to its original socket", async () => {
    await withTempHome(async () => {
      const firstSocketClose = vi.fn();
      const replacementSocketClose = vi.fn();
      connectWebSocketMock
        .mockResolvedValueOnce(createConnectedSocket(firstSocketClose))
        .mockResolvedValueOnce(createConnectedSocket(replacementSocketClose));
      let completeFreshReport: (() => Promise<void>) | null = null;
      const reportStarted = Promise.withResolvers<void>();
      syncLocalServiceRuntimeAgentControllerReportsMock.mockImplementation(
        (input) =>
          new Promise((resolve) => {
            reportStarted.resolve();
            completeFreshReport = async () => {
              await input.onAttempt({
                authenticationRejected: true,
                family: "runtime_agent_controller",
                credentialFingerprint:
                  fingerprintRequestAuthorization("Bearer test"),
                message: "OpenMeld rejected the local authentication session.",
                reasonCode: "runtime.reporting.authentication_required",
                status: "failed",
              });
              resolve({
                failedCount: 1,
                reasonCodes: ["runtime.reporting.authentication_required"],
                reportCount: 1,
                status: "submitted",
                submittedCount: 0,
              });
            };
          })
      );
      let controlRequest: Promise<unknown> | null = null;
      let sessionCount = 0;
      runDaemonSocketSessionMock
        .mockReset()
        .mockImplementation(async (input) => {
          sessionCount += 1;
          if (sessionCount === 1) {
            const serverInput =
              startLocalDaemonControlPlaneServerMock.mock.calls[0]?.[0];
            const context = await serverInput.getContext();
            controlRequest = context.setLocalAgentEnabledHandler({
              agentId: "codex",
              enabled: true,
            });
            await reportStarted.promise;
            return;
          }
          if (!completeFreshReport) {
            throw new Error("expected the fresh report request to be pending");
          }
          await completeFreshReport();
          await controlRequest;
          await stopServiceThroughSigterm(input);
        });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
        // Keep test output focused on the bound-socket assertion.
      });

      await runDaemonServiceLoop({
        baseUrl: "http://localhost:8080",
        heartbeatIntervalMs: 5000,
        mode: "background",
        presenter: {
          view: "agent",
          event: vi.fn(),
          line: vi.fn(),
          data: vi.fn(),
        },
      });

      expect(firstSocketClose).not.toHaveBeenCalled();
      expect(replacementSocketClose).not.toHaveBeenCalledWith(
        1012,
        "runtime_reporting_auth_recovery"
      );
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
        '"reason":"stale_socket"'
      );
    });
  });

  it("keeps startup alive and resolves an empty catalog when the first scan fails without cache", async () => {
    loadDaemonRouteCatalogMock.mockRejectedValueOnce(
      new Error("binding lookup unavailable")
    );
    let firstResolvedCatalog: unknown = null;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      firstResolvedCatalog = await input.loadRouteCatalog();
      await stopServiceThroughSigterm(input);
    });

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    // Boot survives the failed scan: the service is already running and the
    // loader fell back to an empty catalog after the cache miss.
    expect(setDaemonServiceRuntimeStateMock).toHaveBeenCalled();
    expect(startLocalDaemonControlPlaneServerMock).toHaveBeenCalledTimes(1);
    expect(readDaemonRouteCatalogCacheMock).toHaveBeenCalledWith({
      lane: "dev-local",
      ownerUserId: "usr_123",
      serviceBundleId: "service-bundle-1",
    });
    expect(loadDaemonRouteCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEmpty: true,
        localReplyStateMode: "check",
      })
    );
    expect(firstResolvedCatalog).toMatchObject({ profileIds: [] });
  });

  it("recovers the first in-session catalog resolve from the matching cache", async () => {
    loadDaemonRouteCatalogMock.mockRejectedValueOnce(
      new Error("binding lookup unavailable")
    );
    readDaemonRouteCatalogCacheMock.mockResolvedValueOnce(
      sourceCatalog(["agt_11111111-1111-4111-8111-111111111111"])
    );
    let firstResolvedCatalog: unknown = null;
    let resolvedAfterLoad: boolean | null = null;
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      expect(input.isRouteCatalogResolved()).toBe(false);
      firstResolvedCatalog = await input.loadRouteCatalog();
      resolvedAfterLoad = input.isRouteCatalogResolved();
      await stopServiceThroughSigterm(input);
    });

    await runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter: {
        view: "agent",
        event: vi.fn(),
        line: vi.fn(),
        data: vi.fn(),
      },
    });

    expect(readDaemonRouteCatalogCacheMock).toHaveBeenCalledWith({
      lane: "dev-local",
      ownerUserId: "usr_123",
      serviceBundleId: "service-bundle-1",
    });
    expect(firstResolvedCatalog).toMatchObject({
      profileIds: ["agt_11111111-1111-4111-8111-111111111111"],
    });
    expect(resolvedAfterLoad).toBe(true);
    expect(startLocalDaemonControlPlaneServerMock).toHaveBeenCalledTimes(1);
    expect(runDaemonSocketSessionMock).toHaveBeenCalledTimes(1);
    expect(setDaemonServiceRuntimeStateMock).toHaveBeenCalled();
    expect(writeDaemonRuntimeLeaseMock).toHaveBeenCalled();
  });

  it.each([
    {
      reason: "session_expired" as const,
      authState: "expired",
      state: "authentication_required",
      failureReason: "auth_rejected",
      delayMs: 60_000,
    },
    {
      reason: "session_token_unavailable" as const,
      authState: null,
      state: "degraded",
      failureReason: "auth_unavailable",
      delayMs: 30_000,
    },
  ])("recovers $reason on its own retry schedule without restarting", async ({
    reason,
    authState,
    state,
    failureReason,
    delayMs,
  }) => {
    vi.useFakeTimers();
    const presenter = {
      view: "agent" as const,
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    };
    const validSession = {
      state: "valid" as const,
      session: createAuthSession({
        accessToken: "valid-token",
        expiresAt: "2999-01-01T00:00:00.000Z",
      }),
    };
    getAuthSessionStateMock.mockReset().mockResolvedValue(validSession);
    buildRequestAuthHeadersMock
      .mockReset()
      .mockRejectedValueOnce(
        new AuthRequestCredentialError({
          authHost: "localhost:8080",
          expectedGatewayHost: null,
          reason,
          ...(reason === "session_token_unavailable"
            ? { retryAfterMs: delayMs }
            : {}),
          requestHost: "localhost:8080",
        })
      )
      .mockResolvedValue({ Authorization: "Bearer valid-token" });
    connectWebSocketMock.mockReset().mockResolvedValue(createConnectedSocket());
    runDaemonSocketSessionMock.mockReset().mockImplementation(async (input) => {
      await stopServiceThroughSigterm(input);
    });

    const loopPromise = runDaemonServiceLoop({
      baseUrl: "http://localhost:8080",
      heartbeatIntervalMs: 5000,
      mode: "background",
      presenter,
    });

    await waitForFakeTimerCondition(
      "authentication_required lifecycle event",
      () =>
        emitDaemonLifecycleEventMock.mock.calls.some(([event]) => {
          const lifecycleEvent = event as
            | {
                metadata?: Record<string, unknown>;
                result?: string;
                type?: string;
              }
            | undefined;
          return (
            lifecycleEvent?.type === "connection.state" &&
            lifecycleEvent.result === state &&
            lifecycleEvent.metadata?.authState === authState &&
            lifecycleEvent.metadata?.reason === failureReason
          );
        })
    );
    expect(emitDaemonLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          authState,
          reason: failureReason,
        }),
        result: state,
        type: "connection.state",
      })
    );
    expect(connectWebSocketMock).not.toHaveBeenCalled();

    await waitForFakeTimerCondition("auth-required reconnect schedule", () =>
      presenter.data.mock.calls.some(
        (call) =>
          String(call[0]?.payload?.message ?? "").includes(
            `daemon stream reconnect scheduled in ${delayMs}ms`
          ) &&
          call[0]?.payload?.payload?.backoffMs === delayMs &&
          call[0]?.payload?.payload?.authState === authState &&
          call[0]?.payload?.payload?.reason === failureReason
      )
    );

    await vi.advanceTimersByTimeAsync(delayMs - 1);
    expect(connectWebSocketMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await loopPromise;

    expect(connectWebSocketMock).toHaveBeenCalledTimes(1);
    expect(startLocalAgentActivitySyncLoopMock).toHaveBeenCalledTimes(1);
    expect(startLocalAgentActivitySyncLoopMock).toHaveBeenCalledWith({
      onError: expect.any(Function),
      onResult: expect.any(Function),
    });
    expect(stopLocalAgentActivitySyncLoopMock).toHaveBeenCalledTimes(1);
    expect(buildRequestAuthHeadersMock).toHaveBeenCalledWith({
      requestUrl: expect.stringMatching(DAEMON_STREAM_URL_PATTERN),
    });
    expect(
      presenter.data.mock.calls.some((call) =>
        String(call[0]?.payload?.message ?? "").includes(
          `daemon stream reconnect scheduled in ${delayMs}ms`
        )
      )
    ).toBe(true);
  });

  it("fails closed without writing running state when local control plane startup fails", async () => {
    startLocalDaemonControlPlaneServerMock.mockRejectedValueOnce(
      new Error("control plane port unavailable")
    );

    await expect(
      runDaemonServiceLoop({
        baseUrl: "http://localhost:8080",
        heartbeatIntervalMs: 5000,
        mode: "background",
        presenter: {
          view: "agent",
          event: vi.fn(),
          line: vi.fn(),
          data: vi.fn(),
        },
      })
    ).rejects.toThrow("control plane port unavailable");

    expect(loadDaemonRouteCatalogMock).not.toHaveBeenCalled();
    expect(setDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
    expect(writeDaemonRuntimeLeaseMock).not.toHaveBeenCalled();
  });

  it("fails closed before writing runtime state when the service contract lane is missing", async () => {
    readDaemonServiceContractMock.mockResolvedValue(null);
    readDaemonActiveBundleStateMock.mockResolvedValue(null);
    resolveDaemonBundleEntryPathFromStateMock.mockResolvedValue(null);

    await expect(
      runDaemonServiceLoop({
        baseUrl: "http://localhost:8080",
        heartbeatIntervalMs: 5000,
        mode: "background",
        presenter: {
          view: "agent",
          event: vi.fn(),
          line: vi.fn(),
          data: vi.fn(),
        },
      })
    ).rejects.toMatchObject({
      code: "daemon.run.service_contract_lane_missing",
    });

    expect(setDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
    expect(writeDaemonRuntimeLeaseMock).not.toHaveBeenCalled();
    expect(clearDaemonServiceRuntimeStateMock).not.toHaveBeenCalled();
  });
});
