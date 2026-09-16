import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readInstalledComputerEnvironment } from "./installed-computer-environment.ts";
import { readInstalledDesktopTarget } from "./installed-target.ts";

const releaseShaPattern = /^[a-f0-9]{40}$/u;

/** Build-time policy shared by the package entry and direct builder invocation. */
export function readDesktopSignedPackageMode(env: NodeJS.ProcessEnv) {
  const acceptance = env.OPENMELD_DESKTOP_ACCEPTANCE === "1";
  const production = env.OPENMELD_DESKTOP_PRODUCTION_PREVIEW === "1";
  if (acceptance && production) {
    throw new Error("Select either Desktop acceptance or production preview.");
  }
  readInstalledComputerEnvironment(env);
  if (!(acceptance || production)) {
    return null;
  }
  const target = readInstalledDesktopTarget(env);
  if (production) {
    if (target?.kind !== "production") {
      throw new Error(
        "Signed Desktop production preview requires the production target."
      );
    }
    for (const name of Object.keys(env)) {
      if (
        (name.startsWith("OPENMELD_DESKTOP_TEST_") ||
          name === "OPENMELD_DESKTOP_PRIVATE_PACKAGE" ||
          name === "OPENMELD_DESKTOP_PILOT") &&
        env[name]
      ) {
        throw new Error(`Unset ${name} for a production Desktop package.`);
      }
    }
  }
  for (const name of [
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "CSC_LINK",
  ]) {
    if (env[name]) {
      throw new Error(
        `Unset ${name} to use the local Desktop Keychain profile.`
      );
    }
  }
  return production ? "production-preview" : "acceptance";
}

export function desktopProductionSource(env: NodeJS.ProcessEnv) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sha = env.OPENMELD_DESKTOP_RELEASE_SHA;
  if (!(sha && releaseShaPattern.test(sha))) {
    throw new Error(
      "Set OPENMELD_DESKTOP_RELEASE_SHA to the approved merged release commit."
    );
  }
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (
    git("rev-parse", "HEAD") !== sha ||
    git("status", "--porcelain", "--untracked-files=normal")
  ) {
    throw new Error(
      "Production Desktop packaging requires the clean exact release commit."
    );
  }
  git("merge-base", "--is-ancestor", sha, "origin/main");
  return { releaseSha: sha };
}
