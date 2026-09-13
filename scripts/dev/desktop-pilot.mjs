import { accessSync, constants, realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIsolatedDevEnvironment,
  readCurrentIsolatedDevLane,
} from "./dev-isolated-lane.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function resolveDesktopPilotLaunch({
  lane,
  root = repoRoot,
  preset = "dev-local",
  env = process.env,
}) {
  if (preset !== "dev-local" && preset !== "canary") {
    throw new Error("Desktop pilot requires a development preset.");
  }
  if (resolve(lane.repoRoot) !== resolve(root)) {
    throw new Error("Desktop pilot lane belongs to another worktree.");
  }
  const cli = join(lane.openMeldHome, "bin", "openmeld");
  try {
    accessSync(cli, constants.X_OK);
    if (!realpathSync(cli).startsWith(realpathSync(lane.openMeldHome) + sep)) {
      throw new Error("CLI resolves outside the lane home.");
    }
  } catch (cause) {
    throw new Error(
      `Desktop pilot requires this lane's installed CLI at ${cli}. Complete this worktree's Web setup first.`,
      { cause }
    );
  }
  const userData = join(lane.openMeldHome, "desktop", "user-data");
  return {
    cwd: root,
    env: {
      ...env,
      ...buildIsolatedDevEnvironment(lane),
      OPENMELD_ENV_PRESET: preset,
      OPENMELD_USER_FACING_CLI_COMMAND: cli,
      OPENMELD_BIN: cli,
      OPENMELD_DESKTOP_PILOT: "1",
      OPENMELD_DESKTOP_RENDERER_DIR: join(root, "clients/web/dist/client"),
      OPENMELD_DESKTOP_USER_DATA_DIR: userData,
    },
    args: [
      "--dir",
      "clients/desktop",
      "exec",
      "electron",
      ".",
      `--user-data-dir=${userData}`,
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0] !== "canary")) {
    throw new Error("Usage: desktop-pilot.mjs [canary]");
  }
  const lane = readCurrentIsolatedDevLane(repoRoot);
  const launch = resolveDesktopPilotLaunch({
    lane,
    preset: args[0] === "canary" ? "canary" : "dev-local",
  });
  console.log(
    `Desktop pilot: ${lane.laneId}\nWeb: ${launch.env.WEB_APP_URL}\nOPENMELD_HOME: ${lane.openMeldHome}\nCLI: ${launch.env.OPENMELD_BIN}\nGUI data: ${launch.env.OPENMELD_DESKTOP_USER_DATA_DIR}`
  );
  const built = await runOwnedCommand(
    "pnpm",
    ["--dir", "clients/desktop", "build"],
    launch
  );
  if (built !== 0) {
    process.exitCode = built;
    return;
  }
  process.exitCode = await runOwnedCommand("pnpm", launch.args, launch);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
