import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { z } from "zod/v4";

const AUTH_401_RE = /401 Unauthorized/;
const MODEL_NOT_FOUND_RE = /model_not_found|requested model/i;
const CODEX_UPGRADE_REQUIRED_RE = /requires a newer version of codex/i;
const DANGEROUS_BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";
const CODEX_COMMAND_DENIED_BY_SANDBOX_RE = /command denied by sandbox/i;
const CODEX_EXECUTION_DENIED_RE = /execution denied/i;
const FORK_CHECKPOINT_UNAVAILABLE_RE =
  /execution_context.fork_checkpoint_unavailable/;
const FORK_BOUNDARY_CONFLICT_RE =
  /a fork takes either sourceCompletedTurnId or forkFullHistory/;
const QUOTA_RE = /insufficient_quota/;
const RATE_LIMIT_RE = /rate limit/i;
const USAGE_LIMIT_RE = /usage limit/i;
const STARTUP_RETRY_OUTPUT_RE = /start safely after one transient bootstrap/;
const STARTUP_RETRY_FAILURE_RE = /one automatic retry/;
const LONG_TURN_OUTPUT_RE = /allow a healthy long-running turn/;
const NATIVE_RUNTIME_OUTPUT_RE = /launch the official packaged native runtime/;
const RUNTIME_PERMISSION_DENIAL_COPY =
  "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.";
const createRuntimeContext = (
  providerRuntimeWorkingDirectory = process.cwd()
) => ({
  providerRuntimeWorkingDirectory,
});
const READ_CODEX_DISPATCH_STOP_EVIDENCE = Symbol.for(
  "openmeld.codex.readDispatchStopEvidence"
);
const createNodeScriptLaunchContract = (scriptPath) => ({
  kind: "node_script",
  nodePath: process.execPath,
  scriptPath,
});

test("codex classifies only its official thread writer conflict as conversation occupancy", async () => {
  const { classifyCodexThreadWriterConflict } = await import(
    "../dist/index.js"
  );

  assert.deepEqual(
    classifyCodexThreadWriterConflict({
      agentControllerConversationId: "01a04ded-5af8-7f00-a2dd-4abee50f8724",
      operation: "thread/resume",
      rpcErrorCode: -32_600,
      rpcErrorMessage:
        "thread 01a04ded-5af8-7f00-a2dd-4abee50f8724 already has an active writer",
    }),
    {
      agentControllerConversationId: "01a04ded-5af8-7f00-a2dd-4abee50f8724",
      contractVersion: 1,
      state: "occupied",
    }
  );

  for (const candidate of [
    {
      operation: "turn/start",
      rpcErrorCode: -32_600,
      rpcErrorMessage:
        "thread 01a04ded-5af8-7f00-a2dd-4abee50f8724 already has an active writer",
    },
    {
      operation: "thread/resume",
      rpcErrorCode: -32_000,
      rpcErrorMessage:
        "thread 01a04ded-5af8-7f00-a2dd-4abee50f8724 already has an active writer",
    },
    {
      operation: "thread/resume",
      rpcErrorCode: -32_600,
      rpcErrorMessage: "transport busy",
    },
  ]) {
    assert.equal(
      classifyCodexThreadWriterConflict({
        agentControllerConversationId: "01a04ded-5af8-7f00-a2dd-4abee50f8724",
        ...candidate,
      }),
      null
    );
  }
});

test("codex waits on an official writer conflict and retries the same dispatch", async () => {
  const { CodexAppServerTransportError, createCodexAdapter } = await import(
    "../dist/index.js"
  );
  const events = [];
  let dispatchCalls = 0;
  let availabilityWaits = 0;
  const occupancy = {
    agentControllerConversationId: "thread-occupied",
    contractVersion: 1,
    state: "occupied",
  };
  const adapter = createCodexAdapter({
    invokeByMode: {
      "codex-app-server": () => {
        dispatchCalls += 1;
        if (dispatchCalls === 1) {
          throw new CodexAppServerTransportError({
            agentControllerConversationOccupancy: occupancy,
            code: "agent_controller.conversation_occupied",
            errorType: "adapter",
            message: "thread thread-occupied already has an active writer",
            rpcErrorCode: -32_600,
          });
        }
        return {
          contextDelta: {
            agentControllerConversationId: "thread-occupied",
          },
          output: "accepted after release",
        };
      },
    },
    waitForThreadWriterAvailability: ({ occupancy: observed }) => {
      availabilityWaits += 1;
      assert.deepEqual(observed, occupancy);
      return Promise.resolve("release_observed");
    },
  });

  const result = await adapter.dispatch({
    agentControllerConversationId: "thread-occupied",
    agentId: "agt-demo",
    onRuntimeEvent: (event) => {
      if (event.phase.startsWith("agent_controller_conversation_")) {
        events.push(event.phase);
      }
    },
    prompt: "continue",
    runtimeContext: createRuntimeContext(),
    sourceEventId: "evt-occupied",
    spaceId: "space-1",
    taskId: "task-occupied",
    transportMode: "codex-app-server",
  });

  assert.equal(result.status, "success");
  assert.equal(result.output, "accepted after release");
  assert.equal(dispatchCalls, 2);
  assert.equal(availabilityWaits, 1);
  assert.deepEqual(events, [
    "agent_controller_conversation_occupied",
    "agent_controller_conversation_available",
  ]);
});

test("codex default app-server path preserves writer occupancy and retries after release", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "codex-default-writer-occupancy-")
  );
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-default-writer-occupancy-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const startupAttemptPath = join(fixtureDir, "startup-attempt.txt");
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const events = [];
    let availabilityWaits = 0;
    const adapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
      waitForThreadWriterAvailability: ({ occupancy }) => {
        availabilityWaits += 1;
        assert.deepEqual(occupancy, {
          agentControllerConversationId: "thread-default-occupied",
          contractVersion: 1,
          state: "occupied",
        });
        return Promise.resolve("release_observed");
      },
    });

    const result = await adapter.dispatch({
      agentControllerConversationId: "thread-default-occupied",
      agentId: "agt-demo",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_WRITER_ATTEMPTS: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: startupAttemptPath,
      },
      onRuntimeEvent: (event) => {
        if (event.phase.startsWith("agent_controller_conversation_")) {
          events.push(event.phase);
        }
      },
      prompt: "continue after the writer releases",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-default-occupied",
      spaceId: "space-1",
      taskId: "task-default-occupied",
      transportMode: "codex-app-server",
    });
    const methods = await readFakeAppServerMethods(logPath);

    assert.equal(result.status, "success");
    assert.equal(availabilityWaits, 1);
    assert.equal(
      methods.filter((method) => method === "thread/resume").length,
      2
    );
    assert.equal(methods.filter((method) => method === "turn/start").length, 1);
    assert.deepEqual(events, [
      "agent_controller_conversation_occupied",
      "agent_controller_conversation_available",
    ]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex Stop fences the default app-server path while writer occupancy waits", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "codex-default-writer-stop-")
  );
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-default-writer-stop-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const startupAttemptPath = join(fixtureDir, "startup-attempt.txt");
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    let waitStartedResolve;
    const waitStarted = new Promise((resolve) => {
      waitStartedResolve = resolve;
    });
    const adapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
      waitForThreadWriterAvailability: ({ signal }) => {
        waitStartedResolve();
        if (!signal) {
          throw new Error("expected the task AbortSignal at the writer wait");
        }
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("aborted"), {
            once: true,
          });
        });
      },
    });
    const dispatchOutcome = adapter.dispatch({
      agentControllerConversationId: "thread-default-stop",
      agentId: "agt-demo",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_WRITER_ATTEMPTS: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: startupAttemptPath,
      },
      prompt: "do not continue after Stop",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-default-stop",
      spaceId: "space-1",
      taskId: "task-default-stop",
      transportMode: "codex-app-server",
    });

    await waitStarted;
    const stopResult = await adapter.cancel({ taskId: "task-default-stop" });
    const dispatchResult = await dispatchOutcome;
    const methods = await readFakeAppServerMethods(logPath);

    assert.equal(stopResult.accepted, true);
    assert.equal(dispatchResult.status, "failed");
    assert.equal(dispatchResult.errorCode, "runtime.turn.cancelled");
    assert.equal(
      methods.filter((method) => method === "thread/resume").length,
      1
    );
    assert.equal(methods.filter((method) => method === "turn/start").length, 0);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

for (const [initialMode, targetMode, version, receipt, expectedStatus] of [
  [
    "codex:askForApproval",
    "codex:approveForMe",
    "0.160.1",
    "applied",
    "applied",
  ],
  [
    "codex:approveForMe",
    "codex:askForApproval",
    "0.160.1",
    "applied",
    "applied",
  ],
  ["codex:askForApproval", "codex:fullAccess", "0.160.1", "applied", "applied"],
  [
    "codex:fullAccess",
    "codex:approveForMe",
    "0.160.1",
    "applied",
    "not_applied",
  ],
  [
    "codex:customConfig",
    "codex:approveForMe",
    "0.160.1",
    "applied",
    "not_applied",
  ],
  [
    "codex:askForApproval",
    "codex:approveForMe",
    "0.150.1",
    "applied",
    "not_applied",
  ],
  [
    "codex:askForApproval",
    "codex:approveForMe",
    "0.160.1",
    "notFound",
    "not_applied",
  ],
]) {
  test(`codex live permissions ${initialMode} -> ${targetMode} (${version}, ${receipt})`, async () => {
    const { invokeCodexAppServerTransport } = await import("../dist/index.js");
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-permissions-"));
    const fixturePath = join(fixtureDir, "app-server.mjs");
    const logPath = join(fixtureDir, "rpc.jsonl");
    await writeFakeCodexAppServerFixture(fixturePath);
    let activeTurn;
    let accepted;
    const turnAccepted = new Promise((resolve) => {
      accepted = resolve;
    });
    try {
      const execution = invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: fixtureDir,
        agentControllerPermissionMode: initialMode,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "60000",
          OPENMELD_FAKE_CODEX_NATIVE_VERSION: version,
          OPENMELD_FAKE_CODEX_PERMISSION_RECEIPT: receipt,
        },
        taskId: "permission-task",
        threadId: "permission-thread",
        prompt: "Continue working",
        onActiveTurn: (turn) => {
          activeTurn = turn;
          return () => undefined;
        },
        onRuntimeEvent: (event) => {
          if (event.phase === "provider_turn_accepted") {
            accepted();
          }
        },
      });
      await Promise.race([
        turnAccepted,
        execution.then(() => assert.fail("Turn ended before admission")),
      ]);
      const result = await activeTurn.updatePermissionMode({
        taskId: "permission-task",
        agentControllerPermissionMode: targetMode,
      });
      assert.equal(result.status, expectedStatus);
      const messages = await readFakeAppServerMessages(logPath);
      const update = messages.find(
        (message) => message.method === "turn/settings/update"
      );
      if (targetMode === "codex:fullAccess") {
        // The turn's sandbox cannot change; OpenMeld answers later permission
        // requests instead of asking Codex to update the turn.
        assert.equal(update, undefined);
      } else if (expectedStatus === "applied") {
        assert.deepEqual(update.params, {
          threadId: "permission-thread",
          turnId: "turn-1",
          approvalsReviewer:
            targetMode === "codex:approveForMe" ? "auto_review" : "user",
        });
      }
      assert.equal(
        messages.filter((message) => message.method === "turn/start").length,
        1
      );
      assert.equal(
        messages.some((message) => message.method === "turn/interrupt"),
        false
      );
      await activeTurn.interrupt();
      await execution;
      assert.equal(
        (
          await activeTurn.updatePermissionMode({
            taskId: "permission-task",
            agentControllerPermissionMode: targetMode,
          })
        ).status,
        "not_applied"
      );
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });
}

for (const [mode, expectedStatus] of [
  ["applied", "applied"],
  ["unsupported", "not_applied"],
  ["target-ended", "not_applied"],
  ["target-changed", "not_applied"],
  ["internal-error", "unconfirmed"],
  ["wrong-receipt", "unconfirmed"],
  ["withhold", "unconfirmed"],
  ["stop-during", "unconfirmed"],
]) {
  test(`codex exact-turn Steer respects delivery and Stop boundaries: ${mode}`, async () => {
    const { invokeCodexAppServerTransport } = await import("../dist/index.js");
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-steer-"));
    const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
    const logPath = join(fixtureDir, "rpc-log.jsonl");
    await writeFakeCodexAppServerFixture(fixturePath);
    let activeTurn;
    let earlySteer;
    let accepted;
    const turnAccepted = new Promise((resolve) => {
      accepted = resolve;
    });
    try {
      const execution = invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        controlRequestTimeoutMs: 500,
        codexWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "60000",
          OPENMELD_FAKE_CODEX_STEER_MODE: mode,
        },
        taskId: "task-steer",
        threadId: "thread-steer",
        prompt: "original request",
        onActiveTurn: (turn) => {
          activeTurn = turn;
          earlySteer = turn.steer({
            inputId: "input-early",
            text: "do not send before native admission",
          });
          return () => undefined;
        },
        onRuntimeEvent: (event) => {
          if (event.phase === "provider_turn_accepted") {
            accepted();
          }
        },
      });
      await Promise.race([
        turnAccepted,
        execution.then(() => assert.fail("Turn ended before admission")),
      ]);
      assert.equal((await earlySteer).status, "not_applied");
      const steering = activeTurn.steer({
        inputId: "input-steer",
        text: "correction for this execution",
      });
      if (mode === "stop-during") {
        await activeTurn.interrupt();
      }
      const result = await steering;
      assert.equal(result.status, expectedStatus);
      if (mode === "applied") {
        assert.deepEqual(result, {
          status: "applied",
          taskId: "task-steer",
          threadId: "thread-steer",
          turnId: "turn-1",
        });
      }
      if (mode === "target-ended" || mode === "target-changed") {
        assert.equal(result.reasonCode, "execution_input.rejected");
      }
      if (mode === "internal-error") {
        assert.equal(result.nativeErrorCode, -32_603);
      }
      if (mode === "withhold") {
        assert.equal(result.diagnosticCode, "runtime.turn_steer_timeout");
      }
      if (mode === "wrong-receipt") {
        assert.equal(
          result.diagnosticCode,
          "runtime.turn_steer_receipt_mismatch"
        );
      }
      // A missing receipt must neither stop the original task nor retry input.
      const beforeStop = await readFakeAppServerMessages(logPath);
      assert.equal(
        beforeStop.filter((item) => item.method === "turn/start").length,
        1
      );
      assert.equal(
        beforeStop.filter((item) => item.method === "turn/interrupt").length,
        mode === "stop-during" ? 1 : 0
      );
      const requests = beforeStop.filter(
        (item) => item.method === "turn/steer"
      );
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].params, {
        threadId: "thread-steer",
        clientUserMessageId: "input-steer",
        expectedTurnId: "turn-1",
        input: [
          {
            type: "text",
            text: "correction for this execution",
            text_elements: [],
          },
        ],
      });
      await activeTurn.interrupt();
      const stopped = await activeTurn.steer({
        inputId: "input-stopped",
        text: "do not send after Stop",
      });
      assert.equal(stopped.status, "not_applied");
      await execution;
      const late = await activeTurn.steer({
        inputId: "input-late",
        text: "do not send after completion",
      });
      assert.equal(late.status, "not_applied");
      assert.equal(
        (await readFakeAppServerMessages(logPath)).filter(
          (item) => item.method === "turn/steer"
        ).length,
        1
      );
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });
}

test("codex Stop keeps the turn a released writer retry already started", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "codex-default-writer-stop-after-turn-")
  );
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-default-writer-stop-after-turn-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const startupAttemptPath = join(fixtureDir, "startup-attempt.txt");
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const events = [];
    const adapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      launchContract: createNodeScriptLaunchContract(fixturePath),
      waitForThreadWriterAvailability: () =>
        Promise.resolve("release_observed"),
    });
    let acceptTurn;
    const acceptedTurn = new Promise((resolve) => {
      acceptTurn = resolve;
    });
    const dispatchOutcome = adapter.dispatch({
      agentControllerConversationId: "thread-default-stop-after-turn",
      agentId: "agt-demo",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_WRITER_ATTEMPTS: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: startupAttemptPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "5000",
      },
      onRuntimeEvent: (event) => {
        if (event.phase.startsWith("agent_controller_conversation_")) {
          events.push(event.phase);
        }
        if (event.phase === "provider_turn_accepted") {
          acceptTurn();
        }
      },
      prompt: "continue after the writer releases",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-default-stop-after-turn",
      spaceId: "space-1",
      taskId: "task-default-stop-after-turn",
      transportMode: "codex-app-server",
    });

    // The retry won the writer lock and the native turn is running, so this
    // Stop lands after `turn/start` rather than ahead of it.
    // Use actual native admission rather than assuming two controller starts
    // and writer reconciliation fit inside an unrelated one-second file poll.
    await Promise.race([
      acceptedTurn,
      dispatchOutcome.then((result) =>
        assert.fail(
          `The dispatch ended before accepting the native turn: ${JSON.stringify(result)}`
        )
      ),
    ]);
    assert.equal(
      (
        await adapter.steer({
          taskId: "another-task",
          inputId: "input-wrong-target",
          text: "wrong target",
        })
      ).status,
      "not_applied"
    );
    await assert.rejects(
      adapter.steer({
        taskId: "task-default-stop-after-turn",
        inputId: "input-invalid",
        text: " ",
      }),
      { message: "execution_input.invalid" }
    );
    assert.deepEqual(
      await adapter.steer({
        inputId: "input-active",
        taskId: "task-default-stop-after-turn",
        text: "correction",
      }),
      {
        status: "applied",
        taskId: "task-default-stop-after-turn",
        threadId: "thread-default-stop-after-turn",
        turnId: "turn-1",
      }
    );
    const stopResult = await adapter.interrupt({
      mode: "force",
      taskId: "task-default-stop-after-turn",
    });
    const dispatchResult = await dispatchOutcome;
    assert.equal(
      (
        await adapter.steer({
          inputId: "input-after-stop",
          taskId: "task-default-stop-after-turn",
          text: "too late",
        })
      ).status,
      "not_applied"
    );
    const methods = await readFakeAppServerMethods(logPath);

    assert.equal(stopResult.accepted, true);
    assert.equal(
      methods.filter((method) => method === "thread/resume").length,
      2
    );
    assert.equal(methods.filter((method) => method === "turn/start").length, 1);
    assert.equal(methods.filter((method) => method === "turn/steer").length, 1);
    assert.equal(
      methods.filter((method) => method === "turn/interrupt").length,
      1
    );
    // The RPC log proves a turn ran, so the dispatch must not come back as a
    // request that was stopped before starting one.
    assert.equal(dispatchResult.status, "success");
    assert.deepEqual(events, [
      "agent_controller_conversation_occupied",
      "agent_controller_conversation_available",
    ]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex clears occupied evidence when the retry is accepted", async () => {
  const { CodexAppServerTransportError, createCodexAdapter } = await import(
    "../dist/index.js"
  );
  let dispatchCalls = 0;
  const events = [];
  const occupancy = {
    agentControllerConversationId: "thread-recheck",
    contractVersion: 1,
    state: "occupied",
  };
  const adapter = createCodexAdapter({
    invokeByMode: {
      "codex-app-server": () => {
        dispatchCalls += 1;
        if (dispatchCalls === 1) {
          throw new CodexAppServerTransportError({
            agentControllerConversationOccupancy: occupancy,
            code: "agent_controller.conversation_occupied",
            errorType: "adapter",
            message: "thread thread-recheck already has an active writer",
            rpcErrorCode: -32_600,
          });
        }
        return {
          contextDelta: {
            agentControllerConversationId: "thread-recheck",
          },
          output: "accepted after a recovery recheck",
        };
      },
    },
    waitForThreadWriterAvailability: async () => "retry_due",
  });

  const result = await adapter.dispatch({
    agentControllerConversationId: "thread-recheck",
    agentId: "agt-demo",
    onRuntimeEvent: (event) => {
      if (event.phase.startsWith("agent_controller_conversation_")) {
        events.push(event.phase);
      }
    },
    prompt: "continue",
    runtimeContext: createRuntimeContext(),
    sourceEventId: "evt-recheck",
    spaceId: "space-1",
    taskId: "task-recheck",
    transportMode: "codex-app-server",
  });

  assert.equal(result.status, "success");
  assert.equal(dispatchCalls, 2);
  assert.deepEqual(events, [
    "agent_controller_conversation_occupied",
    "agent_controller_conversation_available",
  ]);
});

