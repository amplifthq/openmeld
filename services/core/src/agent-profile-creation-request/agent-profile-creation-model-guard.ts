import { resolveAgentControllerModelCompatibility } from "@openmeld/agent-runtime";
import type { ModelCatalogAgentController } from "@openmeld/schemas/types";
import { validateAgentModelSelection } from "../config/agent-model-availability";

export type AgentProfileCreationModelGuard = {
  code: string;
  reason: string;
};

/**
 * Admission-time model compatibility guard for Agent Profile creation.
 *
 * Validate explicit catalog intent before checking device compatibility.
 * Missing device evidence must not deny a valid catalog selection.
 */
export function evaluateAgentProfileCreationModelGuard(input: {
  agentDisplayName: string;
  agentControllerRef: string;
  catalogControllers: Record<string, ModelCatalogAgentController> | null;
  controllerId: string;
  controllerInterfaceVersion: string | null;
  deviceDisplayName: string;
  modelId: string;
  reasoningLevel?: string | null;
  reportedModelIds: readonly string[] | null;
}): AgentProfileCreationModelGuard | null {
  if (input.catalogControllers) {
    const issue = validateAgentModelSelection({
      agentControllerRef: input.agentControllerRef,
      catalog: { agentControllers: input.catalogControllers },
      modelId: input.modelId,
      nowMs: Date.now(),
      reasoningLevel: input.reasoningLevel,
    });
    if (issue) {
      return issue;
    }
  }
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
