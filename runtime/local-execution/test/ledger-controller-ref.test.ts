import { describe, expect, it } from "vitest";
import {
  commitResolvedAgentContext,
  createEmptyLedgerState,
  resolveAgentContextByLookupKey,
  seedLegacyAgentContext,
} from "../src/ledger-store";

describe("ledger controller ref writes", () => {
  it("canonicalizes builtin agentControllerRef when seeding a legacy agent context", () => {
    const agentContextLookupKey =
      "space-a|agent-a|builtin%3Acodex|local-cli|sha256%3Aworkspace-a";
    const state = seedLegacyAgentContext({
      state: createEmptyLedgerState(Date.UTC(2026, 2, 11, 0, 0, 0)),
      agentContextLookupKey,
      legacyAgentControllerConversationId: "ctx-legacy",
      agentControllerRef: "builtin:codex",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      spaceId: "space-a",
      targetProfileId: "agent-a",
      transportMode: "local-cli",
      taskId: "task-legacy",
      nowMs: Date.UTC(2026, 2, 11, 0, 0, 1),
    });

    expect(
      resolveAgentContextByLookupKey({
        agentContextLookupKey,
        state,
      })
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
    });
  });

  it("canonicalizes builtin agentControllerRef when committing a resolved agent context", () => {
    const agentContextLookupKey =
      "space-a|agent-a|builtin%3Acodex|local-cli|sha256%3Aworkspace-a";
    const state = commitResolvedAgentContext({
      state: createEmptyLedgerState(Date.UTC(2026, 2, 11, 0, 1, 0)),
      agentContextLookupKey,
      agentControllerConversationId: "ctx-commit",
      agentControllerRef: "builtin:codex",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      spaceId: "space-a",
      targetProfileId: "agent-a",
      transportMode: "local-cli",
      taskId: "task-commit",
      nowMs: Date.UTC(2026, 2, 11, 0, 1, 1),
    });

    expect(
      resolveAgentContextByLookupKey({
        agentContextLookupKey,
        state,
      })
    ).toMatchObject({
      agentControllerRef: "builtin:codex",
    });
  });

  it("stores Codex App Server agent context with the existing Codex thread id", () => {
    const agentContextLookupKey =
      "space-a|agent-a|builtin%3Acodex|codex-app-server|sha256%3Aworkspace-a";
    const state = seedLegacyAgentContext({
      state: createEmptyLedgerState(Date.UTC(2026, 2, 11, 0, 2, 0)),
      agentContextLookupKey,
      legacyAgentControllerConversationId: "thread-existing",
      agentControllerRef: "builtin:codex",
      runtimeWorkspaceFingerprint: "sha256:workspace-a",
      spaceId: "space-a",
      targetProfileId: "agent-a",
      transportMode: "codex-app-server",
      taskId: "task-app-server",
      nowMs: Date.UTC(2026, 2, 11, 0, 2, 1),
    });

    expect(
      resolveAgentContextByLookupKey({
        agentContextLookupKey,
        state,
      })
    ).toMatchObject({
      agentControllerConversationId: "thread-existing",
      agentControllerRef: "builtin:codex",
      transportMode: "codex-app-server",
    });
  });
});