test("codex Stop aborts an occupied writer wait without resuming the thread again", async () => {
  const { CodexAppServerTransportError, createCodexAdapter } = await import(
    "../dist/index.js"
  );

  for (const control of ["cancel", "interrupt"]) {
    let dispatchCalls = 0;
    let waitStartedResolve;
    const waitStarted = new Promise((resolve) => {
      waitStartedResolve = resolve;
    });
    const events = [];
    const adapter = createCodexAdapter({
      invokeByMode: {
        "codex-app-server": () => {
          dispatchCalls += 1;
          throw new CodexAppServerTransportError({
            agentControllerConversationOccupancy: {
              agentControllerConversationId: `thread-stop-${control}`,
              contractVersion: 1,
              state: "occupied",
            },
            code: "agent_controller.conversation_occupied",
            errorType: "adapter",
            message: `thread thread-stop-${control} already has an active writer`,
            rpcErrorCode: -32_600,
          });
        },
      },
      waitForThreadWriterAvailability: ({ signal }) => {
        waitStartedResolve();
        if (!signal) {
          throw new Error("expected the task AbortSignal at the writer wait");
        }
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve("aborted"), {
            once: true,
          });
        });
      },
    });
    const dispatchOutcome = adapter
      .dispatch({
        agentControllerConversationId: `thread-stop-${control}`,
        agentId: "agt-demo",
        onRuntimeEvent: (event) => {
          if (event.phase.startsWith("agent_controller_conversation_")) {
            events.push(event.phase);
          }
        },
        prompt: "continue",
        runtimeContext: createRuntimeContext(),
        sourceEventId: `evt-stop-${control}`,
        spaceId: "space-1",
        taskId: `task-stop-${control}`,
        transportMode: "codex-app-server",
      })
      .catch((error) => error);

    await waitStarted;
    const controlResult = await adapter[control]({
      ...(control === "interrupt" ? { mode: "force" } : {}),
      taskId: `task-stop-${control}`,
    });
    const dispatchResult = await dispatchOutcome;

    assert.equal(controlResult.accepted, true);
    assert.equal(dispatchResult.status, "failed");
    assert.equal(dispatchResult.errorCode, "runtime.turn.cancelled");
    assert.equal(dispatchCalls, 1);
    assert.deepEqual(events, ["agent_controller_conversation_occupied"]);
    // The Stop must stay readable after the dispatch call it ended, because the
    // handoff decides on it, and it must say whether a turn was in flight.
    assert.equal(
      adapter[READ_CODEX_DISPATCH_STOP_EVIDENCE](`task-stop-${control}`)
        .turnWasRunning,
      false
    );
    // A retry for a stopped task must not resume the thread: the successor that
    // took the reservation is the only remaining claimant on that writer.
    const retry = await adapter.dispatch({
      agentControllerConversationId: `thread-stop-${control}`,
      agentId: "agt-demo",
      prompt: "continue",
      runtimeContext: createRuntimeContext(),
      sourceEventId: `evt-stop-${control}-retry`,
      spaceId: "space-1",
      taskId: `task-stop-${control}`,
      transportMode: "codex-app-server",
    });
    assert.equal(retry.errorCode, "runtime.turn.cancelled");
    assert.equal(dispatchCalls, 1);
  }
});

// A Stop that lands while the released-writer retry is in flight must be
// reported by what the retry actually did. `runtime.turn.cancelled` is the
// transport's own "stopped before starting a turn" code, so handing it back for
// a retry that already won the writer lock would tell Core nothing ran while a
// native turn had run — the premise that invites the same work running twice.
const stopAfterReleaseScenarios = [
  {
    expectedErrorCode: "runtime.turn.cancelled",
    expectedErrorMessage:
      "runtime.turn.cancelled: This OpenMeld request was stopped",
    name: "landed before the turn started",
    retryFailure: {
      code: "runtime.turn.cancelled",
      message:
        "runtime.turn.cancelled: Codex was stopped before starting a turn",
    },
    startsTurn: false,
  },
  {
    expectedOutput: "retry completed",
    name: "landed after the turn started and the turn finished",
    retryFailure: null,
    startsTurn: true,
  },
  {
    expectedErrorCode: "runtime.turn.failed",
    expectedErrorMessage: "runtime.turn.failed: the turn ended while stopping",
    name: "landed after the turn started and the turn failed",
    retryFailure: {
      code: "runtime.turn.failed",
      message: "runtime.turn.failed: the turn ended while stopping",
    },
    startsTurn: true,
  },
];

for (const scenario of stopAfterReleaseScenarios) {
  test(`codex Stop fences a released writer retry (${scenario.name})`, async () => {
    const { CodexAppServerTransportError, createCodexAdapter } = await import(
      "../dist/index.js"
    );
    let dispatchCalls = 0;
    let turnStartCount = 0;
    let retryObservedCancellation = false;
    let retryReachedProviderBoundaryResolve;
    const retryReachedProviderBoundary = new Promise((resolve) => {
      retryReachedProviderBoundaryResolve = resolve;
    });
    let releaseRetryResolve;
    const releaseRetry = new Promise((resolve) => {
      releaseRetryResolve = resolve;
    });
    const occupancy = {
      agentControllerConversationId: "thread-stop-after-release",
      contractVersion: 1,
      state: "occupied",
    };
    const adapter = createCodexAdapter({
      invokeByMode: {
        "codex-app-server": async (input) => {
          dispatchCalls += 1;
          if (dispatchCalls === 1) {
            throw new CodexAppServerTransportError({
              agentControllerConversationOccupancy: occupancy,
              code: "agent_controller.conversation_occupied",
              errorType: "adapter",
              message:
                "thread thread-stop-after-release already has an active writer",
              rpcErrorCode: -32_600,
            });
          }
          if (scenario.startsTurn) {
            turnStartCount += 1;
          }
          retryReachedProviderBoundaryResolve();
          await releaseRetry;
          retryObservedCancellation =
            input.cancellationSignal?.aborted === true;
          if (scenario.retryFailure) {
            throw new CodexAppServerTransportError({
              code: scenario.retryFailure.code,
              errorType: "adapter",
              message: scenario.retryFailure.message,
            });
          }
          return {
            contextDelta: {
              agentControllerConversationId: "thread-stop-after-release",
            },
            output: "retry completed",
          };
        },
      },
      waitForThreadWriterAvailability: async () => "release_observed",
    });
    const dispatchOutcome = adapter.dispatch({
      agentControllerConversationId: "thread-stop-after-release",
      agentId: "agt-demo",
      prompt: "continue",
      runtimeContext: createRuntimeContext(),
      sourceEventId: "evt-stop-after-release",
      spaceId: "space-1",
      taskId: "task-stop-after-release",
      transportMode: "codex-app-server",
    });

    await retryReachedProviderBoundary;
    const stopResult = await adapter.cancel({
      taskId: "task-stop-after-release",
    });
    releaseRetryResolve();
    const dispatchResult = await dispatchOutcome;

    assert.equal(stopResult.accepted, true);
    assert.equal(dispatchCalls, 2);
    assert.equal(turnStartCount, scenario.startsTurn ? 1 : 0);
    assert.equal(retryObservedCancellation, true);
    if (scenario.expectedOutput) {
      assert.equal(dispatchResult.status, "success");
      assert.equal(dispatchResult.output, scenario.expectedOutput);
    } else {
      assert.equal(dispatchResult.status, "failed");
      assert.equal(dispatchResult.errorCode, scenario.expectedErrorCode);
      assert.equal(dispatchResult.errorMessage, scenario.expectedErrorMessage);
    }
  });
}

test("codex retries immediately when the official writer lock is released", async () => {
  const { waitForCodexThreadWriterAvailability } = await import(
    "../dist/index.js"
  );
  const codexHome = await mkdtemp(join(tmpdir(), "codex-home-lock-"));
  const lockDirectory = join(codexHome, "thread-writer-locks");
  const lockPath = join(lockDirectory, "thread-release.lock");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, "");

  try {
    const startedAtMs = Date.now();
    const waiting = waitForCodexThreadWriterAvailability({
      env: { CODEX_HOME: codexHome },
      occupancy: {
        agentControllerConversationId: "thread-release",
        contractVersion: 1,
        state: "occupied",
      },
      recoveryRetryMs: 2000,
    });
    setTimeout(() => {
      rm(lockPath, { force: true }).catch(() => undefined);
    }, 25);
    assert.equal(await waiting, "release_observed");
    assert.ok(Date.now() - startedAtMs < 1000);
  } finally {
    await rm(codexHome, { force: true, recursive: true });
  }
});

test("codex writer wait closes immediately when the Wake is stopped", async () => {
  const { waitForCodexThreadWriterAvailability } = await import(
    "../dist/index.js"
  );
  const codexHome = await mkdtemp(join(tmpdir(), "codex-home-stop-lock-"));
  const lockDirectory = join(codexHome, "thread-writer-locks");
  const lockPath = join(lockDirectory, "thread-stop.lock");
  const abortController = new AbortController();
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, "");

  try {
    const waiting = waitForCodexThreadWriterAvailability({
      env: { CODEX_HOME: codexHome },
      occupancy: {
        agentControllerConversationId: "thread-stop",
        contractVersion: 1,
        state: "occupied",
      },
      recoveryRetryMs: 2000,
      signal: abortController.signal,
    });
    setTimeout(() => abortController.abort(), 25);

    assert.equal(await waiting, "aborted");
    assert.equal(await readFile(lockPath, "utf8"), "");
  } finally {
    await rm(codexHome, { force: true, recursive: true });
  }
});

test("codex writer wait retries official admission when a crashed writer leaves its lock file", async () => {
  const { waitForCodexThreadWriterAvailability } = await import(
    "../dist/index.js"
  );
  const codexHome = await mkdtemp(join(tmpdir(), "codex-home-held-lock-"));
  const lockDirectory = join(codexHome, "thread-writer-locks");
  const lockPath = join(lockDirectory, "thread-held.lock");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(lockPath, "");

  try {
    const waiting = waitForCodexThreadWriterAvailability({
      env: { CODEX_HOME: codexHome },
      occupancy: {
        agentControllerConversationId: "thread-held",
        contractVersion: 1,
        state: "occupied",
      },
      recoveryRetryMs: 50,
    });
    assert.equal(await waiting, "retry_due");
    assert.equal(await readFile(lockPath, "utf8"), "");
  } finally {
    await rm(codexHome, { force: true, recursive: true });
  }
});

test("codex writer wait backs off when an occupied thread lock is not visible", async () => {
  const { waitForCodexThreadWriterAvailability } = await import(
    "../dist/index.js"
  );
  const codexHome = await mkdtemp(join(tmpdir(), "codex-home-missing-lock-"));
  let settled = false;

  try {
    const waiting = waitForCodexThreadWriterAvailability({
      env: { CODEX_HOME: codexHome },
      missingLockRetryMs: 100,
      occupancy: {
        agentControllerConversationId: "thread-missing-lock",
        contractVersion: 1,
        state: "occupied",
      },
      recoveryRetryMs: 2000,
    }).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    assert.equal(await waiting, "retry_due");
  } finally {
    await rm(codexHome, { force: true, recursive: true });
  }
});

test("codex model-access errors offer recovery without claiming global retirement", async () => {
  const { classifyCodexProviderAccountFailure } = await import(
    "../dist/output/codex-provider-failure.js"
  );
  for (const message of [
    "Model not found gpt-5.4",
    "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account.",
  ]) {
    const failure = classifyCodexProviderAccountFailure({ message });
    assert.equal(failure.code, "model.unavailable");
    assert.equal(failure.providerAccessEvidence, undefined);
    assert.ok(failure.originalError);
  }
  for (const message of [
    "404 Not Found",
    "The server is temporarily unavailable",
    "Example: Model not found gpt-5.4",
  ]) {
    assert.equal(classifyCodexProviderAccountFailure({ message }), null);
  }
  assert.equal(
    classifyCodexProviderAccountFailure({ message: "401 Unauthorized" }).code,
    "auth.required"
  );
});

test("codex distinguishes subscription access from a transient rate limit", async () => {
  const { classifyCodexProviderAccountFailure } = await import(
    "../dist/output/codex-provider-failure.js"
  );

  const subscription = classifyCodexProviderAccountFailure({
    message: "This model is not available on your plan. Upgrade your plan.",
  });
  assert.equal(subscription.code, "provider.subscription_access_unavailable");
  assert.equal(
    subscription.providerAccessEvidence.reasonCode,
    "provider_account.subscription_access_unavailable"
  );

  const transientRateLimit = classifyCodexProviderAccountFailure({
    message: "429 Too Many Requests: rate limit exceeded",
  });
  assert.equal(transientRateLimit.code, "rate_limited");
  assert.equal(transientRateLimit.providerAccessEvidence, undefined);

  const overlappingTransientRateLimit = classifyCodexProviderAccountFailure({
    message:
      "429 Too Many Requests: usage limit reached for this billing window",
  });
  assert.equal(overlappingTransientRateLimit.code, "rate_limited");
  assert.equal(overlappingTransientRateLimit.providerAccessEvidence, undefined);
});

const CODEX_PLATFORM_LAYOUTS = {
  "darwin-arm64": {
    packageName: "@openai/codex-darwin-arm64",
    targetTriple: "aarch64-apple-darwin",
  },
  "darwin-x64": {
    packageName: "@openai/codex-darwin-x64",
    targetTriple: "x86_64-apple-darwin",
  },
  "linux-arm64": {
    packageName: "@openai/codex-linux-arm64",
    targetTriple: "aarch64-unknown-linux-musl",
  },
  "linux-x64": {
    packageName: "@openai/codex-linux-x64",
    targetTriple: "x86_64-unknown-linux-musl",
  },
};

