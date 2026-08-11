#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFileExists,
  installShortcutWrapper,
  normalizeAction,
  removeShortcutWrapper,
  runCommand,
  runCommandCapture,
} from "./shortcut-helpers.mjs";

const OPENMELD_CANARY_COMMAND = "openmeld-canary";
const OPENMELD_CANARY_ENV_PRESET = "canary";
const OPENMELD_CANARY_DEFAULT_GATEWAY_URL = "http://localhost:8080";
const OPENMELD_CANARY_DEFAULT_AUTH_URL = "http://localhost:8788";
const OPENMELD_CANARY_INSTALL_ROOT = join(
  homedir(),
  ".local",
  "share",
  "openmeld-canary"
);
const OPENMELD_CANARY_PACKAGE_PREFIX = join(
  OPENMELD_CANARY_INSTALL_ROOT,
  "package-install"
);
const OPENMELD_CANARY_TARBALLS_DIR = join(
  OPENMELD_CANARY_INSTALL_ROOT,
  "tarballs"
);
const CLI_PACKAGE_NAME = "openmeld";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_PACKAGE_ROOT = join(REPO_ROOT, "clients", "openmeld-cli");
const LINE_SPLIT_RE = /\r?\n/u;

async function main() {
  const action = normalizeAction(process.argv[2]);
  if (action === "install") {
    await installOpenMeldCanary();
    return;
  }
  if (action === "remove") {
    await removeOpenMeldCanary();
    return;
  }
  throw new Error(
    `unsupported openmeld-canary action "${String(process.argv[2] ?? "")}"`
  );
}

async function installOpenMeldCanary() {
  await rm(OPENMELD_CANARY_INSTALL_ROOT, { recursive: true, force: true });
  await mkdir(OPENMELD_CANARY_TARBALLS_DIR, { recursive: true });

  const tarballName = await createCliTarball();
  const tarballPath = join(OPENMELD_CANARY_TARBALLS_DIR, tarballName);

  await runCommand("npm", [
    "install",
    "--prefix",
    OPENMELD_CANARY_PACKAGE_PREFIX,
    "--package-lock=false",
    tarballPath,
  ]);

  const cliEntryPath = join(
    OPENMELD_CANARY_PACKAGE_PREFIX,
    "node_modules",
    CLI_PACKAGE_NAME,
    "dist",
    "openmeld.js"
  );
  await assertFileExists(cliEntryPath, "openmeld-canary entry script");
  const installed = await installShortcutWrapper({
    commandName: OPENMELD_CANARY_COMMAND,
    cliEntryPath,
    defaultEnv: {
      ...buildOpenMeldCanaryDefaultEnv(),
    },
    envPreset: OPENMELD_CANARY_ENV_PRESET,
    userFacingCommand: OPENMELD_CANARY_COMMAND,
  });

  console.log(`Installed ${OPENMELD_CANARY_COMMAND} from ${tarballPath}`);
  console.log(`Package prefix: ${OPENMELD_CANARY_PACKAGE_PREFIX}`);
  console.log(`Wrapper path: ${installed.wrapperPath}`);
}

async function removeOpenMeldCanary() {
  await rm(OPENMELD_CANARY_INSTALL_ROOT, { recursive: true, force: true });
  await removeShortcutWrapper({
    commandName: OPENMELD_CANARY_COMMAND,
  });
  console.log(`Removed ${OPENMELD_CANARY_COMMAND}`);
}

async function createCliTarball() {
  const output = await runCommandCapture(
    "npm",
    ["pack", "--pack-destination", OPENMELD_CANARY_TARBALLS_DIR],
    {
      cwd: CLI_PACKAGE_ROOT,
    }
  );
  const filename = extractTarballFilename(output);
  if (!filename) {
    throw new Error("failed to resolve npm pack output filename");
  }
  return filename;
}

function extractTarballFilename(output) {
  const lines = String(output)
    .split(LINE_SPLIT_RE)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (candidate.endsWith(".tgz")) {
      return candidate;
    }
  }
  return null;
}

export function buildOpenMeldCanaryDefaultEnv() {
  return {
    OPENMELD_GATEWAY_URL: OPENMELD_CANARY_DEFAULT_GATEWAY_URL,
    OPENMELD_AUTH_URL: OPENMELD_CANARY_DEFAULT_AUTH_URL,
  };
}

if (isDirectExecution()) {
  main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

function isDirectExecution() {
  return import.meta.url === `file://${process.argv[1]}`;
}
