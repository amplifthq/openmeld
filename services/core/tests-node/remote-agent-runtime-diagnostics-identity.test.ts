import { describe, expect, it } from "vitest";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "../src/remote-agent/application/remote-agent-conversation-continuity";

const baseRequest = {
  spaceId: "space_123",
};

describe("Remote Agent runtime diagnostics identity", () => {
  it("resolves the frozen version-4 runtime conversation instead of the logical Space", () => {
    expect(
      resolveRemoteAgentNativeDeliveryRuntimeConversationId({
        executionRecoverySubmitRequest: {
          ...baseRequest,
          runtimeConversation: {
            generation: 2,
            id: "runtime_conversation_2",
          },
          v: 4,
        } as never,
        workerSubmitRequest: {
          ...baseRequest,
          runtimeConversation: {
            generation: 2,
            id: "runtime_conversation_2",
          },
          v: 4,
        } as never,
      })
    ).toBe("runtime_conversation_2");
  });

  it("fails closed when the persisted worker and recovery routes disagree", () => {
    expect(() =>
      resolveRemoteAgentNativeDeliveryRuntimeConversationId({
        executionRecoverySubmitRequest: {
          ...baseRequest,
          runtimeConversation: {
            generation: 1,
            id: "runtime_conversation_1",
          },
          v: 4,
        } as never,
        workerSubmitRequest: {
          ...baseRequest,
          runtimeConversation: {
            generation: 2,
            id: "runtime_conversation_2",
          },
          v: 4,
        } as never,
      })
    ).toThrow("remote_agent.runtime_conversation_identity_mismatch");
  });
});
