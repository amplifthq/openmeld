#!/usr/bin/env node
import { acquireLocalResources, RESOURCE_TOKEN } from "./local-resources.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

const args = process.argv
  .slice(2)
  .filter((arg, index) => index !== 0 || arg !== "--");
if (!args.length) {
  throw new Error(
    "Usage: node scripts/dev/run-local-heavy.mjs <command> [args]"
  );
}
const controller = new AbortController();
const cancel = () =>
  controller.abort(new Error("Local work cancelled before launch."));
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
let reservation;
try {
  // Hosted jobs have their own runner and the trusted control-plane's limits.
  if (!process.env.GITHUB_ACTIONS) {
    reservation = await acquireLocalResources({
      kind: "heavy",
      signal: controller.signal,
    });
  }
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  const command =
    process.platform === "win32" && args[0] === "pnpm" ? "pnpm.cmd" : args[0];
  process.exitCode = await runOwnedCommand(command, args.slice(1), {
    env: {
      ...process.env,
      ...(reservation ? { [RESOURCE_TOKEN]: reservation.token } : {}),
    },
  });
} catch (error) {
  console.error(`[local-resources] ${error.message}`);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  await reservation?.release();
}
