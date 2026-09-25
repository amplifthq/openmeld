import { runOwnedCommand } from "../dev/owned-command.mjs";

// Portable root entrypoints replace POSIX-only environment assignment syntax.
const mode = process.argv[2];
if (!["acceptance", "production-preview", "internal-preview"].includes(mode)) {
  throw new Error(
    "Choose acceptance, internal-preview, or production-preview Desktop packaging."
  );
}
const env = { ...process.env };
if (mode === "acceptance") {
  env.OPENMELD_DESKTOP_ACCEPTANCE = "1";
} else if (mode === "internal-preview") {
  env.OPENMELD_DESKTOP_INTERNAL_PREVIEW = "1";
  env.OPENMELD_DESKTOP_TARGET = "production";
} else {
  const { checkDesktopPublisher } = await import(
    "../release/desktop-publisher.mjs"
  );
  await checkDesktopPublisher();
  env.CLOUDFLARE_ACCOUNT_ID = undefined;
  env.CLOUDFLARE_API_TOKEN = undefined;
  env.CLOUDFLARE_OPENMELD_RELEASE_API_TOKEN = undefined;
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
