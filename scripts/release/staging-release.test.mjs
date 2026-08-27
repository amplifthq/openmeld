import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStagingDeployStepSpecs,
  buildStagingVerifyStepSpecs,
  parseStagingReleaseArgs,
} from "./staging-release.mjs";

const INVALID_COMMAND_PATTERN = /plan, deploy, or verify/u;

test("accepts only the guarded staging commands", () => {
  assert.deepEqual(parseStagingReleaseArgs(["plan"]), { command: "plan" });
  assert.deepEqual(parseStagingReleaseArgs(["deploy"]), {
    command: "deploy",
  });
  assert.deepEqual(parseStagingReleaseArgs(["verify"]), {
    command: "verify",
  });
  assert.throws(
    () => parseStagingReleaseArgs(["publish"]),
    INVALID_COMMAND_PATTERN
  );
});

test("deploys isolated prerequisites, database, secrets, and Workers in order", () => {
  const steps = buildStagingDeployStepSpecs();
  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Verify staging environment contracts",
      "Check staging secrets",
      "Create staging prerequisites",
      "Create staging Worker identities",
      "Apply staging database migrations",
      "Deploy staging Auth",
      "Deploy staging Web",
      "Deploy staging Gateway",
      "Deploy staging Core",
      "Deploy staging Remote Agent",
      "Verify staging resources",
      "Verify staging user entry points",
    ]
  );
  assert.deepEqual(steps[0], {
    args: ["run", "verify:cloudflare:env-contract"],
    command: "pnpm",
    label: "Verify staging environment contracts",
    mutates: false,
  });

  const commandArguments = steps.flatMap((step) => step.args ?? []);
  assert.equal(commandArguments.includes("staging"), true);
  assert.equal(commandArguments.includes("stg"), true);
  assert.equal(commandArguments.includes("prod"), false);
  assert.equal(
    steps
      .flatMap((step) => step.urls ?? [])
      .every(
        (url) =>
          url.includes(".staging.openmeld.ai") ||
          url.includes("//staging.openmeld.ai")
      ),
    true
  );
});

test("verifies the same staging resources without mutating them", () => {
  const steps = buildStagingVerifyStepSpecs();
  assert.equal(
    steps.some((step) => step.mutates),
    false
  );
  assert.equal(
    steps
      .flatMap((step) => step.urls ?? [])
      .some((url) => url.includes("staging.openmeld.ai")),
    true
  );
});
