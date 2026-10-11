import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function requireDesktopCandidateRun(run, repository) {
  if (
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    run.path !== ".github/workflows/desktop-release.yml" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository
  ) {
    throw new Error(
      "Candidate must come from a successful main Desktop release run in this repository."
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.CANDIDATE_RUN_ID;
  if (
    !(
      /^[\w.-]+\/[\w.-]+$/u.test(repository ?? "") && /^\d+$/u.test(runId ?? "")
    )
  ) {
    throw new Error("Specify the repository and numeric candidate run ID.");
  }
  const run = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/actions/runs/${runId}`], {
      encoding: "utf8",
    })
  );
  requireDesktopCandidateRun(run, repository);
}
