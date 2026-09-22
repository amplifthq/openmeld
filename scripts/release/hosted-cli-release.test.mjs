import assert from "node:assert/strict";
import test from "node:test";

import { runHostedCliRelease } from "./hosted-cli-release.mjs";

test("removes trusted Git credentials before entering the shared CLI publisher", async () => {
  const calls = [];
  await runHostedCliRelease({
    adapters: {
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
  assert.equal(calls[0].env.OPENMELD_PRODUCTION_TRAIN_SCOPES, "cli");
  assert.equal(calls[0].env.RELEASE_SHA, "a".repeat(40));
});
