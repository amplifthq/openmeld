import type {
  AdapterAgentContextResolution,
  AdapterContextIdMappingSpec,
  AdapterDispatchFailure,
  RuntimeAdapter,
} from "@openmeld/adapter-core";
import {
  resolveAdapterAgentContext,
  resolveBuiltinAdapterConversationBridgeSpec,
} from "@openmeld/adapter-core";
import {
  LEGACY_RUNTIME_DISPATCH_POLICY,
  type RuntimeTransportMode,
} from "@openmeld/schemas";
import type { RuntimeAgentControllerLaunchContract } from "@openmeld/schemas/types";
import type { TriggerMode } from "./trigger-policy.js";

export const ADAPTER_ROUTE_ERROR_CODES = {
  adapterUnreachable: "adapter.unreachable",
  controllerRuntimeMissing: "controller.runtime.missing",
  dispatchPolicyUnsupported: "dispatch.policy.unsupported",
  serviceNotInstalled: "service.not_installed",
  serviceUnhealthy: "service.unhealthy",
} as const;

export type AdapterRouteErrorCode =
  (typeof ADAPTER_ROUTE_ERROR_CODES)[keyof typeof ADAPTER_ROUTE_ERROR_CODES];

export type AdapterRouteTarget = {
  adapter: RuntimeAdapter;
  agentControllerRef?: string;
  controllerRefMatcher?: {
    kind: "contains" | "equals" | "prefix" | "suffix" | "regex";
    values: string[];
  };
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  reachable?: boolean;
  transportMode: RuntimeTransportMode;
};

export type AdapterRouteInput = {
  contextIdMappingSpec: AdapterContextIdMappingSpec;
  agentControllerRef: string;
  controllerRuntimeAvailable?: boolean;
  dispatchPolicy?: TriggerMode;
  env?: Record<string, string | undefined>;
  serviceHealthy?: boolean;
  serviceInstalled?: boolean;
  targets: AdapterRouteTarget[];
  transportMode: RuntimeTransportMode;
  view?: "agent" | "human";
};

export type AdapterRouteFailure = {
  errorCode: AdapterRouteErrorCode;
  errorMessage: string;
  errorType: "adapter" | "config" | "network";
  nextStep: string;
  ok: false;
};

export type AdapterRouteSuccess = {
  adapter: RuntimeAdapter;
  contextResolution: AdapterAgentContextResolution;
  dispatchPolicy: TriggerMode;
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  ok: true;
  transportMode: RuntimeTransportMode;
};

export type AdapterRouteResult = AdapterRouteFailure | AdapterRouteSuccess;

const isInstalled = (input: AdapterRouteInput): boolean =>
  input.serviceInstalled !== false;
const isHealthy = (input: AdapterRouteInput): boolean =>
  input.serviceHealthy !== false;
const isControllerRuntimeAvailable = (input: AdapterRouteInput): boolean =>
  input.controllerRuntimeAvailable !== false;

const buildRouteFailure = (input: {
  errorCode: AdapterRouteErrorCode;
  errorType: AdapterRouteFailure["errorType"];
  view: "agent" | "human";
}): AdapterRouteFailure => {
  const nextStepByCode: Record<
    AdapterRouteErrorCode,
    Record<"agent" | "human", string>
  > = {
    [ADAPTER_ROUTE_ERROR_CODES.serviceNotInstalled]: {
      agent:
        "ask a human to install OpenMeld background service, then retry dispatch",
      human: "run `openmeld-dev service install` and retry dispatch",
    },
    [ADAPTER_ROUTE_ERROR_CODES.serviceUnhealthy]: {
      agent:
        "ask a human to recover OpenMeld background service health before retry",
      human: "run `openmeld-dev service status` and recover unhealthy service",
    },
    [ADAPTER_ROUTE_ERROR_CODES.controllerRuntimeMissing]: {
      agent:
        "ask a human to configure controller runtime for this agent profile",
      human: "configure controller runtime and transport mode for this profile",
    },
    [ADAPTER_ROUTE_ERROR_CODES.dispatchPolicyUnsupported]: {
      agent:
        "ask a human to switch dispatch policy to mention_only for this target",
      human:
        "set dispatch policy to mention_only for this target and retry dispatch",
    },
    [ADAPTER_ROUTE_ERROR_CODES.adapterUnreachable]: {
      agent:
        "retry with a reachable transport mode or request controller reconfiguration",
      human:
        "verify transport_mode and adapter endpoint reachability, then retry",
    },
  };

  return {
    errorCode: input.errorCode,
    errorMessage: input.errorCode,
    errorType: input.errorType,
    nextStep: nextStepByCode[input.errorCode][input.view],
    ok: false,
  };
};

