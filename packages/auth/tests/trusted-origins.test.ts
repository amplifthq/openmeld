import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "../src/utils/trusted-origins";

describe("resolveTrustedOrigins", () => {
  it("admits only the configured old and new browser origins during an App migration", () => {
    const origins = resolveTrustedOrigins({
      baseAuthUrl: "https://auth.openmeld.ai",
      appUrl: "https://app.openmeld.ai",
      legacyAppOrigin: "https://openmeld.ai",
      env: "production",
      request: new Request("https://auth.openmeld.ai/api/auth/sign-in/email", {
        headers: {
          origin: "https://evil.openmeld.ai",
          "x-forwarded-host": "evil.openmeld.ai",
        },
      }),
    });
    expect(origins).toEqual(
      expect.arrayContaining([
        "https://app.openmeld.ai",
        "https://openmeld.ai",
        "openmeld-desktop://app",
        "sh.openmeld.desktop:/",
      ])
    );
    expect(origins).not.toContain("https://evil.openmeld.ai");
    expect(origins).not.toContain("https://staging.openmeld.ai");
    expect(
      resolveTrustedOrigins({
        baseAuthUrl: "https://auth.openmeld.ai",
        appUrl: "https://app.openmeld.ai",
        env: "production",
      })
    ).not.toContain("https://openmeld.ai");
  });

  it.each([
    "https://*.openmeld.ai",
    "https://openmeld.ai/path",
    "https://user:pass@openmeld.ai",
    "http://openmeld.ai",
    "https://openmeld.ai?next=evil",
    "invalid",
  ])("rejects an unsafe production legacy origin: %s", (legacyAppOrigin) => {
    expect(() =>
      resolveTrustedOrigins({
        baseAuthUrl: "https://auth.openmeld.ai",
        appUrl: "https://app.openmeld.ai",
        env: "production",
        legacyAppOrigin,
      })
    ).toThrow("AUTH_LEGACY_APP_ORIGIN");
  });
  it("trusts exactly this worktree callback, not another worktree or the shared development scheme", () => {
    const origins = resolveTrustedOrigins({
      baseAuthUrl: "http://wt-aaaaaaaaaaaa.localhost:31002",
      appUrl: "http://wt-aaaaaaaaaaaa.localhost:31000",
      env: "development",
    });
    expect(
      origins.filter((origin) => origin.startsWith("sh.openmeld."))
    ).toEqual(["sh.openmeld.desktop.dev.wt-aaaaaaaaaaaa.p31000:/"]);
  });
  it("trusts only the configured Desktop callback identity", () => {
    for (const [env, developmentTarget, expected] of [
      ["production", undefined, "sh.openmeld.desktop:/"],
      ["development", undefined, "sh.openmeld.desktop.dev:/"],
      ["development", "disposable", "sh.openmeld.desktop.test:/"],
    ] as const) {
      const origins = resolveTrustedOrigins({
        baseAuthUrl: "https://auth.openmeld.invalid",
        appUrl: "https://openmeld.invalid",
        env,
        developmentTarget,
      });
      expect(origins).toContain("openmeld-desktop://app");
      expect(
        origins.filter((origin) => origin.startsWith("sh.openmeld."))
      ).toEqual([expected]);
    }
  });
  it("trusts loopback aliases only on the configured development Web port", () => {
    const origins = resolveTrustedOrigins({
      baseAuthUrl: "http://wt-example.localhost:30178",
      appUrl: "http://wt-example.localhost:30176",
      env: "development",
    });
    expect(origins).toContain("http://localhost:30176");
    expect(origins).toContain("http://127.0.0.1:30176");
    expect(origins).not.toContain("http://localhost:30177");
    expect(origins).not.toContain("http://other.localhost:30176");
    expect(origins).not.toContain("http://evil.example:30176");
  });

  it("never adds configured loopback aliases in production or for a remote Web host", () => {
    for (const config of [
      {
        env: "production" as const,
        appUrl: "http://wt-example.localhost:30176",
      },
      { env: "development" as const, appUrl: "https://openmeld.invalid:30176" },
    ]) {
      const origins = resolveTrustedOrigins({
        baseAuthUrl: "https://auth.openmeld.invalid",
        ...config,
      });
      expect(origins).not.toContain("http://localhost:30176");
      expect(origins).not.toContain("https://localhost:30176");
    }
  });
  it("returns base and app origins", () => {
    const origins = resolveTrustedOrigins({
      baseAuthUrl: "https://auth.openmeld.invalid",
      appUrl: "https://openmeld.invalid",
      env: "production",
    });

    expect(origins).toContain("https://auth.openmeld.invalid");
    expect(origins).toContain("https://openmeld.invalid");
  });

  it("adds localhost variants and request origin in development", () => {
    const request = new Request("http://localhost:8788/api/auth/get-session", {
      headers: {
        origin: "http://127.0.0.1:8788",
      },
    });

    const origins = resolveTrustedOrigins({
      baseAuthUrl: "http://localhost:8788",
      appUrl: "http://localhost:8788",
      env: "development",
      request,
    });

    expect(origins).toContain("http://localhost:8788");
    expect(origins).toContain("http://127.0.0.1:8788");
  });
});
