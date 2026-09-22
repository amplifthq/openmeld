#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildTrustedGitHubRepositoryUrl,
  createTrustedGitEnvironment,
} from "../ci/trusted-git-network.mjs";
import {
  buildCoreReceiverStepSpecs,
  executeProductionDeploySteps,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import { executeRecordedProductionDeploySteps } from "./production-release-receipts.mjs";
import { inspectProductionScopeLease } from "./production-scope-lease.mjs";

const EXACT_SHA = /^[0-9a-f]{40}$/u;
export async function runHostedCoreReceiver(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const sourceSha = env.RELEASE_SHA;
  if (env.GITHUB_ACTIONS !== "true" || !EXACT_SHA.test(sourceSha ?? "")) {
    throw new Error(
      "Hosted Core receiver requires an exact release source in GitHub Actions."
    );
  }
  const token = env.GH_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  const serverUrl = env.GITHUB_SERVER_URL;
  const releaseEnvironment = { ...env };
  Reflect.deleteProperty(releaseEnvironment, "GH_TOKEN");
  Reflect.deleteProperty(process.env, "GH_TOKEN");
  const gitEnvironment = createTrustedGitEnvironment(releaseEnvironment, {
    authenticate: true,
    repository,
    serverUrl,
    token,
  });
  const remote = buildTrustedGitHubRepositoryUrl({ repository, serverUrl });
  const leaseEnvironment = {
    ...releaseEnvironment,
    OPENMELD_PRODUCTION_LEASE_GITHUB_TOKEN: token,
    OPENMELD_PRODUCTION_LEASE_GITHUB_SERVER_URL: serverUrl,
    OPENMELD_PRODUCTION_LEASE_GITHUB_REPOSITORY: repository,
  };
  const lease = (input.adapters?.inspectLease ?? inspectProductionScopeLease)({
    cwd,
    environment: leaseEnvironment,
    scope: "core",
  });
  const owner = `${serverUrl}/${repository}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  if (
    !lease ||
    lease.leaseSha !== env.CORE_LEASE_SHA ||
    lease.metadata.sourceSha !== sourceSha ||
    lease.metadata.owner !== owner ||
    Date.parse(lease.metadata.expiresAt) <= Date.now()
  ) {
    throw new Error(
      "Hosted Core receiver does not own the exact active Core lease."
    );
  }
  const checkSource = () => {
    const head = readCommand({
      command: "git",
      args: ["rev-parse", "HEAD"],
      cwd,
      env: releaseEnvironment,
    });
    const dirty = readCommand({
      command: "git",
      args: ["status", "--porcelain"],
      cwd,
      env: releaseEnvironment,
    });
    if (
      head.status !== 0 ||
      head.stdout.trim() !== sourceSha ||
      dirty.status !== 0 ||
      dirty.stdout.trim()
    ) {
      throw new Error("Core receiver source must remain exact and clean.");
    }
  };
  checkSource();
  await (
    input.adapters?.executeRecorded ?? executeRecordedProductionDeploySteps
  )({
    cwd,
    sourceSha,
    env: releaseEnvironment,
    steps: buildCoreReceiverStepSpecs(sourceSha),
    executeSteps: executeProductionDeploySteps,
    runCommand: readCommand,
    beforeStep: checkSource,
    afterStep: checkSource,
    readEvidence: (options) =>
      readGuardedLocalReleaseSources({ ...options, remote, gitEnvironment }),
    publishEvidence: (options) =>
      publishGuardedLocalReleaseEvidence({
        ...options,
        remote,
        gitEnvironment,
      }),
  });
}

function readCommand(input) {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.error ? 1 : result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runHostedCoreReceiver().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
