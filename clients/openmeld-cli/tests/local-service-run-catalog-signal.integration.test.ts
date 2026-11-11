import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadDaemonRouteCatalogMock,
  handleLocalProjectControlFrameMock,
  readDaemonCatalogSyncSignalMock,
  resolveLocalComponentsStatusMock,
  syncDaemonRouteCatalogStateMock,
  syncLocalServiceProviderConversationProofsMock,
  syncLocalServiceRuntimeAgentControllerReportsMock,
  ensureOpenMeldManagedProfileWorkspaceMock,
  setCustomProfileWorkspaceMock,
} = vi.hoisted(() => ({
  loadDaemonRouteCatalogMock: vi.fn(),
  handleLocalProjectControlFrameMock: vi.fn(),
  readDaemonCatalogSyncSignalMock: vi.fn(),
  resolveLocalComponentsStatusMock: vi.fn(),
  syncDaemonRouteCatalogStateMock: vi.fn(),
  syncLocalServiceProviderConversationProofsMock: vi.fn(),
  syncLocalServiceRuntimeAgentControllerReportsMock: vi.fn(),
  ensureOpenMeldManagedProfileWorkspaceMock: vi.fn(),
  setCustomProfileWorkspaceMock: vi.fn(),
}));

vi.mock("../src/local-service/projects/local-project-control-handler", () => ({
  handleLocalProjectControlFrame: (...args: unknown[]) =>
    handleLocalProjectControlFrameMock(...args),
}));

vi.mock(
  "../src/local-service/routing/route-catalog-state",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../src/local-service/routing/route-catalog-state")
    >()),
    createRouteCatalogFromMutableState: (state: {
      profileIds: string[];
      routeByProfileId: Map<string, unknown>;
      skippedProfiles: unknown[];
    }) => ({
      profileIds: [...state.profileIds],
      routeByProfileId: new Map(state.routeByProfileId),
      skippedProfiles: [...state.skippedProfiles],
    }),
    loadDaemonRouteCatalog: (...args: unknown[]) =>
      loadDaemonRouteCatalogMock(...args),
    syncDaemonRouteCatalogState: (...args: unknown[]) =>
      syncDaemonRouteCatalogStateMock(...args),
  })
);

vi.mock("../src/local-service/routing/route-catalog", () => ({
  loadDaemonRouteCatalog: (...args: unknown[]) =>
    loadDaemonRouteCatalogMock(...args),
}));
// Provider installation/history is an external boundary, not fixture state.
vi.mock("../src/agent-activity/integration-refresh", () => ({
  createManagedAgentActivityIntegrationRefreshScheduler: () => ({
    request: () => undefined,
    stop: async () => undefined,
  }),
}));
vi.mock("../src/agent-activity/local-sync", () => ({
  startLocalAgentActivitySyncLoop: () => ({
    requestSync: () => undefined,
    stop: async () => undefined,
  }),
}));

vi.mock("../src/local-service/state/catalog-sync-signal", () => ({
  readDaemonCatalogSyncSignal: (...args: unknown[]) =>
    readDaemonCatalogSyncSignalMock(...args),
}));

vi.mock("../src/local-components/manifest", () => ({
  resolveLocalComponentsStatus: (...args: unknown[]) =>
    resolveLocalComponentsStatusMock(...args),
}));

vi.mock("../src/profile-workspace/service", () => ({
  ensureOpenMeldManagedProfileWorkspace: (...args: unknown[]) =>
    ensureOpenMeldManagedProfileWorkspaceMock(...args),
  setCustomProfileWorkspace: (...args: unknown[]) =>
    setCustomProfileWorkspaceMock(...args),
}));

vi.mock(
  "../src/local-service/reporting/runtime-agent-controller-report-sync",
  () => ({
    syncLocalServiceRuntimeAgentControllerReports: (...args: unknown[]) =>
      syncLocalServiceRuntimeAgentControllerReportsMock(...args),
  })
);

vi.mock(
  "../src/local-service/reporting/provider-conversation-proof-sync",
  () => ({
    syncLocalServiceProviderConversationProofs: (...args: unknown[]) =>
      syncLocalServiceProviderConversationProofsMock(...args),
  })
);

