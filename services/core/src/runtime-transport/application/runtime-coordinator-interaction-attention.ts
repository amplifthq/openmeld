import type { AgentInteractionRequest } from "@openmeld/schemas/types";

/**
 * Identity of the Agent Task needs-attention record RuntimeCoordinator writes
 * for each local Agent interaction. Readers such as the permission-mode
 * advisor count these records, so the writer and readers share this module.
 */
export const RUNTIME_COORDINATOR_INTERACTION_ATTENTION_EVENT_PREFIX =
  "runtime-coordinator-interaction:";

export function buildRuntimeCoordinatorInteractionAttentionEventId(input: {
  interactionId: string;
  runtimeCoordinatorExecutionId: string;
}): string {
  return `${RUNTIME_COORDINATOR_INTERACTION_ATTENTION_EVENT_PREFIX}${input.runtimeCoordinatorExecutionId}:${input.interactionId}`;
}

export function runtimeCoordinatorInteractionAttentionCode(
  kind: AgentInteractionRequest["kind"]
): string {
  return `runtime_coordinator.interaction.${kind}`;
}
