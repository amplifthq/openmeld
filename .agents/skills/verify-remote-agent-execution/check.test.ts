import { describe, expect, it } from "vitest";
import {
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  markRemoteAgentExecutionProgress,
  RemoteAgentExecutionCancelledError,
  requestRemoteAgentExecutionCancellation,
  resolveRemoteAgentTerminalExecutionOutcome,
} from "../../../services/remote-agent/agent-core/execution-state.ts";
import { InMemoryDurableObjectStorage } from "../../../services/remote-agent/tests/storage.ts";

const identity = {
  v: 1 as const,
  organizationId: "org_1",
  spaceId: "spc_1",
  submissionId: "sub_1",
  idempotencyKey: "idem_1",
};

const storageFor = () => new InMemoryDurableObjectStorage();

describe("remote agent execution", () => {
  it("does not start after a stop that arrived first", async () => {
    const storage = storageFor();
    await requestRemoteAgentExecutionCancellation({
      identity,
      nowMs: 1,
      storage,
    });
    await expect(
      initializeRemoteAgentExecutionState({
        acceptedAtMs: 2,
        identity,
        storage,
      })
    ).rejects.toBeInstanceOf(RemoteAgentExecutionCancelledError);
  });

  it("settles a stop as stopped even when completion asks to store a reply", async () => {
    const storage = storageFor();
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 10,
      identity,
      storage,
    });
    await markRemoteAgentExecutionProgress({
      identity,
      nowMs: 20,
      progressKind: "agent_started",
      storage,
    });
    await requestRemoteAgentExecutionCancellation({
      identity,
      nowMs: 30,
      reason: "Stopped by the user.",
      storage,
    });
    const progressed = await markRemoteAgentExecutionProgress({
      identity,
      nowMs: 40,
      progressKind: "text_delta",
      storage,
    });
    expect(progressed?.status).toBe("cancellation_requested");
    const settled = await completeRemoteAgentExecutionState({
      completedText: "The reply that must not win.",
      identity,
      nowMs: 50,
      status: "completed",
      storage,
    });
    expect(settled?.status).toBe("aborted");
    await expect(
      resolveRemoteAgentTerminalExecutionOutcome({
        identity,
        execution: settled,
        nowMs: 51,
        storage,
      })
    ).resolves.toMatchObject({
      status: "aborted",
      execution: { status: "aborted" },
      completedText: null,
    });
  });

  it("keeps a stored reply when stop arrives after it", async () => {
    const storage = storageFor();
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 10,
      identity,
      storage,
    });
    await completeRemoteAgentExecutionState({
      completedText: "Done",
      identity,
      nowMs: 20,
      status: "completed",
      storage,
    });
    const response = await requestRemoteAgentExecutionCancellation({
      identity,
      nowMs: 30,
      storage,
    });
    expect(response.status).toBe("not_stoppable");
    expect(response.execution?.status).toBe("completed");
  });
});
