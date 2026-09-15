import { describe, expect, it } from "vitest";
import { AUTH_SECRET_MIN_LENGTH } from "../src/configs/constants";
import { validateAuthConfig } from "../src/utils/config-validator";

const validSecret = "12345678901234567890123456789012345678901234";

describe("validateAuthConfig", () => {
  it("refuses development Desktop identities in production and unknown local targets", () => {
    for (const [AUTH_WORKER_NODE_ENV, AUTH_DESKTOP_DEVELOPMENT_TARGET] of [
      ["production", "disposable"],
      ["production", "private"],
      ["development", "arbitrary"],
    ]) {
      expect(() =>
        validateAuthConfig({
          BETTER_AUTH_URL: "https://auth.openmeld.invalid",
          BETTER_AUTH_OPENMELD_SECRET: validSecret,
          AUTH_WORKER_NODE_ENV,
          AUTH_DESKTOP_DEVELOPMENT_TARGET,
        })
      ).toThrow();
    }
  });
  it("uses default device client ids when not provided", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "http://localhost:8788",
      AUTH_WORKER_NODE_ENV: "development",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
    });

    expect(config.AUTH_WORKER_NODE_ENV).toBe("development");
    expect(config.AUTH_DEVICE_ALLOWED_CLIENT_IDS).toEqual([
      "openmeld-cli",
      "openmeld-cli-dev",
    ]);
  });

  it("throws when secret is missing in development", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "http://localhost:8788",
        AUTH_WORKER_NODE_ENV: "development",
      })
    ).toThrow("BETTER_AUTH_OPENMELD_SECRET is required");
  });

  it("throws in production when secret is missing", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "https://auth.openmeld.invalid",
        AUTH_WORKER_NODE_ENV: "production",
      })
    ).toThrow("BETTER_AUTH_OPENMELD_SECRET is required");
  });

  it("throws when secret is too short", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "http://localhost:8788",
        BETTER_AUTH_OPENMELD_SECRET: "short",
      })
    ).toThrow(
      `BETTER_AUTH_OPENMELD_SECRET must be at least ${AUTH_SECRET_MIN_LENGTH} characters`
    );
  });

  it("accepts production config with auth email defaults", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "https://auth.openmeld.invalid",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
      AUTH_WORKER_NODE_ENV: "production",
      AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    });

    expect(config.AUTH_WORKER_NODE_ENV).toBe("production");
    expect(config.AUTH_FROM_EMAIL).toBe("OpenMeld <noreply@openmeld.invalid>");
  });

  it("rejects unknown AUTH_WORKER_NODE_ENV values", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "http://localhost:8788",
        AUTH_WORKER_NODE_ENV: "staging",
        BETTER_AUTH_OPENMELD_SECRET: validSecret,
      })
    ).toThrow(
      "AUTH_WORKER_NODE_ENV must be either 'development' or 'production'"
    );
  });

  it("parses custom allowed device client ids", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "http://localhost:8788",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
      AUTH_DEVICE_ALLOWED_CLIENT_IDS:
        "openmeld-cli, custom-client, openmeld-cli",
    });

    expect(config.AUTH_DEVICE_ALLOWED_CLIENT_IDS).toEqual([
      "openmeld-cli",
      "custom-client",
    ]);
  });

  it("throws when allowed device client ids contains invalid values", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "http://localhost:8788",
        BETTER_AUTH_OPENMELD_SECRET: validSecret,
        AUTH_DEVICE_ALLOWED_CLIENT_IDS: "openmeld-cli,invalid client",
      })
    ).toThrow(
      "AUTH_DEVICE_ALLOWED_CLIENT_IDS contains invalid client_id: invalid client"
    );
  });

  it("uses BETTER_AUTH_URL as WEB_APP_URL fallback when WEB_APP_URL is not provided", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "https://auth.openmeld.invalid",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
    });

    expect(config.WEB_APP_URL).toBe("https://auth.openmeld.invalid");
  });

  it("normalizes WEB_APP_URL when explicitly provided", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "https://auth.openmeld.invalid",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
      WEB_APP_URL: "https://openmeld.invalid/",
    });

    expect(config.WEB_APP_URL).toBe("https://openmeld.invalid");
  });

  it("normalizes AUTH_COOKIE_DOMAIN and PASSKEY_RP_ID", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "https://auth.openmeld.invalid",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
      AUTH_COOKIE_DOMAIN: ".OpenMeld.invalid",
      PASSKEY_RP_ID: "OpenMeld.Invalid",
    });

    expect(config.AUTH_COOKIE_DOMAIN).toBe("openmeld.invalid");
    expect(config.PASSKEY_RP_ID).toBe("openmeld.invalid");
  });

  it("rejects invalid AUTH_COOKIE_DOMAIN", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "https://auth.openmeld.invalid",
        BETTER_AUTH_OPENMELD_SECRET: validSecret,
        AUTH_COOKIE_DOMAIN: "openmeld.invalid/path",
      })
    ).toThrow("AUTH_COOKIE_DOMAIN must be a valid hostname");
  });

  it("rejects invalid PASSKEY_RP_ID", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "https://auth.openmeld.invalid",
        BETTER_AUTH_OPENMELD_SECRET: validSecret,
        PASSKEY_RP_ID: "https://openmeld.invalid",
      })
    ).toThrow("PASSKEY_RP_ID must be a valid hostname");
  });

  it("accepts oauth provider credentials when client id and secret are both set", () => {
    const config = validateAuthConfig({
      BETTER_AUTH_URL: "https://auth.openmeld.invalid",
      BETTER_AUTH_OPENMELD_SECRET: validSecret,
      GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID: "github-client-id",
      GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET: "github-client-secret",
      GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID: "google-client-id",
      GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET: "google-client-secret",
    });

    expect(config.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID).toBe(
      "github-client-id"
    );
    expect(config.GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET).toBe(
      "github-client-secret"
    );
    expect(config.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID).toBe(
      "google-client-id"
    );
    expect(config.GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET).toBe(
      "google-client-secret"
    );
  });

  it("rejects oauth provider partial config", () => {
    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "https://auth.openmeld.invalid",
        BETTER_AUTH_OPENMELD_SECRET: validSecret,
        GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID: "github-client-id",
      })
    ).toThrow(
      "GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_SECRET is required when GITHUB_OPENMELD_AUTH_OAUTH_CLIENT_ID is set"
    );

    expect(() =>
      validateAuthConfig({
        BETTER_AUTH_URL: "https://auth.openmeld.invalid",
        BETTER_AUTH_OPENMELD_SECRET: validSecret,
        GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET: "google-client-secret",
      })
    ).toThrow(
      "GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_ID is required when GOOGLE_OPENMELD_AUTH_OAUTH_CLIENT_SECRET is set"
    );
  });
});
