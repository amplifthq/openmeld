import assert from "node:assert/strict";
import test from "node:test";

import { runHostedCliRelease } from "./hosted-cli-release.mjs";

test("removes trusted Git credentials before entering the shared CLI publisher", async () => {
  const calls = [];
  const stageCalls = [];
  await runHostedCliRelease({
    adapters: {
      admitProductionStage: async (input) => stageCalls.push(input),
      runCliRelease: async (input) => calls.push(input),
    },
    cwd: "/release-source",
    env: {
      GITHUB_REPOSITORY: "openmeld/openmeld",
      OPENMELD_PRODUCTION_TRAIN_SCOPES: "cli",
      OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL: "https://github.com",
      OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: "trusted-token",
      RELEASE_SHA: "a".repeat(40),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN, undefined);
  assert.equal(calls[0].env.OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL, undefined);
  assert.equal(calls[0].env.GH_TOKEN, undefined);
  assert.equal(calls[0].env.OPENMELD_PRODUCTION_TRAIN_SCOPES, "cli");
  assert.equal(calls[0].env.RELEASE_SHA, "a".repeat(40));
  await calls[0].adapters.admitProductionStage({
    cwd: "/release-source",
    env: calls[0].env,
    sourceSha: "a".repeat(40),
  });
  assert.equal(stageCalls.length, 1);
  assert.equal(stageCalls[0].env.GH_TOKEN, "trusted-token");
  assert.equal(stageCalls[0].env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN, undefined);
});
