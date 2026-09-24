import { hostedModelReasoningLevelSchema } from "@openmeld/schemas";
import type {
  CenterAgentModelPreference,
  CenterAgentModelRoute,
  ModelCatalog,
  ModelCatalogAgentController,
  ModelCatalogModel,
} from "@openmeld/schemas/types";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF_ID,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "./agent-controller-ref";
import { getPersonalRemoteAgentDefaultModelId } from "./model-catalog";

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
        | "center_agent_model_unknown"
        | "center_agent_reasoning_unsupported";
      message: string;
    };

export type CenterAgentModelChoice = {
  badgeLabel: string | null;
  defaultReasoningLevel: CenterAgentModelRoute["reasoningLevel"];
  displayName: string;
  effectiveModelDisplayName: string;
  preference: CenterAgentModelPreference;
  supportedReasoningLevels: string[];
  supportsImageInput: boolean;
};

export function resolveCenterAgentModelRoute(input: {
  agentControllerRef?: string;
  catalog: ModelCatalog;
  preference: CenterAgentModelPreference;
  reasoningLevel?: string | null;
}): CenterAgentModelRouteResult {
  const controller = readHostedCenterAgentController(input.catalog);
  if (!controller?.hostedRuntimePolicy) {
    return {
      status: "rejected",
      code: "center_agent_model_catalog_invalid",
      message: "The Center Agent model catalog is not configured.",
    };
  }

  const defaultModelId =
    input.agentControllerRef === HOSTED_REMOTE_AGENT_CONTROLLER_REF
      ? getPersonalRemoteAgentDefaultModelId(input.catalog)
      : controller.defaultModelId;
  const modelId =
    input.preference.kind === "system_default"
      ? defaultModelId
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
  const requestedReasoningLevel = input.reasoningLevel
    ? hostedModelReasoningLevelSchema.safeParse(input.reasoningLevel)
    : null;
  if (
    input.reasoningLevel &&
    !(
      requestedReasoningLevel?.success &&
      model.supportedReasoningLevels.includes(input.reasoningLevel)
    )
  ) {
    return {
      status: "rejected",
      code: "center_agent_reasoning_unsupported",
      message: `Reasoning level "${input.reasoningLevel}" is not supported for model "${modelId}".`,
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
      reasoningLevel: requestedReasoningLevel?.success
        ? requestedReasoningLevel.data
        : model.hostedRuntime.reasoningLevel,
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
      badgeLabel: defaultModel.badgeLabel ?? null,
      defaultReasoningLevel: defaultModel.hostedRuntime.reasoningLevel,
      displayName: "OpenMeld default",
      effectiveModelDisplayName: defaultModel.displayName,
      preference: { kind: "system_default" },
      supportedReasoningLevels: defaultModel.supportedReasoningLevels,
      supportsImageInput:
        defaultModel.hostedRuntime.inputModalities.includes("image"),
    },
    ...controller.models.filter(isAvailableHostedModel).map((model) => ({
      badgeLabel: model.badgeLabel ?? null,
      defaultReasoningLevel: model.hostedRuntime.reasoningLevel,
      displayName: model.displayName,
      effectiveModelDisplayName: model.displayName,
      preference: {
        kind: "selected_model" as const,
        modelId: model.id,
      },
      supportedReasoningLevels: model.supportedReasoningLevels,
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

function isAvailableHostedModel(
  model: ModelCatalogModel
): model is ModelCatalogModel & {
  hostedRuntime: NonNullable<ModelCatalogModel["hostedRuntime"]>;
} {
  return !model.unavailable && model.hostedRuntime !== undefined;
}
