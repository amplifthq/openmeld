import { DatabaseSync } from "node:sqlite";
import {
  buildSpaceAttachmentObjectKey,
  type CloudComputerInvocationState,
} from "@openmeld/schemas";
import type { AiUsageRecord } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { cloudflare } from "../.flue/agents/center-agent";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionIdentity,
  buildRemoteAgentExecutionStateKey,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
} from "../agent-core/execution-state";
import { RemoteAgentImageTransformQuotaError } from "../agent-core/image-understanding";
import {
  buildRemoteAgentName,
  buildRemoteAgentPromptMessage,
  buildRemoteAgentSubmissionMetadata,
  RemoteAgentAdmissionRejectedError,
  submitRemoteAgentConversationTurn,
} from "../agent-core/submission";
import {
  createFlueCenterAgentAdmissionHost,
  reconcileAndRedeliverRemoteAgentCallbacks,
  redeliverRemoteAgentCallbacksAndScheduleNextRetry,
} from "../flue-adapter/center-agent-admission";
import {
  type CenterAgentNamespace,
  cancelExecutionInCenterAgent,
  readAdmissionFromCenterAgent,
  readAdmissionStopFromCenterAgent,
  readRuntimeDiagnosticsFromCenterAgent,
  readUsageDiagnosticsFromCenterAgent,
  runDurableAuxiliaryInference,
  submitConversationTurnToCenterAgent,
} from "../flue-adapter/cloudflare-entrypoint";
import { bindComputerCommandTarget } from "../flue-adapter/computer-command";
import {
  listComputerCleanupHandoffs,
  requestComputerCleanup,
} from "../flue-adapter/execution-cleanup";
import { createRemoteAgentSqlStorage } from "../flue-adapter/storage";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  createSubmitTurnRequestV2,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const RECEIPT_PREFIX = "openmeld:remote-agent:submission-receipt:";

function createCloudflareSqlHarness(database: DatabaseSync) {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const statement = database.prepare(query);
      if (statement.columns().length > 0) {
        const rows = statement.all(...(bindings as never[])) as Record<
          string,
          unknown
        >[];
        return { rowsWritten: 0, toArray: () => rows };
      }
      const result = statement.run(...(bindings as never[]));
      return { rowsWritten: Number(result.changes), toArray: () => [] };
    },
  };
}

async function seedPendingUsage(
  storage: ReturnType<typeof createRemoteAgentSqlStorage>,
  count: number
) {
  for (let index = 0; index < count; index++) {
    const record: AiUsageRecord = {
      eventId: `usage-${index}`,
      organizationId: "org-1",
      purpose: "agent",
      agentProfileId: "agent-1",
      spaceId: "space-1",
      taskId: "task-1",
      attemptId: "attempt-1",
      provider: "openrouter",
      model: "openai/gpt-5",
      source: "openrouter_response",
      status: "pending",
      providerRequestId: null,
      occurredAtMs: TEST_NOW_MS,
      runtime: "remote",
      controller: null,
      computerId: null,
      tokens: null,
      cost: null,
    };
    await storage.put(`openmeld:ai-usage:pending:${record.eventId}`, record);
  }
}

