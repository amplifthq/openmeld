import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  clearAuthSessionMock,
  getAuthSessionMetadataMock,
  runDaemonTeardownStrictMock,
  runSkillsUninstallMock,
} = vi.hoisted(() => ({
  clearAuthSessionMock: vi.fn(),
  getAuthSessionMetadataMock: vi.fn(),
  runDaemonTeardownStrictMock: vi.fn(),
  runSkillsUninstallMock: vi.fn(),
}));

vi.mock("../src/config/auth-session", () => ({
  clearAuthSession: clearAuthSessionMock,
  getAuthSessionMetadata: getAuthSessionMetadataMock,
}));

vi.mock("../src/commands/service", () => ({
  runDaemonTeardownStrict: runDaemonTeardownStrictMock,
}));

vi.mock("../src/commands/skills", () => ({
  runSkillsUninstall: runSkillsUninstallMock,
}));

import {
  clearLaneAuthSession,
  getLaneAuthSessionMetadata,
  removeLaneOpenMeldHome,
  runLaneDaemonTeardown,
  runLaneSkillsCleanup,
} from "../src/uninstall/adapters";
import { withTempHome } from "./helpers/fs";

describe("uninstall adapters", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearAuthSessionMock.mockReset();
    getAuthSessionMetadataMock.mockReset();
    runDaemonTeardownStrictMock.mockReset();
    runSkillsUninstallMock.mockReset();
  });

  it("scopes skills cleanup to the requested lane environment", async () => {
    await withTempHome(async () => {
      await runLaneSkillsCleanup({
        lane: "dev-local",
      });
    });

    expect(runSkillsUninstallMock).toHaveBeenCalledTimes(1);
    expect(runSkillsUninstallMock).toHaveBeenCalledWith({
      all: true,
      allowExternalTargets: false,
      view: "agent",
    });
  });

  it("scopes auth cleanup to the requested lane environment", async () => {
    await withTempHome(async () => {
      await clearLaneAuthSession({
        lane: "canary",
      });
    });

    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
  });

  it("reads auth session metadata inside the requested lane environment", async () => {
    getAuthSessionMetadataMock.mockResolvedValue({
      authBaseUrl: "https://auth.openmeld.invalid",
      clientId: "openmeld-cli",
      createdAt: "2026-03-09T00:00:00.000Z",
    });

    await withTempHome(async () => {
      const metadata = await getLaneAuthSessionMetadata({
        lane: "prod",
      });

      expect(metadata).toEqual({
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-03-09T00:00:00.000Z",
      });
    });

    expect(getAuthSessionMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("scopes strict daemon teardown to the requested lane environment", async () => {
    runDaemonTeardownStrictMock.mockResolvedValue({
      removed: true,
      stopSignal: "SIGTERM",
      systemServiceController: "launchd",
      systemServiceUninstalled: true,
    });

    await withTempHome(async () => {
      const result = await runLaneDaemonTeardown({
        lane: "prod",
      });
      expect(result).toEqual({
        removed: true,
        stopSignal: "SIGTERM",
        systemServiceController: "launchd",
        systemServiceUninstalled: true,
      });
    });

    expect(runDaemonTeardownStrictMock).toHaveBeenCalledTimes(1);
    expect(runDaemonTeardownStrictMock).toHaveBeenCalledWith({
      reason: "service_uninstall",
    });
  });

  it("removes the scoped OpenMeld home path", async () => {
    await withTempHome(async (home) => {
      const openMeldHome = join(home, ".openmeld-dev");
      await mkdir(openMeldHome, { recursive: true });
      await writeFile(join(openMeldHome, "marker.txt"), "hello\n", "utf8");

      const result = await removeLaneOpenMeldHome({
        lane: "dev-local",
        openMeldHome,
      });

      expect(result).toEqual({
        removed: true,
        homePath: openMeldHome,
      });
      await expect(
        readFile(join(openMeldHome, "marker.txt"), "utf8")
      ).rejects.toThrow();
    });
  });
});
