#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLI_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const NATIVE_DIR = path.join(CLI_DIR, "native", "macos-keychain");
const NATIVE_OUTPUT = path.join(
  NATIVE_DIR,
  "build",
  "Release",
  "openmeld_keychain.node"
);
const NPM_OUTPUT = path.join(
  CLI_DIR,
  "dist",
  "native",
  "openmeld-keychain.node"
);

export function buildMacOsKeychainAddon(input = {}) {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    return { built: false, reason: `unsupported platform ${platform}` };
  }

  const result = spawnSync(
    input.command ?? "pnpm",
    ["exec", "node-gyp", "rebuild", "--directory", NATIVE_DIR, "--arch=arm64"],
    {
      cwd: CLI_DIR,
      env: input.env ?? process.env,
      stdio: "inherit",
    }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `macOS secure storage addon build failed with exit code ${result.status}`
    );
  }
  if (!existsSync(NATIVE_OUTPUT)) {
    throw new Error(
      `macOS secure storage addon was not created: ${NATIVE_OUTPUT}`
    );
  }

  if (input.copyNpm === true) {
    mkdirSync(path.dirname(NPM_OUTPUT), { recursive: true });
    copyFileSync(NATIVE_OUTPUT, NPM_OUTPUT);
  }
  return { built: true, nativeOutput: NATIVE_OUTPUT, npmOutput: NPM_OUTPUT };
}

function main() {
  const copyNpm = process.argv.slice(2).includes("--copy-npm");
  const result = buildMacOsKeychainAddon({ copyNpm });
  process.stdout.write(
    result.built
      ? `[build:macos-keychain] ${result.nativeOutput}\n`
      : `[build:macos-keychain] skipped (${result.reason})\n`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
