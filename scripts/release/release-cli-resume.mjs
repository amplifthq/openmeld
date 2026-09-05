import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { gunzipSync } from "node:zlib";

import { fetchCliChannelManifest } from "./cli-channel-sync.mjs";
import { deriveCoreProjectionTag } from "./core-projection-tag.mjs";
import {
  classifyCliBinaryManifestVersion,
  decideChannelAlignmentStage,
  decideCliBinaryStage,
  decideCoreProjectionStage,
  decideNpmPublishStage,
  decideReleaseTagStage,
} from "./release-stage-probes.mjs";

const CLI_BINARY_PLATFORM = "darwin-arm64";
const ARTIFACT_PROBE_TIMEOUT_MS = 60_000;
const COMPLETION_PROBE_TIMEOUT_MS = 30_000;
const NPM_PROPAGATION_DELAYS_MS = [10_000, 20_000, 30_000, 60_000];
const LINE_SPLIT_REGEX = /\r?\n/u;
const WHITESPACE_SPLIT_REGEX = /\s+/u;
const RELEASE_RESUME_COMMAND = "pnpm run release:deploy:local -- --scope cli";
const CORE_WRANGLER_ARGS = [
  "--config",
  "services/core/wrangler.jsonc",
  "--env",
  "prod",
];

export async function runResumableCliRelease(input) {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const withBinary = input.withBinary ?? false;
  const write = input.write ?? ((value) => process.stdout.write(value));
  const adapters = {
    fetch: input.adapters?.fetch ?? input.fetch ?? fetch,
    runCommand: input.adapters?.runCommand ?? runReadOnlyCommand,
    runStep: input.adapters?.runStep ?? input.release.runStep,
    publishCliReleaseTag:
      input.adapters?.publishCliReleaseTag ??
      input.release.publishCliReleaseTag,
    readRemoteTagCommit:
      input.adapters?.readRemoteTagCommit ?? readRemoteTagCommit,
    sleep: input.adapters?.sleep ?? sleep,
  };

  input.release.assertCleanWorktree({ cwd });
  const target = resolveCliReleaseTarget({ cwd });
  const tag = probeReleaseTagStage({ adapters, cwd, target });
  if (tag.action === "FAIL") {
    printStageDecision("Release tag", tag, write);
    throw new Error(tag.reason);
  }
  const initial = await probeCliReleaseStages({
    adapters,
    cwd,
    env,
    tag,
    target,
  });
  if (initial.npm.probeFailure) {
    printStageDecision(
      "npm publish",
      { ...initial.npm, action: "FAIL" },
      write
    );
    throw new Error(initial.npm.reason);
  }
  if (initial.alignment.action === "FAIL") {
    printStageDecision("Final R2/npm/Core alignment", initial.alignment, write);
    throw new Error(initial.alignment.reason);
  }
  if (initial.alignment.action === "SKIP" && initial.tag.action === "SKIP") {
    printStageDecision(
      "Verify local-components release manifest",
      {
        action: "SKIP",
        criterion: "final-alignment-complete",
        reason: "the immutable release is already complete",
      },
      write
    );
    printCliReleaseDecisions(initial, write);
    return initial;
  }

  return await executeIncompleteCliRelease({
    adapters,
    cwd,
    env,
    initial,
    release: input.release,
    target,
    withBinary,
    write,
  });
}