const writeFakeCodexAppServerFixture = async (fixturePath) => {
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
      "if (process.argv.includes('mcp') && process.argv.includes('list')) { console.log('[]'); process.exit(0); }",
      "const logPath = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_LOG;",
      "const startupAttemptPath = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH;",
      "let startupAttempt = 1;",
      "if (startupAttemptPath) {",
      "  try { startupAttempt = Number(readFileSync(startupAttemptPath, 'utf8')) + 1; } catch {}",
      "  writeFileSync(startupAttemptPath, String(startupAttempt), 'utf8');",
      "}",
      "let buffer = '';",
      "let activeTurn = null;",
      "let completionTimer = null;",
      "let pendingServerRequest = null;",
      "const queuedServerRequests = JSON.parse(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REQUESTS ?? '[]');",
      "const sendServerRequest = (parsed) => { pendingServerRequest = { id: 700 + queuedServerRequests.length + 1, method: parsed.method }; write({ jsonrpc: '2.0', id: pendingServerRequest.id, method: parsed.method, params: parsed.params }); };",
      "let turnCompleted = false;",
      "let usageReads = 0;",
      "const write = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
      "const log = (message) => {",
      "  if (!logPath) return;",
      "  appendFileSync(logPath, JSON.stringify({",
      "    argv: process.argv.slice(2),",
      "    cwd: process.cwd(),",
      "    managedPackageRoot: process.env.CODEX_MANAGED_PACKAGE_ROOT ?? null,",
      "    method: message.method,",
      "    params: message.params ?? null,",
      "    result: message.result ?? null,",
      "  }) + '\\n', 'utf8');",
      "};",
      "const buildThread = (id, threadSource = 'user') => ({ id, sessionId: 'session-1', forkedFromId: null, parentThreadId: null, preview: '', ephemeral: false, modelProvider: 'openai', createdAt: 1, updatedAt: 1, status: 'idle', path: null, cwd: process.cwd(), cliVersion: 'fake', source: 'appServer', threadSource, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] });",
      "const buildCompletedTurn = (threadId, prompt, cwd) => {",
      "  const items = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_EMPTY_OUTPUT === '1' ? [] : [{ type: 'agentMessage', id: 'msg-1', text: 'app-server:' + process.cwd() + ':' + cwd + ':' + prompt, phase: null, memoryCitation: null }];",
      "  return { id: 'turn-1', items, itemsView: 'complete', status: 'completed', error: null, startedAt: 1, completedAt: 1, durationMs: 1 };",
      "};",
      "const buildFailedTurn = (message) => { const codexErrorInfo = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_CODEX_ERROR_INFO; return { id: 'turn-1', items: [], itemsView: 'complete', status: 'failed', error: codexErrorInfo ? { message, codexErrorInfo } : { message }, startedAt: 1, completedAt: 1, durationMs: 1 }; };",
      "const buildInterruptedTurn = () => ({ id: 'turn-1', items: [], itemsView: 'complete', status: 'interrupted', error: null, startedAt: 1, completedAt: 1, durationMs: 1 });",
      "const readDeltaOutput = () => {",
      "  const raw = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_DELTA_OUTPUT;",
      "  if (!raw) return [];",
      "  const parsed = JSON.parse(raw);",
      "  return Array.isArray(parsed) ? parsed : [];",
      "};",
      "const completeTurn = (status = 'completed') => {",
      "  if (!activeTurn || turnCompleted) return;",
      "  turnCompleted = true;",
      "  const failureMessage = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE;",
      "  const turn = status === 'interrupted' ? buildInterruptedTurn() : failureMessage ? buildFailedTurn(failureMessage) : buildCompletedTurn(activeTurn.threadId, activeTurn.prompt, activeTurn.cwd);",
      "  const tokenUsage = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TOKEN_USAGE;",
      // Codex can rebroadcast unchanged usage during a rate-limit update.
      "  if (tokenUsage) for (let repeat = 0; repeat < 2; repeat++) write({ jsonrpc: '2.0', method: 'thread/tokenUsage/updated', params: { threadId: activeTurn.threadId, turnId: activeTurn.turnId, tokenUsage: JSON.parse(tokenUsage) } });",
      "  if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_CONTEXT_COMPACTION === '1') write({ jsonrpc: '2.0', method: 'item/completed', params: { threadId: activeTurn.threadId, turnId: activeTurn.turnId, item: { id: 'compact-1', type: 'contextCompaction' } } });",
      "  for (const delta of readDeltaOutput()) {",
      "    write({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'msg-delta-1', delta } });",
      "  }",
      "  write({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId: activeTurn.threadId, turn } });",
      "};",
      "const handle = (message) => {",
      "  log(message);",
      "  if (!message.method && pendingServerRequest && message.id === pendingServerRequest.id) {",
      "    pendingServerRequest = null;",
      "    if (queuedServerRequests.length > 0) { sendServerRequest(queuedServerRequests.shift()); return; }",
      "    completeTurn('completed');",
      "    return;",
      "  }",
      "  if (message.method === 'initialize') {",
      "    const hangingStartupAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingStartupAttempts) return;",
      "    write({ jsonrpc: '2.0', id: message.id, result: { userAgent: process.env.OPENMELD_FAKE_CODEX_NATIVE_VERSION ? 'openmeld/' + process.env.OPENMELD_FAKE_CODEX_NATIVE_VERSION : 'fake-codex-app-server', codexHome: '/tmp/fake-codex-home', platformFamily: 'unix', platformOs: 'macos' } });",
      "    return;",
      "  }",
      "  if (message.method === 'initialized') return;",
      // Codex 0.162 generated GetAccountResponse / GetAccountRateLimitsResponse.
      "  if (message.method === 'account/read' && process.env.OPENMELD_FAKE_CODEX_USAGE_TIMEOUT === '1') { write({ id: message.id, result: { account: { type: 'chatgpt', email: 'usage@example.invalid', planType: 'plus' }, requiresOpenaiAuth: true } }); return; }",
      "  if (message.method === 'account/rateLimits/read' && process.env.OPENMELD_FAKE_CODEX_USAGE_TIMEOUT === '1') {",
      "    usageReads++;",
      "    const response = { accountId: 'test-workspace', ordinaryUsageAllowed: true, rateLimits: { limitId: 'codex', limitName: null, primary: { usedPercent: 23, windowDurationMins: 300, resetsAt: 1791600000 }, secondary: null, credits: { hasCredits: false, unlimited: false, balance: '0' }, planType: 'plus', spendControlReached: false, rateLimitReachedType: null }, rateLimitsByLimitId: null };",
      "    if (usageReads === 1) {",
      "      setTimeout(() => write({ method: 'account/rateLimits/updated', params: { rateLimits: response.rateLimits } }), 3000);",
      "      setTimeout(() => write({ id: message.id, result: { ...response, ordinaryUsageAllowed: false, rateLimits: { ...response.rateLimits, spendControlReached: true } } }), 4500);",
      "    } else write({ id: message.id, result: response });",
      "    return;",
      "  }",
      "  if (message.method === process.env.OPENMELD_FAKE_CODEX_MISSING_METHOD) { write({ id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }",
      "  if (message.method === 'config/read') { write({ id: message.id, result: { config: { mcp_servers: { openmeld_internal_dispatch_space_action: JSON.parse(process.env.OPENMELD_FAKE_CODEX_SPACE_POLICY ?? '{}') } }, origins: {}, layers: null } }); return; }",
      "  if (message.method === 'configRequirements/read') { write({ id: message.id, result: { requirements: JSON.parse(process.env.OPENMELD_FAKE_CODEX_MANAGED_REQUIREMENTS ?? 'null') } }); return; }",
      "  if (message.method === 'command/exec') { write({ jsonrpc: '2.0', id: message.id, result: { exitCode: 0, stdout: 'denied:denied:allowed:denied', stderr: '' } }); return; }",
      // A real 0.150.1 server with a responsive tools/list and stalled
      // resources/list returns toolsAndAuthOnly while full remains pending.
      "  if (message.method === 'mcpServerStatus/list') { if (message.params.detail === 'full' && process.env.OPENMELD_FAKE_CODEX_HANG_RESOURCES === '1') return; write({ jsonrpc: '2.0', id: message.id, result: JSON.parse(process.env.OPENMELD_FAKE_CODEX_MCP_INVENTORY ?? '{\"data\":[],\"nextCursor\":null}') }); return; }",
      "  if (message.method === 'collaborationMode/list') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: { data: [",
      "      { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' },",
      "      { name: 'Default', mode: 'default', model: null, reasoning_effort: null },",
      "    ] } });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/resume') {",
      "    const rejectResumeWriterAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_WRITER_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= rejectResumeWriterAttempts) {",
      "      write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'thread ' + message.params.threadId + ' already has an active writer' } });",
      "      return;",
      "    }",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_NO_ROLLOUT === '1') {",
      "      write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'no rollout found for thread id ' + message.params.threadId } });",
      "      return;",
      "    }",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_EPHEMERAL_RESUME === '1' && message.params.threadId === 'thread-fork-1') {",
      "      write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'no rollout found for thread id thread-fork-1' } });",
      "      return;",
      "    }",
      "    const hangingResumeAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_RESUME_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingResumeAttempts) return;",
      "    const model = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL === '1' ? {} : { model: process.env.OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_MODEL ?? 'gpt-5' };",
      "    const threadSource = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_SOURCE ?? 'user';",
      "    const scopedPermissions = message.params.permissions ? { activePermissionProfile: { id: message.params.permissions, extends: null }, runtimeWorkspaceRoots: [message.params.cwd], sandbox: { type: 'readOnly' } } : {};",
      "    const respond = () => write({ jsonrpc: '2.0', id: message.id, result: { thread: buildThread(message.params.threadId, threadSource), ...model, modelProvider: 'openai', serviceTier: null, cwd: message.params.cwd, instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'client', sandbox: { mode: 'read-only' }, ...scopedPermissions, reasoningEffort: process.env.OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_REASONING_EFFORT ?? null } });",
      "    const resumeResponseDelayMs = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_RESUME_RESPONSE_DELAY_MS ?? '0');",
      "    if (resumeResponseDelayMs > 0) setTimeout(respond, resumeResponseDelayMs); else respond();",
      "    return;",
      "  }",
      "  if (message.method === 'thread/fork') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: { thread: buildThread('thread-fork-1') } });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/read') {",
      "    const statuses = JSON.parse(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_READ_STATUSES ?? JSON.stringify(['completed']));",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_THREAD_READ === '1') {",
      "      write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'no rollout found for thread id ' + message.params.threadId } });",
      "      return;",
      "    }",
      "    const turns = statuses.map((status, index) => ({ id: 'turn-read-' + (index + 1), items: [], itemsView: 'complete', status, error: null, startedAt: 1, completedAt: status === 'completed' ? 1 : null, durationMs: null }));",
      "    write({ jsonrpc: '2.0', id: message.id, result: { thread: { ...buildThread(message.params.threadId, process.env.OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_SOURCE ?? 'user'), turns: message.params.includeTurns ? turns : [] } } });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/name/set') {",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_NAME_RESULT === 'hang') return;",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_NAME_RESULT === 'reject') { write({ jsonrpc: '2.0', id: message.id, error: { code: -32600, message: 'Name unavailable' } }); return; }",
      "    write({ jsonrpc: '2.0', id: message.id, result: {} });",
      "    return;",
      "  }",
      "  if (message.method === 'thread/start') {",
      "    if (message.params.dynamicTools && process.env.OPENMELD_FAKE_CODEX_REJECT_DYNAMIC_DEFINITION === '1') { write({ id: message.id, error: { code: -32600, message: 'Invalid request: unknown field `dynamicTools`' } }); return; }",
      "    const requiredMcpFailure = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REQUIRED_MCP_FAILURE;",
      "    if (requiredMcpFailure) { write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: requiredMcpFailure } }); return; }",
      "    const hangingThreadStartAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_THREAD_START_ATTEMPTS ?? '0');",
      "    if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_DIAGNOSTICS === '1') {",
      "      process.stderr.write('DEBUG session_init.mcp_manager_init: new secret=private-test-secret /private/customer-repo\\n');",
      "      write({ method: 'mcpServer/startupStatus/updated', params: { threadId: 'thread-private', name: 'private-server', status: 'starting', error: null } });",
      "    }",
      "    if (startupAttempt <= hangingThreadStartAttempts) return;",
      "    const model = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL === '1' ? {} : { model: 'gpt-5' };",
      "    write({ jsonrpc: '2.0', id: message.id, result: { thread: buildThread('thread-new-1', message.params.threadSource), ...model, modelProvider: 'openai', serviceTier: null, cwd: message.params.cwd, instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'client', sandbox: { mode: 'read-only' }, reasoningEffort: null } });",
      "    return;",
      "  }",
      "  if (message.method === 'turn/start') {",
      "    const hangingTurnStartAttempts = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_HANG_TURN_START_ATTEMPTS ?? '0');",
      "    if (startupAttempt <= hangingTurnStartAttempts) return;",
      "    const prompt = message.params.input[0].text;",
      "    const cwd = message.params.cwd;",
      "    const startDelayMs = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_START_RESPONSE_DELAY_MS ?? '0');",
      "    const onStart = () => {",
      "      write({ jsonrpc: '2.0', id: message.id, result: { turn: { id: 'turn-1', items: [], itemsView: 'complete', status: 'inProgress', error: null, startedAt: 1, completedAt: null, durationMs: null } } });",
      "      activeTurn = { cwd, prompt, threadId: message.params.threadId, turnId: 'turn-1' };",
      "      write({ method: 'turn/started', params: { threadId: activeTurn.threadId, turn: { id: activeTurn.turnId, status: 'inProgress', items: [] } } });",
      "      turnCompleted = false;",
      "      if (process.env.OPENMELD_FAKE_CODEX_USAGE_TIMEOUT === '1') write({ method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: null, secondary: null, credits: null, spendControlReached: null, rateLimitReachedType: null } } });",
      "      if (queuedServerRequests.length > 0) { sendServerRequest(queuedServerRequests.shift()); return; }",
      "      const serverRequest = process.env.OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST;",
      "      if (serverRequest) {",
      "        const parsed = JSON.parse(serverRequest);",
      "        pendingServerRequest = { id: 700, method: parsed.method };",
      "        write({ jsonrpc: '2.0', id: pendingServerRequest.id, method: parsed.method, params: parsed.params });",
      "        if (process.env.OPENMELD_FAKE_CODEX_APP_SERVER_EXIT_AFTER_REQUEST === '1') setImmediate(() => process.exit(0));",
      "        return;",
      "      }",
      "      const delayMs = Number(process.env.OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS ?? '10');",
      "      completionTimer = setTimeout(() => completeTurn('completed'), delayMs);",
      "    };",
      "    if (startDelayMs > 0) setTimeout(onStart, startDelayMs); else onStart();",
      "    return;",
      "  }",
      // Captured from the native Codex 0.160.1 TurnSettingsUpdateResponse.
      "  if (message.method === 'turn/settings/update') {",
      "    write({ id: message.id, result: { status: process.env.OPENMELD_FAKE_CODEX_PERMISSION_RECEIPT || 'applied' } }); return;",
      "  }",
      // Shape captured from Codex 0.150.1 generate-json-schema TurnSteerParams/
      // TurnSteerResponse and the official App Server turn/steer contract.
      // Rejections: openai/codex rust-v0.150.1, request_processors/turn_processor.rs.
      "  if (message.method === 'turn/steer') {",
      "    const mode = process.env.OPENMELD_FAKE_CODEX_STEER_MODE;",
      "    if (mode === 'withhold' || mode === 'stop-during') return;",
      "    if (mode === 'unsupported') { write({ id: message.id, error: { code: -32601, message: 'Method not found' } }); return; }",
      "    if (mode === 'target-ended') { write({ id: message.id, error: { code: -32600, message: 'no active turn to steer' } }); return; }",
      "    if (mode === 'target-changed') { write({ id: message.id, error: { code: -32600, message: 'expected active turn id `turn-1` but found `turn-2`' } }); return; }",
      "    if (mode === 'internal-error') { write({ id: message.id, error: { code: -32603, message: 'failed to steer turn' } }); return; }",
      "    if (!activeTurn || turnCompleted || message.params.expectedTurnId !== activeTurn.turnId || message.params.threadId !== activeTurn.threadId) { write({ id: message.id, error: { code: -32600, message: 'No matching active turn' } }); return; }",
      "    activeTurn.prompt += '\\n' + message.params.input[0].text;",
      "    write({ id: message.id, result: { turnId: mode === 'wrong-receipt' ? 'another-turn' : activeTurn.turnId } });",
      "    return;",
      "  }",
      "  if (message.method === 'turn/interrupt') {",
      "    write({ jsonrpc: '2.0', id: message.id, result: {} });",
      "    if (completionTimer) clearTimeout(completionTimer);",
      "    completeTurn('interrupted');",
      "    return;",
      "  }",
      "  write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unsupported method ' + message.method } });",
      "};",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => {",
      "  buffer += chunk;",
      "  while (true) {",
      "    const index = buffer.indexOf('\\n');",
      "    if (index < 0) break;",
      "    const line = buffer.slice(0, index).trim();",
      "    buffer = buffer.slice(index + 1);",
      "    if (line) handle(JSON.parse(line));",
      "  }",
      "});",
    ].join("\n"),
    "utf8"
  );
};

