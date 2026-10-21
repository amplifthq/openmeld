import { createAuthDatabase } from "@openmeld/db/auth";
import { PostgresDatabase, withPostgresRequest } from "@openmeld/db/postgresql";
import {
  accountOrganizationContextSchema,
  accountSessionSchema,
  accountSidebarResponseSchema,
  DESKTOP_APP_ORIGIN,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  selectLastSelectedOrganizationErrorResponseSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBufferedAuthProxyResponse } from "../../../clients/web/src/lib/auth-proxy.server";
import {
  createPostgresHarness,
  installPostgresWriteFailure,
  type PostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
// biome-ignore lint/performance/noNamespaceImport: Observe the real lazy vendor runtime at its request boundary.
import * as lazyRuntime from "../src/lazy-runtime-modules";
import { loadBetterAuthRuntime } from "../src/lazy-runtime-modules";
import type { AuthBindings } from "../src/lib/bindings";
import { createAuthWorkerTestApp } from "./support/auth-worker-entrypoint.test-support";

const USER_EXISTENCE_QUERY_PATTERN =
  /select 1 as present from "openmeld"\."users"/iu;
const USER_EXISTENCE_QUERY_PATTERN_ALTERNATE =
  /SELECT 1 AS present FROM "openmeld"\."users"/iu;

const AUTH_BASE_URL = "http://localhost:8788";
const WEB_APP_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const SET_COOKIE_SEPARATOR_PATTERN = /,(?=\s*[^;,]+=)/;
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

type TestContext = Awaited<ReturnType<typeof createTestContext>>;

const contexts: TestContext[] = [];

vi.mock("../../../clients/web/src/env", () => ({
  getRequiredServerEnv: () => "http://localhost:8788",
}));

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.harness.close();
  }
  vi.restoreAllMocks();
});

