import { homedir } from "node:os";
import { join } from "node:path";
import {
  normalizeCommandEnvironment,
  WINDOWS_RUNTIME_ENV_KEYS,
} from "@openmeld/adapter-core/process-environment";
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
  const source = normalizeCommandEnvironment(process.env);
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
    ...(process.platform === "win32" ? WINDOWS_RUNTIME_ENV_KEYS : []),
  ]) {
    if (source[key]) {
      env[key] = source[key];
    }
  }
  const home =
    target.kind === "production"
      ? join(homedir(), ".openmeld")
      : (computer?.home ?? join(userData, "unconfigured-service"));
  return {
    openMeldBin: join(
      home,
      "bin",
      process.platform === "win32" ? "openmeld.exe" : "openmeld"
    ),
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
    },
  };
}
