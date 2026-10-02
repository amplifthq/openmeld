import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { importWindowsProcessArtifact } from "./windows-process-artifact.mjs";

const EXACT_SHA = /^[0-9a-f]{40}$/u;
const WINDOWS_ARTIFACT_NAME = /^windows-process-([0-9a-f]{40})$/u;
const RUN_ID = /^[1-9][0-9]*$/u;
const WINDOWS_JOB = "Build Windows Process Helper For CLI Package";
const WORKFLOW = ".github/workflows/cli-release.yml";
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

export function assertTrustedWindowsProcessArtifactRun(input) {
  const { run, jobs, repository } = input;
  if (
    run?.repository?.full_name !== repository ||
    run.path !== WORKFLOW ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "main" ||
    !EXACT_SHA.test(run.head_sha ?? "")
  ) {
    throw new Error(
      "Windows helper reuse requires an official CLI release workflow run from this repository's main branch."
    );
  }
  if (
    !jobs?.some(
      (job) => job.name === WINDOWS_JOB && job.conclusion === "success"
    )
  ) {
    throw new Error(
      "The source run's Windows helper job must have completed successfully."
    );
  }
  return run.head_sha;
}

export function selectReusableWindowsArtifact(artifacts) {
  const matches = (artifacts ?? []).filter(
    (artifact) =>
      artifact.expired === false && WINDOWS_ARTIFACT_NAME.test(artifact.name)
  );
  if (matches.length !== 1) {
    throw new Error(
      "The trusted run must contain exactly one unexpired Windows process helper artifact."
    );
  }
  return {
    name: matches[0].name,
    sourceSha: WINDOWS_ARTIFACT_NAME.exec(matches[0].name)[1],
  };
}

function ghJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
  );
}

export function reuseWindowsProcessArtifact(env = process.env) {
  const runId = env.WINDOWS_ARTIFACT_RUN_ID?.trim() ?? "";
  if (!RUN_ID.test(runId)) {
    throw new Error("Windows helper reuse requires a numeric run ID.");
  }
  const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  const releaseSha = env.RELEASE_SHA?.trim() || checkoutSha;
  const repository =
    env.GITHUB_REPOSITORY?.trim() ||
    ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  if (!(EXACT_SHA.test(releaseSha) && repository)) {
    throw new Error(
      "Windows helper reuse requires a release SHA and repository."
    );
  }
  if (checkoutSha !== releaseSha) {
    throw new Error(
      "Windows helper reuse requires the exact release checkout."
    );
  }
  const apiPath = `repos/${repository}/actions/runs/${runId}`;
  assertTrustedWindowsProcessArtifactRun({
    jobs: ghJson(["api", `${apiPath}/jobs?per_page=100`]).jobs,
    repository,
    run: ghJson(["api", apiPath]),
  });
  const artifact = selectReusableWindowsArtifact(
    ghJson(["api", `${apiPath}/artifacts?per_page=100`]).artifacts
  );
  const ancestry = ghJson([
    "api",
    `repos/${repository}/compare/${artifact.sourceSha}...${releaseSha}`,
  ]);
  if (!(ancestry.status === "ahead" || ancestry.status === "identical")) {
    throw new Error(
      "The helper artifact release source must be an ancestor of this release."
    );
  }
  const artifactDirectory = path.join(ROOT, "dev-tmp/windows-process-reuse");
  mkdirSync(artifactDirectory, { recursive: true });
  execFileSync(
    "gh",
    [
      "run",
      "download",
      runId,
      "--repo",
      repository,
      "--name",
      artifact.name,
      "--dir",
      artifactDirectory,
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  const manifest = importWindowsProcessArtifact(artifactDirectory, ROOT);
  process.stdout.write(
    `Reused source-matched Windows helper ${manifest.sha256} from trusted run ${runId}.\n`
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  reuseWindowsProcessArtifact(
    process.argv[2]
      ? { ...process.env, WINDOWS_ARTIFACT_RUN_ID: process.argv[2] }
      : process.env
  );
}
