import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { devicePreferencesPath } from "../src/config/paths";
import {
  readOpenMeldToolsMaintenancePolicy,
  writeOpenMeldToolsMaintenancePolicy,
} from "../src/local-service/maintenance/openmeld-tools-maintenance-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenMeld Tools maintenance policy", () => {
  it("keeps automatic OpenMeld updates on until the user turns them off", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "openmeld-maintenance-"));
    vi.stubEnv("OPENMELD_HOME", homeDir);
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");

    try {
      await expect(readOpenMeldToolsMaintenancePolicy()).resolves.toMatchObject(
        { automaticUpdatesEnabled: true }
      );

      await writeOpenMeldToolsMaintenancePolicy({
        automaticUpdatesEnabled: false,
      });

      await expect(readOpenMeldToolsMaintenancePolicy()).resolves.toEqual({
        automaticUpdatesEnabled: false,
      });
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });

  it("fails closed when the saved preference is damaged", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "openmeld-maintenance-"));
    vi.stubEnv("OPENMELD_HOME", homeDir);
    vi.stubEnv("OPENMELD_ENV_PRESET", "dev-local");

    try {
      const policyPath = devicePreferencesPath();
      await mkdir(join(homeDir, "device"), { recursive: true });
      await writeFile(
        policyPath,
        '{"v":1,"openMeldToolsMaintenance":{"automaticUpdatesEnabled":"yes"},"updatedAt":"2026-08-25T08:00:00.000Z"}\n'
      );

      await expect(readOpenMeldToolsMaintenancePolicy()).rejects.toThrow(
        "OpenMeld update setting is invalid"
      );
    } finally {
      await rm(homeDir, { force: true, recursive: true });
    }
  });
});
