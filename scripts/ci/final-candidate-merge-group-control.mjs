#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { inspectTrustedCandidateEntrypoints } from "./verify-trusted-candidate-entrypoints.mjs";

// Kept local so this decision runs before any dependency install; a test pins
// it to the policy constant.
export const FINAL_CANDIDATE_STATUS_CONTEXT = "OpenMeld Final Candidate";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LINE_SPLIT_PATTERN = /\s+/u;
// The status description is echoed into GITHUB_OUTPUT; a line break there
// could forge another output, so any non-printable character fails closed.
const NON_PRINTABLE_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const QUEUE_REF_PATTERN =
  /^(?:refs\/heads\/)?gh-readonly-queue\/(?<base>[\w./-]+)\/pr-(?<number>[1-9]\d*)-[0-9a-f]{40}$/u;

// Current-main control owns this decision. A merge group whose control files
// match main runs under main's control. A merge group that changes control may
// run under its own control only when that change is exactly what one pull
// request head already passed the protected local Final Candidate with.
export function resolveMergeGroupControl(input) {
  const repoRoot = path.resolve(input.repoRoot);
  for (const sha of [input.baseSha, input.headSha]) {
    if (!EXACT_SHA_PATTERN.test(String(sha ?? ""))) {
      throw new Error("Merge-group control requires exact base and head SHAs.");
    }
  }
  const groupDrift = inspectTrustedCandidateEntrypoints({
    candidateRef: input.headSha,
    candidateRoot: repoRoot,
    trustedRef: input.baseSha,
    trustedRoot: repoRoot,
  }).driftedPaths;
  if (groupDrift.length === 0) {
    return {
      bootstrapReason: null,
      controlSha: input.baseSha,
      controlTrust: "current-main",
      driftedPaths: [],
    };
  }

  const queue = parseQueueRef(input.headRef);
  // An entry queued behind another is based on that entry's temporary merge,
  // which may carry uncertified control. Only a group built directly on the
  // target branch tip can carry a control change.
  const targetTipSha = input.github.readBranchSha(queue.baseRef);
  if (targetTipSha !== input.baseSha) {
    throw new Error(
      `Merge group base ${input.baseSha} is not the ${queue.baseRef} tip ${String(targetTipSha)}; control-changing pull requests validate only directly on the target branch. Requeue when the queue ahead is empty.`
    );
  }
  const pullRequest = input.github.readPullRequest(queue.pullRequestNumber);
  const pullRequestHeadSha = String(pullRequest?.head?.sha ?? "");
  if (
    !(
      pullRequest?.state === "open" &&
      pullRequest.base?.ref === queue.baseRef &&
      EXACT_SHA_PATTERN.test(pullRequestHeadSha)
    )
  ) {
    throw new Error(
      `PR #${queue.pullRequestNumber} is not an open pull request into ${queue.baseRef} with an exact head.`
    );
  }
  const parents = readParents(repoRoot, input.headSha);
  if (!(parents.length === 2 && parents[1] === pullRequestHeadSha)) {
    throw new Error(
      `Merge group ${input.headSha} is not a merge of PR #${queue.pullRequestNumber} head ${pullRequestHeadSha}.`
    );
  }

  const status = findFinalCandidateStatus(
    input.github.readCombinedStatus(pullRequestHeadSha)
  );
  if (NON_PRINTABLE_PATTERN.test(String(status?.description ?? ""))) {
    throw new Error(
      `PR #${queue.pullRequestNumber} "${FINAL_CANDIDATE_STATUS_CONTEXT}" status description contains a non-printable character.`
    );
  }
  const headIdentity = `@ ${pullRequestHeadSha.slice(0, 12)} on `;
  if (
    !(
      status?.state === "success" &&
      String(status.description ?? "").startsWith("Passed ") &&
      String(status.description).includes(headIdentity)
    )
  ) {
    throw new Error(
      `PR #${queue.pullRequestNumber} head ${pullRequestHeadSha} has no successful "${FINAL_CANDIDATE_STATUS_CONTEXT}" status for that exact head. Run the protected local bootstrap on it first.`
    );
  }

  const mergeBaseSha = git(repoRoot, [
    "merge-base",
    input.baseSha,
    pullRequestHeadSha,
  ]);
  const pullRequestDrift = new Set(
    inspectTrustedCandidateEntrypoints({
      candidateRef: pullRequestHeadSha,
      candidateRoot: repoRoot,
      trustedRef: mergeBaseSha,
      trustedRoot: repoRoot,
    }).driftedPaths
  );
  const foreignDrift = groupDrift.filter(
    (relativePath) => !pullRequestDrift.has(relativePath)
  );
  const rewrittenDrift = inspectTrustedCandidateEntrypoints({
    candidateRef: input.headSha,
    candidateRoot: repoRoot,
    paths: groupDrift,
    trustedRef: pullRequestHeadSha,
    trustedRoot: repoRoot,
  }).driftedPaths;
  const unexplained = [...new Set([...foreignDrift, ...rewrittenDrift])];
  if (unexplained.length > 0) {
    throw new Error(
      [
        `Merge group changes Final Candidate control that PR #${queue.pullRequestNumber} head ${pullRequestHeadSha} did not carry:`,
        ...unexplained.toSorted().map((relativePath) => `- ${relativePath}`),
        "Queue a control-changing pull request so it is the last one in its merge group.",
      ].join("\n")
    );
  }

  return {
    bootstrapReason: `Merge group carries the control change of PR #${queue.pullRequestNumber} head ${pullRequestHeadSha}, which passed the protected local Final Candidate (${status.description}).`,
    controlSha: input.headSha,
    controlTrust: "explicit-bootstrap",
    driftedPaths: groupDrift,
  };
}

