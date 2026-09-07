import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

type CoreRpcMock = {
  readPeopleComputerFileAccessPolicy: ReturnType<typeof vi.fn>;
  updatePeopleComputerFileAccessPolicy: ReturnType<typeof vi.fn>;
  setPeopleComputerLocalAgentEnabled: ReturnType<typeof vi.fn>;
  getPeopleComputerLocalAgentInstallations: ReturnType<typeof vi.fn>;
  selectPeopleComputerLocalAgentInstallation: ReturnType<typeof vi.fn>;
  refreshPeopleComputerLocalAgentCatalog: ReturnType<typeof vi.fn>;
  requestPeopleComputerOpenMeldToolsUpdate: ReturnType<typeof vi.fn>;
  setPeopleComputerOpenMeldToolsMaintenance: ReturnType<typeof vi.fn>;
  readComputerFileAccessPolicy: ReturnType<typeof vi.fn>;
  forgetComputer: ReturnType<typeof vi.fn>;
  forgetCurrentComputer: ReturnType<typeof vi.fn>;
  listLocalRuntimes: ReturnType<typeof vi.fn>;
  getCurrentDeviceTarget: ReturnType<typeof vi.fn>;
  getCurrentOrganizationComputers: ReturnType<typeof vi.fn>;
  selectLocalFolders: ReturnType<typeof vi.fn>;
  setLocalRuntimeDisplayName: ReturnType<typeof vi.fn>;
  updateComputerFileAccessPolicy: ReturnType<typeof vi.fn>;
  enrollLocalRuntime: ReturnType<typeof vi.fn>;
  writeCurrentDeviceObservedMetadata: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  resolveRequestAuth: ReturnType<typeof vi.fn>;
  resolveProfile: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const RETIRED_START_SESSION_MESSAGE =
  "Legacy Start Session setup is retired. Upgrade OpenMeld CLI, then run openmeld setup.";

function makeEnv(input?: {
  coreOverrides?: Partial<CoreRpcMock>;
  authOverrides?: Partial<AuthRpcMock>;
}) {
  const coreRpc: CoreRpcMock = {
    readPeopleComputerFileAccessPolicy: vi.fn(),
    updatePeopleComputerFileAccessPolicy: vi.fn(),
    setPeopleComputerLocalAgentEnabled: vi.fn(),
    getPeopleComputerLocalAgentInstallations: vi.fn(),
    selectPeopleComputerLocalAgentInstallation: vi.fn(),
    refreshPeopleComputerLocalAgentCatalog: vi.fn(),
    requestPeopleComputerOpenMeldToolsUpdate: vi.fn(),
    setPeopleComputerOpenMeldToolsMaintenance: vi.fn(),
    readComputerFileAccessPolicy: vi.fn(async () => ({
      deviceId: "device-123",
      policy: {
        mode: "local_agent_settings",
        revision: 1,
        updatedAtMs: 0,
      },
    })),
    forgetComputer: vi.fn(async () => ({
      status: "forgotten",
      forgottenDeviceId: "device-123",
      currentDeviceTarget: {
        availability: "resolved",
        deviceId: "device-current",
        runtimeLane: "dev-local",
      },
    })),
    forgetCurrentComputer: vi.fn(async () => ({
      status: "forgotten",
      forgottenDeviceId: "device-123",
      currentDeviceTarget: {
        availability: "missing",
      },
    })),
    listLocalRuntimes: vi.fn(async () => ({
      currentDeviceId: null,
      currentRuntimeLane: null,
      localRuntimes: [],
    })),
    getCurrentDeviceTarget: vi.fn(async () => ({
      availability: "missing",
    })),
    getCurrentOrganizationComputers: vi.fn(async () => ({
      computers: [],
      generatedAt: "2026-08-20T00:00:00.000Z",
      organizationId: "organization-1",
    })),
    selectLocalFolders: vi.fn(async () => ({
      deviceId: "device-123",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    })),
    setLocalRuntimeDisplayName: vi.fn(async () => ({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "Office MacBook",
          deviceDisplayNameSource: "user",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          firstSeenAtMs: 1_712_966_000_000,
          lastObservedAtMs: 1_712_966_400_000,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    })),
    updateComputerFileAccessPolicy: vi.fn(async () => ({
      deviceId: "device-123",
      policy: {
        folders: ["/Users/felix/work"],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
    })),
    enrollLocalRuntime: vi.fn(async () => ({
      deviceId: "device-123",
      runtimeLane: "dev-local",
    })),
    writeCurrentDeviceObservedMetadata: vi.fn(async () => ({
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: 1_712_966_400_000,
      },
    })),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-current-device-route",
        authMethod: "session",
        ownerIds: ["owner-1"],
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        profileName: "Mira",
        ownerUserId: "owner-1",
      },
    })),
    ...(input?.authOverrides ?? {}),
  };

  return {
    env: {
      OPENMELD_CORE_WORKER: coreRpc,
      OPENMELD_AUTH_WORKER: authRpc,
    } as unknown as CloudflareBindings,
    coreRpc,
  };
}

