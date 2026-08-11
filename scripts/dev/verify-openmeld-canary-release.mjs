#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

if (import.meta.url === `file://${process.argv[1]}`) {
  runReleaseVerification().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

async function runReleaseVerification() {
  await run("pnpm", ["run", "openmeld:canary:verify-service"]);
  await run("pnpm", ["run", "openmeld:canary:verify-journey"]);
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(`${command} ${args.join(" ")} failed with exit code ${code}`)
      );
    });
  });
}
