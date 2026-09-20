import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { resolveSessionFromHeaders } from "../src/lib/better-auth/session-resolver";
import type { AppContext } from "../src/lib/context";
import { authContextMiddleware } from "../src/lib/middlewares/auth";

vi.mock("../src/lib/better-auth/local-auth-user-store", () => ({
  getLocalAuthUserStore: () => ({ hasUserById: async () => true }),
}));

afterEach(() => vi.useRealTimers());

it("preserves the renewal window across identity-only reads until an HTTP cookie sink can carry it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const auth = betterAuth({
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    secret: "disposable-renewal-test-secret-at-least-32-characters",
    baseURL: "http://localhost:39991",
    emailAndPassword: { enabled: true },
    session: { expiresIn: 10, updateAge: 2, cookieCache: { enabled: false } },
  });
  const created = await auth.api.signUpEmail({
    body: {
      email: "renewal@example.com",
      name: "Renewal",
      password: "disposable-password",
    },
    returnHeaders: true,
  });
  const originalCookies = created.headers.getSetCookie();
  const headers = new Headers({
    cookie: originalCookies.map((value) => value.split(";")[0]).join("; "),
  });
  const original = await auth.api.getSession({ headers });
  expect(original).not.toBeNull();
  vi.setSystemTime(Date.now() + 3000);
  // RPC identity verification has no cookie sink. It must not silently consume
  // renewal before the next authenticated HTTP request can return cookies.
  const organization = await resolveSessionFromHeaders({
    auth: auth as unknown as Parameters<
      typeof resolveSessionFromHeaders
    >[0]["auth"],
    headers,
    disableCookieCache: true,
  });
  expect(organization.status).toBe("authenticated");
  const accountCookies: string[] = [];
  const account = await resolveSessionFromHeaders({
    auth: auth as unknown as Parameters<
      typeof resolveSessionFromHeaders
    >[0]["auth"],
    headers,
    disableCookieCache: true,
    onSessionCookies: (cookies) => accountCookies.push(...cookies),
  });
  expect(account.status).toBe("authenticated");
  if (account.status !== "authenticated" || !original) {
    throw new Error("Expected session");
  }
  expect(account.session.expiresAt.getTime()).toBeGreaterThan(
    original.session.expiresAt.getTime()
  );
  expect(
    accountCookies.some((cookie) =>
      cookie.startsWith("better-auth.session_token=")
    )
  ).toBe(true);

  const http = new Hono<AppContext>();
  http.use("*", async (c, next) => {
    c.set(
      "betterAuth",
      auth as unknown as AppContext["Variables"]["betterAuth"]
    );
    await next();
  });
  http.use("*", authContextMiddleware);
  http.get("/v1/account/organization-context", (c) =>
    c.json({ code: "business.denied" }, 403)
  );
  http.get("/v1/account/failure", (c) =>
    c.json({ code: "business.failed" }, 500)
  );
  for (const [path, status, code] of [
    ["/v1/account/organization-context", 403, "business.denied"],
    ["/v1/account/failure", 500, "business.failed"],
  ] as const) {
    vi.setSystemTime(Date.now() + 3000);
    const response = await http.request(path, { headers });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith("better-auth.session_token="))
    ).toBe(true);
  }
});
