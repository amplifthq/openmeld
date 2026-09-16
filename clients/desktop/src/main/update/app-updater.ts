import {
  DESKTOP_UPDATE_FEED_URL,
  type DesktopUpdaterAction,
  type DesktopUpdaterState,
  desktopUpdaterFeedSchema,
} from "@openmeld/schemas";
import type { MacUpdater, UpdateInfo } from "electron-updater";

export function assertDesktopUpdateFiles(info: UpdateInfo) {
  desktopUpdaterFeedSchema.parse(info);
}

/** Application policy around electron-updater; no Service or account dependency. */
export function createAppUpdater(input: {
  updater: MacUpdater;
  currentVersion: string;
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
  updater.setFeedURL({ provider: "generic", url: DESKTOP_UPDATE_FEED_URL });
  let state: DesktopUpdaterState = {
    status: "idle",
    currentVersion: input.currentVersion,
    version: null,
    percent: null,
    errorStage: null,
  };
  let operation: Promise<void> | null = null;
  let verifiedDownload = false;
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
  updater.on("update-downloaded", () => {
    if (state.status === "installing" || state.errorStage === "install") {
      return;
    }
    verifiedDownload = true;
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
      assertDesktopUpdateFiles(result.updateInfo);
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
