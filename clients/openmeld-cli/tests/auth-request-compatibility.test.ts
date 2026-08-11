import { describe, expect, it } from "vitest";
import { resolveAuthRequestCompatibility } from "../src/config/auth-request-compatibility";
import type { StoredAuthSession } from "../src/config/auth-session";

const DAEMON_STREAM_URL = "wss://gateway.openmeld.invalid/v1/daemon/stream";

function sessionWithAuthBaseUrl(authBaseUrl: string): StoredAuthSession {
  return {
    v: 1,
    accessToken: "stored-token",
    tokenType: "Bearer",
    authBaseUrl,
    clientId: "openmeld-cli",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

// Every authBaseUrl form the login flows can persist, checked against the
// production daemon stream URL. setAuthSession only ever receives
// resolveAuthBaseUrl output: an explicit --auth-url flag, OPENMELD_AUTH_URL from
// the environment (the web bootstrap script injects it for non-prod lanes
// only), or the preset default (https://auth.openmeld.invalid for prod,
// http://localhost:8788 for dev-local/canary).
describe("resolveAuthRequestCompatibility for the daemon stream URL", () => {
  it("accepts the prod default auth base URL as a gateway sibling", () => {
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("https://auth.openmeld.invalid"),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(result.compatible).toBe(true);
    expect(result.reason).toBe("gateway_sibling");
    expect(result.requestHost).toBe("gateway.openmeld.invalid");
    expect(result.authHost).toBe("auth.openmeld.invalid");
    expect(result.expectedGatewayHost).toBe("gateway.openmeld.invalid");
  });

  it("accepts the prod default auth base URL for gateway HTTP requests", () => {
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("https://auth.openmeld.invalid"),
      requestUrl: "https://gateway.openmeld.invalid/v1/devices/current",
    });

    expect(result.compatible).toBe(true);
    expect(result.reason).toBe("gateway_sibling");
  });

  it("accepts a custom auth.* base URL against its gateway sibling", () => {
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("https://auth.internal.example"),
      requestUrl: "wss://gateway.internal.example/v1/daemon/stream",
    });

    expect(result.compatible).toBe(true);
    expect(result.reason).toBe("gateway_sibling");
  });

  it("accepts the dev-local default against a loopback gateway", () => {
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("http://localhost:8788"),
      requestUrl: "ws://localhost:8787/v1/daemon/stream",
    });

    expect(result.compatible).toBe(true);
    expect(result.reason).toBe("loopback");
  });

  it("rejects the dev-local default against the prod daemon stream", () => {
    // A session written by a dev-local/canary sign-in cannot authenticate a
    // prod gateway dial. This is the lane-mix shape that must fail closed
    // locally instead of dialing bare and collecting a remote 401.
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("http://localhost:8788"),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe("host_mismatch");
    expect(result.requestHost).toBe("gateway.openmeld.invalid");
    expect(result.authHost).toBe("localhost:8788");
    expect(result.expectedGatewayHost).toBeNull();
  });

  it("rejects a custom non-auth.* base URL with host_mismatch", () => {
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("https://sso.example.com"),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe("host_mismatch");
    expect(result.requestHost).toBe("gateway.openmeld.invalid");
    expect(result.authHost).toBe("sso.example.com");
    expect(result.expectedGatewayHost).toBeNull();
  });

  it("rejects an unparsable stored auth base URL with invalid_auth_url", () => {
    // setAuthSession normalizes its input, so this shape only appears when
    // the session file was edited or corrupted. It must still be reported
    // with a structured reason instead of silently dropping the token.
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("not-a-url"),
      requestUrl: DAEMON_STREAM_URL,
    });

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe("invalid_auth_url");
    expect(result.requestHost).toBe("gateway.openmeld.invalid");
    expect(result.authHost).toBeNull();
  });

  it("rejects an unparsable request URL with invalid_request_url", () => {
    const result = resolveAuthRequestCompatibility({
      session: sessionWithAuthBaseUrl("https://auth.openmeld.invalid"),
      requestUrl: "::not-a-url::",
    });

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe("invalid_request_url");
    expect(result.requestHost).toBeNull();
  });
});
