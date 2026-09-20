import { basename, dirname, join } from "node:path";

/** Production installed folder after the 0.1.2 product-name change. */
export const MAC_PRODUCTION_APP_BUNDLE_NAME = "OpenMeld.app";

/** Earlier signed installs used this folder. Squirrel.Mac cannot relaunch after renaming it. */
export const MAC_LEGACY_APP_BUNDLE_NAMES = ["OpenMeld Desktop.app"] as const;

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
  if (!input.currentBundle || basename(input.currentBundle) === targetName) {
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
