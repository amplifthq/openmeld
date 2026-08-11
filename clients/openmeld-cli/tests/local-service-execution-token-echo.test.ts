import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  sendDispatchLifecycleFrame,
  sendDispatchResultFrame,
  sendDispatchRuntimeEvidenceFrame,
  sendDispatchToolActivityFrame,
} from "../src/local-service/dispatch/send-dispatch-result";

const executionTokenEcho = {
  executionToken:
    "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runId: "run-1",
  runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
  tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const executionIdentityCore = {
  bindingId: "binding-1",
  agentControllerRef: "builtin:codex",
  dispatchId: "dispatch-1",
  modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority" as const,
    value: "runtime-1",
  },
  spaceId: "space-1",
  targetProfileId: "agent-1",
};

const resultIdentityEcho = {
  core: executionIdentityCore,
  echoSource: "daemon_delivery_context" as const,
};

describe("local service execution token echo", () => {
  it("echoes the received execution token on lifecycle, runtime evidence, and result frames", () => {
    const send = vi.fn();
    const socket = { send } as never;

    sendDispatchLifecycleFrame({
      attemptId: "attempt-1",
      connectionGeneration: 1,
      daemonSessionId: "session-1",
      dispatchId: "dispatch-1",
      executionTokenEcho,
      leaseEpoch: 2,
      phase: "running",
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      socket,
    });
    sendDispatchRuntimeEvidenceFrame({
      attemptId: "attempt-1",
      connectionGeneration: 1,
      daemonSessionId: "session-1",
      dispatchId: "dispatch-1",
      executionIdentityEcho: resultIdentityEcho,
      executionTokenEcho,
      leaseEpoch: 2,
      phase: "runtime_started",
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      socket,
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    });
    sendDispatchToolActivityFrame({
      attemptId: "attempt-1",
      connectionGeneration: 1,
      daemonSessionId: "session-1",
      dispatchId: "dispatch-1",
      executionIdentityEcho: resultIdentityEcho,
      executionTokenEcho,
      leaseEpoch: 2,
      observedAtMs: 1_700_000_000_100,
      part: {
        type: "tool",
        toolCallId: "tool-call-1",
        toolName: "agent_run_command",
        state: "input-available",
      },
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      sequence: 1,
      socket,
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
    });
    sendDispatchResultFrame({
      attemptId: "attempt-1",
      connectionGeneration: 1,
      daemonSessionId: "session-1",
      dispatchId: "dispatch-1",
      executionIdentityEcho: resultIdentityEcho,
      executionTokenEcho,
      leaseEpoch: 2,
      payload: {
        agentId: "agent-1",
        agentControllerConversationId: "ctx-1",
        attemptId: "attempt-1",
        deduped: false,
        output: "ok",
        spaceAction: {
          type: "post_message",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: ["agt_22222222-2222-4222-8222-222222222222"],
            text: "Reference this Agent.",
          },
        },
        sourceEventId: "signal-1",
        status: "success",
        taskId: "task-1",
      },
      runtimeCoordinatorExecutionId: "rce-space-1-dispatch-1-agent-1",
      socket,
    });

    const frames = send.mock.calls.map(([frame]) => JSON.parse(String(frame)));
    expect(frames.map((frame) => frame.code)).toEqual([
      "daemon.dispatch.lifecycle",
      "daemon.dispatch.runtime_evidence",
      "daemon.dispatch.tool_activity",
      "daemon.dispatch.result",
    ]);
    for (const frame of frames) {
      expect(frame.payload.executionTokenEcho).toEqual(executionTokenEcho);
    }
    expect(
      frames.at(-1)?.payload.taskResult.payload.spaceAction.messageEnvelope
        .ccTargets
    ).toEqual([]);
  });
});
