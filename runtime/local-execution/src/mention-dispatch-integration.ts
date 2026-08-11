import type {
  AdapterContextIdMappingSpec,
  AdapterDispatchRequest,
  AdapterDispatchResult,
  AdapterTransportMode,
  RuntimeAdapter,
} from "@openmeld/adapter-core";
import {
  buildAdapterAgentControllerConversationRef,
  resolveBuiltinAdapterConversationBridgeSpec,
} from "@openmeld/adapter-core";
import {
  type AdapterRouteFailure,
  type AdapterRouteTarget,
  resolveAdapterRoute,
  toDispatchFailureFromRouteFailure,
} from "./adapter-routing.js";
import {
  shouldDispatchForMentionOnly,
  type TriggerMode,
} from "./trigger-policy.js";

export type MentionOnlyDispatchInput = {
  adapter: RuntimeAdapter;
  mentioned: boolean;
  request: AdapterDispatchRequest;
  triggerMode?: TriggerMode;
};

export type MentionOnlyDispatchResult =
  | {
      dispatched: false;
      reason: "not_mentioned";
    }
  | {
      adapterResult: AdapterDispatchResult;
      dispatched: true;
      reason: "dispatched";
    };

export type MentionOnlyDispatchWithRoutingInput = {
  agentControllerConversationIdOverride?: string | null;
  contextIdMappingSpec: AdapterContextIdMappingSpec;
  agentControllerRef: string;
  controllerRuntimeAvailable?: boolean;
  env?: Record<string, string | undefined>;
  mentioned: boolean;
  request: AdapterDispatchRequest;
  serviceHealthy?: boolean;
  serviceInstalled?: boolean;
  agentControllerConversationOverride?: AdapterDispatchRequest["agentControllerConversation"];
  targets: AdapterRouteTarget[];
  transportMode: AdapterTransportMode;
  triggerMode?: TriggerMode;
  view?: "agent" | "human";
  sourceFieldOverride?: string;
};

export type MentionOnlyDispatchWithRoutingResult = MentionOnlyDispatchResult & {
  contextResolution?: {
    agentControllerConversationId: string | null;
    mappingVersion: number;
    sourceField: string;
    agentControllerConversation?: AdapterDispatchRequest["agentControllerConversation"];
  };
  routeFailure?: AdapterRouteFailure;
};

export const dispatchMentionOnlyTask = async (
  input: MentionOnlyDispatchInput
): Promise<MentionOnlyDispatchResult> => {
  if (
    !shouldDispatchForMentionOnly({
      mentioned: input.mentioned,
      triggerMode: input.triggerMode,
    })
  ) {
    return {
      dispatched: false,
      reason: "not_mentioned",
    };
  }

  const adapterResult = await input.adapter.dispatch(input.request);
  return {
    adapterResult,
    dispatched: true,
    reason: "dispatched",
  };
};

export const dispatchMentionOnlyTaskWithRouting = async (
  input: MentionOnlyDispatchWithRoutingInput
): Promise<MentionOnlyDispatchWithRoutingResult> => {
  if (
    !shouldDispatchForMentionOnly({
      mentioned: input.mentioned,
      triggerMode: input.triggerMode,
    })
  ) {
    return {
      dispatched: false,
      reason: "not_mentioned",
    };
  }

  const route = resolveAdapterRoute({
    contextIdMappingSpec: input.contextIdMappingSpec,
    agentControllerRef: input.agentControllerRef,
    controllerRuntimeAvailable: input.controllerRuntimeAvailable,
    dispatchPolicy: input.triggerMode,
    env: input.env,
    serviceHealthy: input.serviceHealthy,
    serviceInstalled: input.serviceInstalled,
    targets: input.targets,
    transportMode: input.transportMode,
    view: input.view,
  });

  if (!route.ok) {
    return {
      adapterResult: toDispatchFailureFromRouteFailure(route),
      dispatched: true,
      reason: "dispatched",
      routeFailure: route,
    };
  }

  const normalizedOverride = normalizeAgentControllerConversationId(
    input.agentControllerConversationIdOverride
  );
  const resolvedContextId =
    normalizedOverride ?? route.contextResolution.agentControllerConversationId;
  const bridgeSpec = resolveBuiltinAdapterConversationBridgeSpec(
    route.adapter.adapterId
  );
  const resolvedAgentControllerConversation =
    input.agentControllerConversationOverride ??
    (bridgeSpec && resolvedContextId
      ? buildAdapterAgentControllerConversationRef({
          agentControllerRef: bridgeSpec.agentControllerRef,
          agentControllerConversationId: resolvedContextId,
          agentControllerConversationKind:
            bridgeSpec.agentControllerConversationKind,
        })
      : (route.contextResolution.agentControllerConversation ?? null));
  const contextResolution = {
    ...route.contextResolution,
    agentControllerConversationId: resolvedContextId,
    ...(resolvedAgentControllerConversation
      ? { agentControllerConversation: resolvedAgentControllerConversation }
      : {}),
    ...(normalizedOverride && input.sourceFieldOverride
      ? { sourceField: input.sourceFieldOverride }
      : {}),
  };

  const adapterResult: AdapterDispatchResult = await route.adapter.dispatch({
    ...input.request,
    ...(resolvedContextId
      ? { agentControllerConversationId: resolvedContextId }
      : {}),
    ...(input.env ? { env: input.env } : {}),
    ...(route.launchContract ? { launchContract: route.launchContract } : {}),
    ...(resolvedAgentControllerConversation
      ? { agentControllerConversation: resolvedAgentControllerConversation }
      : {}),
    transportMode: route.transportMode,
  });
  return {
    adapterResult,
    contextResolution,
    dispatched: true,
    reason: "dispatched",
  };
};

const normalizeAgentControllerConversationId = (
  value: string | null | undefined
): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};
