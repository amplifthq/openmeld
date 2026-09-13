import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { configurePilotUserData } from "../src/main/pilot-user-data";

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
