#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildTrustedGitHubRepositoryUrl,
  createTrustedGitEnvironment,
} from "../ci/trusted-git-network.mjs";
import {
  readNpmPublicationReceipt,
  recordNpmPublicationReceipt,
} from "./npm-publication-receipt.mjs";
import { publishCliReleaseTag, runCliRelease } from "./release-cli.mjs";
import { readRemoteTagCommit } from "./release-cli-resume.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export async function runHostedCliRelease(input = {}) {
  const cwd = path.resolve(input.cwd ?? process.cwd());
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
  Reflect.deleteProperty(process.env, "OPENMELD_TRUSTED_GIT_GITHUB_TOKEN");
  Reflect.deleteProperty(process.env, "OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL");
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

  await (input.adapters?.runCliRelease ?? runCliRelease)({
    adapters: {
      ...(input.adapters?.admitTrainArtifacts
        ? { admitTrainArtifacts: input.adapters.admitTrainArtifacts }
        : {}),
      ...(input.adapters?.buildPlan
        ? { buildPlan: input.adapters.buildPlan }
        : {}),
      ...(input.adapters?.checkArtifact
        ? { checkArtifact: input.adapters.checkArtifact }
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
