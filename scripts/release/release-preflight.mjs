#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { fetchCliChannelManifest } from "./cli-channel-sync.mjs";
import { selectReleaseReadyPaths } from "./release-ready-paths.mjs";
import {
  formatCliReleaseVersionResolution,
  resolveCliReleaseVersion,
} from "./release-version-selection.mjs";

const execFileAsync = promisify(execFile);
const LINE_SPLIT_PATTERN = /\r?\n/u;
const WHITESPACE_PATTERN = /\s+/u;
const WRANGLER_DEV_PROCESS_PATTERN =
  /(?:^|[\s/])wrangler(?:\.js)?\s+dev(?:\s|$)/u;
const CODEX_EXEC_PROCESS_PATTERN = /(?:^|[\s/])codex\s+exec(?:\s|$)/u;
const DEFAULT_ADAPTERS = {
  readFile: async (path) => await readFile(path, "utf8"),
  readR2CliVersion: defaultReadR2CliVersion,
  runCommand: defaultRunCommand,
  runReleaseReady: defaultRunReleaseReady,
};

export async function runReleasePreflight(input = {}) {
  const context = {
    adapters: { ...DEFAULT_ADAPTERS, ...input.adapters },
    cwd: input.cwd ?? process.cwd(),
    env: input.env ?? process.env,
    homeDirectory: input.homeDirectory ?? homedir(),
  };
  const checks = [];
  for (const spec of buildCheckSpecs()) {
    checks.push(await runIndependentCheck(spec, context));
  }
  const summary = summarizePreflight(checks);
  const result = { checks, summary };
  (input.write ?? ((value) => process.stdout.write(value)))(
    formatPreflightReport(result)
  );
  return result;
}

export function summarizePreflight(checks) {
  const failed = checks.filter((check) => check.status === "FAIL").length;
  const passed = checks.filter((check) => check.status === "PASS").length;
  const skipped = checks.filter((check) => check.status === "SKIP").length;
  let status = "SKIP";
  if (failed > 0) {
    status = "FAIL";
  } else if (passed > 0) {
    status = "PASS";
  }
  return {
    failed,
    passed,
    skipped,
    status,
  };
}

function buildCheckSpecs() {
  return [
    {
      id: "git",
      label: "Git workspace",
      fix: "Use a clean dedicated release worktree based on the approved main commit.",
      run: checkGitWorkspace,
    },
    {
      id: "branch-policy",
      label: "Branch policy",
      fix: "Land the release branch through a PR with Fast PR; never push main directly.",
      run: checkBranchPolicy,
    },
    {
      id: "release-ready",
      label: "Release readiness",
      fix: "Run pnpm run verify:release-ready directly, fix its reported invariant, and rerun preflight.",
      run: checkReleaseReadiness,
    },
    {
      id: "channel",
      label: "CLI channel versions",
      fix: "Run `pnpm run release:preflight`, then prepare an aligned version with `pnpm release:local-components stamp --next ...`.",
      run: checkChannelVersions,
    },
    {
      id: "credentials",
      label: "Release authentication",
      fix: "Run `wrangler login` for a local release or provide Cloudflare API credentials in automation, and add npm auth to ~/.npmrc without printing secret values.",
      run: checkCredentialPresence,
    },
    {
      id: "migrations",
      label: "Production migrations",
      fix: "Authenticate Wrangler for the production account, then rerun the read-only remote migration list.",
      run: checkProductionMigrations,
    },
    {
      id: "local-processes",
      label: "Local concurrency",
      fix: "Run the release from its isolated worktree and stop unrelated local processes when they can interfere.",
      run: checkLocalConcurrency,
    },
    {
      id: "release-order",
      label: "Release order",
      fix: "Keep the runbook order: migration, CLI/Service channel, scoped Workers, then smoke.",
      run: checkReleaseOrder,
    },
  ];
}

async function runIndependentCheck(spec, context) {
  try {
    return {
      id: spec.id,
      label: spec.label,
      fix: spec.fix,
      ...(await spec.run(context)),
    };
  } catch (error) {
    return {
      id: spec.id,
      label: spec.label,
      status: "FAIL",
      detail: `Check could not complete: ${formatError(error)}`,
      fix: spec.fix,
    };
  }
}