describe("current device target routes", () => {
  it.each([
    ["GET", "file-access", "readPeopleComputerFileAccessPolicy", undefined],
    [
      "PUT",
      "file-access",
      "updatePeopleComputerFileAccessPolicy",
      {
        expectedRevision: 1,
        idempotencyKey: "save-policy",
        policy: { mode: "local_agent_settings" },
      },
    ],
    [
      "PUT",
      "local-agents/codex/enabled",
      "setPeopleComputerLocalAgentEnabled",
      { enabled: false },
    ],
    [
      "GET",
      "local-agents/codex/installations",
      "getPeopleComputerLocalAgentInstallations",
      undefined,
    ],
    [
      "PUT",
      "local-agents/codex/installations",
      "selectPeopleComputerLocalAgentInstallation",
      { installationId: "selected-installation" },
    ],
    [
      "POST",
      "local-agents/refresh-catalog",
      "refreshPeopleComputerLocalAgentCatalog",
      undefined,
    ],
    [
      "POST",
      "openmeld-tools/update",
      "requestPeopleComputerOpenMeldToolsUpdate",
      undefined,
    ],
    [
      "PUT",
      "openmeld-tools/maintenance",
      "setPeopleComputerOpenMeldToolsMaintenance",
      { automaticUpdatesEnabled: false },
    ],
  ] as const)("forwards an explicit %s %s target and preserves Core rejection", async (method, suffix, rpc, body) => {
    const { coreRpc, env } = makeEnv();
    coreRpc[rpc].mockRejectedValueOnce(
      new Error("Disconnected", {
        cause: {
          status: 503,
          code: "computer.target_disconnected",
          message: "Selected environment is disconnected.",
        },
      })
    );
    const response = await app.fetch(
      new Request(
        `http://local/v1/people-computers/selected-device/lanes/canary/${suffix}`,
        {
          method,
          ...(body
            ? {
                body: JSON.stringify(body),
                headers: { "content-type": "application/json" },
              }
            : {}),
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(503);
    expect(coreRpc[rpc]).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        deviceId: "selected-device",
        runtimeLane: "canary",
        ...body,
        ...(suffix.includes("/codex/") ? { agentId: "codex" } : {}),
      })
    );
    expect(coreRpc.getCurrentDeviceTarget).not.toHaveBeenCalled();
  });

  it("rejects an invalid explicit environment before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/people-computers/selected-device/lanes/unknown/openmeld-tools/update",
        { method: "POST" }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(400);
    expect(
      coreRpc.requestPeopleComputerOpenMeldToolsUpdate
    ).not.toHaveBeenCalled();
  });

  it("forwards the Organization Computers usage-limit opt-in", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/organizations/current/computers?includeUsageLimits=true"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.getCurrentOrganizationComputers).toHaveBeenCalledWith(
      expect.objectContaining({ includeUsageLimits: "true" })
    );
  });

  it("opens Local Folder Picker on the exact current Computer", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/current/folder-picker", {
        body: JSON.stringify({
          allowMultiple: true,
          expectedDeviceId: "device-123",
          purpose: "computer_file_access",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deviceId: "device-123",
      paths: ["/Users/felix/Design Work"],
      status: "selected",
    });
    expect(coreRpc.selectLocalFolders).toHaveBeenCalledWith(
      expect.objectContaining({
        allowMultiple: true,
        expectedDeviceId: "device-123",
        purpose: "computer_file_access",
      })
    );
  });

  it("reads and updates file access for the exact current Computer", async () => {
    const { coreRpc, env } = makeEnv();

    const readResponse = await app.fetch(
      new Request(
        "http://local/v1/local-runtimes/current/file-access?expectedDeviceId=device-123"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    const updateResponse = await app.fetch(
      new Request("http://local/v1/local-runtimes/current/file-access", {
        body: JSON.stringify({
          expectedDeviceId: "device-123",
          expectedRevision: 1,
          idempotencyKey: "save-1",
          policy: {
            folders: ["/Users/felix/work"],
            mode: "only_selected_folders",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(readResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(coreRpc.readComputerFileAccessPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDeviceId: "device-123" })
    );
    expect(coreRpc.updateComputerFileAccessPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDeviceId: "device-123",
        expectedRevision: 1,
        idempotencyKey: "save-1",
      })
    );
  });

  it("rejects a relative file access folder before Core RPC", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/current/file-access", {
        body: JSON.stringify({
          expectedDeviceId: "device-123",
          expectedRevision: 1,
          idempotencyKey: "save-1",
          policy: {
            folders: ["relative/path"],
            mode: "only_selected_folders",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.updateComputerFileAccessPolicy).not.toHaveBeenCalled();
  });

  it("GET /v1/local-runtimes returns the signed-in user's local runtimes", async () => {
    const { env, coreRpc } = makeEnv({
      coreOverrides: {
        listLocalRuntimes: vi.fn(async () => ({
          currentDeviceId: "device-123",
          currentRuntimeLane: "dev-local",
          localRuntimes: [
            {
              deviceId: "device-123",
              deviceDisplayName: "This computer",
              deviceDisplayNameSource: "placeholder",
              platformFamily: "Unknown",
              osVersion: null,
              deviceType: "unknown",
              firstSeenAtMs: 1_712_966_000_000,
              lastObservedAtMs: null,
              isCurrent: true,
              executionTargets: [],
            },
          ],
        })),
      },
    });

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "This computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: 1_712_966_000_000,
          lastObservedAtMs: null,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });
    expect(coreRpc.listLocalRuntimes).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            ownerUserId: "owner-1",
          }),
        }),
      })
    );
  });

  it("GET /v1/local-runtimes forwards explicit connection identity adoption", async () => {
    const { env, coreRpc } = makeEnv({
      coreOverrides: {
        listLocalRuntimes: vi.fn(async () => ({
          currentConnectedComputerId: "computer-123",
          currentDeviceId: "device-123",
          currentRuntimeLane: "dev-local",
          legacyDeviceEvidence: [],
          localRuntimes: [],
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/local-runtimes?connectionIdentityAdoption=safe_legacy_current&includeUsageLimits=true"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.listLocalRuntimes).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionIdentityAdoption: "safe_legacy_current",
        includeUsageLimits: "true",
      })
    );
  });

  it("GET /v1/devices/current returns missing without using 404 semantics", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/devices/current"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      availability: "missing",
    });
    expect(coreRpc.getCurrentDeviceTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            ownerUserId: "owner-1",
          }),
        }),
      })
    );
  });

  it("POST /v1/local-runtimes/:deviceId/enrollment enrolls the device", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-789/enrollment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          runtimeLane: "dev-local",
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deviceId: "device-123",
      runtimeLane: "dev-local",
    });
    expect(coreRpc.enrollLocalRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-789",
        runtimeLane: "dev-local",
      })
    );
  });

  it("POST enrollment forwards connected computer evidence", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-new-home/enrollment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          connectedComputerId: "computer-existing",
          runtimeLane: "dev-local",
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.enrollLocalRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedComputerId: "computer-existing",
        deviceId: "device-new-home",
        runtimeLane: "dev-local",
      })
    );
  });

  it("POST /v1/devices/current/forget forgets the signed-in user's current computer", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/devices/current/forget", {
        method: "POST",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "forgotten",
      forgottenDeviceId: "device-123",
      currentDeviceTarget: {
        availability: "missing",
      },
    });
    expect(coreRpc.forgetCurrentComputer).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            ownerUserId: "owner-1",
          }),
        }),
      })
    );
  });

  it("POST /v1/devices/:deviceId/forget forgets an owned computer by id", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/devices/device-other/forget", {
        method: "POST",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "forgotten",
      forgottenDeviceId: "device-123",
      currentDeviceTarget: {
        availability: "resolved",
        deviceId: "device-current",
        runtimeLane: "dev-local",
      },
    });
    expect(coreRpc.forgetComputer).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-other",
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            ownerUserId: "owner-1",
          }),
        }),
      })
    );
  });

  it("returns invalid_json when the request body is malformed", async () => {
    const { env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-1/enrollment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_json",
      },
    });
  });

  it("returns invalid_payload when runtimeLane is missing", async () => {
    const { env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-1/enrollment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_payload",
      },
    });
  });

  it("PUT /v1/devices/:deviceId/observed-metadata writes observed computer metadata", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/devices/device-123/observed-metadata", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          metadata: {
            observedDisplayName: "Felix's MacBook Pro",
            platformFamily: "macOS",
            osVersion: "15.4",
            deviceType: "laptop",
            observedAtMs: 1_712_966_400_000,
          },
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: 1_712_966_400_000,
      },
    });
    expect(coreRpc.writeCurrentDeviceObservedMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-123",
        metadata: {
          observedDisplayName: "Felix's MacBook Pro",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          observedAtMs: 1_712_966_400_000,
        },
      })
    );
  });

  it("PUT /v1/local-runtimes/current/observed-metadata returns the retired StartSession setup stub", async () => {
    const { env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/current/observed-metadata", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: "{",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "start.session.retired",
        message: RETIRED_START_SESSION_MESSAGE,
      },
    });
  });

  it("PUT /v1/local-runtimes/:deviceId/display-name writes the user computer name", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-123/display-name", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "  Office MacBook  ",
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      currentDeviceId: "device-123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceId: "device-123",
          deviceDisplayName: "Office MacBook",
          deviceDisplayNameSource: "user",
          platformFamily: "macOS",
          osVersion: "15.4",
          deviceType: "laptop",
          firstSeenAtMs: 1_712_966_000_000,
          lastObservedAtMs: 1_712_966_400_000,
          isCurrent: true,
          executionTargets: [],
        },
      ],
    });
    expect(coreRpc.setLocalRuntimeDisplayName).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-123",
        displayName: "Office MacBook",
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            ownerUserId: "owner-1",
          }),
        }),
      })
    );
  });

  it("PUT /v1/local-runtimes/:deviceId/display-name rejects invalid payloads", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-123/display-name", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "   ",
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_payload",
      },
    });
    expect(coreRpc.setLocalRuntimeDisplayName).not.toHaveBeenCalled();
  });

  it("PUT /v1/local-runtimes/:deviceId/display-name rejects invalid device ids", async () => {
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/%20%20%20/display-name", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "Office MacBook",
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_device_id",
      },
    });
    expect(coreRpc.setLocalRuntimeDisplayName).not.toHaveBeenCalled();
  });

  it("passes through upstream errors without rewriting the public shape", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        enrollLocalRuntime: vi.fn(() => {
          const error = new Error("store unavailable") as Error & {
            status?: number;
            code?: string;
          };
          error.status = 503;
          error.code = "upstream_unreachable";
          throw error;
        }),
      },
    });

    const response = await app.fetch(
      new Request("http://local/v1/local-runtimes/device-123/enrollment", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          runtimeLane: "dev-local",
        }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "upstream_unreachable",
      },
    });
  });
});
