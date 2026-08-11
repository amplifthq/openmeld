import { describe, expect, it } from "vitest";
import {
  assertRemoteAgentExecutionCanContinue,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  readRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../agent-core/execution-state";
import { createSubmitTurnRequest } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

describe("remote agent execution state", () => {
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
