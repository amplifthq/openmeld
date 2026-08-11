import { afterEach, describe, expect, it, vi } from "vitest";

const originalBetterAuthSecret = process.env.BETTER_AUTH_OPENMELD_SECRET;

afterEach(() => {
  if (originalBetterAuthSecret === undefined) {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_OPENMELD_SECRET");
  } else {
    process.env.BETTER_AUTH_OPENMELD_SECRET = originalBetterAuthSecret;
  }
  vi.resetModules();
});

describe("Better Auth CLI config", () => {
  it("loads for schema generation without a runtime secret", async () => {
    Reflect.deleteProperty(process.env, "BETTER_AUTH_OPENMELD_SECRET");
    vi.resetModules();

    await expect(
      import("../src/lib/better-auth/cli-config")
    ).resolves.toMatchObject({
      auth: expect.any(Object),
    });
  }, 15_000);
});
