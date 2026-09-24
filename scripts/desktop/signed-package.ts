import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readInstalledComputerEnvironment } from "./installed-computer-environment.ts";
import { readInstalledDesktopTarget } from "./installed-target.ts";

const releaseShaPattern = /^[a-f0-9]{40}$/u;

function assertInternalPreviewPackage(
  internalPreview: boolean,
  platform: NodeJS.Platform,
  target: ReturnType<typeof readInstalledDesktopTarget>
) {
  if (
    internalPreview &&
    (platform !== "win32" || target?.kind !== "production")
  ) {
    throw new Error(
      "Unsigned internal Desktop preview requires native Windows and the production account target."
    );
  }
}

/** Build-time policy shared by the package entry and direct builder invocation. */
export function readDesktopSignedPackageMode(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
) {
  const acceptance = env.OPENMELD_DESKTOP_ACCEPTANCE === "1";
  const production = env.OPENMELD_DESKTOP_PRODUCTION_PREVIEW === "1";
  const internalPreview = env.OPENMELD_DESKTOP_INTERNAL_PREVIEW === "1";
  if ([acceptance, production, internalPreview].filter(Boolean).length > 1) {
    throw new Error("Select one Desktop packaging mode.");
  }
  readInstalledComputerEnvironment(env);
  if (!(acceptance || production || internalPreview)) {
    return null;
  }
  const target = readInstalledDesktopTarget(env);
  assertInternalPreviewPackage(internalPreview, platform, target);
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
    if (platform === "darwin" && env[name]) {
      throw new Error(
        `Unset ${name} to use the local Desktop Keychain profile.`
      );
    }
  }
  if (production) {
    return "production-preview";
  }
  if (internalPreview) {
    return "internal-preview";
  }
  return "acceptance";
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

export function desktopInternalPreviewSource() {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const releaseSha = git("rev-parse", "HEAD");
  const changes = git("status", "--porcelain", "--untracked-files=normal");
  if (!releaseShaPattern.test(releaseSha) || changes) {
    throw new Error(
      `Windows internal preview packaging requires a clean exact source commit. ${changes}`
    );
  }
  return { releaseSha };
}
