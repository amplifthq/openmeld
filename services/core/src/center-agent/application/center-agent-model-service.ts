import {
  listCenterAgentModelChoices,
  resolveCenterAgentModelRoute,
} from "@openmeld/agent-runtime";
import {
  centerAgentModelConfigurationResponseSchema,
  centerAgentModelRouteSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentModelConfigurationResponse,
  CenterAgentModelPreference,
  CenterAgentModelRoute,
  ModelCatalog,
} from "@openmeld/schemas/types";

type CenterAgentModelBinding = {
  configurationRevision: number;
  modelId?: string | null;
};

function resolveModelAvailability(
  model: ModelCatalog["agentControllers"][string]["models"][number] | undefined
): "available" | "unavailable" | "unknown" {
  if (!model) {
    return "unknown";
  }
  return model.unavailable ? "unavailable" : "available";
}

export class CenterAgentModelResolutionError extends Error {
  readonly code:
    | "center_agent_model_catalog_invalid"
    | "center_agent_model_unavailable"
    | "center_agent_model_unknown";

  constructor(input: {
    code:
      | "center_agent_model_catalog_invalid"
      | "center_agent_model_unavailable"
      | "center_agent_model_unknown";
    message: string;
  }) {
    super(input.message);
    this.name = "CenterAgentModelResolutionError";
    this.code = input.code;
  }
}

export function readCenterAgentModelPreference(
  binding: CenterAgentModelBinding
): CenterAgentModelPreference {
  return binding.modelId
    ? { kind: "selected_model", modelId: binding.modelId }
    : { kind: "system_default" };
}

export function resolveCenterAgentModelRouteForBinding(input: {
  binding: CenterAgentModelBinding;
  catalog: ModelCatalog;
}): CenterAgentModelRoute {
  const result = resolveCenterAgentModelRoute({
    catalog: input.catalog,
    preference: readCenterAgentModelPreference(input.binding),
  });
  if (result.status === "rejected") {
    throw new CenterAgentModelResolutionError(result);
  }
  return centerAgentModelRouteSchema.parse(result.route);
}

export function projectCenterAgentModelConfiguration(input: {
  binding: CenterAgentModelBinding;
  canManage: boolean;
  catalog: ModelCatalog;
  organizationId: string;
}): CenterAgentModelConfigurationResponse {
  const preference = readCenterAgentModelPreference(input.binding);
  const controller = input.catalog.agentControllers["center-agent"];
  if (!controller) {
    throw new CenterAgentModelResolutionError({
      code: "center_agent_model_catalog_invalid",
      message: "The Center Agent model catalog is not configured.",
    });
  }
  const effectiveModelId =
    preference.kind === "system_default"
      ? controller.defaultModelId
      : preference.modelId;
  const effectiveModel = controller.models.find(
    (model) => model.id === effectiveModelId
  );
  return centerAgentModelConfigurationResponseSchema.parse({
    canManage: input.canManage,
    choices: listCenterAgentModelChoices(input.catalog),
    configurationRevision: input.binding.configurationRevision,
    effectiveModel: {
      availability: resolveModelAvailability(effectiveModel),
      displayName: effectiveModel?.displayName ?? "Unavailable model",
      modelId: effectiveModelId,
      supportsImageInput:
        effectiveModel?.hostedRuntime?.inputModalities.includes("image") ??
        false,
    },
    organizationId: input.organizationId,
    preference,
  });
}
