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

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function deployCoreWorker(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const adapters = {
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

  adapters.runStep({
    args: ["--dir", "services/core", "run", "build:workspace-dependencies"],
    command: "pnpm",
    label: "Build Core receiver dependencies",
  });
  adapters.runStep(buildCoreBundleEvidenceStepSpec());
  const evidence = adapters.runStartupAdmission({
    cwd,
    env,
    releaseSha,
    tag: input.tag,
  });
  const releaseSteps = buildCoreVersionReleaseStepSpecs({
    versionId: evidence.versionId,
    wranglerConfigSource: adapters.readCoreWranglerConfig(),
  });
  for (const step of releaseSteps) {
    adapters.runStep(step);
  }
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
    if (argument === "--release-sha") {
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
  deployCoreWorker(parseArguments(process.argv.slice(2)));
}
