import {
  PostgresDatabase,
  type QueryConfig,
  type QueryResultRow,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import { selectLastSelectedOrganizationErrorResponseSchema } from "@openmeld/schemas";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = {
  api: {
    getSession: vi.fn(),
    setPassword: vi.fn(),
  },
};
const createAuthMock = vi.fn(() => ({
  api: {
    ...authMock.api,
    // Better Auth's public returnHeaders option wraps the same payload. Keep
    // identity-only RPC fixtures raw and give HTTP callers the vendor envelope.
    async getSession(options: { returnHeaders?: boolean }) {
      const response = await authMock.api.getSession(options);
      return options.returnHeaders
        ? { response, headers: new Headers() }
        : response;
    },
  },
}));
let requestStateActive = false;
const runWithAuthRequestStateMock = vi.fn(
  async <T>(callback: () => T | Promise<T>): Promise<T> => {
    requestStateActive = true;
    try {
      return await callback();
    } finally {
      requestStateActive = false;
    }
  }
);

const profileServiceMock = {
  getProfileCapabilities: vi.fn(),
  listProfilesForOwner: vi.fn(),
  listProfilesForOwnerEnsuringPrimaryHumanProfile: vi.fn(),
  listResolvedProfileLineageForOwner: vi.fn(),
  resolveProfileForOwner: vi.fn(),
  resolvePrimaryHumanAndRequestedProfileForOwner: vi.fn(),
  resolveProfileById: vi.fn(),
  createAgentProfile: vi.fn(),
  ensureManagedAgentProfile: vi.fn(),
  createHumanProfile: vi.fn(),
  updateProfileForOwner: vi.fn(),
  updateAgentProfileDefaultProjectForOwner: vi.fn(),
  deleteProfileForOwner: vi.fn(),
  ensurePrimaryHumanProfile: vi.fn(),
  listProfileSpaceHistory: vi.fn(),
  listOwnerAccessibleSpaceIds: vi.fn(),
  querySpaceDeletionTombstones: vi.fn(),
  upsertProfileSpaceHistory: vi.fn(),
  upsertSpaceDeletionTombstone: vi.fn(),
  updateProfileSpaceHistoryStatus: vi.fn(),
};

const waitlistServiceMock = {
  joinWaitlist: vi.fn(),
};

const localAuthUserStoreMock = {
  hasUserById: vi.fn(),
};

// Pure Auth read projections use the native vendor result contract.
const dbMock = {
  query:
    vi.fn<
      (query: QueryConfig) => Promise<ReturnType<typeof nativeQueryResult>>
    >(),
};

vi.mock("@openmeld/auth/server", async () => {
  const profileErrorsActual = await vi.importActual<
    typeof import("../../../packages/auth/src/profiles/profile-errors")
  >("../../../packages/auth/src/profiles/profile-errors");
  const { createAuthDatabase } =
    await vi.importActual<typeof import("@openmeld/db/auth")>(
      "@openmeld/db/auth"
    );
  const cliCredential = await vi.importActual<
    typeof import("../../../packages/auth/src/plugins/cli-credential")
  >("../../../packages/auth/src/plugins/cli-credential");
  return {
    createAuthDatabase,
    hasBearerAuthorization: cliCredential.hasBearerAuthorization,
    isCliCredentialSessionRecord: cliCredential.isCliCredentialSessionRecord,
    AUTH_SERVICE_NAME: "openmeld-auth",
    AdditionalHumanProfileCreationDisabledError:
      profileErrorsActual.AdditionalHumanProfileCreationDisabledError,
    PrimaryHumanProfileDeleteForbiddenError:
      profileErrorsActual.PrimaryHumanProfileDeleteForbiddenError,
    ProfileCreationIdempotencyConflictError:
      profileErrorsActual.ProfileCreationIdempotencyConflictError,
    ProfileNotFoundError: profileErrorsActual.ProfileNotFoundError,
    ProfileValidationError: profileErrorsActual.ProfileValidationError,
    createUnauthenticatedClaims: (requestId: string) => ({
      authenticated: false,
      authMethod: "session",
      ownerIds: [],
      requestId,
    }),
    normalizeAuthHeaderValue: (value: string) => {
      const normalized = String(value ?? "").trim();
      return normalized.length > 0 ? normalized : null;
    },
    resolveTrustedOrigins: vi.fn(() => ["http://localhost:3000"]),
  };
});

// The MemberAgent routes are behind the release flag, which runs before the
// session check; force it on so the sub-route wiring is what is tested.
vi.mock("@openmeld/schemas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openmeld/schemas")>()),
  MEMBER_AGENTS_ENABLED: true,
}));

vi.mock("../src/lib/better-auth", () => ({
  createAuth: createAuthMock,
}));

vi.mock("../src/lazy-runtime-modules", () => ({
  loadBetterAuthRuntime: vi.fn(async () => ({
    createAuth: createAuthMock,
    runWithAuthRequestState: runWithAuthRequestStateMock,
  })),
}));

vi.mock("../src/lib/profiles/service", async () => {
  const { createMiddleware } = await import("hono/factory");

  return {
    getOpenMeldProfileService: vi.fn(() => profileServiceMock),
    profileServiceMiddleware: createMiddleware<any>(async (c, next) => {
      c.set("profileService", profileServiceMock);
      await next();
    }),
  };
});

vi.mock("../src/lib/waitlist/service", () => ({
  getWaitlistService: vi.fn(() => waitlistServiceMock),
}));

vi.mock("../src/lib/better-auth/local-auth-user-store", () => ({
  getLocalAuthUserStore: vi.fn(() => localAuthUserStoreMock),
}));

import {
  AdditionalHumanProfileCreationDisabledError,
  ProfileNotFoundError,
} from "@openmeld/auth/server";
import { createHonoApp } from "../src/lib/hono/create-hono-app";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import { createAuthWorkerTestApp } from "./support/auth-worker-entrypoint.test-support";

function nativeQueryResult(rows: QueryResultRow[]) {
  return { rows, rowCount: rows.length, fields: [], command: "SELECT", oid: 0 };
}
const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const TEST_ENV = {
  AUTH_WORKER_NODE_ENV: "test",
  OPENMELD_POSTGRESQL: {
    connectionString: "postgresql://projection@127.0.0.1:1/projection",
  },
} as unknown as CloudflareBindings;