describe("Account Organization preference HTTP API", () => {
  it.each([
    "revoked",
    "expired",
  ])("reads a fresh credential-free account session and rejects %s credentials", async (ending) => {
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "account-session@example.com",
      name: "Account Session",
    });
    const runtime = await loadBetterAuthRuntime();
    const { vendor, vendorHeaders, sessionCookieName } =
      await withPostgresRequest(context.env.OPENMELD_POSTGRESQL, async () => {
        const auth = runtime.createAuth(context.env, createAuthDatabase());
        const { response: vendor, headers: vendorHeaders } =
          await auth.api.getSession({
            headers: account.headers,
            query: { disableCookieCache: true },
            returnHeaders: true,
          });
        return {
          vendor,
          vendorHeaders,
          sessionCookieName: (await auth.$context).authCookies.sessionToken
            .name,
        };
      });
    if (!vendor) {
      throw new Error("The real sign-in must establish a session.");
    }
    expect(vendorHeaders.getSetCookie().length).toBeGreaterThan(0);
    const getSession = vi.fn();
    const vendorResults: Promise<unknown>[] = [];
    vi.spyOn(lazyRuntime, "loadBetterAuthRuntime").mockResolvedValue({
      ...runtime,
      createAuth: (...args: Parameters<typeof runtime.createAuth>) => {
        const auth = runtime.createAuth(...args);
        const nativeGetSession = auth.api.getSession;
        vi.spyOn(auth.api, "getSession").mockImplementation((input) => {
          getSession(input);
          const result = nativeGetSession(input);
          vendorResults.push(result);
          return result;
        });
        return auth;
      },
    });
    // Membership storage is deliberately unavailable: a pure session read
    // must not depend on it, even for an account with no memberships.
    await context.harness.query({
      text: 'REVOKE SELECT ON "openmeld"."members" FROM openmeld_pg_runtime',
    });
    await context.harness.query({
      text: 'UPDATE "openmeld"."users" SET name = $1, email_verified = $2 WHERE id = $3',
      values: ["Fresh Account Name", 0, vendor.user.id],
    });
    const request = () =>
      context.app.fetch(
        new Request(
          `${AUTH_BASE_URL}/v1/account/session?userId=other&sessionId=other`,
          {
            headers: account.headers,
          }
        ),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
    const response = await request();
    expect(response.status).toBe(200);
    getSession.mockClear();
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(accountSessionSchema.parse(body)).toEqual({
      session: { id: vendor.session.id },
      user: {
        id: vendor.user.id,
        email: vendor.user.email,
        name: "Fresh Account Name",
        image: vendor.user.image ?? null,
        emailVerified: false,
        createdAt: vendor.user.createdAt.toISOString(),
      },
    });
    // Due for the vendor's normal updateAge renewal, but still valid. Do not
    // read via a vendor oracle after this point: the route must own the read.
    const dueExpiry = Date.now() + 60 * 60 * 1000;
    await context.harness.query({
      text: 'UPDATE "openmeld"."sessions" SET expires_at = $1 WHERE id = $2',
      values: [dueExpiry, vendor.session.id],
    });
    const renewed = await request();
    expect(renewed.status).toBe(200);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0]?.[0]?.returnHeaders).toBe(true);
    const renewedCookies = renewed.headers.getSetCookie();
    const renewedSessionCookie = renewedCookies.find((cookie) =>
      cookie.startsWith(`${sessionCookieName}=`)
    );
    expect(Boolean(renewedSessionCookie?.includes("Max-Age="))).toBe(true);
    expect(Boolean(renewedSessionCookie?.includes("HttpOnly"))).toBe(true);
    const stored = await context.harness.queryFirst<{ expires_at: number }>({
      text: 'SELECT expires_at FROM "openmeld"."sessions" WHERE id = $1',
      values: [vendor.session.id],
    });
    expect(stored?.expires_at).toBeGreaterThan(dueExpiry);
    const proxied = await buildBufferedAuthProxyResponse({
      method: "GET",
      preserveUnauthorizedStatus: true,
      upstreamResponse: renewed,
    });
    // Compare without printing generated fixture credentials on failure.
    expect(
      JSON.stringify(proxied.headers.getSetCookie()) ===
        JSON.stringify(renewedCookies)
    ).toBe(true);
    expect(renewedCookies.length).toBeGreaterThan(1);
    expect(proxied.headers.get("cache-control")).toBe("private, no-store");

    // Local verification refuses renewal even when the vendor session is valid.
    const nativeQuery = PostgresDatabase.prototype.query;
    let localVerificationFailure: false | Error | undefined;
    vi.spyOn(PostgresDatabase.prototype, "query").mockImplementation(
      async function (this: PostgresDatabase, query, values) {
        const text = typeof query === "string" ? query : query.text;
        const result = await nativeQuery.call(this, query, values);
        if (USER_EXISTENCE_QUERY_PATTERN.test(text)) {
          if (localVerificationFailure instanceof Error) {
            throw localVerificationFailure;
          }
          if (localVerificationFailure === false) {
            return { ...result, rows: [], rowCount: 0 };
          }
        }
        return result;
      }
    );
    for (const failure of [false, new Error("local user store unavailable")]) {
      await context.harness.query({
        text: 'UPDATE "openmeld"."sessions" SET expires_at = $1 WHERE id = $2',
        values: [Date.now() + 60 * 60 * 1000, vendor.session.id],
      });
      localVerificationFailure = failure;
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const denied = await request();
      const refusedVendorResult = (await vendorResults.at(-1)) as {
        headers: Headers;
      };
      expect(
        Boolean(
          refusedVendorResult.headers
            .getSetCookie()
            .some((cookie: string) =>
              cookie.startsWith(`${sessionCookieName}=`)
            )
        )
      ).toBe(true);
      expect(denied.status).toBe(failure === false ? 401 : 500);
      expect(denied.headers.getSetCookie()).toEqual([]);
      expect(denied.headers.get("cache-control")).toBe("private, no-store");
    }

    localVerificationFailure = undefined;
    // Reusing the same signed cookies cannot revive a revoked session.
    await context.harness.query(
      ending === "revoked"
        ? {
            text: 'DELETE FROM "openmeld"."sessions" WHERE id = $1',
            values: [vendor.session.id],
          }
        : {
            text: 'UPDATE "openmeld"."sessions" SET expires_at = $1 WHERE id = $2',
            values: [Date.now() - 1000, vendor.session.id],
          }
    );
    const expired = await request();
    expect(expired.status).toBe(401);
    expect(expired.headers.get("cache-control")).toBe("private, no-store");
    const deletion = expired.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith(`${sessionCookieName}=`));
    expect(Boolean(deletion?.includes("Max-Age=0"))).toBe(true);
  });
  it("defers Organization entry renewal while preserving cookie-capable renewal and revocation", async () => {
    const context = await createTestContext({ environment: "production" });
    const account = await createSignedInUser(context, {
      email: "entry-renewal@example.com",
      name: "Entry Renewal",
    });
    const runtime = await loadBetterAuthRuntime();
    const vendor = await withPostgresRequest(
      context.env.OPENMELD_POSTGRESQL,
      () =>
        runtime
          .createAuth(context.env, createAuthDatabase())
          .api.getSession({ headers: account.headers })
    );
    if (!vendor) {
      throw new Error("The real sign-in must establish a session.");
    }
    const kv = context.env.OPENMELD_AUTH_KV;
    const storedSession = await kv.get(vendor.session.token);
    if (!storedSession) {
      throw new Error("The real session must be present in secondary storage.");
    }
    const dueExpiry = Date.now() + 60 * 60 * 1000;
    const makeRenewalDue = async () => {
      const cached = JSON.parse(storedSession);
      cached.session.expiresAt = new Date(dueExpiry).toISOString();
      await kv.put(vendor.session.token, JSON.stringify(cached));
      await context.harness.query({
        text: 'UPDATE "openmeld"."sessions" SET expires_at = $1 WHERE id = $2',
        values: [dueExpiry, vendor.session.id],
      });
    };
    await makeRenewalDue();
    const writeDataPoint = vi.fn();
    context.env.OPENMELD_OBSERVABILITY = {
      writeDataPoint,
    } as unknown as AnalyticsEngineDataset;
    const readEvents = () =>
      writeDataPoint.mock.calls.map(([point]) =>
        Object.fromEntries(
          OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.map((key, index) => [
            key,
            point.blobs[index],
          ])
        )
      );
    const requestId = crypto.randomUUID();
    const headers = new Headers(account.headers);
    headers.set("x-request-id", requestId);
    const request = (path: string) =>
      context.app.fetch(
        new Request(`${AUTH_BASE_URL}${path}`, { headers }),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
    const writeStarted = Promise.withResolvers<void>();
    const releaseWrites = Promise.withResolvers<void>();
    const nativePut = kv.put.bind(kv);
    const blockedPut = vi
      .spyOn(kv, "put")
      .mockImplementation(async (...args) => {
        writeStarted.resolve();
        await releaseWrites.promise;
        return nativePut(...args);
      });
    const entry = request(
      "/v1/account/organization-context?deferSessionRefresh=true"
    );
    try {
      const first = await Promise.race([
        entry.then((response) => ({ kind: "response" as const, response })),
        writeStarted.promise.then(() => ({ kind: "renewal_write" as const })),
      ]);
      expect(first.kind).toBe("response");
      if (first.kind !== "response") {
        throw new Error(
          "Organization entry waited for a session renewal write."
        );
      }
      expect(first.response.status).toBe(200);
      expect(
        accountOrganizationContextSchema.parse(await first.response.json())
          .currentUserId
      ).toBe(vendor.user.id);
      expect(blockedPut).not.toHaveBeenCalled();
      const stored = await context.harness.queryFirst<{ expires_at: number }>({
        text: 'SELECT expires_at FROM "openmeld"."sessions" WHERE id = $1',
        values: [vendor.session.id],
      });
      expect(stored?.expires_at).toBe(dueExpiry);
      const events = readEvents();
      for (const stage of ["request", "session", "memberships", "preference"]) {
        for (const status of ["started", "succeeded"]) {
          expect(events).toContainEqual(
            expect.objectContaining({
              event: `auth.openmeld.organization_context.${stage}`,
              requestId,
              status,
            })
          );
        }
      }
      const evidence = JSON.stringify(writeDataPoint.mock.calls);
      expect(evidence.includes(vendor.session.token)).toBe(false);
      expect(evidence.includes(account.email)).toBe(false);
    } finally {
      releaseWrites.resolve();
      await entry;
      blockedPut.mockRestore();
    }

    for (const path of [
      "/v1/account/session",
      "/v1/account/organization-context",
    ]) {
      await makeRenewalDue();
      writeDataPoint.mockClear();
      const renewed = await request(path);
      expect(renewed.status).toBe(200);
      const eventPrefix =
        path === "/v1/account/session"
          ? "auth.openmeld.account_session"
          : "auth.openmeld.organization_context";
      for (const stage of ["request", "session"]) {
        for (const status of ["started", "succeeded"]) {
          expect(readEvents()).toContainEqual(
            expect.objectContaining({
              event: `${eventPrefix}.${stage}`,
              requestId,
              status,
            })
          );
        }
      }
      expect(
        renewed.headers
          .getSetCookie()
          .some(
            (cookie) =>
              cookie.includes("Max-Age=") && cookie.includes("HttpOnly")
          )
      ).toBe(true);
      const stored = await context.harness.queryFirst<{ expires_at: number }>({
        text: 'SELECT expires_at FROM "openmeld"."sessions" WHERE id = $1',
        values: [vendor.session.id],
      });
      expect(stored?.expires_at).toBeGreaterThan(dueExpiry);
    }
    const signedOut = await postJson(
      context,
      "/api/auth/sign-out",
      {},
      headers
    );
    expect(signedOut.status).toBe(200);
    const revoked = await request(
      "/v1/account/organization-context?deferSessionRefresh=true"
    );
    expect(revoked.status).toBe(401);
    expect(
      revoked.headers
        .getSetCookie()
        .some((cookie) => cookie.includes("Max-Age=0"))
    ).toBe(true);
  });
  it.each([
    "development",
    "production",
  ] as const)("enforces cookie Origin and membership on real sidebar writes in %s", async (environment) => {
    const context = await createTestContext({ environment });
    const account = await createSignedInUser(context, {
      email: `sidebar-${environment}@example.com`,
      name: "Sidebar",
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Sidebar",
      slug: `sidebar-${environment}`,
    });
    const read = async () => {
      const response = await context.app.fetch(
        new Request(
          `${AUTH_BASE_URL}/v1/account/sidebar?organizationId=${organizationId}`,
          { headers: account.headers }
        ),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      return accountSidebarResponseSchema.parse(await response.json());
    };
    const initial = await read();
    const origins = [
      DESKTOP_APP_ORIGIN,
      WEB_APP_URL,
      "https://hostile.example",
      "null",
      null,
      `${DESKTOP_APP_ORIGIN}/`,
      `${DESKTOP_APP_ORIGIN}.evil`,
      "openmeld-desktop://other",
      "sh.openmeld.desktop.dev:/",
      "sh.openmeld.desktop:/",
      "sh.openmeld.desktop.test:/",
      "file://app",
      "http://localhost:39999",
      `blob:${WEB_APP_URL}/id`,
    ];
    let revision = initial.revision;
    for (const origin of origins) {
      const headers = new Headers(account.headers);
      headers.set("content-type", "application/json");
      headers.delete("referer");
      if (origin === null) {
        headers.delete("origin");
      } else {
        headers.set("origin", origin);
      }
      const response = await context.app.fetch(
        new Request(`${AUTH_BASE_URL}/v1/account/sidebar`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            organizationId,
            revision,
            preferences: initial.preferences,
          }),
        }),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
      const allowed = origin === WEB_APP_URL || origin === DESKTOP_APP_ORIGIN;
      expect({
        origin,
        status: response.status,
        body: await response.json(),
      }).toMatchObject(
        allowed
          ? { status: 200, body: { ok: true } }
          : { status: 403, body: { code: "auth.invalid_origin" } }
      );
      if (allowed) {
        revision++;
      }
      expect((await read()).revision).toBe(revision);
    }
    const headers = new Headers(account.headers);
    headers.set("origin", WEB_APP_URL);
    headers.set("content-type", "application/json");
    const denied = await context.app.fetch(
      new Request(`${AUTH_BASE_URL}/v1/account/sidebar`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          organizationId: "not-a-membership",
          revision: 0,
          preferences: initial.preferences,
        }),
      }),
      context.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: { code: "organization.membership_required" },
    });
    headers.delete("origin");
    for (const referer of [`${WEB_APP_URL}/workspace`, DESKTOP_APP_ORIGIN]) {
      headers.set("referer", referer);
      const response = await context.app.fetch(
        new Request(`${AUTH_BASE_URL}/v1/account/sidebar`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            organizationId,
            revision,
            preferences: initial.preferences,
          }),
        }),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(referer === DESKTOP_APP_ORIGIN ? 403 : 200);
      if (response.ok) {
        revision++;
      }
    }
    headers.set("origin", WEB_APP_URL);
    headers.set("cookie", "invalid-session=invalid");
    const anonymous = await context.app.fetch(
      new Request(`${AUTH_BASE_URL}/v1/account/sidebar`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          organizationId,
          revision,
          preferences: initial.preferences,
        }),
      }),
      context.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(anonymous.status).toBe(401);
  });
  it("reads only the current account and follows membership-checked entry preferences", async () => {
    const context = await createTestContext({ environment: "production" });
    const account = await createSignedInUser(context, {
      email: "context@example.com",
      name: "Context",
    });
    const other = await createSignedInUser(context, {
      email: "other-context@example.com",
      name: "Other",
    });
    const otherOrganizationId = await createOrganization(context, {
      headers: other.headers,
      name: "Private",
      slug: "private",
    });
    const beta = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "context-beta",
    });
    const read = async () => {
      const response = await context.app.fetch(
        new Request(
          `${AUTH_BASE_URL}/v1/account/organization-context?userId=other&profileId=other`,
          { headers: account.headers }
        ),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const payload = await response.json();
      expect(accountOrganizationContextSchema.safeParse(payload).success).toBe(
        true
      );
      return accountOrganizationContextSchema.parse(payload);
    };
    const initial = await read();
    expect(initial.account).toEqual({
      email: account.email,
      name: "Context",
      image: null,
    });
    expect(
      initial.organizations.some(
        (organization) => organization.id === otherOrganizationId
      )
    ).toBe(false);
    expect(initial.defaultOrganizationId).toBe(initial.organizations[0]?.id);
    const selection = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: beta },
      account.headers
    );
    expect(selection.status).toBe(200);
    expect((await read()).defaultOrganizationId).toBe(beta);
    await context.harness.query({
      text: 'UPDATE "openmeld"."users" SET last_selected_organization_id = $1 WHERE id = $2',
      values: [otherOrganizationId, initial.currentUserId],
    });
    const activeSelection = await postJson(
      context,
      "/api/auth/organization/set-active",
      { organizationId: beta },
      account.headers
    );
    expect(activeSelection.status).toBe(200);
    expect((await read()).defaultOrganizationId).toBe(beta);
    await context.harness.query({
      text: 'DELETE FROM "openmeld"."members" WHERE user_id = $1 AND organization_id = $2',
      values: [initial.currentUserId, beta],
    });
    expect((await read()).defaultOrganizationId).toBe(
      initial.organizations[0]?.id
    );
    await context.harness.query({
      text: 'DELETE FROM "openmeld"."members" WHERE user_id = $1',
      values: [initial.currentUserId],
    });
    expect(await read()).toMatchObject({
      organizations: [],
      defaultOrganizationId: null,
    });
  });

  it.each([
    ["organization-context", 500, "session"],
    ["organization-context", 500, "memberships"],
    ["session", 500, "session"],
    ["session", 503, "session"],
  ] as const)("distinguishes missing authentication from %s failure %s in %s", async (path, failureStatus, failureStage) => {
    const context = await createTestContext();
    const writeDataPoint = vi.fn();
    context.env.OPENMELD_OBSERVABILITY = {
      writeDataPoint,
    } as unknown as AnalyticsEngineDataset;
    const request = (headers = new Headers()) =>
      context.app.fetch(
        new Request(`${AUTH_BASE_URL}/v1/account/${path}`, {
          headers,
        }),
        context.env,
        TEST_EXECUTION_CONTEXT
      );
    const anonymous = await request();
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("private, no-store");
    const account = await createSignedInUser(context, {
      email: "context-failure@example.com",
      name: "Context Failure",
    });
    if (failureStage === "memberships") {
      await context.harness.query(
        'REVOKE SELECT ON "openmeld"."members" FROM openmeld_pg_runtime'
      );
    } else if (failureStatus === 503) {
      await context.harness.query(
        'REVOKE SELECT ON "openmeld"."sessions" FROM openmeld_pg_runtime'
      );
    } else {
      installLocalUserReadFailure(new Error("local verification unavailable"));
    }
    writeDataPoint.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const failed = await request(account.headers);
    expect(failed.status).toBe(failureStatus);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
    const eventPrefix =
      path === "organization-context"
        ? "auth.openmeld.organization_context"
        : "auth.openmeld.account_session";
    const events = writeDataPoint.mock.calls.map(([point]) =>
      Object.fromEntries(
        OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.map((key, index) => [
          key,
          point.blobs[index],
        ])
      )
    );
    for (const stage of ["request", failureStage]) {
      expect(events).toContainEqual(
        expect.objectContaining({
          event: `${eventPrefix}.${stage}`,
          requestId: failed.headers.get("x-request-id"),
          status: "failed",
        })
      );
    }
  });

  it("returns the shared error contract when the authenticated session is missing", async () => {
    const context = await createTestContext();

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "org-beta" }
    );

    expect(selectionResponse.status).toBe(401);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "auth.unauthenticated",
        message: "Sign in again to continue.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns the shared error contract when local session verification fails", async () => {
    const verificationFailure = new Error(
      "PostgreSQL local user lookup unavailable"
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "session-verification-failure@example.com",
      name: "Session Verification Failure",
    });
    installLocalUserReadFailure(verificationFailure);

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "org-beta" },
      account.headers
    );

    expect(selectionResponse.status).toBe(500);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "upstream_error",
        message: "OpenMeld couldn't verify your session. Try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[auth.context_middleware.local_session_state_failed]",
      expect.objectContaining({
        error: expect.objectContaining({
          message: verificationFailure.message,
        }),
        method: "PATCH",
        path: "/v1/account/last-selected-organization",
      })
    );
  });

  it("returns the shared error contract when the request origin is not trusted", async () => {
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "invalid-origin@example.com",
      name: "Invalid Origin",
    });
    const headers = new Headers(account.headers);
    headers.set("content-type", "application/json");
    headers.set("origin", "https://untrusted.example.com");

    const selectionResponse = await context.app.fetch(
      new Request(`${AUTH_BASE_URL}/v1/account/last-selected-organization`, {
        body: JSON.stringify({ organizationId: "org-beta" }),
        headers,
        method: "PATCH",
      }),
      context.env,
      TEST_EXECUTION_CONTEXT
    );

    expect(selectionResponse.status).toBe(403);
    expect(
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      )
    ).toMatchObject({
      error: {
        code: "auth.invalid_origin",
        message: "Refresh the page and try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns the shared error contract for an invalid Organization selection", async () => {
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "invalid-selection@example.com",
      name: "Invalid Selection",
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "" },
      account.headers
    );

    expect(selectionResponse.status).toBe(400);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "invalid_payload",
        message: "Choose a valid organization.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns the saved Organization through a later authenticated session", async () => {
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "felix@example.com",
      name: "Felix",
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "beta",
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId },
      account.headers
    );
    expect(selectionResponse.status).toBe(200);
    await expect(selectionResponse.json()).resolves.toEqual({
      ok: true,
      organizationId,
    });

    const laterSessionHeaders = await signIn(context, {
      email: account.email,
      password: PASSWORD,
    });
    await expect(
      readLastSelectedOrganizationId(context, laterSessionHeaders)
    ).resolves.toBe(organizationId);
  });

  it("returns the saved Organization through cached production sessions", async () => {
    const context = await createTestContext({ environment: "production" });
    const account = await createSignedInUser(context, {
      email: "cached-session@example.com",
      name: "Cached Session",
    });
    const otherSessionHeaders = await signIn(context, {
      email: account.email,
      password: PASSWORD,
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "beta",
    });

    await expect(
      readLastSelectedOrganizationId(context, account.headers)
    ).resolves.toBeNull();
    await expect(
      readLastSelectedOrganizationId(context, otherSessionHeaders)
    ).resolves.toBeNull();

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId },
      account.headers
    );
    expect(selectionResponse.status).toBe(200);

    await expect(
      readLastSelectedOrganizationId(context, account.headers)
    ).resolves.toBe(organizationId);
    await expect(
      readLastSelectedOrganizationId(context, otherSessionHeaders)
    ).resolves.toBe(organizationId);
  });

  it("rejects an Organization outside or missing from the authenticated account", async () => {
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "member@example.com",
      name: "Member",
    });
    const otherAccount = await createSignedInUser(context, {
      email: "other@example.com",
      name: "Other",
    });
    const otherOrganizationId = await createOrganization(context, {
      headers: otherAccount.headers,
      name: "Other Organization",
      slug: "other-organization",
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: otherOrganizationId },
      account.headers
    );

    expect(selectionResponse.status).toBe(403);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "organization.membership_required",
        message:
          "You must be a member of this organization before selecting it.",
        requestId: expect.any(String),
      },
      ok: false,
    });
    await expect(
      readLastSelectedOrganizationId(context, account.headers)
    ).resolves.toBeNull();

    const missingOrganizationResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId: "org-missing" },
      account.headers
    );
    expect(missingOrganizationResponse.status).toBe(403);
    expect(
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await missingOrganizationResponse.json()
      )
    ).toMatchObject({
      error: {
        code: "organization.membership_required",
        message:
          "You must be a member of this organization before selecting it.",
        requestId: expect.any(String),
      },
      ok: false,
    });
  });

  it("returns a shared error envelope when the preference write fails", async () => {
    const writeFailure = new Error("PostgreSQL preference update unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const context = await createTestContext();
    const account = await createSignedInUser(context, {
      email: "write-failure@example.com",
      name: "Write Failure",
    });
    const organizationId = await createOrganization(context, {
      headers: account.headers,
      name: "Beta",
      slug: "beta",
    });
    await installPostgresWriteFailure({
      harness: context.harness,
      table: "users",
      operation: "UPDATE",
      columns: ["last_selected_organization_id"],
      message: writeFailure.message,
    });

    const selectionResponse = await patchJson(
      context,
      "/v1/account/last-selected-organization",
      { organizationId },
      account.headers
    );

    expect(selectionResponse.status).toBe(500);
    const errorEnvelope =
      selectLastSelectedOrganizationErrorResponseSchema.parse(
        await selectionResponse.json()
      );
    expect(errorEnvelope).toMatchObject({
      error: {
        code: "upstream_error",
        message: "OpenMeld couldn't save your organization. Try again.",
        requestId: expect.any(String),
      },
      ok: false,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[auth.account_organization_preference_selection_failed]",
      expect.objectContaining({
        error: expect.objectContaining({
          cause: expect.objectContaining({ message: writeFailure.message }),
          message: expect.stringContaining("Failed query"),
        }),
        requestId: errorEnvelope.error.requestId,
      })
    );
    expect(consoleError).not.toHaveBeenCalledWith(
      "[auth.internal_error]",
      expect.anything()
    );
  });
});

