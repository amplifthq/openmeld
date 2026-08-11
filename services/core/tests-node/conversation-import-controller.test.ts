import { describe, expect, it } from "vitest";
import { resolveConversationImportAgentControllerRef } from "../src/space/application/conversation-import-controller";

describe("conversation import controller resolution", () => {
  it("uses primary Agent Profile Binding truth when actor context has no legacy agentControllerRef", () => {
    expect(
      resolveConversationImportAgentControllerRef({
        legacyActorAgentControllerRef: null,
        primaryBindingAgentControllerRef: "builtin:codex",
      })
    ).toEqual({
      agentControllerRef: "builtin:codex",
      source: "binding_truth",
      status: "resolved",
    });
  });

  it("prefers primary Agent Profile Binding truth over a stale actor agentControllerRef", () => {
    expect(
      resolveConversationImportAgentControllerRef({
        legacyActorAgentControllerRef: "builtin:codex",
        primaryBindingAgentControllerRef: "builtin:claude-code",
      })
    ).toEqual({
      agentControllerRef: "builtin:claude-code",
      source: "binding_truth",
      status: "resolved",
    });
  });

  it("keeps legacy actor agentControllerRef support only when Binding truth is absent", () => {
    expect(
      resolveConversationImportAgentControllerRef({
        legacyActorAgentControllerRef: " codex ",
        primaryBindingAgentControllerRef: null,
      })
    ).toEqual({
      agentControllerRef: "codex",
      source: "actor_context",
      status: "resolved",
    });
  });

  it("fails closed when no controller source exists", () => {
    expect(
      resolveConversationImportAgentControllerRef({
        legacyActorAgentControllerRef: " ",
        primaryBindingAgentControllerRef: null,
      })
    ).toEqual({
      reasonCode: "space.conversation_binding.controller_missing",
      status: "missing",
    });
  });
});
