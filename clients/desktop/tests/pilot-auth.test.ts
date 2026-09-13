import type { User } from "better-auth";
import { afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  openExternal: vi.fn(),
  on: vi.fn(),
}));
vi.mock("electron", () => ({
  shell: { openExternal: platform.openExternal },
  default: {
    app: {
      on: platform.on,
      whenReady: () => Promise.resolve(),
      requestSingleInstanceLock: () => true,
      setAsDefaultProtocolClient: () => true,
      userAgentFallback: "Desktop test",
    },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
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
  platform.stored.clear();
  vi.clearAllMocks();
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
  const openUrl = platform.on.mock.calls.find(
    ([name]) => name === "open-url"
  )?.[1];
  if (!openUrl) {
    throw new Error("Expected the vendor open-url handler");
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
    await openUrl({}, `sh.openmeld.desktop.dev://auth/callback#token=${code}`);
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
  await expect(finishBrowserReturn()).rejects.toBeDefined();
  expect(changed).toHaveBeenCalledTimes(2);
});
