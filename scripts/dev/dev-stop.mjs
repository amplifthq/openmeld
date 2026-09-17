#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readIsolatedDevOwners } from "./dev-isolated-lane.mjs";
import { findActiveDevLockHolder, readDevLockPayload } from "./dev-lock.mjs";
import { manageWorktreeDevService } from "./dev-service.mjs";
import {
  buildProcessMatcherContext,
  isDevGuardCommand,
  isRepoProcessCommand,
  isTurboDevCommand,
  isWebViteDevCommand,
  isWranglerDevCommand,
  isWranglerWorkerdCommand,
  normalizeProcessMatchText,
} from "./process-matchers.mjs";
import { readProcessRows } from "./process-rows.mjs";
import { collectDescendants, stopProcessTree } from "./process-tree.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const lockFile = join(repoRoot, ".turbo", "dev", "openmeld-dev.lock");
const processMatcherContext = buildProcessMatcherContext(repoRoot);

const helpRequested =
  process.argv.includes("--help") || process.argv.includes("-h");
const dryRun = process.argv.includes("--dry-run");

if (isDirectExecution()) {
  if (helpRequested) {
    printHelp();
    process.exit(0);
  }

  run().catch((error) => {
    console.error(`[dev-stop] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

async function run() {
  manageWorktreeDevService(repoRoot, { dryRun });
  const rows = readProcessRows({ repoRoot, includeMetrics: true });
  const targets = collectTargetProcesses(rows, {
    roots: readIsolatedDevOwners(repoRoot, rows),
  });

  if (targets.length === 0) {
    if (dryRun) {
      console.log("[dev-stop] no local OpenMeld dev server processes found.");
      console.log("[dev-stop] dry-run enabled, lockfile was left unchanged.");
      return;
    }
    clearLockFile();
    console.log("[dev-stop] no local OpenMeld dev server processes found.");
    return;
  }

  console.log(
    `[dev-stop] stopping ${targets.length} process(es): ${targets
      .map((row) => String(row.pid))
      .join(", ")}`
  );
  for (const row of targets) {
    console.log(`[dev-stop] - ${row.pid} ${summarizeCommand(row.command)}`);
  }

  if (dryRun) {
    console.log("[dev-stop] dry-run enabled, no process was terminated.");
    return;
  }

  await stopProcessTree(targets, { repoRoot });

  clearLockFile();
  console.log("[dev-stop] done.");
}

export function collectTargetProcesses(rows, options = {}) {
  const { currentPid = process.pid, matcherContext = processMatcherContext } =
    options;
  const result = (options.roots ?? []).map((row) => ({
    ...row,
    kind: "coordinator",
  }));

  for (const row of rows) {
    if (row.pid === currentPid) {
      continue;
    }

    const command = row.command;
    const normalizedCommand = normalizeProcessMatchText(command);
    const inRepo = isRepoProcessCommand(normalizedCommand, matcherContext);
    if (!inRepo) {
      continue;
    }

    const isGuard = isDevGuardCommand(normalizedCommand, matcherContext);
    const isTurboDev = isTurboDevCommand(normalizedCommand);
    const isWranglerDev = isWranglerDevCommand(
      normalizedCommand,
      matcherContext
    );
    const isWranglerWorkerd = isLocalWranglerWorkerd(
      normalizedCommand,
      matcherContext
    );
    const isWebViteDev = isWebViteDevCommand(normalizedCommand, matcherContext);
    const isCliBinaryServer = normalizedCommand.includes(
      "scripts/dev/serve-cli-binary.mjs"
    );

    if (isGuard || isTurboDev) {
      result.push({ ...row, kind: "coordinator" });
      continue;
    }
    if (
      isWranglerDev ||
      isWranglerWorkerd ||
      isWebViteDev ||
      isCliBinaryServer
    ) {
      result.push({ ...row, kind: "worker" });
    }
  }

  const attributed = new Map(dedupeByPid(result).map((row) => [row.pid, row]));
  return collectDescendants(rows, [...attributed.keys()], [currentPid]).map(
    (row) => attributed.get(row.pid) ?? { ...row, kind: "worker" }
  );
}

function isLocalWranglerWorkerd(normalizedCommand, matcherContext) {
  return isWranglerWorkerdCommand(normalizedCommand, matcherContext);
}

function dedupeByPid(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    if (seen.has(row.pid)) {
      continue;
    }
    seen.add(row.pid);
    deduped.push(row);
  }
  return deduped;
}

function summarizeCommand(command) {
  if (command.length <= 120) {
    return command;
  }
  return `${command.slice(0, 117)}...`;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function clearLockFile() {
  if (!existsSync(lockFile)) {
    return;
  }

  const lockPayload = readDevLockPayload(lockFile);
  const rows = lockPayload ? readProcessRows({ repoRoot }) : [];
  const activeLockHolder = findActiveDevLockHolder(lockPayload, rows, {
    repoRoot,
    matcherContext: processMatcherContext,
    isPidAlive,
  });
  if (activeLockHolder) {
    throw new Error(
      `Dev stack owner ${lockPayload.pid} is still active. Its lock was preserved.`
    );
  }

  rmSync(lockFile, { force: true });
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function printHelp() {
  console.log("OpenMeld dev stop");
  console.log("");
  console.log("Usage:");
  console.log("  pnpm dev:stop");
  console.log("  pnpm dev:stop -- --dry-run");
  console.log("");
  console.log("Behavior:");
  console.log(
    "  - Gracefully stops local OpenMeld dev processes, including clients/web (SIGTERM)"
  );
  console.log("  - Force stops remaining processes after timeout (SIGKILL)");
  console.log("  - Clears .turbo/dev/openmeld-dev.lock");
}

function isDirectExecution() {
  return process.argv[1] ? resolve(process.argv[1]) === scriptPath : false;
}
