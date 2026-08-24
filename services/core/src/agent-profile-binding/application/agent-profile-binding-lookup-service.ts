import {
  type AgentProfileBindingAgentControllerCollaborationMode,
  type AgentProfileBindingAgentControllerPermissionMode,
  type AgentProfileBindingDispatchReadableFacts,
  type AgentProfileBindingDisplayProjection,
  type AgentProfileBindingState,
  createAgentProfileBindingDisplayProjection,
} from "@openmeld/agent-runtime";
import type { AgentProfileBindingOpenCodePermission } from "@openmeld/schemas/types";
import type {
  AgentProfileBindingCommandRecord,
  AgentProfileBindingOwner,
} from "./agent-profile-binding-command-service";

export type AgentProfileBindingLookupStore = {
  readPrimaryBinding: (input: {
    agentProfileId: string;
    owner: AgentProfileBindingOwner;
  }) => Promise<AgentProfileBindingCommandRecord | null>;
};

export type AgentProfileBindingLookupResult = {
  agentProfileId: string;
  bindingId?: string;
  bindingState: AgentProfileBindingState;
  agentControllerConversationId?: string;
  agentControllerRef?: string;
  dispatchReadableFacts: AgentProfileBindingDispatchReadableFacts | null;
  displayProjection: AgentProfileBindingDisplayProjection;
  grantsClaimSuccess: false;
  agentControllerCollaborationMode?: AgentProfileBindingAgentControllerCollaborationMode;
  agentControllerPermissionMode?: AgentProfileBindingAgentControllerPermissionMode;
  modelSelection?: {
    modelId: string;
    reasoningLevel?: string;
  };
  openCodePermission?: AgentProfileBindingOpenCodePermission;
  reasonCodes: readonly string[];
  routable: boolean;
  openMeldServiceRuntimeId?: string;
  status: "routable" | "not_routable";
};

export async function lookupPrimaryAgentProfileBinding(input: {
  agentProfileId: string;
  owner: AgentProfileBindingOwner;
  store: AgentProfileBindingLookupStore;
}): Promise<AgentProfileBindingLookupResult> {
  const binding = await input.store.readPrimaryBinding({
    agentProfileId: input.agentProfileId,
    owner: input.owner,
  });
  if (!binding) {
    const projection = createAgentProfileBindingProjectionFromRecord({
      agentProfileId: input.agentProfileId,
      binding: null,
    });
    return mapProjection(projection);
  }

  const projection = createAgentProfileBindingProjectionFromRecord({
    agentProfileId: input.agentProfileId,
    binding,
  });
  return mapProjection(projection);
}

export function createAgentProfileBindingProjectionFromRecord(input: {
  agentProfileId: string;
  binding: AgentProfileBindingCommandRecord | null;
}): AgentProfileBindingDisplayProjection {
  if (!input.binding) {
    return createAgentProfileBindingDisplayProjection({
      agentProfileId: input.agentProfileId,
      bindingState: "missing",
    });
  }

  return createAgentProfileBindingDisplayProjection({
    agentProfileId: input.binding.agentProfileId,
    bindingId: input.binding.bindingId,
    bindingState: input.binding.bindingState,
    reasonCodes: input.binding.reasonCode
      ? [input.binding.reasonCode]
      : undefined,
    executionTarget: {
      agentControllerRef: input.binding.agentControllerRef,
      agentControllerConversationId:
        input.binding.agentControllerConversationId,
      openMeldServiceRuntimeId: input.binding.openMeldServiceRuntimeId,
    },
    agentControllerCollaborationMode:
      input.binding.agentControllerCollaborationMode,
    agentControllerPermissionMode: input.binding.agentControllerPermissionMode,
    openCodePermission: input.binding.openCodePermission,
    modelSelection: input.binding.modelId
      ? {
          modelId: input.binding.modelId,
          ...(input.binding.reasoningLevel
            ? { reasoningLevel: input.binding.reasoningLevel }
            : {}),
        }
      : undefined,
  });
}

function mapProjection(
  projection: ReturnType<typeof createAgentProfileBindingDisplayProjection>
): AgentProfileBindingLookupResult {
  return {
    agentProfileId: projection.agentProfileId,
    bindingId: projection.bindingId,
    bindingState: projection.bindingState,
    agentControllerConversationId:
      projection.executionTarget?.agentControllerConversationId,
    agentControllerRef: projection.executionTarget?.agentControllerRef,
    dispatchReadableFacts: projection.dispatchReadableFacts,
    displayProjection: projection,
    grantsClaimSuccess: false,
    ...(projection.agentControllerCollaborationMode
      ? {
          agentControllerCollaborationMode:
            projection.agentControllerCollaborationMode,
        }
      : {}),
    ...(projection.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            projection.agentControllerPermissionMode,
        }
      : {}),
    ...(projection.modelSelection
      ? { modelSelection: projection.modelSelection }
      : {}),
    ...(projection.openCodePermission
      ? { openCodePermission: projection.openCodePermission }
      : {}),
    reasonCodes: projection.reasonCodes,
    routable: projection.dispatchEligibility.routable,
    openMeldServiceRuntimeId:
      projection.executionTarget?.openMeldServiceRuntimeId,
    status: projection.dispatchEligibility.status,
  };
}
