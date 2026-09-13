import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { App } from "electron";

/** Must run before Better Auth creates its encrypted storage. */
export function configurePilotUserData(
  app: Pick<App, "setPath" | "getPath">,
  env: NodeJS.ProcessEnv
) {
  const home = env.OPENMELD_HOME;
  const directory = env.OPENMELD_DESKTOP_USER_DATA_DIR;
  if (
    !(home && directory) ||
    resolve(home) === join(homedir(), ".openmeld") ||
    resolve(directory) !== resolve(home, "desktop", "user-data")
  ) {
    throw new Error(
      "Start the Desktop pilot through this worktree's repo-root Desktop command to isolate GUI data."
    );
  }
  const expected = resolve(directory);
  mkdirSync(expected, { recursive: true });
  app.setPath("userData", expected);
  if (resolve(app.getPath("userData")) !== expected) {
    throw new Error("Desktop GUI data isolation did not take effect.");
  }
}
