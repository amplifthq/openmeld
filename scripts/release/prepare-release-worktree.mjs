#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function isReleaseDependencyReady(cwd) {
  try {
    createRequire(path.join(cwd, "packages/schemas/package.json")).resolve(
      "zod/v4"
    );
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "MODULE_NOT_FOUND"
    ) {
      return false;
    }
    throw error;
  }
}

function runPnpmInstall(args, cwd) {
  return spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
}

function installError(message, result) {
  const detail = result.stderr?.trim();
  return new Error(detail ? `${message}\n${detail}` : message);
}

export function prepareReleaseWorktree(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const isReady = input.isReady ?? (() => isReleaseDependencyReady(cwd));
  const runInstall = input.runInstall ?? ((args) => runPnpmInstall(args, cwd));

  if (isReady()) {
    return { status: "already_ready" };
  }

  const installResult = runInstall(["install", "--frozen-lockfile"]);
  if (installResult.status !== 0) {
    throw installError(
      "Release dependency installation failed.",
      installResult
    );
  }
  if (isReady()) {
    return { status: "prepared" };
  }

  process.stderr.write(
    "pnpm completed without creating the required release dependency links; retrying once with --force.\n"
  );
  const relinkResult = runInstall(["install", "--frozen-lockfile", "--force"]);
  if (relinkResult.status !== 0) {
    throw installError("Release dependency relink failed.", relinkResult);
  }
  if (!isReady()) {
    throw new Error(
      "Release dependencies are still unavailable after a forced relink."
    );
  }
  return { status: "prepared_after_relink" };
}

function main() {
  const result = prepareReleaseWorktree();
  const messages = {
    already_ready: "Release dependencies are ready.",
    prepared: "Release dependencies are installed and ready.",
    prepared_after_relink: "Release dependencies were relinked and are ready.",
  };
  process.stdout.write(`${messages[result.status]}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
