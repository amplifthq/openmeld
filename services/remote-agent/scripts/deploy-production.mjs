import { spawnSync } from "node:child_process";

// Package build/deploy for production. scripts/release/deploy-component.mjs
// owns source admission and health; it passes the exact release source as
// --var RELEASE_SHA:<sha>, which is the only accepted argument.
const RELEASE_VAR = /^RELEASE_SHA:[0-9a-f]{40}$/u;
const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (
  !(
    args.length === 0 ||
    (args.length === 2 && args[0] === "--var" && RELEASE_VAR.test(args[1]))
  )
) {
  throw new Error(
    "Remote Agent deployment only accepts --var RELEASE_SHA:<sha>."
  );
}

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "dotenv",
    "-e",
    "../../.env",
    "-o",
    "--",
    "sh",
    "-c",
    'pnpm run build && pnpm run build:prod-config && wrangler deploy --config dist/openmeld_remote_agent/wrangler.prod.json "$@"',
    "remote-agent-deploy",
    ...args,
  ],
  { stdio: "inherit" }
);
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
