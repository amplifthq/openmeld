import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

function makeEnv() {
  const getLocalRuntimeExpectedRoutes = vi.fn(async () => ({
    excludedProfiles: [],
    expectedRoutes: [
      {
        agentControllerCollaborationMode: "codex:plan",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "binding-1",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerConversationId: null,
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        profileName: "Planner",
        reasonCodes: [],
        routable: true,
      },
    ],
    generatedAt: "2026-07-28T00:00:00.000Z",
    runtimeResolution: "resolved",
    openMeldServiceRuntimeId: "runtime-1",
  }));
  return {
    coreRpc: { getLocalRuntimeExpectedRoutes },
    env: {
      OPENMELD_AUTH_WORKER: {
        resolveProfile: vi.fn(async () => ({
          ok: true,
          resolvedProfile: {
            ownerUserId: "owner-1",
            profileKind: "human",
            profileName: "Mira",
            openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          },
        })),
        resolveRequestAuth: vi.fn(async () => ({
          claims: {
            authMethod: "session",
            authenticated: true,
            ownerIds: ["owner-1"],
            requestId: "req-expected-routes",
          },
          ok: true,
        })),
      },
      OPENMELD_CORE_WORKER: { getLocalRuntimeExpectedRoutes },
    } as unknown as CloudflareBindings,
  };
}

describe("local runtime expected-routes route", () => {
  it("forwards explicit v2 negotiation to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/local-runtime/expected-routes?contractVersion=v2&deviceId=device-1&lane=prod"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      expectedRoutes: [{ agentControllerCollaborationMode: "codex:plan" }],
    });
    expect(coreRpc.getLocalRuntimeExpectedRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersion: "v2",
        deviceId: "device-1",
        lane: "prod",
      })
    );
  });

  it("forwards explicit v3 negotiation to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/local-runtime/expected-routes?contractVersion=v3&deviceId=device-1&lane=prod"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.getLocalRuntimeExpectedRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersion: "v3",
        deviceId: "device-1",
        lane: "prod",
      })
    );
  });

  it("forwards explicit v4 negotiation to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/local-runtime/expected-routes?contractVersion=v4&deviceId=device-1&lane=prod"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.getLocalRuntimeExpectedRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        contractVersion: "v4",
        deviceId: "device-1",
        lane: "prod",
      })
    );
  });

  it("keeps the legacy query shape and rejects unknown versions", async () => {
    const { coreRpc, env } = makeEnv();
    const legacyResponse = await app.fetch(
      new Request(
        "http://local/v1/local-runtime/expected-routes?deviceId=device-1&lane=prod"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(legacyResponse.status).toBe(200);
    expect(coreRpc.getLocalRuntimeExpectedRoutes).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ contractVersion: expect.anything() })
    );

    const invalidResponse = await app.fetch(
      new Request(
        "http://local/v1/local-runtime/expected-routes?contractVersion=v5&deviceId=device-1&lane=prod"
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(invalidResponse.status).toBe(400);
    expect(coreRpc.getLocalRuntimeExpectedRoutes).toHaveBeenCalledTimes(1);
  });
});