describe("Flue Cloudflare entrypoints", () => {
  it("returns a retained image quota rejection through the actual Durable Object entrypoint", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW_MS);
    const database = new DatabaseSync(":memory:");
    const sql = createCloudflareSqlHarness(database);
    const storage = createRemoteAgentSqlStorage(sql);
    const request = createSubmitTurnRequestV2({
      messages: [
        {
          role: "user",
          content: "Inspect the attached images.",
          attachments: [
            {
              id: "transient-channel-image",
              mimeType: "image/png",
              sizeBytes: 3,
              removeAfterAdmission: true,
            },
            {
              id: "canonical-image",
              objectKey: "space-files/canonical-image/revision-1",
              mimeType: "image/png",
              sizeBytes: 3,
            },
          ],
        },
      ],
    });
    const attachmentBucket = {
      get: vi.fn(() =>
        Promise.resolve({
          size: 3,
          body: new Response(new Uint8Array([1, 2, 3])).body,
        })
      ),
      delete: vi.fn(() => Promise.resolve()),
    } as unknown as Pick<R2Bucket, "get" | "delete">;
    try {
      await expect(
        submitRemoteAgentConversationTurn({
          agentName: buildRemoteAgentName(request),
          input: request,
          storage,
          attachmentBucket,
          host: {
            prepareConversationTurn: () =>
              Promise.reject(new RemoteAgentImageTransformQuotaError("9422")),
            admitConversationTurn: vi.fn(),
          },
        })
      ).rejects.toBeInstanceOf(RemoteAgentAdmissionRejectedError);
      if (!cloudflare.base) {
        throw new Error("The Cloudflare extension requires a base.");
      }
      const Runtime = cloudflare.base(class {} as never);
      const onRequest = vi.fn();
      const runtime = Object.assign(Object.create(Runtime.prototype), {
        ctx: { storage: { sql, get: () => Promise.resolve(undefined) } },
        env: { OPENMELD_SPACE_ATTACHMENTS: attachmentBucket },
        name: buildRemoteAgentName(request),
        onRequest,
      }) as { submitConversationTurn(input: typeof request): Promise<unknown> };
      await expect(
        runtime.submitConversationTurn(request)
      ).resolves.toMatchObject({
        v: 1,
        outcome: "rejected",
        idempotencyKey: request.idempotencyKey,
        reasonCode: "remote_agent.image_transform_quota_exceeded",
      });
      await expect(
        runtime.submitConversationTurn(request)
      ).resolves.toMatchObject({ outcome: "rejected" });
      const transientKey = buildSpaceAttachmentObjectKey({
        id: "transient-channel-image",
        organizationId: request.organizationId,
        spaceId: request.spaceId,
      });
      expect(attachmentBucket.delete).toHaveBeenCalledTimes(2);
      expect(attachmentBucket.delete).toHaveBeenNthCalledWith(1, transientKey);
      expect(attachmentBucket.delete).toHaveBeenNthCalledWith(2, transientKey);
      expect(onRequest).not.toHaveBeenCalled();
      expect(
        await readRemoteAgentCallbackContext(storage, request.dispatchId)
      ).toBeNull();
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });
  it("reads Stop proof from the original Task owner without cancelling or admitting work", async () => {
    const request = createSubmitTurnRequest({
      conversationId: "center-agent-task:stopped-task",
    });
    const readAdmissionStop = vi.fn(async () => ({
      v: 1,
      status: "not_found",
    }));
    const submitConversationTurn = vi.fn();
    const cancelExecution = vi.fn();
    const namespace = {
      get: vi.fn(() => ({
        readAdmissionStop,
        submitConversationTurn,
        cancelExecution,
      })),
      idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
    } as unknown as CenterAgentNamespace;
    await expect(
      readAdmissionStopFromCenterAgent({ namespace, request })
    ).resolves.toEqual({ v: 1, status: "not_found" });
    expect(namespace.idFromName).toHaveBeenCalledWith(request.conversationId);
    expect(readAdmissionStop).toHaveBeenCalledWith(request);
    expect(submitConversationTurn).not.toHaveBeenCalled();
    expect(cancelExecution).not.toHaveBeenCalled();
  });
  it("reads admission in the original Task conversation without submitting another turn", async () => {
    const request = createSubmitTurnRequest({
      conversationId: "center-agent-task:task_123",
    });
    const readAdmission = vi.fn(async () => ({ v: 1, status: "unconfirmed" }));
    const submitConversationTurn = vi.fn();
    const namespace = {
      get: vi.fn(() => ({ readAdmission, submitConversationTurn })),
      idFromName: vi.fn((name: string) => name as unknown as DurableObjectId),
    } as unknown as CenterAgentNamespace;
    await expect(
      readAdmissionFromCenterAgent({ namespace, request })
    ).resolves.toEqual({
      v: 1,
      status: "unconfirmed",
    });
    expect(namespace.idFromName).toHaveBeenCalledWith(request.conversationId);
    expect(readAdmission).toHaveBeenCalledWith(request);
    expect(submitConversationTurn).not.toHaveBeenCalled();
  });
  it("routes auxiliary title inference through durable execution instead of a transient Worker", async () => {
    const generateCenterAgentSessionTitle = vi.fn(async () => ({
      title: "Usage review",
    }));
    const namespace = {
      get: vi.fn(() => ({ generateCenterAgentSessionTitle })),
      idFromName: vi.fn((name: string) => name),
    } as unknown as CenterAgentNamespace;
    const request = {
      organizationId: "org-1",
      spaceId: "space-1",
      sourceSignalId: "signal-1",
      text: "Review usage",
      attachmentNames: [],
    };
    await expect(
      runDurableAuxiliaryInference({
        namespace,
        operation: "generateCenterAgentSessionTitle",
        request,
      })
    ).resolves.toEqual({ title: "Usage review" });
    expect(namespace.idFromName).toHaveBeenCalledWith("space-1");
    expect(generateCenterAgentSessionTitle).toHaveBeenCalledWith(request);
  });
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
          errorName: "Error",
          submissionId: unreadableSubmissionId,
        })
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        readError.message
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
        expect.objectContaining({ retryAt: expect.any(Number) }),
        { idempotent: true }
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it.each([
    { failure: "usage_flush", pendingUsageCount: 1 },
    { failure: "usage_rearm", pendingUsageCount: 100 },
    { failure: "missing_reader", pendingUsageCount: 0 },
  ] as const)("continues the original Stop cleanup when the callback alarm fails at $failure", async ({
    failure,
    pendingUsageCount,
  }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TEST_NOW_MS);
    const database = new DatabaseSync(":memory:");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const sql = createCloudflareSqlHarness(database);
      const storage = createRemoteAgentSqlStorage(sql);
      const request = createSubmitTurnRequest();
      const submissionId = "submission_alarm_cleanup";
      const context = {
        ...createRemoteAgentCallbackContext({
          request,
          nowMs: TEST_NOW_MS,
          ack: {
            accepted: true,
            createdAt: TEST_NOW_MS,
            idempotencyKey: request.idempotencyKey,
            status: "pending",
            submissionId,
          },
        }),
        computerIsolationVersion: 3 as const,
      };
      await putRemoteAgentCallbackContext(storage, context);
      await initializeRemoteAgentExecutionState({
        acceptedAtMs: TEST_NOW_MS,
        identity: buildRemoteAgentExecutionIdentity(context),
        storage,
      });
      await bindComputerCommandTarget({
        storage,
        submissionId,
        computerName: "personal-computer:original-owner",
      });
      const state: CloudComputerInvocationState = {
        invocationId: submissionId,
        total: 0,
        unfinished: 0,
        pendingResults: 0,
        unavailable: 0,
        commands: [],
      };
      const deliverCleanup = vi
        .fn(async () => state)
        .mockRejectedValueOnce(new Error("cleanup acknowledgement lost"));
      const usageError = new Error("usage settlement unavailable");
      const recordRemoteAiUsage = vi.fn(() => {
        if (failure === "usage_flush") {
          return Promise.reject(usageError);
        }
        return Promise.resolve({ status: "accepted" as const });
      });
      const env = {
        OPENMELD_CORE_WORKER: { recordRemoteAiUsage },
        AGENT_COMPUTER: {
          idFromName: (name: string) => name,
          get: () => ({
            requestComputerCleanup: deliverCleanup,
            readComputerInvocation: async () => state,
            registerComputerInvocation: async () => undefined,
          }),
        },
      };
      await requestComputerCleanup({ storage, context, env });
      await seedPendingUsage(storage, pendingUsageCount);
      const scheduleError = new Error("alarm storage unavailable");
      const schedule = vi.fn(() =>
        failure === "missing_reader"
          ? Promise.resolve(undefined)
          : Promise.reject(scheduleError)
      );
      if (!cloudflare.base) {
        throw new Error("The Cloudflare extension requires a base.");
      }
      const Alarm = cloudflare.base(class {} as never);
      const alarm = Object.assign(Object.create(Alarm.prototype), {
        ctx: { storage: { sql } },
        env,
        schedule,
        ...(failure === "missing_reader"
          ? {}
          : {
              __unsafe_readSubmission: async () => ({ status: "running" }),
            }),
      }) as { retryRemoteAgentCallbacks(): Promise<void> };
      vi.setSystemTime(TEST_NOW_MS + 5000);
      if (failure === "missing_reader") {
        await expect(
          alarm.retryRemoteAgentCallbacks()
        ).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalledWith(
          "[remote_agent.execution.reconciliation_failed]",
          expect.objectContaining({ errorName: "Error", submissionId })
        );
      } else {
        await expect(alarm.retryRemoteAgentCallbacks()).rejects.toBe(
          scheduleError
        );
        expect(schedule).toHaveBeenCalled();
      }
      expect(recordRemoteAiUsage).toHaveBeenCalledTimes(pendingUsageCount);
      expect(
        (await storage.list({ prefix: "openmeld:ai-usage:pending:" })).size
      ).toBe(failure === "usage_flush" ? 1 : 0);
      expect(deliverCleanup).toHaveBeenCalledTimes(2);
      expect(deliverCleanup).toHaveBeenLastCalledWith(submissionId, undefined);
      expect(await listComputerCleanupHandoffs(storage)).toMatchObject([
        { submissionId, attempts: 2, accepted: true, nextAttemptAtMs: null },
      ]);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        usageError.message
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        scheduleError.message
      );
    } finally {
      database.close();
      consoleError.mockRestore();
      vi.useRealTimers();
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
      expect.objectContaining({ retryAt: expect.any(Number) }),
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
      expect.objectContaining({ retryAt: expect.any(Number) }),
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
