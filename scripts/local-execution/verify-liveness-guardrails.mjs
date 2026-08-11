#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const CLI_ENTRY_RELATIVE_PATH = "clients/openmeld-cli/dist/openmeld-dev.js";
const MIN_NODE_MAJOR = 20;

export const REQUIRED_FILES = [
  "runtime/local-execution/test/heartbeat-watchdog.low-traffic.test.ts",
  "runtime/local-execution/test/heartbeat-watchdog.reconnect-fault-injection.test.ts",
];

export const COMMANDS = [
  {
    command: "pnpm",
    args: ["--filter", "@openmeld/local-execution", "test"],
    label: "local-execution test",
  },
  {
    command: "pnpm",
    args: ["--filter", "@openmeld/local-execution", "check"],
    label: "local-execution check",
  },
  {
    command: "pnpm",
    args: [
      "--filter",
      "@openmeld/local-execution",
      "run",
      "test:liveness:low-traffic",
    ],
    label: "liveness low-traffic simulation",
  },
  {
    command: "pnpm",
    args: [
      "--filter",
      "@openmeld/local-execution",
      "run",
      "test:liveness:reconnect-fault",
    ],
    label: "liveness reconnect fault-injection",
  },
  {
    command: "pnpm",
    args: ["--filter", "openmeld", "build"],
    label: "cli build for service smoke",
  },
  {
    command: "node",
    args: [CLI_ENTRY_RELATIVE_PATH, "--view", "human", "service", "status"],
    label: "cli service status smoke (human view)",
  },
  {
    command: "node",
    args: [CLI_ENTRY_RELATIVE_PATH, "--view", "agent", "service", "status"],
    label: "cli service status smoke (agent view)",
  },
];

const fail = (message) => {
  throw new Error(message);
};

const assertRuntimePrerequisites = () => {
  const currentNodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "",
    10
  );
  if (Number.isNaN(currentNodeMajor) || currentNodeMajor < MIN_NODE_MAJOR) {
    fail(
      `verify-liveness-guardrails requires Node >=${MIN_NODE_MAJOR} because CLI smoke runs OpenMeld CLI build/status. Current: ${process.versions.node}`
    );
  }
};

const assertRequiredFiles = () => {
  for (const file of REQUIRED_FILES) {
    const filePath = path.resolve(REPO_ROOT, file);
    if (!existsSync(filePath)) {
      fail(`missing required liveness test file: ${file}`);
    }
  }
};

const runCommand = (input) => {
  const result = spawnSync(input.command, input.args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status === 0) {
    return;
  }

  const details = [
    `exit=${String(result.status ?? "null")}`,
    `signal=${String(result.signal ?? "none")}`,
    `error=${result.error instanceof Error ? result.error.message : "none"}`,
  ].join(", ");
  fail(`${input.label} failed (${details})`);
};

const main = () => {
  assertRuntimePrerequisites();
  assertRequiredFiles();

  for (const command of COMMANDS) {
    runCommand(command);
  }

  process.stdout.write("Liveness guardrails verification passed.\n");
};

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify-liveness-guardrails failed: ${message}\n`);
    process.exit(1);
  }
}
