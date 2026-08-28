#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { statfsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { collectTargetProcesses } from "./dev-stop.mjs";
import { buildProcessMatcherContext } from "./process-matchers.mjs";
import { readProcessRows } from "./process-rows.mjs";

const GIBIBYTE = 1024 ** 3;
const LINE_SPLIT_PATTERN = /\r?\n/u;

export function buildDevMachineSnapshot(input) {
  const activeStacks = [];
  for (const repoRoot of [...new Set(input.worktreeRoots)]) {
    const processes = collectTargetProcesses(input.processRows, {
      currentPid: input.currentPid,
      matcherContext: buildProcessMatcherContext(repoRoot),
    });
    if (processes.length === 0) {
      continue;
    }
    activeStacks.push({
      coordinatorCount: processes.filter(
        (processRow) => processRow.kind === "coordinator"
      ).length,
      processCount: processes.length,
      repoRoot,
      workerCount: processes.filter(
        (processRow) => processRow.kind === "worker"
      ).length,
    });
  }
  return {
    activeProcessCount: activeStacks.reduce(
      (sum, stack) => sum + stack.processCount,
      0
    ),
    activeStacks: activeStacks.toSorted((left, right) =>
      left.repoRoot.localeCompare(right.repoRoot)
    ),
    availableBytes: input.availableBytes,
    repoRoot: input.repoRoot,
    totalBytes: input.totalBytes,
    worktreeCount: input.worktreeRoots.length,
  };
}

export function readDevMachineSnapshot(input = {}) {
  const repoRoot = path.resolve(
    input.repoRoot ??
      execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).trim()
  );
  const filesystem = statfsSync(repoRoot, { bigint: true });
  const worktreeRoots = readWorktreeRoots(repoRoot);
  return buildDevMachineSnapshot({
    availableBytes: Number(filesystem.bavail * filesystem.bsize),
    currentPid: input.currentPid ?? process.pid,
    processRows: readProcessRows({ repoRoot }),
    repoRoot,
    totalBytes: Number(filesystem.blocks * filesystem.bsize),
    worktreeRoots,
  });
}

export function renderDevMachineSnapshot(snapshot) {
  const lines = [
    "OpenMeld local development status",
    `Current worktree: ${snapshot.repoRoot}`,
    `Registered worktrees: ${String(snapshot.worktreeCount)}`,
    `Available disk: ${formatGibibytes(snapshot.availableBytes)}`,
    `Active dev stacks: ${String(snapshot.activeStacks.length)} (${String(snapshot.activeProcessCount)} processes)`,
  ];
  for (const stack of snapshot.activeStacks.slice(0, 8)) {
    lines.push(
      `- ${path.basename(stack.repoRoot)}: ${String(stack.processCount)} processes (${String(stack.coordinatorCount)} coordinators, ${String(stack.workerCount)} workers)`
    );
  }
  if (snapshot.activeStacks.length > 8) {
    lines.push(
      `- ${String(snapshot.activeStacks.length - 8)} more active stacks omitted; use --json for exact paths.`
    );
  }
  if (snapshot.activeStacks.length === 0) {
    lines.push("- none");
  }
  return `${lines.join("\n")}\n`;
}

function readWorktreeRoots(repoRoot) {
  return execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(LINE_SPLIT_PATTERN)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length)));
}

function formatGibibytes(bytes) {
  return `${(bytes / GIBIBYTE).toFixed(1)} GiB`;
}

function parseArgs(argv) {
  const options = { json: false };
  for (const argument of argv) {
    if (argument === "--" || argument === "status") {
      continue;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown dev status option: ${argument}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        "OpenMeld dev status\n\nUsage:\n  pnpm dev:status\n  pnpm dev:status -- --json\n"
      );
    } else {
      const snapshot = readDevMachineSnapshot();
      process.stdout.write(
        options.json
          ? `${JSON.stringify(snapshot, null, 2)}\n`
          : renderDevMachineSnapshot(snapshot)
      );
    }
  } catch (error) {
    process.stderr.write(
      `[dev-status] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
