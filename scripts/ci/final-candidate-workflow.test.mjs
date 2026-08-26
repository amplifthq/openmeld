import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { githubPullRequestCandidateFactsSchema } from "../../packages/schemas/src/schemas/ci/final-candidate.ts";
import {
  FINAL_CANDIDATE_LABELS,
  resolveFinalCandidateLabel,
} from "./final-candidate-policy.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const readRepoFile = (relativePath) =>
  readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
const GITHUB_EXPRESSION_PATTERN = /\$\{\{\s*github\./u;
const RUN_LINE_PATTERN = /^(\s+)run:\s*(.*)$/u;
const LEADING_WHITESPACE_PATTERN = /^\s*/u;
const GITHUB_EXPRESSION_PREFIX = ["$", "{{"].join("");

test("keeps every untrusted GitHub expression outside shell run blocks", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");

  for (const runBlock of extractRunBlocks(workflow)) {
    assert.doesNotMatch(
      runBlock,
      GITHUB_EXPRESSION_PATTERN,
      `untrusted GitHub expression must enter through env:\n${runBlock}`
    );
  }
  assert.ok(
    workflow.includes(
      `CANDIDATE_BRANCH: ${GITHUB_EXPRESSION_PREFIX} github.event.pull_request.head.ref }}`
    )
  );
  assert.ok(workflow.includes('--branch "$CANDIDATE_BRANCH"'));
  assert.ok(
    !workflow.includes(`"${GITHUB_EXPRESSION_PREFIX} github.head_ref }}"`)
  );
});

test("isolates status writers from the candidate command credentials", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", "publish_final");
  const pendingJob = readJob(workflow, "publish_pending", "candidate");
  const finalJob = readJob(workflow, "publish_final", null);

  assert.ok(workflow.includes("pull_request_target:"));
  assert.ok(!workflow.includes("\n  pull_request:\n"));
  assert.ok(candidateJob.includes("contents: read"));
  assert.ok(candidateJob.includes("pull-requests: read"));
  assert.ok(!candidateJob.includes("statuses: write"));
  assert.ok(!candidateJob.includes("--publish-status"));
  assert.ok(pendingJob.includes("statuses: write"));
  assert.ok(finalJob.includes("statuses: write"));
  assert.ok(!pendingJob.includes("pnpm candidate run"));
  assert.ok(!finalJob.includes("pnpm candidate run"));
  assert.ok(finalJob.includes("final-candidate-publisher.mjs"));
  assert.ok(
    finalJob.includes("Checkout trusted publisher from the exact current base")
  );
  assert.ok(
    finalJob.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_BASE_SHA }}`
    )
  );
  assert.ok(
    !finalJob.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_HEAD_SHA }}`
    )
  );
});

test("carries hosted standard and full confidence through distinct labels", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");

  assert.equal(resolveFinalCandidateLabel("standard"), "final-candidate");
  assert.equal(resolveFinalCandidateLabel("full"), "final-candidate-full");
  assert.deepEqual(FINAL_CANDIDATE_LABELS, {
    full: "final-candidate-full",
    standard: "final-candidate",
  });
  assert.ok(workflow.includes("github.event.label.name == 'final-candidate'"));
  assert.ok(
    workflow.includes("github.event.label.name == 'final-candidate-full'")
  );
  assert.ok(
    workflow.includes(
      "github.event.label.name == 'final-candidate-full' && 'full' || 'standard'"
    )
  );
  assert.ok(workflow.includes("confidence_args+=(--full)"));
  assert.ok(workflow.includes('if [ "$CANDIDATE_CONFIDENCE" = "full" ]'));
});

test("parses the captured GitHub PR fixture through the vendor boundary contract", () => {
  const fixture = JSON.parse(
    readRepoFile("scripts/ci/fixtures/github-pull-request-325.json")
  );
  const parsed = githubPullRequestCandidateFactsSchema.parse(fixture.response);

  assert.equal(
    fixture.fixture.source,
    "GitHub REST API GET /repos/amplifthq/openmeld/pulls/325"
  );
  assert.equal(parsed.number, 325);
  assert.equal(parsed.base.ref, "main");
  assert.equal(parsed.head.ref, "codex/agent-native-delivery-20260826");
});

function readJob(workflow, name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:`);
  if (start === -1) {
    throw new Error(`missing ${name} job`);
  }
  if (!nextName) {
    return workflow.slice(start);
  }
  const end = workflow.indexOf(`\n  ${nextName}:`, start + 1);
  if (end === -1) {
    throw new Error(`missing ${nextName} job boundary`);
  }
  return workflow.slice(start, end);
}

function extractRunBlocks(workflow) {
  const lines = workflow.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = RUN_LINE_PATTERN.exec(lines[index]);
    if (!match) {
      continue;
    }
    const indentation = match[1].length;
    const block = [lines[index]];
    while (index + 1 < lines.length) {
      const next = lines[index + 1];
      const nextIndentation =
        LEADING_WHITESPACE_PATTERN.exec(next)?.[0].length ?? 0;
      if (next.trim() && nextIndentation <= indentation) {
        break;
      }
      index += 1;
      block.push(next);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}
