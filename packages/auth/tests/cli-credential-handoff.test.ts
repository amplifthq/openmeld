import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { bearer, oneTimeToken } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import {
  createCliCredentialPlugin,
  INTERACTIVE_SESSION_REQUIRED_CODE,
  isCliCredentialSessionRecord,
} from "../src/plugins/cli-credential";

vi.mock("@openmeld/schemas", async (importActual) => ({
  ...(await importActual<typeof import("@openmeld/schemas")>()),
  MEMBER_AGENTS_ENABLED: true,
}));

const BASE_URL = "http://localhost:3000";
const PASSWORD = "test-password-for-credential-handoff";

function createAuth() {
  return betterAuth({
    baseURL: BASE_URL,
    secret: "credential-handoff-test-secret-long-enough",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    emailAndPassword: { enabled: true },
    session: {
      additionalFields: {
        activeOrganizationId: { type: "string", required: false, input: false },
      },
      cookieCache: { enabled: true, maxAge: 300 },
    },
    databaseHooks: {
      session: {
        create: {
          // Production session bootstrap selects the personal Organization.
          before: async (session) => ({
            data: { ...session, activeOrganizationId: "personal-org" },
          }),
        },
      },
    },
    plugins: [
      createCliCredentialPlugin(),
      bearer(),
      oneTimeToken({ storeToken: "hashed", disableSetSessionCookie: true }),
    ],
  });
}

function cookieHeaders(response: Response): Headers {
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
}

describe("one-time-token CLI session handoff", () => {
  it("keeps Web interactive while issuing a distinct, permanently restricted CLI session", async () => {
    const auth = createAuth();
    const signup = await auth.api.signUpEmail({
      body: {
        email: "owner@example.com",
        name: "Owner",
        password: PASSWORD,
      },
      asResponse: true,
    });
    expect(signup.status).toBe(200);
    const browserHeaders = cookieHeaders(signup);
    const initial = await auth.api.getSession({ headers: browserHeaders });
    expect(initial).not.toBeNull();
    const browserToken = initial?.session.token ?? "";
    const adapter = (await auth.$context).internalAdapter;
    await adapter.updateSession(browserToken, {
      activeOrganizationId: "selected-team-org",
    });
    const { token } = await auth.api.generateOneTimeToken({
      headers: browserHeaders,
      query: { disableCookieCache: true },
    });
    const exchange = await auth.handler(
      new Request(`${BASE_URL}/api/auth/one-time-token/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
    );
    expect(exchange.status).toBe(200);
    const exchanged = (await exchange.json()) as NonNullable<typeof initial>;
    const cliToken = exchanged.session.token;
    expect(cliToken).not.toBe(browserToken);
    expect(exchanged.user.id).toBe(initial?.user.id);
    expect(exchanged.session.activeOrganizationId).toBe("selected-team-org");
    expect(isCliCredentialSessionRecord(exchanged.session)).toBe(true);
    expect(exchange.headers.get("set-cookie")).not.toContain(browserToken);
    const signedCliToken = exchange.headers.get("set-auth-token");
    expect(signedCliToken).toBeTruthy();
    expect(signedCliToken).not.toContain(browserToken);

    const freshBrowser = await auth.api.getSession({
      headers: browserHeaders,
      query: { disableCookieCache: true },
    });
    expect(freshBrowser?.session.token).toBe(browserToken);
    expect(isCliCredentialSessionRecord(freshBrowser?.session)).toBe(false);
    const cliSession = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${signedCliToken}` }),
      query: { disableCookieCache: true },
    });
    expect(cliSession?.session.token).toBe(cliToken);
    expect(isCliCredentialSessionRecord(cliSession?.session)).toBe(true);

    // A signed CLI cookie cannot become an interactive credential again.
    const cliCookie = cookieHeaders(exchange);
    const cookieSession = await auth.api.getSession({ headers: cliCookie });
    expect(isCliCredentialSessionRecord(cookieSession?.session)).toBe(true);
    for (const headers of [
      cliCookie,
      new Headers({ authorization: `Bearer ${signedCliToken}` }),
    ]) {
      headers.set("content-type", "application/json");
      headers.set("origin", BASE_URL);
      const refused = await auth.handler(
        new Request(`${BASE_URL}/api/auth/change-password`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            currentPassword: PASSWORD,
            newPassword: `${PASSWORD}-changed`,
          }),
        })
      );
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        code: INTERACTIVE_SESSION_REQUIRED_CODE,
      });
    }
    await expect(
      auth.api.verifyOneTimeToken({ body: { token } })
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });

    const forwarded = await auth.api.generateOneTimeToken({
      headers: cliCookie,
    });
    const forwardedSession = await auth.api.verifyOneTimeToken({
      body: { token: forwarded.token },
    });
    expect(isCliCredentialSessionRecord(forwardedSession.session)).toBe(true);
    expect(
      isCliCredentialSessionRecord(
        (await adapter.findSession(cliToken))?.session
      )
    ).toBe(true);

    const changed = await auth.api.changePassword({
      headers: browserHeaders,
      body: {
        currentPassword: PASSWORD,
        newPassword: `${PASSWORD}-changed`,
      },
    });
    expect(changed.user.id).toBe(initial?.user.id);

    // Revoking the Computer login does not revoke the Web approver's session.
    await adapter.deleteSession(cliToken);
    expect(
      await auth.api.getSession({
        headers: browserHeaders,
        query: { disableCookieCache: true },
      })
    ).not.toBeNull();
  });
});
