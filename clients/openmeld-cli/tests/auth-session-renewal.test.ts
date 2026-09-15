import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAuthSessionState,
  setAuthSession,
  withAdmittedServiceSession,
} from "../src/config/auth-session";
import { withAuthSessionTransitionMutationLock } from "../src/config/auth-session-transition-lock";
import { buildRequestAuthHeaders } from "../src/config/request-headers";
import {
  cancelServiceAccountAdmission,
  reserveServiceAccountAdmission,
} from "../src/config/service-account-admission";
import { withTempHome } from "./helpers/fs";

const AUTH_BASE_URL = "https://auth.openmeld.invalid";
const GATEWAY_URL = "https://gateway.openmeld.invalid/v1/spaces";

function activeSessionResponse(expiresAt: string): Response {
  return new Response(
    JSON.stringify({
      session: {
        id: "session-active",
        token: "token-active",
        userId: "user-active",
        expiresAt,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
        ipAddress: "127.0.0.1",
        userAgent: "openmeld-cli",
      },
      user: {
        id: "user-active",
        name: "Active User",
        email: "active@example.com",
        emailVerified: true,
        image: null,
        username: null,
        displayUsername: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-auth-token": "token-refreshed",
      },
    }
  );
}

async function storeSession(input: {
  accessToken?: string;
  expiresAt: string;
}): Promise<void> {
  await setAuthSession({
    accessToken: input.accessToken ?? "token-active",
    tokenType: "Bearer",
    authBaseUrl: AUTH_BASE_URL,
    clientId: "openmeld-cli",
    expiresAt: input.expiresAt,
    user: {
      id: "user-active",
      email: "active@example.com",
      name: "Active User",
    },
  });
}

describe("auth session renewal", () => {
  it("keeps a bound renewal during admission and persists it after the reservation settles", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await storeSession({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const local = await getAuthSessionState();
      if (!local.session) {
        throw new Error("missing test session");
      }
      const reservation = await withAuthSessionTransitionMutationLock(() =>
        reserveServiceAccountAdmission({
          operation: "start",
          identity: {
            accountId: "user-active",
            authBaseUrl: AUTH_BASE_URL,
            clientId: "openmeld-cli",
            gatewayUrl: GATEWAY_URL,
            lane: "dev-local",
            deviceId: "test",
            contractGeneration: 1,
          },
        })
      );
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            activeSessionResponse(new Date(Date.now() + 600_000).toISOString())
          )
      );
      await withAdmittedServiceSession(local.session, async () => {
        expect(
          (await getAuthSessionState({ validateRemote: true })).session
            ?.accessToken
        ).toBe("token-refreshed");
        expect((await getAuthSessionState()).session?.accessToken).toBe(
          "token-refreshed"
        );
        await cancelServiceAccountAdmission(reservation.id);
        expect((await getAuthSessionState()).session?.accessToken).toBe(
          "token-refreshed"
        );
      });
      expect((await getAuthSessionState()).session?.accessToken).toBe(
        "token-refreshed"
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
  });

  it("keeps an active server session signed in after its local expiry passes", async () => {
    const renewedExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(activeSessionResponse(renewedExpiresAt));
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await storeSession({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const state = await getAuthSessionState({ validateRemote: true });

      expect(state).toMatchObject({
        state: "valid",
        session: {
          accessToken: "token-refreshed",
          expiresAt: renewedExpiresAt,
          user: { id: "user-active" },
        },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${AUTH_BASE_URL}/api/auth/get-session`,
        expect.objectContaining({
          headers: {
            Authorization: "Bearer token-active",
          },
        })
      );

      const persistedSession = JSON.parse(
        await readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ) as { expiresAt?: string };
      expect(persistedSession.expiresAt).toBe(renewedExpiresAt);
    });
  });

  it("keeps attaching the active session when a normal CLI request crosses the local expiry", async () => {
    const renewedExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(activeSessionResponse(renewedExpiresAt));
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await storeSession({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const headers = await buildRequestAuthHeaders({
        requestUrl: GATEWAY_URL,
      });

      expect(headers.Authorization).toBe("Bearer token-refreshed");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not add a remote validation request while the local expiry is still current", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await storeSession({
        accessToken: "token-current",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const headers = await buildRequestAuthHeaders({
        requestUrl: GATEWAY_URL,
      });

      expect(headers.Authorization).toBe("Bearer token-current");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("does not attach a known-expired credential when renewal is temporarily unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("temporary auth failure", { status: 500 })
      );
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await storeSession({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      await expect(
        buildRequestAuthHeaders({
          requestUrl: GATEWAY_URL,
        })
      ).rejects.toMatchObject({
        name: "AuthRequestCredentialError",
        reason: "session_expired",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("does not overwrite a newer login with a late renewal response", async () => {
    const renewedExpiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await storeSession({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const newLoginExpiresAt = new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000
      ).toISOString();
      const fetchMock = vi.fn().mockImplementation(async () => {
        await storeSession({
          accessToken: "token-new-login",
          expiresAt: newLoginExpiresAt,
        });
        return activeSessionResponse(renewedExpiresAt);
      });
      vi.stubGlobal("fetch", fetchMock);

      const state = await getAuthSessionState({ validateRemote: true });

      expect(state).toMatchObject({
        state: "valid",
        session: {
          accessToken: "token-new-login",
          expiresAt: newLoginExpiresAt,
        },
      });
    });
  });
});