async function createTestContext(
  input: { environment?: "development" | "production" } = {}
) {
  const harness = await createPostgresHarness();

  const env = {
    AUTH_BRAND_NAME: "OpenMeld",
    AUTH_COOKIE_DOMAIN: "localhost",
    AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli",
    AUTH_EMAIL: { send: () => Promise.resolve() },
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_WORKER_NODE_ENV: input.environment ?? "development",
    BETTER_AUTH_OPENMELD_SECRET:
      "1234567890123456789012345678901234567890123456789012345678901234",
    BETTER_AUTH_URL: AUTH_BASE_URL,
    PASSKEY_RP_ID: "localhost",
    OPENMELD_AUTH_KV: createMemoryKvNamespace(),
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
    WEB_APP_URL,
  } as unknown as AuthBindings;
  const context = { app: createAuthWorkerTestApp(), env, harness };
  contexts.push(context);
  return context;
}

function createMemoryKvNamespace(): KVNamespace {
  const values = new Map<string, string>();
  return {
    delete: (key: string) => {
      values.delete(key);
      return Promise.resolve();
    },
    get: (key: string) => Promise.resolve(values.get(key) ?? null),
    put: (key: string, value: string | ArrayBuffer | ReadableStream) => {
      if (typeof value !== "string") {
        return Promise.reject(
          new TypeError("The test KV only accepts string values.")
        );
      }
      values.set(key, value);
      return Promise.resolve();
    },
  } as unknown as KVNamespace;
}

