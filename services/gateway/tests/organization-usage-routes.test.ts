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
  it("forwards the active member context and returns the strict overview", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/organizations/current/usage/overview"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      centerAgentWakes: {
        dailyLimit: 200,
        resetsAt: "2026-07-17T00:00:00.000Z",
        usedToday: 12,
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
    readOrganizationUsageOverview: vi.fn(async () => ({
      centerAgentWakes: {
        dailyLimit: 200,
        resetsAt: "2026-07-17T00:00:00.000Z",
        usedToday: 12,
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
