import type { RuntimeAgentControllerLaunchContract } from "@openmeld/schemas/types";
import type {
  RuntimeAgentControllerState,
  RuntimeAgentStreamingMode,
  RuntimeAgentTransportMode,
} from "../config/runtime-config";
import { createDefaultRuntimeAgentControllerSettings } from "../config/runtime-config";

export function normalizeAgentId(value: string): string {
  return value.trim();
}

export function normalizeAgentIds(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const agentId = normalizeAgentId(value);
    if (!(agentId && !seen.has(agentId))) {
      continue;
    }
    seen.add(agentId);
    normalized.push(agentId);
  }
  return normalized;
}

export function createAgentRegistration(input: {
  agentId: string;
  displayName: string;
  launchContract?: RuntimeAgentControllerLaunchContract;
  streamingMode?: RuntimeAgentStreamingMode;
  timestamp?: string;
  transportMode?: RuntimeAgentTransportMode;
}): RuntimeAgentControllerState {
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) {
    throw new Error("agents.config_invalid: agentId is required");
  }
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new Error("agents.config_invalid: displayName is required");
  }
  const now = input.timestamp ?? new Date().toISOString();
  const controllerSettings =
    createDefaultRuntimeAgentControllerSettings(agentId);
  return {
    agentId,
    displayName,
    enabled: true,
    ...(input.launchContract ? { launchContract: input.launchContract } : {}),
    transportMode: input.transportMode ?? controllerSettings.transportMode,
    streamingMode: input.streamingMode ?? controllerSettings.streamingMode,
    timeoutMs: controllerSettings.timeoutMs,
    retry: controllerSettings.retry,
    contextIdMappingSpec: controllerSettings.contextIdMappingSpec,
    registeredAt: now,
    updatedAt: now,
  };
}

export function sortAgentRegistrations(
  registrations: RuntimeAgentControllerState[]
): RuntimeAgentControllerState[] {
  return [...registrations].sort((left, right) =>
    left.agentId.localeCompare(right.agentId)
  );
}

export function parseAgentEnabledOption(
  value: string | undefined
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error("agents.config_invalid: --enabled must be true or false");
}
