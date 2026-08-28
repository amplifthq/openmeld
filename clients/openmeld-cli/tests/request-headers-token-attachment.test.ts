import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredAuthSession } from "../src/config/auth-session";
import {
  type AuthRequestCredentialError,
  buildRequestAuthHeaders,
  canAttachAuthTokenToRequest,
  resolveAuthTokenAttachment,
} from "../src/config/request-headers";

const DAEMON_STREAM_URL = "wss://gateway.openmeld.invalid/v1/daemon/stream";

function sessionWith(input: {
  accessToken?: string;
  authBaseUrl?: string;
  expiresAt?: string;
}): StoredAuthSession {
  return {
    v: 1,
    accessToken: input.accessToken ?? "stored-token",
    tokenType: "Bearer",
    authBaseUrl: input.authBaseUrl ?? "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  };
}

describe("resolveAuthTokenAttachment", () => {
  it("returns the token for a compatible session", () => {
    const attachment = resolveAuthTokenAttachment({
      session: sessionWith({}),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(attachment).toEqual({
      status: "attachable",
      token: "stored-token",
      tokenType: "Bearer",
    });
  });

  it("reports empty_token with host context when the token is blank", () => {
    const attachment = resolveAuthTokenAttachment({
      session: sessionWith({ accessToken: "   " }),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(attachment).toEqual({
      status: "dropped",
      reason: "empty_token",
      requestHost: "gateway.openmeld.invalid",
      authHost: "auth.openmeld.invalid",
      expectedGatewayHost: "gateway.openmeld.invalid",
    });
  });

  it("reports host_mismatch with host context for an incompatible session", () => {
    const attachment = resolveAuthTokenAttachment({
      session: sessionWith({ authBaseUrl: "http://localhost:8788" }),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(attachment).toEqual({
      status: "dropped",
      reason: "host_mismatch",
      requestHost: "gateway.openmeld.invalid",
      authHost: "localhost:8788",
      expectedGatewayHost: null,
    });
  });

  it("reports session_expired for an explicitly supplied expired session", () => {
    const attachment = resolveAuthTokenAttachment({
      session: sessionWith({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(attachment).toEqual({
      status: "dropped",
      reason: "session_expired",
      requestHost: "gateway.openmeld.invalid",
      authHost: "auth.openmeld.invalid",
      expectedGatewayHost: "gateway.openmeld.invalid",
    });
  });

  it("fails closed when an explicitly supplied session expiry is invalid", () => {
    const attachment = resolveAuthTokenAttachment({
      session: sessionWith({ expiresAt: "not-a-date" }),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(attachment).toEqual({
      status: "dropped",
      reason: "session_expiry_invalid",
      requestHost: "gateway.openmeld.invalid",
      authHost: "auth.openmeld.invalid",
      expectedGatewayHost: "gateway.openmeld.invalid",
    });
  });

  it("preserves host mismatch diagnostics before checking expiry", () => {
    const attachment = resolveAuthTokenAttachment({
      session: sessionWith({
        authBaseUrl: "http://localhost:8788",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(attachment).toEqual({
      status: "dropped",
      reason: "host_mismatch",
      requestHost: "gateway.openmeld.invalid",
      authHost: "localhost:8788",
      expectedGatewayHost: null,
    });
  });

  it("uses the same expiry decision for non-header request gates", () => {
    expect(
      canAttachAuthTokenToRequest(
        sessionWith({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        DAEMON_STREAM_URL
      )
    ).toBe(false);
  });
});

describe("buildRequestAuthHeaders credential failures", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("does not warn when the token attaches", async () => {
    const headers = await buildRequestAuthHeaders({
      authSession: sessionWith({}),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(headers.Authorization).toBe("Bearer stored-token");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("throws locally with host context when credentials cannot attach", async () => {
    const request = buildRequestAuthHeaders({
      authSession: sessionWith({ authBaseUrl: "http://localhost:8788" }),
      requestUrl: DAEMON_STREAM_URL,
    });

    await expect(request).rejects.toMatchObject({
      name: "AuthRequestCredentialError",
      reason: "host_mismatch",
      requestHost: "gateway.openmeld.invalid",
      authHost: "localhost:8788",
      expectedGatewayHost: null,
    } satisfies Partial<AuthRequestCredentialError>);
    expect(errorSpy).toHaveBeenCalledWith(
      "[openmeld.auth.request_credential_rejected]",
      expect.objectContaining({ reason: "host_mismatch" })
    );
  });

  it("throws locally for an explicitly supplied expired token", async () => {
    await expect(
      buildRequestAuthHeaders({
        authSession: sessionWith({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
        requestUrl: DAEMON_STREAM_URL,
      })
    ).rejects.toMatchObject({
      name: "AuthRequestCredentialError",
      reason: "session_expired",
    } satisfies Partial<AuthRequestCredentialError>);
  });

  it("throws locally for malformed credential expiry", async () => {
    await expect(
      buildRequestAuthHeaders({
        authSession: sessionWith({ expiresAt: "not-a-date" }),
        requestUrl: DAEMON_STREAM_URL,
      })
    ).rejects.toMatchObject({
      name: "AuthRequestCredentialError",
      reason: "session_expiry_invalid",
    } satisfies Partial<AuthRequestCredentialError>);
  });

  it("does not warn when the caller is knowingly unauthenticated", async () => {
    const headers = await buildRequestAuthHeaders({
      authSession: null,
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(headers.Authorization).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
