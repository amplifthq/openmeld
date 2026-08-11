import { describe, expect, it } from "vitest";
import {
  getConfiguredBaseUrl,
  getConfiguredDeviceRuntimeState,
  getConfiguredSkillsConfig,
  getConfiguredStartV1OnboardingState,
  setConfiguredBaseUrl,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
  updateConfiguredStartV1OnboardingState,
} from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("runtime config preserve", () => {
  it("keeps baseUrl, skills, and agents across sequential writes", async () => {
    await withTempHome(async () => {
      await setConfiguredBaseUrl("https://gateway.example.com/");
      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills",
      });
      await updateConfiguredStartV1OnboardingState(() => ({
        disclaimerAcceptedVersion: "start-v1-2026-03-02",
        lastCompletedAt: "2026-03-02T00:00:00.000Z",
      }));
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      expect(await getConfiguredBaseUrl()).toBe("https://gateway.example.com");
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe("/tmp/skills");
      expect(
        (await getConfiguredStartV1OnboardingState())?.disclaimerAcceptedVersion
      ).toBe("start-v1-2026-03-02");
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]?.agentId
      ).toBe("codex");
    });
  });
});
