import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import {
  reconcileRemoteAgentExecution,
  reconcileSettledRemoteAgentExecutionFailures,
} from "../flue-adapter/execution-reconciliation";
import { createRemoteAgentStreamPublisher } from "../flue-adapter/streaming";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("remote agent execution reconciliation", () => {
  it("turns a settled pre-model failure into a Core callback without waiting for Core polling", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const failedSubmissionId = "submission_sandbox_materialization_failed";
    const successfulSubmissionId = "submission_success_callback_in_flight";
    for (const submissionId of [failedSubmissionId, successfulSubmissionId]) {
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
      await putRemoteAgentCallbackContext(
        storage,
        createRemoteAgentCallbackContext({
          ack: {
            accepted: true,
            createdAt: TEST_NOW_MS,
            idempotencyKey: request.idempotencyKey,
            status: "pending",
            submissionId,
          },
          nowMs: TEST_NOW_MS,
          request,
        })
      );
    }
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_materialization_failure",
      status: "accepted" as const,
    }));
    const readSubmission = vi.fn(async (submissionId: string) =>
      submissionId === failedSubmissionId
        ? {
            error:
              "Connection closed: this Durable Object instance is no longer active.",
            status: "settled" as const,
          }
        : { status: "settled" as const }
    );

    await expect(
      reconcileSettledRemoteAgentExecutionFailures({
        coreWorker: { completeRemoteAgentSubmission },
        nowMs: () => TEST_NOW_MS + 5000,
        readSubmission,
        storage,
      })
    ).resolves.toEqual({ reconciled: 1 });
    await expect(
      reconcileSettledRemoteAgentExecutionFailures({
        coreWorker: { completeRemoteAgentSubmission },
        nowMs: () => TEST_NOW_MS + 10_000,
        readSubmission,
        storage,
      })
    ).resolves.toEqual({ reconciled: 0 });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        status: "failed",
        submissionId: failedSubmissionId,
      })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, failedSubmissionId)
    ).resolves.toMatchObject({
      callbackAttempts: 1,
      callbackStatus: "failed",
      terminalFailureFact: {
        code: "remote_agent.turn_not_completed",
      },
    });
    await expect(
      readRemoteAgentCallbackContext(storage, successfulSubmissionId)
    ).resolves.toMatchObject({
      callbackAttempts: 0,
      callbackStatus: "pending",
    });
  });

  it("publishes one visible failure after Flue exhausts an interrupted submission", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_oom_exhausted";
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId,
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity,
      storage,
    });
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          requestId: submissionId,
          status: "pending",
          submissionId,
        },
        nowMs: TEST_NOW_MS,
        request,
      })
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_visible_failure",
      status: "accepted" as const,
    }));
    const readSubmission = vi.fn(async () => ({
      error: "Agent submission exhausted its retry budget after 5 attempts.",
      status: "settled" as const,
    }));

    const first = await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 1000,
      readSubmission,
      storage,
    });
    const second = await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 2000,
      readSubmission,
      storage,
    });

    expect(first).toMatchObject({
      execution: {
        completedAtMs: TEST_NOW_MS + 1000,
        lastProgressKind: "prompt_failed",
        status: "failed",
      },
      status: "found",
    });
    expect(second).toEqual(first);
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "remote_agent.turn_not_completed",
        failureMessage:
          "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team.",
        status: "failed",
        submissionId,
      })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.toMatchObject({
      callbackAttempts: 1,
      callbackStatus: "failed",
      lastCoreResponse: {
        publishedSignalId: "signal_visible_failure",
        status: "accepted",
      },
      terminalFailureFact: {
        code: "remote_agent.turn_not_completed",
        detail: "Agent submission exhausted its retry budget after 5 attempts.",
      },
    });
  });

  it("does not change an active execution or invoke Core", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_active",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity,
      storage,
    });
    await markRemoteAgentExecutionProgress({
      identity,
      nowMs: TEST_NOW_MS + 500,
      progressKind: "tool_started",
      storage,
    });
    const completeRemoteAgentSubmission = vi.fn();

    await expect(
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        identity,
        nowMs: () => TEST_NOW_MS + 1000,
        readSubmission: async () => ({ status: "running" }),
        storage,
      })
    ).resolves.toMatchObject({
      execution: {
        lastProgressAtMs: TEST_NOW_MS + 500,
        lastProgressKind: "tool_started",
        status: "running",
      },
      status: "found",
    });
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
  });

  it("does not invent a failure for a successfully settled submission whose observer is still finishing", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_success_observer_in_flight",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity,
      storage,
    });
    await markRemoteAgentExecutionProgress({
      identity,
      nowMs: TEST_NOW_MS + 500,
      progressKind: "text_delta",
      storage,
    });
    const completeRemoteAgentSubmission = vi.fn();

    await expect(
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        identity,
        nowMs: () => TEST_NOW_MS + 1000,
        readSubmission: async () => ({ status: "settled" }),
        storage,
      })
    ).resolves.toMatchObject({
      execution: {
        lastProgressAtMs: TEST_NOW_MS + 500,
        lastProgressKind: "text_delta",
        status: "running",
      },
      status: "found",
    });
    expect(completeRemoteAgentSubmission).not.toHaveBeenCalled();
  });

  it("replays a durable completed answer once when the final callback was lost", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_settled_after_answer";
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId,
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity,
      storage,
    });
    await completeRemoteAgentExecutionState({
      identity,
      nowMs: TEST_NOW_MS + 500,
      status: "completed",
      storage,
    });
    await putRemoteAgentCallbackContext(storage, {
      ...createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: request.idempotencyKey,
          requestId: submissionId,
          status: "pending",
          submissionId,
        },
        nowMs: TEST_NOW_MS,
        request,
      }),
      callbackStatus: "pending",
      completedText: "The release plan is ready.",
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_recovered_reply",
      status: "accepted" as const,
    }));
    const readSubmission = vi.fn(async () => ({
      status: "settled" as const,
    }));

    const first = await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 1000,
      readSubmission,
      storage,
    });
    const second = await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 2000,
      readSubmission,
      storage,
    });

    expect(first).toMatchObject({
      execution: { completedAtMs: TEST_NOW_MS + 500, status: "completed" },
      status: "found",
    });
    expect(second).toEqual(first);
    expect(readSubmission).not.toHaveBeenCalled();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        submissionId,
        text: "The release plan is ready.",
      })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.toMatchObject({
      callbackStatus: "completed",
      completedText: "The release plan is ready.",
    });
  });

  it("does not turn partial stream text from a failed runtime into a successful answer", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_settled_with_stream_text";
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId,
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity,
      storage,
    });
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: submissionId,
        status: "pending",
        submissionId,
      },
      nowMs: TEST_NOW_MS,
      request,
    });
    await putRemoteAgentCallbackContext(storage, context);
    await createRemoteAgentStreamPublisher().push({
      context,
      coreWorker: {
        submitRemoteAgentStreamDelta: async (body) => ({
          lastSequence: body.sequence,
          status: "accepted",
        }),
      },
      observedAtMs: TEST_NOW_MS + 400,
      storage,
      delta: "Partial draft before the provider failed. ".repeat(8),
      kind: "text",
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_stream_failure",
      status: "accepted" as const,
    }));

    await expect(
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        identity,
        nowMs: () => TEST_NOW_MS + 1000,
        readSubmission: async () => ({
          error: "Stream settled before the final callback.",
          status: "settled" as const,
        }),
        storage,
      })
    ).resolves.toMatchObject({
      execution: { status: "failed" },
      status: "found",
    });
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        submissionId,
      })
    );
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.not.objectContaining({ text: expect.any(String) })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.toMatchObject({
      callbackStatus: "failed",
      terminalFailureFact: { code: "remote_agent.turn_not_completed" },
    });
  });

  it("does not revive a cancelled execution even when an answer was preserved", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_cancelled_after_answer";
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId,
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: TEST_NOW_MS,
      identity,
      storage,
    });
    const context = createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: request.idempotencyKey,
        requestId: submissionId,
        status: "pending",
        submissionId,
      },
      nowMs: TEST_NOW_MS,
      request,
    });
    await putRemoteAgentCallbackContext(storage, context);
    await createRemoteAgentStreamPublisher().push({
      context,
      coreWorker: {
        submitRemoteAgentStreamDelta: async (body) => ({
          lastSequence: body.sequence,
          status: "accepted",
        }),
      },
      observedAtMs: TEST_NOW_MS + 400,
      storage,
      delta: "Text observed before cancellation. ".repeat(8),
      kind: "text",
    });
    await requestRemoteAgentExecutionCancellation({
      identity,
      nowMs: TEST_NOW_MS + 600,
      reason: "member stopped the wake",
      storage,
    });
    await completeRemoteAgentExecutionState({
      identity,
      nowMs: TEST_NOW_MS + 700,
      status: "aborted",
      storage,
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_aborted",
      status: "accepted" as const,
    }));

    await expect(
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        identity,
        nowMs: () => TEST_NOW_MS + 1000,
        readSubmission: async () => ({
          error: "Cancelled by member.",
          status: "settled" as const,
        }),
        storage,
      })
    ).resolves.toMatchObject({
      execution: { status: "aborted" },
      status: "found",
    });
    const deliveredBodies = (
      completeRemoteAgentSubmission.mock.calls as unknown as [
        { status?: string },
      ][]
    ).map(([body]) => body);
    expect(deliveredBodies.length).toBeGreaterThan(0);
    expect(deliveredBodies.some((body) => body.status === "completed")).toBe(
      false
    );
    const recoveredContext = await readRemoteAgentCallbackContext(
      storage,
      submissionId
    );
    expect(recoveredContext?.completedText ?? undefined).toBeUndefined();
    expect(recoveredContext?.terminalFailureFact).toMatchObject({
      code: "remote_agent.execution_cancelled",
    });
  });
});
