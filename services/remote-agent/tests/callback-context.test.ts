import { REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  assertCoreOriginatedTurnContext,
  attemptRemoteAgentCallbackDelivery,
  buildRemoteAgentCoreCallbackBody,
  buildRemoteAgentCoreFailureCallbackBody,
  buildRemoteAgentCoreWorkLoopContinuationCallbackBody,
  createRemoteAgentCallbackContext,
  extractCompletedAssistantText,
  handleRemoteAgentChatResponse,
  listRemoteAgentCallbackContexts,
  putRemoteAgentCallbackContext,
  type RemoteAgentCallbackContext,
  RemoteAgentGuardrailError,
  readRemoteAgentCallbackContext,
  recordCallbackDeliveryFailure,
  redeliverDueRemoteAgentCallbacks,
} from "../agent-core/callback-context";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const ACK = {
  accepted: true,
  createdAt: TEST_NOW_MS,
  idempotencyKey: "remote-agent:dispatch_123",
  requestId: "flue_request_123",
  status: "pending",
  submissionId: "flue_submission_123",
} as const;

function readyCallbackContext(
  completedText: string
): RemoteAgentCallbackContext {
  return {
    ...createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    }),
    completedText,
  };
}

async function persistReadyCallbackContext(
  storage: InMemoryDurableObjectStorage,
  text: string
): Promise<RemoteAgentCallbackContext> {
  const context = readyCallbackContext(text);
  await putRemoteAgentCallbackContext(storage, context);
  return context;
}

