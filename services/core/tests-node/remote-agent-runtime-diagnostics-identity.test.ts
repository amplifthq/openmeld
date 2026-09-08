import { describe, expect, it } from "vitest";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "../src/remote-agent/application/remote-agent-conversation-continuity";

const baseRequest = {
  agentProfileId: "agent_a",
  dispatchId: "dispatch_1",
  idempotencyKey: "turn_1",
  organizationId: "org_1",
  spaceId: "space_123",
};

const deliveryIdentity = {
  dispatchId: baseRequest.dispatchId,
  idempotencyKey: baseRequest.idempotencyKey,
  organizationId: baseRequest.organizationId,
  profileId: baseRequest.agentProfileId,
  spaceId: baseRequest.spaceId,
};

describe("Remote Agent runtime diagnostics identity", () => {
  it("resolves the frozen version-4 runtime conversation instead of the logical Space", () => {
    expect(
      resolveRemoteAgentNativeDeliveryRuntimeConversationId({
        ...deliveryIdentity,
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
        ...deliveryIdentity,
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

  it.each([
    ["agentProfileId", "agent_b"],
    ["organizationId", "org_2"],
    ["spaceId", "space_other"],
    ["dispatchId", "dispatch_other"],
    ["idempotencyKey", "turn_other"],
  ])("rejects a foreign %s even when the runtime route matches", (key, value) => {
    for (const source of [
      "workerSubmitRequest",
      "executionRecoverySubmitRequest",
    ] as const) {
      expect(() =>
        resolveRemoteAgentNativeDeliveryRuntimeConversationId({
          ...deliveryIdentity,
          workerSubmitRequest: null,
          executionRecoverySubmitRequest: null,
          [source]: { ...baseRequest, v: 2, [key]: value },
        } as never)
      ).toThrow("remote_agent.native_delivery_identity_mismatch");
    }
  });

  it.each([1, 2, 3])("preserves version %i persisted routes", (v) => {
    for (const conversationId of [undefined, "center-agent-task:task_1"]) {
      expect(
        resolveRemoteAgentNativeDeliveryRuntimeConversationId({
          ...deliveryIdentity,
          executionRecoverySubmitRequest: {
            ...baseRequest,
            conversationId,
            v,
          } as never,
          workerSubmitRequest: null,
        })
      ).toBe(conversationId ?? baseRequest.spaceId);
    }
  });

  it("does not invent a runtime route when neither persisted request exists", () => {
    expect(
      resolveRemoteAgentNativeDeliveryRuntimeConversationId({
        ...deliveryIdentity,
        executionRecoverySubmitRequest: null,
        workerSubmitRequest: null,
      })
    ).toBeUndefined();
  });
});
