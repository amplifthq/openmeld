import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  CLI_COMMAND_TEMPLATES,
  OBSERVABILITY_TOKENS,
  PRECHECK_COMMANDS,
  REQUIRED_ENV_VARS,
  TEST_ONLY,
} from "../verify-real-dogfooding.mjs";

const INVALID_HISTORY_LIMIT_RE =
  /invalid positive integer for OPENMELD_DOGFOODING_DELIVERY_STABILITY_HISTORY_LIMIT: "abc"/;
const MISSING_DISPATCH_CORRELATION_RE =
  /dispatch correlation failed: reply signal missing/;
const PLACEHOLDER_CORRELATION_RE =
  /dispatch correlation failed: placeholder token detected/;
const STRICT_TASK_MATCH_RE =
  /runtime log correlation failed: no strict task match/;
const TERMINAL_DISPATCH_STATUS_RE =
  /dispatch reached terminal state before reply correlation/;
const WAIT_TIMEOUT_RE = /retry-timeout timed out after/;

test("delivery stability rate parser accepts decimal and percent input", () => {
  assert.equal(
    TEST_ONLY.parseDeliveryStabilityRate("", 0.05, "delivery stability"),
    0.05
  );
  assert.equal(
    TEST_ONLY.parseDeliveryStabilityRate("0.5", 0.05, "delivery stability"),
    0.5
  );
  assert.equal(
    TEST_ONLY.parseDeliveryStabilityRate("5%", 0.05, "delivery stability"),
    0.05
  );
});

