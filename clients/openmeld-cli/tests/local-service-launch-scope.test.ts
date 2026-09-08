import { describe, expect, it } from "vitest";
import { assertDaemonServiceLaunchScope } from "../src/local-service/lifecycle/daemon-service-launch-scope";

describe("Service launch scope", () => {
  it.each([
    "prod",
    "dev-local",
    "canary",
  ])("rejects a production executable borrowed by an isolated %s home", async (preset) => {
    await expect(
      assertDaemonServiceLaunchScope({
        homeDir: "/test-user",
        executablePath: "/test-user/.openmeld/versions/0.3.170/openmeld",
        env: { OPENMELD_ENV_PRESET: preset, OPENMELD_HOME: "/isolated" },
      })
    ).rejects.toThrow("OPENMELD_HOME alone does not isolate the Service");
  });

  it.each([
    ["prod", "/test-user/.openmeld", "/test-user/.openmeld/bin/openmeld"],
    ["dev-local", "/isolated-dev", "/usr/local/bin/node"],
    [
      "canary",
      "/test-user/.openmeld-canary",
      "/test-user/.openmeld-canary/versions/0.3.170/openmeld",
    ],
  ])("keeps the supported %s entry available", async (preset, root, executablePath) => {
    await expect(
      assertDaemonServiceLaunchScope({
        homeDir: "/test-user",
        executablePath,
        env: { OPENMELD_ENV_PRESET: preset, OPENMELD_HOME: root },
      })
    ).resolves.toBeUndefined();
  });
});
