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
  assertCanaryServiceIdentityUnchanged,
  findMatchingUpdateOperation,
  isCoreServiceConnected,
  readProtectedSetupCommand,
  resolveStagingServiceStatus,
  stagingCanaryEnv,
} from "./staging-computer-update-smoke-local.mjs";
import { formatStagingSmokeCleanupMessage } from "./staging-computer-update-smoke-runner.mjs";

const SETUP_DOWNLOAD_SCRIPT = `setup_file=$(mktemp "\${TMPDIR:-/tmp}/openmeld-setup.XXXXXX") || exit 1; trap 'rm -f "$setup_file"' EXIT; curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 10 --speed-limit 1 --speed-time 30 -o "$setup_file" "$1" || exit 1; [ -s "$setup_file" ] || { echo 'OpenMeld setup download was empty.' >&2; exit 1; }; [ "$(tail -n 1 "$setup_file")" = '# openmeld-setup-script-complete-v1' ] || { echo 'OpenMeld setup download was incomplete.' >&2; exit 1; }; shift; sh "$setup_file" "$@" < /dev/null`;
const SETUP_COMMAND_PREFIX = `sh -c '${SETUP_DOWNLOAD_SCRIPT.replaceAll("'", "'\\''")}' sh 'https://staging.openmeld.ai/setup?dist=binary&lane=canary' `;
const SETUP_COMMAND = `${SETUP_COMMAND_PREFIX}setup --start-session start_staging_demo --device-code device_staging_demo --view human`;
const LEGACY_OTT_SETUP_COMMAND = `${SETUP_COMMAND_PREFIX}setup --start-session start_staging_demo --ott ott_staging_demo --view human`;
const SETUP_FILE_REQUIRED_PATTERN = /requires --setup-command-file/u;
const ONLY_ACCEPTS_PATTERN = /only accepts/u;
const OFFICIAL_STAGING_COMMAND_PATTERN =
  /official Staging Canary binary setup command/u;
const SAME_OPERATION_PATTERN = /same background operation/u;
const PRIVATE_FILE_PATTERN = /private file with mode 600/u;
const SERVICE_CHANGED_PATTERN = /changed during a CLI-only update/u;

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
    `${SETUP_COMMAND_PREFIX}setup --start-session [redacted] --device-code [redacted] --view human`
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
  assert.equal(
    env.OPENMELD_CLI_BINARY_MANIFEST_URL,
    "https://staging.openmeld.ai/cli/manifest.json"
  );
  assert.equal(env.OPENMELD_ENV_PRESET, "canary");
  assert.equal(env.OPENMELD_HOME.endsWith("/.openmeld-canary"), true);
});

test("waits for Core rather than treating a local process as connected", () => {
  assert.equal(isCoreServiceConnected(undefined), false);
  assert.equal(
    isCoreServiceConnected({ service: { connected: false } }),
    false
  );
  assert.equal(isCoreServiceConnected({ service: { connected: true } }), true);
});

test("plans the high-value update regression without Production state", () => {
  const plan = buildStagingComputerSmokePlan();
  assert.deepEqual(
    plan.map((step) => step.label),
    [
      "Verify the Staging CLI channel",
      "Connect an isolated Canary Computer",
      "Publish Service B, then split CLI C and D",
      "Run two automatic split updates",
      "Verify CLI targets and retained Service continuity",
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

test("requires the healthy Service process to survive the retained update", () => {
  const identity = {
    pid: 4321,
    processIdentity: "Thu Sep 17 12:00:00 2026 /tmp/openmeld-service-b",
    startedAt: "Thu Sep 17 12:00:00 2026",
  };
  assert.doesNotThrow(() =>
    assertCanaryServiceIdentityUnchanged(identity, { ...identity })
  );
  assert.throws(
    () =>
      assertCanaryServiceIdentityUnchanged(identity, {
        ...identity,
        pid: 4322,
      }),
    SERVICE_CHANGED_PATTERN
  );
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

test("follows the requested update across CLI and Service state files", () => {
  const staleToolsTerminal = {
    operationId: "older-tools-update",
    phase: "updated",
    requestSource: "automatic",
    targetVersion: "0.3.204-staging.previous",
  };
  const serviceTerminal = {
    operationId: "current-update",
    phase: "updated",
    requestSource: "automatic",
    targetVersion: "0.3.205-staging.current",
  };

  assert.deepEqual(
    findMatchingUpdateOperation(
      [staleToolsTerminal, serviceTerminal],
      (operation) => operation.operationId === "current-update"
    ),
    serviceTerminal
  );
  assert.equal(
    findMatchingUpdateOperation(
      [staleToolsTerminal],
      (operation) => operation.operationId === "current-update"
    ),
    null
  );
});
