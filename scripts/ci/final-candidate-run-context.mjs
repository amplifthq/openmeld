#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// The source run carries its exact base in the title. When trusted control
// accepts the candidate, that title came from the same workflow file as main,
// and the run itself verified the base was live main when it started.
const RUN_TITLE =
  /^Final Candidate PR #(\d+) @ ([0-9a-f]{40}) \[(standard|full)\] on ([0-9a-f]{40})$/u;
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
  baseComparison,
}) {
  const title = RUN_TITLE.exec(run.display_title ?? "");
  if (
    !title ||
    event.action !== "completed" ||
    run.id !== event.workflow_run.id ||
    run.run_attempt !== event.workflow_run.run_attempt ||
    run.status !== "completed" ||
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
    !SHA.test(main.sha) ||
    !SHA.test(tree.sha)
  ) {
    throw new Error(
      "Final Candidate run does not match the live PR, workflow, or current main."
    );
  }
  // Evidence stays bound to its exact base. Main advancing past that base does
  // not fail the result: merge queue or strict up-to-date protection owns
  // freshness at merge time. The base must still be part of main.
  if (
    baseComparison.behind_by !== 0 ||
    !(
      baseComparison.status === "identical" || baseComparison.status === "ahead"
    )
  ) {
    throw new Error("Final Candidate base is not part of current main.");
  }
  const candidates = jobs.filter(
    (job) => job.name === "Final Candidate Runner"
  );
  if (candidates.length !== 1) {
    throw new Error(
      "Final Candidate requires exactly one completed candidate job."
    );
  }
  return {
    base: title[4],
    branch: pr.head.ref,
    confidence: title[3],
    head: pr.head.sha,
    job_result: candidates[0].conclusion,
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
  const liveMain = api(`${root}/commits/main`);
  const context = resolveRunContext({
    event,
    run,
    pr,
    workflow: api(`${root}/actions/workflows/final-candidate.yml`),
    main: liveMain,
    tree: api(`${root}/git/commits/${title[2]}`).tree,
    jobs: api(
      `${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
    ).jobs,
    baseComparison: api(`${root}/compare/${title[4]}...main`),
  });
  const trustedSha = execFileSync(
    "git",
    ["-C", "trusted-control", "rev-parse", "HEAD"],
    {
      encoding: "utf8",
    }
  ).trim();
  if (trustedSha !== liveMain.sha) {
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
