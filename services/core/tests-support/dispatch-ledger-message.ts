import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";

export const buildDispatchMessage = (overrides?: {
  deliveryRecoveryReason?: OpenMeldDaemonDispatchQueueMessage["deliveryRecoveryReason"];
  dispatchOwner?: OpenMeldDaemonDispatchQueueMessage["dispatchOwner"];
  dispatchId?: string;
  idempotencyKey?: string;
  sourceClientMessageId?: string;
  sourceEventId?: string;
  sourceProfileId?: string;
  targetProfileId?: string;
}): OpenMeldDaemonDispatchQueueMessage => {
  const dispatchId = overrides?.dispatchId ?? "dispatch-1";
  const sourceEventId = overrides?.sourceEventId ?? "evt-1";
  const targetProfileId = overrides?.targetProfileId ?? "agt-1";
  return {
    v: 2,
    dispatchId,
    spaceId: "space-1",
    sourceEventId,
    sourceSignalSnapshot: {
      profileId: overrides?.sourceProfileId ?? "human-1",
      profileKind: "human",
      text: "Wake the agent",
    },
    ...(overrides?.deliveryRecoveryReason
      ? { deliveryRecoveryReason: overrides.deliveryRecoveryReason }
      : {}),
    ...(overrides?.sourceClientMessageId
      ? { sourceClientMessageId: overrides.sourceClientMessageId }
      : {}),
    ...(overrides?.dispatchOwner
      ? { dispatchOwner: overrides.dispatchOwner }
      : {}),
    targetProfileId,
    dispatchChainId: dispatchId,
    autoRelayDepth: 0,
    visitedProfileIds: [],
    visitedProfileIdsHash: "stable32:1234abcd",
    dispatchContractVersion: 2,
    dispatchPolicy: "mention_only",
    ruleSource: "space",
    ruleId: "space.default.all_members.v1",
    ruleReason: "default allow all members mention",
    taskId: `task-${dispatchId}`,
    transportMode: "local-cli",
    controllerSnapshot: {
      targetBindingState: "bound",
      targetBindingEnabled: true,
      agentControllerRef: "codex",
    },
    contextIdMappingSpec: null,
    dispatchRulesSnapshot: {
      dispatchPolicy: "mention_only",
      ruleSource: "space",
      ruleId: "space.default.all_members.v1",
      ruleReason: "default allow all members mention",
    },
    dispatchSnapshot: {
      dispatchPolicy: "mention_only",
      ruleSource: "space",
      ruleId: "space.default.all_members.v1",
      ruleReason: "default allow all members mention",
      targetBindingState: "bound",
      targetBindingEnabled: true,
    },
    idempotencyKey:
      overrides?.idempotencyKey ?? `5:${sourceEventId}|5:${targetProfileId}`,
    enqueuedAtMs: 1000,
  };
};
