import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
  ComputerFileAccessPolicyResponse,
  LocalFolderPickerResult,
  LocalProjectControlConnectResponse,
  LocalProjectControlDiscoverProjectsResponse,
  LocalProjectControlSetDefaultConnectionResponse,
  OpenMeldRequestContext,
  RuntimeTransportLookupOwnerServiceResponse,
  RuntimeTransportOpenMeldToolsControlResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcCreateProject } from "../src/projects/project-rpc";
import {
  rpcComputerPowerSettings,
  rpcConnectPeopleComputerProjectPath,
  rpcDiscoverPeopleComputerProjects,
  rpcReadPeopleComputerFileAccessPolicy,
  rpcRequestPeopleComputerOpenMeldToolsUpdate,
  rpcSelectPeopleComputerFolders,
  rpcSetPeopleComputerProjectDefaultConnection,
  rpcUpdatePeopleComputerFileAccessPolicy,
} from "../src/rpc/methods";
import { env } from "../test-support/worker-env";

describe("PeopleComputer explicit control RPC", () => {
  it.each([
    { failure: "timeout", status: 504, code: "computer.power.timeout" },
    { failure: "transport", status: 503, code: "computer.power.unavailable" },
    {
      failure: "invalid-response",
      status: 502,
      code: "computer.power.invalid_response",
    },
    {
      failure: "invalid-json",
      status: 502,
      code: "computer.power.invalid_response",
    },
    {
      failure: "null-json",
      status: 502,
      code: "computer.power.invalid_response",
    },
  ])("preserves Computer power $failure as an actionable failure", async ({
    failure,
    status,
    code,
  }) => {
    const f = await fixture();
    const originalFetch = f.fetch.getMockImplementation();
    if (!originalFetch) {
      throw new Error("Expected transport fixture");
    }
    f.fetch.mockImplementation((url, init) => {
      if (new URL(url).pathname !== "/computer-power") {
        return originalFetch(url, init);
      }
      if (failure === "transport") {
        return Promise.reject(
          new Error(
            "Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request."
          )
        );
      }
      if (failure === "invalid-json") {
        return Promise.resolve(new Response("{invalid JSON", { status: 200 }));
      }
      if (failure === "null-json") {
        return Promise.resolve(Response.json(null));
      }
      return Promise.resolve(
        Response.json(
          failure === "timeout"
            ? {
                status: "rejected",
                code,
                message:
                  "Timed out waiting for the local OpenMeld Service response.",
              }
            : { online: false, reasonCode: "daemon.delivery.timeout" },
          { status: failure === "timeout" ? 504 : 502 }
        )
      );
    });
    await expect(
      rpcComputerPowerSettings(f.coreEnv, {
        ...f.target,
        context: f.context,
        request: { operation: "update", enabled: true, expectedRevision: 0 },
      })
    ).rejects.toMatchObject({ cause: { status, code } });
    expect(
      f.fetch.mock.calls.filter(
        ([url]) => new URL(url).pathname === "/computer-power"
      )
    ).toHaveLength(1);
  });

  it("discovers Projects only for the authenticated member's exact Computer and Organization", async () => {
    const f = await fixture();
    const organizationId = crypto.randomUUID();
    const now = Date.now();
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Project target test\', $2, $3)',
              values: [],
            },
            values: [organizationId, `project-${organizationId}`, now],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Project member\', $2, 1, $3, $4)',
              values: [],
            },
            values: [f.userId, `${f.userId}@example.com`, now, now],
          },
          {
            ...{
              text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
              values: [],
            },
            values: [crypto.randomUUID(), organizationId, f.userId, now],
          },
          {
            ...{
              text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Project member', $2, 'human', 1, 'active', $3, $4, 'auth_bootstrap', $5, $6)",
              values: [],
            },
            values: [
              f.context.actorContext.openMeldProfileId,
              `member-${organizationId}`,
              f.userId,
              f.userId,
              now,
              now,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const request = {
      ...f.target,
      context: { ...f.context, activeOrganizationId: organizationId },
      expectedOrganizationId: organizationId,
      clientGeneration: 1,
    };
    await expect(
      rpcDiscoverPeopleComputerProjects(f.coreEnv, {
        ...request,
        deviceId: "foreign-device",
      })
    ).rejects.toThrow("not available on your account");
    await expect(
      rpcDiscoverPeopleComputerProjects(f.coreEnv, {
        ...request,
        expectedOrganizationId: "another-organization",
      })
    ).rejects.toThrow();
    expect(f.commands).toEqual([]);
    await expect(
      rpcDiscoverPeopleComputerProjects(f.coreEnv, request)
    ).resolves.toMatchObject({ deviceId: f.target.deviceId, projects: [] });
    expect(f.commands).toEqual([
      expect.objectContaining({
        deviceId: f.target.deviceId,
        lane: "canary",
        ownerUserId: f.userId,
        request: {
          expectedOrganizationId: organizationId,
          clientGeneration: 1,
          projects: [],
        },
      }),
    ]);
    // The account's preferred computer is B. Every explicit operation stays on A,
    // including subsequent writes after that preference changes again.
    await getPostgresDatabase(env).query({
      ...{
        text: "INSERT INTO \"openmeld\".\"openMeldDaemon_current_device_targets\" (owner_user_id, device_id, runtime_lane, updated_at_ms) VALUES ($1, 'computer-b', 'prod', $2)",
        values: [],
      },
      values: [f.userId, now],
    });
    const created = await rpcCreateProject(f.coreEnv, {
      context: request.context,
      expectedOrganizationId: organizationId,
      name: "Folder contract",
      slug: "folder-contract",
    });
    const mutation = {
      ...request,
      projectId: created.project.id,
      idempotencyKey: "connect-native-a",
      declaredPath: "/work/Design 中文 ",
      confirmNonGit: true,
    };
    const before = f.commands.length;
    for (const target of [
      { ...f.target, deviceId: "foreign-device" },
      { ...f.target, runtimeLane: "prod" as const },
    ]) {
      await expect(
        rpcConnectPeopleComputerProjectPath(f.coreEnv, {
          ...mutation,
          ...target,
        })
      ).rejects.toThrow();
    }
    expect(f.commands).toHaveLength(before);
    await expect(
      rpcConnectPeopleComputerProjectPath(f.coreEnv, mutation)
    ).resolves.toMatchObject({
      status: "connected",
      canonicalPath: mutation.declaredPath,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldDaemon_current_device_targets" SET device_id = \'computer-c\' WHERE owner_user_id = $1',
        values: [],
      },
      values: [f.userId],
    });
    await rpcSetPeopleComputerProjectDefaultConnection(f.coreEnv, {
      ...request,
      projectId: created.project.id,
      idempotencyKey: "default-native-a",
      targetBindingGeneration: "binding-a",
    });
    for (const command of f.commands.slice(before)) {
      expect(command).toMatchObject({
        deviceId: f.target.deviceId,
        lane: "canary",
        ownerUserId: f.userId,
      });
    }
    expect(f.commands[before]).toMatchObject({
      request: { declaredPath: mutation.declaredPath, confirmNonGit: true },
    });
  });
  it("opens a folder picker only on the exact owned environment and preserves cancellation", async () => {
    const f = await fixture();
    const request = {
      ...f.target,
      context: f.context,
      allowMultiple: true,
      purpose: "computer_file_access" as const,
    };
    await expect(
      rpcSelectPeopleComputerFolders(f.coreEnv, {
        ...request,
        deviceId: "foreign-device",
      })
    ).rejects.toThrow("not available on your account");
    await expect(
      rpcSelectPeopleComputerFolders(f.coreEnv, {
        ...request,
        runtimeLane: "prod",
      })
    ).rejects.toThrow("disconnected in this environment");
    expect(f.commands).toEqual([]);
    await expect(
      rpcSelectPeopleComputerFolders(f.coreEnv, request)
    ).resolves.toEqual({ deviceId: f.target.deviceId, status: "cancelled" });
    expect(f.commands).toEqual([
      expect.objectContaining({
        deviceId: f.target.deviceId,
        lane: "canary",
        ownerUserId: f.userId,
        request: {
          expectedDeviceId: f.target.deviceId,
          allowMultiple: true,
          purpose: "computer_file_access",
        },
      }),
    ]);
  });
  it("reads and updates file access on the requested environment without a Binding", async () => {
    const f = await fixture();
    await rpcReadPeopleComputerFileAccessPolicy(f.coreEnv, {
      ...f.target,
      context: f.context,
    });
    await rpcUpdatePeopleComputerFileAccessPolicy(f.coreEnv, {
      ...f.target,
      context: f.context,
      expectedRevision: 1,
      idempotencyKey: "exact-file-access",
      policy: { mode: "local_agent_settings" },
    });
    expect(f.commands).toEqual([
      expect.objectContaining({
        deviceId: f.target.deviceId,
        lane: "canary",
        ownerUserId: f.userId,
        request: { expectedDeviceId: f.target.deviceId },
      }),
      expect.objectContaining({
        deviceId: f.target.deviceId,
        lane: "canary",
        ownerUserId: f.userId,
        request: {
          expectedDeviceId: f.target.deviceId,
          expectedRevision: 1,
          idempotencyKey: "exact-file-access",
          policy: { mode: "local_agent_settings" },
        },
      }),
    ]);
  });
  it("rejects foreign and disconnected file-access targets before exposing or changing policy", async () => {
    const f = await fixture();
    await expect(
      rpcReadPeopleComputerFileAccessPolicy(f.coreEnv, {
        ...f.target,
        deviceId: "foreign-device",
        context: f.context,
      })
    ).rejects.toThrow("not available on your account");
    await expect(
      rpcUpdatePeopleComputerFileAccessPolicy(f.coreEnv, {
        ...f.target,
        runtimeLane: "prod",
        context: f.context,
        expectedRevision: 1,
        idempotencyKey: "wrong-environment",
        policy: { mode: "local_agent_settings" },
      })
    ).rejects.toThrow("disconnected in this environment");
    expect(f.commands).toEqual([]);
  });
  it("rejects file access when a replacement Service no longer advertises policy control", async () => {
    const f = await fixture();
    if (!(f.ownerService.online && f.ownerService.sessions[0])) {
      throw new Error("Expected current session");
    }
    f.ownerService.sessions.unshift({
      ...f.ownerService.sessions[0],
      daemonSessionId: "replacement-no-file-access",
      connectionGeneration: 2,
      lastHeartbeatMs: Date.now() + 1,
      capabilities: {},
    });
    await expect(
      rpcReadPeopleComputerFileAccessPolicy(f.coreEnv, {
        ...f.target,
        context: f.context,
      })
    ).rejects.toThrow("does not support managing file access");
    expect(f.commands).toEqual([]);
  });
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
  await getPostgresDatabase(env).query({
    ...{
      text: "INSERT INTO \"openmeld\".\"openMeldDaemon_owned_devices\" (owner_user_id, device_id, observed_display_name, platform_family, device_type, first_seen_at_ms, last_observed_at_ms, updated_at_ms) VALUES ($1, $2, 'Service-only Mac', 'macOS', 'laptop', $3, $4, $5)",
      values: [],
    },
    values: [userId, deviceId, now, now, now],
  });
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
        capabilities: {
          openMeldToolsControl: { requestUpdate: true },
          computerFileAccess: { readPolicy: true, updatePolicy: true },
          localFolderPicker: { selectFolders: true },
          localProjectControl: {
            discoverProjects: true,
            connectDeclaredPath: true,
            setDefaultConnection: true,
          },
        },
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
    if (path === "/local-folder-picker/select-folders") {
      commands.push(JSON.parse(String(init.body)));
      const result: LocalFolderPickerResult = { deviceId, status: "cancelled" };
      return Promise.resolve(Response.json(result));
    }
    if (path === "/local-project-control/discover-projects") {
      commands.push(JSON.parse(String(init.body)));
      const result: LocalProjectControlDiscoverProjectsResponse = {
        deviceId,
        projects: [],
        checkedAtMs: now,
        clientGeneration: 1,
        gitStatus: "available",
        requestId: "project-discovery",
      };
      return Promise.resolve(Response.json(result));
    }
    if (path === "/local-project-control/connect-declared-path") {
      const command = JSON.parse(String(init.body));
      commands.push(command);
      const result: LocalProjectControlConnectResponse = {
        status: "connected",
        canonicalPath: command.request.declaredPath,
        bindingGeneration: "binding-a",
        isDefault: false,
      };
      return Promise.resolve(Response.json(result));
    }
    if (path === "/local-project-control/set-default-connection") {
      commands.push(JSON.parse(String(init.body)));
      const result: LocalProjectControlSetDefaultConnectionResponse = {
        status: "updated",
        connections: [
          {
            bindingGeneration: "binding-a",
            path: "/work/Design 中文 ",
            isDefault: true,
            status: "available",
          },
        ],
      };
      return Promise.resolve(Response.json(result));
    }
    if (
      path === "/computer-file-access/read-policy" ||
      path === "/computer-file-access/update-policy"
    ) {
      commands.push(JSON.parse(String(init.body)));
      const result: ComputerFileAccessPolicyResponse = {
        deviceId,
        policy: { mode: "local_agent_settings", revision: 1, updatedAtMs: now },
      };
      return Promise.resolve(Response.json(result));
    }
    throw new Error(`Unexpected transport path: ${path}`);
  });
  const coreEnv = {
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
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
