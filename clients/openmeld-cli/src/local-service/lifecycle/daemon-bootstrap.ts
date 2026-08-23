import {
  type DaemonInstallState,
  getDaemonStatus,
  installDaemon,
} from "../../config/daemon-state";
import { resolveVersionChangeDirection } from "./version-change-direction";

export type DaemonAutoInstallMode = "always" | "ask" | "never";

export type DaemonBootstrapResult = {
  status: "already_installed" | "installed" | "skipped";
  mode: DaemonAutoInstallMode;
  missingBeforeCheck: boolean;
  autoInstalled: boolean;
  state: DaemonInstallState | null;
};

export type DaemonVersionSyncResult = {
  status: "already_current" | "updated" | "skipped" | "downgrade_blocked";
  mode: DaemonAutoInstallMode;
  outdatedBeforeCheck: boolean;
  autoUpdated: boolean;
  previousVersion: string | null;
  state: DaemonInstallState | null;
};

export async function ensureDaemonInstalledForCliStartup(input: {
  daemonVersion: string;
  mode?: DaemonAutoInstallMode;
  canPrompt?: boolean;
  confirmInstall?: () => Promise<boolean>;
}): Promise<DaemonBootstrapResult> {
  const mode = input.mode ?? "always";
  const status = await getDaemonStatus();
  if (status.installed && status.state) {
    return {
      status: "already_installed",
      mode,
      missingBeforeCheck: false,
      autoInstalled: false,
      state: status.state,
    };
  }

  const missingBeforeCheck = true;
  if (mode === "never") {
    return {
      status: "skipped",
      mode,
      missingBeforeCheck,
      autoInstalled: false,
      state: status.state,
    };
  }

  if (mode === "ask") {
    if (!(input.canPrompt && input.confirmInstall)) {
      return {
        status: "skipped",
        mode,
        missingBeforeCheck,
        autoInstalled: false,
        state: status.state,
      };
    }
    const shouldInstall = await input.confirmInstall();
    if (!shouldInstall) {
      return {
        status: "skipped",
        mode,
        missingBeforeCheck,
        autoInstalled: false,
        state: status.state,
      };
    }
  }

  const installResult = await installDaemon({
    daemonVersion: input.daemonVersion,
    source: "cli.auto_check",
  });
  return {
    status:
      installResult.status === "already_installed"
        ? "already_installed"
        : "installed",
    mode,
    missingBeforeCheck,
    autoInstalled: installResult.status === "installed",
    state: installResult.state,
  };
}

export async function ensureDaemonVersionForCliStartup(input: {
  daemonVersion: string;
  installedState: DaemonInstallState | null;
  mode?: DaemonAutoInstallMode;
  canPrompt?: boolean;
  confirmUpdate?: (input: {
    installedVersion: string;
    expectedVersion: string;
  }) => Promise<boolean>;
}): Promise<DaemonVersionSyncResult> {
  const mode = input.mode ?? "always";
  if (!input.installedState) {
    return {
      status: "already_current",
      mode,
      outdatedBeforeCheck: false,
      autoUpdated: false,
      previousVersion: null,
      state: null,
    };
  }

  if (input.installedState.daemonVersion === input.daemonVersion) {
    return {
      status: "already_current",
      mode,
      outdatedBeforeCheck: false,
      autoUpdated: false,
      previousVersion: input.installedState.daemonVersion,
      state: input.installedState,
    };
  }

  const previousVersion = input.installedState.daemonVersion;
  const versionDirection = resolveVersionChangeDirection({
    fromVersion: previousVersion,
    toVersion: input.daemonVersion,
  });
  if (versionDirection === "downgrade") {
    return {
      status: "downgrade_blocked",
      mode,
      outdatedBeforeCheck: false,
      autoUpdated: false,
      previousVersion,
      state: input.installedState,
    };
  }

  const outdatedBeforeCheck = true;
  if (mode === "never") {
    return {
      status: "skipped",
      mode,
      outdatedBeforeCheck,
      autoUpdated: false,
      previousVersion,
      state: input.installedState,
    };
  }

  if (mode === "ask") {
    if (!(input.canPrompt && input.confirmUpdate)) {
      return {
        status: "skipped",
        mode,
        outdatedBeforeCheck,
        autoUpdated: false,
        previousVersion,
        state: input.installedState,
      };
    }

    const shouldUpdate = await input.confirmUpdate({
      installedVersion: previousVersion,
      expectedVersion: input.daemonVersion,
    });
    if (!shouldUpdate) {
      return {
        status: "skipped",
        mode,
        outdatedBeforeCheck,
        autoUpdated: false,
        previousVersion,
        state: input.installedState,
      };
    }
  }

  const installResult = await installDaemon({
    daemonVersion: input.daemonVersion,
    source: "cli.auto_check",
  });
  return {
    status:
      installResult.status === "installed" ? "updated" : "already_current",
    mode,
    outdatedBeforeCheck,
    autoUpdated: installResult.status === "installed",
    previousVersion,
    state: installResult.state,
  };
}
