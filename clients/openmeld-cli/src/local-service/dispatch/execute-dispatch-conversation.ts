import type {
  AdapterAgentContextResolution,
  AdapterDispatchContextDelta,
} from "@openmeld/adapter-core";
import type { runRuntimeTask } from "@openmeld/local-execution";
import {
  buildAgentControllerConversationRef,
  normalizeKnownBuiltinAgentControllerId,
  resolveBuiltinAgentControllerConversationKind,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  AgentControllerConversationResumePlan,
  ConversationPolicy,
} from "@openmeld/schemas/types";
import type { DaemonProfileRouteConfig } from "../core/types";

export function resolveCurrentConversationPolicy(
  routeConfig: DaemonProfileRouteConfig | null
): ConversationPolicy {
  return { ...(routeConfig?.conversationPolicy ?? {}) };
}

export function resolveDispatchContextIdForAgentControllerConversation(input: {
  agentControllerConversationId: string | null;
  agentControllerConversationOverride: AgentControllerConversationRef | null;
  agentControllerConversationResumePlan: AgentControllerConversationResumePlan;
}): string | null {
  if (
    input.agentControllerConversationResumePlan.status !== "continue_existing"
  ) {
    return null;
  }

  return normalizeOptionalContextId(
    input.agentControllerConversationOverride?.agentControllerConversationId ??
      input.agentControllerConversationId ??
      null
  );
}

export function resolvePlannedAgentControllerConversation(input: {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
}): AgentControllerConversationRef | null {
  return buildAgentControllerConversationRefFromAgentControllerConversation(
    input
  );
}

export function resolveObservedDispatchAgentControllerConversation(input: {
  contextDelta: AdapterDispatchContextDelta | null;
  contextResolution: AdapterAgentContextResolution | null;
  plannedAgentControllerConversation: AgentControllerConversationRef | null;
  agentControllerConversationOverride: AgentControllerConversationRef | null;
}): AgentControllerConversationRef | null {
  return (
    input.contextDelta?.agentControllerConversation ??
    input.contextResolution?.agentControllerConversation ??
    input.agentControllerConversationOverride ??
    input.plannedAgentControllerConversation ??
    null
  );
}

export function buildAgentControllerConversationRefFromAgentControllerConversation(input: {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
}): AgentControllerConversationRef | null {
  const conversationId = normalizeOptionalContextId(
    input.agentControllerConversationId
  );
  const agentControllerRef = normalizeOptionalContextId(
    input.agentControllerRef
  );
  if (!(conversationId && agentControllerRef)) {
    return null;
  }
  const builtinProviderId =
    normalizeKnownBuiltinAgentControllerId(agentControllerRef);
  if (builtinProviderId) {
    return buildAgentControllerConversationRef({
      agentControllerRef,
      agentControllerConversationKind:
        resolveBuiltinAgentControllerConversationKind(agentControllerRef) ??
        "context",
      agentControllerConversationId: conversationId,
    });
  }
  return buildAgentControllerConversationRef({
    agentControllerRef,
    agentControllerConversationKind: "context",
    agentControllerConversationId: conversationId,
  });
}

export function areSameAgentControllerConversationRef(
  left: AgentControllerConversationRef,
  right: AgentControllerConversationRef | null
): boolean {
  if (!right) {
    return false;
  }
  return (
    left.agentControllerRef === right.agentControllerRef &&
    left.agentControllerConversationKind ===
      right.agentControllerConversationKind &&
    left.agentControllerConversationId === right.agentControllerConversationId
  );
}

export function normalizeOptionalContextId(
  contextId: string | null | undefined
): string | null {
  if (typeof contextId !== "string") {
    return null;
  }
  const normalized = contextId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveDispatchContextDeltaFromRuntimeResult(
  dispatchResult: Awaited<ReturnType<typeof runRuntimeTask>>["dispatchResult"]
): AdapterDispatchContextDelta | null {
  if (!dispatchResult.dispatched) {
    return null;
  }
  if (dispatchResult.adapterResult.status !== "success") {
    return null;
  }
  return dispatchResult.adapterResult.contextDelta ?? null;
}
