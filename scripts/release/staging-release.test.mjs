import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStagingDeployStepSpecs,
  buildStagingVerifyStepSpecs,
  parseStagingReleaseArgs,
} from "./staging-release.mjs";

const INVALID_COMMAND_PATTERN = /plan, deploy, or verify/u;

test("explicitly keeps existing containers only for Remote Agent deployments", () => {
  const input = parseStagingReleaseArgs([
    "deploy",
    "--scope",
    "remote-agent",
    "--containers-rollout=none",
  ]);
  assert.equal(input.skipContainers, true);
  const steps = buildStagingDeployStepSpecs(input);
  const deploy = steps.find((step) =>
    step.label.includes("keep existing containers")
  );
  assert.ok(deploy);
  assert.equal(deploy.args.includes("component:stg"), true);
  assert.equal(
    deploy.args.at(-1),
    "pnpm run sync:secrets:stg && pnpm run deploy:stg --containers-rollout=none"
  );
  assert.equal(
    buildStagingDeployStepSpecs(
      parseStagingReleaseArgs(["plan", "--containers-rollout=none"])
    ).filter((step) => step.label.includes("keep existing containers")).length,
    1
  );
  assert.throws(() =>
    parseStagingReleaseArgs(["verify", "--containers-rollout=none"])
  );
  assert.throws(() =>
    parseStagingReleaseArgs([
      "deploy",
      "--scope",
      "web",
      "--containers-rollout=none",
    ])
  );
  assert.throws(() =>
    parseStagingReleaseArgs(["deploy", "--containers-rollout=immediate"])
  );
});

test("accepts only the guarded staging commands", () => {
  assert.deepEqual(parseStagingReleaseArgs(["plan"]), {
    command: "plan",
    scope: null,
  });
  assert.deepEqual(parseStagingReleaseArgs(["deploy"]), {
    command: "deploy",
    scope: null,
  });
  assert.deepEqual(parseStagingReleaseArgs(["verify"]), {
    command: "verify",
    scope: null,
  });
  assert.deepEqual(parseStagingReleaseArgs(["deploy", "--scope", "web"]), {
    command: "deploy",
    scope: "web",
  });
  assert.deepEqual(
    parseStagingReleaseArgs(["plan", "--scope", "remote-agent"]),
    {
      command: "plan",
      scope: "remote-agent",
    }
  );
  assert.throws(
    () => parseStagingReleaseArgs(["publish"]),
    INVALID_COMMAND_PATTERN
  );
  assert.throws(() => parseStagingReleaseArgs(["verify", "--scope", "web"]));
  assert.throws(() => parseStagingReleaseArgs(["deploy", "--scope", "core"]));
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
      "Deploy staging Core",
      "Deploy staging Gateway",
      "Deploy staging Web",
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

test("deploys one non-database Worker without redeploying unrelated components", () => {
  const webSteps = buildStagingDeployStepSpecs({ scope: "web" });
  assert.deepEqual(
    webSteps.map((step) => step.label),
    [
      "Verify staging environment contracts",
      "Check staging secrets",
      "Verify staging resources",
      "Deploy staging Web",
      "Verify staging resources",
      "Verify staging user entry points",
    ]
  );
  assert.equal(
    webSteps.some((step) => step.label === "Deploy staging Core"),
    false
  );

  const remoteAgentSteps = buildStagingDeployStepSpecs({
    scope: "remote-agent",
  });
  assert.equal(
    remoteAgentSteps.some(
      (step) => step.label === "Deploy staging Remote Agent"
    ),
    true
  );
  assert.equal(
    remoteAgentSteps.some((step) => step.label === "Deploy staging Web"),
    false
  );
});
