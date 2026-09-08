#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  fetchCliChannelManifest,
  isEnvFlagEnabled,
  SKIP_CHANNEL_SYNC_CHECK_ENV_VAR,
} from "./cli-channel-sync.mjs";
import { runResumableCliRelease } from "./release-cli-resume.mjs";
import { compareSemverCore } from "./release-semver.mjs";
import {
  formatCliReleaseVersionResolution,
  resolveCliReleaseVersion,
} from "./release-version-selection.mjs";

const DIRTY_PATH_PREVIEW_LIMIT = 24;
const LINE_SPLIT_REGEX = /\r?\n/u;

export function parseGitStatusPorcelain(output) {
  return String(output)
    .split(LINE_SPLIT_REGEX)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export function formatDirtyWorktreeReleaseError(changes) {
  const preview = changes
    .slice(0, DIRTY_PATH_PREVIEW_LIMIT)
    .map((change) => `- ${change}`);
  const remaining = changes.length - preview.length;
  if (remaining > 0) {
    preview.push(`- ... ${remaining} more dirty path(s)`);
  }

  return [
    "CLI release refused: the worktree has uncommitted changes.",
    "",
    "A CLI release publishes npm and then deploys Core so production reads the same local-components manifest.",
    "Deploying Core from a dirty worktree can ship another agent's half-finished Core or workspace changes.",
    "",
    "Dirty paths:",
    ...preview,
    "",
    "Agents: stop here and ask the user to choose a clean release window. Commit or stash the unrelated work, or release from a clean worktree at the intended commit.",
  ].join("\n");
}

export function assertCleanWorktree(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const status = execFileSync(
    gitBinary(),
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd,
      encoding: "utf8",
    }
  );
  const changes = parseGitStatusPorcelain(status);
  if (changes.length > 0) {
    throw new Error(formatDirtyWorktreeReleaseError(changes));
  }
}

export function resolveCliReleaseTagName(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const packageJson = JSON.parse(
    readFileSync(join(cwd, "clients/openmeld-cli/package.json"), "utf8")
  );
  return `v${packageJson.version}`;
}

export function parseCliReleaseArgs(argv) {
  const args = { next: false, version: null, withBinary: false };
  const remaining = [...argv];
  while (remaining.length > 0) {
    const arg = remaining.shift();
    if (arg === "--with-binary") {
      args.withBinary = true;
      continue;
    }
    if (arg === "--next") {
      args.next = true;
      continue;
    }
    if (arg === "--version") {
      const version = remaining.shift();
      if (!version || version.startsWith("--")) {
        throw new Error("--version requires a value.");
      }
      args.version = version;
      continue;
    }
    throw new Error(`Unknown CLI release argument: ${arg}`);
  }
  if (args.next && args.version) {
    throw new Error(
      "--next and --version are mutually exclusive. Choose one release version mode."
    );
  }
  return args;
}

export function buildPreTagCliReleaseStepSpecs(input = {}) {
  const steps = [
    {
      args: ["run", "deploy:release-ready"],
      command: "pnpm",
      label: "Verify local-components release manifest",
    },
    {
      args: [
        "run",
        "verify:cloudflare:production-queues",
        "--",
        "services/core/wrangler.jsonc",
      ],
      command: "pnpm",
      label: "Verify production Core Queue resources",
    },
  ];
  if (input.withBinary) {
    steps.push({
      args: ["exec", "node", "scripts/release/upload-cli-binary.mjs"],
      command: "pnpm",
      label: "Build and upload OpenMeld CLI binary",
    });
  }
  steps.push({
    args: [
      "--filter",
      "./clients/openmeld-cli",
      "run",
      "publish:npm",
      "--registry=https://registry.npmjs.org/",
    ],
    command: "pnpm",
    label: "Publish OpenMeld CLI to npm",
  });
  return steps;
}

/**
 * Tags HEAD as the just-published release so the verify gate can use the tag
 * as its "last published" baseline (instead of origin/main, which can lag a
 * batched-push workflow). Idempotent when the tag already points at HEAD;
 * refuses to move an existing tag to a different commit.
 */
export function tagCliRelease(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const tagName = resolveCliReleaseTagName({ cwd });
  const existing = readTagCommit({
    cwd,
    gitEnvironment: input.gitEnvironment,
    tagName,
  });
  if (existing) {
    const head = execFileSync(gitBinary(), ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      env: input.gitEnvironment,
    }).trim();
    if (existing === head) {
      return { created: false, tagName };
    }
    throw new Error(
      `Release tag ${tagName} already exists at ${existing}, but HEAD is ${head}. A published version must map to exactly one commit — bump the version instead of re-tagging.`
    );
  }
  execFileSync(
    gitBinary(),
    ["tag", "-a", tagName, "-m", `Release OpenMeld CLI ${tagName.slice(1)}`],
    { cwd, encoding: "utf8", env: input.gitEnvironment }
  );
  return { created: true, tagName };
}

