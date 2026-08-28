#!/usr/bin/env node

import { execFile, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { buildPackagedOpenMeldCli } from "./build-packaged-openmeld-cli.mjs";
import {
  CHANNEL_SYNC_CHECK_ENV_VAR,
  evaluateChannelSync,
  isEnvFlagEnabled,
  PRODUCTION_CLI_MANIFEST_URL,
  SKIP_CHANNEL_SYNC_CHECK_ENV_VAR,
} from "./cli-channel-sync.mjs";
import {
  collectLocalComponentFacts,
  readReleaseManifest,
  resolveEffectiveReleaseBase,
  resolveLatestReleaseTag,
} from "./local-components.mjs";
import { selectReleaseReadyPaths } from "./release-ready-paths.mjs";

const execFileAsync = promisify(execFile);

const LOCAL_COMPONENTS_MANIFEST_PATH = "release/local-components.json";
const CLI_PACKAGE_JSON_PATH = "clients/openmeld-cli/package.json";
const LINE_SPLIT_REGEX = /\r?\n/u;

export function parseReleaseReadyArgs(argv) {
  const args = [...argv];
  const options = {
    base: null,
    channelSyncCheck: false,
    currentOnly: false,
    deferRelease: false,
    force: false,
    skipChannelSyncCheck: false,
  };

  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    switch (arg) {
      case "--":
        break;
      case "--base":
        index += 1;
        options.base = readRequiredOption(args, index, arg);
        break;
      case "--current":
      case "--no-base":
        options.currentOnly = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--defer-release":
        options.deferRelease = true;
        break;
      case "--channel-sync-check":
        options.channelSyncCheck = true;
        break;
      case "--skip-channel-sync-check":
        options.skipChannelSyncCheck = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
    index += 1;
  }

  return options;
}

/**
 * The channel-sync check (see cli-channel-sync.mjs) requires live network
 * access to https://openmeld.ai and only matters right before an actual Core
 * deploy. verify-release-ready.mjs also runs in Final Candidate, strict
 * protected release pushes, explicit local verification, and the OpenMeld CLI
 * package's `prepack` npm lifecycle hook (which also fires for the
 * desktop:canary dev lane). None of those should depend on production network
 * reachability or fail because of unrelated production channel drift, so the
 * check defaults OFF and is opted into explicitly by
 * `deploy:core:local-components` (root package.json) via
 * OPENMELD_RELEASE_CHANNEL_SYNC_CHECK=1.
 */
export function resolveChannelSyncCheckEnabled(input) {
  const env = input.env ?? {};
  const skipRequested =
    input.options.skipChannelSyncCheck ||
    isEnvFlagEnabled(env[SKIP_CHANNEL_SYNC_CHECK_ENV_VAR]);
  if (skipRequested) {
    return { enabled: false, skipped: true };
  }
  const enabled =
    input.options.channelSyncCheck ||
    isEnvFlagEnabled(env[CHANNEL_SYNC_CHECK_ENV_VAR]);
  return { enabled, skipped: false };
}

export async function runReleaseReadyVerification(
  argv = process.argv.slice(2)
) {
  const options = parseReleaseReadyArgs(argv);
  assertReleaseReadyMode(options);
  const repoRoot = process.cwd();
  const facts = await collectLocalComponentFacts({ repoRoot });
  const latestReleaseTag = await resolveLatestReleaseTag({ repoRoot });
  const base = resolveEffectiveReleaseBase({
    base: options.base,
    currentReleaseLine: facts.cliReleaseLine,
    currentOnly: options.currentOnly,
    env: process.env,
    latestReleaseTag,
  });
  const releaseManifestBase = resolveReleaseManifestVerificationBase({
    base: options.base,
    currentReleaseLine: facts.cliReleaseLine,
    currentOnly: options.currentOnly,
    env: process.env,
    latestReleaseTag,
  });

  let releaseReadyPaths = [];
  if (!options.force && base) {
    await assertBaseRefExists({ base, repoRoot });
    const changedPaths = await resolveChangedPaths({ base, repoRoot });
    releaseReadyPaths = selectReleaseReadyPaths(changedPaths);
    if (releaseReadyPaths.length === 0) {
      process.stdout.write(
        `Release-ready gate skipped: no local component paths changed against ${base}.\n`
      );
      await runChannelSyncGate({ options, repoRoot });
      return;
    }
  }

  if (options.force) {
    process.stdout.write("Release-ready gate forced.\n");
  } else if (base) {
    process.stdout.write(
      `${[
        `Release-ready gate required: ${releaseReadyPaths.length} local component path(s) changed against ${base}.`,
        ...releaseReadyPaths.map((path) => `- ${path}`),
      ].join("\n")}\n`
    );
  } else {
    process.stdout.write(
      "Release-ready gate running current-facts verification without a base ref.\n"
    );
  }

  buildPackagedOpenMeldCli({ repoRoot });
  runCommand("node", [
    "--test",
    "scripts/release/cli-release-workflow.test.mjs",
    "scripts/release/local-components.test.mjs",
  ]);

  if (options.deferRelease) {
    const [baseManifest, basePackageJson, currentManifest, currentPackageJson] =
      await Promise.all([
        readJsonAtBase({
          base,
          path: LOCAL_COMPONENTS_MANIFEST_PATH,
          repoRoot,
        }),
        readJsonAtBase({ base, path: CLI_PACKAGE_JSON_PATH, repoRoot }),
        readJsonFile(join(repoRoot, LOCAL_COMPONENTS_MANIFEST_PATH)),
        readJsonFile(join(repoRoot, CLI_PACKAGE_JSON_PATH)),
      ]);
    const builtFacts = await collectLocalComponentFacts({
      repoRoot,
      requireServiceBundle: true,
    });
    const deferred = evaluateDeferredReleaseState({
      baseManifest,
      basePackageJson,
      currentManifest,
      currentPackageJson,
      facts: builtFacts,
    });
    if (deferred.errors.length > 0) {
      throw new Error(
        formatDeferredReleaseFailure({
          base,
          errors: deferred.errors,
        })
      );
    }
    process.stdout.write(
      formatDeferredReleaseSuccess({
        base,
        pendingReleaseImpacts: deferred.pendingReleaseImpacts,
      })
    );
    await runChannelSyncGate({ options, repoRoot });
    return;
  }

  const verifyScript = options.currentOnly
    ? "release:local-components:verify-current"
    : "release:local-components:verify";
  const verificationEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "OPENMELD_AFFECTED_BASE"
    )
  );
  if (releaseManifestBase) {
    verificationEnv.OPENMELD_AFFECTED_BASE = releaseManifestBase;
  }
  runCommand("pnpm", ["run", verifyScript], {
    env: verificationEnv,
  });

  await runChannelSyncGate({ options, repoRoot });
}

