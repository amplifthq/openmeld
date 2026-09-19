import { fileURLToPath } from "node:url";
import { runOwnedCommand } from "./owned-command.mjs";

// The existing Web launcher owns its lane, secrets, build and lifetime. This
// convenience command changes only its documented compiled-pilot mode.
process.exitCode = await runOwnedCommand("pnpm", ["dev:web:worktree"], {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
  env: { ...process.env, OPENMELD_DESKTOP_PILOT: "1" },
});
