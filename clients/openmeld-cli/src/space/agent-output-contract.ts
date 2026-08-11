import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import { canonicalizeBuiltinAgentControllerRef } from "@openmeld/schemas";
import type {
  AgentProfileBindingModelSelection,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export type NormalizedOwnerFields = {
  ownerUserId: string | null;
  ownerName: string | null;
};

export function resolveNormalizedOwnerFields(input: {
  ownerUserId?: unknown;
  ownerName?: unknown;
  owner?: unknown;
}): NormalizedOwnerFields {
  return {
    ownerUserId:
      normalizeOptionalText(input.ownerUserId) ??
      normalizeOptionalText(input.owner),
    ownerName: normalizeOptionalText(input.ownerName),
  };
}

export function normalizeAgentControllerRef(
  agentControllerRef: unknown
): string | null {
  const normalized = normalizeOptionalText(agentControllerRef);
  if (!normalized) {
    return null;
  }
  return canonicalizeBuiltinAgentControllerRef(normalized) ?? normalized;
}

export function normalizeAgentOutputProfile(
  profile: SignalEnvelope["profile"] | HelloAck["profile"] | null | undefined
): SignalEnvelope["profile"] | HelloAck["profile"] | undefined {
  if (!(profile && typeof profile === "object")) {
    return undefined;
  }

  const { ownerUserId, ownerName } = resolveNormalizedOwnerFields({
    ownerUserId: (profile as { ownerUserId?: unknown }).ownerUserId,
    ownerName: (profile as { ownerName?: unknown }).ownerName,
    owner: (profile as { owner?: unknown }).owner,
  });
  const agentControllerRef = normalizeAgentControllerRef(
    (profile as { agentControllerRef?: unknown }).agentControllerRef
  );

  return {
    ...profile,
    ...(ownerUserId ? { ownerUserId } : {}),
    ...(ownerName ? { ownerName } : {}),
    ...(agentControllerRef ? { agentControllerRef } : {}),
  };
}

export function normalizeAgentOutputEvent(
  event: SignalEnvelope | HelloAck
): SignalEnvelope | HelloAck {
  if (!("profile" in event)) {
    return event;
  }
  const normalizedProfile = normalizeAgentOutputProfile(event.profile);
  if (!normalizedProfile) {
    return event;
  }
  const nextEvent = {
    ...event,
    profile: normalizedProfile,
  };
  if ("owner" in nextEvent.profile) {
    (nextEvent.profile as { owner?: unknown }).owner = undefined;
  }
  return nextEvent;
}

export function normalizeAgentOutputMembersSnapshot(
  snapshot: SpaceMembersSnapshot
): SpaceMembersSnapshot {
  const normalizedHumans = snapshot.humans.map((human) => {
    const ownerUserId = normalizeOptionalText(human.ownerUserId);
    const ownerName = normalizeOptionalText(human.ownerName);
    return {
      ...human,
      ownerUserId,
      ownerName,
    };
  });
  const normalizedAgents = snapshot.agents.map((agent) => {
    const ownerUserId = normalizeOptionalText(agent.ownerUserId);
    const ownerName = normalizeOptionalText(agent.ownerName);
    const agentControllerRef = normalizeAgentControllerRef(
      agent.agentControllerRef
    );
    return {
      ...agent,
      ownerUserId,
      ownerName,
      agentControllerRef,
    };
  });

  return {
    ...snapshot,
    humans: normalizedHumans,
    agents: normalizedAgents,
  };
}

export function buildAgentSessionMetaPayload(input: {
  gatewayUrl: string;
  mode: "interactive chat" | "watch-only stream" | "history viewer";
  passwordProtected?: boolean;
  agentControllerConversationId?: string;
  agentControllerRef?: string;
  modelSelection?: AgentProfileBindingModelSelection | null;
  profileId: string;
  profileKind?: "human" | "agent" | "system";
  profileName: string;
  ownerName?: string;
  ownerUserId?: string;
  spaceCreatedAt?: string;
  spaceCreatorId?: string;
  spaceCreatorName?: string;
  spaceId: string;
  spaceName?: string;
}): Record<string, unknown> {
  let security: "Secure" | "Public" | "Unknown" = "Unknown";
  if (input.passwordProtected === true) {
    security = "Secure";
  } else if (input.passwordProtected === false) {
    security = "Public";
  }

  const payload: Record<string, unknown> = {
    type: "system.session.meta",
    gatewayUrl: input.gatewayUrl,
    mode: input.mode,
    profileId: input.profileId,
    profileName: input.profileName,
    security,
    spaceId: input.spaceId,
  };

  appendOptionalStringField(payload, "spaceName", input.spaceName);
  appendOptionalStringField(payload, "spaceCreatedAt", input.spaceCreatedAt);
  appendOptionalStringField(payload, "spaceCreatorId", input.spaceCreatorId);
  appendOptionalStringField(
    payload,
    "spaceCreatorName",
    input.spaceCreatorName
  );
  appendOptionalBooleanField(
    payload,
    "passwordProtected",
    input.passwordProtected
  );
  appendOptionalStringField(payload, "profileKind", input.profileKind);
  appendOptionalStringField(payload, "ownerUserId", input.ownerUserId);
  appendOptionalStringField(payload, "ownerName", input.ownerName);
  appendOptionalStringField(
    payload,
    "agentControllerRef",
    normalizeAgentControllerRef(input.agentControllerRef)
  );
  appendOptionalStringField(
    payload,
    "agentControllerConversationId",
    input.agentControllerConversationId
  );
  appendOptionalModelSelectionField(payload, input.modelSelection);
  return payload;
}

function appendOptionalStringField(
  payload: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  const normalized = normalizeOptionalText(value);
  if (normalized) {
    payload[key] = normalized;
  }
}

function appendOptionalBooleanField(
  payload: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  if (typeof value === "boolean") {
    payload[key] = value;
  }
}

function appendOptionalModelSelectionField(
  payload: Record<string, unknown>,
  value: AgentProfileBindingModelSelection | null | undefined
): void {
  const modelId = normalizeOptionalText(value?.modelId);
  if (!modelId) {
    return;
  }
  const reasoningLevel = normalizeOptionalText(value?.reasoningLevel);
  payload.modelSelection = {
    modelId,
    ...(reasoningLevel ? { reasoningLevel } : {}),
  };
}
