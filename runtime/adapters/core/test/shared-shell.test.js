import assert from "node:assert/strict";
import test from "node:test";

const TEST_DISABLE_DEFAULT_INVOKE = Symbol.for(
  "openmeld.test.disableDefaultInvoke"
);
const CONTEXT_REBUILD_FAILED_RE =
  /context\.rebuild_failed: Error: still broken/;

const CODEX_BRIDGE_SPEC = {
  agentControllerRef: "builtin:codex",
  agentControllerConversationKind: "thread",
};
const OPENCLAW_BRIDGE_SPEC = {
  agentControllerRef: "builtin:openclaw",
  agentControllerConversationKind: "session",
};

function buildDispatchRequest(overrides = {}) {
  return {
    agentId: "agent-1",
    prompt: "hello",
    runtimeContext: {
      providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
    },
    sourceEventId: "evt-1",
    spaceId: "space-1",
    taskId: "task-1",
    ...overrides,
  };
}

function buildTelemetry(overrides = {}) {
  return {
    completedAtMs: 20,
    invokedAtMs: 10,
    resumedContext: false,
    ...overrides,
  };
}

test("adapter-core preserves bounded context telemetry on failures", async () => {
  const core = await import("../dist/index.js");
  const error = Object.assign(new Error("provider failed"), {
    telemetry: {
      completedAtMs: 20,
      contextCompactionObserved: true,
      invokedAtMs: 10,
      resumedContext: true,
      secret: "do not project",
      tokenUsage: {
        last: {
          cachedInputTokens: 800,
          inputTokens: 1000,
          outputTokens: 40,
          reasoningOutputTokens: 20,
          totalTokens: 1060,
        },
        modelContextWindow: 258_400,
        total: {
          cachedInputTokens: 1400,
          inputTokens: 1800,
          outputTokens: 70,
          reasoningOutputTokens: 30,
          totalTokens: 1900,
        },
      },
    },
  });

  const result = core.toAdapterDispatchFailure(error);

  assert.deepEqual(result.telemetry, {
    completedAtMs: 20,
    contextCompactionObserved: true,
    invokedAtMs: 10,
    resumedContext: true,
    tokenUsage: {
      last: {
        cachedInputTokens: 800,
        inputTokens: 1000,
        outputTokens: 40,
        reasoningOutputTokens: 20,
        totalTokens: 1060,
      },
      modelContextWindow: 258_400,
      total: {
        cachedInputTokens: 1400,
        inputTokens: 1800,
        outputTokens: 70,
        reasoningOutputTokens: 30,
        totalTokens: 1900,
      },
    },
  });
});

test("adapter-core shared dispatch shell prefers invokeByMode and canonicalizes context delta", async () => {
  const core = await import("../dist/index.js");
  const observed = {
    agentControllerConversationId: null,
  };
  const telemetry = buildTelemetry();
  const dispatch = core.createSharedDispatchShell({
    adapterId: "codex",
    bridgeSpec: CODEX_BRIDGE_SPEC,
    invoke: async () => ({
      output: "default-invoke",
    }),
    invokeByMode: {
      "local-cli": (input) => {
        observed.agentControllerConversationId =
          input.agentControllerConversationId ?? null;
        return {
          contextDelta: {
            agentControllerConversationId: "thread-next-1",
            refreshed: true,
          },
          output: "transport-invoke",
          telemetry,
        };
      },
    },
    resolveDefaultInvoke: () => null,
  });

  const result = await dispatch(
    buildDispatchRequest({
      agentControllerConversation: {
        agentControllerConversationId: "thread-prev-1",
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
      },
    })
  );

  assert.equal(observed.agentControllerConversationId, "thread-prev-1");
  assert.deepEqual(result, {
    contextDelta: {
      agentControllerConversationId: "thread-next-1",
      refreshed: true,
      agentControllerConversation: {
        agentControllerConversationId: "thread-next-1",
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
      },
    },
    output: "transport-invoke",
    status: "success",
    telemetry,
  });
});

test("adapter-core shared dispatch shell forwards dispatch-time runtime context", async () => {
  const core = await import("../dist/index.js");
  let observedRuntimeContext = null;
  const dispatch = core.createSharedDispatchShell({
    adapterId: "codex",
    bridgeSpec: CODEX_BRIDGE_SPEC,
    invoke: (input) => {
      observedRuntimeContext = input.runtimeContext;
      return {
        output: "ok",
      };
    },
    resolveDefaultInvoke: () => null,
  });

  const request = buildDispatchRequest({
    runtimeContext: {
      providerRuntimeWorkingDirectory: "/tmp/runtime-context-dispatch",
    },
  });
  const result = await dispatch(request);

  assert.deepEqual(observedRuntimeContext, request.runtimeContext);
  assert.equal(result.status, "success");
});

