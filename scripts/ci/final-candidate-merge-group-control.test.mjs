import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FINAL_CANDIDATE_STATUS_CONTEXT,
  resolveMergeGroupControl,
} from "./final-candidate-merge-group-control.mjs";
import { FINAL_CANDIDATE_STATUS_CONTEXT as POLICY_STATUS_CONTEXT } from "./final-candidate-policy.mjs";

const CONTROL_FILE = "scripts/ci/final-candidate.mjs";
const NO_STATUS_PATTERN =
  /has no successful "OpenMeld Final Candidate" status/u;
const NOT_MERGE_PATTERN = /is not a merge of PR #7 head/u;
const FOREIGN_CONTROL_PATTERN = /did not carry:\n- package\.json/u;
const QUEUE_REF_PATTERN = /does not name one queued pull request/u;
const PULL_REQUEST_STATE_PATTERN = /is not an open pull request into main/u;

function createRepository() {
  const root = mkdtempSync(path.join(tmpdir(), "merge-group-control-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_AUTHOR_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (relativePath, content) => {
    mkdirSync(path.dirname(path.join(root, relativePath)), {
      recursive: true,
    });
    writeFileSync(path.join(root, relativePath), content);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "--template=", "--initial-branch=main");
  write("package.json", '{"scripts":{"check":"trusted-check"}}');
  write(CONTROL_FILE, "export const version = 1;\n");
  write("README.md", "base\n");
  const forkPoint = commit("base");
  return { commit, forkPoint, git, root, write };
}

// main advances with a product change, the PR changes control, and the merge
// group is the merge commit GitHub builds with the PR head as second parent.
function createControlMergeGroup(repo, { prChange = CONTROL_FILE } = {}) {
  repo.git("checkout", "-b", "pr", repo.forkPoint);
  if (prChange === CONTROL_FILE) {
    repo.write(CONTROL_FILE, "export const version = 2;\n");
  } else {
    repo.write(prChange, "pr change\n");
  }
  const pullRequestHeadSha = repo.commit("pr");
  repo.git("checkout", "main");
  repo.write("README.md", "main moved\n");
  const baseSha = repo.commit("main moved");
  repo.git("checkout", "--detach", baseSha);
  repo.git("merge", "--no-ff", "-m", "Merge pull request #7", "pr");
  return {
    baseSha,
    headSha: repo.git("rev-parse", "HEAD"),
    pullRequestHeadSha,
  };
}

function createGitHub({
  baseRef = "main",
  description,
  headSha,
  state = "success",
  pullRequestState = "open",
}) {
  return {
    readCombinedStatus: (sha) => ({
      statuses:
        sha === headSha && description
          ? [
              { context: "Some Other Check", state: "success" },
              { context: FINAL_CANDIDATE_STATUS_CONTEXT, description, state },
            ]
          : [],
    }),
    readPullRequest: (number) => {
      if (number !== 7) {
        throw new Error(`Unexpected pull request ${String(number)}`);
      }
      return {
        base: { ref: baseRef },
        head: { sha: headSha },
        state: pullRequestState,
      };
    },
  };
}

const queueRef = (baseSha) =>
  `refs/heads/gh-readonly-queue/main/pr-7-${baseSha}`;
const passed = (headSha, baseSha) =>
  `Passed tooling @ ${headSha.slice(0, 12)} on ${baseSha.slice(0, 12)}`;

test("keeps the status context in step with the Final Candidate policy", () => {
  assert.equal(FINAL_CANDIDATE_STATUS_CONTEXT, POLICY_STATUS_CONTEXT);
});

test("runs a merge group without control drift under current-main control", () => {
  const repo = createRepository();
  try {
    const group = createControlMergeGroup(repo, { prChange: "docs/note.md" });
    const result = resolveMergeGroupControl({
      baseSha: group.baseSha,
      github: {
        readCombinedStatus: () => assert.fail("no API read without drift"),
        readPullRequest: () => assert.fail("no API read without drift"),
      },
      headRef: queueRef(group.baseSha),
      headSha: group.headSha,
      repoRoot: repo.root,
    });
    assert.deepEqual(result, {
      bootstrapReason: null,
      controlSha: group.baseSha,
      controlTrust: "current-main",
      driftedPaths: [],
    });
  } finally {
    rmSync(repo.root, { force: true, recursive: true });
  }
});

test("lets a control change run under its own control after the PR head passed the local bootstrap", () => {
  const repo = createRepository();
  try {
    const group = createControlMergeGroup(repo);
    const result = resolveMergeGroupControl({
      baseSha: group.baseSha,
      github: createGitHub({
        description: passed(group.pullRequestHeadSha, repo.forkPoint),
        headSha: group.pullRequestHeadSha,
      }),
      headRef: queueRef(group.baseSha),
      headSha: group.headSha,
      repoRoot: repo.root,
    });
    assert.equal(result.controlTrust, "explicit-bootstrap");
    assert.equal(result.controlSha, group.headSha);
    assert.deepEqual(result.driftedPaths, [CONTROL_FILE]);
    assert.match(
      result.bootstrapReason,
      new RegExp(`PR #7 head ${group.pullRequestHeadSha}`, "u")
    );
  } finally {
    rmSync(repo.root, { force: true, recursive: true });
  }
});

test("refuses a control change whose PR head has no exact successful status", () => {
  const repo = createRepository();
  try {
    const group = createControlMergeGroup(repo);
    const input = {
      baseSha: group.baseSha,
      headRef: queueRef(group.baseSha),
      headSha: group.headSha,
      repoRoot: repo.root,
    };
    for (const github of [
      createGitHub({ headSha: group.pullRequestHeadSha }),
      createGitHub({
        description: passed(group.pullRequestHeadSha, repo.forkPoint),
        headSha: group.pullRequestHeadSha,
        state: "failure",
      }),
      createGitHub({
        description: passed(repo.forkPoint, repo.forkPoint),
        headSha: group.pullRequestHeadSha,
      }),
      createGitHub({
        description: `Requested standard Final Candidate @ ${group.pullRequestHeadSha.slice(0, 12)} on x`,
        headSha: group.pullRequestHeadSha,
      }),
    ]) {
      assert.throws(
        () => resolveMergeGroupControl({ ...input, github }),
        NO_STATUS_PATTERN
      );
    }
  } finally {
    rmSync(repo.root, { force: true, recursive: true });
  }
});

test("refuses when the merge group does not merge the PR's current head", () => {
  const repo = createRepository();
  try {
    const group = createControlMergeGroup(repo);
    assert.throws(
      () =>
        resolveMergeGroupControl({
          baseSha: group.baseSha,
          github: createGitHub({
            description: passed(group.baseSha, repo.forkPoint),
            headSha: group.baseSha,
          }),
          headRef: queueRef(group.baseSha),
          headSha: group.headSha,
          repoRoot: repo.root,
        }),
      NOT_MERGE_PATTERN
    );
  } finally {
    rmSync(repo.root, { force: true, recursive: true });
  }
});

test("refuses control drift that another queued change carries in", () => {
  const repo = createRepository();
  try {
    const group = createControlMergeGroup(repo);
    // An earlier PR in the same group rewrote a package script.
    repo.git("checkout", "--detach", group.baseSha);
    repo.write("package.json", '{"scripts":{"check":"forged-check"}}');
    const earlierGroupHead = repo.commit("earlier queued pr");
    repo.git("merge", "--no-ff", "-m", "Merge pull request #7", "pr");
    const headSha = repo.git("rev-parse", "HEAD");
    assert.notEqual(earlierGroupHead, headSha);
    assert.throws(
      () =>
        resolveMergeGroupControl({
          baseSha: group.baseSha,
          github: createGitHub({
            description: passed(group.pullRequestHeadSha, repo.forkPoint),
            headSha: group.pullRequestHeadSha,
          }),
          headRef: queueRef(group.baseSha),
          headSha,
          repoRoot: repo.root,
        }),
      FOREIGN_CONTROL_PATTERN
    );
  } finally {
    rmSync(repo.root, { force: true, recursive: true });
  }
});

test("refuses an unknown queue ref, a closed PR, or a PR into another branch", () => {
  const repo = createRepository();
  try {
    const group = createControlMergeGroup(repo);
    const input = {
      baseSha: group.baseSha,
      headSha: group.headSha,
      repoRoot: repo.root,
    };
    const github = createGitHub({
      description: passed(group.pullRequestHeadSha, repo.forkPoint),
      headSha: group.pullRequestHeadSha,
    });
    assert.throws(
      () =>
        resolveMergeGroupControl({ ...input, github, headRef: "feature/x" }),
      QUEUE_REF_PATTERN
    );
    for (const overrides of [
      { pullRequestState: "closed" },
      { baseRef: "release" },
    ]) {
      assert.throws(
        () =>
          resolveMergeGroupControl({
            ...input,
            github: createGitHub({
              description: passed(group.pullRequestHeadSha, repo.forkPoint),
              headSha: group.pullRequestHeadSha,
              ...overrides,
            }),
            headRef: queueRef(group.baseSha),
          }),
        PULL_REQUEST_STATE_PATTERN
      );
    }
  } finally {
    rmSync(repo.root, { force: true, recursive: true });
  }
});
