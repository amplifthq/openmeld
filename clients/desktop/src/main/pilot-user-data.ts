import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DesktopInstalledTarget } from "@openmeld/schemas";
import type { App } from "electron";

type DesktopCredentialStorageApp = {
  commandLine: Pick<App["commandLine"], "appendSwitch" | "removeSwitch">;
};

type DesktopCredentialStorageInput = {
  installed: boolean;
  lane: "dev-local" | "canary" | "prod";
  platform: NodeJS.Platform;
  webOrigin: string;
};

export function configureInstalledUserData(
  app: Pick<App, "setPath" | "getPath">,
  target: DesktopInstalledTarget
) {
  const directory = join(app.getPath("appData"), target.dataDirectory);
  mkdirSync(directory, { recursive: true });
  app.setPath("userData", directory);
  if (resolve(app.getPath("userData")) !== resolve(directory)) {
    throw new Error("Desktop could not open its private application storage.");
  }
}

/** Must run before Better Auth creates its encrypted storage. */
export function configurePilotUserData(
  app: Pick<App, "setPath" | "getPath">,
  env: NodeJS.ProcessEnv
) {
  const home = env.OPENMELD_HOME;
  const directory = env.OPENMELD_DESKTOP_USER_DATA_DIR;
  if (
    !(home && directory) ||
    resolve(home) === join(homedir(), ".openmeld") ||
    resolve(directory) !== resolve(home, "desktop", "mock-keychain-user-data")
  ) {
    throw new Error(
      "Start the Desktop pilot through this worktree's repo-root Desktop command to isolate GUI data."
    );
  }
  const expected = resolve(directory);
  mkdirSync(expected, { recursive: true });
  app.setPath("userData", expected);
  if (resolve(app.getPath("userData")) !== expected) {
    throw new Error("Desktop GUI data isolation did not take effect.");
  }
}

/** Must run before Better Auth or Chromium initializes credential storage. */
export function configureDesktopCredentialStorage(
  app: DesktopCredentialStorageApp,
  input: DesktopCredentialStorageInput
) {
  const hostname = new URL(input.webOrigin).hostname;
  const localPilot =
    input.platform === "darwin" &&
    !input.installed &&
    input.lane !== "prod" &&
    (hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".localhost"));

  if (!localPilot) {
    // Installed production, staging, and acceptance builds always exercise the
    // real system credential store, even if a parent process supplied a flag.
    app.commandLine.removeSwitch("use-mock-keychain");
    return "system" as const;
  }

  app.commandLine.appendSwitch("use-mock-keychain");
  return "mock" as const;
}
