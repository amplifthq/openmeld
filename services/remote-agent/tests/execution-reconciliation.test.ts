import { describe, expect, it, vi } from "vitest";
import {
  buildRemoteAgentCallbackContextKey,
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
  redeliverDueRemoteAgentCallbacks,
} from "../agent-core/callback-context";
import {
  buildRemoteAgentExecutionStateKey,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  readRemoteAgentCompletedExecutionAnswer,
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
      completedText: "The release plan is ready.",
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

  it("replaces a conflicting callback projection with the exact owner answer", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_conflicting_answer_projection";
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
      completedText: "The exact owner answer.",
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
      completedText: "A stale callback-only answer.",
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_exact_owner_answer",
      status: "accepted" as const,
    }));

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });
    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        submissionId,
        text: "The exact owner answer.",
      })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.toMatchObject({ completedText: "The exact owner answer." });
  });

  it("rejects a legacy callback-only answer when the completed owner has no answer", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_projection_only_answer";
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
    await storage.put(buildRemoteAgentExecutionStateKey(submissionId), {
      ...initial,
      completedAtMs: TEST_NOW_MS + 500,
      lastProgressAtMs: TEST_NOW_MS + 500,
      lastProgressKind: "prompt_completed",
      status: "completed",
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
      completedText: "Legacy callback text is not owner truth.",
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_projection_only_failure",
      status: "accepted" as const,
    }));

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });
    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", submissionId })
    );
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.not.objectContaining({ text: expect.any(String) })
    );
    await expect(
      storage.get(buildRemoteAgentExecutionStateKey(submissionId))
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.not.toHaveProperty("completedText");
  });

  it("turns a legacy completed execution without any durable answer into one visible failure", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_legacy_completed_without_answer";
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
    await storage.put(buildRemoteAgentExecutionStateKey(submissionId), {
      ...initial,
      completedAtMs: TEST_NOW_MS + 500,
      lastProgressAtMs: TEST_NOW_MS + 500,
      lastProgressKind: "prompt_completed",
      status: "completed",
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
      publishedSignalId: "signal_missing_answer_failure",
      status: "accepted" as const,
    }));

    const first = await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 1000,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });
    const second = await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 2000,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });

    expect(first).toMatchObject({
      execution: { lastProgressKind: "prompt_failed", status: "failed" },
      status: "found",
    });
    expect(second).toEqual(first);
    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", submissionId })
    );
  });

  it("resumes the failed owner projection after a crash between repair and callback", async () => {
    const storage = new CrashOnceOnListStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_legacy_repair_crashed_before_callback";
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
    await storage.put(buildRemoteAgentExecutionStateKey(submissionId), {
      ...initial,
      completedAtMs: TEST_NOW_MS + 500,
      lastProgressAtMs: TEST_NOW_MS + 500,
      lastProgressKind: "prompt_completed",
      status: "completed",
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
      publishedSignalId: "signal_recovered_after_repair_crash",
      status: "accepted" as const,
    }));
    const readSubmission = vi.fn(async () => ({ status: "settled" as const }));

    storage.crashOnNextList();
    await expect(
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        identity,
        nowMs: () => TEST_NOW_MS + 1000,
        readSubmission,
        storage,
      })
    ).rejects.toThrow("simulated restart before callback projection");
    await expect(
      storage.get(buildRemoteAgentExecutionStateKey(submissionId))
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.toMatchObject({ callbackStatus: "pending" });

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 2000,
      readSubmission,
      storage,
    });
    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 3000,
      readSubmission,
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", submissionId })
    );
  });

  it("resumes delivery after a crash between callback projection and Core", async () => {
    const storage = new CrashAfterFailureProjectionStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_crashed_after_failure_projection";
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
    storage.crashAfterNextFailureProjection(
      buildRemoteAgentCallbackContextKey(submissionId)
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_recovered_after_projection_crash",
      status: "accepted" as const,
    }));
    const readSubmission = async () => ({
      error: "Flue exhausted the submission.",
      status: "settled" as const,
    });

    await expect(
      reconcileRemoteAgentExecution({
        coreWorker: { completeRemoteAgentSubmission },
        identity,
        readSubmission,
        storage,
      })
    ).rejects.toThrow("simulated restart before Core callback");
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.toMatchObject({
      callbackStatus: "failed",
      terminalFailureFact: { code: "remote_agent.turn_not_completed" },
    });

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission,
      storage,
    });
    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission,
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", submissionId })
    );
  });

  it("obeys the completed owner when legacy repair loses its CAS", async () => {
    const storage = new TerminalCasRaceStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_legacy_repair_cas_loser";
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
    const legacyCompleted = {
      ...initial,
      completedAtMs: TEST_NOW_MS + 500,
      lastProgressAtMs: TEST_NOW_MS + 500,
      lastProgressKind: "prompt_completed" as const,
      status: "completed" as const,
    };
    await storage.put(
      buildRemoteAgentExecutionStateKey(submissionId),
      legacyCompleted
    );
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
    storage.winNextExecutionCas(
      buildRemoteAgentExecutionStateKey(submissionId),
      { ...legacyCompleted, completedText: "The repair CAS winner answer." }
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_repair_cas_winner",
      status: "accepted" as const,
    }));

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        submissionId,
        text: "The repair CAS winner answer.",
      })
    );
  });

  it("obeys the completed owner when failure reconciliation loses its CAS", async () => {
    const storage = new TerminalCasRaceStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_failure_reconciliation_cas_loser";
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
    storage.winNextExecutionCas(
      buildRemoteAgentExecutionStateKey(submissionId),
      {
        ...initial,
        completedAtMs: TEST_NOW_MS + 500,
        completedText: "The reconciliation CAS winner answer.",
        lastProgressAtMs: TEST_NOW_MS + 500,
        lastProgressKind: "prompt_completed",
        status: "completed",
      }
    );
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_reconciliation_cas_winner",
      status: "accepted" as const,
    }));

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 1000,
      readSubmission: async () => ({
        error: "The losing reconciler observed a failure.",
        status: "settled",
      }),
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        submissionId,
        text: "The reconciliation CAS winner answer.",
      })
    );
  });

  it("replaces a stale retryable success projection with the failed owner after restart", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_failed_owner_stale_retryable_success";
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
      status: "failed",
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
      callbackAttempts: 1,
      callbackNextAttemptAt: new Date(TEST_NOW_MS + 600).toISOString(),
      callbackStatus: "retryable",
      completedText: "This stale success must never publish.",
      lastFailureFact: {
        code: "remote_agent.core_callback_failed",
        detail: "The process stopped after the first callback attempt.",
        occurredAt: new Date(TEST_NOW_MS + 500).toISOString(),
        retryable: true,
      },
    });
    const completeRemoteAgentSubmission = vi.fn(async () => ({
      publishedSignalId: "signal_failed_owner_after_restart",
      status: "accepted" as const,
    }));

    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      nowMs: () => TEST_NOW_MS + 1000,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });
    await redeliverDueRemoteAgentCallbacks({
      coreWorker: { completeRemoteAgentSubmission },
      nowMs: () => TEST_NOW_MS + 2000,
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", submissionId })
    );
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.not.objectContaining({ text: expect.any(String) })
    );
    await expect(
      readRemoteAgentCallbackContext(storage, submissionId)
    ).resolves.not.toHaveProperty("completedText");
  });

  it("raises a recoverable named failure when a terminal owner has no callback projection", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const submissionId = "submission_terminal_owner_missing_projection";
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
      completedText: "The owner answer still exists.",
      identity,
      nowMs: TEST_NOW_MS + 500,
      status: "completed",
      storage,
    });

    await expect(
      reconcileRemoteAgentExecution({
        identity,
        readSubmission: async () => ({ status: "settled" }),
        storage,
      })
    ).rejects.toThrow(
      "remote_agent.terminal_callback_projection_missing:submission_terminal_owner_missing_projection"
    );
    await expect(
      readRemoteAgentCompletedExecutionAnswer({ identity, storage })
    ).resolves.toBe("The owner answer still exists.");

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
      publishedSignalId: "signal_rebuilt_terminal_projection",
      status: "accepted" as const,
    }));
    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });
    await reconcileRemoteAgentExecution({
      coreWorker: { completeRemoteAgentSubmission },
      identity,
      readSubmission: async () => ({ status: "settled" }),
      storage,
    });

    expect(completeRemoteAgentSubmission).toHaveBeenCalledOnce();
    expect(completeRemoteAgentSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        submissionId,
        text: "The owner answer still exists.",
      })
    );
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