function installLocalUserReadFailure(error: Error) {
  const query = PostgresDatabase.prototype.query;
  vi.spyOn(PostgresDatabase.prototype, "query").mockImplementation(function (
    this: PostgresDatabase,
    input,
    values
  ) {
    const text = typeof input === "string" ? input : input.text;
    if (USER_EXISTENCE_QUERY_PATTERN_ALTERNATE.test(text)) {
      throw error;
    }
    return query.call(this, input, values);
  });
}

async function createSignedInUser(
  context: TestContext,
  input: { email: string; name: string }
): Promise<{ email: string; headers: Headers }> {
  const signUpResponse = await postJson(context, "/api/auth/sign-up/email", {
    email: input.email,
    name: input.name,
    password: PASSWORD,
  });
  if (!signUpResponse.ok) {
    throw new Error(
      `Sign-up failed: ${signUpResponse.status} ${await signUpResponse.text()}`
    );
  }
  await setEmailVerified(context.harness, input.email);
  return {
    email: input.email,
    headers: await signIn(context, {
      email: input.email,
      password: PASSWORD,
    }),
  };
}

async function signIn(
  context: TestContext,
  input: { email: string; password: string }
): Promise<Headers> {
  const response = await postJson(context, "/api/auth/sign-in/email", input);
  if (!response.ok) {
    throw new Error(
      `Sign-in failed: ${response.status} ${await response.text()}`
    );
  }
  return convertSetCookieToCookieHeader(response.headers);
}