export function resolveReleaseManifestVerificationBase(input = {}) {
  return resolveEffectiveReleaseBase({
    base: input.base,
    currentOnly: input.currentOnly,
    currentReleaseLine: input.currentReleaseLine,
    // OPENMELD_AFFECTED_BASE belongs to the candidate or push diff. Once a
    // published tag exists, release policy must compare with that published
    // state instead of an arbitrary unpublished PR base.
    env: input.latestReleaseTag ? {} : input.env,
    latestReleaseTag: input.latestReleaseTag,
  });
}

export function evaluateDeferredReleaseState(input) {
  const errors = [];
  const baseVersion = normalizeVersion(input.basePackageJson?.version);
  const currentVersion = normalizeVersion(input.currentPackageJson?.version);
  if (!(baseVersion && currentVersion && baseVersion === currentVersion)) {
    errors.push(
      `CLI package version must match the PR base in deferred-release mode: base=${baseVersion ?? "missing"} current=${currentVersion ?? "missing"}.`
    );
  }
  if (!isSupportedReleaseManifest(input.baseManifest)) {
    errors.push(
      "The PR base local-components manifest is missing or uses an unsupported schema version."
    );
  }
  if (!isSupportedReleaseManifest(input.currentManifest)) {
    errors.push(
      "The current local-components manifest is missing or uses an unsupported schema version."
    );
  } else if (!isDeepStrictEqual(input.currentManifest, input.baseManifest)) {
    errors.push(
      "release/local-components.json manifest must remain identical to the PR base in deferred-release mode."
    );
  }

  return {
    errors,
    pendingReleaseImpacts: input.facts
      ? collectPendingReleaseImpacts({
          facts: input.facts,
          manifest: input.currentManifest,
        })
      : [],
  };
}

function assertReleaseReadyMode(options) {
  if (!options.deferRelease) {
    return;
  }
  if (!options.base) {
    throw new Error("--defer-release requires an explicit --base <sha>.");
  }
  if (options.currentOnly || options.force) {
    throw new Error(
      "--defer-release cannot be combined with --current, --no-base, or --force."
    );
  }
  if (options.channelSyncCheck || options.skipChannelSyncCheck) {
    throw new Error(
      "--defer-release cannot enable or bypass production channel sync checks."
    );
  }
}

