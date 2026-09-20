import { desktopDevelopmentContextSchema } from "../../packages/schemas/src/desktop-development.ts";

export function readDesktopDevelopmentContext(env: NodeJS.ProcessEnv) {
  const raw = env.OPENMELD_DESKTOP_DEVELOPMENT_CONTEXT;
  if (!raw) {
    return null;
  }
  if (
    env.OPENMELD_DESKTOP_TARGET ||
    env.OPENMELD_DESKTOP_PRIVATE_PACKAGE !== "1"
  ) {
    throw new Error(
      "Worktree development context cannot enter an installed build."
    );
  }
  return desktopDevelopmentContextSchema.parse(JSON.parse(raw));
}