test("adapter-core shared dispatch shell keeps session refs separate when provider hooks opt out of legacy bridging", async () => {
  const core = await import("../dist/index.js");
  const observed = {
    agentControllerConversationId: "unset",
    agentControllerConversation: null,
  };
  const typedConversation = {
    agentControllerConversationId:
      "agent:openmeld-openclaw:openmeld-space:ops-room--abc12345",
    agentControllerRef: "builtin:openclaw",
    agentControllerConversationKind: "session",
  };
  const dispatch = core.createSharedDispatchShell({
    adapterId: "openclaw",
    bridgeSpec: OPENCLAW_BRIDGE_SPEC,
    invoke: (input) => {
      observed.agentControllerConversationId =
        input.agentControllerConversationId ?? null;
      observed.agentControllerConversation =
        input.agentControllerConversation ?? null;
      return {
        contextDelta: {
          agentControllerConversationId: "runtime-session-1",
        },
        output: "gateway-continuation",
      };
    },
    resolveDefaultInvoke: () => null,
    resolveInvokeRequest: ({ request }) => ({
      ...request,
      agentControllerConversationId:
        typeof request.agentControllerConversationId === "string" &&
        request.agentControllerConversationId.trim().length > 0
          ? request.agentControllerConversationId.trim()
          : null,
      ...(request.agentControllerConversation
        ? { agentControllerConversation: request.agentControllerConversation }
        : {}),
    }),
    resolveSuccessContextDelta: ({ invokeRequest, result }) => ({
      ...result.contextDelta,
      agentControllerConversation: invokeRequest.agentControllerConversation,
    }),
  });

  const result = await dispatch(
    buildDispatchRequest({
      agentControllerConversationId: "   ",
      sourceEventId: "evt-openclaw-1",
      taskId: "task-openclaw-1",
      agentControllerConversation: typedConversation,
    })
  );

  assert.equal(observed.agentControllerConversationId, null);
  assert.deepEqual(observed.agentControllerConversation, typedConversation);
  assert.deepEqual(result, {
    contextDelta: {
      agentControllerConversationId: "runtime-session-1",
      agentControllerConversation: typedConversation,
    },
    output: "gateway-continuation",
    status: "success",
  });
});

test("adapter-core shared dispatch shell keeps stream intent successful for final-only providers", async () => {
  const core = await import("../dist/index.js");
  const previews = [];
  const dispatch = core.createSharedDispatchShell({
    adapterId: "openclaw",
    bridgeSpec: OPENCLAW_BRIDGE_SPEC,
    invoke: async () => ({
      output: "final-only-output",
    }),
    resolveDefaultInvoke: () => null,
  });

  const result = await dispatch(
    buildDispatchRequest({
      onPreview: (preview) => {
        previews.push(preview.text);
      },
      sourceEventId: "evt-openclaw-stream-1",
      streamingMode: "stream",
      taskId: "task-openclaw-stream-1",
    })
  );

  assert.deepEqual(result, {
    output: "final-only-output",
    status: "success",
  });
  assert.deepEqual(previews, []);
});

test("adapter-core shared dispatch shell returns adapter.unreachable for uncovered transport", async () => {
  const core = await import("../dist/index.js");
  const dispatch = core.createSharedDispatchShell({
    adapterId: "claude-code",
    bridgeSpec: {
      agentControllerRef: "builtin:claude-code",
      agentControllerConversationKind: "session",
    },
    invokeByMode: {
      stdio: async () => ({
        output: "stdio-only",
      }),
    },
    resolveDefaultInvoke: () => null,
  });

  const result = await dispatch(buildDispatchRequest());

  assert.deepEqual(result, {
    errorCode: "adapter.unreachable",
    errorMessage:
      "adapter.unreachable: claude-code transport 'local-cli' is not configured",
    errorType: "adapter",
    status: "failed",
  });
});

test("adapter-core shared dispatch shell honors disabled default invoke seam", async () => {
  const core = await import("../dist/index.js");
  const dispatch = core.createSharedDispatchShell({
    adapterId: "claude-code",
    bridgeSpec: {
      agentControllerRef: "builtin:claude-code",
      agentControllerConversationKind: "session",
    },
    resolveDefaultInvoke: () => async () => ({
      output: "default-invoke",
    }),
    runtimeOptions: {
      [TEST_DISABLE_DEFAULT_INVOKE]: true,
    },
  });

  const result = await dispatch(buildDispatchRequest());

  assert.deepEqual(result, {
    errorCode: "controller.runtime.missing",
    errorMessage:
      "controller.runtime.missing: claude-code invoke runtime is unavailable",
    errorType: "adapter",
    status: "failed",
  });
});

