import { describe, expect, it } from "vitest";
import { buildAgentControllerConversationRefFromAgentControllerConversation } from "../src/local-service/dispatch/execute-dispatch-conversation";

describe("execute dispatch conversation helpers", () => {
  it("preserves builtin OpenCode continuation as a session conversation", () => {
    expect(
      buildAgentControllerConversationRefFromAgentControllerConversation({
        agentControllerConversationId: "ses_opencode_1",
        agentControllerRef: "builtin:opencode",
      })
    ).toEqual({
      agentControllerRef: "builtin:opencode",
      agentControllerConversationKind: "session",
      agentControllerConversationId: "ses_opencode_1",
    });
  });

  it("uses the builtin conversation kind for known controller refs", () => {
    expect(
      buildAgentControllerConversationRefFromAgentControllerConversation({
        agentControllerConversationId: "thread_codex_1",
        agentControllerRef: "builtin:codex",
      })
    ).toEqual({
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
      agentControllerConversationId: "thread_codex_1",
    });
  });

  it("keeps unknown controller refs in generic context conversations", () => {
    expect(
      buildAgentControllerConversationRefFromAgentControllerConversation({
        agentControllerConversationId: "ctx_custom_1",
        agentControllerRef: "custom:ops-bot",
      })
    ).toEqual({
      agentControllerRef: "custom:ops-bot",
      agentControllerConversationKind: "context",
      agentControllerConversationId: "ctx_custom_1",
    });
  });
});