export function resolveCoreProjectionTag(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const headSha = execFileSync(gitBinary(), ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const manifest = readFileSync(join(cwd, "release/local-components.json"));
  return deriveCoreProjectionTag({
    commitSha: headSha,
    releaseManifestSource: manifest,
  });
}

export async function probeCliReleaseStages(input) {
  const [binary, npm, core] = await Promise.all([
    probeCliBinaryStage(input),
    probeNpmPublishStage(input),
    probeCoreProjectionStage(input),
  ]);
  const tag = input.tag ?? probeReleaseTagStage(input);
  return {
    alignment: decideChannelAlignmentStage({ binary, core, npm }),
    binary,
    core,
    npm,
    tag,
  };
}

async function executeIncompleteCliRelease(input) {
  try {
    await input.release.assertChannelReadyForVersionOnlyRelease({
      cwd: input.cwd,
      env: input.env,
      fetch: input.adapters.fetch,
      withBinary: input.withBinary,
    });
  } catch (error) {
    throwReleaseResumeError(
      error,
      "The CLI channel readiness gate did not complete."
    );
  }

  const preTagSteps = input.release.buildPreTagCliReleaseStepSpecs({
    withBinary: input.withBinary,
  });
  const manifestGate = requirePreTagStep(
    preTagSteps,
    "Verify local-components release manifest"
  );
  printRunStage(
    manifestGate.label,
    "the release is not fully aligned",
    input.write
  );
  runReleaseStep({
    ...input,
    failureContext: "The local-components release gate did not complete.",
    step: manifestGate,
  });
  const productionQueueGate = requirePreTagStep(
    preTagSteps,
    "Verify production Core Queue resources"
  );
  printRunStage(
    productionQueueGate.label,
    "the release is not fully aligned",
    input.write
  );
  runReleaseStep({
    ...input,
    failureContext: "The production Core Queue gate did not complete.",
    step: productionQueueGate,
  });
  runBinaryReleaseStage({ ...input, preTagSteps });
  const npmPublishedThisRun = runNpmReleaseStage({ ...input, preTagSteps });
  runReleaseTagStage(input);
  runCoreProjectionStage(input);

  let final = await probeCliReleaseStages({
    adapters: input.adapters,
    cwd: input.cwd,
    env: input.env,
    target: input.target,
  });
  final = await waitForNpmPropagation({
    final,
    npmPublishedThisRun,
    probeNpm: () =>
      probeNpmPublishStage({
        adapters: input.adapters,
        cwd: input.cwd,
        env: input.env,
        target: input.target,
      }),
    sleep: input.adapters.sleep,
    write: input.write,
  });
  printStageDecision(
    "Final R2/npm/Core alignment",
    final.alignment,
    input.write
  );
  if (final.alignment.action !== "SKIP" || final.tag.action !== "SKIP") {
    throw new Error(formatFinalAlignmentFailure(final));
  }
  return final;
}

function requirePreTagStep(preTagSteps, label) {
  const step = preTagSteps.find((candidate) => candidate.label === label);
  if (!step) {
    throw new Error(`CLI release step "${label}" is missing.`);
  }
  return step;
}

function runBinaryReleaseStage(input) {
  const binaryStep = input.preTagSteps.find(
    (step) => step.label === "Build and upload OpenMeld CLI binary"
  );
  printStageDecision("CLI binary channel", input.initial.binary, input.write);
  if (input.initial.binary.action !== "RUN") {
    return;
  }
  if (!binaryStep) {
    throw new Error(
      [
        input.initial.binary.reason,
        "Next: rerun with the binary stage enabled:",
        "pnpm run release:deploy:local -- --scope cli",
      ].join("\n")
    );
  }
  runReleaseStep({
    ...input,
    failureContext:
      "The CLI binary upload may be incomplete or may already have succeeded.",
    step: binaryStep,
  });
}

function runNpmReleaseStage(input) {
  const npmStep = input.preTagSteps.find(
    (step) => step.label === "Publish OpenMeld CLI to npm"
  );
  printStageDecision("npm publish", input.initial.npm, input.write);
  if (input.initial.npm.action === "RUN") {
    runReleaseStep({
      ...input,
      failureContext:
        "npm publish may be incomplete or may already have succeeded.",
      step: npmStep,
    });
    return true;
  }
  return false;
}

export async function waitForNpmPropagation(input) {
  let final = input.final;
  if (
    !input.npmPublishedThisRun ||
    final.npm.action !== "RUN" ||
    final.npm.criterion !== "npm-target-version-missing" ||
    final.binary.action !== "SKIP" ||
    final.core.action !== "SKIP" ||
    final.tag.action !== "SKIP"
  ) {
    return final;
  }

  for (const delayMs of input.delays ?? NPM_PROPAGATION_DELAYS_MS) {
    input.write(
      `\n[release:cli] npm registry propagation — WAIT ${delayMs / 1000}s: npm accepted the immutable publish but does not expose the exact version yet.\n`
    );
    await input.sleep(delayMs);
    const npm = await input.probeNpm();
    final = {
      ...final,
      alignment: npm.probeFailure
        ? { ...npm, action: "FAIL" }
        : decideChannelAlignmentStage({
            binary: final.binary,
            core: final.core,
            npm,
          }),
      npm,
    };
    if (
      npm.action !== "RUN" ||
      npm.criterion !== "npm-target-version-missing"
    ) {
      break;
    }
  }
  return final;
}

function runReleaseTagStage(input) {
  printStageDecision("Release tag", input.initial.tag, input.write);
  if (input.initial.tag.action !== "RUN") {
    return;
  }
  try {
    input.adapters.publishCliReleaseTag({ cwd: input.cwd });
  } catch (error) {
    throwReleaseResumeError(
      error,
      "npm publish may already have succeeded; a completed npm stage will be skipped."
    );
  }
}

function runCoreProjectionStage(input) {
  printStageDecision(
    "Core release projection",
    input.initial.core,
    input.write
  );
  if (input.initial.core.action !== "RUN") {
    return;
  }
  try {
    input.adapters.runStep({
      ...input.release.buildCoreDeployStepSpec({
        targetTag: input.target.coreTag,
      }),
      cwd: input.cwd,
      env: input.env,
    });
  } catch (error) {
    throwReleaseResumeError(
      error,
      "Earlier CLI stages may already have succeeded; completed stages will be skipped."
    );
  }
}

function resolveCliReleaseTarget(input) {
  const packageJson = JSON.parse(
    readFileSync(join(input.cwd, "clients/openmeld-cli/package.json"), "utf8")
  );
  const headSha = execFileSync(gitBinary(), ["rev-parse", "HEAD"], {
    cwd: input.cwd,
    encoding: "utf8",
  }).trim();
  return {
    coreTag: resolveCoreProjectionTag(input),
    headSha,
    minRequiredCliVersion: packageJson.openmeld?.minRequiredCliVersion ?? null,
    tagName: `v${packageJson.version}`,
    version: packageJson.version,
  };
}

async function probeCliBinaryStage(input) {
  try {
    const manifest = await fetchCliChannelManifest({
      fetch: input.adapters.fetch,
    });
    const versionRelation = classifyCliBinaryManifestVersion({
      stableVersion: manifest.channels.stable.version,
      targetVersion: input.target.version,
    });
    if (versionRelation !== "exact") {
      return decideCliBinaryStage({
        manifest,
        platform: CLI_BINARY_PLATFORM,
        targetMinRequiredCliVersion: input.target.minRequiredCliVersion,
        targetVersion: input.target.version,
      });
    }
    const artifact =
      manifest?.channels?.stable?.platforms?.[CLI_BINARY_PLATFORM];
    const probeArtifact = async ({ archive, url }) => {
      if (typeof url !== "string" || url.length === 0) {
        return null;
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        ARTIFACT_PROBE_TIMEOUT_MS
      );
      try {
        const response = await input.adapters.fetch(url, {
          method: archive ? "GET" : "HEAD",
          signal: controller.signal,
        });
        if (archive) {
          if (!response.ok) {
            return {
              contentLength: null,
              ok: false,
              status: response.status,
            };
          }
          const compressed = Buffer.from(await response.arrayBuffer());
          const reconstructed = gunzipSync(compressed, {
            maxOutputLength: artifact.sizeBytes,
          });
          return {
            contentLength: compressed.byteLength,
            ok: true,
            reconstructedSha256: createHash("sha256")
              .update(reconstructed)
              .digest("hex"),
            reconstructedSizeBytes: reconstructed.byteLength,
            sha256: createHash("sha256").update(compressed).digest("hex"),
            status: response.status,
          };
        }
        const contentLength = Number.parseInt(
          response.headers.get("content-length") ?? "",
          10
        );
        return {
          contentLength: Number.isSafeInteger(contentLength)
            ? contentLength
            : null,
          ok: response.ok,
          status: response.status,
        };
      } finally {
        clearTimeout(timeout);
      }
    };
    const [artifactProbe, archiveProbe] = await Promise.all([
      probeArtifact({ archive: false, url: artifact?.url }),
      probeArtifact({ archive: true, url: artifact?.archiveUrl }),
    ]);
    return decideCliBinaryStage({
      archiveProbe,
      artifactProbe,
      manifest,
      platform: CLI_BINARY_PLATFORM,
      targetMinRequiredCliVersion: input.target.minRequiredCliVersion,
      targetVersion: input.target.version,
    });
  } catch (error) {
    return decideCliBinaryStage({
      platform: CLI_BINARY_PLATFORM,
      probeError: error instanceof Error ? error.message : String(error),
      targetMinRequiredCliVersion: input.target.minRequiredCliVersion,
      targetVersion: input.target.version,
    });
  }
}

async function probeNpmPublishStage(input) {
  try {
    const result = await input.adapters.runCommand({
      args: [
        "view",
        `openmeld@${input.target.version}`,
        "version",
        "openmeld.minRequiredCliVersion",
        "--json",
      ],
      command: "npm",
      cwd: input.cwd,
      env: input.env,
    });
    return decideNpmPublishStage({
      ...result,
      targetMinRequiredCliVersion: input.target.minRequiredCliVersion,
      targetVersion: input.target.version,
    });
  } catch (error) {
    return decideNpmPublishStage({
      status: 1,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: "",
      targetMinRequiredCliVersion: input.target.minRequiredCliVersion,
      targetVersion: input.target.version,
    });
  }
}

function probeReleaseTagStage(input) {
  const localTagProbe = readLocalTagCommit({
    cwd: input.cwd,
    tagName: input.target.tagName,
  });
  if (
    localTagProbe.localTagSha &&
    localTagProbe.localTagSha !== input.target.headSha
  ) {
    return decideReleaseTagStage({
      headSha: input.target.headSha,
      tagName: input.target.tagName,
      ...localTagProbe,
    });
  }
  const remoteTagProbe = (
    input.adapters?.readRemoteTagCommit ?? readRemoteTagCommit
  )({
    cwd: input.cwd,
    tagName: input.target.tagName,
  });
  return decideReleaseTagStage({
    headSha: input.target.headSha,
    tagName: input.target.tagName,
    ...localTagProbe,
    ...remoteTagProbe,
  });
}

async function probeCoreProjectionStage(input) {
  let deploymentsResult;
  let versionsResult;
  try {
    [deploymentsResult, versionsResult] = await Promise.all([
      input.adapters.runCommand({
        args: [
          "exec",
          "wrangler",
          "deployments",
          "list",
          ...CORE_WRANGLER_ARGS,
          "--json",
        ],
        command: "pnpm",
        cwd: input.cwd,
        env: input.env,
      }),
      input.adapters.runCommand({
        args: [
          "exec",
          "wrangler",
          "versions",
          "list",
          ...CORE_WRANGLER_ARGS,
          "--json",
        ],
        command: "pnpm",
        cwd: input.cwd,
        env: input.env,
      }),
    ]);
  } catch (error) {
    return decideCoreProjectionStage({
      probeError: error instanceof Error ? error.message : String(error),
      targetTag: input.target.coreTag,
    });
  }
  if (deploymentsResult.status !== 0 || versionsResult.status !== 0) {
    const failed =
      deploymentsResult.status !== 0 ? deploymentsResult : versionsResult;
    return decideCoreProjectionStage({
      probeError:
        String(failed.stderr ?? "").trim() ||
        String(failed.stdout ?? "").trim() ||
        `Wrangler exited ${String(failed.status)}`,
      targetTag: input.target.coreTag,
    });
  }
  try {
    return decideCoreProjectionStage({
      deployments: JSON.parse(deploymentsResult.stdout),
      targetTag: input.target.coreTag,
      versions: JSON.parse(versionsResult.stdout),
    });
  } catch (error) {
    return decideCoreProjectionStage({
      probeError: `invalid Wrangler JSON: ${error instanceof Error ? error.message : String(error)}`,
      targetTag: input.target.coreTag,
    });
  }
}

function readLocalTagCommit(input) {
  const tagRef = `refs/tags/${input.tagName}`;
  const existence = runGitProbe({
    args: ["show-ref", "--verify", "--quiet", tagRef],
    cwd: input.cwd,
  });
  if (existence.error) {
    return { localProbeError: existence.error };
  }
  if (existence.status === 1) {
    return { localTagSha: null };
  }
  if (existence.status !== 0) {
    return {
      localProbeError:
        existence.stderr || `git show-ref exited ${String(existence.status)}`,
    };
  }
  const resolved = runGitProbe({
    args: ["rev-parse", "--verify", `${tagRef}^{commit}`],
    cwd: input.cwd,
  });
  if (resolved.error || resolved.status !== 0) {
    return {
      localProbeError:
        resolved.error ||
        resolved.stderr ||
        `git rev-parse exited ${String(resolved.status)}`,
    };
  }
  return { localTagSha: resolved.stdout.trim() };
}

export function readRemoteTagCommit(input) {
  const tagRef = `refs/tags/${input.tagName}`;
  const resolved = runGitProbe({
    args: [
      "ls-remote",
      "--tags",
      input.remoteUrl ?? "origin",
      tagRef,
      `${tagRef}^{}`,
    ],
    cwd: input.cwd,
    env: input.gitEnvironment,
  });
  if (resolved.error || resolved.status !== 0) {
    return {
      remoteProbeError:
        resolved.error ||
        resolved.stderr ||
        `git ls-remote exited ${String(resolved.status)}`,
    };
  }
  const refs = new Map(
    resolved.stdout
      .split(LINE_SPLIT_REGEX)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(WHITESPACE_SPLIT_REGEX))
      .filter((parts) => parts.length === 2)
      .map(([sha, ref]) => [ref, sha])
  );
  return { remoteTagSha: refs.get(`${tagRef}^{}`) ?? refs.get(tagRef) ?? null };
}

