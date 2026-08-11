import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeTransportMutableState } from "../runtime-transport/application/runtime-transport-state";
import { RuntimeTransportHub } from "../runtime-transport/transport/do/runtime-transport-hub";

type RuntimeTransportHubDisconnectDiagnosticsHarness = {
  cleanupExpiredPendingDispatches: (nowMs: number) => void;
  failPendingDispatchResultWaitersForConnectionGeneration: (
    daemonSessionId: string,
    connectionGeneration: number,
    response: unknown
  ) => void;
  handleDisconnectRatesDiagnosticRequest: () => Promise<Response>;
  persistRuntimeRecords: () => void;
  publishAgentReadinessInvalidated: (input: {
    profileIds: readonly string[];
    reason: string;
  }) => void;
  publishReapedReadinessProfiles: (result: {
    expiredProfileIds: readonly string[];
    removedSessionProfileIds: readonly string[];
  }) => void;
  queueHousekeepingAlarmSync: () => void;
  reconcileExpectedRoutesForSession: (input: unknown) => Promise<void>;
  recordSocketDisconnectRate: (input: {
    deployAdjacentReason: string | null;
    disconnectClass:
      | "abnormal_socket_close"
      | "normal_shutdown"
      | "possible_deploy_or_edge_restart";
    observedAtMs: number;
  }) => void;
  sendFrame: (
    webSocket: WebSocket,
    input: { code: string; payload: Record<string, unknown> }
  ) => void;
  triggerRuntimeCoordinatorHeadWaitingRecovery: (
    input: unknown
  ) => Promise<void>;
  ctx: {
    waitUntil: (promise: Promise<unknown>) => void;
    storage: {
      delete: (key: string) => Promise<boolean>;
      list: <T>(options: { prefix: string }) => Promise<Map<string, T>>;
      put: (key: string, value: unknown) => Promise<void>;
      transaction: <T>(
        operation: (transaction: {
          get: <Value>(key: string) => Promise<Value | undefined>;
          put: (entries: Record<string, unknown>) => Promise<void>;
        }) => Promise<T>
      ) => Promise<T>;
    };
  };
  state: ReturnType<typeof createRuntimeTransportMutableState>;
  webSocketClose: (
    webSocket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ) => void;
  webSocketMessage: (
    webSocket: WebSocket,
    rawMessage: string | ArrayBuffer
  ) => void;
};

const createDisconnectDiagnosticsHarness = (): {
  hub: RuntimeTransportHubDisconnectDiagnosticsHarness;
  pendingWork: Promise<unknown>[];
  persistedRecords: Map<string, unknown>;
} => {
  const hub = Object.create(
    RuntimeTransportHub.prototype
  ) as RuntimeTransportHubDisconnectDiagnosticsHarness;
  Object.defineProperty(hub, "state", {
    value: createRuntimeTransportMutableState(),
  });
  const pendingWork: Promise<unknown>[] = [];
  const persistedRecords = new Map<string, unknown>();
  Object.defineProperty(hub, "ctx", {
    value: {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        pendingWork.push(promise);
      }),
      storage: {
        delete: vi.fn((key: string) =>
          Promise.resolve(persistedRecords.delete(key))
        ),
        list: vi.fn(<T>(options: { prefix: string }) => {
          const result = new Map<string, T>();
          for (const [key, value] of persistedRecords) {
            if (key.startsWith(options.prefix)) {
              result.set(key, value as T);
            }
          }
          return Promise.resolve(result);
        }),
        put: vi.fn((key: string, value: unknown) => {
          persistedRecords.set(key, value);
          return Promise.resolve();
        }),
        transaction: vi.fn(
          async <T>(
            operation: (transaction: {
              get: <Value>(key: string) => Promise<Value | undefined>;
              put: (entries: Record<string, unknown>) => Promise<void>;
            }) => Promise<T>
          ): Promise<T> =>
            await operation({
              get: <Value>(key: string) =>
                Promise.resolve(persistedRecords.get(key) as Value | undefined),
              put: (entries: Record<string, unknown>) => {
                for (const [key, value] of Object.entries(entries)) {
                  persistedRecords.set(key, value);
                }
                return Promise.resolve();
              },
            })
        ),
      },
    },
  });
  hub.cleanupExpiredPendingDispatches = vi.fn();
  hub.failPendingDispatchResultWaitersForConnectionGeneration = vi.fn();
  hub.persistRuntimeRecords = vi.fn();
  hub.publishAgentReadinessInvalidated = vi.fn();
  hub.publishReapedReadinessProfiles = vi.fn();
  hub.queueHousekeepingAlarmSync = vi.fn();
  hub.reconcileExpectedRoutesForSession = vi.fn(() => Promise.resolve());
  hub.sendFrame = vi.fn((webSocket, input) => {
    webSocket.send(JSON.stringify(input));
  });
  hub.triggerRuntimeCoordinatorHeadWaitingRecovery = vi.fn(() =>
    Promise.resolve()
  );
  return { hub, pendingWork, persistedRecords };
};

