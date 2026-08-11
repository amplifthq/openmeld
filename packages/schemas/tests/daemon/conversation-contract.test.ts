import { describe, expect, it } from "vitest";
import {
  agentControllerConversationRefSchema,
  buildAgentControllerConversationRef,
  builtinAgentControllerAllowsDistinctConversationId,
  conversationPolicySchema,
  resolveBuiltinAgentControllerConversationKind,
} from "../../src/index";

describe("daemon conversation contract schema", () => {
  it("accepts a minimal agent controller conversation ref", () => {
    const result = agentControllerConversationRefSchema.safeParse({
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
      agentControllerConversationId: "thread-1",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an agent controller conversation ref when agentControllerConversationId is missing", () => {
    const result = agentControllerConversationRefSchema.safeParse({
      agentControllerRef: "builtin:codex",
      agentControllerConversationKind: "thread",
      agentControllerConversationId: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejects the removed provider/refKind/conversationRefId shape", () => {
    const result = agentControllerConversationRefSchema.safeParse({
      providerId: "codex",
      refKind: "thread",
      conversationRefId: "legacy-thread-1",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a minimal conversation policy", () => {
    const result = conversationPolicySchema.safeParse({
      collaborationMode: "plan",
      fallbackModel: "gpt-5.5",
      model: "gpt-5.4",
      reasoningLevel: "medium",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unsupported collaboration mode", () => {
    const result = conversationPolicySchema.safeParse({
      collaborationMode: "ask",
    });

    expect(result.success).toBe(false);
  });

  it("resolves builtin conversation kind by agent controller", () => {
    expect(resolveBuiltinAgentControllerConversationKind("codex")).toBe(
      "thread"
    );
    expect(resolveBuiltinAgentControllerConversationKind("builtin:codex")).toBe(
      "thread"
    );
    expect(resolveBuiltinAgentControllerConversationKind("claude-code")).toBe(
      "session"
    );
    expect(resolveBuiltinAgentControllerConversationKind("openclaw")).toBe(
      "session"
    );
    expect(resolveBuiltinAgentControllerConversationKind("opencode")).toBe(
      "session"
    );
    expect(
      resolveBuiltinAgentControllerConversationKind("builtin:opencode")
    ).toBe("session");
    expect(resolveBuiltinAgentControllerConversationKind("custom:codex")).toBe(
      null
    );
  });

  it("allows distinct agentControllerConversationId only for controllers that split runtime context from conversation identity", () => {
    expect(builtinAgentControllerAllowsDistinctConversationId("openclaw")).toBe(
      true
    );
    expect(builtinAgentControllerAllowsDistinctConversationId("codex")).toBe(
      false
    );
    expect(
      builtinAgentControllerAllowsDistinctConversationId("claude-code")
    ).toBe(false);
    expect(
      builtinAgentControllerAllowsDistinctConversationId("unknown-provider")
    ).toBe(false);
  });

  it("builds a normalized agent controller conversation ref", () => {
    expect(
      buildAgentControllerConversationRef({
        agentControllerRef: "builtin:openclaw",
        agentControllerConversationKind: "session",
        agentControllerConversationId: "session-1",
      })
    ).toEqual({
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationKind: "session",
      agentControllerConversationId: "session-1",
    });
  });
});