async function createOrganization(
  context: TestContext,
  input: { headers: Headers; name: string; slug: string }
): Promise<string> {
  const response = await postJson(
    context,
    "/api/auth/organization/create",
    { name: input.name, slug: input.slug },
    input.headers
  );
  if (!response.ok) {
    throw new Error(
      `Organization creation failed: ${response.status} ${await response.text()}`
    );
  }
  const organization = (await response.json()) as { id?: unknown };
  if (typeof organization.id !== "string" || organization.id.length === 0) {
    throw new Error("Organization creation returned an invalid id.");
  }
  return organization.id;
}

async function readLastSelectedOrganizationId(
  context: TestContext,
  headers: Headers
): Promise<string | null> {
  const response = await context.app.fetch(
    new Request(
      `${AUTH_BASE_URL}/api/auth/get-session?disableCookieCache=true`,
      { headers }
    ),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
  if (!response.ok) {
    throw new Error(
      `Session read failed: ${response.status} ${await response.text()}`
    );
  }
  const body = (await response.json()) as {
    user?: { lastSelectedOrganizationId?: unknown };
  };
  return typeof body.user?.lastSelectedOrganizationId === "string"
    ? body.user.lastSelectedOrganizationId
    : null;
}

function patchJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers: Headers
): Promise<Response> {
  return requestJson(context, pathname, body, headers, "PATCH");
}

function postJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers = new Headers()
): Promise<Response> {
  return requestJson(context, pathname, body, headers, "POST");
}

function requestJson(
  context: TestContext,
  pathname: string,
  body: Record<string, unknown>,
  headers: Headers,
  method: "PATCH" | "POST"
): Promise<Response> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-type", "application/json");
  requestHeaders.set("origin", WEB_APP_URL);
  return context.app.fetch(
    new Request(`${AUTH_BASE_URL}${pathname}`, {
      body: JSON.stringify(body),
      headers: requestHeaders,
      method,
    }),
    context.env,
    TEST_EXECUTION_CONTEXT
  );
}

async function setEmailVerified(
  harness: PostgresHarness,
  email: string
): Promise<void> {
  await harness.query({
    values: [email],
    text: 'update "openmeld"."users" set email_verified = 1 where email = $1',
  });
}

function convertSetCookieToCookieHeader(sourceHeaders: Headers): Headers {
  const headers = new Headers();
  const setCookieHeader = sourceHeaders.get("set-cookie");
  if (!setCookieHeader) {
    return headers;
  }
  headers.set(
    "cookie",
    setCookieHeader
      .split(SET_COOKIE_SEPARATOR_PATTERN)
      .map((cookie) => cookie.split(";").at(0)?.trim())
      .filter((cookie): cookie is string => Boolean(cookie))
      .join("; ")
  );
  return headers;
}
