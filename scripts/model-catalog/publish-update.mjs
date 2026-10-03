import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  modelCatalogSchema,
  modelCatalogUpdateEvidenceSchema,
} from "../../packages/schemas/src/schemas/config/model-catalog.ts";
import { readPreviousEvidence } from "./catalog-update.mjs";
import { batchReviewFingerprint } from "./collect-update.mjs";
import {
  hasNewReviewFacts,
  modelReviewFacts,
  renderBatchReview,
} from "./review.mjs";

function command(binary, args) {
  return execFileSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const CATALOG_BRANCH_PREFIX = "codex/catalog-update-";
const LATEST_SCAN_MARKER = "<!-- openmeld:model-catalog-latest-scan -->";

export function openCatalogPull(pulls) {
  const matches = [
    ...new Map(
      pulls
        .filter(
          (pr) =>
            pr.state === "OPEN" &&
            pr.headRefName.startsWith(CATALOG_BRANCH_PREFIX)
        )
        .map((pr) => [pr.url, pr])
    ).values(),
  ];
  if (matches.length > 1) {
    throw new Error("Multiple open model catalog review PRs found");
  }
  return matches[0] ?? null;
}

export function publicationDecision({ pulls, fingerprint, changed }) {
  if (openCatalogPull(pulls)) {
    return "update-review";
  }
  const prefix = "codex/catalog-update-batch-";
  if (pulls.some((pr) => pr.headRefName === `${prefix}${fingerprint}`)) {
    return "already-proposed";
  }
  return changed ? "create" : "unchanged";
}

export function renderLatestScanComment(review, runUrl) {
  const source = runUrl ? `Source run: ${runUrl}\n\n` : "";
  return `${LATEST_SCAN_MARKER}
## Latest model catalog scan

This comment is updated in place after every successful model-catalog scan while this review PR remains open. The PR branch and body are intentionally left untouched so in-progress reviewer changes are never rewritten.

${source}> Raw evidence for this refresh is preserved in the workflow artifact. Snapshot paths mentioned in the generated brief below describe the proposal layout; they are not rewritten onto an already-owned PR branch.

${review}`;
}

export function findLatestScanComment(comments) {
  const matches = comments.filter(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      typeof comment.body === "string" &&
      comment.body.includes(LATEST_SCAN_MARKER)
  );
  if (matches.length > 1) {
    throw new Error("Multiple bot-owned latest model catalog comments found");
  }
  return matches[0] ?? null;
}

function pullCoordinates(url) {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const number = Number(segments[3]);
  if (
    parsed.hostname !== "github.com" ||
    segments.length !== 4 ||
    segments[2] !== "pull" ||
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw new Error(`Unexpected pull request URL: ${url}`);
  }
  return {
    number,
    repository: `${segments[0]}/${segments[1]}`,
  };
}

function workflowRunUrl() {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  return serverUrl && repository && runId
    ? `${serverUrl}/${repository}/actions/runs/${runId}`
    : null;
}

async function updateOpenReview(pull, output, runUrl) {
  const { number, repository } = pullCoordinates(pull.url);
  const review = await readFile(resolve(output, "review.md"), "utf8");
  const commentPath = resolve(output, "latest-scan-comment.md");
  await writeFile(commentPath, renderLatestScanComment(review, runUrl));
  const commentPages = JSON.parse(
    command("gh", [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repository}/issues/${number}/comments?per_page=100`,
    ])
  );
  const existing = findLatestScanComment(commentPages.flat());
  if (existing) {
    command("gh", [
      "api",
      "--method",
      "PATCH",
      `repos/${repository}/issues/comments/${existing.id}`,
      "-F",
      `body=@${commentPath}`,
    ]);
    console.log(`review-updated ${pull.url}`);
    return;
  }
  command("gh", [
    "pr",
    "comment",
    String(number),
    "--repo",
    repository,
    "--body-file",
    commentPath,
  ]);
  console.log(`review-comment-created ${pull.url}`);
}

export function assertAdditionsOnly(current, catalog, evidences) {
  const expected = structuredClone(current);
  for (const evidence of evidences) {
    for (const change of [...evidence.changes].reverse()) {
      if (
        change.before !== null ||
        expected.agentControllers[evidence.controller].models.some(
          (model) => model.id === change.modelId
        ) ||
        change.modelId !== change.after.id
      ) {
        throw new Error(
          "Only new model additions can be published automatically"
        );
      }
      expected.agentControllers[evidence.controller].models.unshift(
        change.after
      );
    }
    if (evidence.changes.length) {
      expected.updatedAt = evidence.observedAt;
    }
  }
  if (JSON.stringify(expected) !== JSON.stringify(catalog)) {
    throw new Error(
      "Candidate changed values outside the deterministic additions"
    );
  }
}

async function createDraft(
  branch,
  evidence,
  output,
  config,
  current,
  previousEvidence
) {
  await writeFile(
    resolve(output, "review.md"),
    renderBatchReview(evidence, config, current, previousEvidence)
  );
  console.log(
    command("gh", [
      "pr",
      "create",
      "--draft",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      "chore(models): review local model catalog updates",
      "--body-file",
      resolve(output, "review.md"),
    ])
  );
}

async function recoverPushedProposal(
  branch,
  evidence,
  output,
  config,
  fingerprint
) {
  const remote = command("git", [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  if (!remote) {
    return false;
  }
  command("git", ["fetch", "--depth=2", "origin", branch]);
  const sha = command("git", ["rev-parse", "FETCH_HEAD"]);
  const evidencePaths = evidence.map(
    (item) => `release/model-catalog-evidence/${item.controller}.json`
  );
  const paths = command("git", ["diff", "--name-only", `${sha}^`, sha]).split(
    "\n"
  );
  if (
    paths.some(
      (path) =>
        !evidencePaths.includes(path) && path !== "release/vendor-models.json"
    )
  ) {
    throw new Error(
      "Existing proposal branch has external changes; leave it for a coding agent"
    );
  }
  const recorded = evidencePaths.map((path) =>
    modelCatalogUpdateEvidenceSchema.parse(
      JSON.parse(command("git", ["show", `${sha}:${path}`]))
    )
  );
  const previousEvidence = evidencePaths.map((path) => {
    const exists = command("git", [
      "ls-tree",
      "--name-only",
      `${sha}^`,
      "--",
      path,
    ]);
    return exists
      ? modelCatalogUpdateEvidenceSchema.parse(
          JSON.parse(command("git", ["show", `${sha}^:${path}`]))
        )
      : undefined;
  });
  const before = modelCatalogSchema.parse(
    JSON.parse(command("git", ["show", `${sha}^:release/vendor-models.json`]))
  );
  const after = modelCatalogSchema.parse(
    JSON.parse(command("git", ["show", `${sha}:release/vendor-models.json`]))
  );
  if (
    recorded.some(
      (item, index) => item.controller !== evidence[index].controller
    ) ||
    batchReviewFingerprint(recorded, before, config, previousEvidence) !==
      fingerprint
  ) {
    throw new Error("Existing proposal review facts differ");
  }
  assertAdditionsOnly(before, after, recorded);
  await createDraft(branch, recorded, output, config, before, previousEvidence);
  return true;
}

export async function publishUpdate(output) {
  const result = JSON.parse(
    await readFile(resolve(output, "result.json"), "utf8")
  );
  const evidence = modelCatalogUpdateEvidenceSchema
    .array()
    .parse(
      JSON.parse(await readFile(resolve(output, "evidence.json"), "utf8"))
    );
  const catalog = modelCatalogSchema.parse(
    JSON.parse(await readFile(resolve(output, "catalog.json"), "utf8"))
  );
  const config = JSON.parse(
    await readFile("scripts/model-catalog/sources.json", "utf8")
  );
  const current = modelCatalogSchema.parse(
    JSON.parse(await readFile("release/vendor-models.json", "utf8"))
  );
  const previousEvidence = await Promise.all(
    evidence.map((item) => readPreviousEvidence(process.cwd(), item.controller))
  );
  const fingerprint = batchReviewFingerprint(
    evidence,
    current,
    config,
    previousEvidence
  );
  const reviewChanges = evidence.map((item, index) => {
    const previous = previousEvidence[index];
    const since = config[item.controller]?.discoverySince;
    return hasNewReviewFacts(
      modelReviewFacts(item, current, since),
      previous ? modelReviewFacts(previous, current, since) : undefined
    );
  });
  if (
    JSON.stringify(evidence.map((item) => item.controller)) !==
      JSON.stringify(Object.keys(config)) ||
    result.fingerprint !== fingerprint ||
    result.changed !== reviewChanges.some(Boolean)
  ) {
    throw new Error("Update identity mismatch");
  }
  const branch = `codex/catalog-update-batch-${fingerprint}`;
  const fields = ["--limit", "1000", "--json", "state,headRefName,url"];
  const pulls = [
    ...JSON.parse(
      command("gh", [
        "pr",
        "list",
        "--state",
        "open",
        "--base",
        "main",
        ...fields,
      ])
    ),
    ...JSON.parse(
      command("gh", [
        "pr",
        "list",
        "--state",
        "all",
        "--head",
        branch,
        ...fields,
      ])
    ),
  ];
  const decision = publicationDecision({
    pulls,
    fingerprint,
    changed: result.changed,
  });
  if (decision === "update-review") {
    const runUrl = workflowRunUrl();
    if (!runUrl) {
      console.log("review-in-progress");
      return;
    }
    await updateOpenReview(openCatalogPull(pulls), output, runUrl);
    return;
  }
  if (decision !== "create") {
    console.log(decision);
    return;
  }
  if (command("git", ["status", "--porcelain"])) {
    throw new Error("Publisher requires a clean checkout");
  }
  if (
    command("git", ["rev-parse", "HEAD"]) !==
    command("git", ["rev-parse", "origin/main"])
  ) {
    throw new Error("Publisher must start at origin/main");
  }
  // Only the recorded additions may cross the write boundary. No defaults,
  // removals, existing parameters, or other controllers may change here.
  assertAdditionsOnly(current, catalog, evidence);
  if (
    await recoverPushedProposal(branch, evidence, output, config, fingerprint)
  ) {
    return;
  }
  command("git", ["checkout", "-b", branch]);
  await mkdir("release/model-catalog-evidence", { recursive: true });
  const evidencePaths = [];
  for (const item of evidence) {
    const path = `release/model-catalog-evidence/${item.controller}.json`;
    evidencePaths.push(path);
    await writeFile(path, `${JSON.stringify(item, null, 2)}\n`);
  }
  if (evidence.some((item) => item.changes.length)) {
    await copyFile(
      resolve(output, "catalog.json"),
      "release/vendor-models.json"
    );
  }
  command("pnpm", [
    "exec",
    "biome",
    "format",
    "--write",
    ...evidencePaths,
    "release/vendor-models.json",
  ]);
  command("git", ["add", "--", ...evidencePaths, "release/vendor-models.json"]);
  command("git", [
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-m",
    "chore(models): prepare local model catalog updates",
  ]);
  command("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
  await createDraft(
    branch,
    evidence,
    output,
    config,
    current,
    previousEvidence
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await publishUpdate(resolve(process.argv[2]));
}
