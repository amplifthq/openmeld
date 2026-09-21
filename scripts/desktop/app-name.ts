import {
  DESKTOP_AUTH_SCHEME,
  DESKTOP_INSTALLED_AUTH_SCHEME,
  DESKTOP_TEST_AUTH_SCHEME,
} from "../../packages/schemas/src/desktop-auth-identity.ts";

const WORKTREE_APP_ID_SUFFIX = /^(wt-[a-f0-9]{12})\.p\d+$/u;

// Naming contract: developing/clients/desktop-app-identity.md.
/** Build-time presentation of an already selected identity, never a target selector. */
export function desktopAppName(appId: string): string {
  if (appId === DESKTOP_INSTALLED_AUTH_SCHEME) {
    return "OpenMeld";
  }
  if (appId === DESKTOP_TEST_AUTH_SCHEME) {
    return "OpenMeld Test";
  }
  if (appId === DESKTOP_AUTH_SCHEME) {
    return "OpenMeld Dev";
  }
  if (appId.startsWith(`${DESKTOP_AUTH_SCHEME}.`)) {
    const worktree = WORKTREE_APP_ID_SUFFIX.exec(
      appId.slice(DESKTOP_AUTH_SCHEME.length + 1)
    );
    if (worktree) {
      return `OpenMeld Dev ${worktree[1]}`;
    }
  }
  throw new Error(`Unknown Desktop application identity: ${appId}`);
}

type DesktopNameConfiguration = {
  extraMetadata?: Record<string, unknown>;
  mac?: { extendInfo?: Record<string, unknown> };
};

/** Keep Finder/Notifications, Electron metadata, and native UI on the same name. */
export function withDesktopAppName<T extends DesktopNameConfiguration>(
  build: T,
  appId: string
) {
  const productName = desktopAppName(appId);
  return {
    ...build,
    appId,
    productName,
    extraMetadata: { ...build.extraMetadata, productName },
    mac: {
      ...build.mac,
      extendInfo: {
        ...build.mac?.extendInfo,
        CFBundleName: productName,
        CFBundleDisplayName: productName,
      },
    },
  };
}
