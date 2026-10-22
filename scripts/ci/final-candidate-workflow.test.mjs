import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";

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
const EVENT_TYPES_PATTERN = /types: \[([^\]]+)\]/u;
const INHERITED_NODE_OPTIONS_PATTERN = /NODE_OPTIONS="?\$\{/u;
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

test("required CodeQL scans include forks without executing repository build scripts or rescanning merge groups", () => {
  const workflow = parse(readRepoFile(".github/workflows/codeql.yml"));
  assert.deepEqual(workflow.on.pull_request, { branches: ["main"] });
  // The required check must also report on merge-queue groups.
  assert.deepEqual(workflow.on.merge_group, { types: ["checks_requested"] });
  assert.equal(workflow.on.pull_request_target, undefined);
  const job = workflow.jobs.analyze;
  assert.equal(
    job.name,
    `Analyze (${GITHUB_EXPRESSION_PREFIX} matrix.language }})`
  );
  assert.deepEqual(job.strategy.matrix.language, [
    "actions",
    "javascript-typescript",
  ]);
  assert.deepEqual(job.permissions, {
    contents: "read",
    "security-events": "write",
  });
  assert.equal(job.environment, undefined);
  assert.ok(job.steps.every((step) => !step.run));
  // Merge groups report the required check without repeating the full scan.
  assert.ok(
    job.steps.every((step) => step.if === "github.event_name != 'merge_group'")
  );
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.equal(job.steps[1].with["build-mode"], "none");
});

test("control validates evidence with only the schema package's production dependencies", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-control-runtime-"));
  try {
    cpSync(path.join(REPO_ROOT, "scripts"), path.join(root, "scripts"), {
      recursive: true,
    });
    const schemaRoot = path.join(root, "packages", "schemas");
    const sourceSchemaRoot = path.join(REPO_ROOT, "packages", "schemas");
    cpSync(path.join(sourceSchemaRoot, "src"), path.join(schemaRoot, "src"), {
      recursive: true,
    });
    const manifest = JSON.parse(readRepoFile("packages/schemas/package.json"));
    writeFileSync(
      path.join(schemaRoot, "package.json"),
      JSON.stringify(manifest)
    );
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      const target = path.join(schemaRoot, "node_modules", dependency);
      mkdirSync(path.dirname(target), { recursive: true });
      symlinkSync(
        path.join(sourceSchemaRoot, "node_modules", dependency),
        target,
        "junction"
      );
    }
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "scripts/ci/final-candidate-publisher.test.mjs",
        "scripts/ci/final-candidate-policy.test.mjs",
        "scripts/ci/final-candidate-reuse.test.mjs",
        "scripts/release/hosted-fleet-plan-admission.test.mjs",
      ],
      { cwd: root, encoding: "utf8", timeout: 30_000 }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

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