for (const scenario of [
  { name: "new native thread", version: "0.150.1", native: true },
  {
    name: "current controller queries only the alternate carrier",
    version: "0.160.0",
    native: true,
  },
  {
    name: "an active alternate carrier prevents a native turn",
    version: "0.160.0",
    native: true,
    // Fields from the native ListMcpServerStatusResponse capture in scoped-mcp.
    inventory: {
      data: [
        {
          name: "openmeld_internal_dispatch_space_action",
          runtimeStatus: "connected",
          pluginId: null,
          serverInfo: null,
          tools: {},
          toolsError: null,
          resources: [],
          resourceTemplates: [],
          authStatus: "unsupported",
        },
      ],
      nextCursor: null,
    },
    error: "context.space_tool_carrier_unverified",
  },
  {
    name: "an incomplete carrier inventory prevents a native turn",
    version: "0.160.0",
    native: true,
    inventory: { data: [], nextCursor: "1" },
    error: "context.space_tool_carrier_unverified",
  },
  {
    name: "native tools with a stalled ambient resource catalog",
    version: "0.150.1",
    native: true,
    hangResources: true,
  },
  {
    name: "bundled prerelease resumes the native conversation",
    version: "0.159.0-alpha.12.1",
    existing: true,
    source: "user/openmeld-space-tools-v1",
    native: true,
  },
  {
    name: "unsupported native conversation reports the controller version",
    version: "0.150.1-alpha.1",
    existing: true,
    source: "user/openmeld-space-tools-v1",
    error: "context.space_tool_version_unsupported",
  },
  { name: "older controller", version: "0.149.0", native: false },
  {
    name: "new conversation keeps MCP when policy capability is missing",
    version: "0.159.0-alpha.12.1",
    missingMethod: "configRequirements/read",
    native: false,
  },
  {
    name: "native conversation distinguishes missing policy capability",
    version: "0.159.0-alpha.12.1",
    existing: true,
    source: "user/openmeld-space-tools-v1",
    missingMethod: "configRequirements/read",
    error: "context.space_tool_capability_unavailable",
  },
  {
    name: "legacy MCP thread",
    version: "0.150.1",
    existing: true,
    native: false,
  },
  {
    name: "resumed native thread",
    version: "0.150.1",
    existing: true,
    source: "user/openmeld-space-tools-v1",
    native: true,
  },
  {
    name: "explicit MCP denial",
    version: "0.150.1",
    policy: { disabled_tools: ["reply"] },
    native: false,
  },
  {
    name: "explicit MCP approval",
    version: "0.150.1",
    policy: { default_tools_approval_mode: "prompt" },
    native: false,
  },
  {
    name: "custom configuration",
    version: "0.150.1",
    custom: true,
    native: false,
  },
  {
    name: "disabled server",
    version: "0.150.1",
    policy: { enabled: false },
    native: false,
  },
  {
    name: "explicit allowlist",
    version: "0.150.1",
    policy: { enabled_tools: [] },
    native: false,
  },
  {
    name: "per-tool policy",
    version: "0.150.1",
    policy: { tools: { reply: { approval_mode: "prompt" } } },
    native: false,
  },
  {
    name: "unknown future policy",
    version: "0.150.1",
    policy: { future_policy: "deny" },
    native: false,
  },
  {
    name: "managed restrictions",
    version: "0.150.1",
    requirements: { featureRequirements: { hooks: true } },
    native: false,
  },
  {
    name: "changed native-thread policy",
    version: "0.159.0-alpha.12.1",
    existing: true,
    source: "user/openmeld-space-tools-v1",
    policy: { disabled_tools: ["reply"] },
    error: "context.space_tool_policy_changed",
  },
  {
    name: "native repair fork",
    version: "0.150.1",
    existing: true,
    source: "user/openmeld-space-tools-v1",
    repair: true,
    native: true,
  },
  {
    name: "foreign thread callback",
    version: "0.150.1",
    native: true,
    request: { threadId: "foreign-thread" },
  },
  {
    name: "stale turn callback",
    version: "0.150.1",
    native: true,
    request: { turnId: "old-turn" },
  },
  {
    name: "unknown tool callback",
    version: "0.150.1",
    native: true,
    request: { tool: "openmeld_space_status" },
  },
  {
    name: "unknown handler result",
    version: "0.150.1",
    native: true,
    handlerThrows: true,
  },
  ...["codex:fullAccess", "codex:approveForMe", "codex:askForApproval"].map(
    (mode) => ({
      name: `delivery-only preserves ${mode}`,
      version: "0.150.1",
      native: true,
      existing: true,
      source: "user/openmeld-space-tools-v1",
      repair: true,
      deliveryOnly: true,
      mode,
    })
  ),
  {
    name: "delivery-only rejects unsupported controller",
    version: "0.149.0",
    deliveryOnly: true,
    error: "space.action.delivery_only_unsupported",
  },
  {
    name: "delivery-only preserves managed requirements",
    version: "0.150.1",
    deliveryOnly: true,
    requirements: { featureRequirements: { hooks: true } },
    error: "space.action.delivery_only_unverified",
  },
  {
    name: "pre-thread native rejection",
    version: "0.150.1",
    native: false,
    rejectedDefinition: true,
  },
]) {
  test(`codex Space Dynamic Tools preserve one transport: ${scenario.name}`, async () => {
    const { createCodexAdapter } = await import("../dist/index.js");
    const root = await mkdtemp(join(tmpdir(), "codex-space-tools-"));
    const scriptPath = join(root, "controller.mjs");
    const logPath = join(root, "rpc.jsonl");
    await writeFakeCodexAppServerFixture(scriptPath);
    const threadId = scenario.existing ? "existing-thread" : "thread-new-1";
    const executionThreadId = scenario.repair ? "thread-fork-1" : threadId;
    const calls = [];
    try {
      const result = await createCodexAdapter({
        codexTimeoutMs: 5000,
        launchContract: createNodeScriptLaunchContract(scriptPath),
      }).dispatch({
        agentId: "agt-demo",
        agentControllerConversationId: scenario.existing ? threadId : undefined,
        agentControllerPermissionMode:
          scenario.mode ??
          (scenario.custom ? "codex:customConfig" : "codex:askForApproval"),
        executionMode: scenario.repair ? "repair" : "normal",
        sourceEventId: "evt-delivery",
        spaceId: "space-1",
        taskId: "task-delivery",
        transportMode: "codex-app-server",
        runtimeContext: createRuntimeContext(root),
        prompt:
          "Use the supplied reply tool to explain that no repository is available.",
        spaceActionTools: {
          deliveryOnly: Boolean(scenario.deliveryOnly),
          tools: [
            {
              name: "reply",
              description: "Submit an explicit public reply.",
              inputSchema: z.strictObject({ message: z.string().min(1) }),
            },
          ],
          call: (name, args) => {
            calls.push({ name, args });
            if (scenario.handlerThrows) {
              return Promise.reject(new Error("Synthetic lost receipt"));
            }
            return Promise.resolve({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ status: "proposal_saved_locally" }),
                },
              ],
            });
          },
          close: () => undefined,
        },
        env: {
          HOME: root,
          CODEX_HOME: root,
          OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(root, "context.json"),
          OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: join(root, "openmeld"),
          OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_NATIVE_VERSION: scenario.version,
          OPENMELD_FAKE_CODEX_MCP_INVENTORY: scenario.inventory
            ? JSON.stringify(scenario.inventory)
            : undefined,
          OPENMELD_FAKE_CODEX_HANG_RESOURCES: scenario.hangResources
            ? "1"
            : "0",
          OPENMELD_FAKE_CODEX_MISSING_METHOD: scenario.missingMethod,
          ...(scenario.deliveryOnly
            ? { OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" }
            : {}),
          OPENMELD_FAKE_CODEX_SPACE_POLICY: JSON.stringify(
            scenario.policy ?? {}
          ),
          OPENMELD_FAKE_CODEX_MANAGED_REQUIREMENTS: JSON.stringify(
            scenario.requirements ?? null
          ),
          OPENMELD_FAKE_CODEX_REJECT_DYNAMIC_DEFINITION:
            scenario.rejectedDefinition ? "1" : "0",
          OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_SOURCE:
            scenario.source ?? "user",
          OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
            method: "item/tool/call",
            params: {
              threadId: executionThreadId,
              turnId: "turn-1",
              callId: "delivery-1",
              namespace: null,
              tool: "openmeld_space_reply",
              arguments: { message: "I cannot access the repository." },
              ...scenario.request,
            },
          }),
        },
      });
      const messages = await readFakeAppServerMessages(logPath);
      if (scenario.error) {
        assert.equal(result.status, "failed");
        assert.equal(result.errorCode, scenario.error);
        assert.equal(calls.length, 0);
        assert.equal(
          messages.some((message) => message.method === "turn/start"),
          false
        );
        return;
      }
      assert.equal(result.status, "success");
      const executed = scenario.native && !scenario.request;
      assert.equal(calls.length, executed ? 1 : 0);
      let threadMethod = scenario.existing ? "thread/resume" : "thread/start";
      if (scenario.repair) {
        threadMethod = "thread/fork";
      }
      const thread = messages.findLast(
        (message) => message.method === threadMethod
      );
      assert.equal(
        Boolean(thread.params.dynamicTools),
        scenario.native && !scenario.existing
      );
      if (scenario.native) {
        const inventory = messages.find(
          (message) => message.method === "mcpServerStatus/list"
        );
        assert.deepEqual(inventory.params, {
          threadId: executionThreadId,
          detail: scenario.deliveryOnly ? "full" : "toolsAndAuthOnly",
          ...(scenario.version === "0.160.0" && !scenario.deliveryOnly
            ? { serverName: "openmeld_internal_dispatch_space_action" }
            : {}),
          limit: 100,
        });
        assert.equal(
          messages.find((message) => message.method === "mcpServerStatus/list")
            .params.detail,
          scenario.deliveryOnly ? "full" : "toolsAndAuthOnly"
        );
        assert.equal(
          scenario.deliveryOnly
            ? thread.params.config.mcp_servers
                .openmeld_internal_dispatch_space_action.enabled
            : thread.params.config[
                "mcp_servers.openmeld_internal_dispatch_space_action.enabled"
              ],
          false
        );
        if (executed) {
          assert.deepEqual(calls[0], {
            name: "reply",
            args: { message: "I cannot access the repository." },
          });
        }
      }
      if (scenario.deliveryOnly) {
        const turn = messages.find(
          (message) => message.method === "turn/start"
        ).params;
        assert.deepEqual(turn.environments, []);
        assert.equal(thread.params.config["agents.enabled"], false);
        assert.equal(
          thread.params.approvalPolicy,
          scenario.mode === "codex:fullAccess" ? "never" : "on-request"
        );
        assert.equal(
          thread.params.sandbox,
          scenario.mode === "codex:fullAccess"
            ? "danger-full-access"
            : "workspace-write"
        );
        if (scenario.mode !== "codex:fullAccess") {
          assert.equal(
            thread.params.approvalsReviewer,
            scenario.mode === "codex:approveForMe" ? "auto_review" : "user"
          );
        }
      }
      if (scenario.existing) {
        assert.equal(
          messages.some((message) => message.method === "thread/start"),
          false
        );
        assert.equal(thread.params.threadId, threadId);
      }
      const callback = messages.find(
        (message) =>
          message.method === undefined && message.result?.success !== undefined
      );
      assert.equal(
        callback.result.success,
        Boolean(executed && !scenario.handlerThrows)
      );
      assert.equal(
        messages.filter((message) => message.method === "turn/start").length,
        1
      );
      if (scenario.rejectedDefinition) {
        assert.equal(
          messages.filter((message) => message.method === "thread/start")
            .length,
          2
        );
      }
      if (scenario.policy) {
        const argv = messages[0].argv.join("\n");
        assert.equal(argv.includes(".disabled_tools=[]"), false);
        assert.equal(
          argv.includes('.default_tools_approval_mode="approve"'),
          false
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

const readFakeAppServerMethods = async (logPath) => {
  const text = await readFile(logPath, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).method);
};

const readFakeAppServerMessages = async (logPath) => {
  const text = await readFile(logPath, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const waitForFakeAppServerMethod = async (
  logPath,
  expectedMethod,
  timeoutMs = 1000
) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const messages = await readFakeAppServerMessages(logPath);
      const message = messages.find(
        (candidate) => candidate.method === expectedMethod
      );
      if (message) {
        return message;
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for fake app-server ${expectedMethod}`);
};

const countDangerousBypassFlags = (args) =>
  args.filter((arg) => arg === DANGEROUS_BYPASS_FLAG).length;

const validateCodexTelemetry = (telemetry, input) => {
  if (!telemetry || typeof telemetry !== "object") {
    throw new Error("Expected codex telemetry to be an object");
  }

  const {
    completedAtMs,
    contextHealed,
    firstOutputAtMs,
    firstStdoutAtMs,
    invokedAtMs,
    previewEmitted,
    resumedContext,
    streamingMode,
  } = telemetry;

  if (typeof invokedAtMs !== "number") {
    throw new Error("Expected invokedAtMs to be a number");
  }

  if (typeof firstStdoutAtMs !== "number") {
    throw new Error("Expected firstStdoutAtMs to be a number");
  }

  if (typeof firstOutputAtMs !== "number") {
    throw new Error("Expected firstOutputAtMs to be a number");
  }

  if (typeof completedAtMs !== "number") {
    throw new Error("Expected completedAtMs to be a number");
  }

  if ("previewEmitted" in input && previewEmitted !== input.previewEmitted) {
    throw new Error("Expected previewEmitted to match fixture expectation");
  }

  if ("streamingMode" in input && streamingMode !== input.streamingMode) {
    throw new Error("Expected streamingMode to match fixture expectation");
  }

  if (resumedContext !== input.resumedContext) {
    throw new Error("Expected resumedContext to match fixture expectation");
  }

  if (firstStdoutAtMs < invokedAtMs) {
    throw new Error("Expected firstStdoutAtMs to be after invokedAtMs");
  }

  if (firstOutputAtMs < firstStdoutAtMs) {
    throw new Error("Expected firstOutputAtMs to be after firstStdoutAtMs");
  }

  if (completedAtMs < firstOutputAtMs) {
    throw new Error("Expected completedAtMs to be after firstOutputAtMs");
  }

  if ("contextHealed" in input) {
    if (contextHealed !== input.contextHealed) {
      throw new Error("Expected contextHealed to match fixture expectation");
    }
    return;
  }

  if (contextHealed !== undefined) {
    throw new Error("Expected contextHealed to be undefined");
  }
};

test("codex adapter dispatch uses dispatch-time runtime context for spawn cwd", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-dispatch-"));
  const fixturePath = join(fixtureDir, "codex-fixture-runtime-cwd.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-runtime-cwd-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: process.cwd() } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      enableLocalCliTransport: true,
    });

    const result = await adapter.dispatch({
      agentId: "agt-demo",
      prompt: "hello",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-runtime-cwd-1",
      spaceId: "space-1",
      taskId: "task-runtime-cwd-1",
    });

    const expectedDispatchDir = await realpath(dispatchDir);
    assert.equal(result.status, "success");
    assert.equal(result.output, expectedDispatchDir);
    assert.deepEqual(result.contextDelta, {
      agentControllerConversationId: "thread-runtime-cwd-1",
      agentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-runtime-cwd-1",
        agentControllerConversationKind: "thread",
      },
    });
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex adapter keeps runtime cwd isolated across different profiles on the same controller", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const profileADir = await mkdtemp(join(tmpdir(), "codex-profile-a-"));
  const profileBDir = await mkdtemp(join(tmpdir(), "codex-profile-b-"));
  const fixturePath = join(fixtureDir, "codex-fixture-profile-isolation.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const profileName = process.cwd().split('/').filter(Boolean).at(-1) ?? 'unknown';",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-' + profileName }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: process.cwd() } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      enableLocalCliTransport: true,
    });

    const resultA = await adapter.dispatch({
      agentId: "agt-profile-a",
      prompt: "hello from profile a",
      runtimeContext: createRuntimeContext(profileADir),
      sourceEventId: "evt-profile-a",
      spaceId: "space-1",
      taskId: "task-profile-a",
    });
    const resultB = await adapter.dispatch({
      agentId: "agt-profile-b",
      prompt: "hello from profile b",
      runtimeContext: createRuntimeContext(profileBDir),
      sourceEventId: "evt-profile-b",
      spaceId: "space-1",
      taskId: "task-profile-b",
    });

    const expectedProfileADir = await realpath(profileADir);
    const expectedProfileBDir = await realpath(profileBDir);
    assert.equal(resultA.status, "success");
    assert.equal(resultB.status, "success");
    assert.equal(resultA.output, expectedProfileADir);
    assert.equal(resultB.output, expectedProfileBDir);
    assert.notEqual(resultA.output, resultB.output);
    assert.equal(
      resultA.contextDelta?.agentControllerConversationId,
      `thread-${expectedProfileADir.split("/").filter(Boolean).at(-1)}`
    );
    assert.equal(
      resultB.contextDelta?.agentControllerConversationId,
      `thread-${expectedProfileBDir.split("/").filter(Boolean).at(-1)}`
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(profileADir, { force: true, recursive: true });
    await rm(profileBDir, { force: true, recursive: true });
  }
});

test("invokeCodexCliTransport builds valid exec args for repair and resume modes", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const tempDir = await mkdtemp(join(tmpdir(), "openmeld-codex-cli-args-"));
  const argsPath = join(tempDir, "args.json");
  const fakeBinPath = join(tempDir, "fake-codex.mjs");

  await writeFile(
    fakeBinPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argsPath = process.env.OPENMELD_CODEX_ARGS_PATH;
if (!argsPath) {
  throw new Error("OPENMELD_CODEX_ARGS_PATH is required");
}
writeFileSync(argsPath, JSON.stringify(process.argv.slice(2)));
readFileSync(0, "utf8");
console.log(JSON.stringify({ type: "response.completed", response: { output_text: "ok" } }));
`,
    "utf8"
  );
  await chmod(fakeBinPath, 0o755);

  try {
    await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      executionMode: "repair",
      prompt: "repair me",
      threadId: null,
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-s",
      "read-only",
      "-a",
      "on-request",
      "-c",
      'approvals_reviewer="user"',
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);

    await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      executionMode: "repair",
      prompt: "resume me",
      threadId: "thread-1",
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-s",
      "read-only",
      "-a",
      "on-request",
      "-c",
      'approvals_reviewer="user"',
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "thread-1",
      "-",
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps turn.failed sandbox denial to public runtime permission copy", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-cli-dispatch-"));
  const fixturePath = join(fixtureDir, "codex-fixture-permission.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-permission-1' }));",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'Command denied by sandbox: write access outside workspace' } }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        prompt: "write outside workspace",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, CODEX_COMMAND_DENIED_BY_SANDBOX_RE);
        assert.equal(
          resolveMappedPublicAgentFailureReason(error.code),
          RUNTIME_PERMISSION_DENIAL_COPY
        );
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexCliTransport applies Agent Controller Permission Mode flags in spawned argv", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const tempDir = await mkdtemp(join(tmpdir(), "openmeld-codex-policy-args-"));
  const argsPath = join(tempDir, "args.json");
  const fakeBinPath = join(tempDir, "fake-codex.mjs");

  await writeFile(
    fakeBinPath,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const argsPath = process.env.OPENMELD_CODEX_ARGS_PATH;
if (!argsPath) {
  throw new Error("OPENMELD_CODEX_ARGS_PATH is required");
}
writeFileSync(argsPath, JSON.stringify(process.argv.slice(2)));
readFileSync(0, "utf8");
console.log(JSON.stringify({ type: "response.completed", response: { output_text: "ok" } }));
`,
    "utf8"
  );
  await chmod(fakeBinPath, 0o755);

  try {
    await invokeCodexCliTransport({
      agentControllerPermissionMode: "codex:approveForMe",
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      prompt: "approve for me",
      threadId: "thread-approve-for-me",
    });

    assert.deepEqual(JSON.parse(await readFile(argsPath, "utf8")), [
      "-s",
      "workspace-write",
      "-a",
      "on-request",
      "-c",
      'approvals_reviewer="auto_review"',
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "thread-approve-for-me",
      "-",
    ]);

    await invokeCodexCliTransport({
      agentControllerPermissionMode: "codex:fullAccess",
      launchContract: createNodeScriptLaunchContract(fakeBinPath),
      codexTimeoutMs: 10_000,
      codexWorkdir: tempDir,
      env: {
        OPENMELD_CODEX_ARGS_PATH: argsPath,
      },
      prompt: "full access",
      threadId: "thread-bypass",
    });

    const bypassArgs = JSON.parse(await readFile(argsPath, "utf8"));
    assert.equal(countDangerousBypassFlags(bypassArgs), 1);
    assert.deepEqual(bypassArgs, [
      "exec",
      "resume",
      DANGEROUS_BYPASS_FLAG,
      "--json",
      "--skip-git-repo-check",
      "thread-bypass",
      "-",
    ]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport keeps the controller process out of the workspace while dispatching there", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-dispatch-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const runtimeEvents = [];
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_CONTEXT_COMPACTION: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_MODEL: "gpt-5.5",
        OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_REASONING_EFFORT: "xhigh",
        OPENMELD_FAKE_CODEX_APP_SERVER_TOKEN_USAGE: JSON.stringify({
          last: {
            cacheWriteInputTokens: 0,
            cachedInputTokens: 800,
            inputTokens: 1000,
            outputTokens: 40,
            reasoningOutputTokens: 20,
            totalTokens: 1060,
          },
          modelContextWindow: 258_400,
          total: {
            cacheWriteInputTokens: 0,
            cachedInputTokens: 1400,
            inputTokens: 1800,
            outputTokens: 70,
            reasoningOutputTokens: 30,
            totalTokens: 1900,
          },
        }),
      },
      onRuntimeEvent: (event) => {
        runtimeEvents.push(event);
      },
      agentControllerPermissionMode: "codex:approveForMe",
      prompt: "hello from app-server",
      taskId: "task-app-server-dispatch",
      threadId: "thread-existing-1",
    });
    const expectedControllerDir = await realpath(tmpdir());
    const methods = await readFakeAppServerMethods(logPath);
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(result.threadId, "thread-existing-1");
    assert.equal(
      messages[0].argv.some((arg) =>
        arg.startsWith("mcp_servers.openmeld_internal_dispatch_space_action.")
      ),
      false
    );
    assert.equal(
      result.output,
      `app-server:${expectedControllerDir}:${dispatchDir}:hello from app-server`
    );
    assert.deepEqual(methods, [
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
    const processSpawnedEvent = runtimeEvents.find(
      (event) => event.phase === "process_spawned"
    );
    assert.ok(processSpawnedEvent);
    const processExitedEvent = runtimeEvents.find(
      (event) => event.phase === "process_exit"
    );
    assert.ok(processExitedEvent);
    assert.equal(
      processExitedEvent.ownedProcessesQuiescent,
      process.platform === "win32" ? undefined : true
    );
    assert.throws(() => process.kill(processSpawnedEvent.processId, 0), {
      code: "ESRCH",
    });
    assert.equal(processSpawnedEvent.processLaunchKind, "package_entrypoint");
    assert.equal(
      processSpawnedEvent.processWorkingDirectoryKind,
      "runtime_host"
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params.cwd,
      dispatchDir
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params
        .excludeTurns,
      true
    );
    assert.equal(
      "model" in
        messages.find((message) => message.method === "thread/resume").params,
      false
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params.cwd,
      dispatchDir
    );
    const turnStartParams = messages.find(
      (message) => message.method === "turn/start"
    ).params;
    assert.equal("model" in turnStartParams, false);
    assert.equal("effort" in turnStartParams, false);
    // Official App Server TurnStartParams: summaries must be requested explicitly.
    assert.equal(turnStartParams.summary, "auto");
    assert.deepEqual(
      runtimeEvents
        .filter((event) => event.phase === "provider_conversation_observed")
        .map((event) => event.agentControllerConversationId),
      ["thread-existing-1"]
    );
    assert.deepEqual(
      runtimeEvents
        .filter((event) => event.phase === "provider_turn_accepted")
        .map((event) => ({
          agentControllerConversationId: event.agentControllerConversationId,
          turnId: event.turnId,
        })),
      [
        {
          agentControllerConversationId: "thread-existing-1",
          turnId: "turn-1",
        },
      ]
    );
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: true,
      streamingMode: "final",
    });
    assert.equal(result.telemetry.contextCompactionObserved, true);
    assert.equal(result.telemetry.aiUsage.length, 1);
    assert.equal(result.telemetry.aiUsage[0].model, "gpt-5.5");
    assert.deepEqual(result.telemetry.aiUsage[0].tokens, {
      input: 1000,
      output: 40,
      cacheRead: 800,
      cacheWrite: 0,
      reasoning: 20,
      total: 1060,
    });
    assert.equal(result.telemetry.aiUsage[0].cost, null);
    assert.deepEqual(result.telemetry.tokenUsage, {
      last: {
        cacheWriteInputTokens: 0,
        cachedInputTokens: 800,
        inputTokens: 1000,
        outputTokens: 40,
        reasoningOutputTokens: 20,
        totalTokens: 1060,
      },
      modelContextWindow: 258_400,
      total: {
        cacheWriteInputTokens: 0,
        cachedInputTokens: 1400,
        inputTokens: 1800,
        outputTokens: 70,
        reasoningOutputTokens: 30,
        totalTokens: 1900,
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server reports required MCP startup failure as task setup", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-required-mcp-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const originalError =
    "error creating thread: required MCP servers failed to initialize: openmeld_internal_dispatch_space_action";

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_REQUIRED_MCP_FAILURE: originalError,
        },
        prompt: "start the required task tools",
        taskId: "task-required-mcp-failure",
        threadId: null,
      }),
      (error) => {
        assert.equal(
          error.code,
          "execution_context.mcp_server_initialization_failed"
        );
        assert.equal(error.errorType, "config");
        assert.equal(error.rpcErrorCode, -32_603);
        assert.equal(error.originalError, originalError);
        assert.equal(
          error.message,
          "execution_context.mcp_server_initialization_failed: required tools could not start"
        );
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex app-server resumes a cold conversation beyond the metadata timeout without starting a replacement", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-cold-resume-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);
  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: null,
      codexWorkdir: fixtureDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_RESUME_RESPONSE_DELAY_MS: "16000",
      },
      prompt: "continue",
      taskId: "task-cold-resume",
      threadId: "thread-cold-resume",
    });
    const methods = await readFakeAppServerMethods(logPath);
    assert.equal(
      methods.filter((method) => method === "thread/resume").length,
      1
    );
    assert.equal(
      methods.filter((method) => method === "thread/start").length,
      0
    );
    assert.equal(methods.filter((method) => method === "turn/start").length, 1);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex app-server does not start a turn when Stop lands during thread resume", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-stop-resume-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-stop-resume-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const cancellation = new AbortController();
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const outcome = invokeCodexAppServerTransport({
      cancellationSignal: cancellation.signal,
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_RESUME_RESPONSE_DELAY_MS: "100",
      },
      prompt: "continue",
      taskId: "task-stop-during-resume",
      threadId: "thread-stop-during-resume",
    });

    await waitForFakeAppServerMethod(logPath, "thread/resume");
    cancellation.abort();
    await assert.rejects(
      outcome,
      (error) => error?.code === "runtime.turn.cancelled"
    );
    const methods = await readFakeAppServerMethods(logPath);

    assert.equal(
      methods.filter((method) => method === "thread/resume").length,
      1
    );
    assert.equal(methods.filter((method) => method === "turn/start").length, 0);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test(
  "codex app-server launches the official packaged native runtime without the Node wrapper",
  {
    skip:
      process.platform === "win32" ||
      !CODEX_PLATFORM_LAYOUTS[`${process.platform}-${process.arch}`],
  },
  async () => {
    const { invokeCodexAppServerTransport } = await import("../dist/index.js");
    const { buildCodexAppServerLaunch } = await import(
      "../dist/transport/codex-app-server-launch.js"
    );
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-runtime-"));
    const dispatchDir = await mkdtemp(
      join(tmpdir(), "codex-native-runtime-dispatch-")
    );
    const packageRoot = join(fixtureDir, "codex");
    const scriptPath = join(packageRoot, "bin", "codex.js");
    const layout =
      CODEX_PLATFORM_LAYOUTS[`${process.platform}-${process.arch}`];
    const platformPackageRoot = join(
      packageRoot,
      "node_modules",
      ...layout.packageName.split("/")
    );
    const nativePath = join(
      platformPackageRoot,
      "vendor",
      layout.targetTriple,
      "bin",
      "codex"
    );
    const logPath = join(fixtureDir, "rpc-log.jsonl");

    await mkdir(join(packageRoot, "bin"), { recursive: true });
    await mkdir(join(nativePath, ".."), { recursive: true });
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        bin: { codex: "bin/codex.js" },
        name: "@openai/codex",
      }),
      "utf8"
    );
    await writeFile(
      join(platformPackageRoot, "package.json"),
      JSON.stringify({ name: "@openai/codex" }),
      "utf8"
    );
    await writeFile(
      scriptPath,
      "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
      "utf8"
    );
    await writeFakeCodexAppServerFixture(nativePath);
    await chmod(scriptPath, 0o755);
    await chmod(nativePath, 0o755);

    try {
      const expectedNativePath = await realpath(nativePath);
      const expectedPackageRoot = await realpath(packageRoot);
      const launch = buildCodexAppServerLaunch({
        args: ["app-server", "--listen", "stdio://"],
        env: {},
        launchContract: {
          ...createNodeScriptLaunchContract(scriptPath),
          argsPrefix: ["--official-prefix"],
        },
      });
      assert.equal(launch.bin, expectedNativePath);
      assert.equal(launch.processLaunchKind, "native_binary");
      assert.deepEqual(launch.args, [
        "--official-prefix",
        "app-server",
        "--listen",
        "stdio://",
      ]);
      assert.equal(launch.env.CODEX_MANAGED_PACKAGE_ROOT, expectedPackageRoot);
      assert.equal(launch.env.CODEX_MANAGED_BY_NPM, "1");
      assert.equal(launch.env.CODEX_MANAGED_BY_BUN, undefined);
      assert.equal(launch.env.CODEX_MANAGED_BY_PNPM, undefined);
      const result = await invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(scriptPath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        },
        prompt: "launch the official packaged native runtime",
        taskId: "task-native-runtime",
        threadId: null,
      });
      const messages = await readFakeAppServerMessages(logPath);

      assert.match(result.output, NATIVE_RUNTIME_OUTPUT_RE);
      assert.equal(messages[0].managedPackageRoot, expectedPackageRoot);
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
      await rm(dispatchDir, { force: true, recursive: true });
    }
  }
);

test("codex app-server creates new OpenMeld threads with native developer instructions", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-new-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-native-new-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: { OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      prompt: "complete fallback prompt",
      taskId: "task-native-new",
      threadId: null,
    });

    const messages = await readFakeAppServerMessages(logPath);
    const threadStart = messages.find(
      (message) => message.method === "thread/start"
    );
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );

    assert.equal(
      threadStart.params.threadSource,
      "openmeld/openmeld-native-instructions-v1:abc123"
    );
    assert.equal(
      threadStart.params.developerInstructions,
      "stable OpenMeld contract"
    );
    assert.equal(turnStart.params.input[0].text, "current Wake only");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

for (const nameResult of ["success", "reject", "hang"]) {
  test(`codex app-server names new Sessions without blocking execution: ${nameResult}`, async () => {
    const { invokeCodexAppServerTransport } = await import("../dist/index.js");
    const dir = await mkdtemp(join(tmpdir(), "codex-session-title-"));
    const fixture = join(dir, "fake.mjs");
    const logPath = join(dir, "rpc.jsonl");
    await writeFakeCodexAppServerFixture(fixture);
    const events = [];
    try {
      const result = await invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixture),
        codexTimeoutMs: 5000,
        codexWorkdir: dir,
        controlRequestTimeoutMs: 500,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_NAME_RESULT: nameResult,
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "650",
        },
        newSessionTitle: "OpenMeld · Monica · Adjust the close button",
        onRuntimeEvent: (event) => events.push(event.phase),
        prompt: "Activation intent gate: internal instructions",
        taskId: "new-session-title",
        threadId: null,
      });
      assert.ok(result.output.includes("Activation intent gate"));
      assert.equal(events.includes("timeout_triggered"), false);
      const messages = await readFakeAppServerMessages(logPath);
      const nameRequests = messages.filter(
        (message) => message.method === "thread/name/set"
      );
      assert.equal(nameRequests.length, 1);
      assert.deepEqual(nameRequests[0].params, {
        name: "OpenMeld · Monica · Adjust the close button",
        threadId: "thread-new-1",
      });
      assert.ok(
        messages.indexOf(nameRequests[0]) >
          messages.findIndex((message) => message.method === "turn/start")
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
}

test("codex app-server can stop while new Session naming never responds", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const dir = await mkdtemp(join(tmpdir(), "codex-title-stop-"));
  const fixture = join(dir, "fake.mjs");
  const logPath = join(dir, "rpc.jsonl");
  const cancellation = new AbortController();
  await writeFakeCodexAppServerFixture(fixture);
  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixture),
      codexTimeoutMs: 5000,
      codexWorkdir: dir,
      cancellationSignal: cancellation.signal,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_NAME_RESULT: "hang",
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "3000",
      },
      newSessionTitle: "OpenMeld · Stop this task",
      onRuntimeEvent: (event) => {
        if (event.phase === "provider_turn_accepted") {
          cancellation.abort();
        }
      },
      prompt: "work",
      taskId: "title-stop",
      threadId: null,
    });
    assert.equal(result.output, "");
    const messages = await readFakeAppServerMessages(logPath);
    assert.equal(
      messages.filter((message) => message.method === "thread/name/set").length,
      1
    );
    assert.equal(
      messages.filter((message) => message.method === "turn/interrupt").length,
      1
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("codex app-server keeps the complete fallback prompt for legacy resumed threads", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-legacy-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-native-legacy-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: { OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "current Wake only",
      },
      prompt: "complete fallback prompt",
      taskId: "task-native-legacy",
      newSessionTitle: "OpenMeld · Do not replace this user's title",
      threadId: "legacy-thread",
    });

    const messages = await readFakeAppServerMessages(logPath);
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );
    assert.equal(turnStart.params.input[0].text, "complete fallback prompt");
    assert.equal(
      messages.some((message) => message.method === "thread/name/set"),
      false
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test(
  "codex auxiliary quota timeout permits later observations and ignores late replies without ending the turn",
  { timeout: 10_000 },
  async () => {
    const { invokeCodexAppServerTransport } = await import("../dist/index.js");
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-usage-timeout-"));
    const fixturePath = join(fixtureDir, "app-server.mjs");
    const logPath = join(fixtureDir, "rpc-log.jsonl");
    await writeFakeCodexAppServerFixture(fixturePath);
    const events = [];
    try {
      const result = await invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: null,
        codexWorkdir: fixtureDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "5500",
          OPENMELD_FAKE_CODEX_USAGE_TIMEOUT: "1",
        },
        onRuntimeEvent: (event) => events.push(event),
        prompt: "continue the business turn",
        taskId: "usage-timeout-turn",
        threadId: "usage-timeout-thread",
      });
      assert.ok(result.output.includes("continue the business turn"));
      const observations = events.filter(
        (event) => event.phase === "provider_usage_limits_observed"
      );
      assert.equal(observations.length, 1);
      assert.equal(observations[0].usageAdmission.blocksNewWork, false);
      assert.equal(observations[0].usageLimits[0].usedPercent, 23);
      assert.equal(
        events.some((event) => event.phase === "timeout_triggered"),
        false
      );
      const requests = await readFakeAppServerMessages(logPath);
      assert.equal(
        requests.filter((item) => item.method === "account/rateLimits/read")
          .length,
        3
      );
      assert.equal(
        requests.filter((item) => item.method === "turn/start").length,
        1
      );
      assert.equal(
        requests.some((item) => item.method === "turn/interrupt"),
        false
      );
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  }
);

test("codex app-server reuses the native user prompt on matching resumed threads", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-native-resume-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-native-resume-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_SOURCE:
          "openmeld/openmeld-native-instructions-v1:abc123",
      },
      instructionPrompt: {
        developerInstructions: "stable OpenMeld contract",
        instructionEpoch: "openmeld-native-instructions-v1:abc123",
        userPrompt: "second Wake only",
      },
      prompt: "complete second fallback prompt",
      taskId: "task-native-resume",
      threadId: "native-thread",
    });

    const messages = await readFakeAppServerMessages(logPath);
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );
    assert.equal(turnStart.params.input[0].text, "second Wake only");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server waits for an OpenMeld permission response and resumes the same turn", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-interaction-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-interaction-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "item/commandExecution/requestApproval",
          params: {
            availableDecisions: [
              "accept",
              "acceptForSession",
              "decline",
              "cancel",
            ],
            command: "git push origin feature",
            cwd: dispatchDir,
            itemId: "command-1",
            reason: "This command needs network access.",
            startedAtMs: Date.now(),
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          kind: "permission",
          optionId: request.options.find(
            (option) => option.intent === "allow_session"
          ).optionId,
        });
      },
      agentControllerPermissionMode: "codex:askForApproval",
      prompt: "push the branch",
      taskId: "task-app-server-interaction",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.equal(result.threadId, "thread-existing-1");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], {
      description: "This command needs network access.",
      kind: "permission",
      options: [
        {
          intent: "allow_once",
          label: "Allow once",
          optionId: "codex-command-decision-0",
        },
        {
          intent: "allow_session",
          label: "Allow for this session",
          optionId: "codex-command-decision-1",
        },
        {
          intent: "deny",
          label: "Deny",
          optionId: "codex-command-decision-2",
        },
      ],
      subject: {
        command: "git push origin feature",
        cwd: dispatchDir,
        type: "command",
      },
      title: "Allow Codex to run this command?",
    });
    assert.deepEqual(response.result, { decision: "acceptForSession" });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex restores the owner's reviewer when leaving a live Full access switch", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "codex-full-access-restore-")
  );
  const fixturePath = join(fixtureDir, "app-server.mjs");
  const logPath = join(fixtureDir, "rpc.jsonl");
  await writeFakeCodexAppServerFixture(fixturePath);
  let activeTurn;
  let accepted;
  const turnAccepted = new Promise((resolve) => {
    accepted = resolve;
  });
  try {
    const execution = invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: fixtureDir,
      agentControllerPermissionMode: "codex:askForApproval",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "60000",
        OPENMELD_FAKE_CODEX_NATIVE_VERSION: "0.160.1",
        OPENMELD_FAKE_CODEX_PERMISSION_RECEIPT: "applied",
      },
      taskId: "restore-task",
      threadId: "restore-thread",
      prompt: "Continue working",
      onActiveTurn: (turn) => {
        activeTurn = turn;
        return () => undefined;
      },
      onRuntimeEvent: (event) => {
        if (event.phase === "provider_turn_accepted") {
          accepted();
        }
      },
    });
    await Promise.race([
      turnAccepted,
      execution.then(() => assert.fail("Turn ended before admission")),
    ]);
    const statuses = [];
    for (const agentControllerPermissionMode of [
      "codex:approveForMe",
      "codex:fullAccess",
      "codex:askForApproval",
    ]) {
      statuses.push(
        (
          await activeTurn.updatePermissionMode({
            taskId: "restore-task",
            agentControllerPermissionMode,
          })
        ).status
      );
    }
    assert.deepEqual(statuses, ["applied", "applied", "applied"]);
    const reviewers = (await readFakeAppServerMessages(logPath))
      .filter((message) => message.method === "turn/settings/update")
      .map((message) => message.params.approvalsReviewer);
    // Leaving Full access must put Codex back on the owner's reviewer, not
    // leave the earlier Approve for me reviewer in place.
    assert.deepEqual(reviewers, ["auto_review", "user"]);
    await activeTurn.interrupt();
    await execution;
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex app-server answers later permission requests after a live switch to Full access", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-live-full-access-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-live-full-access-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);
  const commandRequest = (command) => ({
    method: "item/commandExecution/requestApproval",
    params: {
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      command,
      cwd: dispatchDir,
      itemId: `command-${command}`,
      reason: "This command needs network access.",
      startedAtMs: Date.now(),
      threadId: "thread-existing-1",
      turnId: "turn-1",
    },
  });

  try {
    const asked = [];
    let activeTurn;
    let updateResult;
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUESTS: JSON.stringify([
          commandRequest("git push origin feature"),
          commandRequest("npm publish --dry-run"),
          {
            method: "item/permissions/requestApproval",
            params: {
              cwd: dispatchDir,
              permissions: { network: { enabled: true } },
              reason: "Needs network access.",
              threadId: "thread-existing-1",
              turnId: "turn-1",
            },
          },
          {
            method: "mcpServer/elicitation/request",
            params: {
              message: "Sign in to continue.",
              mode: "url",
              serverName: "Docs",
              threadId: "thread-existing-1",
              turnId: "turn-1",
              url: "https://example.com/oauth",
            },
          },
        ]),
      },
      onActiveTurn: (turn) => {
        activeTurn = turn;
        return () => undefined;
      },
      onInteractionRequest: async (request) => {
        asked.push(request.subject.command ?? request.subject.resource);
        updateResult ??= await activeTurn.updatePermissionMode({
          agentControllerPermissionMode: "codex:fullAccess",
          taskId: "task-live-full-access",
        });
        return {
          kind: "permission",
          optionId: request.options.find(
            (option) => option.intent === "allow_once"
          ).optionId,
        };
      },
      agentControllerPermissionMode: "codex:askForApproval",
      prompt: "publish the package",
      taskId: "task-live-full-access",
      threadId: "thread-existing-1",
    });

    assert.deepEqual(updateResult, {
      effectiveFrom: "subsequent_tool_requests",
      status: "applied",
      taskId: "task-live-full-access",
    });
    // Approvals stop, but an MCP sign-in step still goes to the owner.
    assert.deepEqual(asked, [
      "git push origin feature",
      "https://example.com/oauth",
    ]);
    const responses = (await readFakeAppServerMessages(logPath)).filter(
      (message) => message.method === undefined && message.result
    );
    assert.deepEqual(
      responses.slice(-4, -1).map((message) => message.result),
      [
        { decision: "accept" },
        { decision: "accept" },
        {
          permissions: { network: { enabled: true } },
          scope: "turn",
          strictAutoReview: true,
        },
      ]
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server fails promptly when it exits during a human decision", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-exit-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-exit-dispatch-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  let resolveInteraction;
  const interactionResponse = new Promise((resolve) => {
    resolveInteraction = resolve;
  });

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const startedAt = Date.now();
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_EXIT_AFTER_REQUEST: "1",
          OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
            method: "item/commandExecution/requestApproval",
            params: {
              availableDecisions: ["accept", "decline"],
              command: "git push origin feature",
              itemId: "command-1",
              threadId: "thread-existing-1",
              turnId: "turn-1",
            },
          }),
        },
        onInteractionRequest: () => interactionResponse,
        agentControllerPermissionMode: "codex:askForApproval",
        prompt: "push the branch",
        taskId: "task-app-server-exit",
        threadId: "thread-existing-1",
      }),
      (error) => error?.code === "upstream_unreachable"
    );
    assert.ok(Date.now() - startedAt < 1000);

    resolveInteraction({
      kind: "permission",
      optionId: "codex-command-decision-0",
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server carries request_user_input questions and returns provider answer values", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-question-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-question-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "item/tool/requestUserInput",
          params: {
            autoResolutionMs: null,
            itemId: "question-1",
            questions: [
              {
                header: "Deployment",
                id: "environment",
                isOther: true,
                isSecret: false,
                options: [
                  {
                    description: "Use the local development lane.",
                    label: "Localhost",
                  },
                  {
                    description: "Use the production lane.",
                    label: "Production",
                  },
                ],
                question: "Where should I run the smoke test?",
              },
            ],
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          answers: [
            {
              questionId: request.questions[0].questionId,
              values: [request.questions[0].options[0].optionId],
            },
          ],
          kind: "question",
        });
      },
      conversationPolicy: {
        collaborationMode: "plan",
      },
      prompt: "run smoke",
      taskId: "task-app-server-question",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const turnStart = messages.find(
      (message) => message.method === "turn/start"
    );
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.deepEqual(
      messages
        .filter((message) => message.method)
        .map((message) => message.method)
        .filter((method) => method === "collaborationMode/list"),
      ["collaborationMode/list"]
    );
    assert.deepEqual(turnStart.params.collaborationMode, {
      mode: "plan",
      settings: {
        developer_instructions: null,
        model: "gpt-5",
        reasoning_effort: "medium",
      },
    });
    assert.deepEqual(requests, [
      {
        kind: "question",
        questions: [
          {
            allowOther: true,
            header: "Deployment",
            multiple: false,
            options: [
              {
                description: "Use the local development lane.",
                label: "Localhost",
                optionId: "environment-option-0",
              },
              {
                description: "Use the production lane.",
                label: "Production",
                optionId: "environment-option-1",
              },
            ],
            prompt: "Where should I run the smoke test?",
            questionId: "environment",
          },
        ],
        title: "Codex needs your input",
      },
    ]);
    assert.deepEqual(response.result, {
      answers: {
        environment: {
          answers: ["Localhost"],
        },
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server carries MCP form elicitations and preserves typed values", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-mcp-form-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-mcp-form-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "mcpServer/elicitation/request",
          params: {
            message: "Choose where and how to deploy.",
            mode: "form",
            requestedSchema: {
              properties: {
                region: {
                  description: "Choose a region.",
                  oneOf: [
                    { const: "us-east-1", title: "US East" },
                    { const: "us-west-2", title: "US West" },
                  ],
                  title: "Region",
                  type: "string",
                },
                dry_run: {
                  description: "Run without applying changes?",
                  type: "boolean",
                },
                replicas: {
                  description: "How many replicas?",
                  type: "integer",
                },
              },
              required: ["region", "replicas"],
              type: "object",
            },
            serverName: "deployment",
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          answers: request.questions.map((question) => {
            if (question.header === "Region") {
              return {
                questionId: question.questionId,
                values: [question.options[0].optionId],
              };
            }
            if (question.header === "dry_run") {
              return {
                questionId: question.questionId,
                values: [
                  question.options.find((option) => option.label === "Skip")
                    .optionId,
                ],
              };
            }
            return {
              questionId: question.questionId,
              values: ["3"],
            };
          }),
          kind: "question",
        });
      },
      prompt: "deploy the service",
      taskId: "task-app-server-mcp-form",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].kind, "question");
    assert.equal(requests[0].title, "deployment needs your input");
    assert.equal(requests[0].questions.length, 3);
    assert.deepEqual(
      requests[0].questions[0].options.map((option) => option.label),
      ["US East", "US West"]
    );
    assert.deepEqual(
      requests[0].questions[1].options.map((option) => option.label),
      ["Yes", "No", "Skip"]
    );
    assert.equal(requests[0].questions[2].allowOther, true);
    assert.deepEqual(response.result, {
      action: "accept",
      content: {
        region: "us-east-1",
        replicas: 3,
      },
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server carries MCP URL elicitations", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-mcp-url-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-mcp-url-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const requests = [];
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "mcpServer/elicitation/request",
          params: {
            elicitationId: "oauth-1",
            message: "Connect your deployment account.",
            mode: "url",
            serverName: "deployment",
            threadId: "thread-existing-1",
            turnId: "turn-1",
            url: "https://example.com/connect",
          },
        }),
      },
      onInteractionRequest: (request) => {
        requests.push(request);
        return Promise.resolve({
          kind: "permission",
          optionId: request.options[0].optionId,
        });
      },
      prompt: "connect the deployment account",
      taskId: "task-app-server-mcp-url",
      threadId: "thread-existing-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const response = messages.find(
      (message) => message.method === undefined && message.result
    );

    assert.deepEqual(requests, [
      {
        description: "Connect your deployment account.",
        kind: "permission",
        options: [
          {
            intent: "allow_once",
            label: "I've completed this step",
            optionId: "codex-mcp-elicitation-completed",
          },
          {
            intent: "deny",
            label: "Decline",
            optionId: "codex-mcp-elicitation-decline",
          },
        ],
        subject: {
          resource: "https://example.com/connect",
          type: "tool",
        },
        title: "deployment needs your attention",
      },
    ]);
    assert.deepEqual(response.result, { action: "accept" });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server interrupts the active turn when a person cancels a question", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(
    join(tmpdir(), "codex-app-question-cancel-")
  );
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-question-cancel-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
    });
    const result = await adapter.dispatch({
      agentId: "agt-codex-question-cancel",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REQUEST: JSON.stringify({
          method: "item/tool/requestUserInput",
          params: {
            itemId: "question-1",
            questions: [
              {
                header: "Deployment",
                id: "environment",
                isOther: true,
                isSecret: false,
                options: [],
                question: "Where should I run the smoke test?",
              },
            ],
            threadId: "thread-existing-1",
            turnId: "turn-1",
          },
        }),
      },
      onInteractionRequest: () => ({ kind: "cancel" }),
      prompt: "ask before running smoke",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-codex-question-cancel",
      spaceId: "space-1",
      taskId: "task-codex-question-cancel",
      transportMode: "codex-app-server",
    });
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "interaction.cancelled");
    assert.deepEqual(
      messages.find((message) => message.method === "turn/interrupt")?.params,
      {
        threadId: "thread-existing-1",
        turnId: "turn-1",
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server transport maps failed turn approval denial to public runtime permission copy", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const { resolveMappedPublicAgentFailureReason } = await import(
    "../../../../packages/schemas/dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-dispatch-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE:
            "Execution denied: Execution forbidden by policy",
        },
        prompt: "run a blocked command",
        taskId: "task-app-server-permission",
        threadId: "thread-existing-1",
      }),
      (error) => {
        assert.equal(error.code, "permission.denied.runtime");
        assert.equal(error.errorType, "adapter");
        assert.match(error.message, CODEX_EXECUTION_DENIED_RE);
        assert.equal(
          resolveMappedPublicAgentFailureReason(error.code),
          RUNTIME_PERMISSION_DENIAL_COPY
        );
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server transport submits structured Usage exhaustion and a bounded original error", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-dispatch-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const usageLimitMessage =
    "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:03 AM.";

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE:
            usageLimitMessage,
          OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_CODEX_ERROR_INFO:
            "usageLimitExceeded",
        },
        prompt: "reply",
        taskId: "task-app-server-usage-limit",
        threadId: "thread-existing-1",
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(
          error.providerAccessEvidence.reasonCode,
          "usage_exhausted"
        );
        assert.equal(error.message, usageLimitMessage);
        assert.equal(error.originalError, usageLimitMessage);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server preserves an unfamiliar structured failure message", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-original-error-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const message =
    "The upstream service ended this request.\nReference: request-42.";
  await writeFakeCodexAppServerFixture(fixturePath);
  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: fixtureDir,
        env: { OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE: message },
        prompt: "reply",
        taskId: "task-original-error",
        threadId: "thread-existing-1",
      }),
      (error) => {
        assert.equal(error.code, "runtime.turn.failed");
        assert.equal(error.originalError, message);
        assert.equal(error.providerAccessEvidence, undefined);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli retains unfamiliar structured errors but excludes sensitive messages", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-original-error-"));
  const fixturePath = join(fixtureDir, "error.mjs");
  try {
    for (const [message, expected] of [
      [
        "The upstream service ended this request.\nReference: request-42.",
        "The upstream service ended this request.\nReference: request-42.",
      ],
      ["Request rejected: access_token=private-test-value", undefined],
    ]) {
      const event = { type: "turn.failed", error: { message } };
      await writeFile(
        fixturePath,
        `console.log(${JSON.stringify(JSON.stringify(event))});`,
        "utf8"
      );
      await assert.rejects(
        invokeCodexCliTransport({
          launchContract: createNodeScriptLaunchContract(fixturePath),
          codexTimeoutMs: 5000,
          codexWorkdir: fixtureDir,
          prompt: "reply",
          threadId: null,
        }),
        (error) => {
          assert.equal(error.originalError, expected);
          assert.equal(error.providerAccessEvidence, undefined);
          return true;
        }
      );
    }
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli text can explain Usage exhaustion without changing Wakeability", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-usage-limit.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: \"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:03 AM.\" } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 1000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.match(error.message, USAGE_LIMIT_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex adapter interrupts active app-server turns by task id", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-interrupt-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-interrupt-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
    });
    const dispatchPromise = adapter.dispatch({
      agentId: "agt-codex-interrupt",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "5000",
      },
      prompt: "keep working until interrupted",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-codex-interrupt",
      spaceId: "space-1",
      taskId: "task-codex-interrupt",
      transportMode: "codex-app-server",
    });

    await waitForFakeAppServerMethod(logPath, "turn/start");
    const interruptResult = await adapter.interrupt({
      mode: "force",
      reason: "wake.stop",
      taskId: "task-codex-interrupt",
    });
    const dispatchResult = await dispatchPromise;
    const messages = await readFakeAppServerMessages(logPath);
    const interruptMessage = messages.find(
      (message) => message.method === "turn/interrupt"
    );

    assert.deepEqual(interruptResult, {
      accepted: true,
      plan: {
        initial: {
          mode: "force",
          reason: "wake.stop",
          taskId: "task-codex-interrupt",
        },
      },
      reasonCode: "accepted",
      signalDelivery: "sent",
      taskId: "task-codex-interrupt",
    });
    assert.equal(dispatchResult.status, "success");
    assert.equal(dispatchResult.output, "");
    assert.deepEqual(interruptMessage.params, {
      threadId: "thread-new-1",
      turnId: "turn-1",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("stop evidence records turnWasRunning=true when cancelled while turn/start is in flight", async () => {
  const { createCodexAdapter, READ_CODEX_DISPATCH_STOP_EVIDENCE } =
    await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-stop-ack-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-stop-ack-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const adapter = createCodexAdapter({
      launchContract: createNodeScriptLaunchContract(fixturePath),
    });
    const dispatchOutcome = adapter.dispatch({
      agentControllerConversationId: "thread-stop-during-start",
      agentId: "agt-demo",
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_START_RESPONSE_DELAY_MS: "300",
      },
      prompt: "continue",
      runtimeContext: createRuntimeContext(dispatchDir),
      sourceEventId: "evt-stop-during-start",
      spaceId: "space-1",
      taskId: "task-stop-during-start",
      transportMode: "codex-app-server",
    });

    await waitForFakeAppServerMethod(logPath, "turn/start");
    const controlResult = await adapter.cancel({
      taskId: "task-stop-during-start",
    });
    await dispatchOutcome;

    assert.equal(controlResult.accepted, true);
    const stopEvidence = adapter[READ_CODEX_DISPATCH_STOP_EVIDENCE](
      "task-stop-during-start"
    );
    assert.ok(stopEvidence, "stopEvidence should be recorded");
    assert.equal(
      stopEvidence.turnWasRunning,
      true,
      "turnWasRunning must be true when cancelled while turn/start is in flight"
    );

    // Repeated stop should not overwrite turnWasRunning to false
    await adapter.cancel({
      taskId: "task-stop-during-start",
    });
    const stopEvidenceAfter = adapter[READ_CODEX_DISPATCH_STOP_EVIDENCE](
      "task-stop-during-start"
    );
    assert.equal(
      stopEvidenceAfter.turnWasRunning,
      true,
      "repeated stop must preserve turnWasRunning=true"
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport preserves thread id when app-server turn completes without agent output", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-empty-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-empty-dispatch-")
  );
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_EMPTY_OUTPUT: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      prompt: "reply through openmeld space action only",
      taskId: "task-app-server-empty-output",
      threadId: "thread-existing-empty-1",
    });
    const methods = await readFakeAppServerMethods(logPath);

    assert.equal(result.threadId, "thread-existing-empty-1");
    assert.equal(result.output, "");
    assert.deepEqual(methods, [
      "initialize",
      "initialized",
      "thread/resume",
      "turn/start",
    ]);
    assert.equal(result.telemetry.resumedContext, true);
    assert.equal(result.telemetry.firstOutputAtMs, undefined);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServer retries one startup timeout before beginning a turn", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-startup-retry-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-startup-retry-dispatch-")
  );
  const attemptPath = join(fixtureDir, "startup-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServer({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: null,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS: "1",
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
      },
      onProcessControlEvent: (event) => processEvents.push(event),
      prompt: "start safely after one transient bootstrap failure",
      startupTimeoutMs: 500,
      taskId: "task-app-server-startup-retry",
      threadId: null,
    });

    assert.match(result.output, STARTUP_RETRY_OUTPUT_RE);
    const methods = await readFakeAppServerMethods(logPath);
    assert.equal(methods.filter((method) => method === "initialize").length, 2);
    assert.equal(methods.filter((method) => method === "turn/start").length, 1);
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      2
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServer stops after one automatic startup retry", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-startup-fail-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-startup-fail-dispatch-")
  );
  const attemptPath = join(fixtureDir, "startup-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServer({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: null,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS: "2",
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
        },
        onProcessControlEvent: (event) => processEvents.push(event),
        prompt: "do not retry indefinitely",
        startupTimeoutMs: 500,
        taskId: "task-app-server-startup-fail",
        threadId: null,
      }),
      (error) =>
        error.code === "runtime.startup_timeout" &&
        error.errorType === "timeout" &&
        error.originalError.includes("did not initialize") &&
        STARTUP_RETRY_FAILURE_RE.test(error.message)
    );
    const methods = await readFakeAppServerMethods(logPath);
    assert.deepEqual(methods, ["initialize", "initialize"]);
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      2
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex app-server admission budgets allow cold start and resume", async () => {
  const { resolveCodexAppServerControlRequestTimeoutMs } = await import(
    "../dist/transport/codex-app-server-admission.js"
  );

  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "thread/resume",
    }),
    90_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "collaborationMode/list",
    }),
    15_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "thread/start",
    }),
    90_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "turn/start",
    }),
    90_000
  );
  assert.equal(
    resolveCodexAppServerControlRequestTimeoutMs({
      operation: "thread/start",
      overrideMs: 50,
    }),
    50
  );
});

for (const handshakeFailures of [0, 1]) {
  test(`invokeCodexAppServer does not retry an unacknowledged thread creation after ${handshakeFailures} handshake failures`, async () => {
    const { invokeCodexAppServer } = await import("../dist/index.js");
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-thread-create-timeout-")
    );
    const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
    const logPath = join(fixtureDir, "rpc-log.jsonl");
    const processEvents = [];
    await writeFakeCodexAppServerFixture(fixturePath);
    await chmod(fixturePath, 0o755);
    try {
      await assert.rejects(
        invokeCodexAppServer({
          launchContract: createNodeScriptLaunchContract(fixturePath),
          codexTimeoutMs: null,
          codexWorkdir: fixtureDir,
          controlRequestTimeoutMs: 100,
          env: {
            OPENMELD_FAKE_CODEX_APP_SERVER_HANG_STARTUP_ATTEMPTS:
              String(handshakeFailures),
            OPENMELD_FAKE_CODEX_APP_SERVER_HANG_THREAD_START_ATTEMPTS: String(
              handshakeFailures + 1
            ),
            OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: join(
              fixtureDir,
              "attempt.txt"
            ),
            OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
            OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_DIAGNOSTICS: "1",
          },
          onProcessControlEvent: (event) => processEvents.push(event),
          prompt:
            "never allocate a second thread after an unknown create outcome",
          startupTimeoutMs: 500,
          taskId: "task-thread-create-timeout",
          threadId: null,
        }),
        (error) => {
          assert.equal(error.code, "runtime.thread_start_timeout");
          assert.ok(error.message.includes("thread/start"));
          assert.ok(error.message.includes("mcp_manager_init"));
          assert.ok(error.message.includes("mcpStartupStatus=starting"));
          assert.equal(
            error.originalError?.includes("did not initialize") ?? false,
            handshakeFailures === 1
          );
          for (const secret of [
            "private-test-secret",
            "customer-repo",
            "private-server",
            "thread-private",
          ]) {
            assert.equal(error.message.includes(secret), false);
          }
          return true;
        }
      );
      assert.deepEqual(await readFakeAppServerMethods(logPath), [
        ...new Array(handshakeFailures).fill("initialize"),
        "initialize",
        "initialized",
        "thread/start",
      ]);
      assert.deepEqual(
        processEvents.map((event) => event.phase),
        Array.from({ length: handshakeFailures + 1 }, () => [
          "process_spawned",
          "process_exit",
        ]).flat()
      );
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });
}

test("invokeCodexAppServer fails closed after an ambiguous resume timeout", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-resume-heal-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-resume-heal-dispatch-")
  );
  const attemptPath = join(fixtureDir, "resume-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServer({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: null,
        codexWorkdir: dispatchDir,
        controlRequestTimeoutMs: 50,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_HANG_RESUME_ATTEMPTS: "1",
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
        },
        onProcessControlEvent: (event) => processEvents.push(event),
        prompt: "continue the current Wake without replacing its session",
        // This test exercises control-request recovery, not process startup timing.
        startupTimeoutMs: 5000,
        taskId: "task-app-server-resume-timeout",
        threadId: "thread-stalled-1",
      }),
      (error) => error?.code === "context.resume_timeout"
    );

    const messages = await readFakeAppServerMessages(logPath);
    assert.deepEqual(
      messages
        .filter((message) =>
          ["thread/resume", "thread/start", "turn/start"].includes(
            message.method
          )
        )
        .map((message) => message.method),
      ["thread/resume"]
    );
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      1
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServer does not resubmit an ambiguously acknowledged turn", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-turn-admission-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-turn-admission-dispatch-")
  );
  const attemptPath = join(fixtureDir, "turn-attempt.txt");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const processEvents = [];

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServer({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: null,
        codexWorkdir: dispatchDir,
        controlRequestTimeoutMs: 50,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_HANG_TURN_START_ATTEMPTS: "1",
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_STARTUP_ATTEMPT_PATH: attemptPath,
        },
        onProcessControlEvent: (event) => processEvents.push(event),
        prompt: "never duplicate a turn after an uncertain acknowledgement",
        startupTimeoutMs: 200,
        taskId: "task-app-server-turn-admission",
        threadId: null,
      }),
      (error) =>
        error.code === "runtime.turn_start_timeout" &&
        error.errorType === "timeout"
    );
    const messages = await readFakeAppServerMessages(logPath);
    assert.deepEqual(
      messages
        .filter((message) =>
          ["thread/start", "turn/start"].includes(message.method)
        )
        .map((message) => message.method),
      ["thread/start", "turn/start"]
    );
    assert.equal(
      processEvents.filter((event) => event.phase === "process_spawned").length,
      1
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("app-server startup timeout does not become a total turn timeout", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-long-turn-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-long-turn-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServer({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: null,
      codexWorkdir: dispatchDir,
      controlRequestTimeoutMs: 500,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_DELAY_MS: "1200",
      },
      prompt: "allow a healthy long-running turn",
      startupTimeoutMs: 1000,
      taskId: "task-app-server-long-turn",
      threadId: null,
    });

    assert.match(result.output, LONG_TURN_OUTPUT_RE);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport preserves spaces from agent message delta fallback", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-delta-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-delta-dispatch-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_DELTA_OUTPUT: JSON.stringify([
          "Hi",
          " Felix",
          ",",
          " I'm",
          " here.",
        ]),
        OPENMELD_FAKE_CODEX_APP_SERVER_EMPTY_OUTPUT: "1",
      },
      prompt: "reply through app-server deltas",
      taskId: "task-app-server-delta-output",
      threadId: "thread-existing-delta-1",
    });

    assert.equal(result.threadId, "thread-existing-delta-1");
    assert.equal(result.output, "Hi Felix, I'm here.");
    assert.equal(result.telemetry.firstOutputAtMs > 0, true);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport applies interactive Ask for approval policy to new app-server threads", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-server-policy-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-policy-dir-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      prompt: "new app-server thread",
      taskId: "task-app-server-default-policy",
      threadId: null,
    });
    const messages = await readFakeAppServerMessages(logPath);

    assert.equal(
      messages.find((message) => message.method === "thread/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      messages.find((message) => message.method === "thread/start").params
        .sandbox,
      "workspace-write"
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      "sandbox" in
        messages.find((message) => message.method === "turn/start").params,
      false
    );
    assert.equal(
      "sandboxPolicy" in
        messages.find((message) => message.method === "turn/start").params,
      false
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport repairs a scoped Context in its own thread with read-only access", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-scoped-repair-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");
  await writeFakeCodexAppServerFixture(fixturePath);
  const events = [];
  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: fixtureDir,
      computerFileAccessBoundary: {
        mode: "only_selected_folders",
        folders: [fixtureDir],
        revision: 1,
        updatedAtMs: 1,
        executionContextAccess: "workspace",
      },
      env: { OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath },
      executionMode: "repair",
      prompt: "Reconsider the final reply.",
      taskId: "scoped-repair",
      threadId: "context-thread",
      onRuntimeEvent: (event) => events.push(event),
    });
    const messages = await readFakeAppServerMessages(logPath);
    assert.equal(
      messages.some((message) => message.method === "thread/fork"),
      false
    );
    assert.equal(
      messages.find((message) => message.method === "thread/resume").params
        .threadId,
      "context-thread"
    );
    assert.equal(
      messages.find((message) => message.method === "turn/start").params
        .threadId,
      "context-thread"
    );
    assert.equal(result.threadId, "context-thread");
    assert.equal(
      events.find((event) => event.phase === "provider_turn_accepted")
        .agentControllerConversationId,
      "context-thread"
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("invokeCodexAppServerTransport isolates structured-action repair from the source thread", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-repair-policy-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-repair-dir-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:fullAccess",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_EPHEMERAL_RESUME: "1",
      },
      executionMode: "repair",
      prompt: "repair the structured Space action",
      taskId: "task-app-server-repair-policy",
      threadId: "thread-existing-repair-policy",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const forkParams = messages.find(
      (message) => message.method === "thread/fork"
    ).params;
    const turnParams = messages.find(
      (message) => message.method === "turn/start"
    ).params;

    assert.equal(result.threadId, "thread-existing-repair-policy");
    assert.equal(forkParams.threadId, "thread-existing-repair-policy");
    assert.equal(forkParams.ephemeral, true);
    assert.equal(forkParams.cwd, dispatchDir);
    assert.equal(forkParams.approvalPolicy, "on-request");
    assert.equal(forkParams.approvalsReviewer, "user");
    assert.equal(forkParams.sandbox, "read-only");
    assert.equal(
      messages.some((message) => message.method === "thread/resume"),
      false
    );
    assert.equal(turnParams.threadId, "thread-fork-1");
    assert.equal(turnParams.approvalPolicy, "on-request");
    assert.equal(turnParams.approvalsReviewer, "user");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("an inherited-permission task reports missing history without starting replacement work", async () => {
  const { invokeCodexAppServer } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-no-rollout-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-no-rollout-dir-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServer({
        executionContext: {
          version: 1,
          id: "11111111-1111-4111-8111-111111111111",
          access: "workspace",
          workspace: "current",
          permissionSource: "agent_settings",
          scope: {
            organizationId: "org",
            requesterProfileId: "human",
            spaceId: "space",
            targetProfileId: "agent",
            threadId: null,
          },
          nativeConversationId: "thread-missing-rollout",
          runtimeWorkspaceFingerprint: null,
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_RESUME_NO_ROLLOUT: "1",
        },
        prompt: "resume missing context",
        taskId: "task-app-server-no-rollout",
        threadId: "thread-missing-rollout",
      }),
      (error) =>
        error?.code === "context_not_found" && error?.errorType === "config"
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport does not require a thread model in Default collaboration mode", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-no-model-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-app-no-model-dir-"));
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL: "1",
      },
      prompt: "default mode without a response model",
      taskId: "task-app-server-no-model",
      threadId: null,
    });

    assert.equal(result.threadId, "thread-new-1");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport requires a resolved model only for Plan collaboration mode", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-plan-no-model-"));
  const dispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-plan-no-model-dir-")
  );
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexAppServerTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        conversationPolicy: {
          collaborationMode: "plan",
        },
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_OMIT_THREAD_MODEL: "1",
        },
        prompt: "plan without a response model",
        taskId: "task-app-server-plan-no-model",
        threadId: null,
      }),
      (error) =>
        error?.code === "protocol.invalid" &&
        error.message.includes(
          "Plan collaboration mode requires a resolved model"
        )
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport applies model and reasoning to every app-server turn", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-conversation-"));
  const newDispatchDir = await mkdtemp(join(tmpdir(), "codex-app-conv-new-"));
  const resumeDispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-conv-resume-")
  );
  const newLogPath = join(fixtureDir, "new-rpc-log.jsonl");
  const resumeLogPath = join(fixtureDir, "resume-rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: newDispatchDir,
      conversationPolicy: {
        model: "gpt-5.3-codex-spark",
        reasoningLevel: "low",
      },
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: newLogPath,
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(
          newDispatchDir,
          "space-action-context.json"
        ),
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: join(
          newDispatchDir,
          "openmeld-dev"
        ),
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      prompt: "new app-server thread with conversation policy",
      taskId: "task-app-server-conversation-new",
      threadId: null,
    });
    const newMessages = await readFakeAppServerMessages(newLogPath);
    const threadStartParams = newMessages.find(
      (message) => message.method === "thread/start"
    ).params;
    const newTurnStartParams = newMessages.find(
      (message) => message.method === "turn/start"
    ).params;
    assert.equal(
      newMessages[0].argv.includes(
        "mcp_servers.openmeld_internal_dispatch_space_action.required=true"
      ),
      true
    );
    assert.equal(newMessages[0].argv.includes("app-server"), true);
    assert.equal(threadStartParams.model, "gpt-5.3-codex-spark");
    assert.equal(newTurnStartParams.model, "gpt-5.3-codex-spark");
    assert.equal(newTurnStartParams.effort, "low");

    await invokeCodexAppServerTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: resumeDispatchDir,
      conversationPolicy: {
        model: "gpt-5.3-codex-spark",
        reasoningLevel: "low",
      },
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: resumeLogPath,
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(
          resumeDispatchDir,
          "space-action-context.json"
        ),
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: join(
          resumeDispatchDir,
          "openmeld-dev"
        ),
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
      },
      prompt: "resumed app-server thread with conversation policy",
      taskId: "task-app-server-conversation-resume",
      threadId: "thread-with-conversation-policy",
    });
    const resumeMessages = await readFakeAppServerMessages(resumeLogPath);
    const threadResumeParams = resumeMessages.find(
      (message) => message.method === "thread/resume"
    ).params;
    const resumeTurnStartParams = resumeMessages.find(
      (message) => message.method === "turn/start"
    ).params;
    assert.equal(
      resumeMessages[0].argv.includes(
        "mcp_servers.openmeld_internal_dispatch_space_action.required=true"
      ),
      true
    );
    assert.equal(resumeMessages[0].argv.includes("app-server"), true);
    assert.equal(threadResumeParams.model, "gpt-5.3-codex-spark");
    assert.equal(resumeTurnStartParams.model, "gpt-5.3-codex-spark");
    assert.equal(resumeTurnStartParams.effort, "low");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(newDispatchDir, { force: true, recursive: true });
    await rm(resumeDispatchDir, { force: true, recursive: true });
  }
});

test("invokeCodexAppServerTransport applies bounded policy-driven approval params", async () => {
  const { invokeCodexAppServerTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-bounded-policy-"));
  const trustedDispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-trusted-")
  );
  const bypassDispatchDir = await mkdtemp(join(tmpdir(), "codex-app-bypass-"));
  const boundedDispatchDir = await mkdtemp(
    join(tmpdir(), "codex-app-boundary-")
  );
  const trustedLogPath = join(fixtureDir, "trusted-rpc-log.jsonl");
  const bypassLogPath = join(fixtureDir, "bypass-rpc-log.jsonl");
  const boundedLogPath = join(fixtureDir, "bounded-rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:approveForMe",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: trustedDispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: trustedLogPath,
      },
      prompt: "approve app-server",
      taskId: "task-app-server-approve",
      threadId: null,
    });
    const trustedMessages = await readFakeAppServerMessages(trustedLogPath);
    assert.equal(
      trustedMessages.find((message) => message.method === "thread/start")
        .params.approvalPolicy,
      "on-request"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "thread/start")
        .params.sandbox,
      "workspace-write"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "thread/start")
        .params.approvalsReviewer,
      "auto_review"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "on-request"
    );
    assert.equal(
      trustedMessages.find((message) => message.method === "turn/start").params
        .approvalsReviewer,
      "auto_review"
    );
    assert.equal(
      "sandbox" in
        trustedMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );
    assert.equal(
      "sandboxPolicy" in
        trustedMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );

    await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:fullAccess",
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: bypassDispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: bypassLogPath,
      },
      prompt: "bypass app-server",
      taskId: "task-app-server-bypass",
      threadId: "thread-bypass-app-server",
    });
    const bypassMessages = await readFakeAppServerMessages(bypassLogPath);
    assert.equal(
      bypassMessages.find((message) => message.method === "thread/resume")
        .params.approvalPolicy,
      "never"
    );
    assert.equal(
      bypassMessages.find((message) => message.method === "thread/resume")
        .params.sandbox,
      "danger-full-access"
    );
    assert.equal(
      bypassMessages.find((message) => message.method === "turn/start").params
        .approvalPolicy,
      "never"
    );
    assert.equal(
      "sandbox" in
        bypassMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );
    assert.equal(
      "sandboxPolicy" in
        bypassMessages.find((message) => message.method === "turn/start")
          .params,
      false
    );

    await invokeCodexAppServerTransport({
      agentControllerPermissionMode: "codex:askForApproval",
      computerFileAccessBoundary: {
        folders: [boundedDispatchDir],
        mode: "only_selected_folders",
        revision: 2,
        updatedAtMs: 100,
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: boundedDispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: boundedLogPath,
      },
      prompt: "bounded app-server",
      taskId: "task-app-server-boundary",
      threadId: null,
    });
    const boundedMessages = await readFakeAppServerMessages(boundedLogPath);
    const boundedThreadParams = boundedMessages.find(
      (message) => message.method === "thread/start"
    ).params;
    assert.equal(
      boundedMessages[0].argv.includes(
        `permissions.openmeld_computer_boundary={ extends = ":workspace", filesystem = { ":root" = "deny", ":minimal" = "read", ${JSON.stringify(boundedDispatchDir)} = "read", ${JSON.stringify(`${boundedDispatchDir}/**`)} = "read" } }`
      ),
      true
    );
    assert.equal(boundedThreadParams.approvalPolicy, "on-request");
    assert.equal(boundedThreadParams.approvalsReviewer, "user");
    assert.equal(
      boundedMessages.find((message) => message.method === "turn/start").params
        .approvalsReviewer,
      "user"
    );
    assert.equal(
      boundedMessages[0].argv.includes('approvals_reviewer="user"'),
      true
    );
    assert.equal("sandbox" in boundedThreadParams, false);
    assert.equal("sandboxPolicy" in boundedThreadParams, false);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(trustedDispatchDir, { force: true, recursive: true });
    await rm(bypassDispatchDir, { force: true, recursive: true });
    await rm(boundedDispatchDir, { force: true, recursive: true });
  }
});

test("verifyCodexAppServerThread reads only metadata without resuming or starting a turn", async () => {
  const { verifyCodexAppServerThread } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-proof-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-proof-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await verifyCodexAppServerThread({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      threadId: "thread-proof-1",
    });
    const messages = await readFakeAppServerMessages(logPath);
    const methods = messages.map((message) => message.method);

    assert.equal(result.threadId, "thread-proof-1");
    assert.deepEqual(methods, ["initialize", "initialized", "thread/read"]);
    assert.deepEqual(
      messages.find((message) => message.method === "thread/read").params,
      { threadId: "thread-proof-1", includeTurns: false }
    );

    await assert.rejects(
      verifyCodexAppServerThread({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_REJECT_THREAD_READ: "1",
        },
        threadId: "missing-thread",
      }),
      (error) => error.message.includes("no rollout found")
    );
    assert.equal(
      (await readFakeAppServerMessages(logPath)).some(
        (message) => message.method === "thread/resume"
      ),
      false
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("forkCodexAppServerThread forks the native thread and applies the OpenMeld title", async () => {
  const { forkCodexAppServerThread } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-fork-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-fork-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    // A scoped fork has to prove the completed prefix it copies.
    await assert.rejects(
      forkCodexAppServerThread({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        sourceThreadId: "thread-source-1",
        computerFileAccessBoundary: {
          mode: "only_selected_folders",
          folders: [dispatchDir],
          revision: 1,
          updatedAtMs: 1,
          executionContextAccess: "workspace",
        },
      }),
      FORK_CHECKPOINT_UNAVAILABLE_RE
    );
    // So does an unscoped one: without a cutoff the child would inherit the
    // source's whole history, including a turn that is still running.
    await assert.rejects(
      forkCodexAppServerThread({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        sourceThreadId: "thread-source-1",
      }),
      FORK_CHECKPOINT_UNAVAILABLE_RE
    );
    // Copying everything is a decision the caller has to name.
    await assert.rejects(
      forkCodexAppServerThread({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        forkFullHistory: true,
        sourceCompletedTurnId: "turn-1",
        sourceThreadId: "thread-source-1",
      }),
      FORK_BOUNDARY_CONFLICT_RE
    );
    const result = await forkCodexAppServerThread({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      forkFullHistory: true,
      sourceThreadId: "thread-source-1",
      title: "OpenMeld · Release Agent",
    });
    const messages = await readFakeAppServerMessages(logPath);

    assert.deepEqual(
      messages.find((message) => message.method === "thread/read").params,
      { threadId: "thread-source-1", includeTurns: false }
    );
    assert.equal(result.threadId, "thread-fork-1");
    assert.deepEqual(
      messages.map((message) => message.method),
      [
        "initialize",
        "initialized",
        "thread/read",
        "thread/fork",
        "thread/name/set",
      ]
    );
    assert.deepEqual(
      messages.find((message) => message.method === "thread/fork").params,
      { excludeTurns: true, threadId: "thread-source-1" }
    );
    assert.deepEqual(
      messages.find((message) => message.method === "thread/name/set").params,
      { name: "OpenMeld · Release Agent", threadId: "thread-fork-1" }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("forkCodexAppServerThread sends the proven cutoff as lastTurnId", async () => {
  const { forkCodexAppServerThread } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-fork-cutoff-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-fork-cutoff-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await forkCodexAppServerThread({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
      },
      sourceCompletedTurnId: "turn-completed-7",
      sourceThreadId: "thread-source-1",
    });
    const forkParams = (await readFakeAppServerMessages(logPath)).find(
      (message) => message.method === "thread/fork"
    ).params;

    assert.equal(result.threadId, "thread-fork-1");
    // The cutoff must reach the provider, and the copied child must inherit
    // exactly that prefix rather than everything the source has stored.
    assert.deepEqual(forkParams, {
      excludeTurns: true,
      lastTurnId: "turn-completed-7",
      threadId: "thread-source-1",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("resolveCodexAppServerCompletedTurn reads the last settled turn as a fork boundary", async () => {
  const { resolveCodexAppServerCompletedTurn } = await import(
    "../dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-read-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-read-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    const result = await resolveCodexAppServerCompletedTurn({
      codexTimeoutMs: 5000,
      codexWorkdir: dispatchDir,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
        // The source is mid-turn: the newest turn is not a boundary a fork may
        // inherit, so the reader has to step back to the last completed one.
        OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_READ_STATUSES: JSON.stringify([
          "completed",
          "inProgress",
        ]),
      },
      launchContract: createNodeScriptLaunchContract(fixturePath),
      threadId: "thread-source-mid-turn",
    });
    const readParams = (await readFakeAppServerMessages(logPath)).find(
      (message) => message.method === "thread/read"
    ).params;

    assert.equal(result.completedTurnId, "turn-read-1");
    assert.equal(result.threadId, "thread-source-mid-turn");
    // Reading the source's history must not ask the provider for its writer.
    assert.deepEqual(readParams, {
      includeTurns: true,
      threadId: "thread-source-mid-turn",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("resolveCodexAppServerCompletedTurn refuses a source with no settled turn", async () => {
  const { resolveCodexAppServerCompletedTurn } = await import(
    "../dist/index.js"
  );
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-app-read-empty-"));
  const dispatchDir = await mkdtemp(join(tmpdir(), "codex-read-empty-cwd-"));
  const logPath = join(fixtureDir, "rpc-log.jsonl");
  const fixturePath = join(fixtureDir, "fake-codex-app-server.mjs");

  await writeFakeCodexAppServerFixture(fixturePath);
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      resolveCodexAppServerCompletedTurn({
        codexTimeoutMs: 5000,
        codexWorkdir: dispatchDir,
        env: {
          OPENMELD_FAKE_CODEX_APP_SERVER_LOG: logPath,
          OPENMELD_FAKE_CODEX_APP_SERVER_THREAD_READ_STATUSES: JSON.stringify([
            "inProgress",
          ]),
        },
        launchContract: createNodeScriptLaunchContract(fixturePath),
        threadId: "thread-source-all-in-flight",
      }),
      (error) =>
        error?.code === "execution_context.fork_checkpoint_unavailable" &&
        FORK_CHECKPOINT_UNAVAILABLE_RE.test(error.message)
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
    await rm(dispatchDir, { force: true, recursive: true });
  }
});

test("codex withholds workspace quiescence when the process group remains present after leader exit", async () => {
  const { forkCodexAppServerThread } = await import("../dist/index.js");
  const directory = await mkdtemp(join(tmpdir(), "codex-quiescence-"));
  const fixture = join(directory, "fake.mjs");
  await writeFakeCodexAppServerFixture(fixture);
  let processId;
  const events = [];
  const kill = process.kill;
  const mockKill = mock.method(process, "kill", (pid, signal) => {
    // The OS boundary reports a surviving group member although its leader
    // exited. Supervision's out-of-group inventory alone cannot see this case.
    if (signal === 0 && pid === -processId) {
      return true;
    }
    return kill(pid, signal);
  });
  try {
    await forkCodexAppServerThread({
      forkFullHistory: true,
      launchContract: createNodeScriptLaunchContract(fixture),
      codexTimeoutMs: 5000,
      codexWorkdir: directory,
      sourceThreadId: "thread-source-1",
      onRuntimeEvent: (event) => {
        events.push(event);
        if (event.phase === "process_spawned") {
          processId = event.processId;
        }
      },
    });
    const exited = events.find((event) => event.phase === "process_exit");
    assert.ok(exited);
    assert.equal(exited.ownedProcessesQuiescent, undefined);
  } finally {
    mockKill.mock.restore();
    await rm(directory, { force: true, recursive: true });
  }
});

test("codex cli transport parses successful result and thread id", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-success.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-success-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'hello from codex' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      prompt: "hello",
      threadId: null,
    });

    assert.deepEqual(
      {
        output: result.output,
        threadId: result.threadId,
      },
      {
        output: "hello from codex",
        threadId: "thread-success-1",
      }
    );
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "final",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport completes when provider terminal output arrives before process exit", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-terminal-output.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-terminal-output-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'terminal codex output' } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 1000,
      codexWorkdir: process.cwd(),
      prompt: "hello",
      threadId: null,
    });

    assert.equal(result.output, "terminal codex output");
    assert.equal(result.threadId, "thread-terminal-output-1");
    assert.equal(result.telemetry.exitObservedAtMs, undefined);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport fails when provider terminal error arrives before process exit", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-terminal-error.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'insufficient_quota: quota exceeded for current billing period' } }));",
      "setInterval(() => {}, 1000);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 1000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.equal(
          error.originalError,
          "insufficient_quota: quota exceeded for current billing period"
        );
        assert.match(error.message, QUOTA_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("adapter-codex default wait delays force escalation", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const gracefulTimeoutMs = 20;
  const expectedEscalationDelayMs = gracefulTimeoutMs;
  const observedWaits = [];
  const signalRecords = [];
  const adapter = createCodexAdapter({
    gracefulTimeoutMs,
    invoke: async () => ({
      output: "ok",
    }),
    sendInterrupt: (signal) => {
      signalRecords.push({
        signal,
      });
    },
    waitForMs: (delayMs) => {
      observedWaits.push(delayMs);
    },
  });

  await adapter.interrupt({
    taskId: "task-2",
  });

  assert.equal(signalRecords.length, 2);
  assert.equal(signalRecords[0]?.signal.mode, "graceful");
  assert.equal(signalRecords[1]?.signal.mode, "force");
  assert.deepEqual(observedWaits, [expectedEscalationDelayMs]);
});

for (const probeExit of [0, 2]) {
  test(`adapter-codex caches path-free file access attestation (probe exit ${probeExit})`, async () => {
    const { createCodexAdapter } = await import("../dist/index.js");
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-boundary-probe-"));
    const fixturePath = join(fixtureDir, "codex-boundary-probe.mjs");
    const probeLogPath = join(fixtureDir, "probe-log.txt");
    await writeFile(
      fixturePath,
      [
        "#!/usr/bin/env node",
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(${JSON.stringify(probeLogPath)}, "probe\\n", "utf8");`,
        `if (process.argv.includes('--strict-config')) { console.error(${JSON.stringify(`Rejected private configuration at ${fixtureDir}`)}); process.exit(${probeExit}); }`,
        "process.exit(0);",
      ].join("\n"),
      "utf8"
    );
    await chmod(fixturePath, 0o755);

    try {
      const adapter = createCodexAdapter({
        launchContract: createNodeScriptLaunchContract(fixturePath),
      });
      const request = {
        agentControllerPermissionMode: "codex:askForApproval",
        boundary: {
          folders: [fixtureDir],
          mode: "only_selected_folders",
          revision: 2,
          updatedAtMs: 100,
        },
        executionMode: "normal",
        launchContract: createNodeScriptLaunchContract(fixturePath),
        transportMode: "local-cli",
        workingDirectory: fixtureDir,
      };

      const expected =
        probeExit === 0
          ? { supported: true }
          : {
              supported: false,
              reasonCode: "computer.file_access.launch_rejected",
            };
      const result = await adapter.verifyComputerFileAccessBoundary(request);
      assert.deepEqual(result, expected);
      assert.equal(JSON.stringify(result).includes(fixtureDir), false);
      const firstAttestationLog = await readFile(probeLogPath, "utf8");
      assert.deepEqual(
        await adapter.verifyComputerFileAccessBoundary(request),
        expected
      );
      assert.equal(await readFile(probeLogPath, "utf8"), firstAttestationLog);
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });
}

