import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCoalescedStagingUpdate,
  buildStagingComputerSmokePlan,
  buildStagingSmokeSetupArgs,
  parseStagingComputerSmokeArgs,
  parseStagingWebSetupCommand,
  redactStagingSetupCommand,
} from "./staging-computer-update-smoke-contract.mjs";
import {
  readProtectedSetupCommand,
  resolveStagingServiceStatus,
  stagingCanaryEnv,
} from "./staging-computer-update-smoke-local.mjs";
import { formatStagingSmokeCleanupMessage } from "./staging-computer-update-smoke-runner.mjs";

const SETUP_COMMAND =
  "curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session start_staging_demo --device-code device_staging_demo --view human";
const LEGACY_OTT_SETUP_COMMAND =
  "curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session start_staging_demo --ott ott_staging_demo --view human";
const SETUP_FILE_REQUIRED_PATTERN = /requires --setup-command-file/u;
const ONLY_ACCEPTS_PATTERN = /only accepts/u;
const OFFICIAL_STAGING_COMMAND_PATTERN =
  /official Staging Canary binary setup command/u;
const SAME_OPERATION_PATTERN = /same background operation/u;
const PRIVATE_FILE_PATTERN = /private file with mode 600/u;

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
    SETUP_FILE_REQUIRED_PATTERN
  );
  assert.throws(
    () =>
      parseStagingComputerSmokeArgs([
        "run",
        "--setup-command-file",
        "/tmp/staging-setup.txt",
        "--production",
      ]),
    ONLY_ACCEPTS_PATTERN
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
    "--device-code",
    "device_staging_demo",
    "--view",
    "human",
  ]);

  for (const unsafeCommand of [
    SETUP_COMMAND.replace("staging.openmeld.ai", "openmeld.ai"),
    SETUP_COMMAND.replace("staging.openmeld.ai", "staging.openmeld.invalid"),
    SETUP_COMMAND.replace("dist=binary&", ""),
    SETUP_COMMAND.replace(
      "--device-code device_staging_demo",
      "--device-code device_staging_demo --ott ott_staging_demo"
    ),
    `${SETUP_COMMAND}; touch /tmp/openmeld-unsafe`,
  ]) {
    assert.throws(
      () => parseStagingWebSetupCommand(unsafeCommand),
      OFFICIAL_STAGING_COMMAND_PATTERN
    );
  }
});

test("keeps compatibility with older Staging OTT handoffs", () => {
  assert.deepEqual(
    buildStagingSmokeSetupArgs(
      parseStagingWebSetupCommand(LEGACY_OTT_SETUP_COMMAND)
    ),
    [
      "setup",
      "--start-session",
      "start_staging_demo",
      "--ott",
      "ott_staging_demo",
      "--view",
      "agent",
    ]
  );
});

test("lets setup select healthy Local Agents and runs without prompts", () => {
  assert.deepEqual(
    buildStagingSmokeSetupArgs(parseStagingWebSetupCommand(SETUP_COMMAND)),
    [
      "setup",
      "--start-session",
      "start_staging_demo",
      "--device-code",
      "device_staging_demo",
      "--view",
      "agent",
    ]
  );
});

test("keeps the real smoke failure visible when cleanup also fails", () => {
  assert.equal(
    formatStagingSmokeCleanupMessage({
      runFailure: new Error("Canary Service did not start."),
      runRoot: "/tmp/staging-smoke-evidence",
    }),
    "Staging smoke failed: Canary Service did not start. Cleanup also needs help. Preserved files remain at /tmp/staging-smoke-evidence."
  );
});

test("reads the running Service from the real daemon status envelope", () => {
  assert.deepEqual(
    resolveStagingServiceStatus({
      cliVersion: {
        currentVersion: "0.3.122-staging.example",
      },
      localResult: {
        installed: true,
        runtime: {
          status: "running",
        },
        state: {
          daemonVersion: "0.3.122-staging.example",
        },
      },
      result: {
        runtime: {
          status: "running",
        },
      },
      schemaVersion: 1,
      type: "daemon.status",
    }),
    {
      runtimeStatus: "running",
      serviceVersion: "0.3.122-staging.example",
    }
  );
});

test("never prints the one-time setup credentials", () => {
  const redacted = redactStagingSetupCommand(SETUP_COMMAND);
  assert.equal(redacted.includes("start_staging_demo"), false);
  assert.equal(redacted.includes("device_staging_demo"), false);
  assert.equal(
    redacted,
    "curl -fsSL 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' | sh -s -- setup --start-session [redacted] --device-code [redacted] --view human"
  );
});

test("reads setup credentials only from a private mode-600 file", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "openmeld-staging-smoke-")
  );
  const setupFile = path.join(directory, "setup.txt");
  try {
    await writeFile(setupFile, SETUP_COMMAND, { mode: 0o600 });
    assert.equal(await readProtectedSetupCommand(setupFile), SETUP_COMMAND);

    await chmod(setupFile, 0o644);
    await assert.rejects(
      readProtectedSetupCommand(setupFile),
      PRIVATE_FILE_PATTERN
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps the isolated smoke credential readable by its source API helper", () => {
  const env = stagingCanaryEnv();
  assert.equal(env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN, "1");
  assert.equal(env.OPENMELD_ENV_PRESET, "canary");
  assert.equal(env.OPENMELD_HOME.endsWith("/.openmeld-canary"), true);
});

test("plans the high-value update regression without Production state", () => {
  const plan = buildStagingComputerSmokePlan();
  assert.deepEqual(
    plan.map((step) => step.label),
    [
      "Verify the Staging CLI channel",
      "Connect an isolated Canary Computer",
      "Publish a newer Staging CLI",
      "Start one automatic update",
      "Coalesce a manual Update request",
      "Verify Service recovery and one final version",
      "Restore the previous Canary state",
    ]
  );
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes('~/.openmeld"'), false);
  assert.equal(serialized.includes("https://openmeld.ai"), false);
  assert.equal(serialized.includes("production"), false);
  assert.equal(serialized.includes("https://staging.openmeld.ai"), true);
  assert.equal(serialized.includes("~/.openmeld-canary"), true);
});

test("requires automatic and manual requests to share one operation", () => {
  assert.equal(
    assertCoalescedStagingUpdate({
      automaticOperation: {
        operationId: "update-one",
        requestSource: "automatic",
      },
      manualResult: {
        operation: { operationId: "update-one" },
        status: "already_running",
      },
    }),
    "update-one"
  );
  assert.throws(
    () =>
      assertCoalescedStagingUpdate({
        automaticOperation: {
          operationId: "automatic-update",
          requestSource: "automatic",
        },
        manualResult: {
          operation: { operationId: "manual-update" },
          status: "started",
        },
      }),
    SAME_OPERATION_PATTERN
  );
});
