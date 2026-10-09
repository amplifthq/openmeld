import type { AgentProfileBindingTarget } from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../rpc/errors";

// A write precondition from the canonical Binding, not execution authority or
// another saved target. Model and permission edits do not change this identity.
export type { AgentProfileBindingTarget } from "@openmeld/schemas/types";

export function requireSameAgentProfileBindingTarget(
  current:
    | (Omit<AgentProfileBindingTarget, "agentControllerConversationId"> & {
        agentControllerConversationId?: string | null;
      })
    | null,
  expected: AgentProfileBindingTarget
): void {
  if (
    current?.bindingId === expected.bindingId &&
    current.agentControllerRef === expected.agentControllerRef &&
    (current.agentControllerConversationId ?? null) ===
      (expected.agentControllerConversationId ?? null) &&
    current.openMeldServiceRuntimeId === expected.openMeldServiceRuntimeId
  ) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "agent_profile_binding.target_changed",
    reason:
      "This Agent’s Computer or local agent changed. Reopen Working folder to review its current settings.",
    status: 409,
  });
}