/**
 * Publishes the immutable release tag through the same executor used by local
 * and GitHub releases. A failed push leaves the local tag intact so a rerun can
 * safely finish the remote publication without moving the tag.
 */
export function publishCliReleaseTag(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const localGitEnvironment = input.localGitEnvironment ?? input.gitEnvironment;
  const local = tagCliRelease({
    cwd,
    gitEnvironment: localGitEnvironment,
  });
  const tagRef = `refs/tags/${local.tagName}`;
  const headSha = execFileSync(gitBinary(), ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    env: localGitEnvironment,
  }).trim();
  if (input.sourceSha && headSha !== input.sourceSha) {
    throw new Error(
      `Trusted CLI tag publication expected ${input.sourceSha}, found ${headSha}.`
    );
  }
  try {
    execFileSync(
      gitBinary(),
      [
        "push",
        "--no-verify",
        input.remoteUrl ?? "origin",
        `${tagRef}:${tagRef}`,
      ],
      {
        cwd,
        encoding: "utf8",
        env: input.gitEnvironment,
      }
    );
  } catch (error) {
    throw new Error(
      `Failed to publish immutable release tag ${local.tagName} to origin. The local tag remains safe to reuse on the next release attempt.`,
      { cause: error }
    );
  }
  return { ...local, published: true };
}

function readTagCommit(input) {
  try {
    return execFileSync(
      gitBinary(),
      ["rev-parse", "--verify", `refs/tags/${input.tagName}^{commit}`],
      {
        cwd: input.cwd,
        encoding: "utf8",
        env: input.gitEnvironment,
      }
    ).trim();
  } catch {
    return null;
  }
}

export async function runCliRelease(input = {}) {
  if (input.next || input.version) {
    assertCleanWorktree({ cwd: input.cwd });
    const resolution = await resolveCliReleaseVersion({
      cwd: input.cwd,
      env: input.env,
      explicitVersion: input.version,
      fetch: input.adapters?.fetch ?? input.fetch,
      next: input.next,
      runCommand: input.adapters?.runCommand,
    });
    assertCliReleaseVersionTarget({
      cwd: input.cwd,
      targetVersion: resolution.targetVersion,
    });
    (input.write ?? ((value) => process.stdout.write(value)))(
      `${formatCliReleaseVersionResolution(resolution)}\n`
    );
  }
  return await runResumableCliRelease({
    ...input,
    release: {
      assertChannelReadyForVersionOnlyRelease,
      assertCleanWorktree,
      buildCoreDeployStepSpec,
      buildPreTagCliReleaseStepSpecs,
      publishCliReleaseTag,
      runStep,
    },
  });
}

export function assertCliReleaseVersionTarget(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const packageJson = JSON.parse(
    readFileSync(join(cwd, "clients/openmeld-cli/package.json"), "utf8")
  );
  const manifest = JSON.parse(
    readFileSync(join(cwd, "release/local-components.json"), "utf8")
  );
  const packageVersion = packageJson.version;
  const manifestCliVersion = manifest?.components?.cli?.packageVersion;
  const manifestServiceVersion = manifest?.components?.service?.bundleVersion;
  if (
    packageVersion === input.targetVersion &&
    manifestCliVersion === input.targetVersion &&
    manifestServiceVersion === input.targetVersion
  ) {
    return;
  }
  throw new Error(
    [
      `CLI release version guard failed: selected ${input.targetVersion}; package ${String(packageVersion)}; manifest CLI ${String(manifestCliVersion)}; manifest Service ${String(manifestServiceVersion)}.`,
      "Next: inspect the touched local components and declare each real compatibility decision; the release path will not guess available:",
      `pnpm release:local-components plan --version ${input.targetVersion}`,
      "pnpm run release:preflight",
    ].join("\n")
  );
}

/**
 * Guards the common flag-trap: releasing a new CLI version without
 * --with-binary means upload-cli-binary.mjs never runs, so the production
 * CLI channel never gets the matching binary. If Core is then deployed with
 * local-components.json stamped for this version (see
 * buildCoreDeployStepSpec below), every user is told to update to a version
 * that has no download — the 2026-07-10 incident. Runs as early as
 * possible, before any of the slower/harder-to-undo release steps.
 */
