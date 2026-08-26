import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const TEN_SPACE_PREFIX_PATTERN = /^ {10}/u;
const GITHUB_EXPRESSION_PREFIX = ["$", "{{"].join("");
const DELIVERY_ROUTER_PATHS = [
  "AGENTS.md",
  "developing/README.md",
  "developing/engineering/agent-native-delivery.md",
];
const RETIRED_MANDATORY_REVIEW_LANGUAGE = [
  /independent agent review/iu,
  /different coding agent/iu,
  /review remains required/iu,
];
const FINAL_CANDIDATE_EVENT_GUARD = [
  "github.event.pull_request.draft == false &&",
  "(github.event.label.name == 'final-candidate' ||",
  " github.event.label.name == 'final-candidate-full')",
].join("\n      ");

test("keeps delivery review support optional and actor-neutral", () => {
  for (const relativePath of DELIVERY_ROUTER_PATHS) {
    const source = readRepoFile(relativePath);
    for (const retiredLanguage of RETIRED_MANDATORY_REVIEW_LANGUAGE) {
      assert.doesNotMatch(source, retiredLanguage, relativePath);
    }
  }
});

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
  const isolationSetup = readRepoFile(
    "scripts/ci/prepare-isolated-candidate.sh"
  );
  const candidateRunner = readRepoFile("scripts/ci/final-candidate.mjs");
  const dependencyInstall = readRepoFile(
    "scripts/ci/install-isolated-candidate-dependencies.sh"
  );
  const trustedGit = readRepoFile("scripts/ci/trusted-git-network.mjs");
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
  assert.ok(!workflow.includes("pnpm candidate run"));
  assert.ok(
    candidateJob.includes("Checkout trusted runner from the exact current base")
  );
  assert.ok(candidateJob.includes("path: trusted-control"));
  assert.ok(candidateJob.includes("path: untrusted-candidate"));
  assert.equal(candidateJob.match(/persist-credentials: false/gu)?.length, 2);
  assert.ok(
    candidateJob.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_BASE_SHA }}`
    )
  );
  assert.ok(
    candidateJob.includes(
      "node trusted-control/scripts/ci/final-candidate.mjs run"
    )
  );
  assert.ok(
    candidateJob.includes(
      '--candidate-root "$GITHUB_WORKSPACE/untrusted-candidate"'
    )
  );
  assert.ok(candidateJob.includes("--ignore-scripts"));
  assert.ok(dependencyInstall.includes(" rebuild \\".trimEnd()));
  assert.ok(dependencyInstall.includes("resolve-approved-native-builds.mjs"));
  assert.ok(isolationSetup.includes("useradd"));
  assert.ok(isolationSetup.includes('mv "$OPENMELD_CANDIDATE_ROOT/.git"'));
  assert.ok(isolationSetup.includes('chmod 1770 "$OPENMELD_CANDIDATE_ROOT"'));
  assert.ok(
    isolationSetup.includes('chmod 0440 "$OPENMELD_CANDIDATE_ROOT/.git"')
  );
  assert.ok(
    !isolationSetup.includes('chmod -R g+rwX "$OPENMELD_CANDIDATE_ROOT"')
  );
  assert.ok(candidateJob.includes("openmeld-candidate"));
  assert.ok(candidateJob.includes("OPENMELD_CANDIDATE_GIT_DIR:"));
  assert.ok(candidateJob.includes("OPENMELD_TRUSTED_GIT_GITHUB_TOKEN:"));
  assert.ok(candidateRunner.includes("OPENMELD_TRUSTED_GIT_GITHUB_TOKEN"));
  assert.ok(trustedGit.includes("buildTrustedGitHubRepositoryUrl"));
  assert.ok(trustedGit.includes("protocol.ext.allow"));
  assert.ok(
    candidateJob.includes(
      '--command-wrapper "$GITHUB_WORKSPACE/trusted-control/scripts/ci/run-isolated-candidate-command.sh"'
    )
  );
  assert.ok(candidateJob.includes("$RUNNER_TEMP/final-candidate-control"));
  assert.ok(candidateJob.includes('--plan-source "$CANDIDATE_BASE_SHA"'));
  assert.ok(finalJob.includes("final-candidate-publisher.mjs"));
  assert.ok(
    finalJob.includes("Checkout trusted publisher from the exact current base")
  );
  assert.ok(finalJob.includes("path: trusted-control"));
  assert.ok(
    finalJob.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_BASE_SHA }}`
    )
  );
  assert.ok(
    finalJob.includes(
      "Checkout exact candidate source for trusted plan recomputation"
    )
  );
  assert.ok(
    finalJob.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_HEAD_SHA }}`
    )
  );
  assert.ok(finalJob.includes("path: untrusted-candidate"));
  assert.equal(finalJob.match(/persist-credentials: false/gu)?.length, 2);
  assert.ok(
    finalJob.includes(
      '--candidate-root "$GITHUB_WORKSPACE/untrusted-candidate"'
    )
  );
  assert.ok(finalJob.includes('--branch "$CANDIDATE_BRANCH"'));
  assert.ok(finalJob.includes("id: publish_final_status"));
  assert.ok(finalJob.includes("if: always()"));
  assert.ok(finalJob.includes("Publish fail-safe final status"));
  assert.ok(
    finalJob.includes("steps.publish_final_status.outcome != 'success'")
  );
  const finalizerStart = finalJob.indexOf("Publish fail-safe final status");
  const finalizer = finalJob.slice(finalizerStart);
  assert.ok(finalizer.includes("gh api --method POST"));
  assert.ok(!finalizer.includes("actions/checkout"));
  assert.ok(!finalizer.includes("pnpm"));
});

test("establishes the Linux write boundary before reading candidate pnpm config", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", "publish_final");
  const trustedInstall = candidateJob.indexOf(
    "Install trusted evidence parser"
  );
  const isolation = candidateJob.indexOf(
    "Prepare isolated candidate dependency install"
  );
  const candidateInstall = candidateJob.indexOf(
    "Install untrusted candidate dependencies in isolation"
  );

  assert.ok(trustedInstall >= 0);
  assert.ok(isolation > trustedInstall);
  assert.ok(candidateInstall > isolation);
  assert.doesNotMatch(
    candidateJob.slice(0, isolation),
    /pnpm --dir untrusted-candidate/gu
  );
  assert.ok(
    candidateJob
      .slice(candidateInstall)
      .includes("install-isolated-candidate-dependencies.sh")
  );
});

test("always finalizes an exact head after pending publication starts", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const finalJob = readJob(workflow, "publish_final", null);

  assert.ok(finalJob.includes("\n    if: >-\n      always() &&\n"));
  assert.ok(finalJob.includes(FINAL_CANDIDATE_EVENT_GUARD));
  assert.ok(!finalJob.includes("needs.publish_pending.result == 'success'"));
  assert.ok(finalJob.includes("CANDIDATE_HEAD_SHA:"));
  assert.ok(finalJob.includes("Publish fail-safe final status"));
});

test("an unrelated label schedules no Final Candidate status writer", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const pendingJob = readJob(workflow, "publish_pending", "candidate");
  const finalJob = readJob(workflow, "publish_final", null);

  assert.ok(
    pendingJob.includes(`if: >-\n      ${FINAL_CANDIDATE_EVENT_GUARD}`)
  );
  assert.ok(
    finalJob.includes(
      `if: >-\n      always() &&\n      ${FINAL_CANDIDATE_EVENT_GUARD}`
    )
  );
  assert.equal(Object.values(FINAL_CANDIDATE_LABELS).includes("bug"), false);
});

test("an unrelated label cannot cancel a running Final Candidate", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const concurrencyBlock = workflow
    .split("\nconcurrency:\n")[1]
    ?.split("\njobs:\n")[0];

  assert.ok(
    concurrencyBlock?.includes("github.event.pull_request.draft == false")
  );
  assert.ok(
    concurrencyBlock?.includes("github.event.label.name == 'final-candidate'")
  );
  assert.ok(
    concurrencyBlock?.includes(
      "github.event.label.name == 'final-candidate-full'"
    )
  );
  assert.ok(
    concurrencyBlock?.includes(
      "format('final-candidate-{0}', github.event.pull_request.number)"
    )
  );
  assert.ok(
    concurrencyBlock?.includes(
      "format('ignored-final-candidate-label-{0}', github.run_id)"
    )
  );
  assert.ok(!concurrencyBlock?.includes("queue: max"));

  const groupFor = ({ draft = false, label, runId }) =>
    !draft && Object.values(FINAL_CANDIDATE_LABELS).includes(label)
      ? "final-candidate-325"
      : `ignored-final-candidate-label-${runId}`;
  const legitimateGroup = groupFor({
    label: "final-candidate",
    runId: "100",
  });
  const unrelatedGroup = groupFor({ label: "bug", runId: "101" });
  assert.equal(
    legitimateGroup,
    groupFor({ label: "final-candidate-full", runId: "102" })
  );
  assert.notEqual(legitimateGroup, unrelatedGroup);
  assert.notEqual(
    legitimateGroup,
    groupFor({ draft: true, label: "final-candidate", runId: "103" })
  );
});

test("turns a post-pending output failure into an exact failure status", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-pending-finalizer-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "gh.log");
  mkdirSync(bin);
  try {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const treeSha = "c".repeat(40);
    const fakeGh = path.join(bin, "gh");
    writeFileSync(
      fakeGh,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'if [[ " $* " == *" --method POST "* ]]; then',
        '  printf "%s\\n" "$*" >> "$FAKE_GH_LOG"',
        "  exit 0",
        "fi",
        `case "\${2:-}" in`,
        `  repos/example/openmeld/pulls/325) printf '%s\\n' '{"head":{"sha":"${headSha}"},"base":{"sha":"${baseSha}"}}' ;;`,
        `  repos/example/openmeld/commits/main) printf '%s\\n' '${baseSha}' ;;`,
        `  repos/example/openmeld/git/commits/${headSha}) printf '%s\\n' '${treeSha}' ;;`,
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n")
    );
    chmodSync(fakeGh, 0o755);
    const environment = {
      ...process.env,
      CANDIDATE_BASE_SHA: baseSha,
      CANDIDATE_CONFIDENCE: "standard",
      CANDIDATE_HEAD_SHA: headSha,
      CANDIDATE_PR_NUMBER: "325",
      CANDIDATE_REPOSITORY: "example/openmeld",
      CANDIDATE_RUN_ID: "123",
      CANDIDATE_SERVER_URL: "https://github.com",
      FAKE_GH_LOG: log,
      GITHUB_OUTPUT: root,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    };
    const pending = spawnSync(
      "bash",
      ["-c", readStepRun(workflow, "Verify live identity and publish pending")],
      { encoding: "utf8", env: environment }
    );

    assert.notEqual(pending.status, 0);
    assert.ok(readFileSync(log, "utf8").includes("state=pending"));

    const finalizer = spawnSync(
      "bash",
      ["-c", readStepRun(workflow, "Publish fail-safe final status")],
      { encoding: "utf8", env: environment }
    );
    assert.equal(finalizer.status, 0, finalizer.stderr);
    const publications = readFileSync(log, "utf8").trim().split("\n");
    assert.ok(publications.at(-1)?.includes("state=failure"));
    assert.ok(!publications.at(-1)?.includes("state=success"));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
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

test("does not execute a candidate-owned runner or package candidate script", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", "publish_final");

  assert.ok(
    candidateJob.includes(
      `ref: ${GITHUB_EXPRESSION_PREFIX} env.CANDIDATE_BASE_SHA }}`
    )
  );
  assert.ok(candidateJob.includes("path: untrusted-candidate"));
  assert.ok(candidateJob.includes("path: trusted-control"));
  assert.ok(!candidateJob.includes("pnpm --dir candidate candidate"));
  assert.ok(!candidateJob.includes("candidate/scripts/ci/final-candidate.mjs"));
  assert.ok(
    candidateJob.indexOf(
      "node trusted-control/scripts/ci/final-candidate.mjs run"
    ) > candidateJob.indexOf("Checkout exact untrusted candidate source")
  );
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

function readStepRun(workflow, stepName) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}`);
  if (stepStart === -1) {
    throw new Error(`missing workflow step: ${stepName}`);
  }
  const runStart = workflow.indexOf("        run: |\n", stepStart);
  if (runStart === -1) {
    throw new Error(`missing run block: ${stepName}`);
  }
  const contentStart = runStart + "        run: |\n".length;
  const nextStep = workflow.indexOf("\n      - name:", contentStart);
  return workflow
    .slice(contentStart, nextStep === -1 ? undefined : nextStep)
    .split("\n")
    .map((line) => line.replace(TEN_SPACE_PREFIX_PATTERN, ""))
    .join("\n");
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
