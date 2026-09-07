import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { settleAgentReplyProposals } from "../src/local-service/dispatch/dispatch-agent-reply-settlement";

const reply = (cursor: string): OpenMeldDaemonTaskResultPayload => ({
  agentId: "agt_11111111-1111-4111-8111-111111111111",
  attemptId: "attempt-1",
  deduped: false,
  sourceEventId: "source-1",
  status: "success",
  output: "Done",
  taskId: "task-1",
  spaceAction: {
    type: "post_message",
    messageEnvelope: {
      text: "Done",
      activationTargets: [],
      referenceTargets: [],
    },
    observedThroughSignalId: cursor,
  },
});

describe("Agent reply settlement", () => {
  it("does not resubmit a rejected reply when context cannot advance", async () => {
    const submit = vi.fn(() => ({
      resultSummary: { result: "success" as const },
      settlement: Promise.resolve({
        status: "review_required" as const,
        reasonCode: "space.agent_reply.context_changed" as const,
      }),
    }));
    await expect(
      settleAgentReplyProposals({
        initialResultPayload: reply("source-1"),
        reconsider: async () => reply("source-1"),
        submit,
      })
    ).rejects.toMatchObject({
      code: "dispatch.agent_reply_observation.no_progress",
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("settles the reviewed reply after newly readable context advances", async () => {
    const submit = vi.fn((payload: OpenMeldDaemonTaskResultPayload) => ({
      resultSummary: { result: "success" as const },
      settlement: Promise.resolve(
        payload.spaceAction?.type === "post_message" &&
          payload.spaceAction.observedThroughSignalId === "recovered-reply"
          ? { status: "accepted" as const }
          : {
              status: "review_required" as const,
              reasonCode: "space.agent_reply.context_changed" as const,
            }
      ),
    }));
    const result = await settleAgentReplyProposals({
      initialResultPayload: reply("source-1"),
      reconsider: async () => reply("recovered-reply"),
      submit,
    });
    expect(result.resultSummary?.result).toBe("success");
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("preserves an observation failure without retrying the same proposal", async () => {
    const submit = vi.fn(() => ({
      resultSummary: {},
      settlement: Promise.resolve({
        status: "review_required" as const,
        reasonCode: "space.agent_reply.context_changed" as const,
      }),
    }));
    const failure = new Error("Space history is unreadable");
    await expect(
      settleAgentReplyProposals({
        initialResultPayload: reply("source-1"),
        reconsider: () => Promise.reject(failure),
        submit,
      })
    ).rejects.toBe(failure);
    expect(submit).toHaveBeenCalledOnce();
  });
});
