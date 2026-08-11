import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredAuthSession } from "../src/config/auth-session";
import {
  buildRequestAuthHeaders,
  resolveAuthTokenAttachment,
} from "../src/config/request-headers";

const DAEMON_STREAM_URL = "wss://gateway.openmeld.invalid/v1/daemon/stream";

function sessionWith(input: {
  accessToken?: string;
  authBaseUrl?: string;
}): StoredAuthSession {
  return {
    v: 1,
    accessToken: input.accessToken ?? "stored-token",
    tokenType: "Bearer",
    authBaseUrl: input.authBaseUrl ?? "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-07-01T00:00:00.000Z",
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
});

describe("buildRequestAuthHeaders drop diagnostics", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does not warn when the token attaches", async () => {
    const headers = await buildRequestAuthHeaders({
      authSession: sessionWith({}),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(headers.Authorization).toBe("Bearer stored-token");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns with the compatibility reason when the token is dropped", async () => {
    const headers = await buildRequestAuthHeaders({
      authSession: sessionWith({ authBaseUrl: "http://localhost:8788" }),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(headers.Authorization).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[openmeld.auth.request_token_dropped]",
      {
        authHost: "localhost:8788",
        expectedGatewayHost: null,
        reason: "host_mismatch",
        requestHost: "gateway.openmeld.invalid",
      }
    );
  });

  it("does not warn when the caller is knowingly unauthenticated", async () => {
    const headers = await buildRequestAuthHeaders({
      authSession: null,
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(headers.Authorization).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
