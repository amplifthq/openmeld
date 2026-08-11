import assert from "node:assert/strict";
import test from "node:test";
import { getSharedProviderContractEntry } from "./provider-contract-matrix.js";
import { resolveRegistryRuntimeAdapterContract } from "./registry-runtime-adapters.js";

const TEST_DISABLE_DEFAULT_INVOKE = Symbol.for(
  "openmeld.test.disableDefaultInvoke"
);

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

function buildCanonicalAgentControllerConversation(input) {
  return {
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerConversationKind: input.agentControllerConversationKind,
  };
}

function buildSharedSuiteTitle(adapterId, label) {
  return `shared runtime adapter contract: ${adapterId} ${label}`;
}

export function runSharedRuntimeAdapterContractSuite(input) {
  const entry = getSharedProviderContractEntry(input.adapterId);
  const registryContract = resolveRegistryRuntimeAdapterContract(
    input.adapterId
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch success preserves telemetry"
    ),
    async () => {
      const adapter = await input.createAdapter({
        invoke: async () => ({
          output: "ok",
          telemetry: buildTelemetry(),
        }),
      });

      const result = await adapter.dispatch(buildDispatchRequest());

      assert.deepEqual(result, {
        output: "ok",
        status: "success",
        telemetry: buildTelemetry(),
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch failure preserves explicit code and error type"
    ),
    async () => {
      const adapter = await input.createAdapter({
        invoke: () => {
          throw Object.assign(new Error("auth.required: missing token"), {
            code: "auth.required",
            errorType: "auth",
          });
        },
      });

      const result = await adapter.dispatch(buildDispatchRequest());

      assert.deepEqual(result, {
        errorCode: "auth.required",
        errorMessage: "auth.required: missing token",
        errorType: "auth",
        status: "failed",
      });
      assert.equal("contextDelta" in result, false);
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch preserves context delta and canonical agent controller conversation"
    ),
    async () => {
      const adapter = await input.createAdapter({
        invoke: async () => ({
          contextDelta: {
            agentControllerConversationId: "ctx-next-1",
            refreshed: true,
          },
          output: "ok",
        }),
      });

      const result = await adapter.dispatch(buildDispatchRequest());

      assert.deepEqual(result, {
        contextDelta: {
          agentControllerConversationId: "ctx-next-1",
          refreshed: true,
          agentControllerConversation:
            buildCanonicalAgentControllerConversation({
              agentControllerConversationId: "ctx-next-1",
              agentControllerRef: entry.agentControllerRef,
              agentControllerConversationKind:
                entry.agentControllerConversationKind,
            }),
        },
        output: "ok",
        status: "success",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch bridges typed agent controller conversation according to provider contract"
    ),
    async () => {
      const observed = {
        agentControllerConversationId: null,
        agentControllerConversation: null,
      };
      const typedConversation = buildCanonicalAgentControllerConversation({
        agentControllerConversationId: "typed-conversation-1",
        agentControllerRef: entry.agentControllerRef,
        agentControllerConversationKind: entry.agentControllerConversationKind,
      });

      const adapter = await input.createAdapter({
        invoke: (dispatchInput) => {
          observed.agentControllerConversationId =
            dispatchInput.agentControllerConversationId ?? null;
          observed.agentControllerConversation =
            dispatchInput.agentControllerConversation ?? null;

          if (entry.bridgeMode === "session_ref_separate") {
            return {
              contextDelta: {
                agentControllerConversationId: "runtime-session-1",
                agentControllerConversation:
                  dispatchInput.agentControllerConversation,
              },
              output:
                dispatchInput.agentControllerConversation
                  ?.agentControllerConversationId ?? "missing",
            };
          }

          return {
            contextDelta: {
              agentControllerConversationId:
                dispatchInput.agentControllerConversationId,
            },
            output: dispatchInput.agentControllerConversationId ?? "missing",
          };
        },
      });

      const result = await adapter.dispatch(
        buildDispatchRequest({
          sourceEventId: "evt-typed-1",
          taskId: "task-typed-1",
          agentControllerConversation: typedConversation,
        })
      );

      if (entry.bridgeMode === "session_ref_separate") {
        assert.equal(observed.agentControllerConversationId, null);
        assert.deepEqual(
          observed.agentControllerConversation,
          typedConversation
        );
        assert.deepEqual(result, {
          contextDelta: {
            agentControllerConversationId: "runtime-session-1",
            agentControllerConversation: typedConversation,
          },
          output: "typed-conversation-1",
          status: "success",
        });
        return;
      }

      assert.equal(
        observed.agentControllerConversationId,
        "typed-conversation-1"
      );
      assert.deepEqual(observed.agentControllerConversation, typedConversation);
      assert.deepEqual(result, {
        contextDelta: {
          agentControllerConversationId: "typed-conversation-1",
          agentControllerConversation: typedConversation,
        },
        output: "typed-conversation-1",
        status: "success",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch backfills canonical agent controller conversation from typed input when provider omits it"
    ),
    async () => {
      const typedConversation = buildCanonicalAgentControllerConversation({
        agentControllerConversationId: "typed-conversation-2",
        agentControllerRef: entry.agentControllerRef,
        agentControllerConversationKind: entry.agentControllerConversationKind,
      });
      const adapter = await input.createAdapter({
        invoke: async (dispatchInput) => ({
          contextDelta: {
            agentControllerConversationId:
              entry.bridgeMode === "session_ref_separate"
                ? "runtime-session-2"
                : dispatchInput.agentControllerConversationId,
          },
          output: "ok",
        }),
      });

      const result = await adapter.dispatch(
        buildDispatchRequest({
          sourceEventId: "evt-typed-2",
          taskId: "task-typed-2",
          agentControllerConversation: typedConversation,
        })
      );

      assert.deepEqual(result, {
        contextDelta: {
          agentControllerConversationId:
            entry.bridgeMode === "session_ref_separate"
              ? "runtime-session-2"
              : "typed-conversation-2",
          agentControllerConversation: typedConversation,
        },
        output: "ok",
        status: "success",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch returns adapter.unreachable when invokeByMode does not cover the current transport"
    ),
    async () => {
      const adapter = await input.createAdapter({
        invokeByMode: {
          stdio: async () => ({
            output: "stdio-only",
          }),
        },
      });

      const result = await adapter.dispatch(buildDispatchRequest());

      assert.deepEqual(result, {
        errorCode: "adapter.unreachable",
        errorMessage: `adapter.unreachable: ${input.adapterId} transport 'local-cli' is not configured`,
        errorType: "adapter",
        status: "failed",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "dispatch returns controller.runtime.missing when no invoke runtime is available"
    ),
    async () => {
      const adapter = await input.createAdapter({
        [TEST_DISABLE_DEFAULT_INVOKE]: true,
      });

      const result = await adapter.dispatch(buildDispatchRequest());

      assert.deepEqual(result, {
        errorCode: "controller.runtime.missing",
        errorMessage: `controller.runtime.missing: ${input.adapterId} invoke runtime is unavailable`,
        errorType: "adapter",
        status: "failed",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "interrupt accepts graceful to force plan"
    ),
    async () => {
      const signals = [];
      const waits = [];
      const adapter = await input.createAdapter({
        sendInterrupt: (signal) => {
          signals.push(signal);
        },
        waitForMs: (delayMs) => {
          waits.push(delayMs);
        },
      });

      const result = await adapter.interrupt({
        taskId: "task-interrupt-1",
      });

      assert.equal(result.accepted, true);
      assert.equal(result.reasonCode, "accepted");
      assert.equal(result.signalDelivery, "sent");
      assert.equal(result.plan.initial.mode, "graceful");
      assert.equal(result.plan.escalation?.mode, "force");
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
      assert.deepEqual(waits, [10_000]);
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "interrupt reports unsupported when no signal sender exists"
    ),
    async () => {
      const adapter = await input.createAdapter({});

      const result = await adapter.interrupt({
        taskId: "task-interrupt-2",
      });

      assert.deepEqual(result, {
        accepted: false,
        plan: {
          escalation: {
            delayMs: 10_000,
            mode: "force",
            reason: "service.interrupt",
            taskId: "task-interrupt-2",
          },
          initial: {
            mode: "graceful",
            reason: "service.interrupt",
            taskId: "task-interrupt-2",
          },
        },
        reasonCode: "adapter.unsupported",
        signalDelivery: "not_sent",
        taskId: "task-interrupt-2",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "interrupt reports signal.send_failed when signal delivery throws"
    ),
    async () => {
      const adapter = await input.createAdapter({
        sendInterrupt: () => {
          throw new Error("interrupt failed");
        },
      });

      const result = await adapter.interrupt({
        taskId: "task-interrupt-3",
      });

      assert.equal(result.accepted, false);
      assert.equal(result.reasonCode, "signal.send_failed");
      assert.equal(result.signalDelivery, "not_sent");
      assert.equal(result.reasonDetail, "interrupt failed");
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "cancel uses dedicated sender when available"
    ),
    async () => {
      const cancelSignals = [];
      const adapter = await input.createAdapter({
        sendCancel: (cancelInput) => {
          cancelSignals.push(cancelInput);
        },
      });

      const result = await adapter.cancel({
        taskId: "task-cancel-1",
      });

      assert.deepEqual(result, {
        accepted: true,
        deliveryPath: "cancel",
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: "task-cancel-1",
      });
      assert.deepEqual(cancelSignals, [
        {
          reason: "service.cancel",
          taskId: "task-cancel-1",
        },
      ]);
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "cancel falls back to force interrupt when dedicated sender is missing"
    ),
    async () => {
      const interruptSignals = [];
      const adapter = await input.createAdapter({
        sendInterrupt: (signal) => {
          interruptSignals.push(signal);
        },
      });

      const result = await adapter.cancel({
        taskId: "task-cancel-2",
      });

      assert.deepEqual(result, {
        accepted: true,
        deliveryPath: "force_interrupt_fallback",
        reasonCode: "accepted",
        signalDelivery: "sent",
        taskId: "task-cancel-2",
      });
      assert.deepEqual(interruptSignals, [
        {
          mode: "force",
          reason: "service.cancel",
          taskId: "task-cancel-2",
        },
      ]);
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "cancel reports unsupported when no sender exists"
    ),
    async () => {
      const adapter = await input.createAdapter({});

      const result = await adapter.cancel({
        taskId: "task-cancel-3",
      });

      assert.deepEqual(result, {
        accepted: false,
        reasonCode: "adapter.unsupported",
        signalDelivery: "not_sent",
        taskId: "task-cancel-3",
      });
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "cancel reports signal.send_failed when sender throws"
    ),
    async () => {
      const adapter = await input.createAdapter({
        sendCancel: () => {
          throw new Error("cancel failed");
        },
      });

      const result = await adapter.cancel({
        taskId: "task-cancel-4",
      });

      assert.equal(result.accepted, false);
      assert.equal(result.reasonCode, "signal.send_failed");
      assert.equal(result.signalDelivery, "not_sent");
      assert.equal(result.reasonDetail, "cancel failed");
    }
  );

  test(
    buildSharedSuiteTitle(
      input.adapterId,
      "stream intent does not fail shared dispatch contract"
    ),
    async () => {
      const previews = [];
      let previewHookAvailable = false;
      const observedStreamingModes = [];
      const adapter = await input.createAdapter({
        invoke: (dispatchInput) => {
          observedStreamingModes.push(dispatchInput.streamingMode ?? null);
          previewHookAvailable = typeof dispatchInput.onPreview === "function";
          return {
            output: "stream-ok",
          };
        },
      });

      const result = await adapter.dispatch(
        buildDispatchRequest({
          onPreview: (preview) => {
            previews.push(preview.text);
          },
          sourceEventId: "evt-stream-1",
          streamingMode: "stream",
          taskId: "task-stream-1",
        })
      );

      assert.deepEqual(result, {
        output: "stream-ok",
        status: "success",
      });
      assert.deepEqual(observedStreamingModes, ["stream"]);

      if (
        registryContract.capabilityDeclaration.streamingCapability ===
        "preview_capable"
      ) {
        assert.equal(previewHookAvailable, true);
      }

      assert.deepEqual(previews, []);
    }
  );
}
