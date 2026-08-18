#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { localComponentsReleaseManifestSchema } from "../../packages/schemas/src/schemas/local-components.ts";

import { fetchCliChannelManifest } from "./cli-channel-sync.mjs";
import { deriveCoreProjectionTag } from "./core-projection-tag.mjs";
import { probeCliReleaseStages } from "./release-cli-resume.mjs";

const RELEASE_MANIFEST_PATH = "release/local-components.json";
const RELEASE_MANIFEST_DEFINE =
  "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON";
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const COMPLETION_PROBE_TIMEOUT_MS = 30_000;
const CORE_WRANGLER_ARGS = [
  "--config",
  "services/core/wrangler.jsonc",
  "--env",
  "prod",
];

export function resolveCurrentCliProjectionReleaseManifest(input) {
  const channelVersion = resolveStableChannelVersion(input.channelManifest);
  const tagName = `v${channelVersion}`;
  const source = readImmutableTagManifest({
    readTagFile: input.readTagFile,
    tagName,
  });
  return parseReleaseManifest({ channelVersion, source, tagName });
}

export function resolveCurrentCliProjectionTarget(input) {
  const channelVersion = resolveStableChannelVersion(input.channelManifest);
  const tagName = `v${channelVersion}`;
  let tagCommitSha;
  try {
    tagCommitSha = String(input.readTagCommit({ tagName })).trim();
  } catch (error) {
    throw new Error(
      `Core receiver deploy refused: could not resolve immutable tag ${tagName}: ${formatError(error)}`
    );
  }
  if (!FULL_COMMIT_SHA_PATTERN.test(tagCommitSha)) {
    throw new Error(
      `Core receiver deploy refused: immutable tag ${tagName} did not resolve to an exact 40-character lowercase commit SHA.`
    );
  }
  const releaseManifestSource = readImmutableTagManifest({
    readTagFile: input.readTagFile,
    tagName,
  });
  const releaseManifest = parseReleaseManifest({
    channelVersion,
    source: releaseManifestSource,
    tagName,
  });
  return {
    channelVersion,
    expectedCoreTag: deriveCoreProjectionTag({
      commitSha: tagCommitSha,
      releaseManifestSource,
    }),
    releaseManifest,
    releaseManifestSha256: createHash("sha256")
      .update(releaseManifestSource)
      .digest("hex"),
    tagCommitSha,
    tagName,
  };
}

function readImmutableTagManifest(input) {
  let source;
  try {
    source = input.readTagFile({
      path: RELEASE_MANIFEST_PATH,
      tagName: input.tagName,
    });
  } catch (error) {
    throw new Error(
      `Core receiver deploy refused: could not read ${RELEASE_MANIFEST_PATH} from immutable tag ${input.tagName}: ${formatError(error)}`
    );
  }
  return Buffer.isBuffer(source) ? source : Buffer.from(source, "utf8");
}