test("delivery stability gate evaluation returns pass/fail reasons", () => {
  const pass = TEST_ONLY.evaluateDeliveryStabilityGate({
    metrics: {
      failedTerminalRate: 0.01,
      coldStartTimeoutRate: 0.02,
      dispatchingTimeoutCount: 0,
      dedupedRatio: 0.1,
    },
    limits: {
      failedTerminalRateLimit: 0.03,
      coldStartTimeoutRateLimit: 0.05,
      dispatchingTimeoutCountLimit: 2,
      dedupedRatioLimit: 0.5,
    },
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.reasons.length, 0);

  const fail = TEST_ONLY.evaluateDeliveryStabilityGate({
    metrics: {
      failedTerminalRate: 0.04,
      coldStartTimeoutRate: 0.05,
      dispatchingTimeoutCount: 3,
      dedupedRatio: 0.6,
    },
    dedupedRatioBaseline: 0.2,
    limits: {
      failedTerminalRateLimit: 0.03,
      coldStartTimeoutRateLimit: 0.05,
      dispatchingTimeoutCountLimit: 2,
      dedupedRatioLimit: 0.5,
      dedupedRatioSpikeMultiplier: 2,
      dedupedRatioFallbackLimit: 0,
    },
  });
  assert.equal(fail.ok, false);
  assert.equal(
    fail.reasons.some((reason) => reason.startsWith("failed_terminal_rate")),
    true
  );
  assert.equal(
    fail.reasons.some((reason) =>
      reason.startsWith("dispatching_timeout_count")
    ),
    true
  );
  assert.equal(
    fail.reasons.some((reason) => reason.startsWith("deduped_ratio")),
    true
  );
});

test("verify-real-dogfooding keeps required env contract", () => {
  assert.deepEqual(REQUIRED_ENV_VARS, [
    "OPENMELD_DOGFOODING_SPACE_ID",
    "OPENMELD_DAEMON_RUNTIME_LOG_PATH",
  ]);
});

test("verify-real-dogfooding keeps default correlation tuning", () => {
  assert.equal(TEST_ONLY.DEFAULT_CORRELATION_TIMEOUT_MS, 300_000);
  assert.equal(TEST_ONLY.DEFAULT_CORRELATION_POLL_MS, 1000);
});

test("verify-real-dogfooding keeps deterministic precheck command matrix", () => {
  assert.deepEqual(PRECHECK_COMMANDS, [
    {
      command: "pnpm",
      args: ["check"],
      label: "workspace check",
      skipEnvVar: "OPENMELD_DOGFOODING_SKIP_WORKSPACE_CHECK",
    },
    {
      command: "pnpm",
      args: ["build"],
      label: "workspace build",
    },
    {
      command: "pnpm",
      args: [
        "--filter",
        "@openmeld/local-execution",
        "run",
        "test:runtime:observability-proof",
      ],
      label: "runtime observability proof",
    },
  ]);
});

test("verify-real-dogfooding keeps observability token assertions", () => {
  assert.deepEqual(OBSERVABILITY_TOKENS, [
    "health_reason",
    "heartbeat_sent_count",
    "reconnect_success_rate",
    "suspect_transition_rate",
  ]);
});

test("verify-real-dogfooding keeps core CLI command templates", () => {
  assert.deepEqual(CLI_COMMAND_TEMPLATES, [
    {
      label: "service status",
      args: ["service", "status", "--view", "agent"],
    },
    {
      label: "service install",
      args: ["service", "install", "--view", "agent"],
    },
    {
      label: "space send trigger",
      args: [
        "space",
        "send",
        "<space-id>",
        "[delivery-trace] <marker> @<target-profile>",
        "--profile",
        "<sender-profile>",
        "--view",
        "agent",
      ],
    },
    {
      label: "space history",
      args: [
        "space",
        "history",
        "<space-id>",
        "--limit",
        "<history-limit>",
        "--json",
        "--profile",
        "<sender-profile>",
        "--view",
        "agent",
      ],
    },
  ]);
});

test("dispatch correlation ignores events without target profile id", () => {
  const sourceEventId = "evt-source-1";
  const rawHistory = [
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: sourceEventId,
        type: "signal.text",
        profile: { profileId: "sender-1" },
        data: { text: "[delivery-trace] marker @target-1" },
      },
    }),
    JSON.stringify({
      code: "tail.signal",
      payload: {
        type: "signal.text",
        data: {
          text: `reply-to:${sourceEventId} dispatch:dispatch-1 task:task-1\nruntime-output`,
        },
      },
    }),
  ].join("\n");

  const correlation = TEST_ONLY.buildDispatchCorrelation(
    rawHistory,
    sourceEventId,
    "sender-1",
    "target-1"
  );

  assert.equal(correlation.fromSender, true);
  assert.equal(correlation.fromTarget, false);
  assert.equal(correlation.replyText, "");
});

test("dispatch correlation extracts dispatch/task metadata and runtime body", () => {
  const sourceEventId = "evt-source-2";
  const rawHistory = [
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: sourceEventId,
        type: "signal.text",
        profile: { profileId: "sender-1" },
        data: { text: "[delivery-trace] marker @target-1" },
      },
    }),
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: "evt-reply-1",
        type: "signal.text",
        profile: { profileId: "target-1" },
        data: {
          text: `reply-to:${sourceEventId} dispatch:dispatch-2 task:task-2\nhello from runtime`,
        },
      },
    }),
  ].join("\n");

  const correlation = TEST_ONLY.buildDispatchCorrelation(
    rawHistory,
    sourceEventId,
    "sender-1",
    "target-1"
  );

  assert.equal(correlation.fromSender, true);
  assert.equal(correlation.fromTarget, true);
  assert.equal(correlation.replyEventId, "evt-reply-1");
  assert.equal(correlation.dispatchId, "dispatch-2");
  assert.equal(correlation.taskId, "task-2");
  assert.equal(correlation.runtimeOutputText, "hello from runtime");
  assert.equal(correlation.containsPlaceholder, false);
});

