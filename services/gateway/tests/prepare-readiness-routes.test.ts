import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

type CoreRpcMock = {
  getPrepareReadiness: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  resolveProfile: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

function makeEnv(input?: {
  authOverrides?: Partial<AuthRpcMock>;
  coreOverrides?: Partial<CoreRpcMock>;
}) {
  const coreRpc: CoreRpcMock = {
    getPrepareReadiness: vi.fn(async () => ({
      agentControllerReportsRead: true,
      nonRunnableCapabilities: [],
      projection: {
        allRunnableCapabilitiesPrepared: {
          status: "prepared",
        },
        projectionStatus: "ready",
        reasonCodes: [],
      },
      runnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.ready"],
          status: "ready",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "ready",
      summary: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    })),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authMethod: "session",
        authenticated: true,
        ownerIds: ["owner-1"],
        requestId: "req-prepare-readiness-route",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
      },
    })),
    ...(input?.authOverrides ?? {}),
  };

  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

describe("prepare readiness routes", () => {
  it("GET /prepare-readiness forwards a read-only readiness query to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/devices/device-1/prepare-readiness?lane=openmeld-dev&openMeldServiceRuntimeId=runtime_opaque_1&agentControllerRef=builtin%3Acodex"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "ready",
      summary: {
        ready: true,
      },
    });
    expect(coreRpc.getPrepareReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        agentControllerRefs: ["builtin:codex"],
        deviceId: "device-1",
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: "runtime_opaque_1",
      })
    );
  });

  it("rejects a missing lane without calling Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/devices/device-1/prepare-readiness"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "invalid_payload",
      },
    });
    expect(coreRpc.getPrepareReadiness).not.toHaveBeenCalled();
  });
});