describe("remote agent callback context", () => {
  it("turns a durable tool-budget checkpoint into continuation instead of publishing the model's stop text", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context: RemoteAgentCallbackContext = {
      ...createRemoteAgentCallbackContext({
        ack: ACK,
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest(),
      }),
      workLoopCheckpoint: {
        reason: "tool_call_budget_exhausted",
        toolCallLimit: 64,
        v: 1,
      },
    };
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: null,
      status: "accepted" as const,
    }));

    const completed = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        message: {
          parts: [
            {
              text: "I used all tool calls, so I stopped before updating the tests.",
              type: "text",
            },
          ],
        },
        requestId: ACK.requestId,
        status: "completed",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      buildRemoteAgentCoreWorkLoopContinuationCallbackBody({ context })
    );
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        text: expect.any(String),
      })
    );
    expect(completed).toMatchObject({ callbackStatus: "completed" });
  });

  it("preserves the canonical conversation identity for isolated Task execution", () => {
    const conversationId = "center-agent-task:task_123";
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest({ conversationId }),
    });

    expect(context.conversationId).toBe(conversationId);
  });

  it("builds Core callback bodies only from stored R1a context and assistant text", () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    context.navigationTarget = {
      kind: "project",
      projectId: "project_123",
    };

    expect(
      buildRemoteAgentCoreCallbackBody({
        context,
        text: "The blocker is the missing binding.",
      })
    ).toEqual({
      agentProfileId: request.agentProfileId,
      bindingId: request.bindingId,
      callbackAttempt: 1,
      dispatchId: request.dispatchId,
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      status: "completed",
      submissionId: ACK.submissionId,
      text: "The blocker is the missing binding.",
      triggerMessageId: request.triggerMessageId,
      navigationTarget: {
        kind: "project",
        projectId: "project_123",
      },
    });
  });

  it("shortens oversized assistant text explicitly at the callback boundary", () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });

    const callback = buildRemoteAgentCoreCallbackBody({
      context,
      text: "A".repeat(100_001),
    });

    expect(callback.status).toBe("completed");
    if (callback.status === "failed") {
      throw new Error("Expected a completed callback");
    }
    expect(callback.text).toHaveLength(100_000);
    expect(
      callback.text.endsWith(
        "_Response shortened because it exceeded OpenMeld's 100,000-character response limit._"
      )
    ).toBe(true);
  });

  it("builds Core failure callback bodies from stored context and stable failure facts", () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });

    expect(
      buildRemoteAgentCoreFailureCallbackBody({
        context,
        failure: {
          code: "remote_agent.turn_not_completed",
          detail: "provider 504",
          occurredAt: "2026-07-06T12:00:01.000Z",
          retryable: false,
        },
      })
    ).toEqual({
      agentProfileId: request.agentProfileId,
      bindingId: request.bindingId,
      callbackAttempt: 1,
      dispatchId: request.dispatchId,
      failureCode: "remote_agent.turn_not_completed",
      failureDetail: "provider 504",
      failureMessage:
        "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.",
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      status: "failed",
      submissionId: ACK.submissionId,
      triggerMessageId: request.triggerMessageId,
    });
  });

  it("keeps internal runtime names out of user-visible failure copy", () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });

    const callback = buildRemoteAgentCoreFailureCallbackBody({
      context,
      failure: {
        code: "remote_agent.empty_assistant_response",
        detail: "The provider returned no assistant text.",
        occurredAt: "2026-07-06T12:00:01.000Z",
        retryable: false,
      },
    });

    expect(callback).toMatchObject({
      failureMessage:
        "Center Agent didn't return a reply. Try again. If it keeps happening, open diagnostics in OpenMeld.",
      status: "failed",
    });
    expect(JSON.stringify(callback)).not.toContain("Remote Agent");
  });

  it("extracts only successful assistant text for Core completion callbacks", () => {
    expect(
      extractCompletedAssistantText({
        continuation: false,
        message: {
          parts: [
            { text: "First paragraph.", type: "text" },
            { output: { ok: true }, type: "tool-output-available" },
            { text: "Second paragraph.", type: "text" },
          ],
        },
        requestId: "flue_request_123",
        status: "completed",
      })
    ).toBe("First paragraph.\n\nSecond paragraph.");

    expect(
      extractCompletedAssistantText({
        continuation: false,
        error: "model error",
        message: { parts: [] },
        requestId: "flue_request_123",
        status: "error",
      })
    ).toBeNull();
  });

  it("records accepted Core callbacks as completed", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_reply_123",
      status: "accepted",
    }));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const updated = await handleRemoteAgentChatResponse({
        coreWorker: { completeRemoteAgentSubmission },
        nowMs: () => TEST_NOW_MS + 1000,
        result: {
          continuation: false,
          message: { parts: [{ text: "Done.", type: "text" }] },
          requestId: ACK.submissionId,
          status: "completed",
        },
        storage,
      });

      expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: request.idempotencyKey,
          submissionId: ACK.submissionId,
          text: "Done.",
        })
      );
      expect(updated).toMatchObject({
        callbackAttempts: 1,
        callbackCompletedAt: "2026-07-06T12:00:01.000Z",
        callbackStatus: "completed",
        lastCoreResponse: {
          publishedSignalId: "signal_reply_123",
          status: "accepted",
        },
      });
      expect(info).toHaveBeenCalledWith(
        "[remote_agent.admission.callback_sent]",
        expect.objectContaining({
          callbackAttempt: 1,
          dispatchId: request.dispatchId,
          idempotencyKey: request.idempotencyKey,
          spaceId: request.spaceId,
          submissionId: ACK.submissionId,
        })
      );
    } finally {
      info.mockRestore();
    }
  });

  it.each([
    "Center Agent Failure & Identity Continuity 还在推进；同时还有一批本机 Session。",
    "不是内容没查完。Space / 任务 / Session 都查完了；这和 Center Agent Failure & Identity Continuity 是一件事。",
  ])("publishes completed task answers regardless of ordinary failure-related words: %s", async (completedText) => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_reply_123",
      status: "accepted" as const,
    }));

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        message: { parts: [{ text: completedText, type: "text" }] },
        requestId: ACK.submissionId,
        status: "completed",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        submissionId: ACK.submissionId,
        text: completedText,
      })
    );
    expect(updated).toMatchObject({
      callbackStatus: "completed",
      completedText,
    });
  });

  it("publishes protocol-looking assistant prose as an ordinary reply", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_protocol_failure_123",
      status: "accepted" as const,
    }));

    const completedText =
      "The provider calls its typed event <tool_call>, but this sentence is only an explanation.";
    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        message: {
          parts: [
            {
              text: completedText,
              type: "text",
            },
          ],
        },
        requestId: ACK.submissionId,
        status: "completed",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        text: completedText,
      })
    );
    expect(updated).toMatchObject({
      callbackStatus: "completed",
      completedText,
    });
  });

  it("logs a bounded error summary when a Core callback delivery fails", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = await persistReadyCallbackContext(storage, "Done.");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const updated = await attemptRemoteAgentCallbackDelivery({
        context,
        coreWorker: {
          completeRemoteAgentSubmission: vi.fn(() =>
            Promise.reject(new Error("Core callback unavailable"))
          ),
        },
        nowMs: TEST_NOW_MS + 1000,
        storage,
      });

      expect(updated).toMatchObject({
        callbackAttempts: 1,
        callbackStatus: "retryable",
      });
      expect(error).toHaveBeenCalledWith(
        "[remote_agent.admission.callback_send_failed]",
        expect.objectContaining({
          callbackAttempt: 1,
          dispatchId: context.dispatchId,
          error: "Core callback unavailable",
          idempotencyKey: context.idempotencyKey,
          submissionId: context.submissionId,
        })
      );
    } finally {
      error.mockRestore();
    }
  });

  it.each([
    "submission_terminal_late",
    "submission_unknown",
  ])("does not route result identity %s into another pending turn", async (resultId) => {
    const storage = new InMemoryDurableObjectStorage();
    const terminalContext: RemoteAgentCallbackContext = {
      ...createRemoteAgentCallbackContext({
        ack: {
          ...ACK,
          requestId: "request_terminal_late",
          submissionId: "submission_terminal_late",
        },
        nowMs: TEST_NOW_MS,
        request: createSubmitTurnRequest({
          dispatchId: "dispatch_terminal_late",
          idempotencyKey: "remote-agent:dispatch_terminal_late",
        }),
      }),
      callbackStatus: "completed",
      completedText: "Already published.",
    };
    const pendingContext = createRemoteAgentCallbackContext({
      ack: {
        ...ACK,
        requestId: "request_other_pending",
        submissionId: "submission_other_pending",
      },
      nowMs: TEST_NOW_MS + 1,
      request: createSubmitTurnRequest({
        dispatchId: "dispatch_other_pending",
        idempotencyKey: "remote-agent:dispatch_other_pending",
      }),
    });
    await putRemoteAgentCallbackContext(storage, terminalContext);
    await putRemoteAgentCallbackContext(storage, pendingContext);
    const completeRemoteAgentSubmission = vi.fn();

    await expect(
      handleRemoteAgentChatResponse({
        coreWorker: { completeRemoteAgentSubmission },
        result: {
          continuation: false,
          message: { parts: [{ text: "Late result.", type: "text" }] },
          requestId: resultId,
          status: "completed",
        },
        storage,
      })
    ).resolves.toBeNull();
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
    const unchangedPending = await readRemoteAgentCallbackContext(
      storage,
      "submission_other_pending"
    );
    expect(unchangedPending).toMatchObject({
      callbackStatus: "pending",
      idempotencyKey: "remote-agent:dispatch_other_pending",
    });
    expect(unchangedPending).not.toHaveProperty("completedText");
  });

  it("does not guess a pending turn when a completion has no submission identity", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const pendingContext = createRemoteAgentCallbackContext({
      ack: {
        ...ACK,
        requestId: "request_pending_without_match",
        submissionId: "submission_pending_without_match",
      },
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest({
        dispatchId: "dispatch_pending_without_match",
        idempotencyKey: "remote-agent:dispatch_pending_without_match",
      }),
    });
    await putRemoteAgentCallbackContext(storage, pendingContext);
    const completeRemoteAgentSubmission = vi.fn();

    await expect(
      handleRemoteAgentChatResponse({
        coreWorker: { completeRemoteAgentSubmission },
        result: {
          continuation: false,
          message: { parts: [{ text: "Unattributed result.", type: "text" }] },
          status: "completed",
        },
        storage,
      })
    ).resolves.toBeNull();
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
    await expect(
      readRemoteAgentCallbackContext(
        storage,
        "submission_pending_without_match"
      )
    ).resolves.toMatchObject({
      callbackAttempts: 0,
      callbackStatus: "pending",
    });
  });

  it("schedules a bounded retry when the Core callback fails", () => {
    const updated = recordCallbackDeliveryFailure({
      context: readyCallbackContext("Reply text."),
      detail: "network timeout",
      nowMs: TEST_NOW_MS + 1000,
    });

    expect(updated).toMatchObject({
      callbackAttempts: 1,
      callbackStatus: "retryable",
      lastFailureFact: {
        code: "remote_agent.core_callback_failed",
        detail: "network timeout",
        retryable: true,
      },
    });
    expect(typeof updated.callbackNextAttemptAt).toBe("string");
  });

  it("fails closed when a remote agent turn has no Core-originated context", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const contexts = await listRemoteAgentCallbackContexts(storage, [
      "pending",
    ]);

    expect(() =>
      assertCoreOriginatedTurnContext(contexts[0] ?? null, TEST_NOW_MS)
    ).toThrow(RemoteAgentGuardrailError);
  });

  it("delivers terminal turn failures to Core as native delivery failures", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failure_123",
      status: "accepted",
    }));

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: "provider failed",
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        failureMessage:
          "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.",
        idempotencyKey: request.idempotencyKey,
        status: "failed",
        submissionId: ACK.submissionId,
      })
    );
    expect(updated).toMatchObject({
      callbackAttempts: 1,
      callbackCompletedAt: "2026-07-06T12:00:01.000Z",
      callbackStatus: "failed",
      lastFailureFact: {
        code: "remote_agent.turn_not_completed",
        detail: "provider failed",
        retryable: false,
      },
      lastCoreResponse: {
        publishedSignalId: "signal_failure_123",
        status: "accepted",
      },
    });
  });

  it("reports an explicit stopped outcome when execution was cancelled", async () => {
    const request = createSubmitTurnRequest();
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: ACK,
        nowMs: TEST_NOW_MS,
        request,
      })
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_stopped_123",
      status: "accepted",
    }));

    await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: "Stopped by the user.",
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "aborted",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.execution_cancelled",
        failureMessage: "This request was stopped.",
        status: "failed",
      })
    );
  });

  it("preserves object-shaped provider errors in terminal failure diagnostics", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failure_123",
      status: "accepted",
    }));

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: {
          details: "",
          message: "Cloudflare AI binding request failed with 502 Bad Gateway.",
          name: "FlueError",
          type: "operation_failed",
        } as unknown as string,
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        failureDetail:
          "Cloudflare AI binding request failed with 502 Bad Gateway.",
        status: "failed",
        submissionId: ACK.submissionId,
      })
    );
    expect(updated).toMatchObject({
      callbackStatus: "failed",
      lastFailureFact: {
        code: "remote_agent.turn_not_completed",
        detail: "Cloudflare AI binding request failed with 502 Bad Gateway.",
      },
    });
  });

  it("publishes a specific context-window failure while preserving its diagnostic detail", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failure_context_window",
      status: "accepted",
    }));
    const providerError =
      "This endpoint's maximum context length is 500000 tokens. However, you requested about 516153 tokens.";

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: providerError,
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn.context_window_exceeded",
        failureDetail: providerError,
        failureMessage:
          "This conversation has grown too long for Center Agent to continue in one request. Try again; OpenMeld will shorten older messages before continuing.",
        status: "failed",
        submissionId: ACK.submissionId,
      })
    );
    expect(updated).toMatchObject({
      callbackStatus: "failed",
      lastFailureFact: {
        code: "remote_agent.turn.context_window_exceeded",
        detail: providerError,
      },
    });
  });

  it("classifies xAI maximum prompt length failures as context overflow", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failure_xai_context_window",
      status: "accepted" as const,
    }));
    const providerError =
      "This model's maximum prompt length is 500000 but the request contains 949418 tokens.";

    await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: providerError,
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn.context_window_exceeded",
        failureDetail: providerError,
        status: "failed",
      })
    );
  });

  it("publishes a specific actionable failure when Flue cannot persist an oversized tool result", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failure_tool_result_too_large",
      status: "accepted",
    }));
    const persistenceError = "string or blob too big: SQLITE_TOOBIG";

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: persistenceError,
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.tool_result_too_large",
        failureDetail: persistenceError,
        failureMessage:
          "Center Agent tried to process too much data at once. Try again; it will read large files in smaller sections. If this keeps happening, open diagnostics.",
        status: "failed",
        submissionId: ACK.submissionId,
      })
    );
    expect(updated).toMatchObject({
      callbackStatus: "failed",
      lastFailureFact: {
        code: "remote_agent.tool_result_too_large",
        detail: persistenceError,
      },
    });
  });

  it("preserves nested provider errors in terminal failure diagnostics", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failure_123",
      status: "accepted",
    }));

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: {
          cause: {
            error: {
              message:
                "Cloudflare AI binding request failed with 429 Too Many Requests.",
            },
          },
          message: "[object Object]",
        } as unknown as string,
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        failureDetail:
          "Cloudflare AI binding request failed with 429 Too Many Requests.",
        status: "failed",
        submissionId: ACK.submissionId,
      })
    );
    expect(updated).toMatchObject({
      callbackStatus: "failed",
      lastFailureFact: {
        code: "remote_agent.turn_not_completed",
        detail:
          "Cloudflare AI binding request failed with 429 Too Many Requests.",
      },
    });
  });

  it("retries terminal turn failure callbacks when Core is temporarily unreachable", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const failing = vi.fn(() => Promise.reject(new Error("core down")));

    const firstAttempt = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission: failing },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: "provider failed",
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(failing).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        status: "failed",
      })
    );
    expect(firstAttempt).toMatchObject({
      callbackStatus: "retryable",
      lastFailureFact: {
        code: "remote_agent.core_callback_failed",
        retryable: true,
      },
    });

    const accepting = vi.fn(() =>
      Promise.resolve({
        publishedSignalId: "sig_failure_1",
        status: "accepted",
      })
    );
    const sweep = await redeliverDueRemoteAgentCallbacks({
      coreWorker: { completeRemoteAgentSubmission: accepting },
      nowMs: () => TEST_NOW_MS + 10 * 60 * 1000,
      storage,
    });

    expect(accepting).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        status: "failed",
      })
    );
    expect(sweep).toEqual({ nextDueAtMs: null, processed: 1 });
    const [failed] = await listRemoteAgentCallbackContexts(storage, ["failed"]);
    expect(failed).toMatchObject({
      callbackStatus: "failed",
      lastCoreResponse: {
        publishedSignalId: "sig_failure_1",
        status: "accepted",
      },
    });
  });

  it("recovers pre-fix terminal failures that were recorded before Core callback delivery", async () => {
    const request = createSubmitTurnRequest();
    const context = {
      ...createRemoteAgentCallbackContext({
        ack: ACK,
        nowMs: TEST_NOW_MS,
        request,
      }),
      callbackStatus: "failed" as const,
      lastFailureFact: {
        code: "remote_agent.turn_not_completed",
        detail: "provider failed before callback delivery existed",
        occurredAt: new Date(TEST_NOW_MS + 1000).toISOString(),
        retryable: false,
      },
    };
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);

    const accepting = vi.fn(() =>
      Promise.resolve({
        publishedSignalId: "sig_legacy_failure_1",
        status: "accepted",
      })
    );
    const sweep = await redeliverDueRemoteAgentCallbacks({
      coreWorker: { completeRemoteAgentSubmission: accepting },
      nowMs: () => TEST_NOW_MS + 10 * 60 * 1000,
      storage,
    });

    expect(accepting).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        status: "failed",
      })
    );
    expect(sweep).toEqual({ nextDueAtMs: null, processed: 1 });
    const [failed] = await listRemoteAgentCallbackContexts(storage, ["failed"]);
    expect(failed).toMatchObject({
      callbackCompletedAt: new Date(TEST_NOW_MS + 10 * 60 * 1000).toISOString(),
      callbackStatus: "failed",
      lastCoreResponse: {
        publishedSignalId: "sig_legacy_failure_1",
        status: "accepted",
      },
    });
  });

  it("re-delivers a retryable callback on the next due sweep exactly once", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = await persistReadyCallbackContext(storage, "Reply text.");
    const failing = vi.fn(() => Promise.reject(new Error("network timeout")));
    const afterFailure = await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: { completeRemoteAgentSubmission: failing },
      nowMs: TEST_NOW_MS,
      storage,
    });
    expect(afterFailure.callbackStatus).toBe("retryable");
    expect(failing).toHaveBeenCalledTimes(1);

    const accepting = vi.fn(() =>
      Promise.resolve({ publishedSignalId: "sig_1", status: "accepted" })
    );
    const sweep = await redeliverDueRemoteAgentCallbacks({
      coreWorker: { completeRemoteAgentSubmission: accepting },
      nowMs: () => TEST_NOW_MS + 10 * 60 * 1000,
      storage,
    });

    expect(accepting).toHaveBeenCalledTimes(1);
    expect(accepting).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: ACK.submissionId,
        text: "Reply text.",
      })
    );
    expect(sweep).toEqual({ nextDueAtMs: null, processed: 1 });
    const [completed] = await listRemoteAgentCallbackContexts(storage, [
      "completed",
    ]);
    expect(completed?.callbackStatus).toBe("completed");
  });

  it("retries when Core accepted the callback request but could not publish yet", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = await persistReadyCallbackContext(storage, "Reply text.");
    const retryable = vi.fn(() =>
      Promise.resolve({
        reasonCode: "remote_agent.callback_failure_publish_failed",
        retryAfterMs: 120_000,
        status: "retryable",
      })
    );
    const afterRetryable = await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: { completeRemoteAgentSubmission: retryable },
      nowMs: TEST_NOW_MS,
      storage,
    });

    expect(retryable).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackAttempt: 1,
        submissionId: ACK.submissionId,
      })
    );
    expect(afterRetryable).toMatchObject({
      callbackAttempts: 1,
      callbackNextAttemptAt: new Date(TEST_NOW_MS + 120_000).toISOString(),
      callbackStatus: "retryable",
      lastCoreResponse: {
        reasonCode: "remote_agent.callback_failure_publish_failed",
        retryAfterMs: 120_000,
        status: "retryable",
      },
      lastFailureFact: {
        code: "remote_agent.core_callback_failed",
        detail: "remote_agent.callback_failure_publish_failed",
        retryable: true,
      },
    });

    const accepting = vi.fn(() =>
      Promise.resolve({ publishedSignalId: "sig_1", status: "accepted" })
    );
    const sweep = await redeliverDueRemoteAgentCallbacks({
      coreWorker: { completeRemoteAgentSubmission: accepting },
      nowMs: () => TEST_NOW_MS + 10 * 60 * 1000,
      storage,
    });

    expect(accepting).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackAttempt: 2,
        submissionId: ACK.submissionId,
      })
    );
    expect(sweep).toEqual({ nextDueAtMs: null, processed: 1 });
    const [completed] = await listRemoteAgentCallbackContexts(storage, [
      "completed",
    ]);
    expect(completed).toMatchObject({
      callbackAttempts: 2,
      callbackStatus: "completed",
      lastCoreResponse: {
        publishedSignalId: "sig_1",
        status: "accepted",
      },
    });
  });

  it("keeps retrying a durable answer after the former callback attempt ceiling", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = await persistReadyCallbackContext(storage, "Reply text.");
    const retryable = vi.fn((_: unknown) =>
      Promise.resolve({
        reasonCode: "remote_agent.callback_delivery_exhausted",
        status: "retryable",
      })
    );
    await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: { completeRemoteAgentSubmission: retryable },
      nowMs: TEST_NOW_MS,
      storage,
    });

    for (let attempt = 2; attempt <= 7; attempt += 1) {
      await redeliverDueRemoteAgentCallbacks({
        coreWorker: { completeRemoteAgentSubmission: retryable },
        nowMs: () => TEST_NOW_MS + attempt * 10 * 60 * 1000,
        storage,
      });
    }

    expect(retryable).toHaveBeenCalledTimes(7);
    expect(
      retryable.mock.calls.map(([body]) => {
        return (body as { callbackAttempt?: number }).callbackAttempt;
      })
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const [pendingDelivery] = await listRemoteAgentCallbackContexts(storage, [
      "retryable",
    ]);
    expect(pendingDelivery).toMatchObject({
      callbackAttempts: 7,
      callbackNextAttemptAt: expect.any(String),
      callbackStatus: "retryable",
      lastCoreResponse: {
        reasonCode: "remote_agent.callback_delivery_exhausted",
        status: "retryable",
      },
      lastFailureFact: {
        code: "remote_agent.core_callback_failed",
        detail: "remote_agent.callback_delivery_exhausted",
        retryable: true,
      },
    });
  });

  it("caps callback backoff without ever giving up the durable result", () => {
    let context = readyCallbackContext("Reply text.");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      context = recordCallbackDeliveryFailure({
        context,
        detail: "core still unreachable",
        nowMs: TEST_NOW_MS,
      });
    }

    expect(context.callbackAttempts).toBe(20);
    expect(context.callbackStatus).toBe("retryable");
    expect(Date.parse(context.callbackNextAttemptAt ?? "")).toBe(
      TEST_NOW_MS + 300_000
    );
    expect(context.lastFailureFact).toMatchObject({
      code: "remote_agent.core_callback_failed",
      retryable: true,
    });
  });

  it("absorbs a duplicate Core callback only when Core already completed it", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = await persistReadyCallbackContext(storage, "Reply text.");
    const duplicateRejecting = vi.fn(() =>
      Promise.resolve({
        reasonCode: "remote_agent.callback_completed_submission",
        status: "duplicate_rejected",
      })
    );

    const updated = await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: { completeRemoteAgentSubmission: duplicateRejecting },
      nowMs: TEST_NOW_MS,
      storage,
    });

    expect(duplicateRejecting).toHaveBeenCalledTimes(1);
    expect(updated.callbackStatus).toBe("completed");
    expect(updated.lastCoreResponse).toMatchObject({
      status: "duplicate_rejected",
    });
  });

  it("does not misreport a duplicate callback for a failed Core delivery as completed", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = await persistReadyCallbackContext(storage, "Reply text.");
    const duplicateRejecting = vi.fn(() =>
      Promise.resolve({
        reasonCode: "remote_agent.callback_failed_submission",
        status: "duplicate_rejected",
      })
    );

    const updated = await attemptRemoteAgentCallbackDelivery({
      context,
      coreWorker: { completeRemoteAgentSubmission: duplicateRejecting },
      nowMs: TEST_NOW_MS,
      storage,
    });

    expect(updated.callbackStatus).toBe("rejected");
    expect(updated.lastFailureFact).toMatchObject({
      code: "remote_agent.callback_failed_submission",
      retryable: false,
    });
  });

  it("publishes the precise runtime failure instead of replacing it with turn_not_completed", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, context);
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal-provider-rate-limited",
      status: "accepted" as const,
    }));

    await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        error: new Error("provider request failed"),
        failureReasonCode:
          REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_RATE_LIMITED,
        message: { parts: [] },
        requestId: ACK.requestId,
        status: "error",
      },
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.provider.rate_limited",
        failureMessage:
          "The model provider rate-limited this request. Wait a moment, then wake the agent again.",
        status: "failed",
      })
    );
  });
});
