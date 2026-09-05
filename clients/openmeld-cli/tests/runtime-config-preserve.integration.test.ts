import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  devicePreferencesPath,
  deviceSkillsInstallsPath,
  legacyRuntimeConfigPath,
} from "../src/config/paths";
import {
  alignRuntimeConfigStorage,
  getConfiguredBaseUrl,
  getConfiguredDeviceRuntimeState,
  getConfiguredOpenMeldToolsMaintenance,
  getConfiguredSkillsConfig,
  getConfiguredStartV1OnboardingState,
  setConfiguredBaseUrl,
  setConfiguredDeviceRuntimeState,
  setConfiguredOpenMeldToolsMaintenance,
  setConfiguredSkillsConfig,
  updateConfiguredStartV1OnboardingState,
} from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("runtime config preserve", () => {
  it("resumes legacy migration without replacing a newer owned preference", async () => {
    await withTempHome(async () => {
      await mkdir(dirname(devicePreferencesPath()), { recursive: true });
      await writeFile(
        legacyRuntimeConfigPath(),
        JSON.stringify({
          v: 1,
          baseUrl: "https://old.example.com",
          skills: { storeDir: "/tmp/old-skills" },
        })
      );
      const current = JSON.stringify({
        v: 1,
        baseUrl: "https://current.example.com",
        openMeldToolsMaintenance: { automaticUpdatesEnabled: false },
      });
      await writeFile(devicePreferencesPath(), current);
      await alignRuntimeConfigStorage();
      expect(await readFile(devicePreferencesPath(), "utf8")).toBe(current);
      expect(await getConfiguredBaseUrl()).toBe("https://current.example.com");
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe(
        "/tmp/old-skills"
      );
      await expect(
        readFile(legacyRuntimeConfigPath(), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("rejects an invalid legacy update preference without depending on legacy Agent parsing", async () => {
    await withTempHome(async () => {
      await mkdir(dirname(legacyRuntimeConfigPath()), { recursive: true });
      await writeFile(
        legacyRuntimeConfigPath(),
        JSON.stringify({
          v: 1,
          agents: { registrations: [] },
          openMeldToolsMaintenance: { automaticUpdatesEnabled: false },
        })
      );
      expect(await getConfiguredOpenMeldToolsMaintenance()).toEqual({
        automaticUpdatesEnabled: false,
      });
      await writeFile(
        legacyRuntimeConfigPath(),
        JSON.stringify({
          v: 1,
          openMeldToolsMaintenance: { automaticUpdatesEnabled: "false" },
        })
      );
      await expect(getConfiguredOpenMeldToolsMaintenance()).rejects.toThrow(
        "OpenMeld update setting is invalid."
      );
    });
  });

  it("keeps maintenance independent of corrupt Skills state", async () => {
    await withTempHome(async () => {
      await setConfiguredOpenMeldToolsMaintenance({
        automaticUpdatesEnabled: false,
      });
      await mkdir(dirname(deviceSkillsInstallsPath()), { recursive: true });
      await writeFile(deviceSkillsInstallsPath(), "{broken");
      expect(await getConfiguredOpenMeldToolsMaintenance()).toEqual({
        automaticUpdatesEnabled: false,
      });
      await setConfiguredBaseUrl("https://gateway.example.com");
      expect(await readFile(deviceSkillsInstallsPath(), "utf8")).toBe(
        "{broken"
      );
      expect(await getConfiguredOpenMeldToolsMaintenance()).toEqual({
        automaticUpdatesEnabled: false,
      });
    });
  });

  it("preserves newer files and unrelated preference fields during maintenance changes", async () => {
    await withTempHome(async () => {
      await setConfiguredBaseUrl("https://gateway.example.com");
      const preferences = JSON.parse(
        await readFile(devicePreferencesPath(), "utf8")
      );
      preferences.futurePreference = { keep: true };
      await writeFile(devicePreferencesPath(), JSON.stringify(preferences));
      await mkdir(dirname(deviceSkillsInstallsPath()), { recursive: true });
      const future = '{"v":2,"futureData":"must survive"}\n';
      await writeFile(deviceSkillsInstallsPath(), future);
      await setConfiguredOpenMeldToolsMaintenance({
        automaticUpdatesEnabled: false,
      });
      expect(await readFile(deviceSkillsInstallsPath(), "utf8")).toBe(future);
      expect(
        JSON.parse(await readFile(devicePreferencesPath(), "utf8"))
          .futurePreference
      ).toEqual({ keep: true });
    });
  });

  it("refuses to downgrade newer preferences", async () => {
    await withTempHome(async () => {
      await mkdir(dirname(devicePreferencesPath()), { recursive: true });
      const future =
        '{"v":2,"openMeldToolsMaintenance":{"automaticUpdatesEnabled":false}}';
      await writeFile(devicePreferencesPath(), future);
      await expect(
        setConfiguredBaseUrl("https://gateway.example.com")
      ).rejects.toThrow();
      await expect(getConfiguredOpenMeldToolsMaintenance()).rejects.toThrow();
      expect(await readFile(devicePreferencesPath(), "utf8")).toBe(future);
    });
  });

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
