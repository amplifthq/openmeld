import { describe, expect, it, vi } from "vitest";
import {
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  readRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import { cancelFlueRemoteAgentExecution } from "../flue-adapter/execution-cancellation";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("remote agent execution cancellation", () => {
  it("persists intent and arms reconciliation before a failing external abort", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    const scheduleReconciliation = vi.fn(async () => {
      expect(
        await readRemoteAgentExecutionState({ identity, storage })
      ).toMatchObject({
        execution: { status: "cancellation_requested", completedAtMs: null },
      });
    });
    const abortSubmission = vi.fn(() => {
      expect(scheduleReconciliation).toHaveBeenCalledOnce();
      return Promise.reject(new Error("Computer cleanup unavailable"));
    });
    await expect(
      cancelFlueRemoteAgentExecution({
        identity,
        storage,
        nowMs: 200,
        scheduleReconciliation,
        abortSubmission,
      })
    ).rejects.toThrow("Computer cleanup unavailable");
    expect(scheduleReconciliation).toHaveBeenCalledOnce();
    expect(
      await readRemoteAgentExecutionState({ identity, storage })
    ).toMatchObject({
      execution: { status: "cancellation_requested", completedAtMs: null },
    });
  });

  it("does not start external abort without recovery scheduling and retains intent for retry", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    const abortSubmission = vi.fn(async () => ({ aborted: true }));
    const scheduleReconciliation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Alarm write failed"))
      .mockResolvedValue(undefined);
    await expect(
      cancelFlueRemoteAgentExecution({
        identity,
        storage,
        nowMs: 200,
        scheduleReconciliation,
        abortSubmission,
      })
    ).rejects.toThrow("Alarm write failed");
    expect(abortSubmission).not.toHaveBeenCalled();
    await expect(
      cancelFlueRemoteAgentExecution({
        identity,
        storage,
        nowMs: 300,
        scheduleReconciliation,
        abortSubmission,
      })
    ).resolves.toMatchObject({
      response: { status: "cancellation_requested" },
    });
    expect(abortSubmission).toHaveBeenCalledOnce();
  });

  it.each([
    false,
    true,
  ])("keeps cancellation pending when Flue acknowledges abort intent with aborted=%s", async (aborted) => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    const abortSubmission = vi.fn(async () => ({ aborted }));
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });

    await expect(
      cancelFlueRemoteAgentExecution({
        scheduleReconciliation: vi.fn(async () => undefined),
        abortSubmission,
        identity,
        nowMs: 200,
        reason: "Stopped by the user.",
        storage,
      })
    ).resolves.toMatchObject({
      abortedFlueSubmission: aborted,
      response: {
        execution: {
          completedAtMs: null,
          status: "cancellation_requested",
        },
        status: "cancellation_requested",
      },
    });
    expect(abortSubmission).toHaveBeenCalledTimes(1);
  });

  it("does not treat a repeated cancellation request as execution settlement", async () => {
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
        scheduleReconciliation: vi.fn(async () => undefined),
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
          completedAtMs: null,
          status: "cancellation_requested",
        },
        status: "cancellation_requested",
      },
    });
  });

  it("reports stopped only after the execution owner settles and does not resend abort", async () => {
    const storage = new InMemoryDurableObjectStorage();
    const identity = createIdentity();
    const abortSubmission = vi.fn(async () => ({ aborted: true }));
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    await cancelFlueRemoteAgentExecution({
      scheduleReconciliation: vi.fn(async () => undefined),
      abortSubmission,
      identity,
      nowMs: 200,
      storage,
    });
    await completeRemoteAgentExecutionState({
      identity,
      nowMs: 300,
      status: "aborted",
      storage,
    });
    await expect(
      cancelFlueRemoteAgentExecution({
        scheduleReconciliation: vi.fn(async () => undefined),
        abortSubmission,
        identity,
        nowMs: 400,
        storage,
      })
    ).resolves.toMatchObject({
      abortedFlueSubmission: null,
      response: {
        status: "already_cancelled",
        execution: { status: "aborted", completedAtMs: 300 },
      },
    });
    expect(abortSubmission).toHaveBeenCalledOnce();
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
        scheduleReconciliation: vi.fn(async () => undefined),
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
