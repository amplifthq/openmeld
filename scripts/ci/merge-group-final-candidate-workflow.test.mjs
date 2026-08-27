import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const ARTIFACT_PATTERN = /actions\/upload-artifact@v4/u;
const BASE_ARGUMENT_PATTERN = /--base "\$CANDIDATE_BASE_SHA"/u;
const BASE_ENV_PATTERN =
  /CANDIDATE_BASE_SHA: \$\{\{ github\.event\.merge_group\.base_sha \}\}/u;
const CANDIDATE_KIND_PATTERN = /--candidate-kind merge-group/u;
const CREDENTIAL_PATTERN = /persist-credentials: false/u;
const GITHUB_EXPRESSION_PATTERN = /\$\{\{\s*github\./u;
const HEAD_ARGUMENT_PATTERN = /--head "\$CANDIDATE_HEAD_SHA"/u;
const HEAD_ENV_PATTERN =
  /CANDIDATE_HEAD_SHA: \$\{\{ github\.event\.merge_group\.head_sha \}\}/u;
const INSTALL_PATTERN = /install-isolated-candidate-dependencies\.sh/u;
const JOB_NAME_PATTERN = /name: OpenMeld Final Candidate/u;
const MERGE_GROUP_EVENT_PATTERN =
  /merge_group:\n\s+types: \[checks_requested\]/u;
const READ_ONLY_PATTERN = /permissions:\n\s+contents: read/u;
const RUN_BLOCK_PATTERN = /\n\s+run: \|[\s\S]*?(?=\n\s+- name:|\n\S|$)/gu;
const STATUS_WRITE_PATTERN = /statuses: write/u;
const WRAPPER_PATTERN = /run-isolated-candidate-command\.sh/u;

test("validates the exact GitHub merge-group tree with one read-only required check", () => {
  const workflow = readFileSync(
    path.join(REPO_ROOT, ".github/workflows/merge-group-final-candidate.yml"),
    "utf8"
  );

  assert.match(workflow, MERGE_GROUP_EVENT_PATTERN);
  assert.match(workflow, JOB_NAME_PATTERN);
  assert.match(workflow, READ_ONLY_PATTERN);
  assert.doesNotMatch(workflow, STATUS_WRITE_PATTERN);
  assert.match(workflow, HEAD_ENV_PATTERN);
  assert.match(workflow, BASE_ENV_PATTERN);
  assert.match(workflow, CANDIDATE_KIND_PATTERN);
  assert.match(workflow, HEAD_ARGUMENT_PATTERN);
  assert.match(workflow, BASE_ARGUMENT_PATTERN);
  assert.match(workflow, CREDENTIAL_PATTERN);
  assert.match(workflow, INSTALL_PATTERN);
  assert.match(workflow, WRAPPER_PATTERN);
  assert.match(workflow, ARTIFACT_PATTERN);
});

test("does not interpolate merge-group payload values inside shell source", () => {
  const workflow = readFileSync(
    path.join(REPO_ROOT, ".github/workflows/merge-group-final-candidate.yml"),
    "utf8"
  );
  const runBlocks = workflow.match(RUN_BLOCK_PATTERN) ?? [];

  for (const runBlock of runBlocks) {
    assert.doesNotMatch(runBlock, GITHUB_EXPRESSION_PATTERN);
  }
});
