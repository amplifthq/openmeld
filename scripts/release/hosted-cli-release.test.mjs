import assert from "node:assert/strict";
import test from "node:test";

import { runHostedCliRelease } from "./hosted-cli-release.mjs";

test("removes trusted Git credentials before entering the shared CLI publisher", async () => {
  const calls = [];
  const stageCalls = [];
  const databaseCalls = [];
  let databaseCurrent = true;
  await runHostedCliRelease({
    adapters: {
      readEvidence: () => new Map(),
      executeRecorded: async (input) => {
        await input.readEvidence({});
        await input.beforeStep(input.steps[0]);
      },
      admitProductionStage: async (input) => stageCalls.push(input),
      requireDatabaseCurrent: (input) => {
        databaseCalls.push(input);
        if (!databaseCurrent) {
          return Promise.reject(new Error("PostgreSQL is not deployed"));
        }
        return Promise.resolve({ status: "current" });
      },
      deployCoreWorker: (input) => {
        assert.equal(input.env.GH_TOKEN, undefined);
        assert.equal(input.env.OPENMELD_TRUSTED_GIT_GITHUB_TOKEN, undefined);
        return input.adapters.runStartupAdmission({
          cwd: input.cwd,
          env: input.env,
          releaseSha: "a".repeat(40),
          runCommand: () =>
            assert.fail("Core must not upload before database admission"),
        });
      },
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
  assert.equal(databaseCalls.length, 1);
  assert.equal(databaseCalls[0].hostedCli, true);
  assert.equal(databaseCalls[0].sourceSha, "a".repeat(40));
  assert.equal(databaseCalls[0].env.GH_TOKEN, undefined);
  databaseCurrent = false;
  await assert.rejects(
    calls[0].adapters.deployCore({ cwd: "/release-source", env: calls[0].env }),
    { message: "PostgreSQL is not deployed" }
  );
  assert.equal(databaseCalls.length, 2);
});

test("refuses an unready database before entering the npm publisher", async () => {
  await assert.rejects(
    runHostedCliRelease({
      cwd: "/release-source",
      env: {
        GITHUB_REPOSITORY: "openmeld/openmeld",
        OPENMELD_TRUSTED_GIT_GITHUB_SERVER_URL: "https://github.com",
        OPENMELD_TRUSTED_GIT_GITHUB_TOKEN: "trusted-token",
        RELEASE_SHA: "a".repeat(40),
      },
      adapters: {
        requireDatabaseCurrent: () =>
          Promise.reject(new Error("PostgreSQL is not deployed")),
        runCliRelease: () => assert.fail("npm publication must remain closed"),
      },
    }),
    { message: "PostgreSQL is not deployed" }
  );
});
