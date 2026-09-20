import { accessSync, constants, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { desktopDevelopmentContextSchema } from "@openmeld/schemas";

/** A system URL launch has no terminal environment. Restore only compiled coordinates. */
export function applyDesktopDevelopmentContext(
  value: unknown,
  env: NodeJS.ProcessEnv
) {
  if (value === null) {
    return;
  }
  const context = desktopDevelopmentContextSchema.parse(value);
  const root = resolve(context.repoRoot);
  const home = resolve(
    root,
    ".turbo",
    "dev",
    "isolated",
    context.laneId,
    "openmeld-home"
  );
  if (
    !isAbsolute(context.repoRoot) ||
    context.openMeldHome !== home ||
    realpathSync(home) !== home ||
    realpathSync(root) !== root
  ) {
    throw new Error(
      "The development app no longer belongs to its original worktree. Rebuild it with pnpm desktop:dev."
    );
  }
  const cli = join(home, "bin", "openmeld");
  accessSync(cli, constants.X_OK);
  if (!realpathSync(cli).startsWith(home + sep)) {
    throw new Error("The development app requires its own lane-local CLI.");
  }
  Object.assign(env, {
    OPENMELD_DESKTOP_PILOT: "1",
    OPENMELD_DEV_LANE_ID: context.laneId,
    OPENMELD_ENV_PRESET: context.preset,
    OPENMELD_HOME: home,
    OPENMELD_BIN: cli,
    OPENMELD_USER_FACING_CLI_COMMAND: cli,
    OPENMELD_DESKTOP_USER_DATA_DIR: join(
      home,
      "desktop",
      "mock-keychain-user-data"
    ),
    WEB_APP_URL: context.webOrigin,
    BETTER_AUTH_URL: context.authOrigin,
    OPENMELD_AUTH_URL: context.authOrigin,
    OPENMELD_GATEWAY_URL: context.gatewayOrigin,
  });
  env.OPENMELD_DESKTOP_RENDERER_DIR = undefined;
}
