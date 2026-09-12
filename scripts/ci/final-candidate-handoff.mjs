import { setTimeout as delay } from "node:timers/promises";
import { runGh, runGhJson } from "./final-candidate-state.mjs";

// Cancellation is asynchronous: an always-running publisher may still write
// failure after the runner exits. Only the whole workflow's completion hands
// publication over to local validation. This also works with pre-fix workflows.
export async function settleHostedCandidateRuns(input, dependencies = {}) {
  const read = dependencies.read ?? runGhJson;
  const cancel = dependencies.cancel ?? runGh;
  const wait = dependencies.wait ?? (() => delay(5000));
  const now = dependencies.now ?? Date.now;
  const report =
    dependencies.report ?? ((line) => process.stdout.write(`${line}\n`));
  const deadline = now() + 180_000;
  const cancelled = new Set();
  while (true) {
    const active = readOwnedActiveRuns(input, read);
    if (active.length === 0) {
      return;
    }
    if (now() >= deadline) {
      throw new Error(
        "Hosted Final Candidate has not finished cancellation; no local status will be published. Inspect the listed runs before retrying."
      );
    }
    for (const run of active) {
      const attempt = `${run.id}:${run.run_attempt}`;
      if (cancelled.has(attempt)) {
        continue;
      }
      report(
        `Taking over PR #${input.pullRequestNumber}: cancel hosted run ${run.id} attempt ${run.run_attempt}, then wait for its publisher to finish.`
      );
      cancelOwnedRun(input.repository, run, cancel, read);
      cancelled.add(attempt);
    }
    await wait();
  }
}

function cancelOwnedRun(repository, run, cancel, read) {
  const endpoint = `repos/${repository}/actions/runs/${run.id}`;
  try {
    cancel(["api", "--method", "POST", `${endpoint}/cancel`]);
  } catch (error) {
    // Completion may race cancellation, but an API error is not completion.
    const current = read(["api", endpoint]);
    if (
      current.id !== run.id ||
      current.run_attempt !== run.run_attempt ||
      current.status !== "completed"
    ) {
      throw error;
    }
  }
}

function readOwnedActiveRuns(input, read) {
  const pages = read([
    "api",
    "--paginate",
    "--slurp",
    `repos/${input.repository}/actions/workflows/final-candidate.yml/runs?head_sha=${input.headSha}&per_page=100`,
  ]);
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some(
      (page) =>
        !Number.isInteger(page.total_count) ||
        page.total_count >= 1000 ||
        !Array.isArray(page.workflow_runs)
    )
  ) {
    throw new Error(
      "Cannot establish complete hosted Final Candidate state; no local status will be published."
    );
  }
  const runs = pages.flatMap((page) => page.workflow_runs);
  if (runs.length !== pages[0].total_count) {
    throw new Error(
      "Hosted Final Candidate listing is incomplete; no local status will be published."
    );
  }
  if (
    runs.some(
      (run) =>
        !(
          Number.isSafeInteger(run.id) && Number.isSafeInteger(run.run_attempt)
        ) ||
        typeof run.status !== "string" ||
        run.head_sha !== input.headSha
    )
  ) {
    throw new Error(
      "GitHub returned invalid hosted candidate identity; no local status will be published."
    );
  }
  const active = runs.filter((run) => run.status !== "completed");
  // Commit statuses are shared by SHA. Never cancel an unrelated PR even
  // when its head happens to be the same commit; refuse the handoff instead.
  if (
    active.some(
      (run) =>
        run.head_branch !== input.branchName ||
        !Array.isArray(run.pull_requests) ||
        run.pull_requests.length !== 1 ||
        run.pull_requests[0].number !== input.pullRequestNumber
    )
  ) {
    throw new Error(
      "An active Final Candidate for this commit is not owned by this PR; no local status will be published."
    );
  }
  return active;
}
