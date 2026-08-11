import {
  buildAgentControllerConversationRef,
  canonicalizeBuiltinAgentControllerRef,
  resolveBuiltinAgentControllerConversationKind,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationKind,
  AgentControllerConversationRef,
} from "@openmeld/schemas/types";

export type AdapterConversationBridgeSpec = {
  agentControllerRef: string;
  agentControllerConversationKind: AgentControllerConversationKind;
};

const normalizeText = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const resolveBuiltinAdapterConversationBridgeSpec = (
  adapterId: string
): AdapterConversationBridgeSpec | null => {
  const rawAgentControllerRef = normalizeText(adapterId);
  if (!rawAgentControllerRef) {
    return null;
  }
  const agentControllerRef = canonicalizeBuiltinAgentControllerRef(
    rawAgentControllerRef
  );
  if (!agentControllerRef) {
    return null;
  }
  const agentControllerConversationKind =
    resolveBuiltinAgentControllerConversationKind(agentControllerRef);
  if (!agentControllerConversationKind) {
    return null;
  }
  return {
    agentControllerRef,
    agentControllerConversationKind,
  };
};

export const buildAdapterAgentControllerConversationRef = (input: {
  agentControllerRef: string;
  agentControllerConversationId: string;
  agentControllerConversationKind: AgentControllerConversationKind;
}): AgentControllerConversationRef =>
  buildAgentControllerConversationRef({
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerConversationKind: input.agentControllerConversationKind,
  });

export const resolveBridgedAgentControllerConversationId = (input: {
  bridgeSpec: AdapterConversationBridgeSpec;
  agentControllerConversationId?: string | null;
  agentControllerConversation?: AgentControllerConversationRef | null;
}): string | null => {
  const agentControllerConversationId = normalizeText(
    input.agentControllerConversationId
  );
  const agentControllerConversation = input.agentControllerConversation;
  if (!agentControllerConversation) {
    return agentControllerConversationId;
  }

  if (
    agentControllerConversation.agentControllerRef !==
    input.bridgeSpec.agentControllerRef
  ) {
    throw new Error(
      `conversation.bridge.agent_controller_ref_mismatch: expected agentControllerRef=${input.bridgeSpec.agentControllerRef}, received agentControllerRef=${agentControllerConversation.agentControllerRef}`
    );
  }
  if (
    agentControllerConversation.agentControllerConversationKind !==
    input.bridgeSpec.agentControllerConversationKind
  ) {
    throw new Error(
      `conversation.bridge.agent_controller_conversation_kind_mismatch: expected agentControllerConversationKind=${input.bridgeSpec.agentControllerConversationKind}, received agentControllerConversationKind=${agentControllerConversation.agentControllerConversationKind}`
    );
  }
  if (
    agentControllerConversationId &&
    agentControllerConversationId !==
      agentControllerConversation.agentControllerConversationId
  ) {
    throw new Error(
      `conversation.bridge.agent_controller_conversation_id_mismatch: expected agentControllerConversationId=${agentControllerConversationId}, received agentControllerConversationId=${agentControllerConversation.agentControllerConversationId}`
    );
  }

  return agentControllerConversation.agentControllerConversationId;
};

export const bridgeAgentControllerConversationRef = (input: {
  bridgeSpec: AdapterConversationBridgeSpec;
  agentControllerConversationId?: string | null;
  agentControllerConversation?: AgentControllerConversationRef | null;
}): AgentControllerConversationRef | null => {
  const resolvedContextId = resolveBridgedAgentControllerConversationId(input);
  if (!resolvedContextId) {
    return null;
  }
  return buildAdapterAgentControllerConversationRef({
    agentControllerRef: input.bridgeSpec.agentControllerRef,
    agentControllerConversationId: resolvedContextId,
    agentControllerConversationKind:
      input.bridgeSpec.agentControllerConversationKind,
  });
};
