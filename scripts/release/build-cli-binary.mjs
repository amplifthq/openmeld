#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildMacOsKeychainAddon } from "../../clients/openmeld-cli/scripts/build-macos-keychain-addon.mjs";
import { cliBinaryServiceReleaseSchema } from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const CLI_DIR = path.join(REPO_ROOT, "clients", "openmeld-cli");
const CLI_ENTRY = path.join(CLI_DIR, "src", "openmeld-entry.ts");
const DEFAULT_CLI_BINARY_OUT_DIR_SEGMENTS = ["cli", "dist"];

// The binary distribution marker consumed by src/runtime/distribution.ts. This
// mirrors the tsdown `define` (which sets "npm" for the npm package) so the two
// distribution forms are injected the same way.
const DISTRIBUTION_DEFINE = '__OPENMELD_DISTRIBUTION__="binary"';

// Bun --compile cross-target ids keyed by our <os>-<arch> platform tokens.
// Build support is not publication support. Windows must pass native artifact
// acceptance before the release channel or an installer advertises it.
export const SUPPORTED_CLI_BINARY_PLATFORMS = {
  "darwin-arm64": "bun-darwin-arm64",
  "windows-x64": "bun-windows-x64",
};
export const DEFAULT_CLI_BINARY_PLATFORM = "darwin-arm64";

export function resolveDefaultCliBinaryOutDir(repoRoot = REPO_ROOT) {
  return path.join(repoRoot, ...DEFAULT_CLI_BINARY_OUT_DIR_SEGMENTS);
}

export function resolveCliBinaryOutDir(outDir, repoRoot = REPO_ROOT) {
  return outDir
    ? path.resolve(repoRoot, outDir)
    : resolveDefaultCliBinaryOutDir(repoRoot);
}

export function resolveCliBinaryArtifactName(input) {
  const role = input.background ? "service" : "cli";
  const extension = input.platform.startsWith("windows-") ? ".exe" : "";
  return `openmeld-${role}-${input.platform}-${input.version}${extension}`;
}

export function resolveCliPackageVersion(repoRoot = REPO_ROOT) {
  const packageJson = JSON.parse(
    readFileSync(
      path.join(repoRoot, "clients", "openmeld-cli", "package.json"),
      "utf8"
    )
  );
  const version = packageJson.version;
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error("clients/openmeld-cli/package.json must define a version.");
  }
  return version;
}

export function buildBunCompileArgs(input) {
  if (input.background && !input.bunTarget.startsWith("bun-windows-")) {
    throw new Error(
      "The background subsystem is supported only for Windows targets."
    );
  }
  return [
    "build",
    input.entry,
    "--compile",
    `--target=${input.bunTarget}`,
    ...(input.background ? ["--windows-hide-console"] : []),
    "--define",
    DISTRIBUTION_DEFINE,
    "--define",
    `__OPENMELD_VERSION__=${JSON.stringify(input.version)}`,
    ...(input.service
      ? [
          "--define",
          `__OPENMELD_SERVICE_RELEASE__=${JSON.stringify(cliBinaryServiceReleaseSchema.parse(input.service))}`,
        ]
      : []),
    "--minify",
    "--keep-names",
    "--outfile",
    input.outFile,
  ];
}

function hashFileSha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function collectCliBinaryMetadata(filePath) {
  return {
    sha256: hashFileSha256(filePath),
    sizeBytes: statSync(filePath).size,
  };
}

function parseArgs(argv) {
  const args = {
    platform: DEFAULT_CLI_BINARY_PLATFORM,
    outDir: null,
    background: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform") {
      args.platform = argv[index + 1];
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = argv[index + 1];
      index += 1;
    } else if (arg === "--background") {
      args.background = true;
    }
  }
  return args;
}

export function buildCliBinary(input = {}) {
  const platform = input.platform ?? DEFAULT_CLI_BINARY_PLATFORM;
  const bunTarget = SUPPORTED_CLI_BINARY_PLATFORMS[platform];
  if (!bunTarget) {
    throw new Error(
      `Unsupported CLI binary platform: ${platform}. Supported: ${Object.keys(SUPPORTED_CLI_BINARY_PLATFORMS).join(", ")}`
    );
  }
  const version = input.version ?? resolveCliPackageVersion();
  const outDir = resolveCliBinaryOutDir(input.outDir);
  mkdirSync(outDir, { recursive: true });
  const artifactName = resolveCliBinaryArtifactName({
    platform,
    version,
    background: input.background,
  });
  const outFile = path.join(outDir, artifactName);

  if (platform.startsWith("darwin-")) {
    buildMacOsKeychainAddon({ env: process.env, platform: "darwin" });
  }

  const result = spawnSync(
    "bun",
    buildBunCompileArgs({
      bunTarget,
      background: input.background,
      entry: CLI_ENTRY,
      outFile,
      version,
      service: input.service,
    }),
    { cwd: CLI_DIR, env: process.env, stdio: "inherit" }
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `bun build --compile failed with exit code ${result.status}`
    );
  }
  if (!existsSync(outFile)) {
    throw new Error(`Expected CLI binary was not created: ${outFile}`);
  }

  return {
    artifactName,
    outFile,
    platform,
    ...collectCliBinaryMetadata(outFile),
    version,
  };
}

// Smoke the freshly built binary through a state-free command so a broken
// compile fails the build. `--version` is handled by commander before any
// command action runs, so it never touches ~/.openmeld.
export function smokeCliBinary(outFile) {
  const result = spawnSync(outFile, ["--version"], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Built CLI binary failed --version smoke (exit ${result.status}).`
    );
  }
  return String(result.stdout ?? "").trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const nativePlatform = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
  if (args.platform !== nativePlatform) {
    throw new Error(
      `Build and acceptance must run natively on ${args.platform}; this machine is ${nativePlatform}.`
    );
  }
  const built = buildCliBinary({
    outDir: args.outDir,
    platform: args.platform,
    background: args.background,
  });
  const smokeVersion = args.background ? null : smokeCliBinary(built.outFile);
  if (!args.background && smokeVersion !== built.version) {
    throw new Error(
      `Built binary reports version ${smokeVersion}, expected ${built.version}.`
    );
  }
  process.stdout.write(
    [
      "",
      "[build:cli-binary] Build output",
      `- artifact: ${built.outFile}`,
      `- platform: ${built.platform}`,
      `- version: ${built.version}`,
      `- sha256: ${built.sha256}`,
      `- sizeBytes: ${built.sizeBytes}`,
      "",
    ].join("\n")
  );
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
