#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cliBinaryManifestSchema } from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";
import { uploadCliBinary } from "./upload-cli-binary.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const STAGING_CLI_BUCKET = "openmeld-desktop-downloads-stg";
const STAGING_CLI_DOWNLOAD_BASE_URL =
  "https://staging.openmeld.ai/cli/download";
const STAGING_CLI_MANIFEST_URL =
  "https://staging.openmeld.ai/cli/manifest.json";
const COMMANDS = new Set(["plan", "publish", "verify"]);
const INTERNAL_PUBLISH_COMMAND = "__publish";
const PLAIN_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/u;
const STAGING_VERSION_PATTERN = /^\d+\.\d+\.\d+-staging\./u;
const SHORT_GIT_SHA_PATTERN = /^[a-f0-9]{8}$/u;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStagingCliChannel(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[staging-cli] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

export function parseStagingCliChannelArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  if (
    args[0] === "publish" &&
    args[1] === "--retain-service" &&
    args.length === 2
  ) {
    return { command: "publish", retainService: true };
  }
  if (!COMMANDS.has(args[0]) || args.length !== 1) {
    throw new Error(
      "Staging CLI channel command must be plan, publish, or verify."
    );
  }
  return { command: args[0] };
}

export function resolveStagingCliVersion(input) {
  const match = String(input.baseVersion).match(PLAIN_VERSION_PATTERN);
  if (!match) {
    throw new Error(
      `Staging CLI base version must be a plain release version, received ${String(input.baseVersion)}.`
    );
  }
  const timestamp = input.now
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, "")
    .slice(0, 17);
  const gitSha = String(input.gitSha).trim().slice(0, 8);
  if (!SHORT_GIT_SHA_PATTERN.test(gitSha)) {
    throw new Error("Staging CLI release requires an exact Git commit SHA.");
  }
  return `${match[1]}.${match[2]}.${String(Number(match[3]) + 1)}-staging.${timestamp}.${gitSha}`;
}

export function buildStagingCliPublishStepSpec(input) {
  return {
    args: [
      "scripts/dev/doppler-environment.mjs",
      "component:stg",
      "release",
      "--",
      "node",
      "scripts/release/staging-cli-channel.mjs",
      INTERNAL_PUBLISH_COMMAND,
      "--version",
      input.version,
      ...(input.retainService ? ["--retain-service"] : []),
    ],
    command: "node",
  };
}

async function runStagingCliChannel(argv) {
  if (argv[0] === INTERNAL_PUBLISH_COMMAND) {
    const retainService = argv.at(-1) === "--retain-service";
    const version = parseInternalPublishVersion(
      argv.slice(1, retainService ? -1 : undefined)
    );
    await publishStagingCli(version, retainService);
    return;
  }

  const { command, retainService } = parseStagingCliChannelArgs(argv);
  if (command === "verify") {
    await verifyStagingCliChannel();
    return;
  }

  const source = resolveSourceIdentity();
  const version = resolveStagingCliVersion({
    baseVersion: source.baseVersion,
    gitSha: source.gitSha,
    now: new Date(),
  });
  printPlan({ gitSha: source.gitSha, version });
  if (command === "plan") {
    return;
  }

  assertCleanWorktree();
  runStep(buildStagingCliPublishStepSpec({ version, retainService }));
  await verifyStagingCliChannel({ expectedVersion: version });
}

function parseInternalPublishVersion(argv) {
  if (argv.length !== 2 || argv[0] !== "--version") {
    throw new Error("Internal staging CLI publish requires --version.");
  }
  const version = String(argv[1]).trim();
  if (!STAGING_VERSION_PATTERN.test(version)) {
    throw new Error("Only staging prerelease versions may use this publisher.");
  }
  return version;
}

async function publishStagingCli(version, retainService) {
  const stable = retainService ? await verifyStagingCliChannel() : undefined;
  const service = stable
    ? (stable.service ?? {
        version: stable.version,
        platforms: stable.platforms,
      })
    : undefined;
  await uploadCliBinary({
    bucketName: STAGING_CLI_BUCKET,
    downloadBaseUrl: STAGING_CLI_DOWNLOAD_BASE_URL,
    version,
    service,
  });
  await verifyStagingCliChannel({
    expectedVersion: version,
    expectedServiceVersion: service?.version,
  });
}

async function verifyStagingCliChannel(input = {}) {
  const response = await fetch(STAGING_CLI_MANIFEST_URL, {
    headers: { "user-agent": "openmeld-staging-cli-verifier" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `${STAGING_CLI_MANIFEST_URL} returned HTTP ${String(response.status)}.`
    );
  }
  const manifest = cliBinaryManifestSchema.parse(await response.json());
  const stable = manifest.channels.stable;
  if (
    input.expectedServiceVersion &&
    stable.service?.version !== input.expectedServiceVersion
  ) {
    throw new Error(
      "Staging Web did not preserve the selected Service release. Deploy the current manifest reader before retaining a Service."
    );
  }
  if (!STAGING_VERSION_PATTERN.test(stable.version)) {
    throw new Error(
      `Staging manifest returned non-staging version ${stable.version}.`
    );
  }
  if (input.expectedVersion && stable.version !== input.expectedVersion) {
    throw new Error(
      `Staging manifest returned ${stable.version}, expected ${input.expectedVersion}.`
    );
  }
  const release = stable.platforms["darwin-arm64"];
  if (!release) {
    throw new Error("Staging manifest is missing darwin-arm64.");
  }
  for (const url of [release.url, release.archiveUrl].filter(Boolean)) {
    if (!url.startsWith(`${STAGING_CLI_DOWNLOAD_BASE_URL}/`)) {
      throw new Error(`Staging manifest points outside staging: ${url}`);
    }
  }
  if (stable.service) {
    assertStagingServiceSelection(stable.service);
  }
  process.stdout.write(
    `[staging-cli] Ready: ${stable.version} from ${STAGING_CLI_MANIFEST_URL}\n`
  );
  return stable;
}

export function assertStagingServiceSelection(service) {
  if (!STAGING_VERSION_PATTERN.test(service.version)) {
    throw new Error("Staging Service selection must use a staging prerelease.");
  }
  for (const artifact of Object.values(service.platforms)) {
    for (const url of [artifact.url, artifact.archiveUrl].filter(Boolean)) {
      if (!url.startsWith(`${STAGING_CLI_DOWNLOAD_BASE_URL}/`)) {
        throw new Error("Staging Service artifact points outside staging.");
      }
    }
  }
}

function resolveSourceIdentity() {
  const packageJson = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "clients", "openmeld-cli", "package.json"),
      "utf8"
    )
  );
  return {
    baseVersion: packageJson.version,
    gitSha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim(),
  };
}

function assertCleanWorktree() {
  const changes = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
  if (changes) {
    throw new Error(
      "Staging CLI publication requires a clean worktree so its exact source is recoverable."
    );
  }
}

function printPlan(input) {
  process.stdout.write(
    [
      "OpenMeld staging CLI channel plan:",
      `- source: ${input.gitSha}`,
      `- version: ${input.version}`,
      `- bucket: ${STAGING_CLI_BUCKET}`,
      `- manifest: ${STAGING_CLI_MANIFEST_URL}`,
      "- production: unchanged",
      "",
    ].join("\n")
  );
}

function runStep(step) {
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${step.command} ${step.args.join(" ")} failed with exit code ${String(result.status ?? 1)}.`
    );
  }
}