test("dispatch correlation accepts plain runtime reply without metadata tokens", () => {
  const sourceEventId = "evt-source-plain";
  const rawHistory = [
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: sourceEventId,
        type: "signal.text",
        ts: 10,
        profile: { profileId: "sender-1" },
        data: { text: "[delivery-trace] marker @target-1" },
      },
    }),
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: "evt-reply-plain",
        type: "signal.text",
        ts: 11,
        profile: { profileId: "target-1" },
        data: {
          text: "hello from plain runtime output",
        },
      },
    }),
  ].join("\n");

  const correlation = TEST_ONLY.buildDispatchCorrelation(
    rawHistory,
    sourceEventId,
    "sender-1",
    "target-1"
  );

  assert.equal(correlation.fromSender, true);
  assert.equal(correlation.fromTarget, true);
  assert.equal(correlation.dispatchId, "");
  assert.equal(correlation.taskId, "");
  assert.equal(
    correlation.runtimeOutputText,
    "hello from plain runtime output"
  );
});

test("assertDispatchCorrelation throws when target signal is missing", () => {
  const sourceEventId = "evt-source-3";
  const rawHistory = JSON.stringify({
    code: "tail.signal",
    payload: {
      id: sourceEventId,
      type: "signal.text",
      profile: { profileId: "sender-1" },
      data: { text: "[delivery-trace] marker @target-1" },
    },
  });

  assert.throws(
    () =>
      TEST_ONLY.assertDispatchCorrelation(
        rawHistory,
        sourceEventId,
        "sender-1",
        "target-1"
      ),
    MISSING_DISPATCH_CORRELATION_RE
  );
});

test("assertDispatchCorrelation rejects placeholder reply text", () => {
  const sourceEventId = "evt-source-4";
  const rawHistory = [
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: sourceEventId,
        type: "signal.text",
        profile: { profileId: "sender-1" },
        data: { text: "[delivery-trace] marker @target-1" },
      },
    }),
    JSON.stringify({
      code: "tail.signal",
      payload: {
        id: "evt-reply-2",
        type: "signal.text",
        profile: { profileId: "target-1" },
        data: {
          text: `[local-execution-auto-reply] reply-to:${sourceEventId} dispatch:dispatch-3 task:task-3`,
        },
      },
    }),
  ].join("\n");

  assert.throws(
    () =>
      TEST_ONLY.assertDispatchCorrelation(
        rawHistory,
        sourceEventId,
        "sender-1",
        "target-1"
      ),
    PLACEHOLDER_CORRELATION_RE
  );
});

test("extractReplyMetadata parses dispatch/task tokens", () => {
  assert.deepEqual(
    TEST_ONLY.extractReplyMetadata(
      "reply-to:evt dispatch:dispatch-4 task:task-4"
    ),
    {
      dispatchId: "dispatch-4",
      taskId: "task-4",
    }
  );
});

