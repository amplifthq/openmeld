import assert from "node:assert/strict";
import test from "node:test";

const STDOUT_ERROR_RE = /stdout-error/;
const STDERR_ERROR_RE = /stderr-error/;
const AGENT_CONTROLLER_CONVERSATION_ID_MISMATCH_RE =
  /conversation\.bridge\.agent_controller_conversation_id_mismatch/;
const PARTIAL_STDOUT_RE = /partial-stdout/;
const PARTIAL_STDERR_RE = /partial-stderr/;

test("adapter-core builds graceful->force interrupt plan by default", async () => {
  const core = await import("../dist/index.js");
  const plan = core.buildInterruptPlan({
    taskId: "task-1",
  });

  assert.equal(plan.initial.mode, "graceful");
  assert.equal(plan.escalation?.mode, "force");
  assert.equal(
    plan.escalation?.delayMs,
    core.DEFAULT_GRACEFUL_INTERRUPT_TIMEOUT_MS
  );
});

test("adapter-core resolves agent context from mapping spec", async () => {
  const core = await import("../dist/index.js");
  const resolved = core.resolveAdapterAgentContext({
    bridgeSpec: {
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
    },
    spec: {
      sourceField: "OPENMELD_CLI_CONTEXT_ID",
      mappingVersion: 1,
    },
    env: {
      OPENMELD_CLI_CONTEXT_ID: "ctx-codex-1",
    },
  });

  assert.deepEqual(resolved, {
    agentControllerConversationId: "ctx-codex-1",
    sourceField: "OPENMELD_CLI_CONTEXT_ID",
    mappingVersion: 1,
    agentControllerConversation: {
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
      agentControllerConversationId: "ctx-codex-1",
    },
  });
});

test("adapter-core bridges typed agent controller conversation to legacy context id", async () => {
  const core = await import("../dist/index.js");
  const contextId = core.resolveBridgedAgentControllerConversationId({
    bridgeSpec: {
      agentControllerRef: "builtin:claude-code",
      agentControllerConversationKind: "session",
    },
    agentControllerConversation: {
      agentControllerRef: "builtin:claude-code",
      agentControllerConversationKind: "session",
      agentControllerConversationId: "session-1",
    },
  });

  assert.equal(contextId, "session-1");
});

test("adapter-core rejects mismatched legacy and typed conversation ids", async () => {
  const core = await import("../dist/index.js");
  assert.throws(
    () =>
      core.resolveBridgedAgentControllerConversationId({
        bridgeSpec: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationKind: "thread",
        },
        agentControllerConversationId: "thread-a",
        agentControllerConversation: {
          agentControllerRef: "builtin:codex",
          agentControllerConversationKind: "thread",
          agentControllerConversationId: "thread-b",
        },
      }),
    AGENT_CONTROLLER_CONVERSATION_ID_MISMATCH_RE
  );
});

test("adapter-core builds cancel request with default reason", async () => {
  const core = await import("../dist/index.js");
  const request = core.buildAdapterCancelRequest({
    taskId: "task-cancel-1",
  });

  assert.deepEqual(request, {
    reason: "service.cancel",
    taskId: "task-cancel-1",
  });
});

