import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionStateKey,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import {
  buildRemoteAgentPromptMessage,
  buildRemoteAgentSubmissionMetadata,
} from "../agent-core/submission";
import {
  createFlueCenterAgentAdmissionHost,
  reconcileAndRedeliverRemoteAgentCallbacks,
  redeliverRemoteAgentCallbacksAndScheduleNextRetry,
  scheduleRemoteAgentCallbackRetry,
} from "../flue-adapter/center-agent-admission";
import {
  type CenterAgentNamespace,
  cancelExecutionInCenterAgent,
  readRuntimeDiagnosticsFromCenterAgent,
  readUsageDiagnosticsFromCenterAgent,
  submitConversationTurnToCenterAgent,
} from "../flue-adapter/cloudflare-entrypoint";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  createSubmitTurnRequestV2,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const RECEIPT_PREFIX = "openmeld:remote-agent:submission-receipt:";

describe("Flue Cloudflare entrypoints", () => {
  it("passes the parsed submit request and idempotency key to the Center Agent Durable Object", async () => {
    const request = createSubmitTurnRequest();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const submitConversationTurn = vi.fn(async (input: unknown) => ({
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: (input as typeof request).idempotencyKey,
      requestId: "flue_submission_123",
      status: "pending",
      submissionId: "flue_submission_123",
    }));
    const namespace = {
      get: vi.fn(() => ({ submitConversationTurn })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;

    try {
      await submitConversationTurnToCenterAgent({
        namespace,
        request,
      });

      expect(namespace.idFromName).toHaveBeenCalledWith(request.spaceId);
      expect(submitConversationTurn).toHaveBeenCalledWith(request);
      expect(submitConversationTurn.mock.calls[0]?.[0]).toMatchObject({
        idempotencyKey: request.idempotencyKey,
      });
      expect(info).toHaveBeenNthCalledWith(
        1,
        "[remote_agent.admission.received]",
        expect.objectContaining({
          dispatchId: request.dispatchId,
          idempotencyKey: request.idempotencyKey,
          organizationId: request.organizationId,
          spaceId: request.spaceId,
        })
      );
      expect(info).toHaveBeenNthCalledWith(
        2,
        "[remote_agent.admission.ack_returned]",
        expect.objectContaining({
          dispatchId: request.dispatchId,
          idempotencyKey: request.idempotencyKey,
          spaceId: request.spaceId,
        })
      );
    } finally {
      info.mockRestore();
    }
  });

  it("routes an isolated Task turn by canonical conversation identity", async () => {
    const request = createSubmitTurnRequest({
      conversationId: "center-agent-task:task_123",
    });
    const submitConversationTurn = vi.fn(async () => ({
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      status: "pending",
      submissionId: "flue_submission_task_123",
    }));
    const namespace = {
      get: vi.fn(() => ({ submitConversationTurn })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;

    await submitConversationTurnToCenterAgent({ namespace, request });

    expect(namespace.idFromName).toHaveBeenCalledWith(
      "center-agent-task:task_123"
    );
    expect(submitConversationTurn).toHaveBeenCalledWith(request);
  });

  it("preserves a deterministic history-limit rejection from the Durable Object", async () => {
    const request = createSubmitTurnRequest();
    const rejection = {
      idempotencyKey: request.idempotencyKey,
      message:
        "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.conversation_history_limit_exceeded" as const,
      v: 1 as const,
    };
    const submitConversationTurn = vi.fn(async () => rejection);
    const namespace = {
      get: vi.fn(() => ({ submitConversationTurn })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      await expect(
        submitConversationTurnToCenterAgent({ namespace, request })
      ).resolves.toEqual(rejection);
      expect(submitConversationTurn).toHaveBeenCalledWith(request);
    } finally {
      info.mockRestore();
    }
  });

  it("rejects a Task turn whose typed identity conflicts with its conversation route", async () => {
    const { v: _version, ...baseRequest } = createSubmitTurnRequestV2();
    const request = {
      ...baseRequest,
      conversationId: "center-agent-task:task_123",
      conversationIdentity: {
        kind: "center_agent_task" as const,
        taskId: "task_other",
      },
      v: 3 as const,
    };
    const namespace = {
      get: vi.fn(),
      idFromName: vi.fn(),
    } as unknown as CenterAgentNamespace;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        submitConversationTurnToCenterAgent({ namespace, request })
      ).resolves.toEqual({
        idempotencyKey: request.idempotencyKey,
        message:
          "Remote Agent Task conversation identity does not match its route.",
        outcome: "rejected",
        reasonCode: "remote_agent.center_agent_task_identity_mismatch",
        v: 1,
      });
      expect(namespace.idFromName).not.toHaveBeenCalled();
      expect(namespace.get).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("routes Task cancellation to the same canonical conversation", async () => {
    const cancelExecution = vi.fn(async () => ({ status: "not_found" }));
    const namespace = {
      get: vi.fn(() => ({ cancelExecution })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;

    await cancelExecutionInCenterAgent({
      namespace,
      request: {
        conversationId: "center-agent-task:task_123",
        idempotencyKey: "task_attempt_1",
        organizationId: "org_123",
        reason: "Stopped by the user.",
        spaceId: "space_123",
        submissionId: "submission_1",
        v: 1,
      },
    });

    expect(namespace.idFromName).toHaveBeenCalledWith(
      "center-agent-task:task_123"
    );
  });

  it("routes Routine retries to the target Space conversation Durable Object", async () => {
    const baseRequest = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      author: {
        displayName: "Center Agent",
        profileId: baseRequest.agentProfileId,
        profileKind: "agent",
      },
      dispatchId: "routine_run_1",
      idempotencyKey: "routine_run_1",
      onBehalfOf: null,
      sourceClientMessageId: null,
      triggerMessageId: "routine_run_1",
      turnEnvelope: createRoutineTurnEnvelope(),
    });
    const submitConversationTurn = vi.fn(async () => ({
      accepted: false,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      status: "running",
      submissionId: "flue_submission_routine_1",
    }));
    const namespace = {
      get: vi.fn(() => ({ submitConversationTurn })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;

    await submitConversationTurnToCenterAgent({ namespace, request });
    await submitConversationTurnToCenterAgent({ namespace, request });

    expect(namespace.idFromName).toHaveBeenNthCalledWith(1, "space_123");
    expect(namespace.idFromName).toHaveBeenNthCalledWith(2, "space_123");
  });

  it("returns a structured rejection before a Routine with conflicting identity reaches the Durable Object", async () => {
    const baseRequest = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      author: {
        displayName: "Center Agent",
        profileId: baseRequest.agentProfileId,
        profileKind: "agent",
      },
      dispatchId: "routine_run_identity_mismatch",
      idempotencyKey: "routine_run_identity_mismatch",
      onBehalfOf: {
        displayName: "Felix",
        profileId: "22222222-2222-4222-8222-222222222222",
        profileKind: "human",
      },
      sourceClientMessageId: null,
      triggerMessageId: "routine_run_identity_mismatch",
      turnEnvelope: createRoutineTurnEnvelope({
        routineId: "routine_identity_mismatch",
        routineName: "Confirm in Slack",
        runId: "routine_run_identity_mismatch",
      }),
    });
    const namespace = {
      get: vi.fn(),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(
        submitConversationTurnToCenterAgent({ namespace, request })
      ).resolves.toEqual({
        idempotencyKey: request.idempotencyKey,
        message:
          "Remote Agent Routine execution identity does not match its turn envelope.",
        outcome: "rejected",
        reasonCode: "remote_agent.routine_identity_mismatch",
        v: 1,
      });
      expect(namespace.idFromName).not.toHaveBeenCalled();
      expect(namespace.get).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "[remote_agent.admission.rejected]",
        expect.objectContaining({
          idempotencyKey: request.idempotencyKey,
          reasonCode: "remote_agent.routine_identity_mismatch",
        })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("reads normal and Routine usage from the exact runtime conversation Durable Object", async () => {
    const readUsageDiagnostics = vi.fn().mockResolvedValueOnce({
      records: [
        { recordedAt: "2026-07-12T12:00:01.000Z", source: "routine" },
        { recordedAt: "2026-07-12T12:00:02.000Z", source: "dm" },
      ],
      spaceId: "space_123",
    });
    const namespace = {
      get: vi.fn(() => ({ readUsageDiagnostics })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;

    await expect(
      readUsageDiagnosticsFromCenterAgent({
        namespace,
        request: {
          organizationId: "org_123",
          runtimeConversationId: "runtime_conversation_2",
          spaceId: "space_123",
        },
      })
    ).resolves.toEqual({
      records: [
        { recordedAt: "2026-07-12T12:00:01.000Z", source: "routine" },
        { recordedAt: "2026-07-12T12:00:02.000Z", source: "dm" },
      ],
      spaceId: "space_123",
    });
    expect(namespace.idFromName).toHaveBeenCalledOnce();
    expect(namespace.idFromName).toHaveBeenCalledWith("runtime_conversation_2");
    expect(readUsageDiagnostics).toHaveBeenCalledWith({
      organizationId: "org_123",
      spaceId: "space_123",
    });
  });

  it("rejects invalid usage diagnostics RPC input before selecting a Durable Object", async () => {
    const namespace = {
      get: vi.fn(),
      idFromName: vi.fn(),
    } as unknown as CenterAgentNamespace;

    await expect(
      readUsageDiagnosticsFromCenterAgent({ namespace, request: null })
    ).rejects.toThrow();
    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.get).not.toHaveBeenCalled();
  });

  it("reads runtime diagnostics from the exact runtime conversation Durable Object", async () => {
    const response = {
      activeRuns: [],
      attemptMarkers: [],
      callbackContexts: [],
      collectedAt: "2026-07-28T00:00:00.000Z",
      durableObjectAlarmAtMs: 123,
      fibers: [],
      schedules: [],
      spaceId: "space_123",
      submissions: [],
      v: 1,
    } as const;
    const readRuntimeDiagnostics = vi.fn().mockResolvedValueOnce(response);
    const namespace = {
      get: vi.fn(() => ({ readRuntimeDiagnostics })),
      idFromName: vi.fn(
        (name: string) =>
          `durable-object-id:${name}` as unknown as DurableObjectId
      ),
    } as unknown as CenterAgentNamespace;

    await expect(
      readRuntimeDiagnosticsFromCenterAgent({
        namespace,
        request: {
          runtimeConversationId: "runtime_conversation_2",
          spaceId: "space_123",
        },
      })
    ).resolves.toEqual(response);
    expect(namespace.idFromName).toHaveBeenCalledWith("runtime_conversation_2");
    expect(readRuntimeDiagnostics).toHaveBeenCalledWith({
      spaceId: "space_123",
    });
  });

  it("returns deterministic Flue dispatch ACKs with the original OpenMeld idempotency key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW_MS);
    const request = createSubmitTurnRequest();
    const registerProvider = vi.fn();
    const routeRequest = vi.fn(
      async (_request: Request): Promise<Response> =>
        Response.json({
          acceptedAt: new Date(TEST_NOW_MS).toISOString(),
          submissionId: request.dispatchId,
        })
    );
    const host = createFlueCenterAgentAdmissionHost({
      registerProvider,
      routeRequest,
    });

    try {
      const ack = await host.admitConversationTurn({
        images: [
          {
            type: "image",
            data: "AQID",
            mimeType: "image/png",
            filename: "diagram.png",
          },
        ],
        message: buildRemoteAgentPromptMessage(request),
        metadata: buildRemoteAgentSubmissionMetadata({
          request,
          submittedAtMs: TEST_NOW_MS,
        }),
        request,
        submissionId: request.dispatchId,
      });
      const flueRequest = routeRequest.mock.calls[0]?.[0] as
        | Request
        | undefined;

      expect(registerProvider).toHaveBeenCalledWith({
        organizationId: request.organizationId,
      });
      expect(flueRequest?.url).toBe(
        "https://flue.internal/__flue/internal/dispatch"
      );
      await expect(flueRequest?.json()).resolves.toEqual({
        acceptedAt: new Date(TEST_NOW_MS).toISOString(),
        agent: "center-agent-v2",
        submissionId: request.dispatchId,
        id: request.spaceId,
        message: {
          kind: "user",
          body: buildRemoteAgentPromptMessage(request),
          attachments: [
            {
              type: "image",
              data: "AQID",
              mimeType: "image/png",
              filename: "diagram.png",
            },
          ],
        },
      });
      expect(ack).toEqual({
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: request.dispatchId,
        status: "pending",
        submissionId: request.dispatchId,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules callback retry with an idempotent Flue task", async () => {
    const schedule = vi.fn(async () => undefined);

    await scheduleRemoteAgentCallbackRetry({
      dueAtIso: new Date(TEST_NOW_MS + 12_500).toISOString(),
      nowMs: () => TEST_NOW_MS,
      schedule,
    });

    expect(schedule).toHaveBeenCalledWith(
      13,
      "retryRemoteAgentCallbacks",
      undefined,
      { idempotent: true }
    );
  });

  it("reconciles durable failures from the callback alarm before continuing ordinary redelivery", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const unreadableSubmissionId = "submission_alarm_unreadable";
    const failedSubmissionId = "submission_alarm_failed";
    const retryableSubmissionId = "submission_alarm_retryable";
    for (const submissionId of [
      unreadableSubmissionId,
      failedSubmissionId,
      retryableSubmissionId,
    ]) {
      await initializeRemoteAgentExecutionState({
        acceptedAtMs: TEST_NOW_MS,
        identity: {
          idempotencyKey: request.idempotencyKey,
          organizationId: request.organizationId,
          spaceId: request.spaceId,
          submissionId,
          v: 1,
        },
        storage,
      });
      await putRemoteAgentCallbackContext(storage, {
        ...createRemoteAgentCallbackContext({
          ack: {
            accepted: true,
            createdAt: TEST_NOW_MS,
            idempotencyKey: request.idempotencyKey,
            status: "pending",
            submissionId,
          },
          nowMs: TEST_NOW_MS,
          request,
        }),
        ...(submissionId === retryableSubmissionId
          ? {
              callbackNextAttemptAt: new Date(TEST_NOW_MS).toISOString(),
              callbackStatus: "retryable" as const,
              completedText: "The original callback result.",
            }
          : {}),
      });
    }
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_alarm_callback",
      status: "accepted" as const,
    }));
    const schedule = vi.fn(async () => undefined);
    const readError = new Error("submission storage is temporarily unreadable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      await expect(
        reconcileAndRedeliverRemoteAgentCallbacks({
          coreWorker: { completeRemoteAgentSubmission },
          nowMs: () => TEST_NOW_MS + 1000,
          readSubmission: (submissionId) => {
            if (submissionId === unreadableSubmissionId) {
              return Promise.reject(readError);
            }
            return Promise.resolve(
              submissionId === failedSubmissionId
                ? {
                    error: "Sandbox materialization failed.",
                    status: "settled" as const,
                  }
                : { status: "running" as const }
            );
          },
          schedule,
          storage,
        })
      ).resolves.toEqual({
        nextDueAtMs: TEST_NOW_MS,
        processed: 0,
        reconciled: 1,
      });

      expect(consoleError).toHaveBeenCalledWith(
        "[remote_agent.execution.reconciliation_failed]",
        expect.objectContaining({
          error: readError.message,
          submissionId: unreadableSubmissionId,
        })
      );
      expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
      expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          submissionId: failedSubmissionId,
        })
      );
      expect(completeRemoteAgentSubmission).not.toHaveBeenCalledWith(
        expect.objectContaining({ submissionId: retryableSubmissionId })
      );
      expect(schedule).toHaveBeenCalledOnce();
      expect(schedule).toHaveBeenCalledWith(
        1,
        "retryRemoteAgentCallbacks",
        undefined,
        { idempotent: true }
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("fences due retryable callbacks from terminal execution owners before alarm redelivery", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const failedSubmissionId = "submission_alarm_retryable_failed_owner";
    const legacySubmissionId =
      "submission_alarm_retryable_legacy_completed_without_answer";

    for (const submissionId of [failedSubmissionId, legacySubmissionId]) {
      const identity = {
        idempotencyKey: request.idempotencyKey,
        organizationId: request.organizationId,
        spaceId: request.spaceId,
        submissionId,
        v: 1 as const,
      };
      const initial = await initializeRemoteAgentExecutionState({
        acceptedAtMs: TEST_NOW_MS,
        identity,
        storage,
      });
      if (submissionId === failedSubmissionId) {
        await completeRemoteAgentExecutionState({
          identity,
          nowMs: TEST_NOW_MS + 100,
          status: "failed",
          storage,
        });
      } else {
        await storage.put(buildRemoteAgentExecutionStateKey(submissionId), {
          ...initial,
          completedAtMs: TEST_NOW_MS + 100,
          lastProgressAtMs: TEST_NOW_MS + 100,
          lastProgressKind: "prompt_completed",
          status: "completed",
        });
      }
      await putRemoteAgentCallbackContext(storage, {
        ...createRemoteAgentCallbackContext({
          ack: {
            accepted: true,
            createdAt: TEST_NOW_MS,
            idempotencyKey: request.idempotencyKey,
            status: "pending",
            submissionId,
          },
          nowMs: TEST_NOW_MS,
          request,
        }),
        callbackAttempts: 1,
        callbackNextAttemptAt: new Date(TEST_NOW_MS + 200).toISOString(),
        callbackStatus: "retryable",
        completedText: `Stale success for ${submissionId}`,
      });
    }
    const completeRemoteAgentSubmission = vi.fn(
      async (_body: { submissionId: string; text?: string }) => ({
        publishedSignalId: "signal_alarm_owner_fenced",
        status: "accepted" as const,
      })
    );
    const readSubmission = vi.fn(async () => ({ status: "settled" as const }));
    const schedule = vi.fn(async () => undefined);

    await expect(
      reconcileAndRedeliverRemoteAgentCallbacks({
        coreWorker: { completeRemoteAgentSubmission },
        nowMs: () => TEST_NOW_MS + 1000,
        readSubmission,
        schedule,
        storage,
      })
    ).resolves.toEqual({
      nextDueAtMs: null,
      processed: 0,
      reconciled: 2,
    });

    expect(readSubmission).not.toHaveBeenCalled();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledTimes(2);
    for (const submissionId of [failedSubmissionId, legacySubmissionId]) {
      const callback = completeRemoteAgentSubmission.mock.calls.find(
        ([body]) => body.submissionId === submissionId
      )?.[0];
      expect(callback).toMatchObject({ status: "failed", submissionId });
      expect(callback).not.toHaveProperty("text");
      await expect(
        readRemoteAgentCallbackContext(storage, submissionId)
      ).resolves.toMatchObject({
        callbackAttempts: 2,
        callbackStatus: "failed",
        terminalFailureFact: {
          code: "remote_agent.turn_not_completed",
        },
      });
      await expect(
        readRemoteAgentCallbackContext(storage, submissionId)
      ).resolves.not.toHaveProperty("completedText");
    }
    expect(schedule).not.toHaveBeenCalled();
  });

  it("keeps the Agents SDK alarm idle when only admission receipts have expiry work", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const schedule = vi.fn(async () => undefined);
    await storage.putExpiring(
      `${RECEIPT_PREFIX}future-only`,
      { requestDigest: "future-only" },
      TEST_NOW_MS + 10_000
    );

    await expect(
      redeliverRemoteAgentCallbacksAndScheduleNextRetry({
        nowMs: () => TEST_NOW_MS,
        schedule,
        storage,
      })
    ).resolves.toEqual({ nextDueAtMs: null, processed: 0 });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("keeps callback retry scheduling alive while a model result is still pending", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const schedule = vi.fn(async () => undefined);
    const request = createSubmitTurnRequest();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          status: "pending",
          submissionId: "submission_pending_model_result",
        },
        nowMs: TEST_NOW_MS,
        request,
      })
    );

    await expect(
      redeliverRemoteAgentCallbacksAndScheduleNextRetry({
        nowMs: () => TEST_NOW_MS + 5000,
        schedule,
        storage,
      })
    ).resolves.toEqual({
      nextDueAtMs: TEST_NOW_MS + 10_000,
      processed: 0,
    });
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(
      5,
      "retryRemoteAgentCallbacks",
      undefined,
      { idempotent: true }
    );
  });

  it("re-arms only from callback due time and leaves admission receipts for lazy cleanup", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const schedule = vi.fn(async () => undefined);
    const request = createSubmitTurnRequest();
    await putRemoteAgentCallbackContext(storage, {
      ...createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          status: "pending",
          submissionId: "submission_callback_retry_alarm",
        },
        nowMs: TEST_NOW_MS,
        request,
      }),
      callbackAttempts: 1,
      callbackNextAttemptAt: new Date(TEST_NOW_MS + 60_000).toISOString(),
      callbackStatus: "retryable",
      completedText: "The unattended run completed.",
    });
    const expiredReceiptKey = `${RECEIPT_PREFIX}expired`;
    const futureReceiptKey = `${RECEIPT_PREFIX}future`;
    await storage.putExpiring(
      expiredReceiptKey,
      { requestDigest: "expired" },
      TEST_NOW_MS - 1
    );
    await storage.putExpiring(
      futureReceiptKey,
      { requestDigest: "future" },
      TEST_NOW_MS + 10_000
    );

    await expect(
      redeliverRemoteAgentCallbacksAndScheduleNextRetry({
        nowMs: () => TEST_NOW_MS,
        schedule,
        storage,
      })
    ).resolves.toEqual({
      nextDueAtMs: TEST_NOW_MS + 60_000,
      processed: 0,
    });
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(
      60,
      "retryRemoteAgentCallbacks",
      undefined,
      { idempotent: true }
    );
    await expect(storage.get(expiredReceiptKey)).resolves.toEqual({
      requestDigest: "expired",
    });
    await expect(storage.get(futureReceiptKey)).resolves.toEqual({
      requestDigest: "future",
    });
  });
});