test("keeps status credentials out of candidate commands", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateRunner = readRepoFile("scripts/ci/final-candidate.mjs");
  const dependencyInstall = readRepoFile(
    "scripts/ci/install-isolated-candidate-dependencies.sh"
  );
  const commandWrapper = readRepoFile(
    "scripts/ci/run-isolated-candidate-command.sh"
  );
  const trustedGit = readRepoFile("scripts/ci/trusted-git-network.mjs");
  const candidateJob = readJob(workflow, "candidate", null);
  const pendingJob = readJob(workflow, "publish_pending", "candidate");
  const finalJob = readRepoFile(".github/workflows/final-candidate-result.yml");

  assert.ok(workflow.includes("\n  pull_request:\n"));
  for (const unsafe of [
    "pull_request_target:",
    "secrets.",
    "environment:",
    ": write",
    "allow-unsafe-pr-checkout",
  ]) {
    assert.ok(!workflow.includes(unsafe), unsafe);
  }
  assert.ok(candidateJob.includes("contents: read"));
  assert.ok(candidateJob.includes("actions: read"));
  assert.ok(candidateJob.includes("pull-requests: read"));
  assert.ok(!candidateJob.includes("statuses: write"));
  assert.ok(!candidateJob.includes("--publish-status"));
  assert.ok(!pendingJob.includes("statuses: write"));
  assert.ok(finalJob.includes("statuses: write"));
  assert.ok(!finalJob.includes("checks: write"));
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
  assert.ok(
    candidateJob.includes(
      "trusted-control/scripts/ci/download-prior-final-candidate-evidence.sh"
    )
  );
  assert.ok(
    candidateJob.includes(
      '--prior-evidence-root "$RUNNER_TEMP/prior-final-candidate"'
    )
  );
  assert.ok(dependencyInstall.includes("--config.ignore-pnpmfile=true"));
  assert.ok(dependencyInstall.includes(" --recursive rebuild \\".trimEnd()));
  assert.ok(dependencyInstall.includes("resolve-approved-native-builds.mjs"));
  assert.ok(commandWrapper.includes("exec env -i"));
  assert.ok(!commandWrapper.includes("sudo"));
  assert.ok(!commandWrapper.includes("GITHUB_TOKEN="));
  assert.ok(!commandWrapper.includes("GH_TOKEN="));
  assert.ok(!candidateJob.includes("openmeld-candidate"));
  assert.ok(!candidateJob.includes("OPENMELD_CANDIDATE_GIT_DIR:"));
  assert.ok(!candidateJob.includes("prepare-isolated-candidate.sh"));
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
  assert.ok(
    candidateJob.includes(
      `path: ${GITHUB_EXPRESSION_PREFIX} runner.temp }}/final-candidate-control/`
    ),
    "the hosted artifact must preserve both canonical evidence and complete command logs"
  );
  assert.ok(candidateJob.includes('--plan-source "$CANDIDATE_BASE_SHA"'));
  assert.ok(finalJob.includes("final-candidate-publisher.mjs"));
  assert.ok(
    finalJob.includes('--hosted-disposition "$CANDIDATE_HOSTED_DISPOSITION"')
  );
  assert.ok(finalJob.includes("Checkout trusted publisher only"));
  assert.ok(finalJob.includes("path: trusted-control"));
  assert.ok(
    finalJob.includes(`ref: ${GITHUB_EXPRESSION_PREFIX} github.sha }}`)
  );
  assert.ok(finalJob.includes("Read candidate Git objects without checkout"));
  assert.ok(
    finalJob.includes(
      `CANDIDATE_HEAD_SHA: ${GITHUB_EXPRESSION_PREFIX} steps.identity.outputs.head }}`
    )
  );
  assert.ok(!finalJob.includes("path: untrusted-candidate"));
  assert.equal(finalJob.match(/persist-credentials: false/gu)?.length, 1);
  assert.ok(finalJob.includes('--candidate-ref "$CANDIDATE_HEAD_SHA"'));
  assert.ok(finalJob.includes('--branch "$CANDIDATE_BRANCH"'));
  assert.ok(finalJob.includes("id: publish_final"));
  assert.ok(finalJob.includes("if: always() &&"));
  assert.ok(finalJob.includes("state=failure"));
  assert.ok(finalJob.includes('"$VERIFIER_RESULT" = success'));
  // A finished result is bound to its exact base; main advancing is not a failure.
  assert.ok(!finalJob.includes("commits/main"));
  assert.ok(!finalJob.includes("state=pending"));
  const verifier = readJob(finalJob, "verify", "publish");
  assert.ok(!verifier.includes(": write"));
  assert.ok(verifier.includes("--output-only true"));
  assert.ok(verifier.includes("--no-recurse-submodules"));
  assert.ok(finalJob.includes('"$latest_id" != "$CANDIDATE_RUN_ID"'));
  assert.ok(
    finalJob.includes(
      `group: final-candidate-result-${GITHUB_EXPRESSION_PREFIX} github.event.workflow_run.head_sha }}`
    )
  );
  const finalizerStart = finalJob.indexOf("\n  publish:");
  const finalizer = finalJob.slice(finalizerStart);
  assert.ok(finalizer.includes("gh api --method POST"));
  assert.ok(!finalizer.includes("actions/checkout"));
  assert.ok(!finalizer.includes("pnpm"));
});

test("skips only the hosted Runner when trusted control requires local validation", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const pendingJob = readJob(workflow, "publish_pending", "candidate");
  const candidateJob = readJob(workflow, "candidate", null);

  assert.ok(
    pendingJob.includes(
      `hosted_disposition: ${GITHUB_EXPRESSION_PREFIX} steps.classify_hosted_candidate.outputs.disposition }}`
    )
  );
  assert.ok(
    pendingJob.includes(
      `run_candidate: ${GITHUB_EXPRESSION_PREFIX} steps.classify_hosted_candidate.outputs.run_candidate }}`
    )
  );
  assert.ok(
    pendingJob.includes(
      "node trusted-control/scripts/ci/final-candidate-hosted-disposition.mjs"
    )
  );
  assert.ok(
    pendingJob.includes(
      "Checkout trusted classifier from the exact current base"
    )
  );
  assert.ok(
    pendingJob.includes(
      "Checkout exact candidate source for control classification"
    )
  );
  assert.ok(!pendingJob.includes("untrusted-candidate/scripts/ci/"));
  assert.ok(
    candidateJob.includes(
      "if: needs.publish_pending.outputs.run_candidate == 'true'"
    )
  );
  assert.ok(candidateJob.includes("name: Final Candidate Runner"));
  assert.ok(!candidateJob.includes("statuses: write"));
});

test("leaves local-component release decisions to the release-ready check", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", null);
  assert.ok(!candidateJob.includes("release branch policy"));
  assert.ok(!candidateJob.includes("final-candidate-release-policy.mjs"));
  assert.ok(
    candidateJob.indexOf("Preserve exact candidate evidence and command logs") >
      candidateJob.indexOf("Setup pnpm")
  );
});

