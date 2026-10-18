#!/usr/bin/env node

// Local Core reads the published CLI release from its R2 binding, exactly as
// production does. A worktree has no published release, so local development
// publishes this worktree's own versions and contracts with policy "ok":
// local Services are never told to update to some other build.
//
//   node scripts/dev/seed-local-cli-release.mjs --persist-to <wrangler state dir>

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";
import { collectLocalComponentFacts } from "../release/local-components.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const OBJECT_KEY = "cli/local-components.json";
const LOCAL_REASON =
  "Local development publishes this worktree as its own release.";

export function readLocalCliReleaseBucket(repoRoot = REPO_ROOT) {
  const config = parseJsoncObject(
    readFileSync(path.join(repoRoot, "services/core/wrangler.jsonc"), "utf8")
  );
  const binding = config.r2_buckets?.find(
    (entry) => entry.binding === "OPENMELD_CLI_RELEASES"
  );
  if (!binding?.bucket_name) {
    throw new Error(
      "services/core/wrangler.jsonc must bind OPENMELD_CLI_RELEASES for local development."
    );
  }
  return binding.bucket_name;
}

export async function buildLocalCliRelease(
  repoRoot = REPO_ROOT,
  now = new Date()
) {
  const facts = await collectLocalComponentFacts({ repoRoot });
  const ok = { updatePolicy: "ok", reason: LOCAL_REASON };
  return {
    schemaVersion: 1,
    updatedAt: now.toISOString(),
    components: {
      cli: { ...facts.cli, ...ok },
      service: { ...facts.service, ...ok },
      skills: { ...facts.skills, ...ok },
    },
  };
}

export async function seedLocalCliRelease({ persistTo, repoRoot = REPO_ROOT }) {
  const directory = mkdtempSync(
    path.join(tmpdir(), "openmeld-local-cli-release-")
  );
  const file = path.join(directory, "local-components.json");
  try {
    writeFileSync(
      file,
      `${JSON.stringify(await buildLocalCliRelease(repoRoot), null, 2)}\n`
    );
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "r2",
        "object",
        "put",
        `${readLocalCliReleaseBucket(repoRoot)}/${OBJECT_KEY}`,
        "--file",
        file,
        "--content-type",
        "application/json",
        "--local",
        "--persist-to",
        path.resolve(persistTo),
      ],
      { cwd: path.join(repoRoot, "services/core"), encoding: "utf8" }
    );
    if (result.status !== 0) {
      throw new Error(
        `Seeding the local CLI release failed: ${result.stderr || result.stdout}`
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: { "persist-to": { type: "string" } },
  });
  try {
    if (!values["persist-to"]) {
      throw new Error("--persist-to <wrangler state dir> is required.");
    }
    await seedLocalCliRelease({ persistTo: values["persist-to"] });
    console.log("[dev] Local CLI release published for Core.");
  } catch (error) {
    console.error(
      `[dev] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
