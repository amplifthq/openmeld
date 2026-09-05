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
