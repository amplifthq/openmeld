import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { DesktopReleasePlatform } from "@openmeld/schemas";
import type { AutoUpdater } from "electron";
import type { MacUpdater, UpdateCheckResult } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import { createAppUpdater } from "../src/main/update/app-updater";

function fixture(
  url = `/desktop/updates/${"a".repeat(64)}/desktop.zip`,
  platform: DesktopReleasePlatform = "macos-arm64",
  extras: {
    currentAppBundle?: string | null;
    downloadedFile?: string;
    processId?: number;
  } = {}
) {
  const events = new EventEmitter();
  const info = {
    version: "0.1.2",
    releaseDate: "2026-01-01T00:00:00Z",
    files: [{ url, sha512: `${"A".repeat(86)}==`, size: 42 }],
    path: url,
    sha512: `${"A".repeat(86)}==`,
  };
  const result = {
    isUpdateAvailable: true,
    updateInfo: info,
    versionInfo: info,
  } satisfies UpdateCheckResult;
  const driver = Object.assign(events, {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: false,
    disableDifferentialDownload: false,
    setFeedURL: vi.fn<MacUpdater["setFeedURL"]>(),
    checkForUpdates: vi.fn<MacUpdater["checkForUpdates"]>(async () => result),
    downloadUpdate: vi.fn<MacUpdater["downloadUpdate"]>(() => {
      events.emit("download-progress", { percent: 37 });
      events.emit("update-downloaded", {
        ...info,
        ...(extras.downloadedFile
          ? { downloadedFile: extras.downloadedFile }
          : {}),
      });
      return Promise.resolve([]);
    }),
    quitAndInstall: vi.fn<MacUpdater["quitAndInstall"]>(),
  });
  const prepareRestart = vi.fn(async () => true);
  const setInstalling = vi.fn();
  const installRenamedMacBundle = vi.fn();
  const quitApp = vi.fn();
  const controller = createAppUpdater({
    updater: driver as unknown as MacUpdater,
    platform,
    currentVersion: "0.1.1",
    currentAppBundle: extras.currentAppBundle,
    installRenamedMacBundle,
    quitApp,
    processId: extras.processId,
    publish: vi.fn(),
    prepareRestart,
    setInstalling,
  });
  return {
    controller,
    driver,
    prepareRestart,
    setInstalling,
    installRenamedMacBundle,
    quitApp,
  };
}
describe("Desktop update consent", () => {
  it.each([
    "windows-x64",
    "windows-arm64",
  ] as const)("uses the %s feed and preserves manual consent and draft protection", async (platform) => {
    const { controller, driver, prepareRestart } = fixture(
      `/desktop/updates/${"a".repeat(64)}/${platform}.exe`,
      platform
    );
    expect(driver.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: `https://openmeld.ai/desktop/updates/${platform}`,
    });
    await controller.act("check");
    expect(controller.snapshot().status).toBe("available");
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
    await controller.act("download");
    prepareRestart.mockResolvedValueOnce(false);
    await controller.act("restart");
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    await controller.act("restart");
    expect(driver.quitAndInstall).toHaveBeenCalledOnce();
  });
  it.each([
    "desktop.zip",
    "windows-arm64.exe",
  ])("never downloads the wrong Windows architecture/platform: %s", async (filename) => {
    const { controller, driver } = fixture(
      `/desktop/updates/${"a".repeat(64)}/${filename}`,
      "windows-x64"
    );
    await controller.act("check");
    await controller.act("download");
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "check",
    });
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
  });

  it("keeps the accepted install terminal if installation handoff throws", async () => {
    const { controller, driver, setInstalling } = fixture();
    await controller.act("check");
    await controller.act("download");
    driver.quitAndInstall.mockImplementationOnce(() => {
      throw new Error("Installer unavailable");
    });
    await controller.act("restart");
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "install",
    });
    expect(setInstalling.mock.calls.map(([installing]) => installing)).toEqual([
      true,
    ]);
    await controller.act("restart");
    expect(driver.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it("keeps real MacUpdater errors terminal while its late native download still quits", async () => {
    const require = createRequire(import.meta.url);
    const electronPath = require.resolve("electron");
    require("electron");
    const electronModule = require.cache[electronPath];
    if (!electronModule) {
      throw new Error("Electron module was not loaded");
    }
    const original = electronModule.exports;
    const native = Object.assign(new EventEmitter(), {
      checkForUpdates: vi.fn<AutoUpdater["checkForUpdates"]>(),
      quitAndInstall: vi.fn<AutoUpdater["quitAndInstall"]>(),
    });
    // Only Electron's external boundary is replaced. The installed vendor's
    // constructor, native event forwarding and quitAndInstall run unchanged.
    electronModule.exports = { autoUpdater: native };
    let updater: MacUpdater;
    try {
      const { MacUpdater: RealMacUpdater } =
        require("electron-updater") as typeof import("electron-updater");
      updater = new RealMacUpdater(undefined, {
        version: "0.1.1",
        name: "OpenMeld Desktop",
        isPackaged: true,
        appUpdateConfigPath: "/unused",
        userDataPath: "/unused",
        baseCachePath: "/unused",
        whenReady: async () => undefined,
        relaunch: vi.fn(),
        quit: vi.fn(),
        onQuit: vi.fn(),
      });
    } finally {
      electronModule.exports = original;
    }
    updater.logger = null;
    const setInstalling = vi.fn();
    const prepareRestart = vi.fn(async () => true);
    const controller = createAppUpdater({
      updater,
      currentVersion: "0.1.1",
      publish: vi.fn(),
      setInstalling,
      prepareRestart,
    });
    const downloaded = {
      version: "0.1.2",
      releaseDate: "2026-01-01T00:00:00Z",
      downloadedFile: "/unused/desktop.zip",
      files: [{ url: "/desktop.zip", sha512: `${"A".repeat(86)}==`, size: 42 }],
      path: "/desktop.zip",
      sha512: `${"A".repeat(86)}==`,
    } satisfies import("electron-updater").UpdateDownloadedEvent;
    updater.emit("update-downloaded", downloaded);
    await controller.act("restart");
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    native.emit("error", new Error("Native staging failed"));
    native.emit("error", new Error("Repeated native failure"));
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "install",
    });
    await controller.act("check");
    await controller.act("restart");
    expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(prepareRestart).toHaveBeenCalledTimes(1);
    updater.emit("update-downloaded", downloaded);
    native.emit("update-downloaded");
    expect(native.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "install",
    });
    expect(setInstalling.mock.calls).toEqual([[true]]);
  });
  it("requires separate download and restart consent, and deduplicates simultaneous actions", async () => {
    const { controller, driver } = fixture();
    expect([driver.autoDownload, driver.autoInstallOnAppQuit]).toEqual([
      false,
      false,
    ]);
    await Promise.all([controller.act("check"), controller.act("check")]);
    expect(driver.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().status).toBe("available");
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
    driver.downloadUpdate.mockImplementationOnce(() => {
      driver.emit("download-progress", { percent: 100 });
      return Promise.resolve([]);
    });
    await Promise.all([controller.act("download"), controller.act("download")]);
    expect(controller.snapshot()).toMatchObject({
      status: "downloading",
      percent: 100,
    });
    await controller.act("restart");
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    driver.emit("update-downloaded");
    expect(controller.snapshot().status).toBe("downloaded");
    expect(driver.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    await controller.act("check");
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    await Promise.all([controller.act("restart"), controller.act("restart")]);
    expect(driver.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it("keeps downloaded data and normal GUI lifecycle when drafts block restart", async () => {
    const { controller, driver, prepareRestart, setInstalling } = fixture();
    await controller.act("check");
    await controller.act("download");
    prepareRestart.mockResolvedValueOnce(false);
    await controller.act("restart");
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "restart",
    });
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    expect(setInstalling).not.toHaveBeenCalledWith(true);
    await controller.act("restart");
    expect(driver.quitAndInstall).toHaveBeenCalledTimes(1);
  });
  it.each([
    "https://other.example/update.zip",
    "http://openmeld.ai/desktop/updates/a/desktop.zip",
    "/desktop/download",
    "file:///tmp/update.zip",
  ])("refuses untrusted feed artifacts: %s", async (url) => {
    const { controller, driver } = fixture(url);
    await controller.act("check");
    await controller.act("download");
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "check",
    });
    expect(driver.downloadUpdate).not.toHaveBeenCalled();
  });
  it("installs a renamed OpenMeld Desktop.app without handing the ZIP to Squirrel", async () => {
    const { controller, driver, installRenamedMacBundle, quitApp } = fixture(
      undefined,
      "macos-arm64",
      {
        currentAppBundle: "/Applications/OpenMeld Desktop.app",
        downloadedFile: "/tmp/cache/desktop.zip",
        processId: 42,
      }
    );
    await controller.act("check");
    await controller.act("download");
    await controller.act("restart");
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    expect(installRenamedMacBundle).toHaveBeenCalledWith({
      zipPath: "/tmp/cache/desktop.zip",
      currentBundle: "/Applications/OpenMeld Desktop.app",
      targetBundle: "/Applications/OpenMeld.app",
      pid: 42,
    });
    expect(quitApp).toHaveBeenCalledOnce();
    expect(controller.snapshot().status).toBe("installing");
  });
  it("fails closed when a renamed folder has no verified ZIP instead of calling Squirrel", async () => {
    const { controller, driver, installRenamedMacBundle } = fixture(
      undefined,
      "macos-arm64",
      { currentAppBundle: "/Applications/OpenMeld Desktop.app", processId: 42 }
    );
    await controller.act("check");
    await controller.act("download");
    await controller.act("restart");
    expect(driver.quitAndInstall).not.toHaveBeenCalled();
    expect(installRenamedMacBundle).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({
      status: "error",
      errorStage: "install",
    });
  });
});
