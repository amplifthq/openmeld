#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const CLI_DIR = path.join(REPO_ROOT, "clients", "openmeld-cli");
const CLI_ENTRY = path.join(CLI_DIR, "src", "openmeld.ts");
const DEFAULT_CLI_BINARY_OUT_DIR_SEGMENTS = ["cli", "dist"];

// The binary distribution marker consumed by src/runtime/distribution.ts. This
// mirrors the tsdown `define` (which sets "npm" for the npm package) so the two
// distribution forms are injected the same way.
const DISTRIBUTION_DEFINE = '__OPENMELD_DISTRIBUTION__="binary"';

// Bun --compile cross-target ids keyed by our <os>-<arch> platform tokens.
// Only darwin-arm64 is produced today; the map is the single extension point
// for future platforms (工单: build script keeps a platform parameter).
export const SUPPORTED_CLI_BINARY_PLATFORMS = {
  "darwin-arm64": "bun-darwin-arm64",
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
  return `openmeld-cli-${input.platform}-${input.version}`;
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
  return [
    "build",
    input.entry,
    "--compile",
    `--target=${input.bunTarget}`,
    "--define",
    DISTRIBUTION_DEFINE,
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
  const args = { platform: DEFAULT_CLI_BINARY_PLATFORM, outDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--platform") {
      args.platform = argv[index + 1];
      index += 1;
    } else if (arg === "--out-dir") {
      args.outDir = argv[index + 1];
      index += 1;
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
  const version = resolveCliPackageVersion();
  const outDir = resolveCliBinaryOutDir(input.outDir);
  mkdirSync(outDir, { recursive: true });
  const artifactName = resolveCliBinaryArtifactName({ platform, version });
  const outFile = path.join(outDir, artifactName);

  const result = spawnSync(
    "bun",
    buildBunCompileArgs({ bunTarget, entry: CLI_ENTRY, outFile }),
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
  const built = buildCliBinary({
    outDir: args.outDir,
    platform: args.platform,
  });
  const smokeVersion = smokeCliBinary(built.outFile);
  if (smokeVersion !== built.version) {
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