import type { RuntimeAdapter } from "@openmeld/adapter-core";
import {
  createInflightTaskControlRegistry,
  createLocalAdapterContainer,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import {
  DAEMON_STREAM_KEEPALIVE_PING,
  DAEMON_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import type { RuntimeTransportStopCause } from "@openmeld/schemas/types";
import { runDaemonSocketSession as runDaemonSocketSessionInternal } from "../src/local-service/carrier/run-socket-session";
import { createServiceLocalComponentsObservation } from "../src/local-service/carrier/service-local-components-observation";
import { createControlledShutdownCoordinator } from "../src/local-service/carrier/service-runner";
import { requestLocalDaemonShutdown } from "../src/local-service/control-plane/client";
import { startLocalDaemonControlPlaneServer } from "../src/local-service/control-plane/server";
import {
  DAEMON_STREAM_KEEPALIVE_INTERVAL_MS,
  DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS,
  HEARTBEAT_RESPONSE_TIMEOUT_MS,
} from "../src/local-service/core/constants";
import type {
  CurrentDaemonSocketRef,
  LedgerPaths,
} from "../src/local-service/core/types";
import { loadExecutionHostCatalog } from "../src/local-service/execution-host/catalog";
import type { ExecutionHostPort } from "../src/local-service/execution-host/port";
import type { ExecutionHostResources } from "../src/local-service/execution-host/runtime";
import { createInProcessExecutionHost } from "./helpers/execution-host";

type RunTestDaemonSocketSessionInput = Omit<
  Parameters<typeof runDaemonSocketSessionInternal>[0],
  | "executionHost"
  | "drainExecutionHost"
  | "failHostShutdown"
  | "localComponentsObservation"
  | "loadRouteCatalog"
> &
  Omit<ExecutionHostResources, "initialCatalog"> & {
    decorateExecutionHost?: (host: ExecutionHostPort) => ExecutionHostPort;
    onSessionExit?: () => void;
    failHostShutdown?: (error: unknown) => never;
    profileOwnerName: string | null;
    loadRouteCatalog?: () => Promise<ExecutionHostResources["initialCatalog"]>;
  };

async function runDaemonSocketSession(
  input: RunTestDaemonSocketSessionInput
): Promise<void> {
  const {
    dispatchLimits,
    contextStore,
    inflightDispatchMetaByTaskId,
    inflightTaskControlRegistry,
    pendingAgentInteractionRegistry,
    localAdapterContainer,
    ledgerPaths,
    decorateExecutionHost,
    onSessionExit,
    profileOwnerName,
    ...sessionInput
  } = input;
  const isolatedLedger =
    ledgerPaths.rootDirPath === "/tmp/ledger"
      ? createLedgerPaths()
      : ledgerPaths;
  const host = await createInProcessExecutionHost({
    stateRoot: isolatedLedger.rootDirPath,
    daemonSessionId: input.daemonSessionId,
    deviceId: input.deviceId,
    ownerUserId: input.ownerUserId,
    profileOwnerName,
    presenter: input.presenter,
    resources: {
      dispatchLimits,
      contextStore,
      inflightDispatchMetaByTaskId,
      inflightTaskControlRegistry,
      pendingAgentInteractionRegistry,
      localAdapterContainer,
      ledgerPaths: isolatedLedger,
      initialCatalog: input.routeCatalogState,
    },
  });
  const localComponentsObservation = createServiceLocalComponentsObservation({
    onError: () => undefined,
  });
  const executionHost = decorateExecutionHost?.(host.port) ?? host.port;
  try {
    await runDaemonSocketSessionInternal({
      ...sessionInput,
      loadRouteCatalog:
        input.loadRouteCatalog ??
        (() =>
          loadExecutionHostCatalog(
            {
              lane: input.lane,
              ownerUserId: input.ownerUserId,
              localAdapterContainer,
              presenter: input.presenter,
              serviceBundleId: null,
            },
            false
          )),
      localComponentsObservation,
      executionHost,
      failHostShutdown:
        input.failHostShutdown ??
        ((error: unknown): never => {
          throw error;
        }),
      drainExecutionHost: async () => {
        await executionHost.call("drain", {}, { timeoutMs: null });
      },
    });
  } finally {
    onSessionExit?.();
    localComponentsObservation.dispose();
    await host.close();
  }
}

// biome-ignore lint/performance/noNamespaceImport: spy on the registration boundary while exercising the real Host.
import * as agentRegistry from "../src/agents/registry";
import { ensureDaemonControlPlaneToken } from "../src/config/daemon-state";
import {
  acknowledgeDispatchResultOutboxRecord,
  enqueueDispatchResultOutboxRecord,
  listDispatchResultOutboxPendingAcknowledgementKeys,
} from "../src/local-service/dispatch/dispatch-result-outbox";
import { withTempHome } from "./helpers/fs";

const tempDirs: string[] = [];

describe("local service run catalog signal", () => {
  beforeEach(() => {
    resolveLocalComponentsStatusMock.mockResolvedValue(null);
    handleLocalProjectControlFrameMock.mockReset();
    syncLocalServiceRuntimeAgentControllerReportsMock.mockResolvedValue({
      failedCount: 0,
      reasonCodes: [],
      reportCount: 0,
      status: "skipped",
      submittedCount: 0,
    });
    syncLocalServiceProviderConversationProofsMock.mockResolvedValue({
      failedCount: 0,
      proofCount: 0,
      reasonCodes: [],
      status: "skipped",
      submittedCount: 0,
    });
    ensureOpenMeldManagedProfileWorkspaceMock.mockResolvedValue({
      value: { mode: "openmeld_managed" },
      workspacePath: "/tmp/openmeld-managed-workspace",
    });
    setCustomProfileWorkspaceMock.mockResolvedValue({
      value: { mode: "custom" },
      workspacePath: "/Users/felix/Desktop/work/openmeld",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("stops an admitted idle session without waiting for held bootstrap cache persistence", async () => {
    await withTempHome(async () => {
      readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
      const cachePersistenceStarted = Promise.withResolvers<void>();
      const releaseCachePersistence = Promise.withResolvers<void>();
      let cachePersistenceSettled = false;
      const lines: Array<{ code: string; text: string }> = [];
      const socket = createMockSocket();
      let stopping = false;
      const coordinator = createControlledShutdownCoordinator({
        drainHost: async () => undefined,
        hasUndrainedWork: () => false,
        isStopRequested: () => stopping,
        markStopping: () => {
          stopping = true;
        },
      });
      const sessionShutdown =
        Promise.withResolvers<RuntimeTransportStopCause>();
      coordinator.attachSession(sessionShutdown.resolve);
      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, lines),
        persistRouteCatalogCache: async () => {
          cachePersistenceStarted.resolve();
          await releaseCachePersistence.promise;
          cachePersistenceSettled = true;
        },
        shutdownRequested: sessionShutdown.promise,
      })
        .then(() => {
          coordinator.handleSessionCompleted();
        })
        .finally(() => {
          coordinator.detachSession(sessionShutdown.resolve);
        });

      await cachePersistenceStarted.promise;
      const phases: string[] = [];
      const server = await startLocalDaemonControlPlaneServer({
        expectedToken: await ensureDaemonControlPlaneToken(),
        getContext: () => ({
          healthPayload: {
            checkedAt: new Date().toISOString(),
            reasonCode: "ok",
            runtimeState: "healthy",
            state: "ok",
          },
          historyEntries: [],
          shutdownHandler: (payload, lifecycle) =>
            coordinator.request({
              ...payload,
              onAdmission: (commit) => {
                commit();
                lifecycle?.onAdmitted();
                return Promise.resolve();
              },
            }),
          statusPayload: {
            checkedAt: new Date().toISOString(),
            daemonVersion: "0.4.0",
            installed: true,
            running: true,
            runtimeRoot: "/tmp/daemon-runtime",
          },
        }),
        onRequestPhase: (event) => phases.push(event.phase),
      });

      const shutdown = requestLocalDaemonShutdown({
        endpoint: server.endpoint,
        payload: { gracePeriodMs: 5000, mode: "graceful" },
        timeoutMs: 1500,
      });
      const observedShutdown = shutdown.then(
        (value) => ({ status: "resolved" as const, value }),
        (error: unknown) => ({ error, status: "rejected" as const })
      );
      try {
        const outcome = await Promise.race([
          observedShutdown,
          new Promise<{ status: "pending" }>((resolve) => {
            setTimeout(() => resolve({ status: "pending" }), 750);
          }),
        ]);
        expect(outcome).toEqual({
          status: "resolved",
          value: {
            accepted: true,
            gracePeriodMs: 5000,
            mode: "graceful",
          },
        });
        await expect(sessionPromise).resolves.toBeUndefined();
        expect(cachePersistenceSettled).toBe(false);
        expect(phases).toEqual([
          "received",
          "authenticated",
          "shutdown_admitted",
        ]);
        expect(socket.closeCount).toBe(1);
      } finally {
        releaseCachePersistence.resolve();
        await observedShutdown;
        await server.close();
      }
    });
  });

  it.each([
    "cache",
    "catalog_signal",
  ] as const)("releases a disconnected session while bootstrap %s is pending", async (stage) => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const heldOperation = async () => {
        started.resolve();
        await release.promise;
        return null;
      };
      readDaemonCatalogSyncSignalMock.mockImplementation(
        stage === "catalog_signal" ? heldOperation : async () => null
      );
      const socket = createMockSocket();
      let exited = false;
      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, []),
        // Observe the connector boundary before the fixture shuts down its Host.
        onSessionExit: () => {
          exited = true;
        },
        persistRouteCatalogCache: async () => {
          if (stage === "cache") {
            await heldOperation();
          }
        },
      });
      const outcome = sessionPromise.then(
        () => null,
        (error: unknown) => error
      );
      await started.promise;
      socket.emitClose(1006, "bootstrap connection lost");
      await vi.advanceTimersByTimeAsync(0);
      const exitedBeforeBootstrap = exited;
      release.resolve();
      const result = await outcome;
      expect(exitedBeforeBootstrap).toBe(true);
      expect(result).toBeInstanceOf(Error);
    });
  });

  it("keeps the controlled drain socket open until a durable result is acknowledged", async () => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      loadDaemonRouteCatalogMock.mockResolvedValue({
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      });
      syncDaemonRouteCatalogStateMock.mockResolvedValue({
        skippedProfiles: [],
        status: "unchanged",
      });
      readDaemonCatalogSyncSignalMock.mockResolvedValue({
        reason: "baseline",
        updatedAt: "2026-07-30T00:00:00.000Z",
        updatedAtMs: 1000,
      });
      const lines: Array<{ code: string; text: string }> = [];
      const socket = createMockSocket();
      const ledgerPaths = createLedgerPaths();
      enqueuePendingResult({
        currentSocketRef: {
          connectionGeneration: null,
          socket: null,
        },
        ledgerPaths,
      });
      let requestShutdown!: (cause: "controlled_service_update") => void;
      const shutdownRequested = new Promise<"controlled_service_update">(
        (resolve) => {
          requestShutdown = resolve;
        }
      );
      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, lines, 1000),
        ledgerPaths,
        shutdownRequested,
      });

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() => socket.heartbeatSendCount > 0);
      requestShutdown("controlled_service_update");
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() =>
        socket.sentFrames.some(
          (frame) =>
            isHeartbeatFrame(frame) &&
            frame.payload.acceptingDispatches === false
        )
      );
      const drainingHeartbeatCount = () =>
        socket.sentFrames.filter(
          (frame) =>
            isHeartbeatFrame(frame) &&
            frame.payload.acceptingDispatches === false
        ).length;
      const firstDrainingHeartbeatCount = drainingHeartbeatCount();

      await vi.advanceTimersByTimeAsync(4000);
      await flushMicrotasks();

      expect(drainingHeartbeatCount()).toBeGreaterThanOrEqual(
        firstDrainingHeartbeatCount
      );
      expect(
        socket.sentFrames
          .filter(isHeartbeatFrame)
          .filter((frame) => frame.payload.acceptingDispatches === false)
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              acceptingDispatches: false,
              stopCause: "controlled_service_update",
            }),
          }),
        ])
      );
      expect(socket.closeCount).toBe(0);

      socket.emitServerFrame({
        v: 1,
        code: "daemon.dispatch.accepted",
        payload: {
          attemptId: "attempt-drain-1",
          dispatchId: "dispatch-drain-1",
          ok: true,
          status: "accepted",
        },
      });
      await sessionPromise;

      expect(socket.closeCount).toBe(1);
      const firstCloseIndex = socket.eventOrder.indexOf("close");
      const resultIndex = socket.eventOrder.indexOf("daemon.dispatch.result");
      expect(resultIndex).toBeGreaterThanOrEqual(0);
      expect(firstCloseIndex).toBeGreaterThan(resultIndex);
    });
  });

  it("finishes a drained shutdown with durable results preserved when the socket closes before acknowledgement", async () => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      loadDaemonRouteCatalogMock.mockResolvedValue({
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      });
      syncDaemonRouteCatalogStateMock.mockResolvedValue({
        skippedProfiles: [],
        status: "unchanged",
      });
      readDaemonCatalogSyncSignalMock.mockResolvedValue({
        reason: "baseline",
        updatedAt: "2026-07-30T00:00:00.000Z",
        updatedAtMs: 1000,
      });
      const lines: Array<{ code: string; text: string }> = [];
      const socket = createMockSocket();
      const ledgerPaths = createLedgerPaths();
      enqueuePendingResult({
        currentSocketRef: {
          connectionGeneration: null,
          socket: null,
        },
        ledgerPaths,
      });
      let requestShutdown!: (cause: "controlled_service_update") => void;
      const shutdownRequested = new Promise<"controlled_service_update">(
        (resolve) => {
          requestShutdown = resolve;
        }
      );
      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, lines, 5000),
        ledgerPaths,
        shutdownRequested,
      });

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() => socket.heartbeatSendCount > 0);
      requestShutdown("controlled_service_update");
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() =>
        socket.sentFrames.some(
          (frame) =>
            typeof frame === "object" &&
            frame !== null &&
            "code" in frame &&
            frame.code === "daemon.dispatch.result"
        )
      );

      socket.emitClose(1006, "network lost before result acknowledgement");

      await expect(sessionPromise).resolves.toBeUndefined();
      expect(
        listDispatchResultOutboxPendingAcknowledgementKeys({ ledgerPaths })
      ).toEqual(["dispatch-drain-1::attempt-drain-1"]);
    });
  });

  it.each([
    "user_stop",
    "controlled_service_update",
  ] as const)("preserves %s through the final heartbeat when the close reason is omitted", async (stopCause) => {
    vi.useFakeTimers();
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket({
      closeEventReason: "",
    });
    let requestShutdown!: (cause: RuntimeTransportStopCause) => void;
    const shutdownRequested = new Promise<RuntimeTransportStopCause>(
      (resolve) => {
        requestShutdown = resolve;
      }
    );
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, lines, 5000),
      shutdownRequested,
    });

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(() => socket.heartbeatSendCount > 0);
    requestShutdown(stopCause);

    await expect(sessionPromise).resolves.toBeUndefined();
    expect(socket.closeCount).toBe(1);
    expect(socket.sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.session.heartbeat",
        payload: expect.objectContaining({
          acceptingDispatches: false,
          stopCause,
        }),
      })
    );
    expect(
      lines
        .map((line) => line.code)
        .filter((code) => code.startsWith("daemon.run.controlled_shutdown_"))
    ).toEqual([
      "daemon.run.controlled_shutdown_started",
      "daemon.run.controlled_shutdown_inflight_heartbeat_completed",
      "daemon.run.controlled_shutdown_final_heartbeat_completed",
      "daemon.run.controlled_shutdown_draining",
    ]);
  });

  it.each([
    "rejected",
    "timeout",
  ] as const)("finishes local drain and reports unconfirmed offline status when the final heartbeat is %s", async (failure) => {
    vi.useFakeTimers();
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket({
      rejectStoppingHeartbeat: failure === "rejected",
      respondToHeartbeat: (frame) =>
        failure !== "timeout" || frame.payload.acceptingDispatches !== false,
    });
    const shutdown = Promise.withResolvers<RuntimeTransportStopCause>();
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, lines, 5000),
      shutdownRequested: shutdown.promise,
    });
    // Observe rejection before advancing the deadline; never leave an unhandled promise.
    const outcome = sessionPromise.then(
      () => null,
      (error: unknown) => error
    );
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(() => socket.heartbeatSendCount > 0);
    shutdown.resolve("user_stop");
    await vi.advanceTimersByTimeAsync(HEARTBEAT_RESPONSE_TIMEOUT_MS + 1);
    expect(await outcome).toBeNull();
    expect(lines.map((line) => line.code)).not.toContain(
      "daemon.run.controlled_shutdown_final_heartbeat_completed"
    );
    expect(lines.map((line) => line.code)).toContain(
      "daemon.run.controlled_shutdown_offline_unconfirmed"
    );
    expect(socket.closeCount).toBe(1);
  });

  it.each([
    "close",
    "error",
    "missing_pong",
  ] as const)("releases a stopped connector on %s while the Host still owns pending work", async (failure) => {
    vi.useFakeTimers();
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket({
      respondToKeepalive: failure !== "missing_pong",
      terminateEmitsClose: false,
    });
    const drain = Promise.withResolvers<void>();
    const drainStarted = Promise.withResolvers<void>();
    const settleResults = vi.fn();
    // A stop carried into a replacement session is already pending during
    // bootstrap. Its keepalive must still detect a half-open connection.
    const session = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, lines),
      shutdownRequested: Promise.resolve("user_stop"),
      decorateExecutionHost: (host) => ({
        ...host,
        call: async (method, payload, options) => {
          if (method === "drain") {
            drainStarted.resolve();
            await drain.promise;
          }
          if (method === "settleResults") {
            settleResults();
          }
          return host.call(method, payload, options);
        },
      }),
    });
    const outcome = session.then(
      () => null,
      (error: unknown) => error
    );
    await drainStarted.promise;
    if (failure === "close") {
      socket.emitClose(1006, "network lost");
    }
    if (failure === "error") {
      socket.emitError(new Error("network lost"));
    }
    if (failure === "missing_pong") {
      await vi.advanceTimersByTimeAsync(
        DAEMON_STREAM_KEEPALIVE_INTERVAL_MS +
          DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS +
          1
      );
    }
    // This must finish before Host drain does; otherwise reconnect cannot run.
    expect(await outcome).toBeInstanceOf(Error);
    expect(settleResults).not.toHaveBeenCalled();
    drain.resolve();
    await flushMicrotasks();
    // The old drain continuation cannot settle a replacement connection.
    expect(settleResults).not.toHaveBeenCalled();
    expect(socket.closeCount).toBe(0);
  });

  it.each([
    "beginDrain",
    "settleResults",
  ] as const)("reports a Host %s failure instead of treating it as a lost connection", async (failedMethod) => {
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    const socket = createMockSocket({});
    const error = new Error("Execution Host IPC disconnected");
    const failHostShutdown = vi.fn((failure: unknown): never => {
      throw failure;
    });
    await expect(
      runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, []),
        shutdownRequested: Promise.resolve("user_stop"),
        failHostShutdown,
        decorateExecutionHost: (host) => ({
          ...host,
          call: async (method, payload, options) => {
            if (method === failedMethod) {
              throw error;
            }
            return await host.call(method, payload, options);
          },
        }),
      })
    ).rejects.toBe(error);
    expect(failHostShutdown).toHaveBeenCalledExactlyOnceWith(error);
    expect(socket.closeCount).toBe(0);
  });

  it("terminates a half-open socket instead of hanging controlled shutdown", async () => {
    vi.useFakeTimers();
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket({ hangOnClose: true });
    let requestShutdown!: (cause: "controlled_service_update") => void;
    const shutdownRequested = new Promise<"controlled_service_update">(
      (resolve) => {
        requestShutdown = resolve;
      }
    );
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, lines, 5000),
      shutdownRequested,
    });

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(() => socket.heartbeatSendCount > 0);
    requestShutdown("controlled_service_update");
    await vi.advanceTimersByTimeAsync(5000);
    await flushMicrotasks();

    const terminateCountAtDeadline = socket.terminateCount;
    if (terminateCountAtDeadline === 0) {
      socket.emitClose(1000, "test cleanup");
    }
    await sessionPromise;

    expect(terminateCountAtDeadline).toBe(1);
    expect(lines).toContainEqual(
      expect.objectContaining({
        code: "daemon.run.controlled_shutdown_socket_close_timeout",
      })
    );
  });

  it("preserves an unacknowledged result and finishes controlled shutdown after the receipt deadline", async () => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
      const lines: Array<{ code: string; text: string }> = [];
      const socket = createMockSocket();
      const ledgerPaths = createLedgerPaths();
      enqueuePendingResult({
        currentSocketRef: {
          connectionGeneration: null,
          socket: null,
        },
        ledgerPaths,
      });
      let requestShutdown!: (cause: "controlled_service_update") => void;
      const shutdownRequested = new Promise<"controlled_service_update">(
        (resolve) => {
          requestShutdown = resolve;
        }
      );
      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, lines, 5000),
        ledgerPaths,
        shutdownRequested,
      });

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() => socket.heartbeatSendCount > 0);
      requestShutdown("controlled_service_update");
      await vi.advanceTimersByTimeAsync(5000);
      await flushMicrotasks();

      const closeCountAtDeadline = socket.closeCount;
      if (closeCountAtDeadline === 0) {
        acknowledgeDispatchResultOutboxRecord({
          attemptId: "attempt-drain-1",
          dispatchId: "dispatch-drain-1",
          ledgerPaths,
          ok: true,
          presenter: {
            view: "agent",
            event: () => undefined,
            line: () => undefined,
            data: () => undefined,
          },
        });
      }
      await sessionPromise;

      expect(closeCountAtDeadline).toBe(1);
      expect(lines).toContainEqual(
        expect.objectContaining({
          code: "daemon.run.controlled_shutdown_result_ack_timeout",
        })
      );
      if (closeCountAtDeadline > 0) {
        expect(
          listDispatchResultOutboxPendingAcknowledgementKeys({ ledgerPaths })
        ).toEqual(["dispatch-drain-1::attempt-drain-1"]);
      }
    });
  });

  it("replays durable startup results before opening dispatch admission", async () => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      loadDaemonRouteCatalogMock.mockResolvedValue({
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      });
      syncDaemonRouteCatalogStateMock.mockResolvedValue({
        skippedProfiles: [],
        status: "unchanged",
      });
      readDaemonCatalogSyncSignalMock.mockResolvedValue({
        reason: "baseline",
        updatedAt: "2026-07-30T00:00:00.000Z",
        updatedAtMs: 1000,
      });
      const lines: Array<{ code: string; text: string }> = [];
      const socket = createMockSocket();
      const ledgerPaths = createLedgerPaths();
      enqueuePendingResult({
        currentSocketRef: {
          connectionGeneration: null,
          socket: null,
        },
        ledgerPaths,
      });

      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, lines, 5000),
        ledgerPaths,
      });

      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() => socket.heartbeatSendCount > 0);

      const firstResultIndex = socket.eventOrder.indexOf(
        "daemon.dispatch.result"
      );
      const firstHeartbeatIndex = socket.eventOrder.indexOf(
        "daemon.session.heartbeat"
      );
      expect(firstResultIndex).toBeGreaterThanOrEqual(0);
      expect(firstHeartbeatIndex).toBeGreaterThan(firstResultIndex);
      expect(socket.sentFrames.filter(isHeartbeatFrame).at(0)).toMatchObject({
        payload: {
          acceptingDispatches: false,
        },
      });

      socket.emitServerFrame({
        v: 1,
        code: "daemon.dispatch.accepted",
        payload: {
          attemptId: "attempt-drain-1",
          dispatchId: "dispatch-drain-1",
          ok: true,
          status: "accepted",
        },
      });
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks(() =>
        socket.sentFrames
          .filter(isHeartbeatFrame)
          .some((frame) => frame.payload.acceptingDispatches !== false)
      );

      expect(
        socket.sentFrames
          .filter(isHeartbeatFrame)
          .some((frame) => frame.payload.acceptingDispatches !== false)
      ).toBe(true);
      expect(
        lines.some(
          (line) => line.code === "daemon.run.startup_result_replay_completed"
        )
      ).toBe(true);

      socket.close(1000, "shutdown");
      await sessionPromise;
    });
  });

  it("syncs a new catalog signal even when two writes share one millisecond", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];
    loadDaemonRouteCatalogMock.mockResolvedValue({
      profileIds: ["agt-1"],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    });

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock
      .mockResolvedValueOnce({
        signalId: "signal-baseline",
        updatedAt: "2026-03-06T00:00:00.000Z",
        updatedAtMs: 1000,
        reason: "baseline",
      })
      .mockResolvedValue({
        signalId: "signal-project-change",
        updatedAt: "2026-03-06T00:00:00.000Z",
        updatedAtMs: 1000,
        reason: "profile_updated",
      });

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-1",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: (input) => {
          lines.push({
            code: input.code,
            text: input.text,
          });
        },
        data: () => undefined,
      },
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      reconnectAttempt: 0,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1);
    expect(lines.some((line) => line.code === "daemon.run.registered")).toBe(
      true
    );
    expect(
      lines.some(
        (line) => line.code === "daemon.run.catalog_sync_signal_detected"
      )
    ).toBe(true);
    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);
    const syncInput = syncDaemonRouteCatalogStateMock.mock.calls[0]?.[0] as
      | { loadCatalog: () => Promise<unknown> }
      | undefined;
    await syncInput?.loadCatalog();
    expect(loadDaemonRouteCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEmpty: true,
        localReplyStateMode: "check",
        quiet: true,
      })
    );

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("rejects register wait immediately when socket closes before register response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const dataEntries: Array<{ code: string; payload: unknown }> = [];
    const socket = createMockSocket({
      respondToRegister: false,
    });

    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-register-close",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "agent",
        event: () => undefined,
        line: () => undefined,
        data: (input) => {
          dataEntries.push(input);
        },
      },
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      reconnectAttempt: 0,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(socket.sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.session.register",
      })
    );

    socket.close(1006, "closed");
    await expect(sessionPromise).rejects.toMatchObject({
      code: "daemon.run.socket_closed",
    });
    expect(
      dataEntries.find((entry) => entry.code === "daemon.run.socket_closed")
    ).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          payload: expect.objectContaining({
            abnormalClosure: true,
            closeCode: 1006,
            deployAdjacentReason: "websocket_1006_abnormal_close",
            disconnectClass: "possible_deploy_or_edge_restart",
            durationMs: 0,
          }),
        }),
      })
    );
  });

  it("retries runtime agent controller report sync quickly after write failures", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const lines: Array<{ code: string; text: string }> = [];

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    syncLocalServiceRuntimeAgentControllerReportsMock
      .mockResolvedValueOnce({
        failedCount: 3,
        reasonCodes: ["runtime.reporting.write_failed"],
        reportCount: 3,
        status: "submitted",
        submittedCount: 0,
      })
      .mockResolvedValueOnce({
        failedCount: 0,
        reasonCodes: [],
        reportCount: 3,
        status: "submitted",
        submittedCount: 3,
      });

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-runtime-report-retry",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: (input) => {
          lines.push({
            code: input.code,
            text: input.text,
          });
        },
        data: () => undefined,
      },
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      reconnectAttempt: 0,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(1);
    expect(
      lines.some(
        (line) =>
          line.code === "daemon.run.runtime_agent_controller_report_sync_failed"
      )
    ).toBe(true);

    // A failed publication must retry within ten seconds, leaving room inside
    // the two-minute native authentication evidence lifetime.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(2);
    expect(
      lines.some(
        (line) =>
          line.code === "daemon.run.runtime_agent_controller_report_sync" &&
          line.text.includes("accepted=3")
      )
    ).toBe(true);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("runs a due runtime agent controller report pass without waiting for the next idle heartbeat", async () => {
    vi.useFakeTimers();
    // Lowest jitter: the idle heartbeat lands just before the report pass is
    // due, so a heartbeat-only trigger would wait almost a second interval.
    vi.spyOn(Math, "random").mockReturnValue(0);

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    syncLocalServiceRuntimeAgentControllerReportsMock.mockResolvedValue({
      failedCount: 0,
      reasonCodes: [],
      reportCount: 3,
      status: "submitted",
      submittedCount: 3,
    });

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-runtime-report-own-timer",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 60_000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      reconnectAttempt: 0,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(1);

    // Core expires a native check two minutes after its check time, so the
    // next pass must run on its own cadence rather than on the next heartbeat.
    await vi.advanceTimersByTimeAsync(2000);
    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(2);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("keeps heartbeat scheduling independent from slow supplemental evidence sync", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const completedRuntimeReportSync = {
      failedCount: 0,
      reasonCodes: [],
      reportCount: 3,
      status: "submitted",
      submittedCount: 3,
    };
    const runtimeReportSyncResolver: {
      current: ((value: typeof completedRuntimeReportSync) => void) | null;
    } = { current: null };
    syncLocalServiceRuntimeAgentControllerReportsMock.mockReturnValue(
      new Promise((resolve) => {
        runtimeReportSyncResolver.current = resolve;
      })
    );

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-slow-runtime-report",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: (input) => {
          lines.push({
            code: input.code,
            text: input.text,
          });
        },
        data: () => undefined,
      },
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      reconnectAttempt: 0,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalled();
    expect(lines.some((line) => line.code === "daemon.run.heartbeat")).toBe(
      true
    );
    expect(
      lines.some(
        (line) =>
          line.code === "daemon.run.heartbeat_scheduled" &&
          line.text.includes("idle_growth")
      )
    ).toBe(true);

    const resolveRuntimeReportSync = runtimeReportSyncResolver.current;
    if (!resolveRuntimeReportSync) {
      throw new Error("expected runtime report sync to start");
    }
    resolveRuntimeReportSync(completedRuntimeReportSync);
    await vi.advanceTimersByTimeAsync(0);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("keeps heartbeat renewal independent from slow route catalog sync", async () => {
    vi.useFakeTimers();
    let syncRouteCatalog: ((reason: string) => Promise<unknown>) | null = null;
    const lines: Array<{ code: string; text: string }> = [];

    const routeSyncResolver: {
      current:
        | ((
            value: Awaited<ReturnType<typeof syncDaemonRouteCatalogStateMock>>
          ) => void)
        | null;
    } = { current: null };
    syncDaemonRouteCatalogStateMock.mockReturnValue(
      new Promise((resolve) => {
        routeSyncResolver.current = resolve;
      })
    );
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      attachRouteCatalogSyncInvoker: (invoker) => {
        syncRouteCatalog = invoker;
      },
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-slow-route-catalog",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: (input) => {
          lines.push({
            code: input.code,
            text: input.text,
          });
        },
        data: () => undefined,
      },
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      reconnectAttempt: 0,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(
      lines.filter((line) => line.code === "daemon.run.heartbeat")
    ).toHaveLength(1);

    const attachedSyncRouteCatalog = syncRouteCatalog as
      | ((reason: string) => Promise<unknown>)
      | null;
    if (!attachedSyncRouteCatalog) {
      throw new Error("expected syncRouteCatalog to be attached");
    }

    const syncPromise = attachedSyncRouteCatalog("profile_updated");
    await vi.advanceTimersByTimeAsync(0);

    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);
    expect(
      lines.filter((line) => line.code === "daemon.run.heartbeat")
    ).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      lines.filter((line) => line.code === "daemon.run.heartbeat").length
    ).toBeGreaterThanOrEqual(3);
    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);

    const resolveRouteSync = routeSyncResolver.current;
    if (!resolveRouteSync) {
      throw new Error("expected route catalog sync to start");
    }
    resolveRouteSync({
      skippedProfiles: [],
      status: "unchanged",
    });
    await expect(syncPromise).resolves.toMatchObject({
      status: "unchanged",
    });

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("keeps admission open when same-connection catalog configure finishes during a heartbeat", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    let syncRouteCatalog: ((reason: string) => Promise<unknown>) | null = null;
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });

    const secondConfigureStarted = Promise.withResolvers<void>();
    const releaseSecondConfigure = Promise.withResolvers<void>();
    let configureCallCount = 0;
    let holdHeartbeat = false;
    const socket = createMockSocket({
      executionAdmissionConfirmation: true,
      respondToHeartbeat: () => !holdHeartbeat,
    });
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, [], 60_000),
      attachRouteCatalogSyncInvoker: (invoker) => {
        syncRouteCatalog = invoker;
      },
      heartbeatIntervalMs: 1000,
      daemonSessionId: "session-catalog-configure-heartbeat-race",
      decorateExecutionHost: (host) => ({
        ...host,
        call: async (method, payload, options) => {
          if (method === "configureConnection") {
            configureCallCount += 1;
            if (configureCallCount === 2) {
              secondConfigureStarted.resolve();
              await releaseSecondConfigure.promise;
            }
          }
          return await host.call(method, payload, options);
        },
      }),
    });

    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks(() => configureCallCount === 1);
    expect(
      socket.sentFrames
        .filter(isHeartbeatFrame)
        .some((frame) => frame.payload.acceptingDispatches !== false)
    ).toBe(true);

    const attachedSyncRouteCatalog = syncRouteCatalog as
      | ((reason: string) => Promise<unknown>)
      | null;
    if (!attachedSyncRouteCatalog) {
      throw new Error("expected syncRouteCatalog to be attached");
    }
    const framesBeforeSync = socket.sentFrames.length;
    const heartbeatCountBeforeSync = socket.heartbeatSendCount;
    holdHeartbeat = true;
    const syncPromise = attachedSyncRouteCatalog("periodic_catalog_refresh");
    await flushMicrotasks(() => configureCallCount === 2);
    await secondConfigureStarted.promise;
    await vi.advanceTimersByTimeAsync(1000);

    const pendingHeartbeatIndex = socket.sentFrames.findLastIndex(
      (frame) =>
        isHeartbeatFrame(frame) && frame.payload.acceptingDispatches !== false
    );
    expect(pendingHeartbeatIndex).toBeGreaterThanOrEqual(0);
    expect(socket.heartbeatSendCount).toBe(heartbeatCountBeforeSync + 1);
    expect(
      socket.sentFrames
        .slice(framesBeforeSync)
        .filter(isHeartbeatFrame)
        .every((frame) => frame.payload.acceptingDispatches !== false)
    ).toBe(true);
    const heartbeatCountWithRequestInFlight = socket.heartbeatSendCount;

    releaseSecondConfigure.resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    const heartbeatCountBeforeAck = socket.heartbeatSendCount;
    holdHeartbeat = false;
    socket.emitServerFrame({
      v: 1,
      code: "daemon.session.heartbeat",
      payload: {
        ok: true,
        serverNowMs: Date.now(),
        staleLeases: [],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(syncPromise).resolves.toMatchObject({ status: "unchanged" });

    await vi.advanceTimersByTimeAsync(60_000);
    const acceptingPublishedAtCadence = socket.sentFrames
      .slice(pendingHeartbeatIndex + 1)
      .some(
        (frame) =>
          isHeartbeatFrame(frame) && frame.payload.acceptingDispatches !== false
      );

    socket.close(1000, "shutdown");
    await sessionPromise;
    const heartbeatCountAfterClose = socket.heartbeatSendCount;
    await vi.advanceTimersByTimeAsync(60_000);

    expect({
      acceptingPublishedAtCadence,
      heartbeatCountBeforeAck,
      heartbeatCountAfterClose: socket.heartbeatSendCount,
      heartbeatCountWithRequestInFlight,
    }).toMatchObject({
      acceptingPublishedAtCadence: true,
      heartbeatCountBeforeAck: heartbeatCountWithRequestInFlight,
      heartbeatCountAfterClose,
    });
  });

  it("publishes initial Host admission when configure opens during the first heartbeat", async () => {
    vi.useFakeTimers();
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    const firstConfigureStarted = Promise.withResolvers<void>();
    const releaseFirstConfigure = Promise.withResolvers<void>();
    const socket = createMockSocket({
      executionAdmissionConfirmation: true,
      admissionEvidence: true,
      respondToHeartbeat: (frame) =>
        frame.payload.acceptingDispatches !== false,
    });
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, [], 60_000),
      daemonSessionId: "session-initial-configure-heartbeat-race",
      decorateExecutionHost: (host) => ({
        ...host,
        call: async (method, payload, options) => {
          if (method === "configureConnection") {
            firstConfigureStarted.resolve();
            await releaseFirstConfigure.promise;
          }
          return await host.call(method, payload, options);
        },
      }),
    });

    await firstConfigureStarted.promise;
    await vi.advanceTimersByTimeAsync(0);
    const falseHeartbeatIndex = socket.sentFrames.findLastIndex(
      (frame) =>
        isHeartbeatFrame(frame) && frame.payload.acceptingDispatches === false
    );
    expect(falseHeartbeatIndex).toBeGreaterThanOrEqual(0);
    expect(socket.sentFrames[falseHeartbeatIndex]).toMatchObject({
      payload: {
        admissionEvidence: {
          acceptingDispatches: false,
          reasonCode: "connection_initializing",
        },
      },
    });
    const heartbeatCountWithFalseInFlight = socket.heartbeatSendCount;

    releaseFirstConfigure.resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.heartbeatSendCount).toBe(heartbeatCountWithFalseInFlight);
    socket.emitServerFrame({
      v: 1,
      code: "daemon.session.heartbeat",
      payload: {
        ok: true,
        serverNowMs: Date.now(),
        staleLeases: [],
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(
      socket.sentFrames
        .slice(falseHeartbeatIndex + 1)
        .some(
          (frame) =>
            isHeartbeatFrame(frame) &&
            frame.payload.acceptingDispatches !== false &&
            frame.payload.admissionEvidence?.reasonCode === "host_ready"
        )
    ).toBe(true);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("publishes the latest draining admission after a queued heartbeat settles", async () => {
    vi.useFakeTimers();
    let syncRouteCatalog: ((reason: string) => Promise<unknown>) | null = null;
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);
    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });

    const secondConfigureStarted = Promise.withResolvers<void>();
    const releaseSecondConfigure = Promise.withResolvers<void>();
    const shutdownRequested =
      Promise.withResolvers<RuntimeTransportStopCause>();
    let configureCallCount = 0;
    let holdHeartbeat = false;
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket({
      executionAdmissionConfirmation: true,
      respondToHeartbeat: () => !holdHeartbeat,
    });
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, lines, 60_000),
      attachRouteCatalogSyncInvoker: (invoker) => {
        syncRouteCatalog = invoker;
      },
      heartbeatIntervalMs: 1000,
      daemonSessionId: "session-catalog-configure-drain-race",
      decorateExecutionHost: (host) => ({
        ...host,
        call: async (method, payload, options) => {
          if (method === "configureConnection") {
            configureCallCount += 1;
            if (configureCallCount === 2) {
              secondConfigureStarted.resolve();
              await releaseSecondConfigure.promise;
            }
          }
          return await host.call(method, payload, options);
        },
      }),
      shutdownRequested: shutdownRequested.promise,
    });

    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks(() => configureCallCount === 1);
    const attachedSyncRouteCatalog = syncRouteCatalog as
      | ((reason: string) => Promise<unknown>)
      | null;
    if (!attachedSyncRouteCatalog) {
      throw new Error("expected syncRouteCatalog to be attached");
    }

    holdHeartbeat = true;
    const syncPromise = attachedSyncRouteCatalog("periodic_catalog_refresh");
    await flushMicrotasks(() => configureCallCount === 2);
    await secondConfigureStarted.promise;
    await vi.advanceTimersByTimeAsync(1000);
    const pendingHeartbeatIndex = socket.sentFrames.findLastIndex(
      (frame) =>
        isHeartbeatFrame(frame) && frame.payload.acceptingDispatches !== false
    );
    expect(pendingHeartbeatIndex).toBeGreaterThanOrEqual(0);
    const heartbeatCountWhilePending = socket.heartbeatSendCount;

    releaseSecondConfigure.resolve();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    shutdownRequested.resolve("controlled_service_update");
    await flushMicrotasks(() =>
      lines.some(
        (line) => line.code === "daemon.run.controlled_shutdown_started"
      )
    );
    expect(socket.heartbeatSendCount).toBe(heartbeatCountWhilePending);
    holdHeartbeat = false;
    socket.emitServerFrame({
      v: 1,
      code: "daemon.session.heartbeat",
      payload: {
        ok: true,
        serverNowMs: Date.now(),
        staleLeases: [],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(syncPromise).resolves.toMatchObject({ status: "unchanged" });
    await sessionPromise;

    const heartbeatsAfterDrainStarted = socket.sentFrames
      .slice(pendingHeartbeatIndex + 1)
      .filter(isHeartbeatFrame);
    expect(heartbeatsAfterDrainStarted.length).toBeGreaterThan(0);
    expect(
      heartbeatsAfterDrainStarted.every(
        (frame) => frame.payload.acceptingDispatches === false
      )
    ).toBe(true);
    expect(heartbeatsAfterDrainStarted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            acceptingDispatches: false,
            stopCause: "controlled_service_update",
          }),
        }),
      ])
    );
  });

  it("allows an attached local control-plane invoker to force immediate route catalog sync", async () => {
    vi.useFakeTimers();
    let syncRouteCatalog: ((reason: string) => Promise<unknown>) | null = null;

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      diff: {
        addedProfileIds: ["agt-2"],
        keptProfileIds: ["agt-1"],
        removedProfileIds: [],
      },
      registerResponse: {
        acceptedLeases: [
          {
            leaseEpoch: 1,
            profileId: "agt-1",
          },
          {
            leaseEpoch: 2,
            profileId: "agt-2",
          },
        ],
        connectionGeneration: 1,
        ok: true,
        rejectedProfiles: [],
      },
      skippedProfiles: [],
      status: "changed",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      attachRouteCatalogSyncInvoker: (invoker) => {
        syncRouteCatalog = invoker;
      },
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-force-sync",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      reconnectAttempt: 0,
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(syncRouteCatalog).not.toBeNull();

    const attachedSyncRouteCatalog = syncRouteCatalog as
      | ((reason: string) => Promise<unknown>)
      | null;
    if (!attachedSyncRouteCatalog) {
      throw new Error("expected syncRouteCatalog to be attached");
    }

    const syncPromise = attachedSyncRouteCatalog("profile_created");
    await vi.advanceTimersByTimeAsync(0);
    await expect(syncPromise).resolves.toMatchObject({
      status: "changed",
    });
    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);
    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(2);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("performs immediate route catalog sync when the local service hub reports a catalog change", async () => {
    vi.useFakeTimers();

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      diff: {
        addedProfileIds: ["agt-2"],
        keptProfileIds: ["agt-1"],
        removedProfileIds: [],
      },
      registerResponse: {
        acceptedLeases: [
          {
            leaseEpoch: 1,
            profileId: "agt-1",
          },
          {
            leaseEpoch: 2,
            profileId: "agt-2",
          },
        ],
        connectionGeneration: 1,
        ok: true,
        rejectedProfiles: [],
      },
      skippedProfiles: [],
      status: "changed",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-hub-catalog-change",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      reconnectAttempt: 0,
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(syncDaemonRouteCatalogStateMock).not.toHaveBeenCalled();

    socket.emitServerFrame({
      v: 1,
      code: "daemon.route_catalog.changed",
      payload: {
        reason: "profile_binding_changed",
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);
    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(2);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("re-registers current v4 working-folder facts immediately after a local Project connection changes", async () => {
    vi.useFakeTimers();
    const connectedAtMs = 1_700_000_000_000;
    vi.setSystemTime(connectedAtMs);
    const onLocalProjectConnectionsChanged = vi.fn();
    handleLocalProjectControlFrameMock.mockResolvedValue({
      code: "daemon.local_project_control.set_default_connection_result",
      payload: {
        requestId: "project-default-1",
        result: { connections: [], status: "updated" },
      },
      v: 1,
    });
    loadDaemonRouteCatalogMock.mockResolvedValue({
      expectedRoutesContractVersion: "v4",
      profileIds: ["agt-1"],
      routeByProfileId: new Map([
        [
          "agt-1",
          {
            agentControllerRef: "builtin:codex",
            bindingId: "binding-1",
            configurationRevision: 7,
            contextIdMappingSpec: {
              mappingVersion: 1,
              sourceField: "OPENMELD_CLI_CONTEXT_ID",
            },
            openMeldServiceRuntimeId: "runtime-1",
            profileId: "agt-1",
            streamingMode: "final",
            transportMode: "local-cli",
            workingFolderRuntime: {
              configPath: null,
              configuredWorkspacePath: "/tmp/project-new-default",
              defaultProjectBindingGeneration: "generation-new",
              defaultProjectId: "project-new-default",
              effectiveRuntimeWorkingDirectory: "/tmp/project-new-default",
              runtimeContext: {
                providerRuntimeWorkingDirectory: "/tmp/project-new-default",
              },
              status: "ready",
              workingFolderFact: {
                defaultProjectId: "project-new-default",
                localProjectBindingGeneration: "generation-new",
                observedAtMs: 2000,
                reasonCode: null,
                source: "default_project",
                status: "ready",
              },
              workingFolderSource: "default_project",
              workspaceMode: null,
            },
          },
        ],
      ]),
      skippedProfiles: [],
      workingFolderExpectedProfileIds: ["agt-1"],
      workingFolderObservations: [
        {
          bindingId: "binding-1",
          configurationRevision: 7,
          defaultProjectId: "project-new-default",
          localProjectBindingGeneration: "generation-new",
          observedAtMs: 2000,
          profileId: "agt-1",
          reasonCode: null,
          source: "default_project",
          status: "ready",
        },
      ],
    });
    syncDaemonRouteCatalogStateMock.mockImplementation(
      async (input: {
        forceRegister?: boolean;
        loadCatalog: () => Promise<{
          profileIds: string[];
          skippedProfiles: [];
        }>;
        registerCatalog: (catalog: unknown) => Promise<{
          acceptedLeases: Array<{ leaseEpoch: number; profileId: string }>;
          connectionGeneration: number;
          ok: boolean;
          rejectedProfiles: [];
        }>;
      }) => {
        const catalog = await input.loadCatalog();
        const registerResponse = await input.registerCatalog(catalog);
        return {
          registerResponse,
          skippedProfiles: catalog.skippedProfiles,
          status: "registered",
        };
      }
    );
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, []),
      onLocalProjectConnectionsChanged,
    });
    await vi.advanceTimersByTimeAsync(1);
    socket.sentFrames.splice(0);

    socket.emitServerFrame({
      code: "daemon.local_project_control.set_default_connection",
      payload: {
        request: {
          clientGeneration: 1,
          expectedOrganizationId: "org-1",
          idempotencyKey: "project-default-mutation-1",
          projectId: "project-new-default",
          targetBindingGeneration: "generation-new",
        },
        requestId: "project-default-1",
      },
      v: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks(
      () =>
        socket.sentFrames.filter(
          (frame) =>
            typeof frame === "object" &&
            frame !== null &&
            "code" in frame &&
            frame.code === "daemon.session.register"
        ).length > 0
    );

    expect(onLocalProjectConnectionsChanged).toHaveBeenCalledOnce();
    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledWith(
      expect.objectContaining({ forceRegister: true })
    );
    expect(socket.sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.session.register",
        payload: expect.objectContaining({
          connectedAtMs,
          localWakeRouteReport: expect.objectContaining({
            expectedRoutesContractVersion: "v4",
            workingFolderObservations: [
              expect.objectContaining({
                defaultProjectId: "project-new-default",
                localProjectBindingGeneration: "generation-new",
                source: "default_project",
                status: "ready",
              }),
            ],
          }),
        }),
      })
    );

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("applies a changed permission mode to an active task during catalog sync", async () => {
    vi.useFakeTimers();

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      diff: {
        addedProfileIds: [],
        keptProfileIds: ["agt-1"],
        removedProfileIds: [],
      },
      registerResponse: {
        acceptedLeases: [
          {
            leaseEpoch: 2,
            profileId: "agt-1",
          },
        ],
        connectionGeneration: 1,
        ok: true,
        rejectedProfiles: [],
      },
      skippedProfiles: [],
      status: "changed",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const updatePermissionMode = vi.fn().mockResolvedValue({
      effectiveFrom: "subsequent_tool_requests",
      status: "applied",
      taskId: "task-1",
    });
    const adapter = {
      adapterId: "claude-code",
      dispatch: vi.fn(),
      interrupt: vi.fn(),
      updatePermissionMode,
    } as unknown as RuntimeAdapter;
    const inflightTaskControlRegistry = createInflightTaskControlRegistry();
    inflightTaskControlRegistry.registerTask({
      adapterId: "claude-code",
      agentControllerPermissionMode: "claude-code:default",
      dispatchId: "dispatch-1",
      targetProfileId: "agt-1",
      taskId: "task-1",
    } as Parameters<typeof inflightTaskControlRegistry.registerTask>[0]);
    const routeCatalogState = {
      fingerprint: "auto-mode",
      profileIds: ["agt-1"],
      routeByProfileId: new Map([
        [
          "agt-1",
          {
            agentControllerPermissionMode: "claude-code:auto" as const,
            agentControllerRef: "builtin:claude-code",
            contextIdMappingSpec: {
              mappingVersion: 1 as const,
              sourceField: "session_id" as const,
            },
            profileId: "agt-1",
            streamingMode: "final" as const,
            transportMode: "local-cli" as const,
          },
        ],
      ]),
      skippedProfiles: [],
    };
    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-live-permission-mode",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry,
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([
        {
          adapter,
          adapterId: "claude-code",
          transportModes: ["local-cli"],
        },
      ]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      reconnectAttempt: 0,
      routeCatalogState,
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    socket.emitServerFrame({
      v: 1,
      code: "daemon.route_catalog.changed",
      payload: {
        reason: "profile_binding_changed",
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(updatePermissionMode).toHaveBeenCalledWith({
      agentControllerPermissionMode: "claude-code:auto",
      taskId: "task-1",
    });
    expect(inflightTaskControlRegistry.getTask("task-1")).toMatchObject({
      agentControllerPermissionMode: "claude-code:auto",
    });

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it.each([
    "control",
    "result",
  ])("defers an idle switch when %s arrives after the idle observation", async (work) => {
    await withTempHome(async () => {
      const input = buildKeepaliveSessionInput(createMockSocket(), []);
      const ledgerPaths = createLedgerPaths();
      const host = await createInProcessExecutionHost({
        stateRoot: ledgerPaths.rootDirPath,
        daemonSessionId: input.daemonSessionId,
        deviceId: input.deviceId,
        ownerUserId: input.ownerUserId,
        profileOwnerName: input.profileOwnerName,
        presenter: input.presenter,
        resources: {
          ...input,
          ledgerPaths,
          initialCatalog: input.routeCatalogState,
        },
      });
      const report = Promise.withResolvers<{
        failedCount: number;
        reasonCodes: string[];
        reportCount: number;
        status: "submitted";
        submittedCount: number;
      }>();
      const registration = vi
        .spyOn(agentRegistry, "setAgentRegistrationEnabled")
        .mockResolvedValue({
          agentControllerRef: "builtin:codex",
          agentId: "codex",
          changed: true,
          displayName: "Codex",
          enabled: true,
          status: "updated",
        });
      let mutation: Promise<unknown> | undefined;
      try {
        expect(await host.port.call("health", {})).toMatchObject({
          localQuiescent: true,
          admission: "open",
        });
        if (work === "control") {
          syncLocalServiceRuntimeAgentControllerReportsMock.mockReturnValueOnce(
            report.promise
          );
          mutation = host.port.call("setEnabled", {
            agentId: "codex",
            enabled: true,
          });
          await flushMicrotasks(() => registration.mock.calls.length > 0);
        } else {
          enqueuePendingResult({
            currentSocketRef: { connectionGeneration: null, socket: null },
            ledgerPaths,
          });
        }
        expect(
          await host.port.call("beginDrain", { onlyIfIdle: true })
        ).toMatchObject({ admission: "open" });
        report.resolve({
          failedCount: 0,
          reasonCodes: [],
          reportCount: 1,
          status: "submitted",
          submittedCount: 1,
        });
        await mutation;
        if (work === "result") {
          acknowledgeDispatchResultOutboxRecord({
            attemptId: "attempt-drain-1",
            dispatchId: "dispatch-drain-1",
            ledgerPaths,
            ok: true,
            presenter: input.presenter,
          });
        }
        expect(
          await host.port.call("beginDrain", { onlyIfIdle: true })
        ).toMatchObject({
          admission: "draining",
          localQuiescent: true,
          unacknowledgedResultCount: 0,
        });
        await expect(
          host.port.call("setEnabled", { agentId: "codex", enabled: true })
        ).rejects.toMatchObject({ code: "host.draining" });
      } finally {
        report.resolve({
          failedCount: 0,
          reasonCodes: [],
          reportCount: 1,
          status: "submitted",
          submittedCount: 1,
        });
        await mutation;
        registration.mockRestore();
        await host.close();
      }
    });
  });

  it.each([
    "success",
    "failure",
  ])("collects new evidence after a control mutation when an earlier fresh report ends in %s", async (outcome) => {
    await withTempHome(async () => {
      const input = buildKeepaliveSessionInput(createMockSocket(), []);
      const ledgerPaths = createLedgerPaths();
      const host = await createInProcessExecutionHost({
        stateRoot: ledgerPaths.rootDirPath,
        daemonSessionId: input.daemonSessionId,
        deviceId: input.deviceId,
        ownerUserId: input.ownerUserId,
        profileOwnerName: input.profileOwnerName,
        presenter: input.presenter,
        resources: {
          ...input,
          ledgerPaths,
          initialCatalog: input.routeCatalogState,
        },
      });
      let finishEarlierReport!: () => void;
      const reportResult = {
        failedCount: 0,
        reasonCodes: [],
        reportCount: 1,
        status: "submitted" as const,
        submittedCount: 1,
      };
      syncLocalServiceRuntimeAgentControllerReportsMock.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishEarlierReport = () =>
              outcome === "failure"
                ? reject(new Error("Earlier inventory unavailable"))
                : resolve(reportResult);
          })
      );
      const registration = vi
        .spyOn(agentRegistry, "setAgentRegistrationEnabled")
        .mockResolvedValue({
          agentControllerRef: "builtin:codex",
          agentId: "codex",
          changed: true,
          displayName: "Codex",
          enabled: true,
          status: "updated",
        });
      try {
        const earlierReport = host.port
          .call("reportControllers", {
            probePolicy: "fresh",
          })
          .then(
            (value) => value,
            (error: unknown) => error
          );
        await flushMicrotasks(() => Boolean(finishEarlierReport));
        const mutation = host.port.call("setEnabled", {
          agentId: "codex",
          enabled: true,
        });
        await flushMicrotasks(() => registration.mock.calls.length > 0);
        finishEarlierReport();
        const earlierOutcome = await earlierReport;
        if (outcome === "failure") {
          expect(earlierOutcome).toEqual(
            new Error("Earlier inventory unavailable")
          );
        }
        expect(await mutation).toMatchObject({ accepted: true });
        expect(
          syncLocalServiceRuntimeAgentControllerReportsMock
        ).toHaveBeenCalledTimes(2);
        expect(
          syncLocalServiceRuntimeAgentControllerReportsMock
        ).toHaveBeenLastCalledWith(
          expect.objectContaining({ probePolicy: "fresh" })
        );
      } finally {
        registration.mockRestore();
        await host.close();
      }
    });
  });

  it("waits for a fresh controller report before completing a local agent catalog refresh", async () => {
    vi.useFakeTimers();

    let resolveBackgroundReport!: () => void;
    const backgroundReport = new Promise<{
      failedCount: 0;
      reasonCodes: never[];
      reportCount: 0;
      status: "skipped";
      submittedCount: 0;
    }>((resolve) => {
      resolveBackgroundReport = () => {
        resolve({
          failedCount: 0,
          reasonCodes: [],
          reportCount: 0,
          status: "skipped",
          submittedCount: 0,
        });
      };
    });
    syncLocalServiceRuntimeAgentControllerReportsMock
      .mockReturnValueOnce(backgroundReport)
      .mockResolvedValue({
        failedCount: 0,
        reasonCodes: [],
        reportCount: 1,
        status: "submitted",
        submittedCount: 1,
      });

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      diff: {
        addedProfileIds: ["agt-2"],
        keptProfileIds: ["agt-1"],
        removedProfileIds: [],
      },
      registerResponse: {
        acceptedLeases: [
          {
            leaseEpoch: 1,
            profileId: "agt-1",
          },
          {
            leaseEpoch: 2,
            profileId: "agt-2",
          },
        ],
        connectionGeneration: 1,
        ok: true,
        rejectedProfiles: [],
      },
      skippedProfiles: [],
      status: "changed",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession(
      buildKeepaliveSessionInput(socket, [])
    );
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(
      () =>
        syncLocalServiceRuntimeAgentControllerReportsMock.mock.calls.length > 0
    );

    socket.emitServerFrame({
      v: 1,
      code: "daemon.local_agent_control.refresh_catalog",
      payload: {
        requestId: "refresh-1",
        payload: {
          reason: "settings_manual_check",
        },
      },
    });
    await vi.advanceTimersByTimeAsync(1);

    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);
    expect(socket.sentFrames).not.toContainEqual(
      expect.objectContaining({
        code: "daemon.local_agent_control.result",
        payload: expect.objectContaining({ requestId: "refresh-1" }),
      })
    );

    resolveBackgroundReport();
    await flushMicrotasks(
      () =>
        syncLocalServiceRuntimeAgentControllerReportsMock.mock.calls.length > 1
    );
    await flushMicrotasks(() =>
      socket.sentFrames.some(
        (frame) =>
          typeof frame === "object" &&
          frame !== null &&
          "code" in frame &&
          frame.code === "daemon.local_agent_control.result" &&
          "payload" in frame &&
          typeof frame.payload === "object" &&
          frame.payload !== null &&
          "requestId" in frame.payload &&
          frame.payload.requestId === "refresh-1"
      )
    );

    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ probePolicy: "fresh" })
    );
    expect(socket.sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.local_agent_control.result",
        payload: {
          requestId: "refresh-1",
          payload: expect.objectContaining({
            accepted: true,
            profileIds: ["agt-1", "agt-2"],
            syncStatus: "changed",
          }),
        },
      })
    );

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("handles profile workspace control frames through the profile workspace service", async () => {
    vi.useFakeTimers();
    const targetProfileId = "agt_00000000-0000-4000-8000-000000000001";
    const workspacePath = "/Users/felix/Desktop/work/openmeld";
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession(
      buildKeepaliveSessionInput(socket, [])
    );
    await vi.advanceTimersByTimeAsync(1);

    socket.emitServerFrame({
      v: 1,
      code: "daemon.local_agent_control.set_profile_workspace",
      payload: {
        requestId: "workspace-1",
        payload: {
          targetProfileId,
          workspaceMode: "custom",
          workspacePath,
        },
      },
    });
    await vi.advanceTimersByTimeAsync(1);

    expect(setCustomProfileWorkspaceMock).toHaveBeenCalledWith({
      customWorkspacePath: workspacePath,
      openMeldProfileId: targetProfileId,
    });
    expect(socket.sentFrames).toContainEqual(
      expect.objectContaining({
        code: "daemon.local_agent_control.result",
        payload: {
          requestId: "workspace-1",
          payload: expect.objectContaining({
            accepted: true,
            status: "updated",
            targetProfileId,
            workspaceMode: "custom",
            workspacePath,
          }),
        },
      })
    );

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("registers a changed catalog without waiting for an in-flight heartbeat", async () => {
    vi.useFakeTimers();
    let syncRouteCatalog: ((reason: string) => Promise<unknown>) | null = null;

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      diff: {
        addedProfileIds: ["agt-2"],
        keptProfileIds: ["agt-1"],
        removedProfileIds: [],
      },
      registerResponse: {
        acceptedLeases: [
          {
            leaseEpoch: 1,
            profileId: "agt-1",
          },
          {
            leaseEpoch: 2,
            profileId: "agt-2",
          },
        ],
        connectionGeneration: 1,
        ok: true,
        rejectedProfiles: [],
      },
      skippedProfiles: [],
      status: "changed",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket({ respondToHeartbeat: false });
    const sessionPromise = runDaemonSocketSession({
      attachRouteCatalogSyncInvoker: (invoker) => {
        syncRouteCatalog = invoker;
      },
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-inflight-refresh",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: () => undefined,
        data: () => undefined,
      },
      reconnectAttempt: 0,
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      socket,
      touchRuntimeState: async () => undefined,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(syncRouteCatalog).not.toBeNull();

    const attachedSyncRouteCatalog = syncRouteCatalog as
      | ((reason: string) => Promise<unknown>)
      | null;
    if (!attachedSyncRouteCatalog) {
      throw new Error("expected syncRouteCatalog to be attached");
    }

    const syncPromise = attachedSyncRouteCatalog("profile_updated");
    await vi.advanceTimersByTimeAsync(0);
    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);
    await expect(syncPromise).resolves.toMatchObject({
      status: "changed",
    });

    socket.emitServerFrame({
      v: 1,
      code: "daemon.session.heartbeat",
      payload: {
        ok: true,
        serverNowMs: Date.now(),
        staleLeases: [],
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(syncPromise).resolves.toMatchObject({
      status: "changed",
    });
    expect(syncDaemonRouteCatalogStateMock).toHaveBeenCalledTimes(1);

    socket.emitServerFrame({
      v: 1,
      code: "daemon.session.heartbeat",
      payload: {
        ok: true,
        serverNowMs: Date.now(),
        staleLeases: [],
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      syncLocalServiceRuntimeAgentControllerReportsMock
    ).toHaveBeenCalledTimes(1);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("terminates a dead socket after repeated heartbeat timeouts", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket({
      hangOnClose: true,
      respondToHeartbeat: false,
    });
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-dead-heartbeat",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: (input) => {
          lines.push({
            code: input.code,
            text: input.text,
          });
        },
        data: () => undefined,
      },
      reconnectAttempt: 0,
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      socket,
      touchRuntimeState: async () => undefined,
    });
    const sessionClosed = expect(sessionPromise).rejects.toMatchObject({
      code: "daemon.run.socket_closed",
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(15_000);

    await sessionClosed;
    expect(socket.terminateCount).toBe(1);
    expect(
      lines.filter((line) => line.code === "daemon.run.heartbeat_failed")
    ).toHaveLength(3);
  });

  it("terminates when heartbeat runtime state persistence stalls", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];
    const flushMicrotasks = async (until?: () => boolean): Promise<void> => {
      for (let index = 0; index < 50; index += 1) {
        await Promise.resolve();
        if (until?.()) {
          return;
        }
      }
    };

    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue(null);

    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession({
      computerFileAccessStorePath: "/tmp/computer-file-access.json",
      contextStore: new Map<string, string>(),
      daemonSessionId: "session-stalled-runtime-state",
      dispatchLimits: {
        globalConcurrency: 1,
        queueMax: 4,
      },
      deviceId: "device-1",
      foregroundActive: false,
      heartbeatIntervalMs: 5000,
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      lane: "dev-local",
      ledgerPaths: {
        backupStateFilePath: "/tmp/ledger.backup",
        historyFilePath: "/tmp/ledger.history",
        historyTempFilePath: "/tmp/ledger.history.tmp",
        rootDirPath: "/tmp/ledger",
        stateFilePath: "/tmp/ledger.state",
        stateTempFilePath: "/tmp/ledger.state.tmp",
      },
      localAdapterContainer: createLocalAdapterContainer([]),
      ownerUserId: "owner-1",
      profileOwnerName: "felix",
      presenter: {
        view: "human",
        event: () => undefined,
        line: (input) => {
          lines.push({
            code: input.code,
            text: input.text,
          });
        },
        data: () => undefined,
      },
      reconnectAttempt: 0,
      routeCatalogState: {
        fingerprint: "initial",
        profileIds: ["agt-1"],
        routeByProfileId: new Map(),
        skippedProfiles: [],
      },
      socket,
      touchRuntimeState: async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 60_000);
        });
      },
    });
    await flushMicrotasks(() => socket.heartbeatSendCount > 0);
    await flushMicrotasks(() =>
      lines.some(
        (line) => line.code === "daemon.run.heartbeat_response_received"
      )
    );
    expect(socket.heartbeatSendCount).toBeGreaterThanOrEqual(1);
    const sessionClosed = expect(sessionPromise).rejects.toMatchObject({
      code: "daemon.run.socket_closed",
    });

    const heartbeatResponseCount = (): number =>
      lines.filter(
        (line) => line.code === "daemon.run.heartbeat_response_received"
      ).length;

    vi.advanceTimersByTime(15_000);
    await flushMicrotasks();
    vi.advanceTimersByTime(5000);
    await flushMicrotasks(() => heartbeatResponseCount() >= 2);
    vi.advanceTimersByTime(15_000);
    await flushMicrotasks();
    vi.advanceTimersByTime(5000);
    await flushMicrotasks(() => heartbeatResponseCount() >= 3);
    vi.advanceTimersByTime(15_000);
    await flushMicrotasks();

    await sessionClosed;
    expect(socket.terminateCount).toBe(1);
    expect(
      lines.filter((line) => line.code === "daemon.run.heartbeat_failed")
    ).toHaveLength(3);
    expect(
      lines.some((line) =>
        line.text.includes("heartbeat runtime state write timed out")
      )
    ).toBe(true);
  });
});

describe("daemon stream keepalive", () => {
  beforeEach(() => {
    resolveLocalComponentsStatusMock.mockResolvedValue(null);
    loadDaemonRouteCatalogMock.mockResolvedValue({
      profileIds: ["agt-1"],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    });
    syncDaemonRouteCatalogStateMock.mockResolvedValue({
      skippedProfiles: [],
      status: "unchanged",
    });
    readDaemonCatalogSyncSignalMock.mockResolvedValue({
      updatedAt: "2026-03-06T00:00:00.000Z",
      updatedAtMs: 1000,
      reason: "baseline",
    });
  });

  it.each([
    "heartbeat",
    "keepalive",
    "socket_error",
  ] as const)("releases a failed %s session even when termination sends no close event", async (failure) => {
    await withTempHome(async () => {
      vi.useFakeTimers();
      const lines: Array<{ code: string; text: string }> = [];
      const socket = createMockSocket({
        terminateEmitsClose: false,
        respondToHeartbeat: failure !== "heartbeat",
        respondToKeepalive: failure !== "keepalive",
      });
      const attachRouteCatalogSyncInvoker = vi.fn();
      const ledgerPaths = createLedgerPaths();
      enqueuePendingResult({
        currentSocketRef: { connectionGeneration: null, socket: null },
        ledgerPaths,
      });
      let exited = false;
      const sessionPromise = runDaemonSocketSession({
        ...buildKeepaliveSessionInput(socket, lines, 60_000),
        attachRouteCatalogSyncInvoker,
        ledgerPaths,
      });
      const outcome = sessionPromise.then(
        () => {
          exited = true;
          return null;
        },
        (error: unknown) => {
          exited = true;
          return error;
        }
      );
      await vi.advanceTimersByTimeAsync(1);
      if (failure === "socket_error") {
        socket.emitError(new Error("transport failed without a close event"));
      }
      const deadline =
        failure === "heartbeat"
          ? 3 * HEARTBEAT_RESPONSE_TIMEOUT_MS + 2 * 5000
          : DAEMON_STREAM_KEEPALIVE_INTERVAL_MS +
            DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS;
      await vi.advanceTimersByTimeAsync(deadline + 1);
      await flushMicrotasks();
      const exitedAtDeadline = exited;
      // Cleanup cannot turn a hung production session into a passing assertion.
      if (!exited) {
        socket.emitClose(1006, "test cleanup");
      }
      const result = await outcome;
      expect(socket.terminateCount).toBe(1);
      expect(exitedAtDeadline).toBe(true);
      expect(result).toBeInstanceOf(Error);
      expect(
        listDispatchResultOutboxPendingAcknowledgementKeys({ ledgerPaths })
      ).toEqual(["dispatch-drain-1::attempt-drain-1"]);
      // A late native close must not clear the next session's shared invoker.
      attachRouteCatalogSyncInvoker.mockClear();
      socket.emitClose(1006, "delayed native close");
      expect(attachRouteCatalogSyncInvoker).not.toHaveBeenCalled();
    });
  });

  it("sends a keepalive PING on its own 20s cadence, faster than and independent of the heartbeat", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket();
    // The heartbeat interval (60s) is deliberately LONGER than the keepalive
    // cadence (20s), so a PING that fires before the heartbeat's next tick
    // proves the keepalive runs on its own timer rather than riding heartbeats.
    const sessionPromise = runDaemonSocketSession(
      buildKeepaliveSessionInput(socket, lines, 60_000)
    );

    // Let register + the startup heartbeat run. No keepalive PING is due yet.
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.keepalivePingCount).toBe(0);
    const heartbeatsAfterStartup = socket.heartbeatSendCount;

    // Advance exactly one keepalive interval (20s) -- still far short of the 60s
    // heartbeat tick.
    await vi.advanceTimersByTimeAsync(DAEMON_STREAM_KEEPALIVE_INTERVAL_MS);
    // A PING fired on the keepalive's own timer...
    expect(socket.keepalivePingCount).toBeGreaterThanOrEqual(1);
    // ...while the heartbeat did NOT tick again in that window -- proving the
    // PING is not a heartbeat side-effect.
    expect(socket.heartbeatSendCount).toBe(heartbeatsAfterStartup);

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("keeps registration and heartbeat live when component inspection stalls", async () => {
    vi.useFakeTimers();
    resolveLocalComponentsStatusMock.mockImplementation(
      () => new Promise(() => undefined)
    );
    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession(
      buildKeepaliveSessionInput(socket, [], 5000)
    );
    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(() => socket.heartbeatSendCount > 0);
    expect(socket.heartbeatSendCount).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.heartbeatSendCount).toBeGreaterThan(1);
    expect(resolveLocalComponentsStatusMock).toHaveBeenCalledOnce();
    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("sends local component status in heartbeat capabilities", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];
    resolveLocalComponentsStatusMock.mockResolvedValue(
      createLocalComponentsStatus("0.7.94")
    );
    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession(
      buildKeepaliveSessionInput(socket, lines, 5000)
    );

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks(() => socket.heartbeatSendCount > 0);

    const heartbeatFrame = socket.sentFrames.find(
      (
        frame
      ): frame is {
        code: "daemon.session.heartbeat";
        payload: {
          capabilities?: {
            localComponents?: {
              cli?: {
                packageVersion?: string;
              };
            };
          };
        };
      } =>
        typeof frame === "object" &&
        frame !== null &&
        "code" in frame &&
        frame.code === "daemon.session.heartbeat"
    );

    expect(
      heartbeatFrame?.payload.capabilities?.localComponents?.cli?.packageVersion
    ).toBe("0.7.94");

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("ignores a keepalive PONG without logging an invalid daemon frame", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket();
    const sessionPromise = runDaemonSocketSession(
      buildKeepaliveSessionInput(socket, lines)
    );

    // Let register run so the session is live and listening on onMessage.
    await vi.advanceTimersByTimeAsync(1);

    socket.emitRaw(DAEMON_STREAM_KEEPALIVE_PONG);
    await vi.advanceTimersByTimeAsync(1);

    expect(lines.some((line) => line.code === "daemon.run.frame_invalid")).toBe(
      false
    );

    socket.close(1000, "shutdown");
    await sessionPromise;
  });

  it("returns a native folder choice only for the exact Computer request", async () => {
    vi.useFakeTimers();
    const lines: Array<{ code: string; text: string }> = [];
    const socket = createMockSocket();
    const selectLocalFolders = vi.fn().mockResolvedValue({
      deviceId: "device-1",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });
    const sessionPromise = runDaemonSocketSession({
      ...buildKeepaliveSessionInput(socket, lines),
      selectLocalFolders,
    });

    await vi.advanceTimersByTimeAsync(1);
    socket.emitServerFrame({
      code: "daemon.local_folder_picker.select_folders",
      payload: {
        request: {
          allowMultiple: true,
          expectedDeviceId: "device-1",
          purpose: "computer_file_access",
        },
        requestId: "picker-1",
      },
      v: 1,
    });
    await flushMicrotasks(() =>
      socket.sentFrames.some(
        (frame) =>
          (frame as { code?: string }).code ===
          "daemon.local_folder_picker.select_folders_result"
      )
    );

    expect(selectLocalFolders).toHaveBeenCalledOnce();
    expect(socket.sentFrames).toContainEqual({
      code: "daemon.local_folder_picker.select_folders_result",
      payload: {
        requestId: "picker-1",
        result: {
          deviceId: "device-1",
          paths: ["/Users/felix/Design Work"],
          status: "selected",
        },
      },
      v: 1,
    });

    socket.close(1000, "shutdown");
    await sessionPromise;
  });
});

function buildKeepaliveSessionInput(
  socket: ReturnType<typeof createMockSocket>,
  lines: Array<{ code: string; data?: unknown; text: string }>,
  heartbeatIntervalMs = 60_000
): Parameters<typeof runDaemonSocketSession>[0] {
  return {
    computerFileAccessStorePath: "/tmp/computer-file-access.json",
    contextStore: new Map<string, string>(),
    daemonSessionId: "session-keepalive",
    dispatchLimits: {
      globalConcurrency: 1,
      queueMax: 4,
    },
    deviceId: "device-1",
    foregroundActive: false,
    heartbeatIntervalMs,
    inflightDispatchMetaByTaskId: new Map(),
    inflightTaskControlRegistry: createInflightTaskControlRegistry(),
    pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
    lane: "dev-local",
    ledgerPaths: {
      backupStateFilePath: "/tmp/ledger.backup",
      historyFilePath: "/tmp/ledger.history",
      historyTempFilePath: "/tmp/ledger.history.tmp",
      rootDirPath: "/tmp/ledger",
      stateFilePath: "/tmp/ledger.state",
      stateTempFilePath: "/tmp/ledger.state.tmp",
    },
    localAdapterContainer: createLocalAdapterContainer([]),
    ownerUserId: "owner-1",
    profileOwnerName: "felix",
    presenter: {
      view: "human",
      event: () => undefined,
      line: (input) => {
        lines.push({
          code: input.code,
          data: input.data,
          text: input.text,
        });
      },
      data: () => undefined,
    },
    routeCatalogState: {
      fingerprint: "initial",
      profileIds: ["agt-1"],
      routeByProfileId: new Map(),
      skippedProfiles: [],
    },
    reconnectAttempt: 0,
    socket,
    touchRuntimeState: async () => undefined,
  };
}

function createLedgerPaths(): LedgerPaths {
  const rootDirPath = mkdtempSync(join(tmpdir(), "openmeld-controlled-drain-"));
  tempDirs.push(rootDirPath);
  return {
    backupStateFilePath: join(rootDirPath, "backup.json"),
    historyFilePath: join(rootDirPath, "history.json"),
    historyTempFilePath: join(rootDirPath, "history.tmp.json"),
    rootDirPath,
    stateFilePath: join(rootDirPath, "state.json"),
    stateTempFilePath: join(rootDirPath, "state.tmp.json"),
  };
}

function enqueuePendingResult(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  ledgerPaths: LedgerPaths;
}): void {
  enqueueDispatchResultOutboxRecord({
    attemptId: "attempt-drain-1",
    connectionGeneration: 1,
    currentSocketRef: input.currentSocketRef,
    daemonSessionId: "session-keepalive",
    dispatchId: "dispatch-drain-1",
    executionIdentityEcho: {
      echoSource: "daemon_delivery_context",
      core: {
        agentControllerRef: "builtin:codex",
        bindingId: "binding-drain-1",
        dispatchId: "dispatch-drain-1",
        modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
        spaceId: "space-drain-1",
        targetProfileId: "agt-drain-1",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-drain-1",
        },
      },
    },
    ledgerPaths: input.ledgerPaths,
    leaseEpoch: 1,
    payload: {
      agentId: "agt-drain-1",
      attemptId: "attempt-drain-1",
      deduped: false,
      output: "Completed before the controlled update.",
      sourceEventId: "signal-drain-1",
      status: "success",
      taskId: "task-drain-1",
    },
    presenter: {
      data: () => undefined,
      event: () => undefined,
      line: () => undefined,
      view: "agent",
    },
    taskId: "task-drain-1",
  });
}

