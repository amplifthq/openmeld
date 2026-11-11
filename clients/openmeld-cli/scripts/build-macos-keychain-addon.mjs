#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CLI_DIR = process.env.OPENMELD_RELEASE_SOURCE_ROOT
  ? path.join(process.env.OPENMELD_RELEASE_SOURCE_ROOT, "clients/openmeld-cli")
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const EXPLICIT_NODE_GYP_HEADERS =
  /^(?:npm_config_|npm_package_config_node_gyp_)(?:nodedir|tarball|dist[-_]?url|target)$/i;

export function resolveInstalledNodeHeaders({
  executablePath,
  nodeVersion,
  env,
}) {
  if (
    Object.entries(env).some(
      ([name, value]) => Boolean(value) && EXPLICIT_NODE_GYP_HEADERS.test(name)
    )
  ) {
    return null;
  }
  const root = path.resolve(path.dirname(executablePath), "..");
  const include = path.join(root, "include", "node");
  if (
    !["node.h", "node_version.h", "common.gypi", "config.gypi"].every((name) =>
      existsSync(path.join(include, name))
    )
  ) {
    return null;
  }
  const versionHeader = readFileSync(
    path.join(include, "node_version.h"),
    "utf8"
  );
  const version = ["MAJOR", "MINOR", "PATCH"]
    .map(
      (part) =>
        versionHeader.match(
          new RegExp(`^#define\\s+NODE_${part}_VERSION\\s+(\\d+)\\b`, "m")
        )?.[1]
    )
    .join(".");
  return version === nodeVersion ? root : null;
}

export function buildMacOsKeychainAddon(input = {}) {
  const platform = input.platform ?? process.platform;
  if (platform !== "darwin") {
    return { built: false, reason: `unsupported platform ${platform}` };
  }

  const env = input.env ?? process.env;
  const nodeHeaders = resolveInstalledNodeHeaders({
    executablePath: process.execPath,
    nodeVersion: process.versions.node,
    env,
  });
  const result = spawnSync(
    input.command ?? "pnpm",
    [
      "exec",
      "node-gyp",
      "rebuild",
      "--directory",
      NATIVE_DIR,
      "--arch=arm64",
      ...(nodeHeaders ? [`--nodedir=${nodeHeaders}`] : []),
    ],
    {
      cwd: CLI_DIR,
      env,
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