function collectPendingReleaseImpacts(input) {
  if (!isSupportedReleaseManifest(input.manifest)) {
    return [];
  }
  const comparisons = [
    [
      "cli.commandContractVersion",
      input.manifest.components.cli.commandContractVersion,
      input.facts.cli.commandContractVersion,
    ],
    [
      "service.bundleHash",
      input.manifest.components.service.bundleHash,
      input.facts.service.bundleHash,
    ],
    [
      "service.runtimeContractEpoch",
      input.manifest.components.service.runtimeContractEpoch,
      input.facts.service.runtimeContractEpoch,
    ],
    [
      "service.serviceContractVersion",
      input.manifest.components.service.serviceContractVersion,
      input.facts.service.serviceContractVersion,
    ],
    [
      "skills.bundleHash",
      input.manifest.components.skills.bundleHash,
      input.facts.skills.bundleHash,
    ],
    [
      "skills.skillContractVersion",
      input.manifest.components.skills.skillContractVersion,
      input.facts.skills.skillContractVersion,
    ],
  ];
  return comparisons
    .filter(([, baseValue, featureValue]) => baseValue !== featureValue)
    .map(
      ([label, baseValue, featureValue]) =>
        `${label}: base=${String(baseValue)} feature=${String(featureValue)}`
    );
}

function isSupportedReleaseManifest(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.schemaVersion === 1 &&
      value.components?.cli &&
      value.components?.service &&
      value.components?.skills
  );
}

