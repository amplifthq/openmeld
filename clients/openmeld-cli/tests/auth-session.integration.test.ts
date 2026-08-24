import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAuthSession,
  getAuthSession,
  getAuthSessionState,
  readActiveOrganizationIdFromSessionPayload,
  setAuthSession,
  updateAuthSessionActiveOrganization,
} from "../src/config/auth-session";
import { withTempHome } from "./helpers/fs";

describe("auth session storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
  });

  it("persists and loads auth session", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-123",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: "2026-12-31T00:00:00.000Z",
        scope: "openid profile email",
        user: {
          id: "user_123",
          email: "you@company.com",
          name: "Felix",
        },
        activeOrganization: {
          id: "org_123",
          slug: "acme",
          name: "Acme",
          role: "owner",
        },
      });

      const session = await getAuthSession();
      expect(session).not.toBeNull();
      expect(session?.accessToken).toBe("token-123");
      expect(session?.v).toBe(1);
      expect(session?.tokenType).toBe("Bearer");
      expect(session?.authBaseUrl).toBe("https://auth.openmeld.invalid");
      expect(session?.clientId).toBe("openmeld-cli");
      expect(session?.expiresAt).toBe("2026-12-31T00:00:00.000Z");
      expect(session?.scope).toBe("openid profile email");
      expect(session?.user?.id).toBe("user_123");
      expect(session?.user?.email).toBe("you@company.com");
      expect(session?.user?.name).toBe("Felix");
      expect(session?.activeOrganization).toEqual({
        id: "org_123",
        slug: "acme",
        name: "Acme",
        role: "owner",
      });

      const raw = await readFile(
        join(home, ".openmeld", "auth", "session.json"),
        "utf8"
      );
      expect(raw).not.toContain("token-123");
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reuses a loaded token while the persisted session is unchanged", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-cached",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      const payload = JSON.parse(await readFile(sessionPath, "utf8")) as {
        tokenRef: { key: string };
      };
      await rm(
        join(
          home,
          ".openmeld",
          "auth",
          "tokens",
          `${payload.tokenRef.key}.token`
        )
      );

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "token-cached",
      });

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reloads a valid session after the OpenMeld process restarts", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-after-restart",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "user-after-restart" },
      });

      vi.resetModules();
      const { getAuthSession: getRestartedAuthSession } = await import(
        "../src/config/auth-session"
      );

      await expect(getRestartedAuthSession()).resolves.toMatchObject({
        accessToken: "token-after-restart",
        user: { id: "user-after-restart" },
      });
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("keeps an old Keychain location pending when npm replaces an unreadable session", async () => {
    await withTempHome(async (home) => {
      const authDirectory = join(home, ".openmeld", "auth");
      await mkdir(authDirectory, { recursive: true });
      await writeFile(
        join(authDirectory, "session.json"),
        `${JSON.stringify({
          v: 1,
          tokenRef: {
            provider: "macos-keychain",
            service: "sh.openmeld.auth.token",
            account: "openmeld-auth-old-npm-session",
          },
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: new Date().toISOString(),
        })}\n`,
        "utf8"
      );
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      await setAuthSession({
        accessToken: "replacement-npm-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const session = JSON.parse(
        await readFile(join(authDirectory, "session.json"), "utf8")
      ) as { tokenRef: { provider: string } };
      expect(session.tokenRef.provider).toBe("insecure-file");
      await expect(
        readFile(join(authDirectory, "pending-token-cleanup.json"), "utf8")
      ).resolves.toContain("openmeld-auth-old-npm-session");
      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "replacement-npm-token",
      });
    });
  });

  it("updates active organization without rewriting the stored access token", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-123",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      await updateAuthSessionActiveOrganization({
        id: "org_456",
        slug: "launch",
        name: "Launch Team",
      });

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "token-123",
        activeOrganization: {
          id: "org_456",
          slug: "launch",
          name: "Launch Team",
        },
      });
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.not.toContain("token-123");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("clears auth session", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-123",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await clearAuthSession();
      await expect(getAuthSession()).resolves.toBeNull();
      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reports missing auth state when session is absent", async () => {
    await withTempHome(async () => {
      const state = await getAuthSessionState();
      expect(state.state).toBe("missing");
      expect(state.reasonCode).toBe("session_missing");
      expect(state.session).toBeNull();
    });
  });

  it("reports expired auth state", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-expired",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        scope: "openid profile email",
      });

      const state = await getAuthSessionState();
      expect(state.state).toBe("expired");
      expect(state.reasonCode).toBe("session_expired");
      expect(state.session?.accessToken).toBe("token-expired");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reports invalid auth state for malformed session payload", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify(
          {
            v: 1,
            tokenRef: { provider: "insecure-file" },
            tokenType: "Bearer",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const state = await getAuthSessionState();
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("session_token_ref_invalid");
      expect(state.session).toBeNull();
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain('"provider": "insecure-file"');

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("reports invalid auth state for a tampered insecure-file token key", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify(
          {
            v: 1,
            tokenRef: {
              provider: "insecure-file",
              key: "../escape",
            },
            tokenType: "Bearer",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const state = await getAuthSessionState();
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("session_token_ref_invalid");
      expect(state.session).toBeNull();
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain("../escape");
    });
  });

  it("reports invalid auth state after restart without deleting a session whose token is missing", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-missing",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      const rawSession = await readFile(sessionPath, "utf8");
      const payload = JSON.parse(rawSession) as {
        tokenRef: { key: string; provider: "insecure-file" };
      };
      await rm(
        join(
          home,
          ".openmeld",
          "auth",
          "tokens",
          `${payload.tokenRef.key}.token`
        )
      );

      vi.resetModules();
      const { getAuthSessionState: getReloadedAuthSessionState } = await import(
        "../src/config/auth-session"
      );
      const state = await getReloadedAuthSessionState();
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("session_token_missing");
      expect(state.session).toBeNull();
      await expect(readFile(sessionPath, "utf8")).resolves.toBe(rawSession);

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("marks auth state revoked when /api/auth/get-session returns 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 401,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-revoked",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        scope: "openid profile email",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("revoked");
      expect(state.reasonCode).toBe("remote_session_revoked");
      expect(state.session).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain("tokenRef");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("keeps local session when remote validation returns transient 5xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-transient",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("valid");
      expect(state.session?.accessToken).toBe("token-transient");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "token-transient",
      });

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("keeps remote validation valid when Better Auth returns only activeOrganizationId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session: {
            id: "session-1",
            activeOrganizationId: "org_remote",
          },
          user: {
            id: "user-1",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("valid");
      expect(state.session?.activeOrganization).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(getAuthSession()).resolves.not.toHaveProperty(
        "activeOrganization"
      );

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("treats invalid auth base URL as invalid on remote validation", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-invalid-url",
        tokenType: "Bearer",
        authBaseUrl: "not-a-url",
        clientId: "openmeld-cli",
      });

      const state = await getAuthSessionState({
        validateRemote: true,
      });
      expect(state.state).toBe("invalid");
      expect(state.reasonCode).toBe("remote_session_invalid");
      expect(state.session).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).resolves.toContain("not-a-url");

      Reflect.deleteProperty(
        process.env,
        "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
      );
    });
  });

  it("pins Better Auth /get-session as id-only with no expanded organization", () => {
    // Real captured GET /api/auth/get-session body (better-auth 1.6.23
    // organization plugin, default config), captured from a real betterAuth
    // instance. The session carries only activeOrganizationId; there is no
    // expanded organization object anywhere, so no slug/name can be read from
    // this payload. This fixture pins that contract so no future parser is
    // written against a shape Better Auth never returns (anti-pattern #9).
    const realGetSessionResponse = {
      session: {
        id: "0c1f16d7-3986-4706-badb-0b92c9c0154e",
        token: "CvJzJf8DWx8jQhMdmCr3WAQAFnN3VfjJ",
        userId: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
        activeOrganizationId: "5ccb175d-2eef-4e6e-a6f9-b25a1e66d359",
        expiresAt: "2026-07-14T03:13:22.505Z",
        createdAt: "2026-07-07T03:13:22.505Z",
        updatedAt: "2026-07-07T03:13:22.505Z",
        ipAddress: "127.0.0.1",
        userAgent: "",
      },
      user: {
        id: "6707746e-6b5c-43a0-b14f-0fc720fa6713",
        name: "Probe User",
        email: "probe@example.com",
        emailVerified: true,
        image: null,
        username: null,
        displayUsername: null,
        createdAt: "2026-07-07T03:13:22.453Z",
        updatedAt: "2026-07-07T03:13:22.453Z",
      },
    };

    expect(
      readActiveOrganizationIdFromSessionPayload(realGetSessionResponse)
    ).toBe("5ccb175d-2eef-4e6e-a6f9-b25a1e66d359");
    expect(realGetSessionResponse.session).not.toHaveProperty(
      "activeOrganization"
    );
    expect(realGetSessionResponse).not.toHaveProperty("activeOrganization");
  });
});
