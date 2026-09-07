import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "../src/utils/trusted-origins";

describe("resolveTrustedOrigins", () => {
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