function isHeartbeatFrame(frame: unknown): frame is {
  code: "daemon.session.heartbeat";
  payload: {
    acceptingDispatches?: boolean;
    admissionEvidence?: { reasonCode: string };
    stopCause?: string;
  };
} {
  return (
    typeof frame === "object" &&
    frame !== null &&
    "code" in frame &&
    frame.code === "daemon.session.heartbeat"
  );
}

function createLocalComponentsStatus(packageVersion: string) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-04T00:00:00.000Z",
    entrypoint: "setup",
    summaryLabel: "Everything is up to date",
    summaryDescription:
      "OpenMeld local components are aligned for this computer.",
    setupAction: "none",
    setupActionLabel: "Everything is up to date",
    setupActionDescription:
      "OpenMeld local components are aligned for this computer.",
    cli: {
      commandContractVersion: "cli-contract-v1",
      latestPackageVersion: packageVersion,
      packageVersion,
      reasonCodes: [],
      requiredCommandContractVersion: null,
      status: "ok",
    },
    service: {
      expectedBundleHash: "a".repeat(64),
      expectedBundleVersion: packageVersion,
      installedBundleHash: "a".repeat(64),
      installedBundleVersion: packageVersion,
      reasonCodes: [],
      runtimeContractEpoch: "daemon-epoch-v1",
      serviceContractVersion: "daemon-epoch-v1",
      status: "ok",
    },
    skills: {
      expectedBundleHash: "b".repeat(64),
      installedBundleHash: "b".repeat(64),
      reasonCodes: [],
      skillContractVersion: "skills-contract-v1",
      status: "ok",
      targetCount: 1,
    },
  };
}

