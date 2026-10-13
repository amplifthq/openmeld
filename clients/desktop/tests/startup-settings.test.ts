import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStartupSettings } from "../src/main/startup-settings";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "openmeld-startup-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function nativeApp() {
  const state = {
    openAtLogin: false,
    wasOpenedAtLogin: false,
    executableWillLaunchAtLogin: false,
    status: "not-registered",
    launchItems: [],
  } as ReturnType<App["getLoginItemSettings"]>;
  return {
    state,
    getPath: () => directory,
    getLoginItemSettings: vi.fn(() => state),
    setLoginItemSettings: vi.fn(
      (input: Parameters<App["setLoginItemSettings"]>[0]) => {
        state.openAtLogin = input.openAtLogin ?? false;
        state.executableWillLaunchAtLogin = state.openAtLogin;
      }
    ),
  };
}

describe("Desktop startup preferences", () => {
  it.each([
    ["darwin", true, [], true],
    ["darwin", false, [], false],
    ["win32", false, ["app.exe", "--openmeld-login"], true],
    ["win32", false, ["app.exe"], false],
  ] as const)("only hides login launches on %s (mac login=%s, args=%j)", (platform, login, args, hidden) => {
    const app = nativeApp();
    app.state.wasOpenedAtLogin = login;
    const settings = createStartupSettings(app, platform, [...args]);
    expect(settings.shouldStartInBackground()).toBe(false);
    settings.setStartInBackground(true);
    const restarted = createStartupSettings(app, platform, [...args]);
    expect(restarted.shouldStartInBackground()).toBe(hidden);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("reads system changes and upgrades a Windows login entry when background start is enabled", () => {
    const app = nativeApp();
    app.state.openAtLogin = true;
    app.state.executableWillLaunchAtLogin = true;
    const settings = createStartupSettings(app, "win32", []);
    settings.setStartInBackground(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      args: ["--openmeld-login"],
    });
    app.state.executableWillLaunchAtLogin = false;
    expect(settings.getOpenAtLogin()).toBe(false);
    expect(settings.getStartInBackground()).toBe(true);
    settings.setOpenAtLogin(false);
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
      args: ["--openmeld-login"],
      enabled: false,
    });
    expect(
      JSON.parse(readFileSync(join(directory, "startup-settings.json"), "utf8"))
    ).toEqual({ startInBackground: true });
  });

  it("reports rejected system writes and damaged preferences instead of inventing an enabled state", () => {
    const app = nativeApp();
    app.setLoginItemSettings.mockImplementation(() => undefined);
    const settings = createStartupSettings(app, "darwin", []);
    expect(() => settings.setOpenAtLogin(true)).toThrow("system did not apply");
    writeFileSync(join(directory, "startup-settings.json"), "{broken");
    expect(() => settings.getStartInBackground()).toThrow();
  });
});
