import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStagingComputerSmokePlan,
  buildStagingSmokeSetupArgs,
  parseStagingComputerSmokeArgs,
  parseStagingWebSetupCommand,
  redactStagingSetupCommand,
} from "./staging-computer-update-smoke.mjs";

const SETUP_COMMAND =
  "curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session start_staging_demo --local-agents all --ott ott_staging_demo --view human";

test("accepts one explicit plan or run command", () => {
  assert.deepEqual(parseStagingComputerSmokeArgs(["plan"]), {
    command: "plan",
  });
  assert.deepEqual(
    parseStagingComputerSmokeArgs([
      "run",
      "--setup-command-file",
      "/tmp/staging-setup.txt",
    ]),
    {
      command: "run",
      setupCommandFile: "/tmp/staging-setup.txt",
    }
  );
  assert.throws(
    () => parseStagingComputerSmokeArgs(["run"]),
    /requires --setup-command-file/u
  );
  assert.throws(
    () =>
      parseStagingComputerSmokeArgs([
        "run",
        "--setup-command-file",
        "/tmp/staging-setup.txt",
        "--production",
      ]),
    /only accepts/u
  );
});

test("accepts only the official staging Canary binary setup handoff", () => {
  const parsed = parseStagingWebSetupCommand(SETUP_COMMAND);
  assert.equal(
    parsed.setupUrl,
    "https://staging.openmeld.ai/setup?dist=binary&lane=canary"
  );
  assert.deepEqual(parsed.setupArgs, [
    "setup",
    "--start-session",
    "start_staging_demo",
    "--local-agents",
    "all",
    "--ott",
    "ott_staging_demo",
    "--view",
    "human",
  ]);

  for (const unsafeCommand of [
    SETUP_COMMAND.replace("staging.openmeld.ai", "openmeld.ai"),
    SETUP_COMMAND.replace("staging.openmeld.ai", "staging.openmeld.invalid"),
    SETUP_COMMAND.replace("dist=binary&", ""),
    `${SETUP_COMMAND}; touch /tmp/openmeld-unsafe`,
  ]) {
    assert.throws(
      () => parseStagingWebSetupCommand(unsafeCommand),
      /official Staging Canary binary setup command/u
    );
  }
});

test("forces the smoke setup to skip Local Agents and run without prompts", () => {
  assert.deepEqual(
    buildStagingSmokeSetupArgs(parseStagingWebSetupCommand(SETUP_COMMAND)),
    [
      "setup",
      "--start-session",
      "start_staging_demo",
      "--local-agents",
      "none",
      "--ott",
      "ott_staging_demo",
      "--view",
      "agent",
    ]
  );
});

test("never prints the one-time setup credentials", () => {
  const redacted = redactStagingSetupCommand(SETUP_COMMAND);
  assert.equal(redacted.includes("start_staging_demo"), false);
  assert.equal(redacted.includes("ott_staging_demo"), false);
  assert.equal(
    redacted,
    "curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session [redacted] --local-agents all --ott [redacted] --view human"
  );
});

test("plans the high-value update regression without Production state", () => {
  const plan = buildStagingComputerSmokePlan();
  assert.deepEqual(plan.map((step) => step.label), [
    "Verify the Staging CLI channel",
    "Connect an isolated Canary Computer",
    "Publish a newer Staging CLI",
    "Start one automatic update",
    "Coalesce a manual Update request",
    "Verify Service recovery and one final version",
    "Restore the previous Canary state",
  ]);
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("~/.openmeld\""), false);
  assert.equal(serialized.includes("https://openmeld.ai"), false);
  assert.equal(serialized.includes("production"), false);
  assert.equal(serialized.includes("https://staging.openmeld.ai"), true);
  assert.equal(serialized.includes("~/.openmeld-canary"), true);
});
