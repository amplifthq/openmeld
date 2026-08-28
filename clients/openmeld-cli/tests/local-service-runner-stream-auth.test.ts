import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthSessionStateMock } = vi.hoisted(() => ({
  getAuthSessionStateMock: vi.fn(),
}));

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: (...args: Parameters<typeof getAuthSessionStateMock>) =>
    getAuthSessionStateMock(...args),
}));

import type { StoredAuthSession } from "../src/config/auth-session";
import { resolveDaemonStreamAuthContext } from "../src/local-service/carrier/service-runner";

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

describe("resolveDaemonStreamAuthContext", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
  });

  it("returns ready with an Authorization header for a compatible session", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: sessionWith({}),
    });

    const context = await resolveDaemonStreamAuthContext({
      requestUrl: DAEMON_STREAM_URL,
      selectedOpenMeldProfile: null,
    });

    expect(context.status).toBe("ready");
    if (context.status !== "ready") {
      throw new Error("expected ready context");
    }
    expect(context.headers.Authorization).toBe("Bearer stored-token");
    expect(getAuthSessionStateMock).toHaveBeenCalledWith({
      refreshExpired: true,
    });
  });

  it("fails closed instead of dialing bare when the auth host is incompatible", async () => {
    // The production incident shape: a locally valid session whose
    // authBaseUrl cannot authenticate wss://gateway.openmeld.invalid. The connect path
    // must report authentication_required locally, never send a handshake
    // without Authorization.
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: sessionWith({ authBaseUrl: "http://localhost:8788" }),
    });

    const context = await resolveDaemonStreamAuthContext({
      requestUrl: DAEMON_STREAM_URL,
      selectedOpenMeldProfile: null,
    });

    expect(context.status).toBe("authentication_required");
    if (context.status !== "authentication_required") {
      throw new Error("expected authentication_required context");
    }
    expect(context.authState).toBe("invalid");
    expect(context.credentialFailure).toEqual({
      status: "dropped",
      reason: "host_mismatch",
      requestHost: "gateway.openmeld.invalid",
      authHost: "localhost:8788",
      expectedGatewayHost: null,
    });
  });

  it("fails closed when the stored token is blank", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "valid",
      session: sessionWith({ accessToken: "   " }),
    });

    const context = await resolveDaemonStreamAuthContext({
      requestUrl: DAEMON_STREAM_URL,
      selectedOpenMeldProfile: null,
    });

    expect(context.status).toBe("authentication_required");
    if (context.status !== "authentication_required") {
      throw new Error("expected authentication_required context");
    }
    expect(context.authState).toBe("invalid");
    expect(context.credentialFailure?.reason).toBe("empty_token");
  });

  it("keeps the plain authentication_required shape when no session exists", async () => {
    getAuthSessionStateMock.mockResolvedValue({
      state: "missing",
      session: null,
    });

    const context = await resolveDaemonStreamAuthContext({
      requestUrl: DAEMON_STREAM_URL,
      selectedOpenMeldProfile: null,
    });

    expect(context.status).toBe("authentication_required");
    if (context.status !== "authentication_required") {
      throw new Error("expected authentication_required context");
    }
    expect(context.authState).toBe("missing");
    expect(context.credentialFailure).toBeUndefined();
  });
});
