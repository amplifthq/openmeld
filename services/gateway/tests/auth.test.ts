import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const REJECTION_LOG_TAG = "[gateway.auth.rejected]";

const UNAUTHENTICATED_CLAIMS = {
  authenticated: false,
  requestId: "req-unauth",
  ownerIds: [],
  authMethod: "none",
};

function createAuthWorkerMock(
  resolveRequestAuthWithProfile: () => Promise<unknown>
) {
  return {
    ping: vi.fn(async () => ({ ok: true })),
    resolveRequestAuthWithProfile: vi.fn(resolveRequestAuthWithProfile),
    // Not reached on the rejection paths under test because the combined RPC
    // above always resolves; kept so the mock matches the auth RPC surface.
    resolveRequestAuth: vi.fn(async () => ({
      ok: false,
      code: "auth.unauthenticated",
      message: "authentication required",
    })),
    resolveProfile: vi.fn(async () => ({
      ok: false,
      code: "profile.not_found",
    })),
  };
}

function buildEnv(authWorker: ReturnType<typeof createAuthWorkerMock>) {
  return {
    OPENMELD_CORE_WORKER: { fetch: vi.fn() },
    OPENMELD_AUTH_WORKER: authWorker,
    OPENMELD_SPACE_PASSWORD_RATE_LIMITER: {
      limit: vi.fn(async () => ({ success: true })),
    },
  } as unknown as CloudflareBindings;
}

function findRejectionLog(
  calls: readonly (readonly unknown[])[]
): Record<string, unknown> | undefined {
  const call = calls.find((args) => args[0] === REJECTION_LOG_TAG);
  return call?.[1] as Record<string, unknown> | undefined;
}

