#!/usr/bin/env node

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFileExists,
  installShortcutWrapper,
  normalizeAction,
  removeShortcutWrapper,
} from "./shortcut-helpers.mjs";

const OPENMELD_DEV_COMMAND = "openmeld-dev";
const OPENMELD_DEV_ENTRY_COMMAND = "openmeld-dev";
const OPENMELD_DEV_ENV_PRESET = "dev-local";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_ENTRY_PATH = join(
  REPO_ROOT,
  "clients",
  "openmeld-cli",
  "dist",
  "openmeld-dev.js"
);
const OPENMELD_DEV_SCRIPT_PATH = join(
  REPO_ROOT,
  "scripts",
  "dev",
  "openmeld-dev.mjs"
);
const FRESHNESS_CHECK_PATH = join(
  REPO_ROOT,
  "scripts",
  "dev",
  "check-cli-entry-freshness.mjs"
);
const CLI_BUILD_COMMAND = "pnpm --filter openmeld build";
const CLI_FRESHNESS_SOURCE_PATHS = [
  join(REPO_ROOT, "clients", "openmeld-cli", "src"),
  join(REPO_ROOT, "clients", "openmeld-cli", "skills"),
  join(REPO_ROOT, "clients", "openmeld-cli", "package.json"),
  join(REPO_ROOT, "clients", "openmeld-cli", "tsdown.config.ts"),
];

async function main() {
  const action = normalizeAction(process.argv[2]);
  if (action === "install") {
    await installOpenMeldDevShortcut();
    return;
  }
  if (action === "remove") {
    await removeOpenMeldDevShortcut();
    return;
  }
  throw new Error(
    `unsupported openmeld-dev shortcut action "${String(process.argv[2] ?? "")}"`
  );
}

async function installOpenMeldDevShortcut() {
  await assertFileExists(CLI_ENTRY_PATH, "repo-local openmeld-dev build");
  await assertFileExists(
    OPENMELD_DEV_SCRIPT_PATH,
    "repo-local openmeld-dev controller"
  );
  await assertFileExists(
    FRESHNESS_CHECK_PATH,
    "openmeld-dev freshness checker"
  );
  const installed = await installShortcutWrapper({
    commandName: OPENMELD_DEV_COMMAND,
    cliEntryPath: OPENMELD_DEV_SCRIPT_PATH,
    envPreset: OPENMELD_DEV_ENV_PRESET,
    freshnessCheck: {
      buildCommand: CLI_BUILD_COMMAND,
      checkerPath: FRESHNESS_CHECK_PATH,
      cliEntryPath: CLI_ENTRY_PATH,
      sourcePaths: CLI_FRESHNESS_SOURCE_PATHS,
    },
    userFacingCommand: OPENMELD_DEV_ENTRY_COMMAND,
  });
  console.log(`Installed ${OPENMELD_DEV_COMMAND}`);
  console.log(`CLI entry: ${CLI_ENTRY_PATH}`);
  console.log(`Shortcut controller: ${OPENMELD_DEV_SCRIPT_PATH}`);
  console.log(`Wrapper path: ${installed.wrapperPath}`);
}

async function removeOpenMeldDevShortcut() {
  await removeShortcutWrapper({
    commandName: OPENMELD_DEV_COMMAND,
  });
  console.log(`Removed ${OPENMELD_DEV_COMMAND}`);
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
