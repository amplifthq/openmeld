import { homedir } from "node:os";
import { join } from "node:path";
import type { DesktopInstalledTarget } from "@openmeld/schemas";
import type { CommandDeps } from "./cli/commands";

declare const __OPENMELD_DESKTOP_COMPUTER_ENVIRONMENT__: {
  home: string;
  auth: string;
  gateway: string;
} | null;

/** Fixed managed carrier and lane. The connection operation owns bootstrap. */
export function installedCommandEnvironment(
  target: DesktopInstalledTarget,
  userData: string
): CommandDeps {
  const env: NodeJS.ProcessEnv = {};
  const computer =
    typeof __OPENMELD_DESKTOP_COMPUTER_ENVIRONMENT__ === "undefined"
      ? null
      : __OPENMELD_DESKTOP_COMPUTER_ENVIRONMENT__;
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  const home =
    target.kind === "production"
      ? join(homedir(), ".openmeld")
      : (computer?.home ?? join(userData, "unconfigured-service"));
  return {
    openMeldBin: join(home, "bin", "openmeld"),
    env: {
      ...env,
      OPENMELD_HOME: home,
      OPENMELD_ENV_PRESET: target.kind === "production" ? "prod" : "dev-local",
      WEB_APP_URL: target.webOrigin,
      OPENMELD_CLI_BINARY_MANIFEST_URL: new URL(
        "/cli/manifest.json",
        target.webOrigin
      ).href,
      ...(target.kind === "disposable" && computer
        ? {
            OPENMELD_AUTH_URL: computer.auth,
            OPENMELD_GATEWAY_URL: computer.gateway,
          }
        : {}),
      OPENMELD_DESKTOP_DOWNLOAD_PAGE_URL: new URL("/desktop", target.webOrigin)
        .href,
      OPENMELD_DESKTOP_UPDATE_MANIFEST_URL: new URL(
        "/desktop/update.json",
        target.webOrigin
      ).href,
    },
  };
}
