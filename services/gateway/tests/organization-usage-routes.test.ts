import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("Organization Usage routes", () => {
  it("queries the authenticated organization and rejects caller-supplied organization identity", async () => {
    const { coreRpc, env } = makeEnv();
    const query = { fromMs: 1000, toMs: 2000, computerId: "computer-1" };
    const request = (body: unknown) =>
      app.fetch(
        new Request("http://local/v1/organizations/current/usage/query", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );
    expect((await request(query)).status).toBe(200);
    expect(coreRpc.readOrganizationAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ activeOrganizationId: "org-1" }),
        query,
      })
    );
    expect(
      (await request({ ...query, organizationId: "another-org" })).status
    ).toBe(400);
    expect(
      (await request({ ...query, toMs: 1000 + 32 * 86_400_000 })).status
    ).toBe(400);
    expect(coreRpc.readOrganizationAiUsage).toHaveBeenCalledTimes(1);
  });

  it("forwards the active member context and returns the strict overview", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/organizations/current/usage/overview"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      aiSpend: {
        dailyLimitNanoUsd: null,
        resetsAt: "2026-07-17T00:00:00.000Z",
        usedNanoUsd: 120_000_000,
        missingCostRequests: 0,
        exhausted: false,
      },
      routines: {
        count: 7,
        limit: 50,
      },
    });
    expect(coreRpc.readOrganizationUsageOverview).toHaveBeenCalledWith({
      context: {
        activeOrganizationId: "org-1",
        actorContext: {
          callerPrincipalId: "owner-1",
          ownerUserId: "owner-1",
          profileKind: "human",
          profileName: "Mira",
          requestId: "req-organization-usage",
          openMeldProfileId: HUMAN_PROFILE_ID,
        },
      },
    });
  });
});

function makeEnv() {
  const coreRpc = {
    readOrganizationAiUsage: vi.fn(async () => ({
      fromMs: 1000,
      toMs: 2000,
      models: [],
    })),
    readOrganizationUsageOverview: vi.fn(async () => ({
      aiSpend: {
        dailyLimitNanoUsd: null,
        resetsAt: "2026-07-17T00:00:00.000Z",
        usedNanoUsd: 120_000_000,
        missingCostRequests: 0,
        exhausted: false,
      },
      routines: {
        count: 7,
        limit: 50,
      },
    })),
  };
  const resolvedProfile = {
    ownerUserId: "owner-1",
    profileKind: "human" as const,
    profileName: "Mira",
    openMeldProfileId: HUMAN_PROFILE_ID,
  };
  const claims = {
    activeOrganizationId: "org-1",
    authenticated: true,
    authMethod: "session",
    callerPrincipalId: "owner-1",
    ownerIds: ["owner-1"],
    requestId: "req-organization-usage",
  };
  const authRpc = {
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile,
    })),
    resolveRequestAuth: vi.fn(async () => ({ claims, ok: true })),
    resolveRequestAuthWithProfile: vi.fn(async () => ({
      claims,
      ok: true,
      profile: { ok: true, resolvedProfile },
    })),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}
