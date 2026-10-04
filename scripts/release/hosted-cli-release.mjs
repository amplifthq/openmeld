#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildTrustedGitHubRepositoryUrl,
  createTrustedGitEnvironment,
} from "../ci/trusted-git-network.mjs";
import { runCoreStartupAdmission } from "../cloudflare/core-startup-admission.mjs";
import { assertHostedProductDatabaseReleaseSupported } from "./database-backend-admission.mjs";
import { deployCoreWorker } from "./deploy-core-worker.mjs";
import {
  readNpmPublicationReceipt,
  recordNpmPublicationReceipt,
} from "./npm-publication-receipt.mjs";
import {
  buildProductionDeployStepSpecs,
  executeProductionDeploySteps,
} from "./production-release.mjs";
import {
  publishGuardedLocalReleaseEvidence,
  readGuardedLocalReleaseSources,
} from "./production-release-evidence.mjs";
import {
  describeGuardedReceiptRecoveryCandidate,
  executeRecordedProductionDeploySteps,
} from "./production-release-receipts.mjs";
import {
  admitCliProductionStage,
  publishCliReleaseTag,
  runCliRelease,
} from "./release-cli.mjs";
import {
  readRemoteTagCommit,
  resolveCoreProjectionTag,
} from "./release-cli-resume.mjs";
import { requireProductionDatabaseCurrent } from "./require-production-db-current.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export async function runHostedCliRelease(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  assertHostedProductDatabaseReleaseSupported(cwd, ["cli"]);
  const env = input.env ?? process.env;
  const sourceSha = String(env.RELEASE_SHA ?? "").trim();
  const token = String(env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN ?? "").trim();
  const serverUrl = String(
    env.OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL ?? ""
  ).trim();
  const repository = String(env.GITHUB_REPOSITORY ?? "").trim();
  if (!EXACT_SHA_PATTERN.test(sourceSha)) {
    throw new Error("Hosted CLI release requires an exact RELEASE_SHA.");
  }
  const releaseEnvironment = { ...env };
  Reflect.deleteProperty(
    releaseEnvironment,
    "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN"
  );
  Reflect.deleteProperty(
    releaseEnvironment,
    "OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL"
  );
  Reflect.deleteProperty(releaseEnvironment, "GH_TOKEN");
  Reflect.deleteProperty(process.env, "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN");
  Reflect.deleteProperty(process.env, "OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL");
  Reflect.deleteProperty(process.env, "GH_TOKEN");
  const localGitEnvironment = createTrustedGitEnvironment(releaseEnvironment);
  const authenticatedGitEnvironment = createTrustedGitEnvironment(
    releaseEnvironment,
    {
      authenticate: true,
      repository,
      serverUrl,
      token,
    }
  );
  const remoteUrl = buildTrustedGitHubRepositoryUrl({ repository, serverUrl });
  const readEvidence = (options) =>
    (input.adapters?.readEvidence ?? readGuardedLocalReleaseSources)({
      ...options,
      cwd,
      remote: remoteUrl,
      gitEnvironment: authenticatedGitEnvironment,
    });
  const requireDatabaseCurrent = (probe = {}) =>
    (
      input.adapters?.requireDatabaseCurrent ?? requireProductionDatabaseCurrent
    )({
      readReceipts: () => readEvidence({}),
      ...probe,
      cwd,
      env: releaseEnvironment,
      hostedCli: true,
      sourceSha,
    });
  await requireDatabaseCurrent();
  const deployCore = (coreInput) =>
    deployRecordedHostedCliCore({
      ...coreInput,
      sourceSha,
      requireDatabaseCurrent,
      readEvidence,
      publishEvidence: (options) =>
        (input.adapters?.publishEvidence ?? publishGuardedLocalReleaseEvidence)(
          {
            ...options,
            remote: remoteUrl,
            gitEnvironment: authenticatedGitEnvironment,
          }
        ),
      adapters: input.adapters,
    });
  const retained = await readEvidence({});
  if (describeGuardedReceiptRecoveryCandidate(retained.get("core"))) {
    await deployCore({
      cwd,
      env: releaseEnvironment,
      tag: resolveCoreProjectionTag({ cwd }),
      verifyLocalComponents: true,
    });
    await requireDatabaseCurrent();
  }

  await (input.adapters?.runCliRelease ?? runCliRelease)({
    adapters: {
      deployCore,
      admitProductionStage: (stageInput) =>
        (input.adapters?.admitProductionStage ?? admitCliProductionStage)({
          ...stageInput,
          env: { ...stageInput.env, GH_TOKEN: token },
        }),
      ...(input.adapters?.admitTrainArtifacts
        ? { admitTrainArtifacts: input.adapters.admitTrainArtifacts }
        : {}),
      ...(input.adapters?.buildPlan
        ? { buildPlan: input.adapters.buildPlan }
        : {}),
      ...(input.adapters?.checkArtifact
        ? { checkArtifact: input.adapters.checkArtifact }
        : {}),
      ...(input.adapters?.checkNpmArtifact
        ? { checkNpmArtifact: input.adapters.checkNpmArtifact }
        : {}),
      ...(input.adapters?.readHeadSha
        ? { readHeadSha: input.adapters.readHeadSha }
        : {}),
      readNpmPublicationReceipt: (input) =>
        readNpmPublicationReceipt({
          ...input,
          gitEnvironment: authenticatedGitEnvironment,
          remoteUrl,
        }),
      recordNpmPublicationReceipt: (input) =>
        recordNpmPublicationReceipt({
          ...input,
          gitEnvironment: authenticatedGitEnvironment,
          remoteUrl,
        }),
      publishCliReleaseTag: (input) =>
        publishCliReleaseTag({
          ...input,
          gitEnvironment: authenticatedGitEnvironment,
          localGitEnvironment,
          remoteUrl,
          sourceSha,
        }),
      readRemoteTagCommit: (input) =>
        readRemoteTagCommit({
          ...input,
          gitEnvironment: authenticatedGitEnvironment,
          remoteUrl,
        }),
    },
    cwd,
    env: releaseEnvironment,
    withBinary: true,
  });
}