test("disables candidate install hooks before selected commands", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", null);
  const trustedInstall = candidateJob.indexOf(
    "Install trusted evidence parser"
  );
  const candidateInstall = candidateJob.indexOf(
    "Install candidate dependencies without repository scripts"
  );
  const candidateValidation = candidateJob.indexOf(
    "Validate the exact final candidate without write credentials"
  );

  assert.ok(trustedInstall >= 0);
  assert.ok(candidateInstall > trustedInstall);
  assert.ok(candidateValidation > candidateInstall);
  assert.ok(
    candidateJob
      .slice(candidateInstall)
      .includes("install-isolated-candidate-dependencies.sh")
  );
  const dependencyInstall = readRepoFile(
    "scripts/ci/install-isolated-candidate-dependencies.sh"
  );
  assert.ok(dependencyInstall.includes("--config.ignore-pnpmfile=true"));
  assert.ok(dependencyInstall.includes("--ignore-scripts"));
});

test("gives isolated candidate Node processes one explicit hosted-safe heap budget", () => {
  const commandWrapper = readRepoFile(
    "scripts/ci/run-isolated-candidate-command.sh"
  );

  assert.ok(commandWrapper.includes("exec env -i"));
  assert.ok(commandWrapper.includes("NODE_OPTIONS=--max-old-space-size=6144"));
  assert.doesNotMatch(commandWrapper, INHERITED_NODE_OPTIONS_PATTERN);
});

test("gives serial candidate validation enough time to finish", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", null);

  assert.ok(candidateJob.includes("timeout-minutes: 60"));
});

test("trusted result publication fails closed and never executes candidate scripts", () => {
  const result = readRepoFile(".github/workflows/final-candidate-result.yml");
  for (const required of [
    "workflow_run:",
    "types: [completed]",
    "final-candidate-run-context.mjs",
    "github.event.workflow_run.id",
    "steps.identity.outputs.valid == 'true'",
    "state=failure",
    '"$VERIFIER_RESULT" = success',
  ]) {
    assert.ok(result.includes(required), required);
  }
  for (const unsafe of [
    "run: pnpm --dir untrusted-candidate",
    "secrets.",
    "environment:",
    "allow-unsafe-pr-checkout",
  ]) {
    assert.ok(!result.includes(unsafe), unsafe);
  }
  for (const block of extractRunBlocks(result)) {
    assert.doesNotMatch(block, GITHUB_EXPRESSION_PATTERN);
  }
});

test("ready PR events run automatically while drafts and unrelated labels stay idle", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const trigger = workflow.split("\nconcurrency:\n")[0];
  assert.ok(trigger.includes("branches: [main]"));
  const eventTypes = trigger
    .match(EVENT_TYPES_PATTERN)?.[1]
    .split(",")
    .map((value) => value.trim());
  assert.deepEqual(eventTypes, [
    "opened",
    "synchronize",
    "reopened",
    "ready_for_review",
    "converted_to_draft",
    "labeled",
  ]);
  const pendingJob = readJob(workflow, "publish_pending", "candidate");
  const pendingGuard = pendingJob
    .split("if: >-\n")[1]
    ?.split("\n    runs-on:")[0];
  const concurrencyBlock = workflow
    .split("\nconcurrency:\n")[1]
    ?.split("\njobs:\n")[0];
  const groupExpression = concurrencyBlock?.split("${{")[1]?.split("}}")[0];
  assert.ok(pendingGuard);
  assert.ok(groupExpression);
  assert.ok(concurrencyBlock?.includes("cancel-in-progress: true"));
  assert.ok(!concurrencyBlock?.includes("queue: max"));
  // Evaluate the workflow's expressions, not a second implementation of its policy.
  for (const action of eventTypes) {
    for (const draft of [false, true]) {
      for (const base of ["main", "feature"]) {
        for (const label of [
          "",
          "bug",
          "final-candidate",
          "final-candidate-full",
        ]) {
          const context = {
            github: {
              event: {
                action,
                label: { name: label },
                pull_request: {
                  draft,
                  number: 325,
                  base: { ref: base },
                },
              },
              run_id: "100",
            },
            always: () => true,
            format: (template, value) => template.replace("{0}", value),
          };
          const shouldRun =
            !draft &&
            base === "main" &&
            (action !== "labeled" ||
              ["final-candidate", "final-candidate-full"].includes(label));
          const scenario = JSON.stringify({ action, draft, base, label });
          assert.equal(
            runInNewContext(pendingGuard, context),
            shouldRun,
            scenario
          );
          assert.equal(
            runInNewContext(groupExpression, context),
            shouldRun || (base === "main" && action === "converted_to_draft")
              ? "final-candidate-325"
              : "ignored-final-candidate-event-100",
            scenario
          );
        }
      }
    }
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

test("names the exact base in the run title for the completed-event verifier", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const runName = workflow.split("\nrun-name: >-\n")[1].split("\n\n")[0];
  assert.ok(
    runName.includes(
      `] on ${GITHUB_EXPRESSION_PREFIX} github.event.pull_request.base.sha }}`
    )
  );
});

test("does not execute a candidate-owned runner or package candidate script", () => {
  const workflow = readRepoFile(".github/workflows/final-candidate.yml");
  const candidateJob = readJob(workflow, "candidate", null);

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
