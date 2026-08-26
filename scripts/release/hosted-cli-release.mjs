#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import {
  buildTrustedGitHubRepositoryUrl,
  createTrustedGitEnvironment,
} from "../ci/trusted-git-network.mjs";
import { publishCliReleaseTag, runCliRelease } from "./release-cli.mjs";
import { readRemoteTagCommit } from "./release-cli-resume.mjs";

const EXACT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

async function main() {
  const cwd = path.resolve(process.argv[2] ?? process.cwd());
  const sourceSha = String(process.env.RELEASE_SHA ?? "").trim();
  const token = String(
    process.env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN ?? ""
  ).trim();
  const serverUrl = String(
    process.env.OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL ?? ""
  ).trim();
  const repository = String(process.env.GITHUB_REPOSITORY ?? "").trim();
  if (!EXACT_SHA_PATTERN.test(sourceSha)) {
    throw new Error("Hosted CLI release requires an exact RELEASE_SHA.");
  }
  const releaseEnvironment = { ...process.env };
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

  await runCliRelease({
    adapters: {
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

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
