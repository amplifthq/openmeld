import { setTimeout as delay } from "node:timers/promises";
import { runGh, runGhJson } from "./final-candidate-state.mjs";

// A completed source run can still enqueue a separate workflow_run publisher.
// Wait for that exact completed-event workflow, not just an empty active list.
export async function settleHostedCandidateRuns(input, dependencies = {}) {
  const read = dependencies.read ?? runGhJson;
  const cancel = dependencies.cancel ?? runGh;
  const wait = dependencies.wait ?? (() => delay(5000));
  const now = dependencies.now ?? Date.now;
  const report =
    dependencies.report ?? ((line) => process.stdout.write(`${line}\n`));
  const deadline = now() + 180_000;
  const resultDeadline = now() + 1_200_000;
  const cancelled = new Set();
  const reportedResults = new Set();
  while (true) {
    const runs = readOwnedRuns(input, read);
    const active = runs.filter((run) => run.status !== "completed");
    if (active.length === 0) {
      // Older inline publishers finish with their source workflow. Split
      // publishers only accept the newest eligible source run for this PR.
      const source = runs.find((run) =>
        run.display_title?.startsWith(
          `Final Candidate PR #${input.pullRequestNumber} @ ${input.headSha} [`
        )
      );
      if (!source || resultPublicationFinished(input, source, read)) {
        return;
      }
      if (now() >= resultDeadline) {
        throw new Error(
          "Hosted Final Candidate result publication has not finished; no local status will be published. Inspect the exact source run and its result workflow."
        );
      }
      const identity = `${source.id}:${source.run_attempt}`;
      if (!reportedResults.has(identity)) {
        report(
          `Waiting for Final Candidate Result ${identity} completed, including delayed event delivery, before local publication.`
        );
        reportedResults.add(identity);
      }
      await wait();
      continue;
    }
    if (now() >= deadline) {
      throw new Error(
        "Hosted Final Candidate has not finished cancellation; no local status will be published. Inspect the listed runs before retrying."
      );
    }
    cancelActiveRuns(input, active, { cancelled, report, cancel, read });
    await wait();
  }
}

function cancelActiveRuns(input, active, { cancelled, report, cancel, read }) {
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

function readOwnedRuns(input, read) {
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
  if (
    runs.some(
      (run) =>
        run.display_title?.startsWith("Final Candidate PR ") &&
        !run.display_title.startsWith(
          `Final Candidate PR #${input.pullRequestNumber} @ ${input.headSha} [`
        )
    )
  ) {
    throw new Error(
      "A separate Final Candidate publisher for this commit is not owned by this PR; no local status will be published."
    );
  }
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
  return runs;
}

function resultPublicationFinished(input, source, read) {
  if (!Number.isFinite(Date.parse(source.created_at))) {
    throw new Error(
      "Missing source run timestamp; no local status will be published."
    );
  }
  const created = encodeURIComponent(`>=${source.created_at}`);
  const pages = read([
    "api",
    "--paginate",
    "--slurp",
    `repos/${input.repository}/actions/workflows/final-candidate-result.yml/runs?event=workflow_run&created=${created}&per_page=100`,
  ]);
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some(
      (page) =>
        !Number.isInteger(page.total_count) ||
        page.total_count >= 1000 ||
        !Array.isArray(page.workflow_runs)
    ) ||
    pages.flatMap((page) => page.workflow_runs).length !== pages[0].total_count
  ) {
    throw new Error(
      "Cannot establish complete Final Candidate result state; no local status will be published."
    );
  }
  const prefix = `Final Candidate Result ${source.id}:${source.run_attempt} `;
  const results = pages
    .flatMap((page) => page.workflow_runs)
    .filter((run) => run.display_title?.startsWith(prefix));
  // An empty list is not acknowledgement: GitHub may deliver the event later.
  // A failed/cancelled verifier is settled too; local checks still run afresh.
  return (
    results.some((run) => run.display_title === `${prefix}completed`) &&
    results.every((run) => run.status === "completed")
  );
}
