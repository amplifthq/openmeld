import { Buffer } from "node:buffer";
import {
  type DesktopReleasePlatform,
  type DesktopUpdaterAction,
  type DesktopUpdaterState,
  desktopPlatformUpdateFeedUrl,
  desktopUpdaterFeedSchemaForPlatform,
} from "@openmeld/schemas";
import type { MacUpdater, NsisUpdater, UpdateInfo } from "electron-updater";
import { resolveMacUpdateInstallPlan } from "./mac-bundle-path";
import type { MacBundleRenameInstall } from "./mac-update-install";

export function assertDesktopUpdateFiles(
  info: UpdateInfo,
  platform: DesktopReleasePlatform = "macos-arm64"
) {
  desktopUpdaterFeedSchemaForPlatform(platform).parse(info);
}

type DownloadedUpdateIdentity = {
  downloadedFile: string;
  version: string;
  sha512Hex: string;
};

function readDownloadedUpdateIdentity(
  event: unknown
): DownloadedUpdateIdentity | null {
  if (!(event && typeof event === "object")) {
    return null;
  }
  const downloadedFile =
    "downloadedFile" in event && typeof event.downloadedFile === "string"
      ? event.downloadedFile
      : null;
  const version =
    "version" in event && typeof event.version === "string"
      ? event.version
      : null;
  const sha512 =
    "sha512" in event && typeof event.sha512 === "string"
      ? event.sha512
      : null;
  if (!(downloadedFile && version && sha512)) {
    return null;
  }
  const digest = Buffer.from(sha512, "base64");
  if (digest.length !== 64) {
    return null;
  }
  return {
    downloadedFile,
    version,
    sha512Hex: digest.toString("hex"),
  };
}

/** Application policy around electron-updater; no Service or account dependency. */
export function createAppUpdater(input: {
  updater: MacUpdater | NsisUpdater;
  platform?: DesktopReleasePlatform;
  currentVersion: string;
  currentAppBundle?: string | null;
  installRenamedMacBundle?: (install: MacBundleRenameInstall) => void;
  quitApp?: () => void;
  processId?: number;
  installReceiptPath?: string;
  publish: (state: DesktopUpdaterState) => void;
  prepareRestart: () => Promise<boolean>;
  setInstalling: (value: boolean) => void;
}) {
  const updater = input.updater;
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
  let downloadedUpdate: DownloadedUpdateIdentity | null = null;
  const publish = (patch: Partial<DesktopUpdaterState>) => {
    state = { ...state, ...patch };
    input.publish(state);
  };
  const fail = (
    stage: NonNullable<DesktopUpdaterState["errorStage"]>,
    error: unknown
  ) => {
    console.error("[openmeld.desktop.update_failed]", { stage, error });
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
    downloadedUpdate = readDownloadedUpdateIdentity(event);
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
      const plan = resolveMacUpdateInstallPlan({
        currentBundle: input.currentAppBundle ?? null,
      });
      if (plan.kind === "rename") {
        if (
          !(
            downloadedUpdate &&
            input.installRenamedMacBundle &&
            input.quitApp &&
            input.processId &&
            input.installReceiptPath
          )
        ) {
          throw new Error(
            "Desktop cannot hand a renamed application folder to Squirrel."
          );
        }
        if (downloadedUpdate.version !== state.version) {
          throw new Error(
            "Desktop downloaded update identity changed before installation."
          );
        }
        input.installRenamedMacBundle({
          zipPath: downloadedUpdate.downloadedFile,
          currentBundle: plan.currentBundle,
          targetBundle: plan.targetBundle,
          pid: input.processId,
          sourceVersion: input.currentVersion,
          expectedVersion: downloadedUpdate.version,
          expectedSha512Hex: downloadedUpdate.sha512Hex,
          receiptPath: input.installReceiptPath,
        });
        input.quitApp();
        return;
      }
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