describe("auth session resolution", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    authMock.api.getSession.mockReset();
    authMock.api.setPassword.mockReset();
    requestStateActive = false;
    runWithAuthRequestStateMock.mockClear();
    profileServiceMock.getProfileCapabilities.mockReset();
    profileServiceMock.getProfileCapabilities.mockReturnValue({
      additionalHumanProfileCreationEnabled: false,
    });
    profileServiceMock.listProfilesForOwner.mockReset();
    profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile.mockReset();
    profileServiceMock.listResolvedProfileLineageForOwner.mockReset();
    profileServiceMock.resolveProfileForOwner.mockReset();
    profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockReset();
    profileServiceMock.resolveProfileById.mockReset();
    profileServiceMock.createAgentProfile.mockReset();
    profileServiceMock.ensureManagedAgentProfile.mockReset();
    profileServiceMock.createHumanProfile.mockReset();
    profileServiceMock.updateProfileForOwner.mockReset();
    profileServiceMock.updateAgentProfileDefaultProjectForOwner.mockReset();
    profileServiceMock.deleteProfileForOwner.mockReset();
    profileServiceMock.ensurePrimaryHumanProfile.mockReset();
    profileServiceMock.listProfileSpaceHistory.mockReset();
    profileServiceMock.listOwnerAccessibleSpaceIds.mockReset();
    profileServiceMock.querySpaceDeletionTombstones.mockReset();
    profileServiceMock.upsertProfileSpaceHistory.mockReset();
    profileServiceMock.upsertSpaceDeletionTombstone.mockReset();
    profileServiceMock.updateProfileSpaceHistoryStatus.mockReset();
    waitlistServiceMock.joinWaitlist.mockReset();
    localAuthUserStoreMock.hasUserById.mockReset();
    localAuthUserStoreMock.hasUserById.mockResolvedValue(true);
    dbMock.query.mockReset();
    dbMock.query.mockResolvedValue(nativeQueryResult([]));
    vi.spyOn(PostgresDatabase.prototype, "query").mockImplementation(
      async (query, values) =>
        dbMock.query(
          typeof query === "string" ? { text: query, values } : query
        )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps downstream auth work inside the lazy runtime request state", async () => {
    authMock.api.getSession.mockImplementation(() => {
      expect(requestStateActive).toBe(true);
      return null;
    });
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    expect(runWithAuthRequestStateMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "false",
    "1",
  ])("rejects an invalid Organization renewal opt-in %s before session access", async (value) => {
    const response = await createAuthWorkerTestApp().fetch(
      new Request(
        `http://local/v1/account/organization-context?deferSessionRefresh=${value}`
      ),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_query",
      ok: false,
    });
    expect(authMock.api.getSession).not.toHaveBeenCalled();
  });

  it("returns 401 when profile routes are genuinely unauthenticated", async () => {
    authMock.api.getSession.mockResolvedValue(null);
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "auth.unauthenticated",
      message: "authentication required",
    });
    expect(authMock.api.getSession).toHaveBeenCalledTimes(1);
  });

  it("treats stale cached sessions without a local auth user row as unauthenticated on profile routes", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    localAuthUserStoreMock.hasUserById.mockResolvedValue(false);
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "auth.unauthenticated",
      message: "authentication required",
    });
    expect(localAuthUserStoreMock.hasUserById).toHaveBeenCalledWith("user-123");
    expect(
      profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile
    ).not.toHaveBeenCalled();
  });

  it("returns the verified auth user id as callerPrincipalId in request auth claims", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.ensurePrimaryHumanProfile.mockResolvedValue({
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
      profileKind: "human",
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.resolveRequestAuth()).resolves.toEqual({
      ok: true,
      claims: expect.objectContaining({
        authenticated: true,
        callerPrincipalId: "user-123",
        activeOrganizationId: "org-123",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
      }),
    });
  });

  it("tells an interactive session from a CLI-held one (member-agent-program.md §4.7)", async () => {
    profileServiceMock.ensurePrimaryHumanProfile.mockResolvedValue({
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
      profileKind: "human",
    });
    const user = {
      id: "user-123",
      name: "Felix",
      email: "felix@openmeld.invalid",
    };
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);
    const credentialKind = async (input: {
      cliCredentialAt: number | null;
      headers: Record<string, string>;
    }) => {
      authMock.api.getSession.mockResolvedValueOnce({
        session: { id: "session-123", cliCredentialAt: input.cliCredentialAt },
        user,
      });
      const result = await rpc.resolveRequestAuth({ headers: input.headers });
      return result.ok ? result.claims.credentialKind : null;
    };

    await expect(
      credentialKind({
        cliCredentialAt: null,
        headers: { cookie: "better-auth.session_token=signed" },
      })
    ).resolves.toBe("interactive_session");
    // A CLI sends its token as Bearer.
    await expect(
      credentialKind({
        cliCredentialAt: null,
        headers: { authorization: "Bearer session-token" },
      })
    ).resolves.toBe("cli_credential");
    // A session a CLI once held stays a CLI credential, even as a cookie.
    await expect(
      credentialKind({
        cliCredentialAt: 1_700_000_000_000,
        headers: { cookie: "better-auth.session_token=signed" },
      })
    ).resolves.toBe("cli_credential");
  });

  it("re-reads the credential kind without the cookie cache for sensitive operations", async () => {
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);
    authMock.api.getSession.mockResolvedValueOnce({
      session: { id: "session-123", cliCredentialAt: 1_700_000_000_000 },
      user: { id: "user-123", name: "Felix", email: "felix@openmeld.invalid" },
    });
    await expect(
      rpc.resolveRequestCredentialKind({
        headers: { cookie: "better-auth.session_token=signed" },
      })
    ).resolves.toEqual({ credentialKind: "cli_credential" });
    expect(authMock.api.getSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ disableCookieCache: true }),
      })
    );
    authMock.api.getSession.mockResolvedValueOnce(null);
    await expect(
      rpc.resolveRequestCredentialKind({ headers: {} })
    ).resolves.toEqual({ credentialKind: "cli_credential" });
  });

  it("uses a requested Organization only after verifying current-user membership", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-personal",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.ensurePrimaryHumanProfile.mockResolvedValue({
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
      profileKind: "human",
    });
    const first = vi.fn().mockResolvedValue({
      organization_id: "org-amplift",
    });
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveRequestAuth({
        requestedOrganization: {
          organizationSlug: "amplift",
        },
      })
    ).resolves.toEqual({
      ok: true,
      claims: expect.objectContaining({
        activeOrganizationId: "org-amplift",
        organizationContextSource: "request",
      }),
    });
    expect(bind).toHaveBeenCalledWith("user-123", "amplift");
  });

  it("rejects the retired flattened Organization selector before reading a session", async () => {
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveRequestAuth({
        requestedOrganizationId: "org-amplift",
      } as never)
    ).resolves.toEqual({
      code: "bad_request",
      message: "Auth request is invalid.",
      ok: false,
    });
    expect(authMock.api.getSession).not.toHaveBeenCalled();
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it("rejects retired direct Profile selector fields before reading a session", async () => {
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveProfile({
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      } as never)
    ).resolves.toEqual({
      code: "bad_request",
      message: "Auth request is invalid.",
      ok: false,
    });
    expect(authMock.api.getSession).not.toHaveBeenCalled();
    expect(dbMock.query).not.toHaveBeenCalled();
    expect(profileServiceMock.resolveProfileForOwner).not.toHaveBeenCalled();
  });

  it("fails closed when the current user is not a member of the requested Organization", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-personal",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    const first = vi.fn().mockResolvedValue(null);
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveRequestAuth({
        requestedOrganization: {
          organizationSlug: "private-org",
        },
      })
    ).resolves.toEqual({
      ok: false,
      code: "organization.membership_required",
      message: "You do not have access to this organization.",
    });
    expect(profileServiceMock.ensurePrimaryHumanProfile).not.toHaveBeenCalled();
  });

  it("returns 503 when profile list session resolution throws", async () => {
    authMock.api.getSession.mockRejectedValue(
      new Error("session db unavailable")
    );
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "auth.upstream_unreachable",
      message: "auth upstream unavailable",
    });
    expect(authMock.api.getSession).toHaveBeenCalledTimes(1);
    expect(
      profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile
    ).not.toHaveBeenCalled();
  });

  it("wraps account preference session resolution failures in the shared error contract", async () => {
    authMock.api.getSession.mockRejectedValue(
      new Error("session upstream unavailable")
    );
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/account/last-selected-organization", {
        body: JSON.stringify({ organizationId: "org-beta" }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        method: "PATCH",
      }),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(503);
    expect(
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await response.json()
      )
    ).toMatchObject({
      error: {
        code: "upstream_unreachable",
        message: "OpenMeld couldn't reach authentication. Try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("lists profiles through the self-healing default-human bootstrap path", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile.mockResolvedValue(
      [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          profileHandle: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-123",
          createdByUserId: "user-123",
          source: "auth_bootstrap",
          managedRole: null,
          creatorProfileId: null,
          lastUsedAt: null,
          createdAt: new Date("2026-04-19T00:00:00.000Z"),
          updatedAt: new Date("2026-04-19T00:00:00.000Z"),
        },
      ]
    );
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      profiles: [
        expect.objectContaining({
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          isDefault: true,
          managedRole: null,
          profileName: "Felix",
        }),
      ],
    });
    expect(
      profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile
    ).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });
    expect(profileServiceMock.listProfilesForOwner).not.toHaveBeenCalled();
  });

  it("fails closed when the profile list contains an invalid managed role", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile.mockResolvedValue(
      [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          profileHandle: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-123",
          createdByUserId: "user-123",
          source: "auth_bootstrap",
          managedRole: "managed_role",
          creatorProfileId: null,
          lastUsedAt: null,
          createdAt: new Date("2026-04-19T00:00:00.000Z"),
          updatedAt: new Date("2026-04-19T00:00:00.000Z"),
        },
      ]
    );
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "profile.invalid_input",
      message: "managedRole is invalid",
    });
  });

  it("returns 503 when profile create session resolution throws", async () => {
    authMock.api.getSession.mockRejectedValue(
      new Error("session db unavailable")
    );
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: "Ops Bot",
        }),
      }),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "auth.upstream_unreachable",
      message: "auth upstream unavailable",
    });
    expect(profileServiceMock.createAgentProfile).not.toHaveBeenCalled();
  });

  it("creates an Agent Profile in the requested Organization when Session points elsewhere", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "organization-personal",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    const membershipFirst = vi.fn().mockResolvedValue({
      organization_id: "organization-amplift",
    });
    const membershipBind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      membershipBind(...(values ?? []));
      const row = await membershipFirst();
      return nativeQueryResult(row ? [row] : []);
    });
    profileServiceMock.createAgentProfile.mockResolvedValue({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Research Agent",
      profileHandle: "research-agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      source: "manual",
      managedRole: null,
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles/agents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openmeld-requested-organization-id": "organization-amplift",
        },
        body: JSON.stringify({
          idempotencyKey: "agent-profile-create:request-123",
          profileName: "Research Agent",
        }),
      }),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(201);
    expect(membershipBind).toHaveBeenCalledWith(
      "user-123",
      "organization-amplift"
    );
    expect(profileServiceMock.createAgentProfile).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      organizationId: "organization-amplift",
      createdByUserId: "user-123",
      creationActorProfileId: undefined,
      creatorProfileId: undefined,
      idempotencyKey: "agent-profile-create:request-123",
      profileName: "Research Agent",
      source: "web_create",
    });
  });

  it("records bearer-authenticated direct creation as CLI creation", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "organization-amplift",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.createAgentProfile.mockResolvedValue({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Research Agent",
      profileHandle: "research-agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      source: "cli_create",
      managedRole: null,
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: new Date("2026-08-18T00:00:00.000Z"),
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/profiles/agents", {
        method: "POST",
        headers: {
          authorization: "Bearer cli-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          idempotencyKey: "agent-profile-create:request-456",
          profileName: "Research Agent",
        }),
      }),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(201);
    expect(profileServiceMock.createAgentProfile).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      organizationId: "organization-amplift",
      createdByUserId: "user-123",
      creationActorProfileId: undefined,
      creatorProfileId: undefined,
      idempotencyKey: "agent-profile-create:request-456",
      profileName: "Research Agent",
      source: "cli_create",
    });
  });

  it("resolves the session on MemberAgent sub-routes, not only the list route", async () => {
    // Regression: the auth context was mounted only on the exact list path,
    // so a teammate's `/v1/member-agents/:id/profiles` always answered 401.
    authMock.api.getSession.mockResolvedValue({
      session: { id: "session-123", activeOrganizationId: "org-123" },
      user: { id: "user-123", name: "Felix", email: "felix@openmeld.invalid" },
    });
    const rowsFor = (text: string): QueryResultRow[] => {
      if (text.includes('"openmeld"."members"')) {
        return [{ member: 1 }];
      }
      if (text.includes('"openmeld"."member_agents"')) {
        return [
          {
            default_profile_id: "agt-default",
            harness_kind: "codex",
            owner_user_id: "teammate-456",
          },
        ];
      }
      if (text.includes('"openmeld"."openmeld_profiles"')) {
        return [{ profile_id: "agt-default" }];
      }
      return [];
    };
    dbMock.query.mockImplementation((query) =>
      Promise.resolve(nativeQueryResult(rowsFor(query.text)))
    );
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/member-agents/ma-teammate/profiles"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      organizationId: "org-123",
      memberAgentId: "ma-teammate",
      ownerUserId: "teammate-456",
      harnessKind: "codex",
      defaultProfileId: "agt-default",
      profileIds: ["agt-default"],
    });
    expect(authMock.api.getSession).toHaveBeenCalledTimes(1);
  });

  it("still resolves the session on the MemberAgent list route", async () => {
    authMock.api.getSession.mockResolvedValue(null);
    const app = createAuthWorkerTestApp();

    const response = await app.fetch(
      new Request("http://local/v1/member-agents"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    expect(authMock.api.getSession).toHaveBeenCalledTimes(1);
  });

  it("does not resolve sessions on non-profile routes", async () => {
    authMock.api.getSession.mockRejectedValue(
      new Error("should not be called")
    );
    authMock.api.setPassword.mockResolvedValue(
      Response.json({
        status: true,
      })
    );
    waitlistServiceMock.joinWaitlist.mockResolvedValue({
      status: "created",
    });
    const app = createAuthWorkerTestApp();

    const healthResponse = await app.fetch(
      new Request("http://local/health"),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );
    expect(healthResponse.status).toBe(200);

    const waitlistResponse = await app.fetch(
      new Request("http://local/v1/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ops@example.com",
        }),
      }),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );
    expect(waitlistResponse.status).toBe(201);

    const setPasswordResponse = await app.fetch(
      new Request("http://local/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          newPassword: "TestPass123!",
        }),
      }),
      TEST_ENV,
      TEST_EXECUTION_CONTEXT
    );
    expect(setPasswordResponse.status).toBe(200);
    expect(authMock.api.setPassword).toHaveBeenCalledTimes(1);
    expect(authMock.api.getSession).not.toHaveBeenCalled();
  });

  it("preserves HTTPException responses in app.onError", async () => {
    const app = createHonoApp();
    app.get("/__tests/http-exception", () => {
      throw new HTTPException(418, {
        message: "teapot",
      });
    });

    const response = await withPostgresRequest(
      TEST_ENV.OPENMELD_POSTGRESQL,
      () =>
        app.fetch(
          new Request("http://local/__tests/http-exception"),
          TEST_ENV,
          TEST_EXECUTION_CONTEXT
        )
    );

    expect(response.status).toBe(418);
    await expect(response.text()).resolves.toContain("teapot");
  });

  it("returns auth.upstream_unreachable for profile RPC methods when session resolution throws", async () => {
    authMock.api.getSession.mockRejectedValue(
      new Error("session db unavailable")
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.listProfiles()).resolves.toEqual({
      ok: false,
      code: "auth.upstream_unreachable",
      message: "auth upstream unavailable",
    });
    await expect(
      rpc.resolveProfile({ openMeldProfileId: "agt_123" })
    ).resolves.toEqual({
      ok: false,
      code: "auth.upstream_unreachable",
      message: "auth upstream unavailable",
    });
    expect(
      profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile
    ).not.toHaveBeenCalled();
    expect(profileServiceMock.listProfilesForOwner).not.toHaveBeenCalled();
    expect(profileServiceMock.resolveProfileForOwner).not.toHaveBeenCalled();
  });

  it("returns auth.unauthenticated for rpc methods when the cached session user is missing from the local auth db", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: { id: "session-123" },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    localAuthUserStoreMock.hasUserById.mockResolvedValue(false);
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.listProfiles()).resolves.toEqual({
      ok: false,
      code: "auth.unauthenticated",
      message: "authentication required",
    });
    await expect(rpc.resolveRequestAuth()).resolves.toEqual({
      ok: true,
      claims: expect.objectContaining({
        authenticated: false,
        authMethod: "session",
        ownerIds: [],
      }),
    });
    expect(profileServiceMock.ensurePrimaryHumanProfile).not.toHaveBeenCalled();
    expect(
      profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile
    ).not.toHaveBeenCalled();
  });

  it("lists profiles through the self-healing default-human bootstrap path in auth rpc", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile.mockResolvedValue(
      [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          profileHandle: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-123",
          createdByUserId: "user-123",
          source: "auth_bootstrap",
          managedRole: null,
          creatorProfileId: null,
          lastUsedAt: null,
          createdAt: new Date("2026-04-19T00:00:00.000Z"),
          updatedAt: new Date("2026-04-19T00:00:00.000Z"),
        },
      ]
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.listProfiles()).resolves.toEqual({
      ok: true,
      profiles: [
        expect.objectContaining({
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          isDefault: true,
          managedRole: null,
          profileName: "Felix",
        }),
      ],
    });
    expect(
      profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile
    ).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      userName: "Felix",
      userEmail: "felix@openmeld.invalid",
    });
    expect(profileServiceMock.listProfilesForOwner).not.toHaveBeenCalled();
  });

  it("fails closed when auth rpc profile list contains an invalid managed role", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile.mockResolvedValue(
      [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Felix",
          profileHandle: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-123",
          createdByUserId: "user-123",
          source: "auth_bootstrap",
          managedRole: "managed_role",
          creatorProfileId: null,
          lastUsedAt: null,
          createdAt: new Date("2026-04-19T00:00:00.000Z"),
          updatedAt: new Date("2026-04-19T00:00:00.000Z"),
        },
      ]
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.listProfiles()).resolves.toEqual({
      ok: false,
      code: "profile.invalid_input",
      message: "managedRole is invalid",
    });
  });

  it("creates agent profiles without Auth-owned execution Binding storage", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.createAgentProfile.mockResolvedValue({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Research Agent",
      profileHandle: "research-agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      source: "cli_create",
      managedRole: null,
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:00:00.000Z"),
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.createAgentProfile({
        profileName: "Research Agent",
      })
    ).resolves.toEqual({
      ok: true,
      profile: expect.objectContaining({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Research Agent",
      }),
    });
    expect(profileServiceMock.createAgentProfile).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      creationActorProfileId: null,
      creatorProfileId: null,
      organizationId: "org-123",
      profileName: "Research Agent",
      source: "cli_create",
    });
  });

  it("preserves the disabled additional Human Profile capability through RPC", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.createHumanProfile.mockRejectedValue(
      new AdditionalHumanProfileCreationDisabledError()
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.createHumanProfile({ profileName: "Secondary Human" })
    ).resolves.toEqual({
      code: "profile.additional_human_profile_creation_disabled",
      message:
        "Creating additional profiles for people is currently unavailable. Use your default profile, or create an Agent.",
      ok: false,
      status: 409,
    });
  });

  it("creates agent profiles through explicit organization context for Core service calls", async () => {
    profileServiceMock.createAgentProfile.mockResolvedValue({
      profileId: "agt_33333333-3333-4333-8333-333333333333",
      profileName: "Release Agent",
      profileHandle: "release-agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      source: "cli_create",
      managedRole: null,
      creatorProfileId: "agt_11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:00:00.000Z"),
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.createAgentProfileInOrganization({
        createdByUserId: "user-123",
        creationActorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        creatorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        organizationId: "org-123",
        ownerUserId: "user-123",
        profileName: "Release Agent",
        source: "center_agent_create",
      })
    ).resolves.toEqual({
      ok: true,
      profile: expect.objectContaining({
        profileName: "Release Agent",
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
      }),
    });
    expect(authMock.api.getSession).not.toHaveBeenCalled();
    expect(profileServiceMock.createAgentProfile).toHaveBeenCalledWith({
      createdByUserId: "user-123",
      creationActorProfileId: "agt_11111111-1111-4111-8111-111111111111",
      creatorProfileId: "agt_11111111-1111-4111-8111-111111111111",
      organizationId: "org-123",
      ownerUserId: "user-123",
      profileName: "Release Agent",
      source: "center_agent_create",
    });
  });

  it("ensures managed assistant profiles through an explicit managed role", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
        activeOrganizationId: "org-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.ensureManagedAgentProfile.mockResolvedValue({
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileName: "Felix's Welcoming Assistant",
      profileHandle: "felix-s-openmeld-assistant",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      source: "auth_bootstrap",
      managedRole: "openmeld_assistant",
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:00:00.000Z"),
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.ensureManagedAgentProfile({
        managedRole: "openmeld_assistant",
        profileName: "Felix's Welcoming Assistant",
      })
    ).resolves.toEqual({
      ok: true,
      profile: expect.objectContaining({
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
        managedRole: "openmeld_assistant",
        profileName: "Felix's Welcoming Assistant",
      }),
    });
    expect(profileServiceMock.ensureManagedAgentProfile).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      creatorProfileId: null,
      organizationId: "org-123",
      managedRole: "openmeld_assistant",
      profileName: "Felix's Welcoming Assistant",
    });
  });

  it("ensures the Center Agent profile with its Organization name", async () => {
    dbMock.query.mockResolvedValue(
      nativeQueryResult([{ name: "OpenMeld Official" }])
    );
    profileServiceMock.ensureManagedAgentProfile.mockResolvedValue({
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileName: "OpenMeld Official Center Agent",
      profileHandle: "openmeld-official-center-agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "owner-123",
      createdByUserId: "owner-123",
      source: "auth_bootstrap",
      managedRole: "center_agent",
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:00:00.000Z"),
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.ensureCenterAgentProfileInOrganization({
        organizationId: "org-123",
        ownerUserId: "owner-123",
      })
    ).resolves.toEqual({
      ok: true,
      profile: expect.objectContaining({
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
        managedRole: "center_agent",
        profileName: "OpenMeld Official Center Agent",
      }),
    });
    expect(authMock.api.getSession).not.toHaveBeenCalled();
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('FROM "openmeld"."organizations"'),
      })
    );
    expect(profileServiceMock.ensureManagedAgentProfile).toHaveBeenCalledWith({
      createdByUserId: null,
      creatorProfileId: null,
      organizationId: "org-123",
      managedRole: "center_agent",
      profileName: "OpenMeld Official Center Agent",
    });
  });

  it("returns an organization name only when the user is a member", async () => {
    const first = vi.fn().mockResolvedValue({
      organization_id: "org-previous",
      organization_name: "Previous Org",
      role: "member",
    });
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationMembership({
        organizationId: "org-previous",
        userId: "user-123",
      })
    ).resolves.toEqual({
      organizationId: "org-previous",
      organizationName: "Previous Org",
      role: "member",
      status: "member",
    });
    expect(bind).toHaveBeenCalledWith("org-previous", "user-123");

    first.mockResolvedValueOnce(null);
    await expect(
      rpc.resolveOrganizationMembership({
        organizationId: "org-secret",
        userId: "user-123",
      })
    ).resolves.toEqual({ status: "not_member" });
  });

  it("owns the strict user display-name projection used across workers", async () => {
    const first = vi.fn().mockResolvedValue({
      email: "owner@example.com",
      id: "user-123",
      name: "Connector owner",
    });
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveUserDisplayName({ userId: "user-123" })
    ).resolves.toEqual({
      displayName: "Connector owner",
      ok: true,
      userId: "user-123",
    });
    expect(bind).toHaveBeenCalledWith("user-123");

    first.mockResolvedValueOnce(null);
    await expect(
      rpc.resolveUserDisplayName({ userId: "missing-user" })
    ).resolves.toEqual({
      code: "auth.user_identity_unavailable",
      message: "User identity is unavailable.",
      ok: false,
    });

    await expect(
      rpc.resolveUserDisplayName({
        ownerUserId: "user-123",
      } as never)
    ).resolves.toEqual({
      code: "bad_request",
      message: "User identity request is invalid.",
      ok: false,
    });
  });

  it("owns the Organization account identity projection across workers", async () => {
    const first = vi.fn().mockResolvedValue({
      human_profile_id: "22222222-2222-4222-8222-222222222222",
      human_profile_name: "Ari Human",
      member_count: 2,
      member_id: "member-123",
      member_role: "owner",
      organization_id: "org-123",
      organization_metadata: JSON.stringify({ personal: true }),
      organization_name: "Ari's Organization",
      organization_slug: "ari",
      user_email: "ari@example.test",
      user_id: "user-123",
      user_name: "Ari",
    });
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationAccountIdentity({
        account: { kind: "user_id", userId: "user-123" },
        organizationId: "org-123",
      })
    ).resolves.toEqual({
      account: {
        defaultHumanProfile: {
          profileId: "22222222-2222-4222-8222-222222222222",
          profileName: "Ari Human",
        },
        displayName: "Ari Human",
        email: "ari@example.test",
        membership: { memberId: "member-123", role: "owner" },
        userId: "user-123",
      },
      ok: true,
      organization: {
        id: "org-123",
        memberCount: 2,
        name: "Ari's Organization",
        personal: true,
        slug: "ari",
      },
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("human_profiles.organization_id IS NULL"),
      })
    );
    expect(bind).toHaveBeenCalledWith("user-123", "org-123");
  });

  it("resolves an Organization account from an account-scoped Human Profile", async () => {
    const first = vi.fn().mockResolvedValue({
      human_profile_id: "22222222-2222-4222-8222-222222222222",
      human_profile_name: "Ari Human",
      member_count: 2,
      member_id: "member-123",
      member_role: "owner",
      organization_id: "org-123",
      organization_metadata: null,
      organization_name: "OpenMeld Labs",
      organization_slug: "openmeld-labs",
      user_email: "ari@example.test",
      user_id: "user-123",
      user_name: "Ari",
    });
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationAccountIdentity({
        account: {
          kind: "human_profile_id",
          profileId: "22222222-2222-4222-8222-222222222222",
        },
        organizationId: "org-123",
      })
    ).resolves.toMatchObject({
      account: {
        membership: { memberId: "member-123" },
        userId: "user-123",
      },
      ok: true,
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "selected_profile.organization_id IS NULL"
        ),
      })
    );
    expect(bind).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "org-123"
    );
  });

  it("does not fall back to a non-default Human Profile", async () => {
    const first = vi.fn().mockResolvedValue({
      human_profile_id: null,
      human_profile_name: null,
      member_count: 1,
      member_id: "member-123",
      member_role: "member",
      organization_id: "org-123",
      organization_metadata: null,
      organization_name: "OpenMeld Labs",
      organization_slug: "openmeld-labs",
      user_email: "ari@example.test",
      user_id: "user-123",
      user_name: "Ari",
    });
    dbMock.query.mockImplementation(async () => {
      const row = await first();
      return nativeQueryResult(row ? [row] : []);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationAccountIdentity({
        account: { email: "ari@example.test", kind: "email" },
        organizationId: "org-123",
      })
    ).resolves.toMatchObject({
      account: {
        defaultHumanProfile: null,
        displayName: "Ari",
        membership: { memberId: "member-123" },
      },
      ok: true,
    });
  });

  it("owns the Organization Directory member projection with account-scoped Human Profiles", async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          human_profile_handle: "ari",
          human_profile_id: "22222222-2222-4222-8222-222222222222",
          human_profile_last_used_at: null,
          human_profile_name: "Ari Human",
          human_profile_status: "active",
          member_created_at: 1_722_643_200_000,
          member_id: "member-123",
          organization_id: "org-123",
          role: "owner",
          user_email: "ari@example.test",
          user_id: "user-123",
          user_image: null,
          user_name: "Ari",
        },
      ],
    });
    const bind = vi.fn();
    dbMock.query.mockImplementation(async ({ values }) => {
      bind(...(values ?? []));
      return nativeQueryResult((await all()).results);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationDirectoryMembers({ organizationId: "org-123" })
    ).resolves.toMatchObject({
      members: [
        {
          humanProfile: {
            profileId: "22222222-2222-4222-8222-222222222222",
          },
          memberId: "member-123",
          user: { name: "Ari" },
          userId: "user-123",
        },
      ],
      ok: true,
      organizationId: "org-123",
    });
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("human_profiles.organization_id IS NULL"),
      })
    );
    expect(bind).toHaveBeenCalledWith("org-123");
  });

  it("fails the member projection when Auth reads a partial Human Profile", async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        {
          human_profile_handle: "ari",
          human_profile_id: null,
          human_profile_last_used_at: null,
          human_profile_name: "Ari Human",
          human_profile_status: "active",
          member_created_at: 1_722_643_200_000,
          member_id: "member-123",
          organization_id: "org-123",
          role: "owner",
          user_email: "ari@example.test",
          user_id: "user-123",
          user_image: null,
          user_name: "Ari",
        },
      ],
    });
    dbMock.query.mockImplementation(async () =>
      nativeQueryResult((await all()).results)
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationDirectoryMembers({ organizationId: "org-123" })
    ).resolves.toMatchObject({
      code: "auth.organization_directory_unavailable",
      ok: false,
    });
  });

  it("separates Organization Agent Profiles from Core-requested additional identities", async () => {
    const organizationProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const additionalProfileId = "agt_22222222-2222-4222-8222-222222222222";
    const organizationAll = vi.fn().mockResolvedValue({
      results: [directoryAgentProfileRow(organizationProfileId, "org-123")],
    });
    const additionalAll = vi.fn().mockResolvedValue({
      results: [directoryAgentProfileRow(additionalProfileId, "org-personal")],
    });
    const organizationBind = vi.fn();
    const additionalBind = vi.fn();
    dbMock.query.mockImplementation(async ({ text, values }) => {
      const additional = text.includes("profiles.organization_id <> $1");
      (additional ? additionalBind : organizationBind)(...(values ?? []));
      return nativeQueryResult(
        (await (additional ? additionalAll : organizationAll)()).results
      );
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationDirectoryAgentProfiles({
        additionalAgentProfileIds: [additionalProfileId],
        organizationId: "org-123",
      })
    ).resolves.toMatchObject({
      additionalAgentProfiles: [{ profileId: additionalProfileId }],
      ok: true,
      organizationAgentProfiles: [{ profileId: organizationProfileId }],
      organizationId: "org-123",
    });
    expect(organizationBind).toHaveBeenCalledWith("org-123");
    expect(additionalBind).toHaveBeenCalledWith(
      "org-123",
      JSON.stringify([additionalProfileId])
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "FROM jsonb_array_elements_text($2::jsonb)"
        ),
      })
    );
  });

  it("uses one JSON parameter for more than 100 additional Agent Profile ids", async () => {
    const additionalAgentProfileIds = Array.from(
      { length: 101 },
      (_, index) =>
        `agt_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    );
    const organizationBind = vi.fn();
    const additionalBind = vi.fn();
    dbMock.query.mockImplementation(async ({ text, values }) => {
      (text.includes("jsonb_array_elements_text($2::jsonb)")
        ? additionalBind
        : organizationBind)(...(values ?? []));
      return await nativeQueryResult([]);
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveOrganizationDirectoryAgentProfiles({
        additionalAgentProfileIds,
        organizationId: "org-123",
      })
    ).resolves.toMatchObject({ ok: true });
    expect(additionalBind).toHaveBeenCalledWith(
      "org-123",
      JSON.stringify(additionalAgentProfileIds)
    );
  });

  it("updates profile metadata without Auth-owned execution Binding storage", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.updateProfileForOwner.mockResolvedValue({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Research Agent",
      profileHandle: "research-agent",
      profileKind: "agent",
      isDefault: false,
      status: "active",
      ownerUserId: "user-123",
      createdByUserId: "user-123",
      source: "cli_create",
      creatorProfileId: null,
      lastUsedAt: null,
      createdAt: new Date("2026-04-19T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T00:00:00.000Z"),
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.updateProfile({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Research Agent",
      })
    ).resolves.toEqual({
      ok: true,
      profile: expect.objectContaining({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Research Agent",
      }),
    });
    expect(profileServiceMock.updateProfileForOwner).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Research Agent",
    });
  });

  it("updates and clears an ordinary Agent Profile Default Project for Core", async () => {
    profileServiceMock.updateAgentProfileDefaultProjectForOwner
      .mockResolvedValueOnce({
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Research Agent",
        profileHandle: "research-agent",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        organizationId: "org-123",
        ownerUserId: "user-123",
        createdByUserId: "user-123",
        source: "cli_create",
        managedRole: null,
        defaultProjectId: "project-alpha",
        creatorProfileId: null,
        lastUsedAt: null,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Research Agent",
        profileHandle: "research-agent",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        organizationId: "org-123",
        ownerUserId: "user-123",
        createdByUserId: "user-123",
        source: "cli_create",
        managedRole: null,
        defaultProjectId: null,
        creatorProfileId: null,
        lastUsedAt: null,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
        updatedAt: new Date("2026-07-14T00:00:01.000Z"),
      });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.updateAgentProfileDefaultProjectInOrganization({
        defaultProjectId: "project-alpha",
        organizationId: "org-123",
        ownerUserId: "user-123",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).resolves.toMatchObject({
      ok: true,
      profile: { defaultProjectId: "project-alpha" },
    });
    await expect(
      rpc.updateAgentProfileDefaultProjectInOrganization({
        defaultProjectId: null,
        organizationId: "org-123",
        ownerUserId: "user-123",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).resolves.toMatchObject({
      ok: true,
      profile: { defaultProjectId: null },
    });
  });

  it("lists profiles without Auth-owned execution Binding projection", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session-123",
      },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
      },
    });
    profileServiceMock.listProfilesForOwnerEnsuringPrimaryHumanProfile.mockResolvedValue(
      [
        {
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileName: "Research Agent",
          profileHandle: "research-agent",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-123",
          createdByUserId: "user-123",
          source: "cli_create",
          creatorProfileId: "11111111-1111-4111-8111-111111111111",
          lastUsedAt: null,
          createdAt: new Date("2026-04-19T00:00:00.000Z"),
          updatedAt: new Date("2026-04-19T00:00:00.000Z"),
        },
      ]
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.listProfiles()).resolves.toEqual({
      ok: true,
      profiles: [
        expect.objectContaining({
          openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
          profileKind: "agent",
          profileName: "Research Agent",
        }),
      ],
    });
  });

  it("resolves profile identity by id for Core-owned readiness and dispatch", async () => {
    profileServiceMock.resolveProfileById.mockResolvedValue({
      profileKind: "agent",
      profileHandle: "research-agent",
      profileName: "Research Agent",
      ownerUserId: "user-123",
      organizationId: "org-123",
      status: "active",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveProfileById({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).resolves.toEqual({
      ok: true,
      profile: {
        defaultProjectId: null,
        organizationId: "org-123",
        ownerUserId: "user-123",
        profileHandle: "research-agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Research Agent",
        status: "active",
        managedRole: null,
      },
    });
  });

  it("keeps inactive profiles visible as identity but not executable truth", async () => {
    profileServiceMock.resolveProfileById.mockResolvedValue({
      profileKind: "agent",
      profileHandle: "research-agent",
      profileName: "Research Agent",
      ownerUserId: "user-123",
      organizationId: "org-123",
      status: "disabled",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveProfileById({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).resolves.toEqual({
      ok: true,
      profile: {
        defaultProjectId: null,
        organizationId: "org-123",
        ownerUserId: "user-123",
        profileHandle: "research-agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Research Agent",
        status: "disabled",
        managedRole: null,
      },
    });
  });

  it("returns a structured profile identity error when the profile id is missing", async () => {
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.resolveProfileById({})).resolves.toEqual({
      ok: false,
      code: "profile.invalid",
      message: "openMeldProfileId is required",
    });
    expect(profileServiceMock.resolveProfileById).not.toHaveBeenCalled();
  });

  it("returns a structured profile identity error when profile lookup fails", async () => {
    profileServiceMock.resolveProfileById.mockRejectedValue(
      new Error("profile repository unavailable")
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.resolveProfileById({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      })
    ).resolves.toEqual({
      ok: false,
      code: "profile.internal_error",
      message: "internal error",
    });
  });

  it("keeps resolveRequestAuth upstream failure semantics", async () => {
    authMock.api.getSession.mockRejectedValue(
      new Error("session db unavailable")
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.resolveRequestAuth()).resolves.toEqual({
      ok: false,
      code: "auth.upstream_unreachable",
      message: "auth upstream unavailable",
    });
    expect(profileServiceMock.ensurePrimaryHumanProfile).not.toHaveBeenCalled();
  });

  it("does not relabel primary profile bootstrap failures as auth upstream outages", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: {
        id: "session_123",
      },
      user: {
        id: "user_123",
        name: "Felix",
        email: "felix@example.com",
      },
    });
    profileServiceMock.ensurePrimaryHumanProfile.mockRejectedValue(
      new Error("profile repository unavailable")
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(rpc.resolveRequestAuth()).resolves.toEqual({
      ok: false,
      code: "profile.internal_error",
      message: "internal error",
    });
  });

  describe("combined request auth and Profile resolution", () => {
    const PRIMARY_PROFILE = {
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Felix",
      profileHandle: "felix",
      profileKind: "human",
      ownerUserId: "user-123",
    };
    const AGENT_PROFILE = {
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileName: "Builder",
      profileHandle: "builder",
      profileKind: "agent",
      ownerUserId: "user-123",
    };
    const SESSION = {
      session: { id: "session-123", activeOrganizationId: "org-personal" },
      user: {
        id: "user-123",
        name: "Felix",
        email: "felix@openmeld.invalid",
        image: "https://images.openmeld.invalid/felix.png",
      },
    };
    const MEMBERSHIP_SELECTOR = {
      requestedOrganization: { organizationSlug: "amplift" },
    };

    function mockMembership(organizationId: string | null) {
      const bind = vi.fn();
      dbMock.query.mockImplementation(({ values }) => {
        bind(...(values ?? []));
        return Promise.resolve(
          nativeQueryResult(
            organizationId ? [{ organization_id: organizationId }] : []
          )
        );
      });
      return bind;
    }

    it("verifies the session, user, and Organization once and reads both Profiles together", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      const membershipBind = mockMembership("org-amplift");
      profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockResolvedValue(
        {
          primaryHumanProfile: PRIMARY_PROFILE,
          requestedProfile: { ok: true, profile: AGENT_PROFILE },
        }
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      const result = await rpc.resolveRequestAuthWithProfile({
        ...MEMBERSHIP_SELECTOR,
        requestId: "request-1",
        openMeldProfileId: AGENT_PROFILE.profileId,
        profileKind: "agent",
      });

      expect(result).toEqual({
        ok: true,
        claims: expect.objectContaining({
          authenticated: true,
          requestId: "request-1",
          callerPrincipalId: "user-123",
          profileId: PRIMARY_PROFILE.profileId,
          profileKind: "human",
          activeOrganizationId: "org-amplift",
          organizationContextSource: "request",
        }),
        profile: {
          ok: true,
          resolvedProfile: expect.objectContaining({
            openMeldProfileId: AGENT_PROFILE.profileId,
            profileKind: "agent",
            ownerUserId: "user-123",
            ownerName: "Felix",
          }),
        },
      });
      expect(authMock.api.getSession).toHaveBeenCalledTimes(1);
      expect(localAuthUserStoreMock.hasUserById).toHaveBeenCalledTimes(1);
      expect(dbMock.query).toHaveBeenCalledTimes(1);
      expect(membershipBind).toHaveBeenCalledWith("user-123", "amplift");
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).toHaveBeenCalledTimes(1);
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).toHaveBeenCalledWith({
        userId: "user-123",
        userName: "Felix",
        userEmail: "felix@openmeld.invalid",
        profileId: AGENT_PROFILE.profileId,
        profileKind: "agent",
      });
      expect(
        profileServiceMock.ensurePrimaryHumanProfile
      ).not.toHaveBeenCalled();
      expect(profileServiceMock.resolveProfileForOwner).not.toHaveBeenCalled();
    });

    it("matches resolveRequestAuth followed by resolveProfile", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      profileServiceMock.ensurePrimaryHumanProfile.mockResolvedValue(
        PRIMARY_PROFILE
      );
      profileServiceMock.resolveProfileForOwner.mockResolvedValue(
        AGENT_PROFILE
      );
      profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockResolvedValue(
        {
          primaryHumanProfile: PRIMARY_PROFILE,
          requestedProfile: { ok: true, profile: AGENT_PROFILE },
        }
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);
      const input = {
        requestId: "request-2",
        openMeldProfileId: AGENT_PROFILE.profileId,
      };

      const combined = await rpc.resolveRequestAuthWithProfile(input);
      const auth = await rpc.resolveRequestAuth({ requestId: "request-2" });
      const profile = await rpc.resolveProfile(input);

      expect(combined).toEqual({ ...auth, profile });
    });

    it("uses the primary Human Profile when no Profile is requested", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockResolvedValue(
        {
          primaryHumanProfile: PRIMARY_PROFILE,
          requestedProfile: { ok: true, profile: PRIMARY_PROFILE },
        }
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      const result = await rpc.resolveRequestAuthWithProfile();

      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: null, profileKind: null })
      );
      expect(result).toMatchObject({
        ok: true,
        profile: {
          ok: true,
          resolvedProfile: {
            openMeldProfileId: PRIMARY_PROFILE.profileId,
            avatarUrl: "https://images.openmeld.invalid/felix.png",
          },
        },
      });
    });

    it("returns unauthenticated claims without a Profile when there is no session", async () => {
      authMock.api.getSession.mockResolvedValue(null);
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      const result = await rpc.resolveRequestAuthWithProfile({
        openMeldProfileId: AGENT_PROFILE.profileId,
      });

      expect(result).toEqual({
        ok: true,
        claims: expect.objectContaining({ authenticated: false }),
      });
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).not.toHaveBeenCalled();
    });

    it("returns unauthenticated claims for a deleted local user", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      localAuthUserStoreMock.hasUserById.mockResolvedValue(false);
      const membershipBind = mockMembership("org-amplift");
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      const result = await rpc.resolveRequestAuthWithProfile({
        ...MEMBERSHIP_SELECTOR,
        openMeldProfileId: AGENT_PROFILE.profileId,
      });

      expect(result).toEqual({
        ok: true,
        claims: expect.objectContaining({ authenticated: false }),
      });
      expect(membershipBind).not.toHaveBeenCalled();
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).not.toHaveBeenCalled();
    });

    it("fails closed when the local user check fails", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      localAuthUserStoreMock.hasUserById.mockRejectedValue(
        new Error("local auth db unavailable")
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      await expect(rpc.resolveRequestAuthWithProfile()).resolves.toEqual({
        ok: false,
        code: "auth.internal_error",
        message: "internal error",
      });
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).not.toHaveBeenCalled();
    });

    it("keeps session upstream failures ahead of every database read", async () => {
      authMock.api.getSession.mockRejectedValue(
        new Error("session db unavailable")
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      await expect(
        rpc.resolveRequestAuthWithProfile(MEMBERSHIP_SELECTOR)
      ).resolves.toEqual({
        ok: false,
        code: "auth.upstream_unreachable",
        message: "auth upstream unavailable",
      });
      expect(localAuthUserStoreMock.hasUserById).not.toHaveBeenCalled();
      expect(dbMock.query).not.toHaveBeenCalled();
    });

    it("fails closed when the user is not a member of the requested Organization", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      mockMembership(null);
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      await expect(
        rpc.resolveRequestAuthWithProfile({
          ...MEMBERSHIP_SELECTOR,
          openMeldProfileId: AGENT_PROFILE.profileId,
        })
      ).resolves.toEqual({
        ok: false,
        code: "organization.membership_required",
        message: "You do not have access to this organization.",
      });
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).not.toHaveBeenCalled();
    });

    it("fails closed when the Organization membership read fails", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      dbMock.query.mockRejectedValue(new Error("membership read failed"));
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      await expect(
        rpc.resolveRequestAuthWithProfile(MEMBERSHIP_SELECTOR)
      ).resolves.toEqual({
        ok: false,
        code: "auth.internal_error",
        message: "internal error",
      });
      expect(
        profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner
      ).not.toHaveBeenCalled();
    });

    it("fails the request when the primary Human Profile fails", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockRejectedValue(
        new Error("profile repository unavailable")
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      await expect(
        rpc.resolveRequestAuthWithProfile({
          openMeldProfileId: AGENT_PROFILE.profileId,
        })
      ).resolves.toEqual({
        ok: false,
        code: "profile.internal_error",
        message: "internal error",
      });
    });

    it("returns a requested Profile rejection beside verified claims", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockResolvedValue(
        {
          primaryHumanProfile: PRIMARY_PROFILE,
          requestedProfile: { ok: false, error: new ProfileNotFoundError() },
        }
      );
      profileServiceMock.resolveProfileForOwner.mockRejectedValue(
        new ProfileNotFoundError()
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);
      const input = {
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
      };

      const result = await rpc.resolveRequestAuthWithProfile(input);

      expect(result).toMatchObject({
        ok: true,
        claims: { authenticated: true, profileId: PRIMARY_PROFILE.profileId },
        profile: { ok: false },
      });
      expect(result.ok && result.profile).toEqual(
        await rpc.resolveProfile(input)
      );
    });

    it("reports a requested Profile projection failure as a Profile rejection", async () => {
      authMock.api.getSession.mockResolvedValue(SESSION);
      profileServiceMock.resolvePrimaryHumanAndRequestedProfileForOwner.mockResolvedValue(
        {
          primaryHumanProfile: PRIMARY_PROFILE,
          requestedProfile: {
            ok: true,
            profile: { ...AGENT_PROFILE, ownerUserId: null },
          },
        }
      );
      const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

      const result = await rpc.resolveRequestAuthWithProfile({
        openMeldProfileId: AGENT_PROFILE.profileId,
      });

      expect(result).toMatchObject({
        ok: true,
        claims: { authenticated: true },
        profile: { ok: false },
      });
    });
  });

  it("filters tombstone queries to spaces accessible to the current owner", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: { id: "session_123" },
      user: {
        id: "user_123",
        name: "Felix",
        email: "felix@example.com",
      },
    });
    profileServiceMock.resolveProfileForOwner.mockResolvedValue({
      profileId: "profileIdentity-001",
    });
    profileServiceMock.listOwnerAccessibleSpaceIds.mockResolvedValue([
      "space-a",
    ]);
    profileServiceMock.querySpaceDeletionTombstones.mockResolvedValue([
      {
        gatewayHost: "localhost:8080",
        spaceId: "space-a",
        spaceName: "Alpha",
        creatorProfileId: "creator-1",
        creatorKind: "human",
        deletedByProfileId: "profileIdentity-001",
        deletedByProfileName: "Felix",
        deletedByOwnerUserId: "user_123",
        deletedAt: new Date("2026-03-12T00:00:00.000Z"),
        createdAt: new Date("2026-03-12T00:00:00.000Z"),
        updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      },
    ]);
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.querySpaceDeletionTombstones({
        openMeldProfileId: "profileIdentity-001",
        gatewayHost: "localhost:8080",
        spaceIds: ["space-a", "space-b"],
      })
    ).resolves.toEqual({
      ok: true,
      items: [
        {
          gatewayHost: "localhost:8080",
          spaceId: "space-a",
          spaceName: "Alpha",
          creatorProfileId: "creator-1",
          creatorKind: "human",
          deletedByProfileId: "profileIdentity-001",
          deletedByProfileName: "Felix",
          deletedByOwnerUserId: "user_123",
          deletedAt: "2026-03-12T00:00:00.000Z",
          createdAt: "2026-03-12T00:00:00.000Z",
          updatedAt: "2026-03-12T00:00:00.000Z",
        },
      ],
    });
    expect(profileServiceMock.listOwnerAccessibleSpaceIds).toHaveBeenCalledWith(
      {
        ownerUserId: "user_123",
        gatewayHost: "localhost:8080",
        spaceIds: ["space-a", "space-b"],
      }
    );
    expect(
      profileServiceMock.querySpaceDeletionTombstones
    ).toHaveBeenCalledWith({
      gatewayHost: "localhost:8080",
      spaceIds: ["space-a"],
    });
  });

  it("returns a structured rpc error when profile lineage listing throws", async () => {
    profileServiceMock.listResolvedProfileLineageForOwner.mockRejectedValue(
      new Error("lineage repository unavailable")
    );
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.listProfileLineage({
        ownerUserId: "user_123",
      })
    ).resolves.toEqual({
      ok: false,
      code: "profile.list_lineage_failed",
      message: "lineage repository unavailable",
    });
  });

  it("rejects tombstone upsert when the current owner has no relation to the space", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: { id: "session_123" },
      user: {
        id: "user_123",
        name: "Felix",
        email: "felix@example.com",
      },
    });
    profileServiceMock.resolveProfileForOwner.mockResolvedValue({
      profileId: "profileIdentity-001",
    });
    profileServiceMock.listOwnerAccessibleSpaceIds.mockResolvedValue([]);
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.upsertSpaceDeletionTombstone({
        openMeldProfileId: "profileIdentity-001",
        gatewayHost: "localhost:8080",
        spaceId: "space-foreign",
      })
    ).resolves.toEqual({
      ok: false,
      code: "profile.not_found",
      message: "space not found",
    });
    expect(profileServiceMock.listOwnerAccessibleSpaceIds).toHaveBeenCalledWith(
      {
        ownerUserId: "user_123",
        gatewayHost: "localhost:8080",
        spaceIds: ["space-foreign"],
      }
    );
    expect(
      profileServiceMock.upsertSpaceDeletionTombstone
    ).not.toHaveBeenCalled();
  });

  it("allows tombstone upsert for the current deleter profile without history access", async () => {
    authMock.api.getSession.mockResolvedValue({
      session: { id: "session_123" },
      user: {
        id: "user_123",
        name: "Felix",
        email: "felix@example.com",
      },
    });
    profileServiceMock.resolveProfileForOwner.mockResolvedValue({
      profileId: "profileIdentity-001",
    });
    profileServiceMock.upsertSpaceDeletionTombstone.mockResolvedValue({
      gatewayHost: "localhost:8080",
      spaceId: "space-owned",
      spaceName: "Ops Room",
      creatorProfileId: "profileIdentity-001",
      creatorKind: "human",
      deletedByProfileId: "profileIdentity-001",
      deletedByProfileName: "Felix",
      deletedByOwnerUserId: "user_123",
      deletedAt: new Date("2026-03-12T00:00:00.000Z"),
      createdAt: new Date("2026-03-12T00:00:00.000Z"),
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
    });
    const rpc = new AuthRpcEntrypoint(TEST_EXECUTION_CONTEXT, TEST_ENV);

    await expect(
      rpc.upsertSpaceDeletionTombstone({
        openMeldProfileId: "profileIdentity-001",
        gatewayHost: "localhost:8080",
        spaceId: "space-owned",
        spaceName: "Ops Room",
        deletedByProfileId: "profileIdentity-001",
        deletedByProfileName: "Felix",
        deletedByOwnerUserId: "user_123",
      })
    ).resolves.toMatchObject({
      ok: true,
      item: {
        spaceId: "space-owned",
        deletedByProfileId: "profileIdentity-001",
        deletedByOwnerUserId: "user_123",
      },
    });
    expect(
      profileServiceMock.listOwnerAccessibleSpaceIds
    ).not.toHaveBeenCalled();
    expect(
      profileServiceMock.upsertSpaceDeletionTombstone
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-owned",
        deletedByProfileId: "profileIdentity-001",
        deletedByOwnerUserId: "user_123",
      })
    );
  });
});

function directoryAgentProfileRow(profileId: string, organizationId: string) {
  return {
    created_at: 1_722_643_200_000,
    created_by_user_id: "user-123",
    creator_profile_id: null,
    last_used_at: null,
    managed_role: null,
    organization_id: organizationId,
    owner_name: "Ari",
    owner_user_id: "user-123",
    profile_handle: "codex",
    profile_id: profileId,
    profile_name: "Codex",
    source: "cli_create",
    status: "active",
    updated_at: 1_722_643_200_000,
  };
}
