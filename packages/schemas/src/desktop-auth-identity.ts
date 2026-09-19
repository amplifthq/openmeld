export const DESKTOP_AUTH_SCHEME = "sh.openmeld.desktop.dev";
export const DESKTOP_INSTALLED_AUTH_SCHEME = "sh.openmeld.desktop";
export const DESKTOP_TEST_AUTH_SCHEME = "sh.openmeld.desktop.test";

const WORKTREE_HOST = /^wt-[a-f0-9]{12}\.localhost$/u;

/** Only trusted configuration selects a callback, never request/query values. */
export function desktopAuthIdentity(
  production: boolean,
  developmentTarget?: string,
  webOrigin?: string
) {
  const target = developmentTarget?.trim() || undefined;
  if (production) {
    if (target) {
      throw new Error(
        "Desktop development Auth targets are not allowed in production."
      );
    }
    return {
      clientId: "openmeld-desktop",
      authScheme: DESKTOP_INSTALLED_AUTH_SCHEME,
    };
  }
  if (!target || target === "private") {
    // Root lane URLs already identify worktrees. Keep the vendor client ID and
    // PKCE flow; isolate only the OS-wide callback namespace. Old non-lane local
    // environments retain the existing explicit private identity.
    const url = webOrigin ? new URL(webOrigin) : null;
    const worktree =
      url &&
      url.origin === webOrigin &&
      url.protocol === "http:" &&
      WORKTREE_HOST.test(url.hostname) &&
      url.port;
    return {
      clientId: "electron",
      authScheme: worktree
        ? `${DESKTOP_AUTH_SCHEME}.${url.hostname.slice(0, -10)}.p${url.port}`
        : DESKTOP_AUTH_SCHEME,
    };
  }
  if (target === "disposable") {
    return {
      clientId: "openmeld-desktop-test",
      authScheme: DESKTOP_TEST_AUTH_SCHEME,
    };
  }
  throw new Error("Unknown Desktop development Auth target.");
}