test("adapter-core cli driver streams stdout lines", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  const stdoutLines = [];
  const lifecycleEvents = [];
  const processControlEvents = [];

  const result = await driver.runCliDriver({
    args: [
      "-e",
      [
        "process.stdin.setEncoding('utf8');",
        "let text = '';",
        "process.stdin.on('data', (chunk) => { text += chunk; });",
        "process.stdin.on('end', () => {",
        "  console.error('stderr-1');",
        "  console.log('line-1');",
        "  console.log(text.trim());",
        "});",
      ].join(" "),
    ],
    bin: "node",
    cwd: process.cwd(),
    inputText: "line-2\n",
    onLifecycleEvent: (event) => {
      lifecycleEvents.push(event.phase);
    },
    onProcessControlEvent: (event) => {
      processControlEvents.push(event.phase);
    },
    onStdoutLine: (event) => {
      stdoutLines.push(event.line);
    },
    timeoutMs: 5000,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.deepEqual(stdoutLines, ["line-1", "line-2"]);
  assert.equal(typeof result.lifecycle.processId, "number");
  assert.equal(result.lifecycle.firstStdoutAtMs !== null, true);
  assert.equal(result.lifecycle.firstStderrAtMs !== null, true);
  assert.equal(result.lifecycle.stdinClosedAtMs !== null, true);
  assert.equal(result.lifecycle.exitObservedAtMs !== null, true);
  assert.equal(lifecycleEvents[0], "process_spawned");
  assert.equal(lifecycleEvents[1], "stdin_closed");
  assert.equal(lifecycleEvents.at(-1), "process_exit");
  assert.equal(
    lifecycleEvents.filter((phase) => phase === "first_stdout").length,
    1
  );
  assert.equal(
    lifecycleEvents.filter((phase) => phase === "first_stderr").length,
    1
  );
  assert.equal(
    lifecycleEvents.indexOf("first_stdout") >
      lifecycleEvents.indexOf("stdin_closed"),
    true
  );
  assert.equal(
    lifecycleEvents.indexOf("first_stderr") >
      lifecycleEvents.indexOf("stdin_closed"),
    true
  );
  assert.equal(
    lifecycleEvents.indexOf("first_stdout") <
      lifecycleEvents.indexOf("process_exit"),
    true
  );
  assert.equal(
    lifecycleEvents.indexOf("first_stderr") <
      lifecycleEvents.indexOf("process_exit"),
    true
  );
  assert.deepEqual(processControlEvents, ["process_spawned", "process_exit"]);
});

test("adapter-core cli driver throws non-zero exit errors", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  await assert.rejects(
    driver.runCliDriver({
      args: ["-e", "process.exit(7)"],
      bin: "node",
      cwd: process.cwd(),
      timeoutMs: 5000,
    }),
    (error) => {
      assert.equal(error instanceof driver.CliDriverError, true);
      assert.equal(error.code, "process.non_zero_exit");
      assert.equal(error.exitCode, 7);
      return true;
    }
  );
});

test("adapter-core cli driver can return non-zero exits when enabled", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  const result = await driver.runCliDriver({
    allowNonZeroExit: true,
    args: [
      "-e",
      "console.log('stdout-error'); console.error('stderr-error'); process.exit(9)",
    ],
    bin: "node",
    cwd: process.cwd(),
    timeoutMs: 5000,
  });

  assert.equal(result.exitCode, 9);
  assert.match(result.stdoutText, STDOUT_ERROR_RE);
  assert.match(result.stderrText, STDERR_ERROR_RE);
});

test("adapter-core cli driver tolerates benign stdin EPIPE when the child closes stdin early", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  const result = await driver.runCliDriver({
    args: [
      "-e",
      [
        "process.stdin.destroy();",
        "setTimeout(() => { process.exit(0); }, 50);",
      ].join(" "),
    ],
    bin: "node",
    cwd: process.cwd(),
    inputText: "x".repeat(1024 * 1024),
    timeoutMs: 5000,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.lifecycle.stdinClosedAtMs !== null, true);
});

test("adapter-core cli driver preserves output observed before timeout", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  await assert.rejects(
    driver.runCliDriver({
      args: [
        "-c",
        [
          "printf 'partial-stdout\\n';",
          "printf 'partial-stderr\\n' >&2;",
          "sleep 2;",
        ].join(" "),
      ],
      bin: "sh",
      cwd: process.cwd(),
      timeoutMs: 1000,
    }),
    (error) => {
      assert.equal(error instanceof driver.CliDriverError, true);
      assert.equal(error.code, "process.timeout");
      assert.match(error.stdoutText, PARTIAL_STDOUT_RE);
      assert.match(error.stderrText, PARTIAL_STDERR_RE);
      return true;
    }
  );
});