export async function assertChannelReadyForVersionOnlyRelease(input = {}) {
  if (input.withBinary) {
    return;
  }
  const env = input.env ?? process.env;
  if (isEnvFlagEnabled(env[SKIP_CHANNEL_SYNC_CHECK_ENV_VAR])) {
    process.stderr.write(
      "WARNING: CHANNEL SYNC PRE-FLIGHT SKIPPED (OPENMELD_SKIP_CHANNEL_SYNC_CHECK). Proceeding without confirming the production CLI channel already has this version.\n"
    );
    return;
  }

  const cwd = input.cwd ?? process.cwd();
  const packageJson = JSON.parse(
    readFileSync(join(cwd, "clients/openmeld-cli/package.json"), "utf8")
  );
  const declaredVersion = packageJson.version;

  let channelManifest;
  try {
    channelManifest = await fetchCliChannelManifest({ fetch: input.fetch });
  } catch (error) {
    throw new Error(
      formatChannelPreflightNetworkFailure({ declaredVersion, error })
    );
  }

  const channelVersion = channelManifest?.channels?.stable?.version;
  if (!channelVersion) {
    throw new Error(
      [
        `CLI release refused: the production CLI manifest is missing channels.stable.version, so it is not possible to confirm releasing ${declaredVersion} without --with-binary is safe.`,
        "Next: inspect all channel blockers with `pnpm run release:preflight`, or rerun the guarded CLI release with `pnpm run release:deploy:local -- --scope cli`.",
      ].join("\n")
    );
  }

  if (compareSemverCore(declaredVersion, channelVersion) > 0) {
    throw new Error(
      formatChannelPreflightBehindError({ channelVersion, declaredVersion })
    );
  }
}

/**
 * Routes the Core deploy through deploy:core:local-components (rather than a
 * bare `pnpm --filter @openmeld/core run deploy`) so it inherits the same
 * release-ready + channel-sync gate as a manual Core deploy. The step 1
 * "Verify local-components release manifest" step above runs BEFORE any
 * binary upload, so it cannot channel-sync-check; this final step is the one
 * that actually deploys Core and must not bypass the gate.
 *
 * Consequently verify-release-ready.mjs runs twice per CLI release: once in
 * step 1, once inside deploy:core:local-components here. By the time this
 * second run happens, publishCliReleaseTag() above has already tagged HEAD and
 * published that exact tag to origin, so resolveEffectiveReleaseBase() resolves
 * the brand-new local tag as the base — it diffs empty against HEAD, so this
 * run normally short-circuits to just the channel-sync check instead of
 * repeating build/test/verify. That short circuit depends on no base override
 * being present: if OPENMELD_AFFECTED_BASE is set in the environment, it takes
 * precedence over the just-created tag (see resolveEffectiveReleaseBase in
 * local-components.mjs), so this second run becomes a full re-verification
 * instead of the cheap short-circuited one.
 */
export function buildCoreDeployStepSpec(input = {}) {
  return {
    args: [
      "run",
      "deploy:core:local-components",
      ...(input.targetTag ? ["--tag", input.targetTag] : []),
    ],
    command: "pnpm",
    label: "Deploy Core with the published local-components manifest",
  };
}

function formatChannelPreflightBehindError(input) {
  return [
    `CLI release refused: releasing ${input.declaredVersion} without --with-binary, but the production CLI channel is still at ${input.channelVersion}.`,
    "",
    "Publishing npm, stamping local-components, and deploying Core now would announce this version to every user while no matching CLI binary exists on the download channel (the 2026-07-10 half-release incident).",
    "",
    "Fix — choose one:",
    "  1. Rerun with --with-binary so this release builds and uploads the binary first:",
    "     pnpm run release:deploy:local -- --scope cli",
    "  2. Or upload the binary separately first, then rerun this release:",
    "     pnpm exec node scripts/release/upload-cli-binary.mjs",
  ].join("\n");
}

function formatChannelPreflightNetworkFailure(input) {
  return [
    `CLI release refused: could not verify the production CLI channel before releasing ${input.declaredVersion} without --with-binary.`,
    `Fetching the production CLI manifest failed: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
    "",
    "Failing closed: without confirming the channel already has this version, releasing without --with-binary risks the 2026-07-10 half-release incident (Core announces a version with no matching CLI binary).",
    "Next: restore network access and run `pnpm run release:preflight`, or rerun the guarded CLI release with `pnpm run release:deploy:local -- --scope cli`.",
  ].join("\n");
}

function runStep(input) {
  process.stdout.write(`\n[release:cli] ${input.label}\n`);
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
      `${input.command} ${input.args.join(" ")} failed with exit code ${result.status}`
    );
  }
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