test("adapter-core shared dispatch shell preserves explicit code and error type on failure", async () => {
  const core = await import("../dist/index.js");
  const dispatch = core.createSharedDispatchShell({
    adapterId: "codex",
    bridgeSpec: CODEX_BRIDGE_SPEC,
    invoke: () => {
      throw Object.assign(new Error("auth.required: missing token"), {
        code: "auth.required",
        errorType: "auth",
      });
    },
    resolveDefaultInvoke: () => null,
  });

  const result = await dispatch(buildDispatchRequest());

  assert.deepEqual(result, {
    errorCode: "auth.required",
    errorMessage: "auth.required: missing token",
    errorType: "auth",
    status: "failed",
  });
});

test("adapter-core shared control shell sends graceful then force interrupt", async () => {
  const core = await import("../dist/index.js");
  const signals = [];
  const shell = core.createSharedControlShell({
    gracefulTimeoutMs: 25,
    sendInterrupt: (signal) => {
      signals.push(signal);
      return Promise.resolve();
    },
    waitForMs: () => Promise.resolve(),
  });

  const result = await shell.interrupt({
    taskId: "task-interrupt-1",
  });

  assert.deepEqual(signals, [
    {
      mode: "graceful",
      reason: "service.interrupt",
      taskId: "task-interrupt-1",
    },
    {
      mode: "force",
      reason: "service.interrupt",
      taskId: "task-interrupt-1",
    },
  ]);
  assert.deepEqual(result, {
    accepted: true,
    plan: {
      escalation: {
        delayMs: 25,
        mode: "force",
        reason: "service.interrupt",
        taskId: "task-interrupt-1",
      },
      initial: {
        mode: "graceful",
        reason: "service.interrupt",
        taskId: "task-interrupt-1",
      },
    },
    reasonCode: "accepted",
    signalDelivery: "sent",
    taskId: "task-interrupt-1",
  });
});

