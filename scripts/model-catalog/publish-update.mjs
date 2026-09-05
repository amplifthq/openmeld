import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  modelCatalogSchema,
  modelCatalogUpdateEvidenceSchema,
} from "../../packages/schemas/src/schemas/config/model-catalog.ts";
import { renderReview } from "./catalog-update.mjs";

function command(binary, args) {
  return execFileSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function publicationDecision({
  pulls,
  controller,
  fingerprint,
  changed,
}) {
  const prefix = `codex/catalog-update-${controller}-`;
  if (
    pulls.some((pr) => pr.state === "OPEN" && pr.headRefName.startsWith(prefix))
  ) {
    return "review-in-progress";
  }
  if (pulls.some((pr) => pr.headRefName === `${prefix}${fingerprint}`)) {
    return "already-proposed";
  }
  return changed ? "create" : "unchanged";
}

export function assertAdditionsOnly(current, catalog, evidence) {
  const expected = structuredClone(current);
  for (const change of evidence.changes) {
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
    expected.agentControllers[evidence.controller].models.push(change.after);
  }
  if (evidence.changes.length) {
    expected.updatedAt = evidence.observedAt;
  }
  if (JSON.stringify(expected) !== JSON.stringify(catalog)) {
    throw new Error(
      "Candidate changed values outside the deterministic additions"
    );
  }
}

async function createDraft(branch, evidence, output, config) {
  await writeFile(
    resolve(output, "review.md"),
    renderReview(evidence, config.verification)
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
      `chore(models): review ${evidence.controller} catalog updates`,
      "--body-file",
      resolve(output, "review.md"),
    ])
  );
}

async function recoverPushedProposal(branch, evidence, output, config) {
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
  const evidencePath = `release/model-catalog-evidence/${evidence.controller}.json`;
  const paths = command("git", ["diff", "--name-only", `${sha}^`, sha]).split(
    "\n"
  );
  if (
    paths.some(
      (path) => path !== evidencePath && path !== "release/vendor-models.json"
    )
  ) {
    throw new Error(
      "Existing proposal branch has external changes; leave it for a coding agent"
    );
  }
  const recorded = modelCatalogUpdateEvidenceSchema.parse(
    JSON.parse(command("git", ["show", `${sha}:${evidencePath}`]))
  );
  if (
    recorded.fingerprint !== evidence.fingerprint ||
    recorded.controller !== evidence.controller
  ) {
    throw new Error("Existing proposal evidence differs");
  }
  const before = modelCatalogSchema.parse(
    JSON.parse(command("git", ["show", `${sha}^:release/vendor-models.json`]))
  );
  const after = modelCatalogSchema.parse(
    JSON.parse(command("git", ["show", `${sha}:release/vendor-models.json`]))
  );
  assertAdditionsOnly(before, after, recorded);
  await createDraft(branch, recorded, output, config);
  return true;
}

export async function publishUpdate(output) {
  const result = JSON.parse(
    await readFile(resolve(output, "result.json"), "utf8")
  );
  const evidence = modelCatalogUpdateEvidenceSchema.parse(
    JSON.parse(await readFile(resolve(output, "evidence.json"), "utf8"))
  );
  const catalog = modelCatalogSchema.parse(
    JSON.parse(await readFile(resolve(output, "catalog.json"), "utf8"))
  );
  const { controller, fingerprint } = evidence;
  const config = JSON.parse(
    await readFile("scripts/model-catalog/sources.json", "utf8")
  );
  if (
    !Object.hasOwn(config, controller) ||
    result.controller !== controller ||
    result.fingerprint !== fingerprint
  ) {
    throw new Error("Update identity mismatch");
  }
  const branch = `codex/catalog-update-${controller}-${fingerprint}`;
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
    controller,
    fingerprint,
    changed: result.changed,
  });
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
  const current = modelCatalogSchema.parse(
    JSON.parse(await readFile("release/vendor-models.json", "utf8"))
  );
  // Only the recorded additions may cross the write boundary. No defaults,
  // removals, existing parameters, or other controllers may change here.
  assertAdditionsOnly(current, catalog, evidence);
  if (
    await recoverPushedProposal(branch, evidence, output, config[controller])
  ) {
    return;
  }
  command("git", ["checkout", "-b", branch]);
  await mkdir("release/model-catalog-evidence", { recursive: true });
  const evidencePath = `release/model-catalog-evidence/${controller}.json`;
  await copyFile(resolve(output, "evidence.json"), evidencePath);
  if (evidence.changes.length) {
    await copyFile(
      resolve(output, "catalog.json"),
      "release/vendor-models.json"
    );
  }
  command("git", ["add", "--", evidencePath, "release/vendor-models.json"]);
  command("git", [
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-m",
    `chore(models): prepare ${controller} catalog updates`,
  ]);
  command("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
  await createDraft(branch, evidence, output, config[controller]);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await publishUpdate(resolve(process.argv[2]));
}
