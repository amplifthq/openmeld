import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

import { githubPullRequestCandidateFactsSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import { FINAL_CANDIDATE_STATUS_CONTEXT } from "./final-candidate-policy.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const GITHUB_REPOSITORY_PATTERN = /^[^/\s]+\/[^/\s]+$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const gitBinary = process.platform === "win32" ? "git.exe" : "git";

export function resolveCandidateState(input) {
  fetchCurrentMain();
  const pullRequest = readPullRequest(
    input.repository,
    input.pullRequestNumber
  );
  const actualHeadSha = resolveCommit("HEAD");
  const expectedHeadSha = input.expectedHeadSha ?? actualHeadSha;
  const expectedBaseSha = input.expectedBaseSha ?? pullRequest.base.sha;
  if (!EXACT_SHA_PATTERN.test(expectedHeadSha)) {
    throw new Error(
      "Final Candidate requires --head to resolve to an exact SHA."
    );
  }
  if (!EXACT_SHA_PATTERN.test(expectedBaseSha)) {
    throw new Error(
      "Final Candidate requires --base to resolve to an exact SHA."
    );
  }
  resolveCommit(expectedBaseSha);
  resolveCommit(expectedHeadSha);
  const ancestry = spawnSync(
    gitBinary,
    ["merge-base", "--is-ancestor", expectedBaseSha, expectedHeadSha],
    { cwd: process.cwd(), encoding: "utf8" }
  );
  if (!(ancestry.status === 0 || ancestry.status === 1)) {
    throw new Error(
      `Could not verify candidate ancestry: ${ancestry.stderr.trim()}`
    );
  }
  return {
    pullRequest,
    snapshot: {
      actualHeadSha,
      baseIsAncestorOfHead: ancestry.status === 0,
      currentMainSha: resolveCommit("refs/remotes/origin/main"),
      dirtyPaths: resolveDirtyPaths(),
      expectedBaseSha,
      expectedHeadSha,
      pullRequestBaseRef: pullRequest.base.ref,
      pullRequestBaseSha: pullRequest.base.sha,
      pullRequestDraft: pullRequest.draft,
      pullRequestHeadSha: pullRequest.head.sha,
      pullRequestState: pullRequest.state,
      treeSha: resolveObject(`${expectedHeadSha}^{tree}`),
    },
  };
}

export function publishCommitStatus(input) {
  if (!EXACT_SHA_PATTERN.test(String(input.headSha ?? ""))) {
    throw new Error(
      "Cannot publish Final Candidate status without an exact head SHA."
    );
  }
  const fields = [
    "api",
    "--method",
    "POST",
    `repos/${input.repository}/statuses/${input.headSha}`,
    "-f",
    `state=${input.state}`,
    "-f",
    `context=${FINAL_CANDIDATE_STATUS_CONTEXT}`,
    "-f",
    `description=${input.description.slice(0, 140)}`,
  ];
  if (input.targetUrl) {
    fields.push("-f", `target_url=${input.targetUrl}`);
  }
  runGh(fields);
}

export function publishPullRequestComment(input) {
  return runGhJson(
    [
      "api",
      "--method",
      "POST",
      `repos/${input.repository}/issues/${input.pullRequestNumber}/comments`,
      "--input",
      "-",
    ],
    { body: input.body }
  );
}

export function runGh(args) {
  const result = spawnSync("gh", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [`gh ${args.join(" ")} failed.`, result.stderr.trim()]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result.stdout;
}

export function runGhJson(args, input) {
  const result = spawnSync("gh", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: input ? JSON.stringify(input) : undefined,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [`gh ${args.join(" ")} failed.`, result.stderr.trim()]
        .filter(Boolean)
        .join("\n")
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error("GitHub returned malformed JSON.", { cause });
  }
}

export function resolveRepository(requestedRepository) {
  const repository =
    requestedRepository ??
    process.env.GITHUB_REPOSITORY ??
    process.env.GH_REPO ??
    runGhJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  if (!GITHUB_REPOSITORY_PATTERN.test(String(repository ?? ""))) {
    throw new Error("Could not resolve the GitHub repository as owner/name.");
  }
  return repository;
}

export function resolveCommit(value) {
  return execFileSync(
    gitBinary,
    ["rev-parse", "--verify", `${value}^{commit}`],
    { cwd: process.cwd(), encoding: "utf8" }
  ).trim();
}

export function resolveObject(value) {
  return execFileSync(gitBinary, ["rev-parse", "--verify", value], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

export function resolveBranchName() {
  const result = spawnSync(gitBinary, ["symbolic-ref", "--short", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "detached-head";
}

export function resolveChangedPaths(baseSha, headSha) {
  return execFileSync(
    gitBinary,
    ["diff", "--name-only", "--no-renames", `${baseSha}...${headSha}`, "--"],
    { cwd: process.cwd(), encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean)
    .toSorted();
}

export function resolveDirtyPaths() {
  return execFileSync(
    gitBinary,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: process.cwd(), encoding: "utf8" }
  )
    .split(LINE_SPLIT_PATTERN)
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function fetchCurrentMain() {
  const result = spawnSync(
    gitBinary,
    [
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (result.status !== 0) {
    throw new Error(
      `Final Candidate could not refresh origin/main: ${result.stderr.trim()}`
    );
  }
}

function readPullRequest(repository, pullRequestNumber) {
  const response = runGhJson([
    "api",
    `repos/${repository}/pulls/${pullRequestNumber}`,
  ]);
  const parsed = githubPullRequestCandidateFactsSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error(
      `GitHub returned invalid pull request candidate facts: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ")}`
    );
  }
  return parsed.data;
}