export const toDispatchFailureFromRouteFailure = (
  failure: AdapterRouteFailure
): AdapterDispatchFailure => ({
  errorCode: failure.errorCode,
  errorMessage: `${failure.errorMessage}: ${failure.nextStep}`,
  errorType: failure.errorType,
  status: "failed",
});

export const resolveAdapterRoute = (
  input: AdapterRouteInput
): AdapterRouteResult => {
  const view = input.view ?? "agent";
  const dispatchPolicy = input.dispatchPolicy ?? LEGACY_RUNTIME_DISPATCH_POLICY;
  if (
    dispatchPolicy !== LEGACY_RUNTIME_DISPATCH_POLICY &&
    dispatchPolicy !== "listen_all"
  ) {
    return buildRouteFailure({
      errorCode: ADAPTER_ROUTE_ERROR_CODES.dispatchPolicyUnsupported,
      errorType: "config",
      view,
    });
  }

  if (!isInstalled(input)) {
    return buildRouteFailure({
      errorCode: ADAPTER_ROUTE_ERROR_CODES.serviceNotInstalled,
      errorType: "config",
      view,
    });
  }
  if (!isHealthy(input)) {
    return buildRouteFailure({
      errorCode: ADAPTER_ROUTE_ERROR_CODES.serviceUnhealthy,
      errorType: "network",
      view,
    });
  }
  if (!isControllerRuntimeAvailable(input)) {
    return buildRouteFailure({
      errorCode: ADAPTER_ROUTE_ERROR_CODES.controllerRuntimeMissing,
      errorType: "config",
      view,
    });
  }

  const target = input.targets.find(
    (entry) =>
      isRouteTargetAgentControllerRefMatched(entry, input.agentControllerRef) &&
      entry.transportMode === input.transportMode
  );
  if (!target || target.reachable === false) {
    return buildRouteFailure({
      errorCode: ADAPTER_ROUTE_ERROR_CODES.adapterUnreachable,
      errorType: "network",
      view,
    });
  }

  const bridgeSpec =
    resolveBuiltinAdapterConversationBridgeSpec(target.adapter.adapterId) ??
    undefined;
  const contextResolution = resolveAdapterAgentContext({
    bridgeSpec,
    env: input.env,
    spec: input.contextIdMappingSpec,
  });
  return {
    adapter: target.adapter,
    contextResolution,
    dispatchPolicy,
    ...(target.launchContract ? { launchContract: target.launchContract } : {}),
    ok: true,
    transportMode: input.transportMode,
  };
};

const isRouteTargetAgentControllerRefMatched = (
  target: AdapterRouteTarget,
  agentControllerRef: string
): boolean => {
  if (target.controllerRefMatcher) {
    return isAgentControllerRefMatchedByMatcher(
      agentControllerRef,
      target.controllerRefMatcher
    );
  }
  return target.agentControllerRef === agentControllerRef;
};

const isAgentControllerRefMatchedByMatcher = (
  agentControllerRef: string,
  matcher: NonNullable<AdapterRouteTarget["controllerRefMatcher"]>
): boolean => {
  const normalizedAgentControllerRef = agentControllerRef.toLowerCase();
  for (const value of matcher.values) {
    if (
      isAgentControllerRefMatchedByMatcherValue(
        agentControllerRef,
        normalizedAgentControllerRef,
        matcher.kind,
        value
      )
    ) {
      return true;
    }
  }
  return false;
};

const isAgentControllerRefMatchedByMatcherValue = (
  agentControllerRef: string,
  normalizedAgentControllerRef: string,
  kind: NonNullable<AdapterRouteTarget["controllerRefMatcher"]>["kind"],
  matcherValue: string
): boolean => {
  const normalizedMatcherValue = matcherValue.toLowerCase();
  switch (kind) {
    case "contains":
      return normalizedAgentControllerRef.includes(normalizedMatcherValue);
    case "equals":
      return normalizedAgentControllerRef === normalizedMatcherValue;
    case "prefix":
      return normalizedAgentControllerRef.startsWith(normalizedMatcherValue);
    case "suffix":
      return normalizedAgentControllerRef.endsWith(normalizedMatcherValue);
    case "regex":
      return isAgentControllerRefRegexMatched(agentControllerRef, matcherValue);
    default:
      return false;
  }
};

const isAgentControllerRefRegexMatched = (
  agentControllerRef: string,
  matcherValue: string
): boolean => {
  try {
    return new RegExp(matcherValue, "i").test(agentControllerRef);
  } catch {
    return false;
  }
};
