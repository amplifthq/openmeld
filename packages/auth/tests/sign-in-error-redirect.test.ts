import { describe, expect, it } from "vitest";
import { createAuthConfigForTest } from "./auth-config.test-support";

const AUTH_ENV = {
  BETTER_AUTH_OPENMELD_SECRET:
    "test-secret-at-least-forty-four-characters-long",
  BETTER_AUTH_URL: "http://localhost:8788",
  WEB_APP_URL: "http://localhost:3000",
} as const;

describe("sign-in error redirect", () => {
  it("sends an unrecoverable sign-in failure to the product sign-in page instead of Better Auth's default developer error page", () => {
    const config = createAuthConfigForTest(AUTH_ENV);

    expect(config.onAPIError?.errorURL).toBe("http://localhost:3000/login");
  });

  it("keeps pointing at the configured web app origin when it differs from the auth origin", () => {
    const config = createAuthConfigForTest({
      ...AUTH_ENV,
      WEB_APP_URL: "https://app.openmeld.ai",
    });

    expect(config.onAPIError?.errorURL).toBe("https://app.openmeld.ai/login");
  });
});
