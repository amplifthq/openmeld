#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createTrustedGitEnvironment } from "../ci/trusted-git-network.mjs";
import {
  buildCoreCurrentCliProjectionPreflightStepSpecs,
  buildProductionPreflightStepSpecs,
  expandRequestedReleaseScopes,
} from "./production-release.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const HOSTED_WORKER_SCOPES = new Set([
  "auth",
  "core",
  "gateway",
  "remote-agent",
  "web",
]);

export async function runHostedProductionPreflight(input) {
  const controlRoot = realpathSync(
    input.controlRoot ?? path.resolve(import.meta.dirname, "../..")
  );
  const releaseSource = realpathSync(input.releaseSource);
  const releaseSha = String(input.releaseSha ?? "").trim();
  if (!EXACT_SHA_PATTERN.test(releaseSha)) {
    throw new Error(
      "Hosted production preflight requires an exact release SHA."
    );
  }
  if (!existsSync(path.join(releaseSource, ".git"))) {
    throw new Error(
      `Hosted production preflight release source is not a Git checkout: ${releaseSource}`
    );
  }
  const actualHead = readReleaseSourceHead(releaseSource);
  if (actualHead !== releaseSha) {
    throw new Error(
      `Hosted production preflight source mismatch: expected ${releaseSha}, found ${actualHead}.`
    );
  }

  const scopes = expandRequestedReleaseScopes(input.scope);
  if (!scopes || scopes.length !== 1 || !HOSTED_WORKER_SCOPES.has(scopes[0])) {
    throw new Error(
      "Hosted production preflight requires exactly one Worker release scope."
    );
  }
  const steps = input.currentStableCliProjection
    ? buildCoreCurrentCliProjectionPreflightStepSpecs([])
    : buildProductionPreflightStepSpecs({ changedPaths: [], scopes });
  const runControlStep =
    input.adapters?.runControlStep ?? defaultRunControlStep;

  process.stdout.write(
    [
      "Hosted production preflight",
      `Control root: ${controlRoot}`,
      `Release source: ${releaseSource}`,
      `Release SHA: ${releaseSha}`,
      `Scope: ${scopes[0]}`,
      "",
    ].join("\n")
  );
  for (const step of steps) {
    if (!step.controlPath) {
      throw new Error(
        `Hosted production preflight step has no trusted control path: ${step.label}`
      );
    }
    await runControlStep(step, { controlRoot, releaseSource });
  }
}

function readReleaseSourceHead(releaseSource) {
  const result = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: releaseSource,
    encoding: "utf8",
    env: createTrustedGitEnvironment(process.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Hosted production preflight could not read the release source: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return result.stdout.trim();
}

function defaultRunControlStep(step, context) {
  const controlPath = realpathSync(
    path.join(context.controlRoot, step.controlPath)
  );
  const args = [
    ...(step.controlNodeArgs ?? []),
    controlPath,
    ...(step.controlArgs ?? []),
  ];
  process.stdout.write(`\n[hosted-production-preflight] ${step.label}\n`);
  const result = spawnSync(step.controlCommand, args, {
    cwd: context.releaseSource,
    env: {
      ...process.env,
      OPENMELD_VERIFICATION_ROOT: context.releaseSource,
    },
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${step.controlCommand} ${args.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

function parseOptions(argv) {
  const options = { currentStableCliProjection: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--current-stable-cli-projection") {
      options.currentStableCliProjection = true;
      continue;
    }
    if (
      argument !== "--release-source" &&
      argument !== "--release-sha" &&
      argument !== "--scope"
    ) {
      throw new Error(
        `Unknown hosted production preflight option: ${argument}`
      );
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    if (argument === "--release-source") {
      options.releaseSource = value;
    } else if (argument === "--release-sha") {
      options.releaseSha = value;
    } else {
      options.scope = value;
    }
    index += 1;
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runHostedProductionPreflight(parseOptions(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
