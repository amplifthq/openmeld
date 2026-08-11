import { describe, expect, it, vi } from "vitest";
import {
  initializeRemoteAgentExecutionState,
  readRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import { cancelFlueRemoteAgentExecution } from "../flue-adapter/execution-cancellation";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("remote agent execution cancellation", () => {
  it("settles the execution when Flue no longer has an active submission", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    const abortSubmission = vi.fn(async () => ({ aborted: false }));
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    await expect(
      cancelFlueRemoteAgentExecution({
        abortSubmission,
        identity,
        nowMs: 200,
        reason: "Stopped by the user.",
        storage,
      })
    ).resolves.toMatchObject({
      abortedFlueSubmission: false,
      response: {
        execution: {
          completedAtMs: 200,
          lastProgressKind: "aborted",
          status: "aborted",
        },
        status: "already_cancelled",
      },
    });
    expect(abortSubmission).toHaveBeenCalledTimes(1);
  });

  it("finishes a previously requested cancellation on a retry", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    const abortSubmission = vi.fn(async () => ({ aborted: false }));
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
      cancelFlueRemoteAgentExecution({
        abortSubmission,
        identity,
        nowMs: 300,
        reason: "Stopped by the user.",
        storage,
      })
    ).resolves.toMatchObject({
      abortedFlueSubmission: false,
      response: {
        execution: {
          completedAtMs: 300,
          status: "aborted",
        },
        status: "already_cancelled",
      },
    });
  });

  it("preserves a retryable cancellation state when Flue abort fails", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    await expect(
      cancelFlueRemoteAgentExecution({
        abortSubmission: () =>
          Promise.reject(new Error("Flue abort unavailable")),
        identity,
        nowMs: 200,
        reason: "Stopped by the user.",
        storage,
      })
    ).rejects.toThrow("Flue abort unavailable");
    await expect(
      readRemoteAgentExecutionState({ identity, storage })
    ).resolves.toMatchObject({
      execution: { status: "cancellation_requested" },
      status: "found",
    });
  });
});

function createIdentity() {
  const request = createSubmitTurnRequest();
  return {
    idempotencyKey: request.idempotencyKey,
    organizationId: request.organizationId,
    spaceId: request.spaceId,
    submissionId: "submission_1",
    v: 1 as const,
  };
}
