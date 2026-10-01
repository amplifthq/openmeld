#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildCoreBundleEvidenceStepSpec,
  runCoreStartupAdmission,
} from "../cloudflare/core-startup-admission.mjs";
import { buildCoreVersionReleaseStepSpecs } from "../cloudflare/core-version-deployment.mjs";
import { resolveCoreProjectionTag } from "./release-cli-resume.mjs";
import {
  readLocalComponentsAvailabilityCatalog,
  describeLocalComponentsAvailabilityCatalog,
} from "./local-components-availability.mjs";
import { recordCoreDeploymentOutput } from "./worker-deployment-evidence.mjs";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export async function deployCoreWorker(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const env = {
    ...(input.env ?? process.env),
    ...(input.verifyLocalComponents
      ? { OPENMELD_RELEASE_CHANNEL_SYNC_CHECK: "1" }
      : {}),
  };
  const adapters = {
    readReleaseManifest: input.adapters?.readReleaseManifest ??
      (() => JSON.parse(readFileSync(path.join(cwd, "release/local-components.json"), "utf8"))),
    readAvailabilityCatalog: input.adapters?.readAvailabilityCatalog ?? readLocalComponentsAvailabilityCatalog,
    readCoreWranglerConfig:
      input.adapters?.readCoreWranglerConfig ??
      (() =>
        readFileSync(path.join(cwd, "services/core/wrangler.jsonc"), "utf8")),
    readHeadSha:
      input.adapters?.readHeadSha ??
      (() =>
        execFileSync(resolveCommandBinary("git"), ["rev-parse", "HEAD"], {
          cwd,
          encoding: "utf8",
        }).trim()),
    runStartupAdmission:
      input.adapters?.runStartupAdmission ?? runCoreStartupAdmission,
    runStep:
      input.adapters?.runStep ?? ((step) => runStep({ ...step, cwd, env })),
  };
  const headSha = adapters.readHeadSha();
  const releaseSha = input.releaseSha ?? headSha;
  if (!FULL_COMMIT_SHA_PATTERN.test(releaseSha)) {
    throw new Error("Core deploy requires an exact release SHA");
  }
  if (releaseSha !== headSha) {
    throw new Error(
      `Core deploy release SHA ${releaseSha} does not match checked-out HEAD ${headSha}`
    );
  }

  if (input.verifyLocalComponents) {
    adapters.runStep({
      args: ["run", "deploy:release-ready"],
      command: "pnpm",
      label: "Verify published local-components channel alignment",
    });
  }
  adapters.runStep({
    args: ["--dir", "services/core", "run", "build:workspace-dependencies"],
    command: "pnpm",
    label: "Build Core receiver dependencies",
  });
  adapters.runStep(buildCoreBundleEvidenceStepSpec());
  const projectionTag =
    input.tag ??
    (env.OPENMELD_RELEASE_RECEIPT_CONTEXT
      ? resolveCoreProjectionTag({ cwd })
      : undefined);
  const catalog = await adapters.readAvailabilityCatalog({
    releaseManifest: adapters.readReleaseManifest(),
  });
  const availability = describeLocalComponentsAvailabilityCatalog(catalog);
  process.stdout.write(`[production-release] availabilityCatalogSha256=${availability.sha256}\n`);
  const evidence = await adapters.runStartupAdmission({
    cwd,
    defines: [availability.define],
    env,
    releaseSha,
    tag: projectionTag,
  });
  const releaseSteps = buildCoreVersionReleaseStepSpecs({
    trafficPercent: evidence.trafficPercent,
    versionId: evidence.versionId,
    wranglerConfigSource: adapters.readCoreWranglerConfig(),
  });
  for (const step of releaseSteps) {
    adapters.runStep(step);
  }
  recordCoreDeploymentOutput({
    env,
    sourceSha: releaseSha,
    evidence,
    projectionTag,
  });
}

function runStep(input) {
  process.stdout.write(`\n[production-release] ${input.label}\n`);
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
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

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  if (command === "git") {
    return "git.exe";
  }
  if (command === "pnpm") {
    return "pnpm.cmd";
  }
  return command;
}

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    const value = argumentsList[index + 1];
    if (argument === "--verify-local-components") {
      options.verifyLocalComponents = true;
    } else if (argument === "--release-sha") {
      options.releaseSha = requireArgumentValue(argument, value);
      index += 1;
    } else if (argument === "--tag") {
      options.tag = requireArgumentValue(argument, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

function requireArgumentValue(argument, value) {
  if (!(value && !value.startsWith("--"))) {
    throw new Error(`${argument} requires a value`);
  }
  return value;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  deployCoreWorker(parseArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
