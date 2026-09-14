import { homedir } from "node:os";
import { join } from "node:path";
import type { DesktopInstalledTarget } from "@openmeld/schemas";
import type { CommandDeps } from "./cli/commands";

/** No discovery or install occurs here; a missing carrier remains unavailable. */
export function installedCommandEnvironment(
  target: DesktopInstalledTarget,
  userData: string
): CommandDeps {
  const env: NodeJS.ProcessEnv = {};
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
      : join(userData, "unconfigured-service");
  return {
    openMeldBin: join(home, "bin", "openmeld"),
    env: {
      ...env,
      OPENMELD_HOME: home,
      OPENMELD_ENV_PRESET: target.kind === "production" ? "prod" : "dev-local",
      WEB_APP_URL: target.webOrigin,
      OPENMELD_DESKTOP_DOWNLOAD_PAGE_URL: new URL("/desktop", target.webOrigin)
        .href,
      OPENMELD_DESKTOP_UPDATE_MANIFEST_URL: new URL(
        "/desktop/update.json",
        target.webOrigin
      ).href,
    },
  };
}
