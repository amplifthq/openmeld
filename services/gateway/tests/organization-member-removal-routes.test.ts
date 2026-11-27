import type {
  AuthRpcResolveRequestAuthWithProfileResult,
  OrganizationMemberRemovalPlan,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PLAN: OrganizationMemberRemovalPlan = {
  memberId: "departing-member",
  userId: "departing-user",
  spaces: [
    { spaceId: "private-space", name: "Welcome Space", action: "close" },
  ],
};
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("Organization member removal routes", () => {
  it.each([
    "preview",
    "prepare",
  ] as const)("%s binds the reviewed plan to authenticated context and rejects injected identity", async (action) => {
    const { coreRpc, env } = makeEnv();
    const body =
      action === "preview"
        ? { memberId: PLAN.memberId }
        : { memberId: PLAN.memberId, spaces: PLAN.spaces };
    const method =
      action === "preview"
        ? coreRpc.previewOrganizationMemberRemoval
        : coreRpc.prepareOrganizationMemberRemoval;
    const response = await request(env, action, body);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      action === "preview" ? PLAN : { prepared: true }
    );
    expect(method).toHaveBeenCalledWith({
      ...body,
      ...(action === "prepare"
        ? { requestCredential: { kind: "cli_credential" } }
        : {}),
      context: {
        activeOrganizationId: "org-1",
        actorContext: {
          callerPrincipalId: "admin-user",
          ownerUserId: "admin-user",
          profileKind: "human",
          profileName: "Mira",
          requestId: "req-member-removal",
          openMeldProfileId: PROFILE_ID,
        },
      },
    });

    for (const injected of [
      { organizationId: "another-org" },
      { userId: "another-user" },
      { context: { activeOrganizationId: "another-org" } },
      { requestCredential: { kind: "interactive_session" } },
    ]) {
      expect(
        (await request(env, action, { ...body, ...injected })).status
      ).toBe(400);
    }
    expect(method).toHaveBeenCalledTimes(1);
  });

  it.each([
    "interactive_session",
    "cli_credential",
  ] as const)("uses the database-verified %s credential for preparation", async (credentialKind) => {
    const { authRpc, coreRpc, env } = makeEnv(true, "interactive_session");
    authRpc.resolveRequestCredentialKind.mockResolvedValueOnce({
      credentialKind,
    });
    const response = await request(env, "prepare", {
      memberId: PLAN.memberId,
      spaces: PLAN.spaces,
    });
    expect(response.status).toBe(200);
    expect(coreRpc.prepareOrganizationMemberRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ requestCredential: { kind: credentialKind } })
    );
    expect(authRpc.resolveRequestCredentialKind).toHaveBeenCalledTimes(1);
  });

  it.each([
    "preview",
    "prepare",
  ] as const)("%s requires authentication before revealing or changing ownership", async (action) => {
    const { coreRpc, env } = makeEnv(false);
    const response = await request(env, action, {
      memberId: PLAN.memberId,
      ...(action === "prepare" ? { spaces: PLAN.spaces } : {}),
    });
    expect(response.status).toBe(401);
    expect(coreRpc.previewOrganizationMemberRemoval).not.toHaveBeenCalled();
    expect(coreRpc.prepareOrganizationMemberRemoval).not.toHaveBeenCalled();
  });

  it("opts into the named default without changing legacy review payloads", async () => {
    const { coreRpc, env } = makeEnv();
    const body = { memberId: PLAN.memberId };
    const currentPlan = {
      ...PLAN,
      spaces: [
        {
          spaceId: "shared-space",
          name: "Operations",
          action: "transfer" as const,
        },
      ],
      defaultSuccessor: {
        userId: "fixture-owner",
        profileName: "Owner Fixture",
      },
    };
    const legacy = await request(env, "preview", body);
    expect(legacy.status).toBe(200);
    await expect(legacy.json()).resolves.toEqual(PLAN);
    expect(coreRpc.previewOrganizationMemberRemoval).toHaveBeenNthCalledWith(
      1,
      expect.not.objectContaining({ includeDefaultSuccessor: true })
    );

    coreRpc.previewOrganizationMemberRemoval.mockResolvedValueOnce(currentPlan);
    const current = await request(
      env,
      "preview",
      body,
      "?includeDefaultSuccessor=1"
    );
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(currentPlan);
    expect(coreRpc.previewOrganizationMemberRemoval).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ...body, includeDefaultSuccessor: true })
    );

    const prepared = {
      ...body,
      spaces: currentPlan.spaces,
      successorUserId: currentPlan.defaultSuccessor.userId,
      useDefaultSuccessor: true,
    };
    const result = await request(env, "prepare", prepared);
    expect(result.status).toBe(200);
    expect(
      coreRpc.prepareOrganizationMemberRemoval
    ).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(prepared));
  });

  it("falls back to the same authorized legacy preview only for an old Core schema rejection", async () => {
    const { coreRpc, env } = makeEnv();
    coreRpc.previewOrganizationMemberRemoval.mockRejectedValueOnce(
      new Error("HTTP 400: Invalid member removal request.")
    );
    const response = await request(
      env,
      "preview",
      { memberId: PLAN.memberId },
      "?includeDefaultSuccessor=1"
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(PLAN);
    expect(coreRpc.previewOrganizationMemberRemoval).toHaveBeenCalledTimes(2);
    expect(coreRpc.previewOrganizationMemberRemoval).toHaveBeenNthCalledWith(
      2,
      {
        memberId: PLAN.memberId,
        context: expect.objectContaining({ activeOrganizationId: "org-1" }),
      }
    );
  });

  it.each([
    [400, "Invalid organization context."],
    [403, "Only an organization owner or admin can remove members."],
    [409, "The removal review changed."],
    [503, "Core is unavailable."],
  ])("does not downgrade a preview error with status %i (%s)", async (status, message) => {
    const { coreRpc, env } = makeEnv();
    coreRpc.previewOrganizationMemberRemoval.mockRejectedValueOnce(
      new Error(`HTTP ${status}: ${message}`)
    );
    const response = await request(
      env,
      "preview",
      { memberId: PLAN.memberId },
      "?includeDefaultSuccessor=1"
    );
    expect(response.status).toBe(status);
    expect(coreRpc.previewOrganizationMemberRemoval).toHaveBeenCalledTimes(1);
  });

  it("rejects unreviewed preparation and preserves an uncertain mutation outcome without retrying", async () => {
    const { coreRpc, env } = makeEnv();
    expect(
      (await request(env, "prepare", { memberId: PLAN.memberId })).status
    ).toBe(400);
    expect(
      (
        await request(env, "prepare", {
          memberId: PLAN.memberId,
          spaces: [{ ...PLAN.spaces[0], action: "delete" }],
        })
      ).status
    ).toBe(400);
    expect(coreRpc.prepareOrganizationMemberRemoval).not.toHaveBeenCalled();

    coreRpc.prepareOrganizationMemberRemoval.mockRejectedValueOnce(
      new Error("Connection reset after submitting the preparation.")
    );
    expect(
      (
        await request(env, "prepare", {
          memberId: PLAN.memberId,
          spaces: PLAN.spaces,
        })
      ).status
    ).toBe(502);
    expect(coreRpc.prepareOrganizationMemberRemoval).toHaveBeenCalledTimes(1);
  });
});

