import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCoreVersionReleaseStepSpecs,
  validateCoreVersionReleaseConfig,
} from "./core-version-deployment.mjs";

const VERSION_ID = "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3";
const EXACT_VERSION_ID_RE = /exact Cloudflare version ID/u;
const NON_VERSIONED_SETTINGS_RE = /logpush, tail_consumers/u;

test("deploys the exact admitted Core version before synchronizing triggers", () => {
  const steps = buildCoreVersionReleaseStepSpecs({
    versionId: VERSION_ID,
    wranglerConfigSource: '{ "triggers": { "crons": ["* * * * *"] } }',
  });

  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0], {
    args: [
      "--dir",
      "services/core",
      "exec",
      "dotenv",
      "-e",
      "../../.env",
      "-o",
      "--",
      "wrangler",
      "versions",
      "deploy",
      `${VERSION_ID}@100%`,
      "--env",
      "prod",
      "--yes",
    ],
    command: "pnpm",
    label: "Deploy the startup-admitted Core version",
  });
  assert.deepEqual(steps[1], {
    args: [
      "--dir",
      "services/core",
      "exec",
      "dotenv",
      "-e",
      "../../.env",
      "-o",
      "--",
      "wrangler",
      "triggers",
      "deploy",
      "--env",
      "prod",
    ],
    command: "pnpm",
    label: "Synchronize Core triggers",
  });
});

test("rejects non-versioned Core settings that require an ordinary rebuild", () => {
  assert.throws(
    () =>
      validateCoreVersionReleaseConfig(
        '{ "logpush": true, "tail_consumers": [{ "service": "logs" }] }'
      ),
    NON_VERSIONED_SETTINGS_RE
  );
});

test("rejects an invalid Cloudflare version identifier", () => {
  assert.throws(
    () =>
      buildCoreVersionReleaseStepSpecs({
        versionId: "latest",
        wranglerConfigSource: "{}",
      }),
    EXACT_VERSION_ID_RE
  );
});
