import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { resolveRunContext } from "./final-candidate-run-context.mjs";

const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/github-fork-final-candidate.json", import.meta.url),
    "utf8"
  )
);

function candidateRun() {
  const input = structuredClone(captured);
  // Keep the actual pull_request API identity intact. Only construct the
  // documented workflow_run envelope consumed by this boundary.
  input.event = {
    action: "completed",
    repository: input.run.repository,
    workflow_run: { id: input.run.id, run_attempt: input.run.run_attempt },
  };
  return input;
}

test("binds a fork result to the exact GitHub run, attempt, PR and current base", () => {
  const input = candidateRun();
  assert.notEqual(input.pr.head.repo.id, input.pr.base.repo.id);
  assert.deepEqual(resolveRunContext(input), {
    base: input.main.sha,
    branch: input.pr.head.ref,
    confidence: "standard",
    head: input.pr.head.sha,
    job_result: "skipped",
    pr: String(input.pr.number),
    tree: input.tree.sha,
  });
  for (const mutate of [
    (x) => {
      x.run.event = "pull_request_target";
    },
    (x) => {
      x.run.workflow_id += 1;
    },
    (x) => {
      x.run.path = ".github/workflows/untrusted.yml";
    },
    (x) => {
      x.event.workflow_run.run_attempt += 1;
    },
    (x) => {
      x.event.workflow_run.id += 1;
    },
    (x) => {
      x.run.head_sha = "a".repeat(40);
    },
    (x) => {
      x.pr.head.sha = "a".repeat(40);
    },
    (x) => {
      x.run.head_repository.id += 1;
    },
    (x) => {
      x.pr.base.repo.id += 1;
    },
    (x) => {
      x.main.sha = "a".repeat(40);
    },
    (x) => {
      x.pr.state = "closed";
    },
    (x) => {
      x.pr.draft = true;
    },
    (x) => {
      x.jobs = [];
    },
    (x) => {
      x.jobs.push(x.jobs.find((job) => job.name === "Final Candidate Runner"));
    },
  ]) {
    const changed = candidateRun();
    mutate(changed);
    assert.throws(() => resolveRunContext(changed));
  }
});

test("does not replace a completed result with a delayed pending event", () => {
  const input = candidateRun();
  input.event.action = "in_progress";
  assert.equal(resolveRunContext(input), null);
  input.run.status = "in_progress";
  assert.equal(resolveRunContext(input).job_result, "pending");
});

test("preserves failed, canceled and skipped outcomes for the evidence verifier", () => {
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    const input = candidateRun();
    input.jobs.find((job) => job.name === "Final Candidate Runner").conclusion =
      conclusion;
    assert.equal(resolveRunContext(input).job_result, conclusion);
  }
});

test(
  "the actual status-writer shell rejects old runs and attempts and fails closed",
  { skip: process.platform === "win32" },
  () => {
    const workflow = parse(
      readFileSync(
        new URL(
          "../../.github/workflows/final-candidate-result.yml",
          import.meta.url
        ),
        "utf8"
      )
    );
    const script = workflow.jobs.publish.steps[0].run;
    for (const scenario of [
      "success",
      "old-run",
      "old-attempt",
      "failed-verifier",
      "missing-evidence",
    ]) {
      const root = mkdtempSync(path.join(tmpdir(), "candidate-status-writer-"));
      try {
        const input = candidateRun();
        const latest = structuredClone(input.run);
        latest.created_at = "2026-10-15T00:01:00Z";
        if (scenario === "old-run") {
          latest.id += 1;
        }
        const run = structuredClone(input.run);
        run.created_at = "2026-10-15T00:00:00Z";
        if (scenario === "old-attempt") {
          run.run_attempt += 1;
        }
        writeFileSync(
          path.join(root, "facts.json"),
          JSON.stringify({
            ...input,
            latest,
            run,
            runs:
              scenario === "old-run"
                ? [run, latest]
                : [latest, { ...run, id: run.id - 1 }],
          })
        );
        const bin = path.join(root, "bin");
        mkdirSync(bin);
        const gh = path.join(bin, "gh");
        writeFileSync(
          gh,
          `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const facts = JSON.parse(fs.readFileSync(process.env.FACTS));
if (a.includes('--method')) { fs.appendFileSync(process.env.POSTS, JSON.stringify(a)); process.exit(0); }
const endpoint = a[1];
if (endpoint.includes('/pulls/')) console.log(JSON.stringify(facts.pr));
else if (endpoint.endsWith('/commits/main')) console.log(facts.main.sha);
else if (endpoint.includes('/actions/workflows/')) console.log(JSON.stringify({workflow_runs: facts.runs}));
else if (endpoint.includes('/actions/runs/')) console.log(JSON.stringify(facts.run));
else process.exit(1);
`
        );
        chmodSync(gh, 0o755);
        const posts = path.join(root, "posts");
        const result = spawnSync("bash", ["-c", script], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            GH_TOKEN: "test-only",
            FACTS: path.join(root, "facts.json"),
            POSTS: posts,
            CANDIDATE_REPOSITORY: input.pr.base.repo.full_name,
            CANDIDATE_HEAD_SHA: input.pr.head.sha,
            CANDIDATE_BASE_SHA: input.main.sha,
            CANDIDATE_PR_NUMBER: String(input.pr.number),
            CANDIDATE_RUN_ID: String(input.run.id),
            CANDIDATE_RUN_ATTEMPT: String(input.run.run_attempt),
            CANDIDATE_SERVER_URL: "https://github.com",
            RUN_ACTION: "completed",
            VERIFIED_DESCRIPTION: "Verified",
            VERIFIED_STATE: scenario === "missing-evidence" ? "" : "success",
            VERIFIER_RESULT:
              scenario === "failed-verifier" ? "failure" : "success",
          },
        });
        assert.equal(result.status, 0, result.stderr);
        if (scenario.startsWith("old-")) {
          assert.equal(existsSync(posts), false);
        } else {
          assert.ok(
            JSON.parse(readFileSync(posts, "utf8")).includes(
              `state=${scenario === "success" ? "success" : "failure"}`
            )
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
);
