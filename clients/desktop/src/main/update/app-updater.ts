import {
  type DesktopReleasePlatform,
  type DesktopUpdaterAction,
  type DesktopUpdaterFailureDiagnostic,
  type DesktopUpdaterState,
  desktopPlatformUpdateFeedUrl,
  desktopUpdaterFeedSchemaForPlatform,
} from "@openmeld/schemas";
import { CancellationToken } from "builder-util-runtime";
import type { MacUpdater, NsisUpdater, UpdateInfo } from "electron-updater";
import { assertMacUpdateBundlePath } from "./mac-bundle-path";
import { describeUpdateFailure } from "./update-failure-diagnostic";

export function assertDesktopUpdateFiles(
  info: UpdateInfo,
  platform: DesktopReleasePlatform = "macos-arm64"
) {
  desktopUpdaterFeedSchemaForPlatform(platform).parse(info);
}

function recordMacInstallEvidence(input: {
  platform: DesktopReleasePlatform;
  currentAppBundle?: string | null;
  targetVersion: string | null;
  recordMacInstallRequested?: (targetVersion: string) => void;
}): void {
  if (input.platform !== "macos-arm64") {
    return;
  }
  assertMacUpdateBundlePath(input.currentAppBundle ?? null);
  if (!(input.targetVersion && input.recordMacInstallRequested)) {
    return;
  }
  try {
    input.recordMacInstallRequested(input.targetVersion);
  } catch (error) {
    // The receipt is bounded diagnostic evidence, not installation authority.
    // Never turn an observability write into a new updater outage after the
    // signed bundle path itself was verified.
    console.warn("[openmeld.desktop.update_install_receipt_write_failed]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

/** Application policy around electron-updater; no Service or account dependency. */
export function createAppUpdater(input: {
  updater: MacUpdater | NsisUpdater;
  platform?: DesktopReleasePlatform;
  currentVersion: string;
  currentAppBundle?: string | null;
  recordMacInstallRequested?: (targetVersion: string) => void;
  recordFailure?: (record: DesktopUpdaterFailureDiagnostic) => void;
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
    canCancelDownload: true,
    currentVersion: input.currentVersion,
    version: null,
    percent: null,
    errorStage: null,
  };
  let operation: Promise<void> | null = null;
  let downloadAttempt: { token: CancellationToken; stalled: boolean } | null =
    null;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const watchProgress = () => {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      if (downloadAttempt && state.status === "downloading") {
        downloadAttempt.stalled = true;
        downloadAttempt.token.cancel();
      }
    }, 90_000);
  };
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
    const diagnostic = describeUpdateFailure({
      error,
      stage,
      currentVersion: input.currentVersion,
      targetVersion: state.version,
    });
    console.error("[openmeld.desktop.update_failed]", diagnostic);
    try {
      input.recordFailure?.(diagnostic);
    } catch {
      console.warn("[openmeld.desktop.update_diagnostic_write_failed]");
    }
    // MacUpdater has no public cancellation for its pending native install.
    // Once accepted, keep the saved renderer frozen and normal quit enabled.
    publish({ status: "error", errorStage: stage, percent: null });
  };
  updater.on("error", (error) => {
    if (downloadAttempt?.token.cancelled) {
      return;
    }
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
      if (downloadAttempt?.token.cancelled) {
        return;
      }
      if (percent > (state.percent ?? 0)) {
        watchProgress();
      }
      if (percent >= 100) {
        clearTimeout(progressTimer);
      }
      publish({ percent: Math.min(100, Math.max(0, percent)) });
    }
  });
  updater.on("update-downloaded", (event) => {
    if (downloadAttempt?.token.cancelled) {
      return;
    }
    clearTimeout(progressTimer);
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
    const attempt = { token: new CancellationToken(), stalled: false };
    downloadAttempt = attempt;
    watchProgress();
    try {
      await updater.downloadUpdate(attempt.token);
    } catch (error) {
      if (!attempt.token.cancelled) {
        throw error;
      }
      if (attempt.stalled) {
        throw Object.assign(
          new Error("Update download stopped making progress."),
          {
            code: "ERR_UPDATER_DOWNLOAD_STALLED",
          }
        );
      }
      publish({ status: "available", percent: null, errorStage: null });
    } finally {
      clearTimeout(progressTimer);
      downloadAttempt = null;
    }
  };
  const restart = async () => {
    if (!verifiedDownload || state.status === "installing") {
      return;
    }
    publish({ status: "preparing", errorStage: null });
    if (!(await input.prepareRestart())) {
      throw new Error("Desktop restart blocked by unsaved work.");
    }
    recordMacInstallEvidence({
      platform,
      currentAppBundle: input.currentAppBundle,
      targetVersion: state.version ?? downloadedVersion,
      recordMacInstallRequested: input.recordMacInstallRequested,
    });
    publish({ status: "installing" });
    input.setInstalling(true);
    updater.quitAndInstall();
  };
  return {
    snapshot: () => state,
    act(action: DesktopUpdaterAction): Promise<void> {
      if (action === "cancel") {
        if (state.status === "downloading") {
          downloadAttempt?.token.cancel();
        }
        return operation ?? Promise.resolve();
      }
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