function normalizeVersion(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function readJsonAtBase(input, dependencies = {}) {
  if (!input.base) {
    return null;
  }
  const execute = dependencies.execFile ?? execFileAsync;
  try {
    const result = await execute(
      gitBinary(),
      ["show", `${input.base}:${input.path}`],
      { cwd: input.repoRoot, encoding: "utf8" }
    );
    return JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(`Could not read JSON from ${input.base}:${input.path}.`, {
      cause,
    });
  }
}

export async function readJsonFile(path, dependencies = {}) {
  const read = dependencies.readFile ?? readFile;
  try {
    return JSON.parse(await read(path, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read JSON from ${path}.`, { cause });
  }
}

function formatDeferredReleaseFailure(input) {
  return [
    `Deferred release-ready verification failed against ${input.base}.`,
    ...input.errors.map((error) => `- ${error}`),
    "Feature and PR branches must keep the base release version and manifest unchanged. Stamp only from the final clean main release worktree.",
  ].join("\n");
}

function formatDeferredReleaseSuccess(input) {
  const impacts = input.pendingReleaseImpacts.length
    ? input.pendingReleaseImpacts.map((impact) => `- ${impact}`)
    : ["- none"];
  return `${[
    `Deferred release-ready verification passed against ${input.base}.`,
    "The packaged CLI and Service facts were rebuilt and validated; release state remains identical to the base.",
    "Pending final main release impacts:",
    ...impacts,
  ].join("\n")}\n`;
}

/**
 * Gates on release/local-components.json actually matching what production
 * serves. Only runs when explicitly enabled (see
 * resolveChannelSyncCheckEnabled) — see the 2026-07-10 incident this closes
 * in cli-channel-sync.mjs's module comment.
 */
async function runChannelSyncGate(input) {
  const decision = resolveChannelSyncCheckEnabled({
    env: process.env,
    options: input.options,
  });
  if (decision.skipped) {
    process.stderr.write(
      "WARNING: CHANNEL SYNC CHECK SKIPPED (--skip-channel-sync-check / OPENMELD_SKIP_CHANNEL_SYNC_CHECK). The production CLI channel was NOT verified before this release-ready gate passed.\n"
    );
    return;
  }
  if (!decision.enabled) {
    return;
  }

  const manifest = await readReleaseManifest(
    join(input.repoRoot, LOCAL_COMPONENTS_MANIFEST_PATH)
  );
  if (!manifest) {
    throw new Error(
      formatChannelSyncFailure([
        "release/local-components.json is missing; cannot verify channel sync.",
      ])
    );
  }

  const { consistencyErrors, outcome } = await evaluateChannelSync({
    manifestComponents: manifest.components,
  });
  const errors = [...consistencyErrors, ...formatChannelOutcomeErrors(outcome)];
  for (const warning of formatChannelWarnings(outcome)) {
    process.stderr.write(`WARNING: ${warning}\n`);
  }
  if (errors.length > 0) {
    throw new Error(formatChannelSyncFailure(errors));
  }
  process.stdout.write(
    "Channel sync check passed: the production CLI channel matches the declared release manifest.\n"
  );
}

function formatChannelSyncFailure(errors) {
  return [
    "Channel sync check failed: the production CLI channel does not match this release.",
    ...errors.map((error) => `- ${error}`),
    "",
    "Next: inspect npm/R2 version truth and the suggested next version:",
    "  pnpm run release:preflight",
    "If this release needs a new immutable version, inspect the exact touched components first:",
    "  pnpm release:local-components plan --next",
    "Then rerun the printed stamp command shape with an explicit available/required policy and concrete reason for every touched component.",
    "",
    "Fix: upload the CLI binary before deploying Core:",
    "  pnpm exec node scripts/release/upload-cli-binary.mjs",
    "Then rerun the deploy (pnpm run deploy:core:local-components).",
    "",
    "Escape hatch (only once you have independently confirmed the production channel is fine): rerun with --skip-channel-sync-check, or set OPENMELD_SKIP_CHANNEL_SYNC_CHECK=1.",
  ].join("\n");
}

function formatChannelOutcomeErrors(outcome) {
  switch (outcome.kind) {
    case "fetch-failed":
      return [
        `Could not reach the production CLI manifest at ${PRODUCTION_CLI_MANIFEST_URL}: ${outcome.error.message}`,
        "Channel sync cannot be verified, so this fails closed.",
      ];
    case "malformed-manifest":
      return [
        `Production CLI manifest at ${PRODUCTION_CLI_MANIFEST_URL} is missing channels.stable.version.`,
      ];
    case "behind":
      return [
        `Production CLI channel (channels.stable.version=${outcome.channelVersion}) is BEHIND the declared release version (${outcome.declaredVersion}). The CLI binary for ${outcome.declaredVersion} has not been uploaded — deploying Core now would announce "update required ${outcome.declaredVersion}" to every user with no matching binary to download (the 2026-07-10 incident).`,
      ];
    case "match":
      return outcome.platformProbe
        .filter((probe) => !probe.ok)
        .map(
          (probe) =>
            `Production CLI manifest platform "${probe.platform}" ${probe.artifactKind} is not reachable (status=${probe.status ?? probe.error ?? "unknown"}, url=${probe.url ?? "missing"}). The channel declares this version but the release artifact is missing or incomplete.`
        );
    default:
      return [];
  }
}

function formatChannelWarnings(outcome) {
  if (outcome.kind === "ahead") {
    return [
      `Production CLI channel (channels.stable.version=${outcome.channelVersion}) is AHEAD of the declared release version (${outcome.declaredVersion}) in release/local-components.json. Not blocking, but double check release/local-components.json was stamped for the release you intend to ship.`,
    ];
  }
  return [];
}

async function assertBaseRefExists(input) {
  try {
    await execFileAsync(
      gitBinary(),
      ["rev-parse", "--verify", `${input.base}^{commit}`],
      {
        cwd: input.repoRoot,
        encoding: "utf8",
      }
    );
  } catch (error) {
    const stderr = String(error?.stderr ?? "").trim();
    throw new Error(
      [
        `Release-ready gate requires the base ref "${input.base}" to exist locally.`,
        'Run "git fetch origin main --depth=1" or set OPENMELD_AFFECTED_BASE to another available ref.',
        stderr,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function resolveChangedPaths(input) {
  const [committedPaths, worktreePaths, untrackedPaths] = await Promise.all([
    resolveCommittedChangedPaths(input),
    resolveWorktreeChangedPaths(input),
    resolveUntrackedPaths(input),
  ]);
  return [...new Set([...committedPaths, ...worktreePaths, ...untrackedPaths])];
}

async function resolveCommittedChangedPaths(input) {
  const args = ["diff", "--name-only", `${input.base}...HEAD`];
  try {
    const result = await execFileAsync(gitBinary(), args, {
      cwd: input.repoRoot,
      maxBuffer: 1024 * 1024 * 10,
    });
    return splitLines(result.stdout);
  } catch {
    const fallback = await execFileAsync(
      gitBinary(),
      ["diff", "--name-only", input.base],
      {
        cwd: input.repoRoot,
        maxBuffer: 1024 * 1024 * 10,
      }
    );
    return splitLines(fallback.stdout);
  }
}

async function resolveWorktreeChangedPaths(input) {
  const result = await execFileAsync(
    gitBinary(),
    ["diff", "--name-only", "HEAD"],
    {
      cwd: input.repoRoot,
      maxBuffer: 1024 * 1024 * 10,
    }
  );
  return splitLines(result.stdout);
}

async function resolveUntrackedPaths(input) {
  const result = await execFileAsync(
    gitBinary(),
    ["ls-files", "--others", "--exclude-standard"],
    {
      cwd: input.repoRoot,
      maxBuffer: 1024 * 1024 * 10,
    }
  );
  return splitLines(result.stdout);
}

function runCommand(command, args, input = {}) {
  const result = spawnSync(resolveCommandBinary(command), args, {
    env: input.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}`
    );
  }
}

function readRequiredOption(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function splitLines(value) {
  return String(value)
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.trim())
    .filter(Boolean);
}

function gitBinary() {
  return resolveCommandBinary("git");
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  switch (command) {
    case "git":
      return "git.exe";
    case "pnpm":
      return "pnpm.cmd";
    default:
      return command;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReleaseReadyVerification().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