async function checkGitWorkspace(context) {
  const insideWorktree = await runRequiredCommand(context, "git", [
    "rev-parse",
    "--is-inside-work-tree",
  ]);
  if (insideWorktree.stdout.trim() !== "true") {
    return {
      status: "FAIL",
      detail: "The current directory is not a Git worktree.",
    };
  }

  const [status, branch, head, originMain, relationship] = await Promise.all([
    runRequiredCommand(context, "git", ["status", "--porcelain=v1"]),
    runRequiredCommand(context, "git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    runRequiredCommand(context, "git", ["rev-parse", "HEAD"]),
    runRequiredCommand(context, "git", ["rev-parse", "origin/main"]),
    runRequiredCommand(context, "git", [
      "rev-list",
      "--left-right",
      "--count",
      "origin/main...HEAD",
    ]),
  ]);
  const [behindText, aheadText] = relationship.stdout
    .trim()
    .split(WHITESPACE_PATTERN);
  const behind = Number.parseInt(behindText ?? "", 10);
  const ahead = Number.parseInt(aheadText ?? "", 10);
  if (!(Number.isInteger(behind) && Number.isInteger(ahead))) {
    throw new Error("Git returned an unreadable origin/main relationship.");
  }
  const isClean = status.stdout.trim().length === 0;
  const isApprovedMainCommit = behind === 0 && ahead === 0;
  const branchName = branch.stdout.trim();
  const detail = [
    `branch ${branchName}`,
    `HEAD ${abbreviateSha(head.stdout)}`,
    `origin/main ${abbreviateSha(originMain.stdout)}`,
    `ahead ${ahead}`,
    `behind ${behind}`,
    isClean ? "clean" : "dirty",
  ].join("; ");
  if (!(isClean && isApprovedMainCommit)) {
    return {
      status: "FAIL",
      detail,
      fix: isClean
        ? "Merge the release branch through a PR, update this worktree to the approved main commit, and rerun preflight."
        : "Commit or remove only this lane's intended changes; never stash or overwrite another lane.",
    };
  }
  return {
    status: "PASS",
    detail,
    fix: "Keep this dedicated worktree clean and pinned to the approved main commit through release execution.",
  };
}

function checkBranchPolicy() {
  return {
    status: "PASS",
    detail:
      "Repository policy is PR-only main with Fast PR; this is a static reminder, not a GitHub branch-protection API check.",
  };
}

async function checkReleaseReadiness(context) {
  const result = await context.adapters.runReleaseReady({
    cwd: context.cwd,
    env: context.env,
  });
  const conclusion = readCommandConclusion(result);
  if (result.status !== 0) {
    return {
      status: "FAIL",
      detail: `verify:release-ready failed: ${conclusion}`,
    };
  }
  return {
    status: "PASS",
    detail: `verify:release-ready passed: ${conclusion}`,
    fix: "No fix needed; the guarded release entrypoint still owns its mandatory final gate.",
  };
}

async function checkChannelVersions(context) {
  const manifest = await readJsonFile(
    context,
    join(context.cwd, "release/local-components.json")
  );
  const cliPackage = await readJsonFile(
    context,
    join(context.cwd, "clients/openmeld-cli/package.json")
  );
  const manifestCliVersion = normalizeText(
    manifest?.components?.cli?.packageVersion
  );
  const manifestServiceVersion = normalizeText(
    manifest?.components?.service?.bundleVersion
  );
  const packageVersion = normalizeText(cliPackage?.version);
  if (!(manifestCliVersion && manifestServiceVersion && packageVersion)) {
    return {
      status: "FAIL",
      detail:
        "The local CLI package or local-components manifest is missing a declared version.",
    };
  }
  if (
    manifestCliVersion !== packageVersion ||
    manifestServiceVersion !== packageVersion
  ) {
    return {
      status: "FAIL",
      detail: `Local version mismatch: package ${packageVersion}; manifest CLI ${manifestCliVersion}; manifest Service ${manifestServiceVersion}.`,
    };
  }

  const packumentResult = await runRequiredCommand(context, "npm", [
    "view",
    "openmeld",
    "dist-tags",
    "versions",
    "--json",
  ]);
  const packument = parseJsonOutput(packumentResult.stdout, "npm dist-tags");
  const publishedVersions = normalizePublishedVersions(packument?.versions);
  const latestVersion = normalizeText(packument?.["dist-tags"]?.latest);
  const versionResolution = await resolveCliReleaseVersion({
    next: true,
    readChannels: async () => ({
      npmVersion: latestVersion,
      r2Version: await context.adapters.readR2CliVersion(context),
    }),
  });
  const suggestedVersion = versionResolution.targetVersion;
  const versionDecision = formatCliReleaseVersionResolution(versionResolution);

  const versionExists = publishedVersions.includes(packageVersion);
  if (!versionExists) {
    return {
      status: "PASS",
      detail: `${versionDecision} Declared ${packageVersion} is unpublished.`,
      fix: "No fix needed; keep this version aligned through immutable publication.",
    };
  }

  const releaseTag = `v${packageVersion}`;
  const releaseTagResult = await context.adapters.runCommand({
    command: "git",
    args: ["rev-parse", "--verify", `${releaseTag}^{commit}`],
    cwd: context.cwd,
    env: context.env,
  });
  if (releaseTagResult.status === 0) {
    const [trackedChanges, untrackedChanges] = await Promise.all([
      runRequiredCommand(context, "git", [
        "diff",
        "--name-only",
        releaseTag,
        "--",
      ]),
      runRequiredCommand(context, "git", [
        "ls-files",
        "--others",
        "--exclude-standard",
      ]),
    ]);
    const changedReleasePaths = selectReleaseReadyPaths([
      ...splitNonEmptyLines(trackedChanges.stdout),
      ...splitNonEmptyLines(untrackedChanges.stdout),
    ]);
    if (changedReleasePaths.length > 0) {
      return {
        status: "FAIL",
        detail: `${versionDecision} WARNING: declared version ${packageVersion} already exists, but ${changedReleasePaths.length} local-component path(s) differ from immutable ${releaseTag} content. Do not reuse the version.`,
        detailLines: changedReleasePaths.map((path) => `changed: ${path}`),
        fix: `Run \`pnpm release:local-components stamp --version ${suggestedVersion} ...\`, then \`pnpm run release:preflight\`.`,
      };
    }
    return {
      status: "PASS",
      detail: `${versionDecision} Declared ${packageVersion} matches immutable ${releaseTag} local-component content.`,
      fix: `Use \`pnpm release:local-components stamp --version ${suggestedVersion} ...\` only when preparing the next CLI/Service release.`,
    };
  }

  const [publishedMetadataResult, localHeadResult] = await Promise.all([
    runRequiredCommand(context, "npm", [
      "view",
      `openmeld@${packageVersion}`,
      "version",
      "gitHead",
      "dist.integrity",
      "--json",
    ]),
    runRequiredCommand(context, "git", ["rev-parse", "HEAD"]),
  ]);
  const publishedMetadata = parseJsonOutput(
    publishedMetadataResult.stdout,
    `npm metadata for ${packageVersion}`
  );
  const publishedGitHead = normalizeText(publishedMetadata?.gitHead);
  const localHead = localHeadResult.stdout.trim();
  const sameSource =
    publishedGitHead &&
    (publishedGitHead === localHead ||
      localHead.startsWith(publishedGitHead) ||
      publishedGitHead.startsWith(localHead));
  if (!sameSource) {
    const sourceDetail = publishedGitHead
      ? `published gitHead ${abbreviateSha(publishedGitHead)} differs from local HEAD ${abbreviateSha(localHead)}`
      : "npm metadata does not expose gitHead, so published content equality cannot be proven";
    return {
      status: "FAIL",
      detail: `${versionDecision} WARNING: declared version ${packageVersion} already exists and ${sourceDetail}. Do not reuse immutable npm content.`,
      fix: `Run \`pnpm release:local-components stamp --version ${suggestedVersion} ...\`, then \`pnpm run release:preflight\`.`,
    };
  }
  return {
    status: "PASS",
    detail: `${versionDecision} Declared ${packageVersion} already exists from this HEAD.`,
    fix: `Use \`pnpm release:local-components stamp --version ${suggestedVersion} ...\` only when preparing the next CLI/Service release.`,
  };
}

async function defaultReadR2CliVersion() {
  const manifest = await fetchCliChannelManifest();
  return manifest?.channels?.stable?.version;
}

async function checkCredentialPresence(context) {
  const cloudflareAuth = await context.adapters.runCommand({
    args: ["exec", "wrangler", "whoami"],
    command: "pnpm",
    cwd: context.cwd,
    env: context.env,
  });
  const present = [];
  const missing = [];
  if (cloudflareAuth.status === 0) {
    present.push("Wrangler authentication");
  } else {
    missing.push("Wrangler authentication");
  }
  const npmrc = await readOptionalFile(
    context,
    join(context.homeDirectory, ".npmrc")
  );
  if (hasNpmAuth(npmrc)) {
    present.push("npm auth (~/.npmrc)");
  } else {
    missing.push("npm auth (~/.npmrc)");
  }

  const detail = `present: ${present.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}.`;
  if (missing.length === 0) {
    return {
      status: "PASS",
      detail,
      fix: "Keep credential values out of logs and shell history.",
    };
  }
  return {
    status: "FAIL",
    detail,
    detailLines:
      cloudflareAuth.status === 0
        ? undefined
        : [`Wrangler: ${readCommandConclusion(cloudflareAuth)}`],
    fix: [
      ...(cloudflareAuth.status === 0
        ? []
        : [
            "Run `wrangler login` for a local release or provide CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in automation.",
          ]),
      ...(hasNpmAuth(npmrc) ? [] : ["Add npm authentication to ~/.npmrc."]),
      "Keep credential values out of logs and shell history.",
    ].join(" "),
  };
}

async function checkProductionMigrations(context) {
  const result = await runRequiredCommand(context, "pnpm", [
    "-C",
    "services/auth",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "list",
    "OPENMELD_DB",
    "--config",
    "wrangler.jsonc",
    "--env",
    "prod",
    "--remote",
  ]);
  const migrationList = result.stdout.trim() || "No migration rows returned.";
  return {
    status: "PASS",
    detail: "Read-only production migration list completed.",
    detailLines: migrationList.split(LINE_SPLIT_PATTERN),
    fix: "Apply listed migrations only through pnpm run db:release:prod during release execution.",
  };
}

async function checkLocalConcurrency(context) {
  const result = await runRequiredCommand(context, "ps", [
    "-ax",
    "-o",
    "command=",
  ]);
  const commands = result.stdout.split(LINE_SPLIT_PATTERN);
  const wranglerDevCount = commands.filter((command) =>
    WRANGLER_DEV_PROCESS_PATTERN.test(command)
  ).length;
  const codexExecCount = commands.filter((command) =>
    CODEX_EXEC_PROCESS_PATTERN.test(command)
  ).length;
  return {
    status: "PASS",
    detail: `running wrangler dev processes: ${wranglerDevCount}; running codex exec processes: ${codexExecCount}.`,
    fix:
      wranglerDevCount + codexExecCount > 0
        ? "Keep release execution in a dedicated worktree and stop only processes confirmed to be unrelated."
        : "Keep release execution isolated from future local development processes.",
  };
}

function checkReleaseOrder() {
  return {
    status: "PASS",
    detail:
      "Runbook: migration -> CLI/Service channel -> scoped Worker verify/deploy -> real-user smoke.",
  };
}

async function runRequiredCommand(context, command, args) {
  const result = await context.adapters.runCommand({
    command,
    args,
    cwd: context.cwd,
    env: context.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${readCommandConclusion(result)}`
    );
  }
  return result;
}

async function defaultRunCommand(input) {
  try {
    const result = await execFileAsync(
      resolveCommandBinary(input.command),
      input.args,
      {
        cwd: input.cwd,
        encoding: "utf8",
        env: input.env,
        maxBuffer: 1024 * 1024 * 20,
      }
    );
    return {
      status: 0,
      stderr: result.stderr ?? "",
      stdout: result.stdout ?? "",
    };
  } catch (error) {
    return {
      status: typeof error?.code === "number" ? error.code : 1,
      stderr: String(error?.stderr ?? error?.message ?? ""),
      stdout: String(error?.stdout ?? ""),
    };
  }
}

export async function runReleaseReadyInTemporarySnapshot(
  input,
  dependencies = {}
) {
  const createTemporaryDirectory =
    dependencies.createTemporaryDirectory ?? mkdtemp;
  const removeTemporaryDirectory = dependencies.removeTemporaryDirectory ?? rm;
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const runRequired =
    dependencies.runRequiredCommand ?? runDefaultRequiredCommand;
  const temporaryRoot = await createTemporaryDirectory(
    join(tmpdir(), "openmeld-release-preflight-")
  );
  const snapshotRoot = join(temporaryRoot, "repo");
  let operationError;
  let releaseReadyResult;
  try {
    const head = await runRequired({
      command: "git",
      args: ["rev-parse", "HEAD"],
      cwd: input.cwd,
      env: input.env,
    });
    await runRequired({
      command: "git",
      args: [
        "clone",
        "--shared",
        "--no-checkout",
        "--quiet",
        input.cwd,
        snapshotRoot,
      ],
      cwd: input.cwd,
      env: input.env,
    });
    await runRequired({
      command: "git",
      args: ["checkout", "--detach", "--quiet", head.stdout.trim()],
      cwd: snapshotRoot,
      env: input.env,
    });
    await runRequired({
      command: "pnpm",
      args: ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
      cwd: snapshotRoot,
      env: input.env,
    });
    releaseReadyResult = await runCommand({
      command: "pnpm",
      args: ["run", "verify:release-ready"],
      cwd: snapshotRoot,
      env: input.env,
    });
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  try {
    await removeTemporaryDirectory(temporaryRoot, {
      force: true,
      recursive: true,
    });
  } catch (error) {
    cleanupError = error;
  }

  if (operationError) {
    if (cleanupError) {
      throw new Error(
        `Release readiness failed: ${formatError(operationError)}; temporary snapshot cleanup also failed: ${formatError(cleanupError)}`,
        {
          cause: new AggregateError(
            [operationError, cleanupError],
            "Release readiness and cleanup both failed."
          ),
        }
      );
    }
    throw operationError;
  }
  if (!releaseReadyResult) {
    throw new Error("Release readiness returned no command result.");
  }
  if (cleanupError) {
    return {
      ...releaseReadyResult,
      status: releaseReadyResult.status === 0 ? 1 : releaseReadyResult.status,
      stderr: [
        releaseReadyResult.stderr,
        `Temporary snapshot cleanup failed: ${formatError(cleanupError)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return releaseReadyResult;
}

async function defaultRunReleaseReady(input) {
  return await runReleaseReadyInTemporarySnapshot(input);
}

async function runDefaultRequiredCommand(input) {
  const result = await defaultRunCommand(input);
  if (result.status !== 0) {
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed: ${readCommandConclusion(result)}`
    );
  }
  return result;
}

async function readJsonFile(context, path) {
  const value = await context.adapters.readFile(path);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${formatError(error)}`);
  }
}

async function readOptionalFile(context, path) {
  try {
    return await context.adapters.readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function hasNpmAuth(value) {
  return String(value ?? "")
    .split(LINE_SPLIT_PATTERN)
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        return false;
      }
      const separatorIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, separatorIndex).trim();
      const credential = trimmed.slice(separatorIndex + 1).trim();
      return (
        credential.length > 0 &&
        (key.endsWith(":_authToken") || key === "_authToken" || key === "_auth")
      );
    });
}

function parseJsonOutput(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${formatError(error)}`);
  }
}

function normalizePublishedVersions(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function splitNonEmptyLines(value) {
  return String(value)
    .split(LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatPreflightReport(result) {
  const lines = [
    "OpenMeld release preflight",
    "Read-only operator report: no deploy, publish, migration apply, credential mutation, or tracked-file write.",
    "",
  ];
  for (const check of result.checks) {
    lines.push(
      `${check.status} | ${check.label} | ${singleLine(check.detail)}`
    );
    for (const detailLine of check.detailLines ?? []) {
      lines.push(`       ${detailLine}`);
    }
    lines.push(`       Fix: ${singleLine(check.fix)}`);
  }
  lines.push(
    "",
    "Release preflight summary",
    "STATUS | CHECK | RESULT",
    ...result.checks.map(
      (check) =>
        `${check.status.padEnd(6)} | ${check.label} | ${singleLine(check.detail)}`
    ),
    "",
    `Overall: ${result.summary.status} (${result.summary.passed} PASS, ${result.summary.failed} FAIL, ${result.summary.skipped} SKIP)`,
    ""
  );
  return lines.join("\n");
}

function readCommandConclusion(result) {
  const lines = `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    .split(LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter(Boolean);
  const conclusion = lines.join("; ") || `exit code ${String(result.status)}`;
  return truncate(singleLine(conclusion), 800);
}

function abbreviateSha(value) {
  return (
    String(value ?? "")
      .trim()
      .slice(0, 12) || "unknown"
  );
}

function normalizeText(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function singleLine(value) {
  return String(value ?? "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function truncate(value, maximumLength) {
  return value.length > maximumLength
    ? `${value.slice(0, maximumLength - 1)}…`
    : value;
}

function formatError(error) {
  return singleLine(error instanceof Error ? error.message : String(error));
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  switch (command) {
    case "git":
      return "git.exe";
    case "npm":
      return "npm.cmd";
    case "pnpm":
      return "pnpm.cmd";
    default:
      return command;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReleasePreflight()
    .then((result) => {
      process.exitCode = result.summary.status === "FAIL" ? 1 : 0;
    })
    .catch((error) => {
      process.stderr.write(`${formatError(error)}\n`);
      process.exitCode = 1;
    });
}
