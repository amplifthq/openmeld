import {
  buildAgentControllerRoutingKey,
  formatCanonicalMentionLiteral,
} from "@openmeld/schemas";

export type LocalServiceDispatchQueueTask = {
  executionContext?: { id: string };
  agentControllerConversationId: string | null;
  agentControllerRef: string | null;
  spaceId: string | null;
  targetProfileId: string;
  targetProfileMentionLabel?: string | null;
  transportMode: string | null;
};

export type DispatchQueueLogMeta = {
  adapterId: string | null;
  controllerKey: string;
  localExecutionLaneKey: string;
  spaceId: string | null;
  targetLabel: string;
  transportMode: string | null;
};

export function resolveDispatchQueueLogMeta(input: {
  profileId: string;
  runtimeAdapterId: string | null;
  parsedTask: LocalServiceDispatchQueueTask | null;
}): DispatchQueueLogMeta {
  if (!input.parsedTask) {
    const controllerKey = `profile:${input.profileId}`;
    return {
      adapterId: null,
      controllerKey,
      localExecutionLaneKey: buildDispatchLocalExecutionLaneKey({
        agentControllerConversationId: null,
        controllerKey,
        profileId: input.profileId,
      }),
      spaceId: null,
      targetLabel: `profile:${input.profileId}`,
      transportMode: null,
    };
  }

  const controllerKey = buildDispatchControllerKey({
    agentControllerRef: input.parsedTask.agentControllerRef,
    profileId: input.profileId,
  });
  return {
    adapterId: input.runtimeAdapterId,
    controllerKey,
    localExecutionLaneKey: buildDispatchLocalExecutionLaneKey({
      executionContextId: input.parsedTask.executionContext?.id,
      agentControllerConversationId:
        input.parsedTask.agentControllerConversationId,
      controllerKey,
      profileId: input.profileId,
    }),
    spaceId: input.parsedTask.spaceId,
    targetLabel: resolveDispatchQueueTargetLabel(input.parsedTask),
    transportMode: input.parsedTask.transportMode,
  };
}

export function buildDispatchControllerKey(input: {
  agentControllerRef: string | null;
  profileId: string;
}): string {
  const normalizedAgentControllerRef =
    typeof input.agentControllerRef === "string"
      ? input.agentControllerRef.trim()
      : "";
  if (normalizedAgentControllerRef) {
    return (
      buildAgentControllerRoutingKey(normalizedAgentControllerRef) ??
      `profile:${input.profileId}`
    );
  }
  return `profile:${input.profileId}`;
}

export function buildDispatchLocalExecutionLaneKey(input: {
  executionContextId?: string;
  agentControllerConversationId: string | null;
  controllerKey: string;
  profileId: string;
}): string {
  if (input.executionContextId) {
    return `execution-context:${input.profileId}:${input.executionContextId}`;
  }
  const agentControllerConversationId = normalizeOptionalText(
    input.agentControllerConversationId
  );
  if (agentControllerConversationId) {
    return `agent-controller-conversation:${input.controllerKey}:${agentControllerConversationId}`;
  }
  return `agent-profile:${input.profileId}`;
}

function resolveDispatchQueueTargetLabel(
  parsedTask: LocalServiceDispatchQueueTask
): string {
  const mentionLabel = normalizeOptionalText(
    parsedTask.targetProfileMentionLabel
  );
  if (mentionLabel) {
    return formatCanonicalMentionLiteral({
      name: mentionLabel,
      type: "wake",
    });
  }
  return `profile:${parsedTask.targetProfileId}`;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
