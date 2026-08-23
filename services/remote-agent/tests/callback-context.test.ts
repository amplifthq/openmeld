import {
  CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY,
  REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  assertCoreOriginatedTurnContext,
  attemptRemoteAgentCallbackDelivery,
  buildRemoteAgentCoreCallbackBody,
  buildRemoteAgentCoreFailureCallbackBody,
  createRemoteAgentCallbackContext,
  extractCompletedAssistantText,
  handleRemoteAgentChatResponse,
  listRemoteAgentCallbackContexts,
  putRemoteAgentCallbackContext,
  type RemoteAgentCallbackContext,
  RemoteAgentGuardrailError,
  readRemoteAgentCallbackContext,
  recordCallbackDeliveryFailure,
  recordRemoteAgentCenterAgentTaskReference,
  redeliverDueRemoteAgentCallbacks,
  sanitizeCenterAgentCompletedTextForPublication,
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
  it("publishes the latest canonical callback context after tools add Task references", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const staleContext = readyCallbackContext("Started the research Task.");
    const canonicalContext: RemoteAgentCallbackContext = {
      ...staleContext,
      centerAgentTaskReferences: [{ taskId: "task-1" }],
      conversationCompaction: {
        completedAtMs: TEST_NOW_MS,
        count: 1,
        v: 1,
      },
      navigationTarget: {
        kind: "project",
        projectId: "project-1",
      },
      outputAttachments: [
        {
          fileName: "research.png",
          id: "attachment-research-1",
          mimeType: "image/png",
          sizeBytes: 8,
        },
      ],
    };
    await putRemoteAgentCallbackContext(storage, canonicalContext);
    const completeRemoteAgentSubmission = vi.fn(() =>
      Promise.resolve({
        publishedSignalId: "signal_task_reply_1",
        status: "accepted" as const,
      })
    );

    const completed = await attemptRemoteAgentCallbackDelivery({
      context: staleContext,
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: TEST_NOW_MS + 1000,
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        centerAgentTaskReferences: [{ taskId: "task-1" }],
        conversationCompaction: {
          completedAtMs: TEST_NOW_MS,
          count: 1,
          v: 1,
        },
        navigationTarget: {
          kind: "project",
          projectId: "project-1",
        },
        attachments: [expect.objectContaining({ id: "attachment-research-1" })],
        text: "Started the research Task.",
      })
    );
    expect(completed).toMatchObject({
      callbackStatus: "completed",
      centerAgentTaskReferences: [{ taskId: "task-1" }],
      navigationTarget: {
        kind: "project",
        projectId: "project-1",
      },
      outputAttachments: [
        expect.objectContaining({ id: "attachment-research-1" }),
      ],
    });
    await expect(
      readRemoteAgentCallbackContext(storage, ACK.submissionId)
    ).resolves.toMatchObject({
      callbackStatus: "completed",
      centerAgentTaskReferences: [{ taskId: "task-1" }],
      conversationCompaction: {
        completedAtMs: TEST_NOW_MS,
        count: 1,
        v: 1,
      },
    });
  });

  it("durably carries a created Task reference into the final Core callback", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request: createSubmitTurnRequest(),
    });
    await putRemoteAgentCallbackContext(storage, context);
    expect(
      await readRemoteAgentCallbackContext(storage, ACK.submissionId)
    ).toEqual(context);

    const updated = await recordRemoteAgentCenterAgentTaskReference({
      storage,
      submissionId: ACK.submissionId,
      taskId: "task-1",
    });
    const replayed = await recordRemoteAgentCenterAgentTaskReference({
      storage,
      submissionId: ACK.submissionId,
      taskId: "task-1",
    });

    expect(updated.centerAgentTaskReferences).toEqual([{ taskId: "task-1" }]);
    expect(replayed.centerAgentTaskReferences).toEqual([{ taskId: "task-1" }]);
    expect(
      buildRemoteAgentCoreCallbackBody({ context: replayed, text: "Started." })
    ).toMatchObject({
      centerAgentTaskReferences: [{ taskId: "task-1" }],
    });
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

  it("keeps internal implementation failures out of completed user replies", () => {
    for (const unsafeReply of [
      "This turn's active tool catalog does not include Space management tools. Re-run this request in a session where those tools are enabled.",
      "I couldn't create the Space because the OpenMeld runtime profile ID was invalid.",
      "The openmeld_create_space tool is unavailable in this session.",
      "I couldn't create the Space because the tools are not enabled for this session.",
      "I couldn't create the Space because the action requires a verified OpenMeld member identity.",
      'The action catalog returned no match for "unread inbox count", even though 46 actions are available.',
      "This action requires a verified OpenMeld member identity.",
      "The action requires a verified OpenMeld member identity before I can create the Space.",
      "This action requires a verified OpenMeld member identity, so I haven't created the Space.",
      "I couldn't create the Space because the request was rejected with invalid_payload: password cannot be set for this access.",
    ]) {
      expect(sanitizeCenterAgentCompletedTextForPublication(unsafeReply)).toBe(
        "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team."
      );
    }

    expect(
      sanitizeCenterAgentCompletedTextForPublication(
        "I couldn't create the Space because you don't have permission. Ask an Organization owner to create it for you."
      )
    ).toBe(
      "I couldn't create the Space because you don't have permission. Ask an Organization owner to create it for you."
    );

    expect(
      sanitizeCenterAgentCompletedTextForPublication(
        "I used your verified OpenMeld member identity and created the Space."
      )
    ).toBe(
      "I used your verified OpenMeld member identity and created the Space."
    );

    expect(
      sanitizeCenterAgentCompletedTextForPublication(
        "This action requires a verified OpenMeld member identity. I used yours and created the Space successfully."
      )
    ).toBe(
      "This action requires a verified OpenMeld member identity. I used yours and created the Space successfully."
    );
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

  it("rejects provider protocol text instead of publishing it as an ordinary reply", async () => {
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

    const updated = await handleRemoteAgentChatResponse({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 1000,
      result: {
        continuation: false,
        message: {
          parts: [
            {
              text: "The streaming example is still open: `<tool_call>",
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
        failureCode: "remote_agent.assistant_protocol_contamination",
        failureMessage: CENTER_AGENT_REQUEST_FAILED_PUBLIC_COPY,
        status: "failed",
      })
    );
    expect(
      JSON.stringify(completeRemoteAgentSubmission.mock.calls)
    ).not.toContain("<tool_call>");
    expect(updated).toMatchObject({
      callbackStatus: "failed",
      terminalFailureFact: {
        code: "remote_agent.assistant_protocol_contamination",
      },
    });
  });

  it("publishes plain recovery copy instead of a completed internal failure", async () => {
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
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const updated = await handleRemoteAgentChatResponse({
        coreWorker: { completeRemoteAgentSubmission },
        nowMs: () => TEST_NOW_MS + 1000,
        result: {
          continuation: false,
          message: {
            parts: [
              {
                text: "This turn's active tool catalog does not include Space management tools. Re-run this request in a session where those tools are enabled.",
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
          submissionId: ACK.submissionId,
          text: "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.",
        })
      );
      expect(updated?.completedText).toBe(
        "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team."
      );
      expect(updated?.completedText).not.toContain("tool catalog");
      expect(warning).toHaveBeenCalledWith(
        "[remote_agent.publication.internal_detail_suppressed]",
        { submissionId: ACK.submissionId }
      );
    } finally {
      warning.mockRestore();
    }
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
