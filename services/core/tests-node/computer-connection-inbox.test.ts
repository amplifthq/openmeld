import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { createInboxService } from "../src/inbox/application/inbox-service";
import { createComputerConnectionIncidents } from "../src/runtime-transport/application/computer-connection-incidents";
import { resolveDaemonExecutionCompatibility } from "../src/runtime-transport/application/daemon-execution-compatibility";
import { LEASE_TTL_MS } from "../src/runtime-transport/application/runtime-transport-session-service";
import type { RuntimeTransportSessionState } from "../src/runtime-transport/application/runtime-transport-state";
import { createInboxFeedFixture } from "./helpers/inbox-feed.test-support";
import { createFaultInjectingD1Database } from "./helpers/sqlite-d1-harness.test-support";

describe("Runtime Transport Computer incidents", () => {
  it("waits out transient loss, persists one incident across restarts and updates it on actual recovery without consuming read state", async () => {
    const f = fixture();
    try {
      await f.source.observe([f.session()]);
      const expiry = await f.source.nextAlarmAtMs();
      expect(expiry).toBe(f.now() + LEASE_TTL_MS + 1);
      f.advance(1000);
      await f.source.observe([
        f.session({
          socket: null,
          acceptingDispatches: false,
          stopCause: "network_disconnect",
          lastHeartbeatMs: 1000,
        }),
      ]);
      expect(f.items()).toEqual([]);
      await f.source.observe([f.session()]);
      f.advance(LEASE_TTL_MS + 1);
      await f.source.observe([]); // Cloud alarm works without the disconnected device.
      const original = f.items()[0];
      if (!original) {
        throw new Error("Expected a source-produced Computer incident");
      }
      expect(original).toMatchObject({
        organization_id: null,
        importance: "urgent",
        resolution_status: "open",
      });
      const restart = f.restart();
      await restart.observe([]);
      expect(f.items()).toHaveLength(1);
      const inbox = createInboxService({
        db: f.db,
        includeAccountItems: true,
        nowMs: f.now,
      });
      await inbox.markRead({
        ...f.identity,
        itemId: String(original.id),
        read: true,
      });
      const readAt = f.items()[0]?.read_at_ms;
      await restart.observe([f.session()]);
      expect(f.items()).toHaveLength(1);
      expect(f.items()[0]).toMatchObject({
        id: original.id,
        read_at_ms: readAt,
        resolution_status: "resolved",
      });
      expect(JSON.parse(String(f.items()[0]?.source_target_json)).state).toBe(
        "restored"
      );
      expect(
        f.queryAll({ sql: "SELECT * FROM inbox_email_deliveries" })
      ).toEqual([]);
      f.advance(LEASE_TTL_MS + 1);
      await restart.observe([]);
      expect(f.items()).toHaveLength(2);
    } finally {
      f.close();
    }
  });

  it.each([
    "user_stop",
    "controlled_service_update",
    "unknown",
  ] as const)("does not turn %s into an unexpected disconnect", async (stopCause) => {
    const f = fixture();
    try {
      await f.source.observe([f.session()]);
      await f.source.observe([
        f.session({ acceptingDispatches: false, stopCause }),
      ]);
      f.advance(LEASE_TTL_MS + 1);
      await f.restart().observe([]);
      expect(f.items()).toEqual([]);
    } finally {
      f.close();
    }
  });

  it("requires prior confirmed availability and ignores a stale replaced session", async () => {
    const f = fixture();
    try {
      await f.source.observe([f.session({ acceptingDispatches: false })]);
      f.advance(LEASE_TTL_MS + 1);
      await f.source.observe([]);
      expect(f.items()).toEqual([]);
      await f.source.observe([
        f.session({
          daemonSessionId: "old",
          lastHeartbeatMs: 0,
          socket: null,
          stopCause: "network_disconnect",
          acceptingDispatches: false,
        }),
        f.session({ daemonSessionId: "replacement", connectionGeneration: 2 }),
      ]);
      expect(f.items()).toEqual([]);
      expect(await f.source.nextAlarmAtMs()).toBe(f.now() + LEASE_TTL_MS + 1);
    } finally {
      f.close();
    }
  });

  it("retains a failed projection and projects its latest terminal state after restart, never a reopened or duplicate incident", async () => {
    const f = fixture();
    try {
      const db = createFaultInjectingD1Database({
        db: f.db,
        matches: (sql, operation) =>
          operation === "run" && sql.includes("INSERT INTO inbox_items"),
      });
      const source = createComputerConnectionIncidents({
        db,
        storage: f.storage,
        nowMs: f.now,
      });
      await source.observe([f.session()]);
      f.advance(LEASE_TTL_MS + 1);
      await source.observe([]);
      expect(f.items()).toEqual([]);
      await f.restart().observe([f.session()]);
      expect(f.items()).toHaveLength(1);
      expect(f.items()[0]?.resolution_status).toBe("resolved");
      await f.restart().observe([f.session()]);
      expect(f.items()).toHaveLength(1);
    } finally {
      f.close();
    }
  });

  it("does not publish an old connection incident after the Computer is forgotten or re-enrolled", async () => {
    const f = fixture();
    try {
      await f.source.observe([f.session()]);
      f.run({
        sql: "UPDATE openMeldDaemon_owned_devices SET connected_computer_id = 'new-computer' WHERE device_id = 'device'",
      });
      f.advance(LEASE_TTL_MS + 1);
      await f.source.observe([]);
      expect(f.items()).toEqual([]);
    } finally {
      f.close();
    }
  });
});

