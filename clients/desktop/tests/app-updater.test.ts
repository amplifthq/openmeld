import { EventEmitter } from "node:events";
import type { MacUpdater, UpdateCheckResult } from "electron-updater";
import { describe, expect, it, vi } from "vitest";
import { createAppUpdater } from "../src/main/update/app-updater";

function fixture(url = `/desktop/updates/${"a".repeat(64)}/desktop.zip`) {
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
      events.emit("update-downloaded", info);
      return Promise.resolve([]);
    }),
    quitAndInstall: vi.fn<MacUpdater["quitAndInstall"]>(),
  });
  const prepareRestart = vi.fn(async () => true);
  const setInstalling = vi.fn();
  const controller = createAppUpdater({
    updater: driver as unknown as MacUpdater,
    currentVersion: "0.1.1",
    publish: vi.fn(),
    prepareRestart,
    setInstalling,
  });
  return { controller, driver, prepareRestart, setInstalling };
}
describe("Desktop update consent", () => {
  it("restores normal GUI closing if installation handoff throws", async () => {
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
      false,
    ]);
    await controller.act("restart");
    expect(driver.quitAndInstall).toHaveBeenCalledTimes(1);
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
    await Promise.all([controller.act("download"), controller.act("download")]);
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
});
