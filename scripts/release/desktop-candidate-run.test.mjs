import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";
import { requireDesktopCandidateRun } from "./desktop-candidate-run.mjs";

// Fields captured from GitHub's successful main CLI run on 2026-10-11;
// only the workflow path is changed to select the Desktop owner.
const repository = "amplifthq/openmeld";
const run = {
  conclusion: "success",
  event: "workflow_dispatch",
  head_branch: "main",
  head_repository: { full_name: repository },
  path: ".github/workflows/desktop-release.yml",
  repository: { full_name: repository },
  status: "completed",
};

test("only successful main Desktop runs can supply promotion bytes", () => {
  assert.doesNotThrow(() => requireDesktopCandidateRun(run, repository));
  for (const invalid of [
    { conclusion: "failure" },
    { status: "in_progress" },
    { event: "pull_request" },
    { head_branch: "feature" },
    { path: ".github/workflows/cli-release.yml" },
    { repository: { full_name: "other/repo" } },
    { head_repository: { full_name: "fork/openmeld" } },
    { head_repository: null },
  ]) {
    assert.throws(() =>
      requireDesktopCandidateRun({ ...run, ...invalid }, repository)
    );
  }
});

test("native workflow guards reject unmerged refs, symbolic SHAs, and incomplete promotion inputs", () => {
  const workflow = parse(
    readFileSync(
      new URL("../../.github/workflows/desktop-release.yml", import.meta.url),
      "utf8"
    )
  );
  for (const job of Object.values(workflow.jobs)) {
    const guard = job.steps.find(
      (step) => step.name === "Validate release inputs"
    ).run;
    for (const [values, allowed] of [
      [{ OPERATION: "candidate" }, true],
      [
        {
          OPERATION: "promote",
          CANDIDATE_RUN_ID: "123",
          CANDIDATE_HASH: "a".repeat(64),
          EXPECTED_VERSION: "0.1.28",
        },
        true,
      ],
      [{ OPERATION: "candidate", GITHUB_REF: "refs/heads/feature" }, false],
      [{ OPERATION: "candidate", RELEASE_SHA: "main" }, false],
      [{ OPERATION: "candidate", CANDIDATE_HASH: "a".repeat(64) }, false],
      [{ OPERATION: "promote" }, false],
      [{ OPERATION: "unknown" }, false],
    ]) {
      const result = spawnSync("bash", ["-e"], {
        input: guard,
        env: {
          PATH: process.env.PATH,
          GITHUB_REF: "refs/heads/main",
          RELEASE_SHA: "b".repeat(40),
          CANDIDATE_RUN_ID: "",
          CANDIDATE_HASH: "",
          EXPECTED_VERSION: "",
          ...values,
        },
      });
      assert.equal(result.status === 0, allowed, JSON.stringify(values));
    }
  }
});
