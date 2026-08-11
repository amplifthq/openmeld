import { describe, expect, it } from "vitest";
import { resolveTrustedOrigins } from "../src/utils/trusted-origins";

describe("resolveTrustedOrigins", () => {
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
