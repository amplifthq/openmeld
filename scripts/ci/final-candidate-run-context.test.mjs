import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveRunContext } from "./final-candidate-run-context.mjs";

const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/github-fork-final-candidate.json", import.meta.url),
    "utf8"
  )
);

function candidateRun() {
  const input = structuredClone(captured);
  // The captured run used the old event. Model the new trigger, title and successful job.
  input.run.event = "pull_request";
  input.run.display_title = `Final Candidate PR #${input.pr.number} @ ${input.pr.head.sha} [standard]`;
  input.jobs.find((job) => job.name === "Final Candidate Runner").conclusion =
    "success";
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
    job_result: "success",
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