class CrashOnceOnListStorage extends InMemoryDurableObjectStorage {
  private shouldCrashOnList = false;

  crashOnNextList(): void {
    this.shouldCrashOnList = true;
  }

  override list<T = unknown>(
    options?: DurableObjectListOptions
  ): Promise<Map<string, T>> {
    if (this.shouldCrashOnList) {
      this.shouldCrashOnList = false;
      return Promise.reject(
        new Error("simulated restart before callback projection")
      );
    }
    return super.list(options);
  }
}

class TerminalCasRaceStorage extends InMemoryDurableObjectStorage {
  private nextWinner: { key: string; value: unknown } | null = null;

  winNextExecutionCas(key: string, value: unknown): void {
    this.nextWinner = { key, value };
  }

  override async compareAndSet<T>(
    key: string,
    expectedValue: T,
    nextValue: T
  ): Promise<boolean> {
    if (this.nextWinner?.key === key) {
      const winner = this.nextWinner;
      this.nextWinner = null;
      await this.put(key, winner.value);
      return false;
    }
    return await super.compareAndSet(key, expectedValue, nextValue);
  }
}

class CrashAfterFailureProjectionStorage extends InMemoryDurableObjectStorage {
  private callbackKey: string | null = null;
  private shouldCrashOnGet = false;

  crashAfterNextFailureProjection(callbackKey: string): void {
    this.callbackKey = callbackKey;
  }

  override async compareAndSet<T>(
    key: string,
    expectedValue: T,
    nextValue: T
  ): Promise<boolean> {
    const updated = await super.compareAndSet(key, expectedValue, nextValue);
    if (
      updated &&
      key === this.callbackKey &&
      (nextValue as { callbackStatus?: string }).callbackStatus === "failed"
    ) {
      this.callbackKey = null;
      this.shouldCrashOnGet = true;
    }
    return updated;
  }

  override get<T = unknown>(key: string): Promise<T | undefined> {
    if (this.shouldCrashOnGet) {
      this.shouldCrashOnGet = false;
      return Promise.reject(
        new Error("simulated restart before Core callback")
      );
    }
    return super.get(key);
  }
}