function fixture() {
  const f = createInboxFeedFixture();
  f.run({
    sql: "INSERT INTO openMeldDaemon_owned_devices (owner_user_id, device_id, connected_computer_id, user_display_name, first_seen_at_ms, updated_at_ms) VALUES ('owner', 'device', 'computer', 'Build Mac', 0, 0)",
  });
  f.run({
    sql: "INSERT INTO openMeldDaemon_connected_computers VALUES ('owner', 'computer', 0, 0)",
  });
  let nowMs = 1000;
  const now = () => nowMs;
  const storage = memoryStorage();
  const restart = () =>
    createComputerConnectionIncidents({ db: f.db, storage, nowMs: now });
  return {
    ...f,
    now,
    storage,
    restart,
    source: restart(),
    advance: (ms: number) => {
      nowMs += ms;
    },
    items: () =>
      f.queryAll({
        sql: "SELECT * FROM inbox_items WHERE kind = 'computer_connection' ORDER BY occurred_at_ms",
      }),
    session: (
      patch: Partial<RuntimeTransportSessionState> = {}
    ): RuntimeTransportSessionState => ({
      ownerUserId: "owner",
      deviceId: "device",
      daemonSessionId: "session",
      lane: "dev-local",
      lastHeartbeatMs: nowMs,
      connectedAtMs: 1000,
      connectionGeneration: 1,
      deliveryDisconnectedAtMs: null,
      acceptingDispatches: true,
      capabilities: {},
      executionCompatibility: resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }),
      profileIds: new Set(),
      localWakeRouteReport: null,
      rejectedProfileRegistrationsByProfileId: new Map(),
      socket: {} as WebSocket,
      ...patch,
    }),
  };
}

/** Replace only the external DO persistence boundary; SQL and producer policy run unchanged. */
function memoryStorage(): DurableObjectStorage {
  let values = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete: async (key: string) => values.delete(key),
    list: async (options: { prefix: string; limit?: number }) =>
      new Map(
        [...values]
          .filter(([key]) => key.startsWith(options.prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, options.limit)
          .map(([key, value]) => [key, structuredClone(value)])
      ),
    transaction: async (run: (transaction: unknown) => Promise<void>) => {
      const before = structuredClone(values);
      try {
        await run(storage);
      } catch (error) {
        values = before;
        throw error;
      }
    },
  };
  return storage as unknown as DurableObjectStorage;
}