test("readRuntimeLogCorrelation uses latest matching runtime output", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "delivery-stability-runtime-")
  );
  const logPath = path.join(tempDir, "runtime.ndjson");
  await writeFile(
    logPath,
    [
      JSON.stringify({
        dispatchId: "dispatch-5",
        taskId: "task-5",
        phase: "start",
      }),
      JSON.stringify({
        dispatchId: "dispatch-5",
        taskId: "task-5",
        output: "latest-runtime-output-marker-1234567890",
      }),
    ].join("\n"),
    "utf8"
  );
  try {
    const correlation = TEST_ONLY.readRuntimeLogCorrelation({
      runtimeLogPath: logPath,
      dispatchId: "dispatch-5",
      taskId: "task-5",
    });
    assert.equal(
      correlation.adapterOutputMarker,
      "latest-runtime-output-marker-1234567890".slice(0, 48)
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readRuntimeLogCorrelation enforces strict task id matching", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "delivery-stability-runtime-")
  );
  const logPath = path.join(tempDir, "runtime.ndjson");
  await writeFile(
    logPath,
    JSON.stringify({
      dispatchId: "dispatch-6",
      taskId: "task-other",
      output: "runtime-output",
    }),
    "utf8"
  );
  try {
    assert.throws(
      () =>
        TEST_ONLY.readRuntimeLogCorrelation({
          runtimeLogPath: logPath,
          dispatchId: "dispatch-6",
          taskId: "task-6",
        }),
      STRICT_TASK_MATCH_RE
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("readRuntimeLogCorrelation allows dispatch-only match when task id is missing", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "delivery-stability-runtime-")
  );
  const logPath = path.join(tempDir, "runtime.ndjson");
  await writeFile(
    logPath,
    JSON.stringify({
      dispatchId: "dispatch-7",
      taskId: "task-actual",
      output: "runtime-output-7",
    }),
    "utf8"
  );
  try {
    const correlation = TEST_ONLY.readRuntimeLogCorrelation({
      runtimeLogPath: logPath,
      dispatchId: "dispatch-7",
      taskId: "",
    });
    assert.equal(correlation.adapterOutputMarker, "runtime-output-7");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("assertDispatchSnapshotNotTerminal rejects failed_terminal status", () => {
  assert.throws(
    () =>
      TEST_ONLY.assertDispatchSnapshotNotTerminal({
        ledgerStatus: "failed_terminal",
      }),
    TERMINAL_DISPATCH_STATUS_RE
  );
});

test("assertDispatchSnapshotNotTerminal allows dispatching status", () => {
  assert.doesNotThrow(() =>
    TEST_ONLY.assertDispatchSnapshotNotTerminal({
      ledgerStatus: "dispatching",
    })
  );
});

test("extractSignalIdFromSendResponse reads send.response payload id", () => {
  const output = [
    JSON.stringify({
      type: "line",
      code: "send.acting_profile",
    }),
    JSON.stringify({
      type: "result",
      code: "send.response",
      payload: {
        id: "evt-abc",
      },
    }),
  ].join("\n");

  const signalId = TEST_ONLY.extractSignalIdFromSendResponse(output, "send");
  assert.equal(signalId, "evt-abc");
});

test("waitForCondition retries until evaluator succeeds", async () => {
  let attempt = 0;
  await TEST_ONLY.waitForCondition({
    label: "retry-success",
    timeoutMs: 300,
    pollIntervalMs: 1,
    evaluate: () => {
      attempt += 1;
      if (attempt < 3) {
        throw new Error("not-ready");
      }
    },
  });

  assert.equal(attempt, 3);
});

test("waitForCondition fails with timeout and label", async () => {
  await assert.rejects(
    TEST_ONLY.waitForCondition({
      label: "retry-timeout",
      timeoutMs: 20,
      pollIntervalMs: 5,
      evaluate: () => {
        throw new Error("still-pending");
      },
    }),
    WAIT_TIMEOUT_RE
  );
});

test("parsePositiveInteger includes option label on invalid input", () => {
  assert.throws(
    () =>
      TEST_ONLY.parsePositiveInteger(
        "abc",
        80,
        "OPENMELD_DOGFOODING_DELIVERY_STABILITY_HISTORY_LIMIT"
      ),
    INVALID_HISTORY_LIMIT_RE
  );
});

test("isRetryableGatewayCliFailure returns true for upstream unreachable output", () => {
  const retryable = TEST_ONLY.isRetryableGatewayCliFailure({
    status: 1,
    stdout:
      '{"type":"error","code":"cli.error","message":"HTTP 502: {\\"ok\\":false,\\"error\\":{\\"code\\":\\"upstream_unreachable\\",\\"message\\":\\"Cannot access GatewayRpcEntrypoint\\"}}"}',
    stderr: "",
  });

  assert.equal(retryable, true);
});

test("isRetryableGatewayCliFailure returns false for non-retryable failure", () => {
  const retryable = TEST_ONLY.isRetryableGatewayCliFailure({
    status: 1,
    stdout: '{"type":"error","code":"cli.error","message":"profile not found"}',
    stderr: "",
  });

  assert.equal(retryable, false);
});
