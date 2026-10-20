#!/usr/bin/env node

// Pull-request gate for OpenMeld local components (CLI, Service, Skills).
// When a diff touches them it proves the packaged CLI builds and, if the pull
// request bumps the CLI version, that release/local-components-policy.json
// decides every touched component. A diff without a version bump leaves the
// decision to the pull request that releases it; publication refuses a
// changed component without a decision (scripts/release/publish-cli.mjs).
//
//   pnpm run verify:release-ready [-- --base <ref>] [--force]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildPackagedOpenMeldCli } from "./build-packaged-openmeld-cli.mjs";
import {
  collectLocalComponentFacts,
  readBaseReleaseFacts,
  readLocalComponentsPolicy,
  resolveReleaseDecisionErrors,
  resolveTouchedLocalComponents,
} from "./local-components.mjs";
import { readNpmVersion } from "./npm-registry.mjs";

export function parseReleaseReadyArgs(argv) {
  const { values } = parseArgs({
    args: argv.filter((arg) => arg !== "--"),
    options: {
      base: { type: "string" },
      force: { type: "boolean", default: false },
      // Retired: trusted Final Candidate control on main still passes it until
      // this gate's own Final Candidate policy lands. The gate now decides
      // from the published npm version alone.
      "defer-release": { type: "boolean", default: false },
    },
  });
  return { base: values.base ?? null, force: values.force };
}

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10,
  }).trim();
}

export function resolveReleaseReadyBase({ base, env, repoRoot }) {
  if (base) {
    return base;
  }
  if (env.OPENMELD_AFFECTED_BASE) {
    return env.OPENMELD_AFFECTED_BASE;
  }
  return git(repoRoot, ["merge-base", "HEAD", "refs/remotes/origin/main"]);
}

function resolveChangedPaths({ base, repoRoot }) {
  const lines = (args) => git(repoRoot, args).split("\n").filter(Boolean);
  return [
    ...new Set([
      ...lines(["diff", "--name-only", `${base}...HEAD`]),
      ...lines(["diff", "--name-only", "HEAD"]),
      ...lines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ];
}

export async function verifyReleaseReady(input = {}) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const env = input.env ?? process.env;
  const write = input.write ?? ((text) => process.stdout.write(text));
  const options = input.options ?? { base: null, force: false };
  const base = resolveReleaseReadyBase({ base: options.base, env, repoRoot });
  const touched = resolveTouchedLocalComponents(
    (input.resolveChangedPaths ?? resolveChangedPaths)({ base, repoRoot })
  );
  if (touched.length === 0 && !options.force) {
    write(
      `Release-ready gate skipped: no local component changed since ${base}.\n`
    );
    return { status: "skipped", touched };
  }
  (input.buildPackagedCli ?? buildPackagedOpenMeldCli)({ repoRoot, env });
  if (touched.length === 0) {
    write("Packaged CLI built; no local component changed.\n");
    return { status: "built", touched };
  }
  const { version } = JSON.parse(
    readFileSync(join(repoRoot, "clients/openmeld-cli/package.json"), "utf8")
  );
  const published = await (input.readNpmVersion ?? readNpmVersion)(version);
  if (published) {
    write(
      `Release-ready: ${touched.join(", ")} changed; ${version} is already published, so the pull request that releases these changes must bump the CLI version and declare them in release/local-components-policy.json.\n`
    );
    return { status: "deferred", touched };
  }
  const facts = await collectLocalComponentFacts({
    repoRoot,
    requireServiceBundle: true,
  });
  const errors = resolveReleaseDecisionErrors({
    base: await readBaseReleaseFacts({ base, repoRoot }),
    changed: touched,
    facts,
    policy: await readLocalComponentsPolicy(repoRoot),
  });
  if (errors.length > 0) {
    throw new Error(
      [
        `Release-ready gate failed for ${facts.cli.packageVersion}:`,
        ...errors.map((error) => `- ${error}`),
      ].join("\n")
    );
  }
  write(
    `Release-ready: ${facts.cli.packageVersion} declares ${touched.join(", ")}.\n`
  );
  return { status: "declared", touched };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await verifyReleaseReady({
      options: parseReleaseReadyArgs(process.argv.slice(2)),
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
