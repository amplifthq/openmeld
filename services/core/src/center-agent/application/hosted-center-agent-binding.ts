import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  hostedCenterAgentRuntimeIdentitySchema,
} from "@openmeld/schemas";
import type { AgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";

type HostedCenterAgentExecutionTarget = Pick<
  AgentProfileBindingRecord,
  | "agentControllerConversationId"
  | "agentControllerRef"
  | "hostedRuntimeIdentityJson"
  | "openMeldServiceRuntimeId"
  | "runtimeKind"
>;

export function isHostedCenterAgentExecutionTarget(
  binding: HostedCenterAgentExecutionTarget
): boolean {
  return (
    binding.runtimeKind === "hosted_center_agent" &&
    binding.openMeldServiceRuntimeId ===
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID &&
    binding.agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF &&
    binding.agentControllerConversationId === null &&
    isHostedCenterAgentRuntimeIdentity(binding.hostedRuntimeIdentityJson)
  );
}

function isHostedCenterAgentRuntimeIdentity(
  value: string | null | undefined
): boolean {
  if (!value) {
    return false;
  }
  try {
    return hostedCenterAgentRuntimeIdentitySchema.safeParse(JSON.parse(value))
      .success;
  } catch {
    return false;
  }
}
