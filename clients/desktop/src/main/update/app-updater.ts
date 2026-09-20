import {
  type DesktopReleasePlatform,
  type DesktopUpdaterAction,
  type DesktopUpdaterState,
  desktopPlatformUpdateFeedUrl,
  desktopUpdaterFeedSchemaForPlatform,
} from "@openmeld/schemas";
import type { MacUpdater, NsisUpdater, UpdateInfo } from "electron-updater";
import { assertMacUpdateBundlePath } from "./mac-bundle-path";

export function assertDesktopUpdateFiles(
  info: UpdateInfo,
  platform: DesktopReleasePlatform = "macos-arm64"
) {
  desktopUpdaterFeedSchemaForPlatform(platform).parse(info);
}

/** Application policy around electron-updater; no Service or account dependency. */
export function createAppUpdater(input: {
  updater: MacUpdater | NsisUpdater;
  platform?: DesktopReleasePlatform;
  currentVersion: string;
  currentAppBundle?: string | null;
  recordMacInstallRequested?: (targetVersion: string) => void;
  publish: (state: DesktopUpdaterState) => void;
  prepareRestart: () => Promise<boolean>;
  setInstalling: (value: boolean) => void;
}) {
  const updater = input.updater;
  // MacUpdater must not stage in Squirrel until the explicit restart action.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  const platform = input.platform ?? "macos-arm64";
  updater.setFeedURL({
    provider: "generic",
    url: desktopPlatformUpdateFeedUrl(platform),
  });
  let state: DesktopUpdaterState = {
    status: "idle",
    currentVersion: input.currentVersion,
    version: null,
    percent: null,
    errorStage: null,
  };
  let operation: Promise<void> | null = null;
  let verifiedDownload = false;
  let downloadedVersion: string | null = null;
  const publish = (patch: Partial<DesktopUpdaterState>) => {
    state = { ...state, ...patch };
    input.publish(state);
  };
  const fail = (
    stage: NonNullable<DesktopUpdaterState["errorStage"]>,
    error: unknown
  ) => {
    console.error("[openmeld.desktop.update_failed]", { stage, error });
    // MacUpdater has no public cancellation for its pending native install.
    // Once accepted, keep the saved renderer frozen and normal quit enabled.
    publish({ status: "error", errorStage: stage, percent: null });
  };
  updater.on("error", (error) => {
    let stage: NonNullable<DesktopUpdaterState["errorStage"]> = "check";
    if (state.status === "installing" || state.errorStage === "install") {
      stage = "install";
    }
    if (state.status === "preparing") {
      stage = "restart";
    }
    if (state.status === "downloading") {
      stage = "download";
    }
    fail(stage, error);
  });
  updater.on("download-progress", ({ percent }) => {
    if (state.status === "downloading") {
      publish({ percent: Math.min(100, Math.max(0, percent)) });
    }
  });
  updater.on("update-downloaded", (event) => {
    if (state.status === "installing" || state.errorStage === "install") {
      return;
    }
    verifiedDownload = true;
    downloadedVersion =
      event && typeof event.version === "string" ? event.version : null;
    publish({ status: "downloaded", percent: 100, errorStage: null });
  });
  const check = async () => {
    if (verifiedDownload) {
      publish({ status: "downloaded", errorStage: null });
      return;
    }
    publish({ status: "checking", errorStage: null });
    const result = await updater.checkForUpdates();
    if (!result) {
      throw new Error("Desktop updater is unavailable.");
    }
    // A newer version is exposed only after its complete feed is trusted.
    if (result.isUpdateAvailable) {
      assertDesktopUpdateFiles(result.updateInfo, platform);
    }
    publish({
      status: result.isUpdateAvailable ? "available" : "current",
      version: result.isUpdateAvailable ? result.updateInfo.version : null,
      percent: null,
    });
  };
  const download = async () => {
    if (
      verifiedDownload ||
      !(
        state.status === "available" ||
        (state.status === "error" && state.errorStage === "download")
      )
    ) {
      return;
    }
    publish({ status: "downloading", errorStage: null, percent: 0 });
    await updater.downloadUpdate();
  };
  const restart = async () => {
    if (!verifiedDownload || state.status === "installing") {
      return;
    }
    publish({ status: "preparing", errorStage: null });
    if (!(await input.prepareRestart())) {
      throw new Error("Desktop restart blocked by unsaved work.");
    }
    publish({ status: "installing" });
    input.setInstalling(true);
    if (platform === "macos-arm64") {
      assertMacUpdateBundlePath(input.currentAppBundle ?? null);
      const targetVersion = state.version ?? downloadedVersion;
      if (!(targetVersion && input.recordMacInstallRequested)) {
        throw new Error(
          "Desktop cannot preserve the macOS update installation receipt."
        );
      }
      input.recordMacInstallRequested(targetVersion);
    }
    updater.quitAndInstall();
  };
  return {
    snapshot: () => state,
    act(action: DesktopUpdaterAction): Promise<void> {
      if (
        operation ||
        state.status === "installing" ||
        state.errorStage === "install"
      ) {
        return operation ?? Promise.resolve();
      }
      operation = { check, download, restart }
        [action]()
        .catch((error) =>
          fail(
            action === "restart" &&
              (state.status === "installing" || state.errorStage === "install")
              ? "install"
              : action,
            error
          )
        )
        .finally(() => {
          operation = null;
        });
      return operation;
    },
  };
}