function parseReleaseManifest(input) {
  let json;
  try {
    json = JSON.parse(input.source.toString("utf8"));
  } catch (error) {
    throw new Error(
      `Core receiver deploy refused: ${input.tagName}:${RELEASE_MANIFEST_PATH} is not valid JSON: ${formatError(error)}`
    );
  }
  const parsed = localComponentsReleaseManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Core receiver deploy refused: ${input.tagName}:${RELEASE_MANIFEST_PATH} is invalid: ${parsed.error.message}`
    );
  }

  const manifestCliVersion = parsed.data.components.cli.packageVersion;
  if (manifestCliVersion !== input.channelVersion) {
    throw new Error(
      `Core receiver deploy refused: ${input.tagName}:${RELEASE_MANIFEST_PATH} declares CLI ${manifestCliVersion}, but the production channel is ${input.channelVersion}.`
    );
  }
  const manifestServiceVersion = parsed.data.components.service.bundleVersion;
  if (manifestServiceVersion !== input.channelVersion) {
    throw new Error(
      `Core receiver deploy refused: ${input.tagName}:${RELEASE_MANIFEST_PATH} declares OpenMeld Service ${manifestServiceVersion}, but the production channel is ${input.channelVersion}.`
    );
  }
  return parsed.data;
}

export function buildCoreCurrentCliProjectionDeployStepSpec(input) {
  const manifestJson = JSON.stringify(input.releaseManifest);
  return {
    args: [
      "--dir",
      "services/core",
      "exec",
      "dotenv",
      "-e",
      "../../.env",
      "-o",
      "--",
      "wrangler",
      "deploy",
      "--minify",
      "--env",
      "prod",
      "--tag",
      input.expectedCoreTag,
      "--define",
      `${RELEASE_MANIFEST_DEFINE}:${JSON.stringify(manifestJson)}`,
      ...(input.dryRun ? ["--dry-run"] : []),
    ],
    command: "pnpm",
    label: "Deploy Core with the current published CLI projection",
  };
}

export async function deployCoreWithCurrentCliProjection(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const write = input.write ?? ((value) => process.stdout.write(value));
  const adapters = {
    fetchChannelManifest:
      input.adapters?.fetchChannelManifest ?? fetchCliChannelManifest,
    readTagCommit:
      input.adapters?.readTagCommit ??
      ((tagInput) =>
        execFileSync(
          resolveCommandBinary("git"),
          ["rev-parse", "--verify", `refs/tags/${tagInput.tagName}^{commit}`],
          { cwd, encoding: "utf8" }
        )),
    readTagFile:
      input.adapters?.readTagFile ??
      ((tagInput) =>
        execFileSync(
          resolveCommandBinary("git"),
          ["show", `${tagInput.tagName}:${tagInput.path}`],
          { cwd }
        )),
    runCommand:
      input.adapters?.runCommand ??
      ((commandInput) => runReadOnlyCommand({ ...commandInput, cwd, env })),
    runStep:
      input.adapters?.runStep ?? ((step) => runStep({ ...step, cwd, env })),
    verifyAlignment: input.adapters?.verifyAlignment,
  };

  const channelManifest = await adapters.fetchChannelManifest();
  const target = resolveCurrentCliProjectionTarget({
    channelManifest,
    readTagCommit: adapters.readTagCommit,
    readTagFile: adapters.readTagFile,
  });
  write(
    [
      "\n[production-release] Resolved immutable stable CLI projection",
      `channel=${target.channelVersion}`,
      `tag=${target.tagName}`,
      `tagCommit=${target.tagCommitSha}`,
      `manifestSha256=${target.releaseManifestSha256}`,
      `expectedCoreTag=${target.expectedCoreTag}`,
      "",
    ].join(" ")
  );
  adapters.runStep({
    args: ["--dir", "services/core", "run", "build:workspace-dependencies"],
    command: "pnpm",
    label: "Build Core receiver dependencies",
  });
  const step = buildCoreCurrentCliProjectionDeployStepSpec({
    dryRun: input.dryRun,
    expectedCoreTag: target.expectedCoreTag,
    releaseManifest: target.releaseManifest,
  });
  adapters.runStep(step);
  if (input.dryRun) {
    return target;
  }
  adapters.runStep({
    args: [
      "exec",
      "wrangler",
      "deployments",
      "list",
      ...CORE_WRANGLER_ARGS,
      "--json",
    ],
    command: "pnpm",
    label: "Verify Core deployment is visible",
  });
  await (adapters.verifyAlignment ?? verifyCurrentCliProjectionAlignment)({
    adapters: {
      fetch: input.adapters?.fetch ?? fetch,
      runCommand: adapters.runCommand,
    },
    cwd,
    env,
    ...target,
  });
  return target;
}

export async function verifyCurrentCliProjectionAlignment(input) {
  const decisions = await probeCliReleaseStages({
    adapters: input.adapters,
    cwd: input.cwd,
    env: input.env,
    tag: {
      action: "SKIP",
      criterion: "immutable-stable-channel-tag",
      reason: `${input.tagName} resolved to ${input.tagCommitSha}`,
    },
    target: {
      coreTag: input.expectedCoreTag,
      headSha: input.tagCommitSha,
      tagName: input.tagName,
      version: input.channelVersion,
    },
  });
  if (decisions.alignment.action !== "SKIP") {
    throw new Error(
      [
        `Core projection recovery failed final release alignment: ${decisions.alignment.reason}.`,
        `R2: ${decisions.binary.reason}`,
        `npm: ${decisions.npm.reason}`,
        `Core: ${decisions.core.reason}`,
      ].join("\n")
    );
  }
  return decisions;
}

function runStep(input) {
  process.stdout.write(`\n[production-release] ${input.label}\n`);
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

function runReadOnlyCommand(input) {
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: input.env,
    maxBuffer: 1024 * 1024 * 20,
    timeout: COMPLETION_PROBE_TIMEOUT_MS,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function resolveStableChannelVersion(channelManifest) {
  const channelVersion = channelManifest?.channels?.stable?.version;
  if (!channelVersion) {
    throw new Error(
      "Core receiver deploy refused: the production CLI channel does not declare channels.stable.version."
    );
  }
  return channelVersion;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  if (command === "git") {
    return "git.exe";
  }
  if (command === "pnpm") {
    return "pnpm.cmd";
  }
  return command;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== "--dry-run");
  if (unknownArgs.length > 0) {
    process.stderr.write(`Unknown argument(s): ${unknownArgs.join(", ")}\n`);
    process.exitCode = 1;
  } else {
    deployCoreWithCurrentCliProjection({
      dryRun: args.includes("--dry-run"),
    }).catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    });
  }
}
