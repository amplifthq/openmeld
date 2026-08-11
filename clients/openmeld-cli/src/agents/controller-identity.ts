import { parseAgentControllerRef } from "@openmeld/schemas";

export function resolveLocalRegistryAgentIdFromAgentControllerRef(input: {
  agentControllerRef: string | null | undefined;
}): string | null {
  return parseAgentControllerRef(input.agentControllerRef)?.id ?? null;
}

export function matchesAgentControllerRefAgentId(input: {
  agentId: string;
  agentControllerRef: string | null | undefined;
}): boolean {
  const localAgentId = resolveLocalRegistryAgentIdFromAgentControllerRef(input);
  return localAgentId !== null && localAgentId === input.agentId.trim();
}

export function formatAgentControllerRefDisplayValue(input: {
  agentControllerRef: string | null | undefined;
}): string | null {
  return parseAgentControllerRef(input.agentControllerRef)?.ref ?? null;
}
