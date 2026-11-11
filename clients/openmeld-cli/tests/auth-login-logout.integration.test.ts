import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  bestEffortStopCurrentLaneDaemonServiceMock,
  runDaemonServiceParticipationGateMock,
} = vi.hoisted(() => ({
  bestEffortStopCurrentLaneDaemonServiceMock: vi.fn(),
  runDaemonServiceParticipationGateMock: vi.fn(),
}));

vi.mock("../src/commands/service", () => ({
  bestEffortStopCurrentLaneDaemonService: (...args: unknown[]) =>
    bestEffortStopCurrentLaneDaemonServiceMock(...args),
}));

vi.mock("../src/system/local-service-participation-gate", () => ({
  runDaemonServiceParticipationGate: (...args: unknown[]) =>
    runDaemonServiceParticipationGateMock(...args),
}));

import { runAuthLogin, runAuthLogout } from "../src/commands/auth";
import {
  beginAuthSessionTransition,
  getAuthSession,
  setAuthSession,
} from "../src/config/auth-session";
import {
  acquireDaemonServiceLifecycleLock,
  releaseDaemonServiceLifecycleLock,
} from "../src/config/daemon-state";
import {
  getSelectedOpenMeldProfileId,
  setSelectedOpenMeldProfileId,
} from "../src/config/openmeld-profile-selection";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("auth login/logout commands", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  it("completes login flow and persists auth session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          device_code: "device-code-1",
          user_code: "ABCD1234",
          verification_uri: "https://auth.openmeld.invalid/device",
          verification_uri_complete:
            "https://auth.openmeld.invalid/device?user_code=ABCD1234",
          expires_in: 1800,
          interval: 5,
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: "access-token-1",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email",
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          session: { id: "session-1" },
          user: {
            id: "user-1",
            email: "you@company.com",
            name: "Felix",
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        const { stdout } = await withCapturedStdio(() =>
          runAuthLogin({
            view: "human",
            open: false,
            authUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
          })
        );

        expect(stdout).toContain("Welcome you@company.com");
        const session = await getAuthSession();
        expect(session).not.toBeNull();
        expect(session?.accessToken).toBe("access-token-1");
        expect(session?.tokenType).toBe("Bearer");
        expect(session?.authBaseUrl).toBe("https://auth.openmeld.invalid");
        expect(session?.clientId).toBe("openmeld-cli");
        expect(session?.scope).toBe("openid profile email");
        expect(session?.user?.id).toBe("user-1");
        expect(session?.user?.email).toBe("you@company.com");
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://auth.openmeld.invalid/api/auth/device/code"
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://auth.openmeld.invalid/api/auth/device/token"
    );
    expect(String(fetchMock.mock.calls[2]?.[0])).toBe(
      "https://auth.openmeld.invalid/api/auth/get-session"
    );
  });

  it("verifies one-time token and persists auth session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse(
        {
          session: {
            id: "session-ott-1",
            expiresAt: "2099-02-23T00:00:00.000Z",
          },
          user: {
            id: "user-ott-1",
            email: "ott@company.com",
            name: "OTT User",
          },
        },
        200,
        {
          "set-auth-token": "access-token-ott-1",
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        const { stdout } = await withCapturedStdio(() =>
          runAuthLogin({
            view: "human",
            authUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            method: "ott",
            ott: "OTT_TOKEN_123",
          })
        );

        expect(stdout).toContain("Welcome ott@company.com");
        const session = await getAuthSession();
        expect(session).not.toBeNull();
        expect(session?.accessToken).toBe("access-token-ott-1");
        expect(session?.tokenType).toBe("Bearer");
        expect(session?.authBaseUrl).toBe("https://auth.openmeld.invalid");
        expect(session?.clientId).toBe("openmeld-cli");
        expect(session?.user?.id).toBe("user-ott-1");
        expect(session?.user?.email).toBe("ott@company.com");
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://auth.openmeld.invalid/api/auth/one-time-token/verify"
    );
  });

  it.each([
    "login",
    "logout",
  ] as const)("finishes an interrupted Computer recovery whose previous sign-in expired before %s", async (command) => {
    // Captured from the real Auth Worker (better-auth 1.6.30): get-session
    // for an expired or deleted session is 200 `null`; sign-out with an
    // unknown, expired, or deleted bearer is 200 success.
    const authRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL, init?: RequestInit) => {
        const pathname = new URL(String(url)).pathname;
        authRequests.push(
          `${pathname} ${String(new Headers(init?.headers).get("authorization"))}`
        );
        if (pathname === "/api/auth/one-time-token/verify") {
          return Promise.resolve(
            createJsonResponse(
              {
                session: { expiresAt: "2099-02-23T00:00:00.000Z" },
                user: { id: "replacement-owner", email: "next@company.com" },
              },
              200,
              { "set-auth-token": "replacement-token" }
            )
          );
        }
        return Promise.resolve(
          createJsonResponse(
            pathname === "/api/auth/sign-out" ? { success: true } : null
          )
        );
      })
    );
    bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
      status: "stopped",
    });

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "previous-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          expiresAt: "2026-01-01T00:00:00.000Z",
          user: { id: "previous-owner" },
        });
        const failedHandoff = await beginAuthSessionTransition(
          {
            accessToken: "candidate-token",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            user: { id: "candidate-owner" },
          },
          {
            computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid" },
          }
        );
        await failedHandoff.rollback();
        const transitionPath = join(
          home,
          ".openmeld",
          "auth",
          "session-transition.json"
        );
        await expect(readFile(transitionPath, "utf8")).resolves.toContain(
          '"state": "recovery_required"'
        );

        await withCapturedStdio(async () => {
          if (command === "login") {
            await runAuthLogin({
              view: "agent",
              authUrl: "https://auth.openmeld.invalid",
              clientId: "openmeld-cli",
              method: "ott",
              ott: "OTT_TOKEN_123",
            });
            return;
          }
          await runAuthLogout({ view: "agent" });
        });

        expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
        expect(authRequests.slice(0, 2)).toEqual([
          "/api/auth/get-session Bearer previous-token",
          "/api/auth/sign-out Bearer candidate-token",
        ]);
        await expect(readFile(transitionPath, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        const session = await getAuthSession();
        if (command === "login") {
          expect(session).toMatchObject({
            accessToken: "replacement-token",
            user: { id: "replacement-owner" },
          });
        } else {
          expect(session).toBeNull();
        }
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });
  });

  it("asks the user to wait, not to sign in, while another setup owns the transition", async () => {
    bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
      status: "stopped",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "previous-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "previous-owner" },
        });
        // A live setup in this process still owns its pending transition.
        const activeSetup = await beginAuthSessionTransition(
          {
            accessToken: "candidate-token",
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            user: { id: "candidate-owner" },
          },
          {
            computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid" },
          }
        );
        try {
          const failure = await withCapturedStdio(() =>
            runAuthLogin({
              view: "agent",
              authUrl: "https://auth.openmeld.invalid",
              clientId: "openmeld-cli",
              method: "ott",
              ott: "OTT_TOKEN_123",
            })
          ).catch((error: unknown) => error);
          expect(failure).toMatchObject({
            message: expect.stringContaining("Wait for that setup to finish"),
          });
          expect(String((failure as Error).message)).not.toContain(
            "openmeld login"
          );
          expect(fetchMock).not.toHaveBeenCalled();
          expect(runDaemonServiceParticipationGateMock).not.toHaveBeenCalled();
        } finally {
          await activeSetup.rollback();
        }
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });
  });

  it("explains stale one-time token sessions without exposing auth internals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({ message: "Session not found" }, 400)
      );
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "human",
          authUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          method: "ott",
          ott: "STALE_OTT_TOKEN",
        });
      } catch (error) {
        thrown = error;
      }
    });

    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("one-time token session is no longer valid");
    expect(message).toContain("copy a fresh command");
    expect(message).not.toContain("Session not found");
  });

  it("fails closed when one-time token sign-in cannot be reloaded as a local account session", async () => {
    const fetchMock = vi.fn((request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith("/api/auth/one-time-token/verify")) {
        return createJsonResponse(
          {
            session: {
              id: "session-ott-missing-user",
              expiresAt: "2099-02-23T00:00:00.000Z",
            },
          },
          200,
          {
            "set-auth-token": "access-token-ott-missing-user",
          }
        );
      }
      if (url.endsWith("/api/auth/get-session")) {
        return createJsonResponse({
          session: {
            id: "session-ott-missing-user",
            expiresAt: "2099-02-23T00:00:00.000Z",
          },
        });
      }
      if (url.endsWith("/api/auth/sign-out")) {
        return createJsonResponse({ ok: true });
      }
      throw new Error(`Unexpected auth request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await withCapturedStdio(async () => {
          try {
            await runAuthLogin({
              view: "human",
              authUrl: "https://auth.openmeld.invalid",
              clientId: "openmeld-cli",
              method: "ott",
              ott: "OTT_TOKEN_WITHOUT_USER",
            });
          } catch (error) {
            thrown = error;
          }
        });
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });

    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain(
      "computer authorization account response was invalid"
    );
    expect(thrown).toMatchObject({
      endpoint: "https://auth.openmeld.invalid/api/auth/get-session",
      name: "AuthDeviceSessionClientError",
      operation: "read_auth_session",
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      "https://auth.openmeld.invalid/api/auth/one-time-token/verify",
      "https://auth.openmeld.invalid/api/auth/get-session",
      "https://auth.openmeld.invalid/api/auth/sign-out",
    ]);
  });

  it("preserves the one-time-token account error when candidate revocation also fails", async () => {
    const fetchMock = vi.fn((request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith("/api/auth/one-time-token/verify")) {
        return createJsonResponse(
          { session: { id: "session-ott-cleanup-failure" } },
          200,
          { "set-auth-token": "access-token-ott-cleanup-failure" }
        );
      }
      if (url.endsWith("/api/auth/get-session")) {
        return createJsonResponse(
          { message: "Auth session lookup unavailable" },
          503
        );
      }
      if (url.endsWith("/api/auth/sign-out")) {
        return createJsonResponse({ message: "Auth cleanup unavailable" }, 503);
      }
      throw new Error(`Unexpected auth request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "human",
          authUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          method: "ott",
          ott: "OTT_TOKEN_WITH_FAILED_CLEANUP",
        });
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toMatchObject({
      cause: {
        endpoint: "https://auth.openmeld.invalid/api/auth/get-session",
        name: "AuthDeviceSessionClientError",
        operation: "read_auth_session",
        status: 503,
      },
      cleanup: {
        endpoint: "https://auth.openmeld.invalid/api/auth/sign-out",
        status: 503,
      },
      name: "OneTimeTokenCandidateSessionCleanupError",
    });
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("computer authorization account request failed");
    expect(message).toContain(
      "cleanup failed at https://auth.openmeld.invalid/api/auth/sign-out (HTTP 503)"
    );
    expect(message).not.toContain("access-token-ott-cleanup-failure");
  });

  it("keeps the previous account and revokes the OTT candidate when local save fails", async () => {
    let authDirectory = "";
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith("/api/auth/one-time-token/verify")) {
        await chmod(authDirectory, 0o500);
        return createJsonResponse(
          {
            session: {
              id: "session-ott-save-failure",
              expiresAt: "2099-02-23T00:00:00.000Z",
            },
            user: {
              id: "candidate-owner",
              email: "candidate@example.com",
            },
          },
          200,
          { "set-auth-token": "access-token-ott-save-failure" }
        );
      }
      if (url.endsWith("/api/auth/sign-out")) {
        return createJsonResponse({ ok: true });
      }
      throw new Error(`Unexpected auth request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      authDirectory = join(home, ".openmeld", "auth");
      await setAuthSession({
        accessToken: "previous-token-before-save-failure",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "previous-owner" },
      });
      try {
        await withCapturedStdio(async () => {
          try {
            await runAuthLogin({
              view: "human",
              authUrl: "https://auth.openmeld.invalid",
              clientId: "openmeld-cli",
              method: "ott",
              ott: "OTT_TOKEN_WITH_LOCAL_SAVE_FAILURE",
            });
          } catch (error) {
            thrown = error;
          }
        });
      } finally {
        await chmod(authDirectory, 0o700);
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "previous-token-before-save-failure",
        user: { id: "previous-owner" },
      });
    });

    expect(thrown).toMatchObject({ code: "EACCES" });
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      "https://auth.openmeld.invalid/api/auth/one-time-token/verify",
      "https://auth.openmeld.invalid/api/auth/sign-out",
    ]);
    expect(thrown instanceof Error ? thrown.message : "").not.toContain(
      "access-token-ott-save-failure"
    );
  });

  it("restores the previous account when OTT post-save verification fails", async () => {
    const fetchMock = vi.fn((request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith("/api/auth/one-time-token/verify")) {
        return createJsonResponse(
          {
            session: {
              id: "session-ott-post-save-failure",
              expiresAt: "2000-01-01T00:00:00.000Z",
            },
            user: {
              id: "candidate-owner",
              email: "candidate@example.com",
            },
          },
          200,
          { "set-auth-token": "access-token-ott-post-save-failure" }
        );
      }
      if (url.endsWith("/api/auth/sign-out")) {
        return createJsonResponse({ message: "Auth cleanup unavailable" }, 503);
      }
      throw new Error(`Unexpected auth request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "previous-token-before-post-save-failure",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "previous-owner" },
        });

        await withCapturedStdio(async () => {
          try {
            await runAuthLogin({
              view: "human",
              authUrl: "https://auth.openmeld.invalid",
              clientId: "openmeld-cli",
              method: "ott",
              ott: "OTT_TOKEN_WITH_POST_SAVE_FAILURE",
            });
          } catch (error) {
            thrown = error;
          }
        });

        await expect(getAuthSession()).resolves.toMatchObject({
          accessToken: "previous-token-before-post-save-failure",
          user: { id: "previous-owner" },
        });
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });

    expect(thrown).toMatchObject({
      cause: {
        code: "session_not_saved",
        name: "OneTimeTokenAuthError",
      },
      cleanup: {
        endpoint: "https://auth.openmeld.invalid/api/auth/sign-out",
        status: 503,
      },
      name: "OneTimeTokenCandidateSessionCleanupError",
    });
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("could not save a usable local sign-in session");
    expect(message).toContain(
      "cleanup failed at https://auth.openmeld.invalid/api/auth/sign-out (HTTP 503)"
    );
    expect(message).not.toContain("access-token-ott-post-save-failure");
    expect(fetchMock.mock.calls.map(([request]) => String(request))).toEqual([
      "https://auth.openmeld.invalid/api/auth/one-time-token/verify",
      "https://auth.openmeld.invalid/api/auth/sign-out",
    ]);
  });

  it("accepts ott-only login in agent view", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse(
        {
          session: {
            id: "session-ott-agent-1",
            expiresAt: "2099-02-23T00:00:00.000Z",
          },
          user: {
            id: "user-ott-agent-1",
            email: "ott-agent@company.com",
            name: "OTT Agent User",
          },
        },
        200,
        {
          "set-auth-token": "access-token-ott-agent-1",
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        const { stdout } = await withCapturedStdio(() =>
          runAuthLogin({
            view: "agent",
            authUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            ott: "OTT_TOKEN_AGENT_123",
          })
        );

        expect(stdout).toContain('"code":"auth.login.agent_overview"');
        expect(stdout).toContain('"code":"auth.login.success"');
        const session = await getAuthSession();
        expect(session?.accessToken).toBe("access-token-ott-agent-1");
        expect(session?.user?.email).toBe("ott-agent@company.com");
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://auth.openmeld.invalid/api/auth/one-time-token/verify"
    );
  });

  it("fails closed in agent view when login method is not explicit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    const { stdout } = await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "agent",
          authUrl: "https://auth.openmeld.invalid",
        });
      } catch (error) {
        thrown = error;
      }
    });
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("sign-in requires `--ott <token>`");
    expect(message).toContain("[FOR HUMAN OPERATORS]");
    expect(message).toContain("[FOR AGENTS]");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stdout).toContain('"code":"auth.login.ott.required"');
    expect(stdout).toContain('"method":"ott"');
  });

  it("shows ott guidance in agent view when --method ott is missing token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    const { stdout } = await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "agent",
          authUrl: "https://auth.openmeld.invalid",
          method: "ott",
        });
      } catch (error) {
        thrown = error;
      }
    });
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("sign-in requires `--ott <token>`");
    expect(message).toContain("[FOR HUMAN OPERATORS]");
    expect(message).toContain("[FOR AGENTS]");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stdout).toContain('"code":"auth.login.ott.required"');
    expect(stdout).toContain('"method":"ott"');
  });

  it("renders openmeld-dev ott guidance when the dev shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let thrown: unknown = null;
    const { stdout } = await withCapturedStdio(async () => {
      try {
        await runAuthLogin({
          view: "agent",
          authUrl: "https://auth.openmeld.invalid",
          method: "ott",
        });
      } catch (error) {
        thrown = error;
      }
    });

    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("sign-in requires `--ott <token>`");
    expect(stdout).toContain("openmeld-dev login --view agent --ott <token>");
    expect(stdout).toContain(
      "openmeld-dev login --view agent --method device --no-open"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears existing session on logout", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
          status: "stopped",
          pid: 222,
          signal: "SIGTERM",
        });
        await setAuthSession({
          accessToken: "token-logout",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });
        process.env.OPENMELD_CLI_CONTEXT_ID = "logout-session";
        await setSelectedOpenMeldProfileId("agt_logout");

        const { stdout } = await withCapturedStdio(() =>
          runAuthLogout({ view: "human" })
        );

        expect(stdout).toContain(
          "Local sign-out cleanup finished for your local OpenMeld."
        );
        expect(stdout).toContain("Signed out on this device.");
        await expect(getAuthSession()).resolves.toBeNull();
        await expect(getSelectedOpenMeldProfileId()).resolves.toBeNull();
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });
  });

  it("still clears selected profiles and reports no-session after lane-local cleanup", async () => {
    await withTempHome(async () => {
      bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
        status: "not_running",
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
      });
      process.env.OPENMELD_CLI_CONTEXT_ID = "logout-no-session";
      await setSelectedOpenMeldProfileId("agt_stale");

      const { stdout } = await withCapturedStdio(() =>
        runAuthLogout({ view: "human" })
      );

      expect(stdout).toContain("Local sign-out cleanup finished");
      expect(stdout).toContain("No local sign-in session found.");
      await expect(getSelectedOpenMeldProfileId()).resolves.toBeNull();
    });
  });

  it("clears an unreadable Keychain-backed session so the user can sign in again", async () => {
    await withTempHome(async (home) => {
      bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
        status: "not_running",
        runtimeStatus: {
          status: "not_running",
          mode: null,
          pid: null,
          startedAt: null,
          updatedAt: null,
          managedBySystemService: false,
          serviceController: "unknown",
          autoStart: false,
        },
      });
      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        sessionPath,
        `${JSON.stringify({
          v: 1,
          tokenRef: {
            provider: "macos-keychain",
            service: "sh.openmeld.auth.token",
            account: "openmeld-auth-unreadable",
          },
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: new Date().toISOString(),
        })}\n`,
        "utf8"
      );

      await expect(getAuthSession()).resolves.toBeNull();
      const { stdout } = await withCapturedStdio(() =>
        runAuthLogout({ view: "human" })
      );

      expect(stdout).toContain("Signed out on this device.");
      await expect(readFile(sessionPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("continues logout and emits cleanup warning when service stop needs attention", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        bestEffortStopCurrentLaneDaemonServiceMock.mockResolvedValue({
          status: "warning",
          pid: 333,
          reason: "process_timeout",
          runtimeStatus: {
            status: "running",
            mode: "background",
            pid: 333,
            startedAt: "2026-03-11T00:00:00.000Z",
            updatedAt: "2026-03-11T00:00:00.000Z",
            managedBySystemService: false,
            serviceController: "legacy-detached",
            autoStart: false,
          },
        });
        await setAuthSession({
          accessToken: "token-warning",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });
        process.env.OPENMELD_CLI_CONTEXT_ID = "logout-warning";
        await setSelectedOpenMeldProfileId("agt_warning");

        const { stdout } = await withCapturedStdio(() =>
          runAuthLogout({ view: "human" })
        );

        expect(stdout).toContain("Local sign-out cleanup needs attention");
        expect(stdout).toContain("openmeld service stop --force");
        expect(stdout).toContain("Signed out on this device.");
        await expect(getAuthSession()).resolves.toBeNull();
        await expect(getSelectedOpenMeldProfileId()).resolves.toBeNull();
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });
  });

  it("still clears the session when a canonical service registration writer is active", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      process.env.OPENMELD_ENV_PRESET = "prod";
      const laneRoot = process.env.OPENMELD_HOME;
      process.env.OPENMELD_HOME = join(home, "isolated-reconcile-root");
      const lifecycleWriter = await acquireDaemonServiceLifecycleLock({
        intent: "upgrade_reconcile",
        command: "OpenMeld Service registration reconcile",
      });

      try {
        process.env.OPENMELD_HOME = laneRoot;
        const actualServiceModule = await vi.importActual<
          typeof import("../src/commands/service")
        >("../src/commands/service");
        bestEffortStopCurrentLaneDaemonServiceMock.mockImplementation(
          actualServiceModule.bestEffortStopCurrentLaneDaemonService
        );
        await setAuthSession({
          accessToken: "token-lock-contention",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });

        const { stdout } = await withCapturedStdio(() =>
          runAuthLogout({ view: "human" })
        );

        expect(stdout).toContain("Local sign-out cleanup needs attention");
        expect(stdout).toContain("Signed out on this device.");
        await expect(getAuthSession()).resolves.toBeNull();
      } finally {
        bestEffortStopCurrentLaneDaemonServiceMock.mockReset();
        await releaseDaemonServiceLifecycleLock(lifecycleWriter);
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });
  });
});

function createJsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  });
}