test("adapter-core cli driver timeout terminates descendant processes", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  let descendantProcessId = null;

  try {
    await assert.rejects(
      driver.runCliDriver({
        args: [
          "-e",
          [
            "const { spawn } = require('node:child_process');",
            "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
            "child.unref();",
            "console.log(child.pid);",
            "setInterval(() => {}, 1000);",
          ].join(" "),
        ],
        bin: process.execPath,
        cwd: process.cwd(),
        timeoutMs: 100,
      }),
      (error) => {
        assert.equal(error instanceof driver.CliDriverError, true);
        assert.equal(error.code, "process.timeout");
        descendantProcessId = Number.parseInt(error.stdoutText.trim(), 10);
        assert.equal(Number.isInteger(descendantProcessId), true);
        return true;
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(isProcessAlive(descendantProcessId), false);
  } finally {
    if (descendantProcessId && isProcessAlive(descendantProcessId)) {
      process.kill(descendantProcessId, "SIGKILL");
    }
  }
});

test("adapter-core cli driver natural exit terminates detached descendants", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  let descendantProcessId = null;

  try {
    const result = await driver.runCliDriver({
      args: [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });",
          "child.unref();",
          "console.log(child.pid);",
        ].join(" "),
      ],
      bin: process.execPath,
      cwd: process.cwd(),
    });

    assert.equal(result.exitCode, 0);
    descendantProcessId = Number.parseInt(result.stdoutText.trim(), 10);
    assert.equal(Number.isInteger(descendantProcessId), true);
    await waitForProcessExit(descendantProcessId);
    assert.equal(isProcessAlive(descendantProcessId), false);
  } finally {
    if (descendantProcessId && isProcessAlive(descendantProcessId)) {
      process.kill(descendantProcessId, "SIGKILL");
    }
  }
});

test("adapter-core cli driver completes when post-exit cleanup signaling fails", async () => {
  const driver = await import("../dist/drivers/cli-driver.js");
  const originalKill = process.kill;
  const originalWarn = console.warn;
  const warnings = [];
  let deadline = null;

  process.kill = (processId, signal) => {
    if (processId < 0 && signal === "SIGKILL") {
      throw Object.assign(new Error("simulated cleanup signaling failure"), {
        code: "EINVAL",
      });
    }
    return originalKill(processId, signal);
  };
  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const result = await Promise.race([
      driver.runCliDriver({
        args: ["-e", "process.exit(0)"],
        bin: process.execPath,
        cwd: process.cwd(),
        timeoutMs: 5000,
      }),
      new Promise((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error("CLI driver did not settle after child exit")),
          2000
        );
      }),
    ]);

    assert.equal(result.exitCode, 0);
    assert.equal(
      warnings.some(
        ([event]) =>
          event === "[openmeld.agent_controller.process_cleanup_failed]"
      ),
      true
    );
  } finally {
    if (deadline) {
      clearTimeout(deadline);
    }
    process.kill = originalKill;
    console.warn = originalWarn;
  }
});

