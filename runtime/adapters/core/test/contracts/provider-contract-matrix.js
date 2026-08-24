export const sharedProviderContractMatrix = Object.freeze([
  Object.freeze({
    adapterId: "claude-code",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:claude-code",
    agentControllerConversationKind: "session",
    repairConversationPolicy: "preserve_canonical",
  }),
  Object.freeze({
    adapterId: "codex",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:codex",
    agentControllerConversationKind: "thread",
    repairConversationPolicy: "preserve_canonical",
  }),
  Object.freeze({
    adapterId: "cursor",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:cursor",
    agentControllerConversationKind: "session",
    repairConversationPolicy: "preserve_canonical",
  }),
  Object.freeze({
    adapterId: "grok-build",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:grok-build",
    agentControllerConversationKind: "session",
    repairConversationPolicy: "preserve_canonical",
  }),
  Object.freeze({
    adapterId: "openclaw",
    bridgeMode: "session_ref_separate",
    agentControllerRef: "builtin:openclaw",
    agentControllerConversationKind: "session",
    repairConversationPolicy: "provider_managed",
  }),
  Object.freeze({
    adapterId: "opencode",
    bridgeMode: "legacy_context_bridge",
    agentControllerRef: "builtin:opencode",
    agentControllerConversationKind: "session",
    repairConversationPolicy: "preserve_canonical",
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
