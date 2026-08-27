import { resolveAgentControllerModelCompatibility } from "@openmeld/agent-runtime";
import type { ModelCatalogAgentController } from "@openmeld/schemas/types";

export type AgentProfileCreationModelGuard = {
  code: string;
  reason: string;
};

/**
 * Admission-time model compatibility guard for Agent Profile creation.
 *
 * Fails closed only when the shared compatibility judgment produces an
 * explicit negative fact: the selected controller does not offer the model
 * (`not_offered`) or the installed controller is too old
 * (`requires_newer_controller`). Missing catalog, unknown controllers, or
 * missing version/inventory evidence stays unknown and must not block
 * creation, so stale or partial Computer snapshots cannot deny a valid
 * request.
 */
export function evaluateAgentProfileCreationModelGuard(input: {
  agentDisplayName: string;
  catalogControllers: Record<string, ModelCatalogAgentController> | null;
  controllerId: string;
  controllerInterfaceVersion: string | null;
  deviceDisplayName: string;
  modelId: string;
  reportedModelIds: readonly string[] | null;
}): AgentProfileCreationModelGuard | null {
  const controller = input.catalogControllers?.[input.controllerId];
  if (!controller) {
    return null;
  }
  const compatibility = resolveAgentControllerModelCompatibility({
    controller,
    installedVersion: input.controllerInterfaceVersion,
    modelId: input.modelId,
    reportedModelIds: input.reportedModelIds,
  });
  if (compatibility.status === "not_offered") {
    return {
      code: "agent_profile_creation_request.model_not_offered",
      reason: `${input.modelId} isn't available for ${input.agentDisplayName} on ${input.deviceDisplayName}. Choose another model or update the local agent.`,
    };
  }
  if (compatibility.status === "requires_newer_controller") {
    return {
      code: "agent_profile_creation_request.model_requires_newer_controller",
      reason: `${input.modelId} requires ${input.agentDisplayName} ${compatibility.minimumVersion} or later, but ${input.deviceDisplayName} has ${compatibility.currentVersion}. Update the local agent or choose another model.`,
    };
  }
  return null;
}
