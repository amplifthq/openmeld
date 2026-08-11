import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  buildAgentContextLookupKey,
  resolveAgentContextConversationProfileConflict,
  resolveAgentContextForDispatch,
} from "../src/agent-context-policy";
import { createEmptyLedgerState } from "../src/ledger-store";

const WORKSPACE_A = "sha256:workspace-a";
const WORKSPACE_B = "sha256:workspace-b";

describe("agent context policy", () => {
  it("builds a canonical builtin lookup key from profile continuity facts", () => {
    expect(
      buildAgentContextLookupKey({
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      })
    ).toBe("agent-a|builtin%3Acodex|local-cli|sha256%3Aworkspace-a");
  });

  it("rejects hosted Center Agent refs before local context resolution", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 0, 0));

    expect(() =>
      resolveAgentContextForDispatch({
        key: {
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          runtimeWorkspaceFingerprint: WORKSPACE_A,
          spaceId: "space-a",
          targetProfileId: "agent-a",
          transportMode: "local-cli",
        },
        nowMs: Date.UTC(2026, 1, 25, 20, 0, 10),
        providerContextId: "ctx-first",
        state,
        taskId: "task-1",
      })
    ).toThrow("runtime.agent_context.hosted_agent_controller_ref_not_local");
  });

  it("creates agent context on first provider context for the current runtime workspace", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 0, 0));
    const result = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 0, 10),
      providerContextId: "ctx-first",
      state,
      taskId: "task-1",
    });

    expect(result).toMatchObject({
      counterDelta: {
        created: 1,
      },
      lifecycleReason: "created_missing_context",
      resolvedAgentControllerConversationId: "ctx-first",
    });
  });

  it("reuses existing agent context only within the same runtime workspace", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 1, 0));
    const created = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 10),
      providerContextId: "ctx-first",
      state,
      taskId: "task-1",
    });
    if (!created.agentContext) {
      throw new Error("expected created agent context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [created.agentContext.agentContextLookupKey]: created.agentContext,
      },
    };

    const reused = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 20),
      providerContextId: "ctx-second",
      state: nextState,
      taskId: "task-2",
    });

    expect(reused).toMatchObject({
      counterDelta: {
        guardBlocked: 1,
        reused: 1,
      },
      lifecycleReason: "guard_reused_existing_context",
      resolvedAgentControllerConversationId: "ctx-first",
      sourceFieldOverride: "openMeldDaemon.agent_context_ledger",
    });
  });

  it("detects when another Agent Profile already owns the controller conversation", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 1, 0));
    const ownerProfileContext = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 10),
      providerContextId: "ctx-shared",
      state,
      taskId: "task-1",
    });
    if (!ownerProfileContext.agentContext) {
      throw new Error("expected created agent context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [ownerProfileContext.agentContext.agentContextLookupKey]:
          ownerProfileContext.agentContext,
      },
    };

    const conflict = resolveAgentContextConversationProfileConflict({
      agentControllerConversationId: "ctx-shared",
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_B,
        spaceId: "space-b",
        targetProfileId: "agent-b",
        transportMode: "local-cli",
      },
      state: nextState,
    });

    expect(conflict).toMatchObject({
      agentControllerConversationId: "ctx-shared",
      targetProfileId: "agent-a",
    });
  });

  it("allows the same Agent Profile to keep its controller conversation across Spaces", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 1, 0));
    const firstSpaceContext = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 10),
      providerContextId: "ctx-profile-a",
      state,
      taskId: "task-1",
    });
    if (!firstSpaceContext.agentContext) {
      throw new Error("expected created agent context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [firstSpaceContext.agentContext.agentContextLookupKey]:
          firstSpaceContext.agentContext,
      },
    };

    expect(
      resolveAgentContextConversationProfileConflict({
        agentControllerConversationId: "ctx-profile-a",
        key: {
          agentControllerRef: "builtin:codex",
          runtimeWorkspaceFingerprint: WORKSPACE_B,
          spaceId: "space-b",
          targetProfileId: "agent-a",
          transportMode: "local-cli",
        },
        state: nextState,
      })
    ).toBeNull();

    const reused = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-b",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 20),
      providerContextId: null,
      state: nextState,
      taskId: "task-2",
    });

    expect(reused).toMatchObject({
      lifecycleReason: "reused_existing_context",
      resolvedAgentControllerConversationId: "ctx-profile-a",
      sourceFieldOverride: "openMeldDaemon.agent_context_ledger",
    });
    expect(reused.agentContextLookupKey).toBe(
      "agent-a|builtin%3Acodex|local-cli|sha256%3Aworkspace-a"
    );
    expect(reused.replacedAgentContextLookupKey).toBeUndefined();
    expect(reused.agentContext).toMatchObject({
      agentControllerConversationId: "ctx-profile-a",
      spaceId: "space-b",
      targetProfileId: "agent-a",
    });
  });

  it("does not create an Agent Context when the provider returns another profile's conversation", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 1, 0));
    const ownerProfileContext = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 10),
      providerContextId: "ctx-shared",
      state,
      taskId: "task-1",
    });
    if (!ownerProfileContext.agentContext) {
      throw new Error("expected created agent context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [ownerProfileContext.agentContext.agentContextLookupKey]:
          ownerProfileContext.agentContext,
      },
    };

    const rejected = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_B,
        spaceId: "space-b",
        targetProfileId: "agent-b",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 1, 20),
      providerContextId: "ctx-shared",
      state: nextState,
      taskId: "task-2",
    });

    expect(rejected).toEqual({
      agentContextLookupKey:
        "agent-b|builtin%3Acodex|local-cli|sha256%3Aworkspace-b",
      counterDelta: {
        guardBlocked: 1,
      },
      lifecycleReason: "profile_conversation_conflict",
      resolvedAgentControllerConversationId: null,
      sourceFieldOverride: "openMeldDaemon.agent_context_ledger",
    });
  });

  it("creates a new local runtime context when the runtime workspace fingerprint changes", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 2, 0));
    const created = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 2, 10),
      providerContextId: "ctx-workspace-a",
      state,
      taskId: "task-1",
    });
    if (!created.agentContext) {
      throw new Error("expected created runtime context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [created.agentContext.agentContextLookupKey]: created.agentContext,
      },
    };

    const recreated = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_B,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 2, 20),
      providerContextId: "ctx-workspace-b",
      state: nextState,
      taskId: "task-2",
    });

    expect(recreated).toMatchObject({
      counterDelta: {
        created: 1,
      },
      lifecycleReason: "created_missing_context",
      resolvedAgentControllerConversationId: "ctx-workspace-b",
    });
    expect(recreated.rotationRecord).toBeUndefined();
    expect(recreated.agentContextLookupKey).toBe(
      "agent-a|builtin%3Acodex|local-cli|sha256%3Aworkspace-b"
    );
  });

  it("marks recreated_incompatible_context only when the controller changes within the same runtime workspace", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 3, 0));
    const createdCodex = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 3, 10),
      providerContextId: "ctx-codex",
      state,
      taskId: "task-1",
    });
    if (!createdCodex.agentContext) {
      throw new Error("expected created codex agent context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [createdCodex.agentContext.agentContextLookupKey]:
          createdCodex.agentContext,
      },
    };

    const recreated = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:claude-code",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 3, 20),
      providerContextId: "ctx-claude",
      state: nextState,
      taskId: "task-2",
    });

    expect(recreated).toMatchObject({
      counterDelta: {
        created: 1,
        recreated: 1,
      },
      lifecycleReason: "recreated_incompatible_context",
      resolvedAgentControllerConversationId: "ctx-claude",
      rotationRecord: {
        nextAgentControllerConversationId: "ctx-claude",
        previousAgentControllerConversationId: "ctx-codex",
        rotationAt: Date.UTC(2026, 1, 25, 20, 3, 20),
        rotationReason: "controller_ref_changed",
        rotationTaskId: "task-2",
        rotationTriggerErrorCode: "context.controller_ref_changed",
      },
    });
  });

  it("treats builtin and custom controllers with the same raw ref as different identities in the same runtime workspace", () => {
    const state = createEmptyLedgerState(Date.UTC(2026, 1, 25, 20, 4, 0));
    const createdBuiltin = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "builtin:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 4, 10),
      providerContextId: "ctx-builtin",
      state,
      taskId: "task-1",
    });
    if (!createdBuiltin.agentContext) {
      throw new Error("expected created builtin agent context");
    }

    const nextState = {
      ...state,
      agentContextByLookupKey: {
        [createdBuiltin.agentContext.agentContextLookupKey]:
          createdBuiltin.agentContext,
      },
    };

    const recreated = resolveAgentContextForDispatch({
      key: {
        agentControllerRef: "custom:codex",
        runtimeWorkspaceFingerprint: WORKSPACE_A,
        spaceId: "space-a",
        targetProfileId: "agent-a",
        transportMode: "local-cli",
      },
      nowMs: Date.UTC(2026, 1, 25, 20, 4, 20),
      providerContextId: "ctx-custom",
      state: nextState,
      taskId: "task-2",
    });

    expect(recreated).toMatchObject({
      lifecycleReason: "recreated_incompatible_context",
      resolvedAgentControllerConversationId: "ctx-custom",
      counterDelta: {
        created: 1,
        recreated: 1,
      },
      rotationRecord: {
        previousAgentControllerConversationId: "ctx-builtin",
        nextAgentControllerConversationId: "ctx-custom",
        rotationReason: "controller_ref_changed",
      },
    });
  });
});