test("adapter-core shared control shell returns unsupported interrupt when no sender exists", async () => {
  const core = await import("../dist/index.js");
  const shell = core.createSharedControlShell({});

  const result = await shell.interrupt({
    taskId: "task-interrupt-unsupported",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, "adapter.unsupported");
  assert.equal(result.signalDelivery, "not_sent");
});

test("adapter-core shared control shell returns signal.send_failed for interrupt delivery errors", async () => {
  const core = await import("../dist/index.js");
  const shell = core.createSharedControlShell({
    sendInterrupt: () => {
      throw new Error("signal delivery failed");
    },
  });

  const result = await shell.interrupt({
    taskId: "task-interrupt-failed",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, "signal.send_failed");
  assert.equal(result.reasonDetail, "signal delivery failed");
});

test("adapter-core shared control shell prefers dedicated cancel sender", async () => {
  const core = await import("../dist/index.js");
  const cancelRequests = [];
  const shell = core.createSharedControlShell({
    sendCancel: (request) => {
      cancelRequests.push(request);
      return Promise.resolve();
    },
    sendInterrupt: () => {
      throw new Error("interrupt fallback should not run");
    },
  });

  const result = await shell.cancel({
    reason: "manual.cancel",
    taskId: "task-cancel-1",
  });

  assert.deepEqual(cancelRequests, [
    {
      reason: "manual.cancel",
      taskId: "task-cancel-1",
    },
  ]);
  assert.deepEqual(result, {
    accepted: true,
    deliveryPath: "cancel",
    reasonCode: "accepted",
    signalDelivery: "sent",
    taskId: "task-cancel-1",
  });
});

test("adapter-core shared control shell falls back to force interrupt for cancel", async () => {
  const core = await import("../dist/index.js");
  const signals = [];
  const shell = core.createSharedControlShell({
    sendInterrupt: (signal) => {
      signals.push(signal);
      return Promise.resolve();
    },
  });

  const result = await shell.cancel({
    taskId: "task-cancel-2",
  });

  assert.deepEqual(signals, [
    {
      mode: "force",
      reason: "service.cancel",
      taskId: "task-cancel-2",
    },
  ]);
  assert.deepEqual(result, {
    accepted: true,
    deliveryPath: "force_interrupt_fallback",
    reasonCode: "accepted",
    signalDelivery: "sent",
    taskId: "task-cancel-2",
  });
});

test("adapter-core shared control shell returns unsupported cancel when no sender exists", async () => {
  const core = await import("../dist/index.js");
  const shell = core.createSharedControlShell({});

  const result = await shell.cancel({
    taskId: "task-cancel-unsupported",
  });

  assert.deepEqual(result, {
    accepted: false,
    reasonCode: "adapter.unsupported",
    signalDelivery: "not_sent",
    taskId: "task-cancel-unsupported",
  });
});

test("adapter-core shared control shell returns signal.send_failed for cancel delivery errors", async () => {
  const core = await import("../dist/index.js");
  const shell = core.createSharedControlShell({
    sendCancel: () => {
      throw new Error("cancel delivery failed");
    },
  });

  const result = await shell.cancel({
    taskId: "task-cancel-failed",
  });

  assert.deepEqual(result, {
    accepted: false,
    reasonCode: "signal.send_failed",
    reasonDetail: "cancel delivery failed",
    signalDelivery: "not_sent",
    taskId: "task-cancel-failed",
  });
});

test("adapter-core shared control shell preserves task.not_running for local interrupt sender failures", async () => {
  const core = await import("../dist/index.js");
  const shell = core.createSharedControlShell({
    sendInterrupt: () => {
      throw Object.assign(new Error("task is no longer running"), {
        code: "task.not_running",
      });
    },
  });

  const result = await shell.interrupt({
    taskId: "task-interrupt-not-running",
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, "task.not_running");
  assert.equal(result.reasonDetail, "task is no longer running");
});

test("adapter-core shared control shell preserves task.not_found for cancel fallback failures", async () => {
  const core = await import("../dist/index.js");
  const shell = core.createSharedControlShell({
    sendInterrupt: () => {
      throw Object.assign(new Error("task no longer exists"), {
        code: "task.not_found",
      });
    },
  });

  const result = await shell.cancel({
    taskId: "task-cancel-not-found",
  });

  assert.deepEqual(result, {
    accepted: false,
    reasonCode: "task.not_found",
    reasonDetail: "task no longer exists",
    signalDelivery: "not_sent",
    taskId: "task-cancel-not-found",
  });
});

test("adapter-core single-context-heal returns first successful attempt without healing", async () => {
  const core = await import("../dist/index.js");
  const telemetry = buildTelemetry({
    resumedContext: true,
  });

  const result = await core.invokeWithSingleContextHeal({
    contextId: "thread-existing-1",
    createRebuildFailedError: (error) =>
      new Error(`context.rebuild_failed: ${String(error)}`),
    invokeOnce: async (contextId) => ({
      contextId,
      output: "first-pass",
      telemetry,
    }),
    isContextLostError: () => false,
  });

  assert.deepEqual(result, {
    contextHealed: false,
    contextId: "thread-existing-1",
    output: "first-pass",
    telemetry,
  });
});

test("adapter-core single-context-heal retries once without context and patches telemetry", async () => {
  const core = await import("../dist/index.js");
  const observedContextIds = [];
  const telemetry = buildTelemetry({
    previewEmitted: false,
    resumedContext: false,
    streamingMode: "stream",
  });
  const contextLostEvents = [];

  const result = await core.invokeWithSingleContextHeal({
    contextId: "thread-stale-1",
    createRebuildFailedError: (error) =>
      new Error(`context.rebuild_failed: ${String(error)}`),
    invokeOnce: (contextId) => {
      observedContextIds.push(contextId);
      if (contextId) {
        throw new Error("thread not found");
      }
      return {
        contextId: "thread-healed-1",
        output: "healed-pass",
        telemetry,
      };
    },
    isContextLostError: (error) => String(error).includes("thread not found"),
    onContextLost: () => {
      contextLostEvents.push("context-lost");
    },
  });

  assert.deepEqual(observedContextIds, ["thread-stale-1", null]);
  assert.deepEqual(contextLostEvents, ["context-lost"]);
  assert.deepEqual(result, {
    contextHealed: true,
    contextId: "thread-healed-1",
    output: "healed-pass",
    telemetry: {
      ...telemetry,
      contextHealed: true,
      resumedContext: true,
    },
  });
});

test("adapter-core single-context-heal wraps failed retry as context.rebuild_failed", async () => {
  const core = await import("../dist/index.js");

  await assert.rejects(
    core.invokeWithSingleContextHeal({
      contextId: "thread-stale-2",
      createRebuildFailedError: (error) =>
        new Error(`context.rebuild_failed: ${String(error)}`),
      invokeOnce: (contextId) => {
        if (contextId) {
          throw new Error("thread not found");
        }
        throw new Error("still broken");
      },
      isContextLostError: (error) => String(error).includes("thread not found"),
    }),
    CONTEXT_REBUILD_FAILED_RE
  );
});
