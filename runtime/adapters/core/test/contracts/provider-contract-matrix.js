export const sharedProviderContractMatrix = Object.freeze([
  Object.freeze({
    adapterId: "claude-code",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:claude-code",
    agentControllerConversationKind: "session",
  }),
  Object.freeze({
    adapterId: "codex",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:codex",
    agentControllerConversationKind: "thread",
  }),
  Object.freeze({
    adapterId: "cursor",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:cursor",
    agentControllerConversationKind: "session",
  }),
  Object.freeze({
    adapterId: "openclaw",
    bridgeMode: "session_ref_separate",
    agentControllerRef: "builtin:openclaw",
    agentControllerConversationKind: "session",
  }),
  Object.freeze({
    adapterId: "opencode",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:opencode",
    agentControllerConversationKind: "session",
  }),
]);

export function getSharedProviderContractEntry(adapterId) {
  const entry =
    sharedProviderContractMatrix.find(
      (candidate) => candidate.adapterId === adapterId
    ) ?? null;
  if (entry) {
    return entry;
  }
  throw new Error(
    `shared.provider_contract.unknown_adapter: no shared contract matrix entry for '${adapterId}'`
  );
}

export function listSharedProviderContractAdapterIds() {
  return sharedProviderContractMatrix.map((entry) => entry.adapterId);
}
