import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readInstalledDesktopTarget } from "../../../scripts/desktop/installed-target";
import {
  configureInstalledUserData,
  configurePilotUserData,
} from "../src/main/pilot-user-data";

it("fixes installed storage under OS app data with separate production and disposable identities", () => {
  const appData = mkdtempSync(join(tmpdir(), "desktop-installed-data-"));
  let userData = "/launch-override";
  const app = {
    setPath: (_name: string, value: string) => {
      userData = value;
    },
    getPath: (name: string) => (name === "appData" ? appData : userData),
  };
  try {
    for (const [kind, directory] of [
      ["production", "OpenMeld Desktop"],
      ["disposable", "OpenMeld Desktop Test"],
    ] as const) {
      const target = readInstalledDesktopTarget({
        OPENMELD_DESKTOP_TARGET: kind,
        OPENMELD_DESKTOP_TEST_WEB_ORIGIN: "http://test.localhost:39990",
      });
      if (!target) {
        throw new Error("Expected installed target");
      }
      configureInstalledUserData(app, target);
      expect(userData).toBe(join(appData, directory));
    }
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});

it("verifies the lane GUI directory is effective before callers may initialize auth storage", () => {
  const home = mkdtempSync(join(tmpdir(), "openmeld-desktop-data-"));
  try {
    let current = "/old/gui-data";
    const app = {
      setPath: vi.fn((_name: string, directory: string) => {
        current = directory;
      }),
      getPath: vi.fn(() => current),
    };
    const env = {
      OPENMELD_HOME: home,
      OPENMELD_DESKTOP_USER_DATA_DIR: join(home, "desktop", "user-data"),
    };
    configurePilotUserData(app, env);
    expect(current).toBe(env.OPENMELD_DESKTOP_USER_DATA_DIR);
    expect(app.getPath).toHaveBeenCalledWith("userData");
    expect(() =>
      configurePilotUserData(app, {
        ...env,
        OPENMELD_DESKTOP_USER_DATA_DIR: "/other/gui-data",
      })
    ).toThrow("isolate GUI data");
    expect(() =>
      configurePilotUserData({ ...app, getPath: () => "/old/gui-data" }, env)
    ).toThrow("did not take effect");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
