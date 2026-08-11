#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readDevLockPayload } from "./dev-lock.mjs";

export const ROOT_DEV_SKIP_SERVICE_PREDEV_ENV =
  "OPENMELD_ROOT_DEV_SKIP_SERVICE_PREDEV";
const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const ROOT_DEV_LOCK_FILE_PATH = resolve(
  REPO_ROOT,
  ".turbo",
  "dev",
  "openmeld-dev.lock"
);

export function shouldSkipServicePredev(input = {}) {
  const env = input.env ?? process.env;
  if (String(env[ROOT_DEV_SKIP_SERVICE_PREDEV_ENV] ?? "").trim() === "1") {
    return true;
  }

  const lockPayload = readDevLockPayload(
    input.lockFilePath ?? ROOT_DEV_LOCK_FILE_PATH
  );
  return lockPayload ? isPidAlive(lockPayload.pid) : false;
}

export async function runGuardedServicePredev(input) {
  const env = input.env ?? process.env;
  if (
    shouldSkipServicePredev({
      env,
      lockFilePath: input.lockFilePath,
    })
  ) {
    console.log(
      `[dev-predev] ${input.label}: skipped because root pnpm dev already ran shared startup prerequisites.`
    );
    return 0;
  }

  return await (input.runCommand ?? runShellCommand)(input.command, {
    cwd: input.cwd,
    env,
  });
}

async function runShellCommand(command, options) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: true,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`command exited from signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function parseCliArgs(argv) {
  const [label, command] = argv;
  if (!(label && command)) {
    throw new Error(
      "run-guarded-service-predev.mjs requires <label> and <command>"
    );
  }
  return { command, label };
}

function isPidAlive(pid) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { command, label } = parseCliArgs(process.argv.slice(2));
  const exitCode = await runGuardedServicePredev({
    command,
    cwd: process.cwd(),
    label,
  });
  process.exit(exitCode);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(
      `[dev-predev] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}
