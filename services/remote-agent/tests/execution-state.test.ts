import { REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  recordRemoteAgentWorkLoopCheckpoint,
} from "../agent-core/callback-context";
import {
  assertRemoteAgentExecutionCanContinue,
  buildRemoteAgentExecutionStateKey,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  readRemoteAgentAdmissionStopIntent,
  readRemoteAgentCompletedExecutionAnswer,
  readRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
  resolveRemoteAgentTerminalExecutionOutcome,
} from "../agent-core/execution-state";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("remote agent execution state", () => {
  it("keeps a recovery fence identifiable but lets user Stop take priority", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      v: 1 as const,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      idempotencyKey: request.idempotencyKey,
      submissionId: "failed-summary",
    };
    await initializeRemoteAgentExecutionState({
      identity,
      storage,
      acceptedAtMs: 100,
    });
    await completeRemoteAgentExecutionState({
      identity,
      storage,
      nowMs: 200,
      status: "failed",
      terminalFailure: {
        code: "remote_agent.turn_not_completed",
        reasonCode: "remote_agent.turn_not_completed",
      },
    });
    const recovery = {
      identity,
      storage,
      nowMs: 300,
      summaryRecoveryId: "summary:original",
    };
    await requestRemoteAgentExecutionCancellation(recovery);
    expect(
      await readRemoteAgentAdmissionStopIntent({ identity, storage })
    ).toMatchObject({ summaryRecoveryId: "summary:original" });
    await Promise.all([
      requestRemoteAgentExecutionCancellation(recovery),
      requestRemoteAgentExecutionCancellation({
        identity,
        storage,
        nowMs: 400,
      }),
    ]);
    await requestRemoteAgentExecutionCancellation(recovery);
    expect(
      await readRemoteAgentAdmissionStopIntent({ identity, storage })
    ).not.toHaveProperty("summaryRecoveryId");
    await expect(
      assertRemoteAgentExecutionCanContinue({ identity, storage })
    ).rejects.toThrow("cancelled before this action could run");
  });
  it.each([
    "before_insert",
    "after_insert",
  ])("lets Stop fence an initializer paused $s", async (phase) => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: request.dispatchId,
      v: 1 as const,
    };
    let entered!: () => void;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const putIfAbsent = storage.putIfAbsent.bind(storage);
    storage.putIfAbsent = async (key, value) => {
      if (key !== buildRemoteAgentExecutionStateKey(identity.submissionId)) {
        return await putIfAbsent(key, value);
      }
      if (phase === "before_insert") {
        entered();
        await gate;
      }
      const inserted = await putIfAbsent(key, value);
      if (phase === "after_insert") {
        entered();
        await gate;
      }
      return inserted;
    };
    const initializing = initializeRemoteAgentExecutionState({
      identity,
      storage,
      acceptedAtMs: 100,
    });
    const rejected = expect(initializing).rejects.toThrow(
      "cancelled before this action could run"
    );
    await paused;
    try {
      await requestRemoteAgentExecutionCancellation({
        identity,
        storage,
        nowMs: 200,
      });
    } finally {
      release();
    }
    await rejected;
    await expect(
      readRemoteAgentExecutionState({ identity, storage })
    ).resolves.toMatchObject({
      status: "found",
      execution: { status: "cancellation_requested", completedAtMs: null },
    });
    await expect(
      assertRemoteAgentExecutionCanContinue({ identity, storage })
    ).rejects.toThrow("cancelled before this action could run");
  });
  it("keeps a pre-admission Stop across retries without inventing an accepted execution", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: request.dispatchId,
      v: 1 as const,
    };
    for (const nowMs of [100, 200]) {
      await expect(
        requestRemoteAgentExecutionCancellation({ identity, storage, nowMs })
      ).resolves.toEqual({ status: "not_found" });
    }
    await expect(
      readRemoteAgentExecutionState({ identity, storage })
    ).resolves.toEqual({ status: "not_found" });
    // The idempotency identity, not a reserved or legacy submission ID, owns Stop.
    for (const submissionId of [
      identity.submissionId,
      "late-legacy-submission",
    ]) {
      const lateIdentity = { ...identity, submissionId };
      await expect(
        initializeRemoteAgentExecutionState({
          identity: lateIdentity,
          storage,
          acceptedAtMs: 300,
        })
      ).rejects.toThrow("cancelled before this action could run");
      await expect(
        assertRemoteAgentExecutionCanContinue({
          identity: lateIdentity,
          storage,
        })
      ).rejects.toThrow("cancelled before this action could run");
    }
    await expect(
      initializeRemoteAgentExecutionState({
        identity: {
          ...identity,
          idempotencyKey: "different-task",
          submissionId: "different-task",
        },
        storage,
        acceptedAtMs: 300,
      })
    ).resolves.toMatchObject({ status: "pending" });
  });
  it.each([
    "completed",
    "failed",
    "aborted",
  ] as const)("recovers a legacy checkpoint without overriding authoritative %s", async (status) => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "legacy-checkpoint",
      v: 1 as const,
    };
    const context = createRemoteAgentCallbackContext({
      request,
      nowMs: 100,
      ack: {
        accepted: true,
        createdAt: 100,
        idempotencyKey: request.idempotencyKey,
        requestId: identity.submissionId,
        status: "pending",
        submissionId: identity.submissionId,
      },
    });
    await putRemoteAgentCallbackContext(storage, context);
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    await recordRemoteAgentWorkLoopCheckpoint({
      storage,
      submissionId: identity.submissionId,
      checkpoint: {
        v: 1,
        reason: "tool_call_budget_exhausted",
        toolCallLimit: 64,
      },
    });
    const execution = await completeRemoteAgentExecutionState({
      identity,
      nowMs: 200,
      storage,
      ...(status === "completed"
        ? { status, completedText: "I stopped before testing." }
        : { status }),
    });
    const expected = status === "completed" ? "checkpoint" : status;
    expect(
      await resolveRemoteAgentTerminalExecutionOutcome({
        execution,
        identity,
        nowMs: 300,
        storage,
      })
    ).toMatchObject({ status: expected, completedText: null });
    // Recovery must now use the owner's fact even if the callback projection
    // has to be reconstructed after a restart.
    await putRemoteAgentCallbackContext(storage, context);
    expect(
      await resolveRemoteAgentTerminalExecutionOutcome({
        execution,
        identity,
        nowMs: 400,
        storage,
      })
    ).toMatchObject({ status: expected, completedText: null });
  });
  it("keeps accepted execution alive from durable progress instead of a total deadline", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_1",
      v: 1 as const,
    };

    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    await markRemoteAgentExecutionProgress({
      identity,
      nowMs: 500,
      progressKind: "tool_started",
      storage,
    });

    await expect(
      readRemoteAgentExecutionState({ identity, storage })
    ).resolves.toMatchObject({
      status: "found",
      execution: {
        acceptedAtMs: 100,
        completedAtMs: null,
        lastProgressAtMs: 500,
        lastProgressKind: "tool_started",
        status: "running",
      },
    });
  });

  it("fences every later tool call after cancellation is requested", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_1",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    await expect(
      requestRemoteAgentExecutionCancellation({
        identity,
        nowMs: 200,
        reason: "Stopped by the user.",
        storage,
      })
    ).resolves.toMatchObject({ status: "cancellation_requested" });
    await markRemoteAgentExecutionProgress({
      identity,
      nowMs: 300,
      progressKind: "tool_completed",
      storage,
    });
    await expect(
      assertRemoteAgentExecutionCanContinue({ identity, storage })
    ).rejects.toThrow("cancelled before this action could run");
    await expect(
      readRemoteAgentExecutionState({ identity, storage })
    ).resolves.toMatchObject({
      execution: {
        lastProgressAtMs: 200,
        lastProgressKind: "cancellation_requested",
        status: "cancellation_requested",
      },
    });
  });

  it("lets cancellation win the durable race against prompt completion", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_1",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    await requestRemoteAgentExecutionCancellation({
      identity,
      nowMs: 200,
      reason: "Stopped by the user.",
      storage,
    });

    await expect(
      completeRemoteAgentExecutionState({
        completedText: "This answer lost the cancellation race.",
        identity,
        nowMs: 300,
        status: "completed",
        storage,
      })
    ).resolves.toMatchObject({
      completedAtMs: 300,
      lastProgressKind: "aborted",
      status: "aborted",
    });
  });

  it("atomically resolves simultaneous cancellation and prompt completion", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_1",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    const [cancellation, completion] = await Promise.all([
      requestRemoteAgentExecutionCancellation({
        identity,
        nowMs: 200,
        reason: "Stopped by the user.",
        storage,
      }),
      completeRemoteAgentExecutionState({
        completedText: "This answer raced with cancellation.",
        identity,
        nowMs: 200,
        status: "completed",
        storage,
      }),
    ]);
    const stored = await readRemoteAgentExecutionState({ identity, storage });

    expect(cancellation.status).toBe("cancellation_requested");
    expect(completion).toMatchObject({ status: "aborted" });
    expect(stored).toMatchObject({
      execution: {
        lastProgressKind: "aborted",
        status: "aborted",
      },
      status: "found",
    });
  });

  it.each([
    "completed",
    "failed",
  ] as const)("fences a settled %s identity without replacing its terminal history", async (status) => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "settled-request",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    await completeRemoteAgentExecutionState({
      identity,
      nowMs: 200,
      storage,
      ...(status === "completed"
        ? { status: "completed" as const, completedText: "Retained result." }
        : {
            status: "failed" as const,
            terminalFailure: {
              code: "remote_agent.turn_not_completed",
              reasonCode: "remote_agent.turn_not_completed",
            },
          }),
    });
    const history = await storage.get(
      buildRemoteAgentExecutionStateKey(identity.submissionId)
    );
    await expect(
      requestRemoteAgentExecutionCancellation({
        identity,
        nowMs: 300,
        reason: "Member requested a new attempt.",
        storage,
      })
    ).resolves.toMatchObject({
      status: "not_stoppable",
      execution: { status },
    });
    await expect(
      readRemoteAgentAdmissionStopIntent({ identity, storage })
    ).resolves.toMatchObject({
      idempotencyKey: identity.idempotencyKey,
      requestedAtMs: 300,
    });
    await expect(
      storage.get(buildRemoteAgentExecutionStateKey(identity.submissionId))
    ).resolves.toEqual(history);
    await expect(
      initializeRemoteAgentExecutionState({
        acceptedAtMs: 400,
        identity: { ...identity, submissionId: "late-copy" },
        storage,
      })
    ).rejects.toThrow("cancelled");
    await expect(
      initializeRemoteAgentExecutionState({
        acceptedAtMs: 400,
        identity: {
          ...identity,
          idempotencyKey: "fresh-attempt",
          submissionId: "fresh-attempt",
        },
        storage,
      })
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("stores completed state and its answer as one private durable invariant", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_1",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    await completeRemoteAgentExecutionState({
      completedText: "The durable answer.",
      identity,
      nowMs: 200,
      status: "completed",
      storage,
    });

    await expect(
      storage.get(buildRemoteAgentExecutionStateKey(identity.submissionId))
    ).resolves.toMatchObject({
      completedText: "The durable answer.",
      status: "completed",
    });
    await expect(
      readRemoteAgentExecutionState({ identity, storage })
    ).resolves.not.toHaveProperty("execution.completedText");
    await expect(
      readRemoteAgentCompletedExecutionAnswer({ identity, storage })
    ).resolves.toBe("The durable answer.");
    await expect(
      completeRemoteAgentExecutionState({
        completedText: "The durable answer.",
        identity,
        nowMs: 300,
        status: "completed",
        storage,
      })
    ).resolves.toMatchObject({
      completedAtMs: 200,
      status: "completed",
    });
  });

  it("stores failed state and its canonical outcome as one private durable invariant", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_failed",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    const execution = await completeRemoteAgentExecutionState({
      identity,
      nowMs: 200,
      status: "failed",
      storage,
      terminalFailure: {
        code: "remote_agent.provider.authentication_failed",
        detail: "The provider rejected the configured credential.",
        reasonCode:
          REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_AUTHENTICATION_FAILED,
      },
    });

    await expect(
      storage.get(buildRemoteAgentExecutionStateKey(identity.submissionId))
    ).resolves.toMatchObject({
      status: "failed",
      terminalFailure: {
        code: "remote_agent.provider.authentication_failed",
        detail: "The provider rejected the configured credential.",
        reasonCode:
          REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_AUTHENTICATION_FAILED,
      },
    });
    await expect(
      resolveRemoteAgentTerminalExecutionOutcome({
        execution,
        identity,
        nowMs: 300,
        storage,
      })
    ).resolves.toMatchObject({
      failure: {
        code: "remote_agent.provider.authentication_failed",
        detail: "The provider rejected the configured credential.",
        reasonCode:
          REMOTE_AGENT_RUNTIME_EVIDENCE_REASON_CODES.PROVIDER_AUTHENTICATION_FAILED,
      },
      status: "failed",
    });
  });

  it("returns the authoritative completed winner after losing a success CAS", async () => {
    const storage = new CompletedCasRaceStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_success_race",
      v: 1 as const,
    };
    const initial = await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    storage.winNextExecutionCas(
      buildRemoteAgentExecutionStateKey(identity.submissionId),
      {
        ...initial,
        completedAtMs: 200,
        completedText: "The authoritative winner answer.",
        lastProgressAtMs: 200,
        lastProgressKind: "prompt_completed",
        status: "completed",
      }
    );

    await expect(
      completeRemoteAgentExecutionState({
        completedText: "The losing observation answer.",
        identity,
        nowMs: 200,
        status: "completed",
        storage,
      })
    ).resolves.toMatchObject({
      completedAtMs: 200,
      status: "completed",
    });
    await expect(
      readRemoteAgentCompletedExecutionAnswer({ identity, storage })
    ).resolves.toBe("The authoritative winner answer.");
  });

  it("fails closed when a query reuses a submission id with different authority", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const request = createSubmitTurnRequest();
    const identity = {
      idempotencyKey: request.idempotencyKey,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      submissionId: "submission_1",
      v: 1 as const,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    await expect(
      readRemoteAgentExecutionState({
        identity: { ...identity, organizationId: "org_wrong" },
        storage,
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.execution_identity_mismatch",
      status: "identity_mismatch",
    });
  });
});

class CompletedCasRaceStorage extends InMemoryDurableObjectStorage {
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
