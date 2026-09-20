import { basename, dirname } from "node:path";

export const MAC_PRODUCTION_PRODUCT_NAME = "OpenMeld";
export const MAC_PRODUCTION_APP_BUNDLE_NAME = "OpenMeld.app";
export const MAC_PRODUCTION_APP_ID = "sh.openmeld.desktop";

/** Earlier signed installs used this folder and cannot cross the rename through Squirrel.Mac. */
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

export function assertMacUpdateBundlePath(
  currentBundle: string | null
): string {
  if (!currentBundle) {
    throw new Error(
      "Desktop cannot determine the current macOS application folder."
    );
  }
  const name = basename(currentBundle);
  if (name === MAC_PRODUCTION_APP_BUNDLE_NAME) {
    return currentBundle;
  }
  if ((MAC_LEGACY_APP_BUNDLE_NAMES as readonly string[]).includes(name)) {
    throw new Error(
      "This legacy OpenMeld Desktop.app installation cannot update safely in place. Install or open the current signed OpenMeld.app first."
    );
  }
  throw new Error("Desktop cannot update from this application folder name.");
}
