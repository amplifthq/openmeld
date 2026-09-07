import { getCookies, getSessionCookie } from "better-auth/cookies";
import { describe, expect, it } from "vitest";
import { createAuthClientConfig } from "../src/configs/auth.client.config";
import { createAuthConfig } from "../src/configs/auth.config";

const AUTH_ENV = {
  BETTER_AUTH_OPENMELD_SECRET:
    "test-secret-at-least-forty-four-characters-long",
  BETTER_AUTH_URL: "http://localhost:8788",
  WEB_APP_URL: "http://localhost:3000",
} as const;

describe("multi-session configuration", () => {
  it("isolates staging sessions from inherited production cookies without renaming production cookies", () => {
    const production = createAuthConfig(AUTH_ENV);
    const staging = createAuthConfig({
      ...AUTH_ENV,
      AUTH_COOKIE_PREFIX: "openmeld-staging",
    });
    expect(getCookies(production).sessionToken.name).toBe(
      "better-auth.session_token"
    );
    expect(getCookies(staging).sessionToken.name).toBe(
      "openmeld-staging.session_token"
    );
    const headers = new Headers({
      cookie:
        "better-auth.session_token=production; openmeld-staging.session_token=staging",
    });
    expect(
      getSessionCookie(headers, { cookiePrefix: "openmeld-staging" })
    ).toBe("staging");
    expect(getSessionCookie(headers)).toBe("production");
  });
  it("enables the server endpoints", () => {
    const config = createAuthConfig(AUTH_ENV);

    expect(config.plugins?.map((plugin) => plugin.id)).toContain(
      "multi-session"
    );
  });

  it("exposes the typed client API", () => {
    const config = createAuthClientConfig({
      baseURL: AUTH_ENV.WEB_APP_URL,
    });

    expect(config.plugins.map((plugin) => plugin.id)).toContain(
      "multi-session"
    );
  });
});
