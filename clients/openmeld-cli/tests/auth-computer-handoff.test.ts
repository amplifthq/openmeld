import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthDeviceSessionClientError,
  fetchAuthUserSnapshot,
  revokeAuthAccessToken,
} from "../src/commands/auth-device-session-client";
import { exchangeComputerAuthorizationGrant } from "../src/commands/computer-auth-session";
import {
  beginAuthSessionTransition,
  getAuthSession,
  setAuthSession,
} from "../src/config/auth-session";
import { withTempHome } from "./helpers/fs";

describe("computer authorization handoff", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates an independent computer session without replacing the current local account", async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      switch (request) {
        case "POST https://auth.openmeld.invalid/api/auth/device/token":
          return createJsonResponse({
            access_token: "computer-session-token",
            token_type: "Bearer",
            expires_in: 604_800,
            scope: "openid profile email",
          });
        case "GET https://auth.openmeld.invalid/api/auth/get-session":
          return createJsonResponse({
            session: { id: "computer-session" },
            user: {
              id: "user-browser",
              email: "browser@example.com",
            },
          });
        default:
          throw new Error(`Unexpected request: ${request}`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "existing-computer-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: {
            id: "user-existing",
            email: "existing@example.com",
          },
        });

        await expect(
          exchangeComputerAuthorizationGrant({
            authBaseUrl: "https://auth.openmeld.invalid",
            clientId: "openmeld-cli",
            deviceCode: "approved-device-code",
          })
        ).resolves.toMatchObject({
          accessToken: "computer-session-token",
          user: {
            id: "user-browser",
            email: "browser@example.com",
          },
        });

        await expect(getAuthSession()).resolves.toMatchObject({
          accessToken: "existing-computer-token",
          user: { id: "user-existing" },
        });
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://auth.openmeld.invalid/api/auth/device/token",
      expect.objectContaining({
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: "approved-device-code",
          client_id: "openmeld-cli",
        }),
        method: "POST",
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://auth.openmeld.invalid/api/auth/get-session",
      expect.objectContaining({
        headers: {
          authorization: "Bearer computer-session-token",
        },
      })
    );
  });

  it("revokes a newly created computer session when its account cannot be verified", async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      switch (request) {
        case "POST https://auth.openmeld.invalid/api/auth/device/token":
          return createJsonResponse({
            access_token: "unverified-computer-session-token",
            token_type: "Bearer",
            expires_in: 604_800,
            scope: "openid profile email",
          });
        case "GET https://auth.openmeld.invalid/api/auth/get-session":
          return createJsonResponse({
            session: { id: "computer-session" },
            user: null,
          });
        case "POST https://auth.openmeld.invalid/api/auth/sign-out":
          return createJsonResponse({ success: true });
        default:
          throw new Error(`Unexpected request: ${request}`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeComputerAuthorizationGrant({
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        deviceCode: "approved-device-code",
      })
    ).rejects.toThrow(
      "computer authorization account response did not include a user"
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://auth.openmeld.invalid/api/auth/sign-out",
      expect.objectContaining({
        headers: {
          authorization: "Bearer unverified-computer-session-token",
        },
        method: "POST",
      })
    );
  });

  it("preserves account endpoint status and cleanup failure context", async () => {
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      switch (request) {
        case "POST https://auth.openmeld.invalid/api/auth/device/token":
          return createJsonResponse({
            access_token: "unverified-computer-session-token",
            token_type: "Bearer",
            expires_in: 604_800,
            scope: "openid profile email",
          });
        case "GET https://auth.openmeld.invalid/api/auth/get-session":
          return createJsonResponse({ message: "upstream unavailable" }, 503);
        case "POST https://auth.openmeld.invalid/api/auth/sign-out":
          return createJsonResponse({ message: "cleanup unavailable" }, 502);
        default:
          throw new Error(`Unexpected request: ${request}`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeComputerAuthorizationGrant({
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        deviceCode: "approved-device-code",
      })
    ).rejects.toThrow(
      "computer authorization account request failed: upstream unavailable; cleanup failed at https://auth.openmeld.invalid/api/auth/sign-out (HTTP 502): unused computer authorization session could not be revoked: cleanup unavailable"
    );
  });

  it("preserves original network causes for account reads and best-effort revoke", async () => {
    const accountCause = new Error("account socket reset");
    const revokeCause = new Error("revoke socket reset");
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const request = `${init?.method ?? "GET"} ${String(input)}`;
      switch (request) {
        case "GET https://auth.openmeld.invalid/api/auth/get-session":
          return Promise.reject(accountCause);
        case "POST https://auth.openmeld.invalid/api/auth/sign-out":
          return Promise.reject(revokeCause);
        default:
          throw new Error(`Unexpected request: ${request}`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    const accountError = await fetchAuthUserSnapshot({
      accessToken: "computer-session-token",
      authBaseUrl: "https://auth.openmeld.invalid",
    }).catch((error: unknown) => error);
    expect(accountError).toBeInstanceOf(AuthDeviceSessionClientError);
    expect(accountError).toMatchObject({
      endpoint: "https://auth.openmeld.invalid/api/auth/get-session",
      operation: "read_auth_session",
      status: null,
      cause: accountCause,
    });

    const revokeResult = await revokeAuthAccessToken({
      accessToken: "computer-session-token",
      authBaseUrl: "https://auth.openmeld.invalid",
      tokenType: "Bearer",
    });
    expect(revokeResult).toMatchObject({
      ok: false,
      error: {
        endpoint: "https://auth.openmeld.invalid/api/auth/sign-out",
        operation: "revoke_auth_session",
        status: null,
        cause: revokeCause,
      },
    });
  });

  it("restores the previous local account when computer setup fails after the switch starts", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "existing-computer-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: {
            id: "user-existing",
            email: "existing@example.com",
          },
        });

        const transition = await beginAuthSessionTransition({
          accessToken: "candidate-computer-token",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: {
            id: "user-browser",
            email: "browser@example.com",
          },
        });

        await expect(getAuthSession()).resolves.toMatchObject({
          accessToken: "candidate-computer-token",
          user: { id: "user-browser" },
        });

        await transition.rollback();

        await expect(getAuthSession()).resolves.toMatchObject({
          accessToken: "existing-computer-token",
          user: { id: "user-existing" },
        });
      } finally {
        Reflect.deleteProperty(
          process.env,
          "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
        );
      }
    });
  });
});

function createJsonResponse(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}