test("codex cli transport maps auth failures from stdout events", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-auth.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-auth-1' }));",
      "console.log(JSON.stringify({ type: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer token (request id: req_auth_1)' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "auth.required");
        assert.equal(error.errorType, "auth");
        assert.match(error.message, AUTH_401_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport forwards route env into the provider process", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-env.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const mode = process.env.OPENMELD_DISPATCH_RUNTIME_MODE || 'missing';",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'env:' + mode } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      env: {
        OPENMELD_DISPATCH_RUNTIME_MODE: "dispatch-owned-runtime",
      },
      prompt: "hello",
      threadId: null,
    });

    assert.equal(result.output, "env:dispatch-owned-runtime");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport ignores commentary messages before the final answer", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-commentary.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-commentary-1' }));",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', phase: 'commentary', text: 'I will inspect first.' } }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'final public answer' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      prompt: "hello",
      threadId: null,
    });

    assert.equal(result.output, "final public answer");
    assert.equal(result.threadId, "thread-commentary-1");
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport separates text-only Usage failures from rate limits", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");

  const quotaDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const quotaFixturePath = join(quotaDir, "codex-fixture-quota.mjs");
  await writeFile(
    quotaFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'error', message: 'insufficient_quota: You exceeded your current quota.' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(quotaFixturePath, 0o755);

  const rateDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const rateFixturePath = join(rateDir, "codex-fixture-rate.mjs");
  await writeFile(
    rateFixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'error', message: '429 Too Many Requests: rate limit exceeded' }));",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(rateFixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(quotaFixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "usage_exhausted");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.match(error.message, QUOTA_RE);
        return true;
      }
    );

    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(rateFixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "rate_limited");
        assert.equal(error.errorType, "adapter");
        assert.equal(error.providerAccessEvidence, undefined);
        assert.match(error.message, RATE_LIMIT_RE);
        return true;
      }
    );
  } finally {
    await rm(quotaDir, { force: true, recursive: true });
    await rm(rateDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps invalid model configuration to config.invalid", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-invalid-model.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      'console.log(JSON.stringify({ type: \'error\', message: \'{\\n  "error": {\\n    "message": "The requested model \\\'gpt-5.3-codex-spark\\\' does not exist.",\\n    "type": "invalid_request_error",\\n    "param": "model",\\n    "code": "model_not_found"\\n  }\\n}\' }));',
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "config.invalid");
        assert.equal(error.errorType, "config");
        assert.match(error.message, MODEL_NOT_FOUND_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport maps upgrade-required model failures to controller.client.upgrade_required", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-upgrade-required.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      'console.log(JSON.stringify({ type: \'error\', message: `{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \\\'gpt-5.5\\\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.\\"}}` }));',
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "controller.client.upgrade_required");
        assert.equal(error.errorType, "config");
        assert.match(error.message, CODEX_UPGRADE_REQUIRED_RE);
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport does not emit a synthetic preview when output only arrives at completion", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-final-only-preview.mjs");
  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-final-only-preview-1' }));",
      "console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello from final only codex output' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    const previews = [];
    const result = await invokeCodexCliTransport({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      onPreview: (preview) => {
        previews.push(preview.text);
      },
      prompt: "hello",
      streamingMode: "stream",
      threadId: null,
    });

    assert.equal(result.output, "hello from final only codex output");
    assert.deepEqual(previews, []);
    validateCodexTelemetry(result.telemetry, {
      previewEmitted: false,
      resumedContext: false,
      streamingMode: "stream",
    });
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex invoke heals stale thread by retrying once without resume", async () => {
  const { invokeCodexWithSingleContextHeal } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-heal.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "const resumeIndex = args.indexOf('resume');",
      "if (resumeIndex >= 0) {",
      "  const threadId = args[resumeIndex + 3] ?? 'unknown';",
      "  console.error('thread not found: ' + threadId);",
      "  process.exit(1);",
      "}",
      "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'thread-healed-1' }));",
      "console.log(JSON.stringify({ type: 'response.completed', response: { output_text: 'healed codex output' } }));",
      "process.exit(0);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  const contextLostEvents = [];

  try {
    const result = await invokeCodexWithSingleContextHeal({
      launchContract: createNodeScriptLaunchContract(fixturePath),
      codexTimeoutMs: 5000,
      codexWorkdir: process.cwd(),
      onContextLost: () => {
        contextLostEvents.push("context-lost");
      },
      prompt: "hello",
      threadId: "thread-stale-1",
    });

    assert.deepEqual(
      {
        contextHealed: result.contextHealed,
        output: result.output,
        threadId: result.threadId,
      },
      {
        contextHealed: true,
        output: "healed codex output",
        threadId: "thread-healed-1",
      }
    );
    validateCodexTelemetry(result.telemetry, {
      contextHealed: true,
      previewEmitted: false,
      resumedContext: true,
      streamingMode: "final",
    });
    assert.deepEqual(contextLostEvents, ["context-lost"]);
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex invoke returns context.rebuild_failed when retry also fails", async () => {
  const { invokeCodexWithSingleContextHeal } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-heal-fail.mjs");

  await writeFile(
    fixturePath,
    [
      "#!/usr/bin/env node",
      "console.error('thread not found: stale-thread');",
      "process.exit(1);",
    ].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexWithSingleContextHeal({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: "thread-stale-2",
      }),
      (error) => {
        assert.equal(error.code, "context.rebuild_failed");
        assert.equal(error.errorType, "adapter");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport classifies no-output timeout as timed_out_no_output", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-timeout-no-output.mjs");
  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "setTimeout(() => process.exit(0), 1000);"].join(
      "\n"
    ),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 50,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "timed_out_no_output");
        assert.equal(error.errorType, "timeout");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex cli transport classifies unclassified non-zero exit as provider_exit_error", async () => {
  const { invokeCodexCliTransport } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-cli-fixture-"));
  const fixturePath = join(fixtureDir, "codex-fixture-provider-exit-error.mjs");
  await writeFile(
    fixturePath,
    ["#!/usr/bin/env node", "process.exit(7);"].join("\n"),
    "utf8"
  );
  await chmod(fixturePath, 0o755);

  try {
    await assert.rejects(
      invokeCodexCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        codexTimeoutMs: 5000,
        codexWorkdir: process.cwd(),
        prompt: "hello",
        threadId: null,
      }),
      (error) => {
        assert.equal(error.code, "provider_exit_error");
        assert.equal(error.errorType, "adapter");
        return true;
      }
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});

test("codex adapter keeps bounded local paths out of every transport failure", async () => {
  const { createCodexAdapter } = await import("../dist/index.js");
  const fixtureDir = await mkdtemp(join(tmpdir(), "codex-boundary-error-"));
  const parentDir = join(fixtureDir, "private-parent");
  const workingDir = join(parentDir, "private-project");
  const additionalDir = join(fixtureDir, "private-additional");
  const cliFixturePath = join(fixtureDir, "fake-codex-cli-error.mjs");
  const appFixturePath = join(fixtureDir, "fake-codex-app-error.mjs");
  await Promise.all([
    mkdir(workingDir, { recursive: true }),
    mkdir(additionalDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      cliFixturePath,
      [
        "#!/usr/bin/env node",
        "if (process.argv.includes('--version')) { console.log('codex 1.0.0'); process.exit(0); }",
        "console.error(process.env.OPENMELD_FAKE_CODEX_BOUNDARY_ERROR);",
        "process.exit(1);",
      ].join("\n"),
      "utf8"
    ),
    writeFakeCodexAppServerFixture(appFixturePath),
  ]);
  await Promise.all([
    chmod(cliFixturePath, 0o755),
    chmod(appFixturePath, 0o755),
  ]);

  const privateFailure = [workingDir, parentDir, additionalDir].join(" | ");
  const boundary = {
    folders: [parentDir, additionalDir],
    mode: "only_selected_folders",
    revision: 2,
    updatedAtMs: 100,
  };

  try {
    const cliAdapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      enableLocalCliTransport: true,
      launchContract: createNodeScriptLaunchContract(cliFixturePath),
    });
    const cliResult = await cliAdapter.dispatch({
      agentId: "agt-codex-boundary-cli-error",
      computerFileAccessBoundary: boundary,
      env: { OPENMELD_FAKE_CODEX_BOUNDARY_ERROR: privateFailure },
      prompt: "bounded cli failure",
      runtimeContext: createRuntimeContext(workingDir),
      sourceEventId: "evt-codex-boundary-cli-error",
      spaceId: "space-1",
      taskId: "task-codex-boundary-cli-error",
      transportMode: "local-cli",
    });

    const appAdapter = createCodexAdapter({
      codexTimeoutMs: 5000,
      launchContract: createNodeScriptLaunchContract(appFixturePath),
    });
    const appResult = await appAdapter.dispatch({
      agentId: "agt-codex-boundary-app-error",
      computerFileAccessBoundary: boundary,
      env: {
        OPENMELD_FAKE_CODEX_APP_SERVER_TURN_FAILURE_MESSAGE: privateFailure,
      },
      prompt: "bounded app failure",
      runtimeContext: createRuntimeContext(workingDir),
      sourceEventId: "evt-codex-boundary-app-error",
      spaceId: "space-1",
      taskId: "task-codex-boundary-app-error",
      transportMode: "codex-app-server",
    });

    for (const result of [cliResult, appResult]) {
      assert.equal(result.status, "failed");
      assert.equal(
        result.errorMessage,
        `${result.errorCode}: Codex failed while the Computer file access boundary was active. Local controller output was withheld because it may contain private folder paths.`
      );
      const outwardFailure = JSON.stringify(result);
      for (const privatePath of [workingDir, parentDir, additionalDir]) {
        assert.equal(outwardFailure.includes(privatePath), false);
      }
      assert.equal(result.errorType, "adapter");
    }

    const ordinaryResult = await cliAdapter.dispatch({
      agentId: "agt-codex-ordinary-cli-error",
      env: { OPENMELD_FAKE_CODEX_BOUNDARY_ERROR: "ordinary launch detail" },
      prompt: "ordinary cli failure",
      runtimeContext: createRuntimeContext(workingDir),
      sourceEventId: "evt-codex-ordinary-cli-error",
      spaceId: "space-1",
      taskId: "task-codex-ordinary-cli-error",
      transportMode: "local-cli",
    });
    assert.equal(ordinaryResult.status, "failed");
    assert.equal(
      JSON.stringify(ordinaryResult).includes("ordinary launch detail"),
      true
    );
  } finally {
    await rm(fixtureDir, { force: true, recursive: true });
  }
});
