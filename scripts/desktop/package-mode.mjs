import { runOwnedCommand } from "../dev/owned-command.mjs";

// Portable root entrypoints replace POSIX-only environment assignment syntax.
const mode = process.argv[2];
if (mode !== "acceptance" && mode !== "production-preview") {
  throw new Error("Choose acceptance or production-preview Desktop packaging.");
}
const env = { ...process.env };
if (mode === "acceptance") {
  env.OPENMELD_DESKTOP_ACCEPTANCE = "1";
} else {
  env.OPENMELD_DESKTOP_PRODUCTION_PREVIEW = "1";
  env.OPENMELD_DESKTOP_TARGET = "production";
}
// The installed-package owner still checks source SHA, clean worktree, target,
// credentials and platform. This wrapper neither relaxes guards nor publishes.
const code = await runOwnedCommand("pnpm", ["desktop:package:installed"], {
  cwd: process.cwd(),
  env,
});
if (code !== 0) {
  process.exitCode = code;
}