function parseQueueRef(headRef) {
  const match = QUEUE_REF_PATTERN.exec(String(headRef ?? ""));
  if (!match?.groups) {
    throw new Error(
      `Merge-group head ref ${String(headRef)} does not name one queued pull request.`
    );
  }
  return {
    baseRef: match.groups.base,
    pullRequestNumber: Number(match.groups.number),
  };
}

function findFinalCandidateStatus(combinedStatus) {
  return (combinedStatus?.statuses ?? []).find(
    (status) => status.context === FINAL_CANDIDATE_STATUS_CONTEXT
  );
}

function readParents(repoRoot, sha) {
  return git(repoRoot, ["rev-list", "--parents", "-n", "1", sha])
    .split(LINE_SPLIT_PATTERN)
    .slice(1);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createGitHubReader(repository) {
  const api = (endpoint) =>
    JSON.parse(
      execFileSync("gh", ["api", `repos/${repository}/${endpoint}`], {
        encoding: "utf8",
      })
    );
  return {
    readCombinedStatus: (sha) => api(`commits/${sha}/status?per_page=100`),
    readBranchSha: (ref) => api(`git/ref/heads/${ref}`).object.sha,
    readPullRequest: (number) => api(`pulls/${String(number)}`),
  };
}

function run() {
  const options = parseOptions(process.argv.slice(2));
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("Merge-group control decision requires GITHUB_OUTPUT.");
  }
  const result = resolveMergeGroupControl({
    ...options,
    github: createGitHubReader(options.repository),
  });
  appendFileSync(
    outputPath,
    [
      `control_trust=${result.controlTrust}`,
      `control_sha=${result.controlSha}`,
      `bootstrap_reason=${result.bootstrapReason ?? ""}`,
      "",
    ].join("\n"),
    "utf8"
  );
  const summary = [
    "## Merge-group Final Candidate control",
    "",
    result.controlTrust === "current-main"
      ? "Control matches current main; validation runs with current-main control."
      : result.bootstrapReason,
    ...result.driftedPaths.map((relativePath) => `- \`${relativePath}\``),
  ].join("\n");
  process.stdout.write(`${summary}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = {
      "--base": "baseSha",
      "--head": "headSha",
      "--head-ref": "headRef",
      "--repo-root": "repoRoot",
      "--repository": "repository",
    }[args[index]];
    if (!(key && args[index + 1])) {
      throw new Error(`Unknown or empty merge-group option: ${args[index]}`);
    }
    options[key] = args[index + 1];
  }
  for (const key of [
    "baseSha",
    "headSha",
    "headRef",
    "repoRoot",
    "repository",
  ]) {
    if (!options[key]) {
      throw new Error(
        "Merge-group control decision requires --base, --head, --head-ref, --repo-root, and --repository."
      );
    }
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