export async function deployRecordedHostedCliCore(input) {
  const steps = buildProductionDeployStepSpecs(["core"], {
    releaseSha: input.sourceSha,
  });
  const runCommand = input.adapters?.runCommand ?? readCommand;
  let priorCore;
  // The receipt owner writes started before the deployment. Retain only its
  // prior canonical Core identity as this operation's baseline; every database
  // check still reads current DB/Auth evidence and verifies live services.
  const readReceipts = async () => {
    const current = await input.readEvidence({});
    current.set("core", priorCore);
    return current;
  };
  const requireDatabaseCurrent = () =>
    input.requireDatabaseCurrent({ readReceipts });
  await (
    input.adapters?.executeRecorded ?? executeRecordedProductionDeploySteps
  )({
    cwd: input.cwd,
    env: input.env,
    sourceSha: input.sourceSha,
    steps,
    executeSteps: executeProductionDeploySteps,
    runCommand,
    readEvidence: async (options) => {
      const retained = await input.readEvidence(options);
      priorCore = retained.get("core");
      return retained;
    },
    publishEvidence: input.publishEvidence,
    ...(input.adapters?.resolveWorkerTarget
      ? { resolveWorkerTarget: input.adapters.resolveWorkerTarget }
      : {}),
    beforeStep: async (step) => {
      if (step.workerDeploymentArgs) {
        await requireDatabaseCurrent();
      }
    },
    executionAdapters: {
      runCommand,
      runStep: async (step) => {
        if (step.workerDeploymentArgs) {
          return await (input.adapters?.deployCoreWorker ?? deployCoreWorker)({
            cwd: input.cwd,
            env: step.env,
            tag: input.tag,
            verifyLocalComponents: true,
            adapters: {
              runStartupAdmission: (startupInput) =>
                runCoreStartupAdmission({
                  ...startupInput,
                  requireDatabaseCurrent,
                }),
            },
          });
        }
        const result = runCommand(step);
        if (result.status !== 0) {
          throw new Error(
            `Core deployment verification failed: ${result.stderr || result.stdout}`
          );
        }
      },
    },
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
  try {
    await runHostedCliRelease({ cwd: process.argv[2] });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
