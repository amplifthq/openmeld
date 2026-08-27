import assert from "node:assert/strict";
import test from "node:test";

import {
  collectSecretValuesFromEnvironment,
  parseSyncWorkerSecretsArgs,
} from "./sync-worker-secrets.mjs";

const MISSING_SECRET_PATTERN =
  /Missing required secrets in the environment: SECOND_SECRET/u;
const AMBIGUOUS_SECRET_SOURCE_PATTERN = /Choose exactly one secret source/u;

test("reads staging Worker secrets from the injected environment", () => {
  assert.deepEqual(
    parseSyncWorkerSecretsArgs([
      "--env",
      "stg",
      "--from-env",
      "FIRST_SECRET",
      "SECOND_SECRET",
    ]),
    {
      envName: "stg",
      filePath: null,
      fromEnvironment: true,
      secretNames: ["FIRST_SECRET", "SECOND_SECRET"],
    }
  );

  assert.deepEqual(
    collectSecretValuesFromEnvironment(["FIRST_SECRET", "SECOND_SECRET"], {
      FIRST_SECRET: "first-value",
      SECOND_SECRET: "second-value",
    }),
    ['FIRST_SECRET="first-value"', 'SECOND_SECRET="second-value"']
  );
});

test("fails closed when one injected secret is missing", () => {
  assert.throws(
    () =>
      collectSecretValuesFromEnvironment(["FIRST_SECRET", "SECOND_SECRET"], {
        FIRST_SECRET: "first-value",
      }),
    MISSING_SECRET_PATTERN
  );
});

test("does not allow file and environment secret sources together", () => {
  assert.throws(
    () =>
      parseSyncWorkerSecretsArgs([
        "--env",
        "stg",
        "--file",
        ".dev.vars.prod",
        "--from-env",
        "SECRET",
      ]),
    AMBIGUOUS_SECRET_SOURCE_PATTERN
  );
});