function printCliReleaseDecisions(decisions, write) {
  printStageDecision("CLI binary channel", decisions.binary, write);
  printStageDecision("npm publish", decisions.npm, write);
  printStageDecision("Release tag", decisions.tag, write);
  printStageDecision("Core release projection", decisions.core, write);
  printStageDecision("Final R2/npm/Core alignment", decisions.alignment, write);
}

function printRunStage(label, reason, write) {
  write(`\n[release:cli] ${label} — RUN: ${reason}\n`);
}

function printStageDecision(label, decision, write) {
  const currentVersions = decision.currentVersionIds?.length
    ? `; current production version id(s)=${decision.currentVersionIds.join(",")}`
    : "";
  if (decision.action === "SKIP") {
    write(
      `\n[release:cli] ${label} — SKIP (already done; criterion=${decision.criterion}): ${decision.reason}${currentVersions}\n`
    );
    return;
  }
  let probeFailure = "";
  if (decision.probeFailure) {
    probeFailure =
      decision.action === "RUN"
        ? "; completion probe failed, fail-open to execution"
        : "; completion probe failed, fail-closed";
  }
  write(
    `\n[release:cli] ${label} — ${decision.action}: ${decision.reason}${probeFailure}${currentVersions}\n`
  );
}

function formatFinalAlignmentFailure(result) {
  return [
    `Final CLI channel alignment failed: ${result.alignment.reason}.`,
    `R2: ${result.binary.reason}`,
    `npm: ${result.npm.reason}`,
    `tag: ${result.tag.reason}`,
    `Core: ${result.core.reason}`,
    "Next command:",
    RELEASE_RESUME_COMMAND,
  ].join("\n");
}