function request(
  env: CloudflareBindings,
  action: "preview" | "prepare",
  body: unknown,
  query = ""
) {
  return app.fetch(
    new Request(
      `http://local/v1/organizations/current/member-removal/${action}${query}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ),
    env,
    TEST_EXECUTION_CONTEXT
  );
}

function makeEnv(
  authenticated = true,
  credentialKind: "interactive_session" | "cli_credential" = "cli_credential"
) {
  const coreRpc = {
    previewOrganizationMemberRemoval: vi.fn(async () => PLAN),
    prepareOrganizationMemberRemoval: vi.fn(async () => ({ prepared: true })),
  };
  const authResult: AuthRpcResolveRequestAuthWithProfileResult = authenticated
    ? {
        ok: true,
        claims: {
          activeOrganizationId: "org-1",
          authenticated: true,
          authMethod: "session",
          credentialKind,
          callerPrincipalId: "admin-user",
          ownerIds: ["admin-user"],
          requestId: "req-member-removal",
        },
        profile: {
          ok: true,
          resolvedProfile: {
            ownerUserId: "admin-user",
            profileKind: "human",
            profileName: "Mira",
            openMeldProfileId: PROFILE_ID,
          },
        },
      }
    : {
        ok: true,
        claims: {
          authenticated: false,
          authMethod: "none",
          ownerIds: [],
          requestId: "req-member-removal",
        },
      };
  const authRpc = {
    resolveRequestAuthWithProfile: vi.fn(async () => authResult),
    resolveRequestCredentialKind: vi.fn(async () => ({ credentialKind })),
  };
  return {
    authRpc,
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}
