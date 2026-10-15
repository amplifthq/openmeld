#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RUN_TITLE =
  /^Final Candidate PR #(\d+) @ ([0-9a-f]{40}) \[(standard|full)\]$/u;
const SHA = /^[0-9a-f]{40}$/u;
const LINE_BREAK = /[\r\n]/u;

// Only GitHub API facts identify the run and PR. Artifacts are never an identity source.
export function resolveRunContext({
  event,
  run,
  workflow,
  pr,
  main,
  tree,
  jobs,
}) {
  const title = RUN_TITLE.exec(run.display_title ?? "");
  if (
    !title ||
    run.id !== event.workflow_run.id ||
    run.run_attempt !== event.workflow_run.run_attempt ||
    run.event !== "pull_request" ||
    run.workflow_id !== workflow.id ||
    run.path !== ".github/workflows/final-candidate.yml" ||
    run.repository.id !== event.repository.id ||
    pr.base.repo.id !== event.repository.id ||
    pr.base.ref !== "main" ||
    pr.state !== "open" ||
    pr.draft ||
    pr.number !== Number(title[1]) ||
    pr.head.sha !== title[2] ||
    run.head_sha !== pr.head.sha ||
    run.head_repository.id !== pr.head.repo.id ||
    pr.base.sha !== main.sha ||
    !SHA.test(main.sha) ||
    !SHA.test(tree.sha)
  ) {
    throw new Error(
      "Final Candidate run does not match the live PR, workflow, or current main."
    );
  }
  const completed = event.action === "completed";
  if (!completed && run.status === "completed") {
    return null; // A delayed start event must not overwrite the final result.
  }
  const candidates = jobs.filter(
    (job) => job.name === "Final Candidate Runner"
  );
  if (completed && (run.status !== "completed" || candidates.length !== 1)) {
    throw new Error(
      "Final Candidate requires exactly one completed candidate job."
    );
  }
  return {
    base: main.sha,
    branch: pr.head.ref,
    confidence: title[3],
    head: pr.head.sha,
    job_result: completed ? candidates[0].conclusion : "pending",
    pr: String(pr.number),
    tree: tree.sha,
  };
}

function api(endpoint) {
  return JSON.parse(
    execFileSync("gh", ["api", endpoint], { encoding: "utf8" })
  );
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repository = process.env.GITHUB_REPOSITORY;
  if (event.repository.full_name !== repository) {
    throw new Error("Workflow repository mismatch.");
  }
  const root = `repos/${repository}`;
  const run = api(`${root}/actions/runs/${event.workflow_run.id}`);
  const title = RUN_TITLE.exec(run.display_title ?? "");
  if (!title) {
    throw new Error("Missing exact Final Candidate run identity.");
  }
  const pr = api(`${root}/pulls/${title[1]}`);
  const context = resolveRunContext({
    event,
    run,
    pr,
    workflow: api(`${root}/actions/workflows/final-candidate.yml`),
    main: api(`${root}/commits/main`),
    tree: api(`${root}/git/commits/${title[2]}`).tree,
    jobs:
      event.action === "completed"
        ? api(
            `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
          ).jobs
        : [],
  });
  if (!context) {
    return;
  }
  const trustedSha = execFileSync(
    "git",
    ["-C", "trusted-control", "rev-parse", "HEAD"],
    {
      encoding: "utf8",
    }
  ).trim();
  if (trustedSha !== context.base) {
    throw new Error(
      "Main advanced after the publisher started; rerun against current main."
    );
  }
  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== "string" || LINE_BREAK.test(value)) {
      throw new Error(`Invalid workflow output: ${key}`);
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
  appendFileSync(process.env.GITHUB_OUTPUT, "valid=true\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
