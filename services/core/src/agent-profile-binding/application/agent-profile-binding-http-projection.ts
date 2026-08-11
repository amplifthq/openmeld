import type {
  AgentProfileBindingDisplayProjection,
  AgentProfileBindingExecutionTarget,
} from "@openmeld/agent-runtime";
import type { AgentProfileBindingProjection } from "@openmeld/schemas/types";

export function toHttpAgentProfileBindingProjection(
  binding: AgentProfileBindingDisplayProjection,
  options: {
    includeAgentControllerCollaborationMode?: boolean;
  } = {}
): AgentProfileBindingProjection {
  const routable = binding.dispatchEligibility.routable;

  return {
    agentProfileId: binding.agentProfileId,
    authoritySource: binding.authoritySource,
    ...(binding.bindingId ? { bindingId: binding.bindingId } : {}),
    bindingState: binding.bindingState,
    dispatchEligibility: {
      reasonCodes: [...binding.dispatchEligibility.reasonCodes],
      routable,
      status: binding.dispatchEligibility.status,
    },
    grantsClaimSuccess: false,
    ...(options.includeAgentControllerCollaborationMode !== false &&
    binding.agentControllerCollaborationMode
      ? {
          agentControllerCollaborationMode:
            binding.agentControllerCollaborationMode,
        }
      : {}),
    ...(binding.agentControllerPermissionMode
      ? { agentControllerPermissionMode: binding.agentControllerPermissionMode }
      : {}),
    ...(binding.modelSelection
      ? { modelSelection: binding.modelSelection }
      : {}),
    ...(binding.openCodePermission
      ? { openCodePermission: binding.openCodePermission }
      : {}),
    reasonCodes: [...binding.reasonCodes],
    resolutionSource: binding.resolutionSource,
    routable,
    executionTarget: toHttpAgentProfileBindingExecutionTarget(
      binding.executionTarget
    ),
  };
}

function toHttpAgentProfileBindingExecutionTarget(
  executionTarget: AgentProfileBindingExecutionTarget | null
): AgentProfileBindingProjection["executionTarget"] {
  if (!executionTarget) {
    return null;
  }

  return {
    agentControllerRef: executionTarget.agentControllerRef,
    ...(executionTarget.agentControllerConversationId
      ? {
          agentControllerConversationId:
            executionTarget.agentControllerConversationId,
        }
      : {}),
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: executionTarget.openMeldServiceRuntimeId,
    },
  };
}
