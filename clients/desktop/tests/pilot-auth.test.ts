import { betterAuth, type User } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  openExternal: vi.fn(),
  on: vi.fn(),
  registerSchemes: vi.fn(),
}));
const usableSessionToken = /session_token=[^;]+/u;
vi.mock("electron", () => ({
  app: {
    on: platform.on,
    whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => true,
    setAsDefaultProtocolClient: () => true,
  },
  shell: { openExternal: platform.openExternal },
  default: {
    app: {
      on: platform.on,
      whenReady: () => Promise.resolve(),
      requestSingleInstanceLock: () => true,
      setAsDefaultProtocolClient: () => true,
      userAgentFallback: "Desktop test",
    },
    protocol: { registerSchemesAsPrivileged: platform.registerSchemes },
    shell: { openExternal: platform.openExternal },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    webContents: { getFocusedWebContents: () => null },
  },
}));
vi.mock("@better-auth/electron/storage", () => ({
  storage: () => ({
    getItem: (key: string) => platform.stored.get(key) ?? null,
    setItem: (key: string, value: string) => platform.stored.set(key, value),
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  platform.stored.clear();
  vi.clearAllMocks();
});

it.each([
  200, 403, 500,
])("persists vendor renewal on %i past original expiry and SDK recreation, then applies 401 deletion", async (responseStatus) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("process", { ...process, type: "browser", platform: "darwin" });
  const origin = "http://localhost:39992";
  const server = betterAuth({
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    secret: "disposable-native-renewal-secret-at-least-32-characters",
    baseURL: origin,
    emailAndPassword: { enabled: true },
    session: { expiresIn: 10, updateAge: 2, cookieCache: { enabled: false } },
  });
  const created = await server.api.signUpEmail({
    body: {
      email: "native@example.com",
      name: "Native",
      password: "disposable-password",
    },
    returnHeaders: true,
  });
  let status = responseStatus;
  const observed: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname.endsWith("/electron/token")) {
        return Response.json(
          { user: created.response.user },
          { headers: created.headers }
        );
      }
      const headers = new Headers(init?.headers);
      if (pathname === "/v1/renewal") {
        observed.push(headers.get("cookie") ?? "");
        const result =
          status === 401
            ? await server.api.signOut({ headers, returnHeaders: true })
            : await server.api.getSession({
                headers,
                query: { disableCookieCache: true },
                returnHeaders: true,
              });
        result.headers.append(
          "set-cookie",
          "unrelated=unchanged; Path=/; HttpOnly"
        );
        return Response.json(
          { code: status === 200 ? "ok" : "business.failed" },
          { status, headers: result.headers }
        );
      }
      return server.handler(new Request(String(url), init));
    })
  );
  const { createPilotAuth } = await import("../src/main/pilot-auth");
  let auth = createPilotAuth(origin, () => null, vi.fn());
  await auth.signIn();
  const browserUrl = new URL(platform.openExternal.mock.calls.at(-1)?.[0]);
  const token = Buffer.from(
    JSON.stringify({
      state: browserUrl.searchParams.get("state"),
      identifier: "captured-vendor-response",
    })
  ).toString("base64url");
  const openUrl = platform.on.mock.calls.find(
    ([name]) => name === "open-url"
  )?.[1];
  if (!openUrl) {
    throw new Error("Expected callback");
  }
  await openUrl(
    { preventDefault: vi.fn() },
    `sh.openmeld.desktop.dev://auth/callback#token=${token}`
  );
  const originalCookie = auth.cookie();
  expect(originalCookie).toContain("session_token=");
  {
    vi.setSystemTime(Date.now() + 3000);
    const response = await auth.cloudRequest("/v1/renewal", {
      method: "GET",
      headers: new Headers(),
    });
    expect(response.status).toBe(responseStatus);
    expect(await response.json()).toEqual({
      code: responseStatus === 200 ? "ok" : "business.failed",
    });
    expect(response.headers.getSetCookie().length).toBeGreaterThan(1);
    auth = createPilotAuth(origin, () => null, vi.fn());
    expect(auth.cookie()).toBe(`${originalCookie}; unrelated=unchanged`); // Expiry-only renewal preserves the token value.
  }
  vi.setSystemTime(Date.now() + 8000); // Beyond the original 10-second expiry.
  auth = createPilotAuth(origin, () => null, vi.fn());
  expect(auth.cookie()).toBe(`${originalCookie}; unrelated=unchanged`);
  expect((await auth.session()).user?.email).toBe("native@example.com");
  status = 401;
  const deleted = await auth.cloudRequest("/v1/renewal", {
    method: "GET",
    headers: new Headers(),
  });
  expect(deleted.status).toBe(401);
  expect(await deleted.json()).toEqual({ code: "business.failed" });
  expect(auth.cookie()).not.toMatch(usableSessionToken);
  expect((await auth.session()).user).toBeNull();
  auth = createPilotAuth(origin, () => null, vi.fn());
  expect(auth.cookie()).not.toMatch(usableSessionToken);
  expect(observed).toEqual([
    originalCookie,
    `${originalCookie}; unrelated=unchanged`,
  ]);
});

it("signals after the installed Electron plugin persists the exchanged cookie, and after sign-out clears it", async () => {
  vi.stubGlobal("process", { ...process, type: "browser", platform: "darwin" });
  const user = {
    id: "account-a",
    name: "Member",
    email: "member@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies User;
  let rejectExchange = false;
  // Responses follow Better Auth's token endpoint User contract. The real
  // installed Electron plugin performs PKCE request and cookie handling here.
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((url) => {
      if (new URL(String(url)).pathname.endsWith("/electron/token")) {
        return Promise.resolve(
          rejectExchange
            ? Response.json({ message: "Rejected exchange" }, { status: 401 })
            : Response.json(
                { user },
                {
                  headers: {
                    "set-cookie":
                      "better-auth.session_token=fixture-session; Path=/; HttpOnly",
                  },
                }
              )
        );
      }
      return Promise.resolve(Response.json({ success: true }));
    })
  );
  const { createPilotAuth } = await import("../src/main/pilot-auth");
  const observedCookies: string[] = [];
  const changed = vi.fn(() => observedCookies.push(auth.cookie()));
  const auth = createPilotAuth("http://localhost:39991", () => null, changed);
  expect(platform.registerSchemes).not.toHaveBeenCalled();
  const openUrl = platform.on.mock.calls.find(
    ([name]) => name === "open-url"
  )?.[1];
  if (!openUrl) {
    throw new Error("Expected the native open-url handler");
  }
  const finishBrowserReturn = async () => {
    await auth.signIn();
    const browserUrl = new URL(platform.openExternal.mock.calls.at(-1)?.[0]);
    const code = Buffer.from(
      JSON.stringify({
        state: browserUrl.searchParams.get("state"),
        identifier: "test-authorization-code",
      })
    ).toString("base64url");
    await openUrl(
      { preventDefault: vi.fn() },
      `sh.openmeld.desktop.dev://auth/callback#token=${code}`
    );
  };
  await finishBrowserReturn();
  expect(observedCookies).toEqual([
    "better-auth.session_token=fixture-session",
  ]);
  expect(changed.mock.calls[0]).toEqual([]);
  await auth.signOut();
  expect(observedCookies).toEqual([
    "better-auth.session_token=fixture-session",
    "",
  ]);
  rejectExchange = true;
  await expect(finishBrowserReturn()).resolves.toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(3);
  await expect(auth.session()).rejects.toThrow(
    "Sign in with your browser again"
  );
});