async function flushMicrotasks(until?: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (until?.()) {
      return;
    }
    await Promise.resolve();
  }
}

function createMockSocket(input?: {
  rejectStoppingHeartbeat?: boolean;
  closeEventReason?: string;
  executionAdmissionConfirmation?: boolean;
  admissionEvidence?: boolean;
  hangOnClose?: boolean;
  terminateEmitsClose?: boolean;
  respondToKeepalive?: boolean;
  respondToHeartbeat?:
    | boolean
    | ((frame: {
        code: string;
        payload: { acceptingDispatches?: boolean };
      }) => boolean);
  respondToRegister?: boolean;
}) {
  let onMessage: ((data: string) => void) | null = null;
  let onClose: ((code: number, reason: string) => void) | null = null;
  let onError: ((error: unknown) => void) | null = null;
  let terminateCount = 0;
  let closeCount = 0;
  let keepalivePingCount = 0;
  let heartbeatSendCount = 0;
  const sentFrames: unknown[] = [];
  const eventOrder: string[] = [];
  const hangOnClose = input?.hangOnClose ?? false;
  const respondToKeepalive = input?.respondToKeepalive ?? true;
  const respondToHeartbeat = input?.respondToHeartbeat ?? true;
  const respondToRegister = input?.respondToRegister ?? true;

  return {
    emitError: (error: unknown) => {
      onError?.(error);
    },
    emitClose: (code: number, reason: string) => {
      onClose?.(code, reason);
    },
    emitServerFrame: (frame: unknown) => {
      onMessage?.(JSON.stringify(frame));
    },
    emitRaw: (raw: string) => {
      onMessage?.(raw);
    },
    get keepalivePingCount() {
      return keepalivePingCount;
    },
    get heartbeatSendCount() {
      return heartbeatSendCount;
    },
    get closeCount() {
      return closeCount;
    },
    get eventOrder() {
      return eventOrder;
    },
    get sentFrames() {
      return sentFrames;
    },
    send: (data: string) => {
      if (data === DAEMON_STREAM_KEEPALIVE_PING) {
        keepalivePingCount += 1;
        if (respondToKeepalive) {
          queueMicrotask(() => {
            onMessage?.(DAEMON_STREAM_KEEPALIVE_PONG);
          });
        }
        return;
      }
      const frame = JSON.parse(data) as {
        code: string;
        payload: {
          acceptingDispatches?: boolean;
          profileIds?: string[];
          leases?: Array<{ profileId: string; leaseEpoch: number }>;
        };
      };
      sentFrames.push(frame);
      eventOrder.push(frame.code);
      if (frame.code === "daemon.session.register") {
        if (!respondToRegister) {
          return;
        }
        const acceptedLeases = (frame.payload.profileIds ?? []).map(
          (profileId, index) => ({
            profileId,
            leaseEpoch: index + 1,
          })
        );
        queueMicrotask(() => {
          onMessage?.(
            JSON.stringify({
              v: 1,
              code: "daemon.session.register",
              payload: {
                ok: true,
                connectionGeneration: 1,
                ...(input?.executionAdmissionConfirmation !== false
                  ? { executionAdmissionConfirmation: true }
                  : {}),
                ...(input?.admissionEvidence
                  ? { admissionEvidence: true }
                  : {}),
                acceptedLeases,
                rejectedProfiles: [],
              },
            })
          );
        });
        return;
      }
      if (frame.code === "daemon.session.heartbeat") {
        heartbeatSendCount += 1;
        const shouldRespond =
          typeof respondToHeartbeat === "function"
            ? respondToHeartbeat(frame)
            : respondToHeartbeat;
        if (!shouldRespond) {
          return;
        }
        queueMicrotask(() => {
          onMessage?.(
            JSON.stringify({
              v: 1,
              code: "daemon.session.heartbeat",
              payload: {
                ok: !(
                  input?.rejectStoppingHeartbeat &&
                  frame.payload.acceptingDispatches === false
                ),
                serverNowMs: Date.now(),
                staleLeases: [],
              },
            })
          );
        });
      }
    },
    close: (code?: number, reason?: string) => {
      closeCount += 1;
      eventOrder.push("close");
      if (hangOnClose) {
        return;
      }
      onClose?.(code ?? 1000, input?.closeEventReason ?? reason ?? "closed");
    },
    terminate: () => {
      terminateCount += 1;
      if (input?.terminateEmitsClose !== false) {
        onClose?.(1011, "terminated");
      }
    },
    get terminateCount() {
      return terminateCount;
    },
    onMessage: (handler: (data: string) => void) => {
      onMessage = handler;
    },
    onClose: (handler: (code: number, reason: string) => void) => {
      onClose = handler;
    },
    onError: (handler: (error: unknown) => void) => {
      onError = handler;
    },
    waitUntilClosed: async () => undefined,
  };
}
