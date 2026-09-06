import { env } from "cloudflare:test";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  RuntimeTransportLookupOwnerServiceResponse,
  RuntimeTransportOpenMeldToolsControlResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcRequestPeopleComputerOpenMeldToolsUpdate } from "../src/rpc/methods";

describe("PeopleComputer explicit control RPC", () => {
  it("routes a Service-only computer with no Binding or local agents to its exact owner/device/lane", async () => {
    const f = await fixture();
    const result = await rpcRequestPeopleComputerOpenMeldToolsUpdate(
      f.coreEnv,
      {
        ...f.target,
        context: f.context,
      }
    );
    expect(result).toEqual({ status: "current", currentVersion: "0.3.164" });
    expect(f.commands).toEqual([
      expect.objectContaining({
        ownerUserId: f.userId,
        deviceId: f.target.deviceId,
        lane: "canary",
        request: { operation: "request_update", requestSource: "web" },
      }),
    ]);
  });

  it("rejects a foreign device and another environment without issuing any command", async () => {
    const f = await fixture();
    await expect(
      rpcRequestPeopleComputerOpenMeldToolsUpdate(f.coreEnv, {
        ...f.target,
        deviceId: "foreign-device",
        context: f.context,
      })
    ).rejects.toThrow("not available on your account");
    await expect(
      rpcRequestPeopleComputerOpenMeldToolsUpdate(f.coreEnv, {
        ...f.target,
        runtimeLane: "prod",
        context: f.context,
      })
    ).rejects.toThrow("disconnected in this environment");
    expect(f.commands).toEqual([]);
  });

  it("does not use an older session's update capability after replacement", async () => {
    const f = await fixture();
    if (!f.ownerService.online) {
      throw new Error("Expected live fixture");
    }
    const previous = f.ownerService.sessions[0];
    if (!previous) {
      throw new Error("Expected current session");
    }
    f.ownerService.sessions.unshift({
      ...previous,
      daemonSessionId: "replacement-session",
      connectionGeneration: 2,
      lastHeartbeatMs: Date.now() + 1,
      capabilities: {},
    });
    await expect(
      rpcRequestPeopleComputerOpenMeldToolsUpdate(f.coreEnv, {
        ...f.target,
        context: f.context,
      })
    ).rejects.toThrow("Reconnect Computer");
    expect(f.commands).toEqual([]);
  });

  it("does not interpret a failed connection lookup as permission to use another target", async () => {
    const f = await fixture();
    f.fetch.mockRejectedValueOnce(new Error("Transport unavailable"));
    await expect(
      rpcRequestPeopleComputerOpenMeldToolsUpdate(f.coreEnv, {
        ...f.target,
        context: f.context,
      })
    ).rejects.toThrow();
    expect(f.commands).toEqual([]);
  });
});

async function fixture() {
  const userId = `people-control-${crypto.randomUUID()}`;
  const deviceId = `device-${crypto.randomUUID()}`;
  const now = Date.now();
  await env.OPENMELD_DB.prepare(
    "INSERT INTO openMeldDaemon_owned_devices (owner_user_id, device_id, observed_display_name, platform_family, device_type, first_seen_at_ms, last_observed_at_ms, updated_at_ms) VALUES (?, ?, 'Service-only Mac', 'macOS', 'laptop', ?, ?, ?)"
  )
    .bind(userId, deviceId, now, now, now)
    .run();
  const context: OpenMeldRequestContext = {
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      openMeldProfileId: crypto.randomUUID(),
      profileKind: "human",
      profileName: "Computer test",
      requestId: crypto.randomUUID(),
    },
  };
  const ownerService: RuntimeTransportLookupOwnerServiceResponse = {
    online: true,
    sessions: [
      {
        daemonSessionId: "current-session",
        deviceId,
        lane: "canary",
        connectionGeneration: 1,
        lastHeartbeatMs: now,
        serviceVersion: "0.3.164",
        capabilities: { openMeldToolsControl: { requestUpdate: true } },
        executionCompatibility: {
          status: "compatible",
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          reasonCode: "daemon.runtime_contract.compatible",
        },
      },
    ],
  };
  const commands: unknown[] = [];
  // The simulated transport response follows the shared Service wire types;
  // all account inventory reads and RPC authorization use real test D1.
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/lookup-owner-service") {
      return Promise.resolve(Response.json(ownerService));
    }
    if (path === "/openmeld-tools-control") {
      commands.push(JSON.parse(String(init.body)));
      const result: RuntimeTransportOpenMeldToolsControlResponse = {
        status: "accepted",
        result: {
          operation: "request_update",
          result: { status: "current", currentVersion: "0.3.164" },
        },
      };
      return Promise.resolve(Response.json(result));
    }
    throw new Error(`Unexpected transport path: ${path}`);
  });
  const coreEnv = {
    OPENMELD_DB: env.OPENMELD_DB,
    OPENMELD_RUNTIME_TRANSPORT: {
      idFromName: (name: string) => {
        if (name !== userId) {
          throw new Error("Unexpected owner shard");
        }
        return name;
      },
      get: () => ({ fetch }),
    },
  } as unknown as CoreBindings;
  return {
    userId,
    target: { deviceId, runtimeLane: "canary" as const },
    context,
    coreEnv,
    commands,
    fetch,
    ownerService,
  };
}
