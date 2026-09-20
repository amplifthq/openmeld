import { basename, dirname, join } from "node:path";

export const MAC_PRODUCTION_PRODUCT_NAME = "OpenMeld";
export const MAC_PRODUCTION_APP_BUNDLE_NAME = "OpenMeld.app";
export const MAC_PRODUCTION_APP_ID = "sh.openmeld.desktop";
export const MAC_PRODUCTION_TEAM_ID = "38FFHDPA3B";

/** Earlier signed installs used this folder. Squirrel.Mac cannot relaunch after renaming it. */
export const MAC_LEGACY_APP_BUNDLE_NAMES = ["OpenMeld Desktop.app"] as const;

export function assertMacProductionBundleIdentity(input: {
  appId: string;
  productName: string;
}): void {
  if (
    input.appId !== MAC_PRODUCTION_APP_ID ||
    input.productName !== MAC_PRODUCTION_PRODUCT_NAME
  ) {
    throw new Error(
      "Production Desktop app identity changed. A macOS bundle-name change requires an explicit update migration."
    );
  }
}

export function readMacAppBundlePath(executablePath: string): string | null {
  let current = executablePath;
  for (let i = 0; i < 6; i += 1) {
    if (current.endsWith(".app")) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

export function resolveMacUpdateInstallPlan(input: {
  currentBundle: string | null;
  targetBundleName?: string;
}):
  | { kind: "squirrel" }
  | { kind: "rename"; currentBundle: string; targetBundle: string } {
  const targetName = input.targetBundleName ?? MAC_PRODUCTION_APP_BUNDLE_NAME;
  if (!input.currentBundle) {
    throw new Error(
      "Desktop cannot determine the current macOS application folder."
    );
  }
  if (basename(input.currentBundle) === targetName) {
    return { kind: "squirrel" };
  }
  if (
    !(MAC_LEGACY_APP_BUNDLE_NAMES as readonly string[]).includes(
      basename(input.currentBundle)
    )
  ) {
    throw new Error("Desktop cannot update from this application folder name.");
  }
  return {
    kind: "rename",
    currentBundle: input.currentBundle,
    targetBundle: join(dirname(input.currentBundle), targetName),
  };
}
