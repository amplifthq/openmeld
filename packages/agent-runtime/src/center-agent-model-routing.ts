import type {
  CenterAgentModelPreference,
  CenterAgentModelRoute,
  ModelCatalog,
  ModelCatalogAgentController,
  ModelCatalogModel,
} from "@openmeld/schemas/types";
import { HOSTED_CENTER_AGENT_CONTROLLER_REF_ID } from "./agent-controller-ref";

export type {
  CenterAgentModelPreference,
  CenterAgentModelRoute,
} from "@openmeld/schemas/types";

export type CenterAgentModelRouteResult =
  | {
      status: "accepted";
      route: CenterAgentModelRoute;
    }
  | {
      status: "rejected";
      code:
        | "center_agent_model_catalog_invalid"
        | "center_agent_model_unavailable"
        | "center_agent_model_unknown";
      message: string;
    };

export type CenterAgentModelChoice = {
  displayName: string;
  effectiveModelDisplayName: string;
  preference: CenterAgentModelPreference;
  supportsImageInput: boolean;
};

export function resolveCenterAgentModelRoute(input: {
  catalog: ModelCatalog;
  preference: CenterAgentModelPreference;
}): CenterAgentModelRouteResult {
  const controller = readHostedCenterAgentController(input.catalog);
  if (!controller?.hostedRuntimePolicy) {
    return {
      status: "rejected",
      code: "center_agent_model_catalog_invalid",
      message: "The Center Agent model catalog is not configured.",
    };
  }

  const modelId =
    input.preference.kind === "system_default"
      ? controller.defaultModelId
      : input.preference.modelId;
  const model = controller.models.find((candidate) => candidate.id === modelId);

  if (!model) {
    return {
      status: "rejected",
      code: "center_agent_model_unknown",
      message: "The selected Center Agent model is not in the model catalog.",
    };
  }
  if (model.unavailable) {
    return {
      status: "rejected",
      code: "center_agent_model_unavailable",
      message: "The selected Center Agent model is unavailable.",
    };
  }
  if (!model.hostedRuntime) {
    return {
      status: "rejected",
      code: "center_agent_model_catalog_invalid",
      message: "The selected Center Agent model has no hosted runtime.",
    };
  }
  const imageUnderstandingModel = controller.models.find(
    (candidate) =>
      candidate.id === controller.hostedRuntimePolicy?.imageUnderstandingModelId
  );
  if (
    !imageUnderstandingModel?.hostedRuntime ||
    imageUnderstandingModel.unavailable ||
    !imageUnderstandingModel.hostedRuntime.inputModalities.includes("image")
  ) {
    return {
      status: "rejected",
      code: "center_agent_model_catalog_invalid",
      message: "The Center Agent image understanding model is not configured.",
    };
  }

  return {
    status: "accepted",
    route: {
      automaticModelFallback: false,
      catalogUpdatedAt: input.catalog.updatedAt,
      contextWindow: model.hostedRuntime.contextWindow,
      displayName: model.displayName,
      imageUnderstandingModel: {
        contextWindow: imageUnderstandingModel.hostedRuntime.contextWindow,
        displayName: imageUnderstandingModel.displayName,
        inputModalities: imageUnderstandingModel.hostedRuntime.inputModalities,
        maxOutputTokens: imageUnderstandingModel.hostedRuntime.maxOutputTokens,
        modelId: imageUnderstandingModel.id,
        provider: imageUnderstandingModel.hostedRuntime.provider,
        reasoningLevel: imageUnderstandingModel.hostedRuntime.reasoningLevel,
      },
      inputModalities: model.hostedRuntime.inputModalities,
      maxOutputTokens: model.hostedRuntime.maxOutputTokens,
      modelId: model.id,
      preference: input.preference,
      provider: model.hostedRuntime.provider,
      reasoningLevel: model.hostedRuntime.reasoningLevel,
    },
  };
}

export function listCenterAgentModelChoices(
  catalog: ModelCatalog
): CenterAgentModelChoice[] {
  const controller = readHostedCenterAgentController(catalog);
  if (!controller) {
    return [];
  }

  const defaultModel = controller.models.find(
    (model) => model.id === controller.defaultModelId
  );
  if (!(defaultModel?.hostedRuntime && !defaultModel.unavailable)) {
    return [];
  }

  return [
    {
      displayName: "OpenMeld default",
      effectiveModelDisplayName: defaultModel.displayName,
      preference: { kind: "system_default" },
      supportsImageInput:
        defaultModel.hostedRuntime.inputModalities.includes("image"),
    },
    ...controller.models.filter(isAvailableHostedModel).map((model) => ({
      displayName: model.displayName,
      effectiveModelDisplayName: model.displayName,
      preference: {
        kind: "selected_model" as const,
        modelId: model.id,
      },
      supportsImageInput:
        model.hostedRuntime?.inputModalities.includes("image") ?? false,
    })),
  ];
}

function readHostedCenterAgentController(
  catalog: ModelCatalog
): ModelCatalogAgentController | null {
  return (
    catalog.agentControllers[HOSTED_CENTER_AGENT_CONTROLLER_REF_ID] ?? null
  );
}

function isAvailableHostedModel(model: ModelCatalogModel): boolean {
  return !model.unavailable && model.hostedRuntime !== undefined;
}