async function waitForProcessExit(processId) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && isProcessAlive(processId)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function isProcessAlive(processId) {
  if (!processId) {
    return false;
  }
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

test("adapter-core dispatch failure keeps explicit adapter error type", async () => {
  const core = await import("../dist/index.js");
  const error = Object.assign(new Error("auth.required: missing token"), {
    code: "auth.required",
    errorType: "auth",
  });

  const failure = core.toAdapterDispatchFailure(error, "adapter");
  assert.deepEqual(failure, {
    errorCode: "auth.required",
    errorMessage: "auth.required: missing token",
    errorType: "auth",
    status: "failed",
  });
});

test("adapter-core dispatch failure preserves provider account evidence", async () => {
  const core = await import("../dist/index.js");
  const error = Object.assign(new Error("Claude Code account access failed"), {
    code: "auth.required",
    errorType: "auth",
    providerAccessEvidence: {
      observedAtMs: 1_770_000_000_000,
      provider: "claude-code",
      reasonCode: "provider_account.organization_access_disabled",
      source: "wake_failure",
    },
  });

  const failure = core.toAdapterDispatchFailure(error, "adapter");
  assert.deepEqual(failure.providerAccessEvidence, {
    observedAtMs: 1_770_000_000_000,
    provider: "claude-code",
    reasonCode: "provider_account.organization_access_disabled",
    source: "wake_failure",
  });
});

test("adapter-core preserves provider-neutral hard capacity evidence", async () => {
  const core = await import("../dist/index.js");
  const error = Object.assign(new Error("OpenCode quota exhausted"), {
    code: "quota.exceeded",
    errorType: "adapter",
    providerAccessEvidence: {
      observedAtMs: 1_770_000_000_000,
      provider: "opencode",
      reasonCode: "provider_account.capacity_exhausted",
      source: "wake_failure",
    },
  });

  const failure = core.toAdapterDispatchFailure(error, "adapter");
  assert.deepEqual(failure.providerAccessEvidence, {
    observedAtMs: 1_770_000_000_000,
    provider: "opencode",
    reasonCode: "provider_account.capacity_exhausted",
    source: "wake_failure",
  });
});

test("adapter-core dispatch failure preserves only bounded model diagnostics", async () => {
  const core = await import("../dist/index.js");
  const modelNegotiation = {
    checkAttempt: 2,
    configAvailableModelCount: 1,
    configAvailableModelIds: ["default[]"],
    configAvailableModelIdsTruncated: false,
    configCurrentModelId: "default[]",
    currentModelId: "default[]",
    legacyAvailableModelCount: 0,
    legacyAvailableModelIds: [],
    legacyAvailableModelIdsTruncated: false,
    legacyCurrentModelId: null,
    protocol: "acp/v1",
    requestedModelId: "default[]",
    requestedPresentInConfigOptions: true,
    requestedPresentInLegacyModels: false,
    sessionOperation: "load",
    sourceState: "config_options_only",
  };
  const error = Object.assign(new Error("model inventory unavailable"), {
    diagnostics: {
      modelNegotiation,
      secretPayload: { token: "must-not-survive" },
    },
  });

  const failure = core.toAdapterDispatchFailure(error);
  assert.deepEqual(failure.diagnostics, { modelNegotiation });
});

test("adapter-core dispatch failure drops unrecognized diagnostics", async () => {
  const core = await import("../dist/index.js");
  const error = Object.assign(new Error("adapter failed"), {
    diagnostics: {
      rawProviderResponse: {
        accessToken: "must-not-survive",
      },
    },
  });

  const failure = core.toAdapterDispatchFailure(error);
  assert.equal(failure.diagnostics, undefined);
});

test("adapter-core classifies timeout without output as timed_out_no_output", async () => {
  const core = await import("../dist/index.js");
  const driver = await import("../dist/drivers/cli-driver.js");
  const error = new driver.CliDriverError({
    code: "process.timeout",
    message: "process.timeout: command exceeded 5000ms",
  });

  const classified = core.classifyCliDriverTimeoutFailure({
    error,
    providerLabel: "codex",
    timeoutMs: 5000,
  });

  assert.deepEqual(classified, {
    code: "timed_out_no_output",
    errorType: "timeout",
    message:
      "timed_out_no_output: codex invocation exceeded 5000ms before producing any runtime output",
  });
});

test("adapter-core classifies timeout after output as timed_out_after_output", async () => {
  const core = await import("../dist/index.js");
  const driver = await import("../dist/drivers/cli-driver.js");
  const error = new driver.CliDriverError({
    code: "process.timeout",
    message: "process.timeout: command exceeded 5000ms",
    stdoutText: "partial output",
  });

  const classified = core.classifyCliDriverTimeoutFailure({
    error,
    providerLabel: "claude",
    timeoutMs: 5000,
  });

  assert.deepEqual(classified, {
    code: "timed_out_after_output",
    errorType: "timeout",
    message:
      "timed_out_after_output: claude invocation exceeded 5000ms after producing runtime output",
  });
});

test("adapter-core formats unknown timeout values without appending ms", async () => {
  const core = await import("../dist/index.js");
  const driver = await import("../dist/drivers/cli-driver.js");
  const error = new driver.CliDriverError({
    code: "process.timeout",
    message: "process.timeout: command exceeded unknown",
  });

  const classified = core.classifyCliDriverTimeoutFailure({
    error,
    providerLabel: "codex",
    timeoutMs: null,
  });

  assert.deepEqual(classified, {
    code: "timed_out_no_output",
    errorType: "timeout",
    message:
      "timed_out_no_output: codex invocation exceeded unknown before producing any runtime output",
  });
});
