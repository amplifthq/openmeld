import { afterEach, describe, expect, it, vi } from "vitest";
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: "computer-session-token",
          token_type: "Bearer",
          expires_in: 604_800,
          scope: "openid profile email",
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          session: { id: "computer-session" },
          user: {
            id: "user-browser",
            email: "browser@example.com",
          },
        })
      );
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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: "unverified-computer-session-token",
          token_type: "Bearer",
          expires_in: 604_800,
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          session: { id: "computer-session" },
          user: null,
        })
      )
      .mockResolvedValueOnce(createJsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeComputerAuthorizationGrant({
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        deviceCode: "approved-device-code",
      })
    ).rejects.toThrow(
      "computer authorization did not return an OpenMeld account"
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

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
