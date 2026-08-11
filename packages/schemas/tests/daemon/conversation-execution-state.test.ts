import { describe, expect, it } from "vitest";
import {
  bootstrapTemplateFactsSchema,
  conversationExecutionStateSchema,
} from "../../src/index";

describe("daemon conversation execution state schema", () => {
  it("accepts minimal bootstrap template facts", () => {
    const result = bootstrapTemplateFactsSchema.safeParse({
      templateVersion: "compact-dispatch-bootstrap-v1",
      contentFingerprint: "sha256:abc",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a conversation execution state", () => {
    const result = conversationExecutionStateSchema.safeParse({
      agentContextLookupKey: "space-1|agt-1|builtin:codex|local-cli",
      activeContextId: "thread-1",
      lastResolvedAgentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
        agentControllerConversationId: "thread-1",
      },
      lastRuntimeWorkspacePath: "/tmp/repo-a",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      bootstrapLastAppliedAt: "2026-03-09T12:00:00.000Z",
      bootstrapLastActivatedAt: "2026-03-09T12:05:00.000Z",
      dispatchesSinceBootstrapApplied: 3,
      lastAppliedTemplateVersion: "compact-dispatch-bootstrap-v1",
      lastAppliedContentFingerprint: "sha256:abc",
      updatedAt: "2026-03-09T12:05:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a conversation execution state without a runtime workspace fingerprint", () => {
    const result = conversationExecutionStateSchema.safeParse({
      agentContextLookupKey: "space-1|agt-1|builtin:codex|local-cli",
      activeContextId: "thread-1",
      dispatchesSinceBootstrapApplied: 0,
      updatedAt: "2026-03-09T12:05:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a conversation execution state with an invalid runtime working directory", () => {
    const result = conversationExecutionStateSchema.safeParse({
      agentContextLookupKey: "space-1|agt-1|builtin:codex|local-cli",
      activeContextId: "thread-1",
      lastRuntimeWorkspacePath: "/tmp/repo\u0000a",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      dispatchesSinceBootstrapApplied: 3,
      updatedAt: "2026-03-09T12:05:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