function runReleaseStep(input) {
  try {
    input.adapters.runStep({
      ...input.step,
      cwd: input.cwd,
      env: input.env,
    });
  } catch (error) {
    throwReleaseResumeError(error, input.failureContext);
  }
}

function throwReleaseResumeError(error, context) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(
    [
      message,
      "",
      context,
      "Rerun the same release command at this exact commit; completed stages will be skipped:",
      RELEASE_RESUME_COMMAND,
    ].join("\n")
  );
}

function runReadOnlyCommand(input) {
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: input.env,
    maxBuffer: 1024 * 1024 * 20,
    timeout: COMPLETION_PROBE_TIMEOUT_MS,
  });
  return {
    status: result.error ? 1 : (result.status ?? 1),
    stderr: readProcessFailure(result),
    stdout: String(result.stdout ?? ""),
  };
}

function runGitProbe(input) {
  const result = spawnSync(gitBinary(), input.args, {
    cwd: input.cwd,
    encoding: "utf8",
    env: input.env,
    maxBuffer: 1024 * 1024,
    timeout: COMPLETION_PROBE_TIMEOUT_MS,
  });
  return {
    error: result.error?.message ?? "",
    status: result.status ?? (result.error ? 1 : 0),
    stderr: String(result.stderr ?? "").trim(),
    stdout: String(result.stdout ?? ""),
  };
}

function readProcessFailure(result) {
  return [String(result.stderr ?? "").trim(), result.error?.message]
    .filter(Boolean)
    .join("\n");
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
