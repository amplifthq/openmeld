#!/usr/bin/env node

// Core's production build/deploy step for scripts/release/deploy-component.mjs.
// Core uploads a version first so Cloudflare measures startup and applies any
// Durable Object migration atomically, then moves 100% of traffic to it. The
// version carries RELEASE_SHA; the CLI release manifest is read at runtime.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  buildCoreBundleEvidenceStepSpec,
  runCoreStartupAdmission,
} from "../cloudflare/core-startup-admission.mjs";
import { buildCoreVersionReleaseStepSpecs } from "../cloudflare/core-version-deployment.mjs";
import { cutoverConfigArgs } from "./postgresql-cutover-config.mjs";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export async function deployCoreWorker(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const adapters = {
    readCoreWranglerConfig: () =>
      readFileSync(path.join(cwd, "services/core/wrangler.jsonc"), "utf8"),
    readHeadSha: () =>
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf8",
      }).trim(),
    runStartupAdmission: runCoreStartupAdmission,
    runStep: (step) => runStep({ ...step, cwd, env }),
    ...input.adapters,
  };
  const releaseSha = input.releaseSha;
  if (!FULL_COMMIT_SHA_PATTERN.test(releaseSha ?? "")) {
    throw new Error(
      "Core deploy requires --release-sha with an exact commit SHA."
    );
  }
  const headSha = adapters.readHeadSha();
  if (releaseSha !== headSha) {
    throw new Error(
      `Core deploy release SHA ${releaseSha} does not match checked-out HEAD ${headSha}.`
    );
  }
  adapters.runStep({
    args: ["--dir", "services/core", "run", "build:workspace-dependencies"],
    command: "pnpm",
    label: "Build Core dependencies",
  });
  adapters.runStep(buildCoreBundleEvidenceStepSpec());
  const evidence = await adapters.runStartupAdmission({ cwd, env, releaseSha });
  for (const step of buildCoreVersionReleaseStepSpecs({
    configArgs: cutoverConfigArgs("core", { cwd, env }),
    trafficPercent: evidence.trafficPercent,
    versionId: evidence.versionId,
    wranglerConfigSource: adapters.readCoreWranglerConfig(),
  })) {
    adapters.runStep(step);
  }
  return evidence;
}

function runStep(input) {
  process.stdout.write(`\n[core] ${input.label}\n`);
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const { values } = parseArgs({
    options: { "release-sha": { type: "string" } },
  });
  deployCoreWorker({ releaseSha: values["release-sha"] }).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
