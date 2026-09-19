import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { App } from "electron";

type CallbackApp = Pick<
  App,
  "isPackaged" | "whenReady" | "getPath" | "getApplicationInfoForProtocol"
>;

/** Check the OS-selected receiver before creating process-local PKCE state. */
export async function assertPilotAuthCallback(
  app: CallbackApp,
  scheme: string,
  platform = process.platform
) {
  if (platform !== "darwin") {
    return;
  }
  if (!app.isPackaged) {
    throw new Error(
      "macOS browser sign-in needs a worktree app bundle. Run pnpm desktop:dev from the repository root, not electron ."
    );
  }
  await app.whenReady();
  const expected = realpathSync(dirname(dirname(dirname(app.getPath("exe")))));
  let selected: string;
  try {
    const info = await app.getApplicationInfoForProtocol(
      `${scheme}://auth/callback`
    );
    // Electron versions may expose the application bundle or its executable.
    selected = realpathSync(info.path);
    if (selected.includes(".app/Contents/MacOS/")) {
      selected = dirname(dirname(dirname(selected)));
    }
  } catch {
    throw new Error(
      "macOS has no verified receiver for this worktree's sign-in. Run pnpm desktop:doctor, then relaunch with pnpm desktop:dev."
    );
  }
  if (resolve(selected) !== expected) {
    throw new Error(
      `macOS would return sign-in to a different app (${selected}). Run pnpm desktop:doctor; do not close other worktrees or reuse this sign-in link.`
    );
  }
}