describe("gateway auth rejection logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("logs authorizationPresent=false and strips the query string when the client sends no credentials", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const env = buildEnv(
      createAuthWorkerMock(async () => ({
        ok: true,
        claims: UNAUTHENTICATED_CLAIMS,
      }))
    );

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream?token=secret-value&foo=bar"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    const logged = findRejectionLog(warnSpy.mock.calls);
    expect(logged).toMatchObject({
      authorizationPresent: false,
      code: "auth.unauthenticated",
      cookiePresent: false,
      method: "GET",
      requestId: "req-unauth",
      route: "/v1/daemon/stream",
      status: 401,
    });
    // Query params can carry secrets, so they must never reach the log line.
    expect(JSON.stringify(logged)).not.toContain("secret-value");
    expect(typeof logged?.isolateRejectionCount).toBe("number");
  });

  it("logs authorizationPresent=true without leaking the token when an Authorization header is present", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const env = buildEnv(
      createAuthWorkerMock(async () => ({
        ok: true,
        claims: UNAUTHENTICATED_CLAIMS,
      }))
    );

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Authorization: "Bearer expired-token-value" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    const logged = findRejectionLog(warnSpy.mock.calls);
    expect(logged).toMatchObject({
      authorizationPresent: true,
      code: "auth.unauthenticated",
      cookiePresent: false,
      status: 401,
    });
    // Presence boolean only: the header value must never be logged.
    expect(JSON.stringify(logged)).not.toContain("expired-token-value");
  });

  it("logs cookiePresent=true without leaking the cookie when only a cookie header is present", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const env = buildEnv(
      createAuthWorkerMock(async () => ({
        ok: true,
        claims: UNAUTHENTICATED_CLAIMS,
      }))
    );

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Cookie: "openmeld_session=cookie-secret" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    const logged = findRejectionLog(warnSpy.mock.calls);
    expect(logged).toMatchObject({
      authorizationPresent: false,
      cookiePresent: true,
    });
    expect(JSON.stringify(logged)).not.toContain("cookie-secret");
  });

  it("logs a rejection when auth resolution returns a mapped auth error", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const env = buildEnv(
      createAuthWorkerMock(async () => ({
        ok: false,
        code: "auth.unauthenticated",
        message: "authentication required",
      }))
    );

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { "x-openmeld-request-id": "req-maperr" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    const logged = findRejectionLog(warnSpy.mock.calls);
    expect(logged).toMatchObject({
      authorizationPresent: false,
      code: "auth.unauthenticated",
      method: "GET",
      requestId: "req-maperr",
      route: "/v1/daemon/stream",
      status: 401,
    });
  });

  it("does not log a rejection when authentication succeeds", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const env = buildEnv(
      createAuthWorkerMock(async () => ({
        ok: true,
        claims: {
          authenticated: true,
          requestId: "req-ok",
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          ownerIds: ["owner-001"],
          authMethod: "session",
        },
        profile: {
          ok: true,
          resolvedProfile: {
            openMeldProfileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Mira",
            profileKind: "human",
            ownerUserId: "owner-001",
          },
        },
      }))
    );

    await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Authorization: "Bearer valid-token" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(findRejectionLog(warnSpy.mock.calls)).toBeUndefined();
  });

  it("fails closed when Auth does not confirm the requested Organization selector", async () => {
    const authWorker = createAuthWorkerMock(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-unverified-org",
        activeOrganizationId: "org-personal",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        ownerIds: [],
        authMethod: "session",
      },
    }));
    const env = buildEnv(authWorker);

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: {
          cookie: "openmeld_session=session-1",
          "x-openmeld-requested-organization-slug": "amplift",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "organization.context_unavailable",
        message: "OpenMeld could not verify this organization.",
      },
      ok: false,
    });
    expect(authWorker.resolveRequestAuthWithProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedOrganization: {
          organizationSlug: "amplift",
        },
      })
    );
    expect(env.OPENMELD_CORE_WORKER.fetch).not.toHaveBeenCalled();
  });

  it("rejects two Organization selector headers before calling Auth", async () => {
    const authWorker = createAuthWorkerMock(async () => ({
      ok: true,
      claims: UNAUTHENTICATED_CLAIMS,
    }));
    const env = buildEnv(authWorker);

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: {
          "x-openmeld-requested-organization-id": "org-amplift",
          "x-openmeld-requested-organization-slug": "amplift",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "Choose one Organization selector.",
      },
      ok: false,
    });
    expect(authWorker.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(env.OPENMELD_CORE_WORKER.fetch).not.toHaveBeenCalled();
  });

  it("preserves unauthenticated semantics when a request includes an Organization selector", async () => {
    const authWorker = createAuthWorkerMock(async () => ({
      ok: true,
      claims: UNAUTHENTICATED_CLAIMS,
    }));
    const env = buildEnv(authWorker);

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: {
          "x-openmeld-requested-organization-slug": "amplift",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "auth.unauthenticated",
        message: "authentication required",
      },
      ok: false,
    });
    expect(env.OPENMELD_CORE_WORKER.fetch).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited protected Space password before auth or Core work", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const authWorker = createAuthWorkerMock(async () => ({
      ok: true,
      claims: UNAUTHENTICATED_CLAIMS,
    }));
    const env = buildEnv(authWorker);
    const limit = vi.fn(async () => ({ success: false }));
    env.OPENMELD_SPACE_PASSWORD_RATE_LIMITER = { limit } as RateLimit;
    const spaceId = "a".repeat(64);

    const response = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/status`, {
        headers: {
          "CF-Connecting-IP": "203.0.113.20",
          "x-openmeld-space-password": "incorrect-password",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "space.password_rate_limited",
        message: "Too many password attempts. Try again in a minute.",
      },
      ok: false,
    });
    expect(limit).toHaveBeenCalledWith({
      key: `pw:203.0.113.20:${spaceId}`,
    });
    expect(authWorker.resolveRequestAuthWithProfile).not.toHaveBeenCalled();
    expect(env.OPENMELD_CORE_WORKER.fetch).not.toHaveBeenCalled();
    const log = warnSpy.mock.calls.find(
      (call) => call[0] === "[gateway.space.password_rate_limited]"
    )?.[1] as Record<string, unknown> | undefined;
    expect(log).toMatchObject({
      event: "gateway.space.password_rate_limited",
      rateLimitDimension: "ip_space",
      reasonCode: "space.password_rate_limited",
      spaceId,
    });
    expect(JSON.stringify(log)).not.toContain("incorrect-password");
  });
});