describe("RuntimeTransportHub disconnect diagnostics", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aggregates disconnect classes by hour and deploy-adjacent reason", async () => {
    const nowMs = Date.UTC(2026, 6, 2, 12, 30, 0);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const { hub, pendingWork } = createDisconnectDiagnosticsHarness();
    hub.state.ownerUserId = "owner-1";

    hub.recordSocketDisconnectRate({
      deployAdjacentReason: "websocket_1006_abnormal_close",
      disconnectClass: "possible_deploy_or_edge_restart",
      observedAtMs: nowMs,
    });
    hub.recordSocketDisconnectRate({
      deployAdjacentReason: "websocket_1006_abnormal_close",
      disconnectClass: "possible_deploy_or_edge_restart",
      observedAtMs: nowMs + 10_000,
    });
    hub.recordSocketDisconnectRate({
      deployAdjacentReason: null,
      disconnectClass: "normal_shutdown",
      observedAtMs: nowMs + 20_000,
    });

    await Promise.all(pendingWork.splice(0));
    const response = (await (
      await hub.handleDisconnectRatesDiagnosticRequest()
    ).json()) as {
      buckets: unknown[];
      ok: boolean;
      ownerUserId: string | null;
    };

    expect(response).toMatchObject({
      ok: true,
      ownerUserId: "owner-1",
    });
    expect(response.buckets).toEqual([
      expect.objectContaining({
        count: 1,
        deployAdjacentReason: null,
        disconnectClass: "normal_shutdown",
        hourStartMs: Date.UTC(2026, 6, 2, 12, 0, 0),
      }),
      expect.objectContaining({
        count: 2,
        deployAdjacentReason: "websocket_1006_abnormal_close",
        disconnectClass: "possible_deploy_or_edge_restart",
        hourStartMs: Date.UTC(2026, 6, 2, 12, 0, 0),
      }),
    ]);
  });

  it("persists bounded remote evidence when a registered session disconnects", async () => {
    const nowMs = Date.UTC(2026, 6, 2, 12, 30, 0);
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const { hub, pendingWork, persistedRecords } =
      createDisconnectDiagnosticsHarness();
    const socket = {
      close: vi.fn(),
      deserializeAttachment: vi.fn(() => ({
        verifiedOwnerUserId: "owner-1",
      })),
      send: vi.fn(),
      serializeAttachment: vi.fn(),
    } as unknown as WebSocket;
    hub.state.ownerUserId = "owner-1";
    hub.state.sessionIdBySocket.set(socket, "session-1");
    hub.state.sessionsById.set("session-1", {
      capabilities: {},
      connectedAtMs: nowMs - 120_000,
      connectionGeneration: 3,
      daemonSessionId: "session-1",
      deliveryDisconnectedAtMs: null,
      deviceId: "device-1",
      executionCompatibility: {
        expectedEpoch: "runtime-transport-epoch-2026-07-default-project",
        observedEpoch: "runtime-transport-epoch-2026-07-default-project",
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
      lane: "prod",
      lastHeartbeatMs: nowMs - 5000,
      localWakeRouteReport: null,
      ownerUserId: "owner-1",
      profileIds: new Set(["agent-1"]),
      rejectedProfileRegistrationsByProfileId: new Map(),
      serviceVersion: "0.7.94",
      socket,
    });

    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const session = hub.state.sessionsById.get("session-1");
    if (!session) {
      throw new Error("expected registered session");
    }
    for (let index = 0; index < 25; index += 1) {
      const disconnectedAtMs = nowMs + index * 1000;
      vi.setSystemTime(disconnectedAtMs);
      session.connectedAtMs = disconnectedAtMs - 120_000;
      session.connectionGeneration = index + 1;
      session.lastHeartbeatMs = disconnectedAtMs - 5000;
      session.socket = socket;
      hub.state.sessionIdBySocket.set(socket, "session-1");
      hub.webSocketClose(socket, 1006, "", false);
      await Promise.all(pendingWork.splice(0));
    }

    const response = (await (
      await hub.handleDisconnectRatesDiagnosticRequest()
    ).json()) as { recentSessions: unknown[] };

    expect(response.recentSessions).toHaveLength(20);
    expect(response.recentSessions[0]).toEqual({
      closeCode: 1006,
      closeReasonCode: "abnormal_closure",
      connectedAtMs: nowMs + 24_000 - 120_000,
      connectionGeneration: 25,
      daemonSessionId: "session-1",
      deployAdjacentReason: "websocket_1006_abnormal_close",
      deviceId: "device-1",
      disconnectedAtMs: nowMs + 24_000,
      disconnectClass: "possible_deploy_or_edge_restart",
      durationMs: 120_000,
      heartbeatAgeMs: 5000,
      lane: "prod",
      lastHeartbeatMs: nowMs + 24_000 - 5000,
      profileCount: 1,
      profileIds: ["agent-1"],
      serviceVersion: "0.7.94",
      wasClean: false,
    });
    expect(
      [...persistedRecords.keys()].filter((key) =>
        key.startsWith("socket_disconnect_session.v1.")
      )
    ).toHaveLength(21);

    const diagnosticsBeforeHeartbeat = [...persistedRecords.entries()].filter(
      ([key]) => key.startsWith("socket_disconnect_session.v1.")
    );
    hub.webSocketMessage(
      socket,
      JSON.stringify({
        code: "daemon.session.heartbeat",
        payload: {
          v: 1,
          capabilities: {},
          daemonSessionId: "session-1",
          deviceId: "device-1",
          lane: "prod",
          leases: [],
          ownerUserId: "owner-1",
          runtimeContract: {
            epoch: "runtime-transport-epoch-2026-07-default-project",
          },
          sentAtMs: nowMs + 24_000,
          serviceVersion: "0.7.94",
        },
        v: 1,
      })
    );
    await Promise.all(pendingWork.splice(0));
    expect(socket.send).toHaveBeenCalledWith(
      expect.stringContaining('"code":"daemon.session.heartbeat"')
    );
    expect(
      [...persistedRecords.entries()].filter(([key]) =>
        key.startsWith("socket_disconnect_session.v1.")
      )
    ).toEqual(diagnosticsBeforeHeartbeat);

    vi.setSystemTime(nowMs + 24_000 + 86_400_001);
    const expiredResponse = (await (
      await hub.handleDisconnectRatesDiagnosticRequest()
    ).json()) as { recentSessions: unknown[] };
    expect(expiredResponse.recentSessions).toEqual([]);
  });
});
