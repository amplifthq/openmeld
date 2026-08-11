import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	AgentProfileBindingModelSelection,
	ModelCatalog,
	ModelCatalogModel,
} from "@openmeld/schemas/types";

const MODEL_DEFAULT_REASONING_LABEL = "model default";

export function resolveAgentProfileControllerModelDetail(input: {
	agentControllerRef?: string | null;
	controllerDisplayName?: string | null;
	modelCatalog?: ModelCatalog | null;
	modelSelection?: AgentProfileBindingModelSelection | null;
}): string | null {
	const controllerDisplayName = normalizeDisplayPart(
		input.controllerDisplayName
	);
	const effectiveModel = resolveEffectiveModel({
		agentControllerRef: input.agentControllerRef ?? null,
		modelCatalog: input.modelCatalog ?? null,
		modelSelection: input.modelSelection ?? null,
	});
	const reasoningDisplay = resolveReasoningDisplay({
		effectiveModel,
		modelSelection: input.modelSelection ?? null,
	});
	const parts = [
		controllerDisplayName,
		effectiveModel.modelId,
		reasoningDisplay,
	].filter((value): value is string => Boolean(value));
	return parts.length > 0 ? parts.join(" · ") : null;
}

function resolveEffectiveModel(input: {
	agentControllerRef: string | null;
	modelCatalog: ModelCatalog | null;
	modelSelection: AgentProfileBindingModelSelection | null;
}): {
	catalogModel: ModelCatalogModel | null;
	modelId: string | null;
} {
	const selectedModelId = normalizeDisplayPart(input.modelSelection?.modelId);
	const controllerCatalog = resolveControllerCatalog({
		agentControllerRef: input.agentControllerRef,
		modelCatalog: input.modelCatalog,
	});
	const modelId = selectedModelId ?? controllerCatalog?.defaultModelId ?? null;
	const catalogModel =
		controllerCatalog?.models.find((model) => model.id === modelId) ?? null;
	return { catalogModel, modelId };
}

function resolveReasoningDisplay(input: {
	effectiveModel: {
		catalogModel: ModelCatalogModel | null;
		modelId: string | null;
	};
	modelSelection: AgentProfileBindingModelSelection | null;
}): string | null {
	const selectedReasoningLevel = normalizeDisplayPart(
		input.modelSelection?.reasoningLevel
	);
	if (selectedReasoningLevel) {
		return selectedReasoningLevel;
	}
	if (!input.effectiveModel.modelId) {
		return null;
	}
	if (
		input.effectiveModel.catalogModel &&
		input.effectiveModel.catalogModel.supportedReasoningLevels.length === 0
	) {
		return null;
	}
	return MODEL_DEFAULT_REASONING_LABEL;
}

function resolveControllerCatalog(input: {
	agentControllerRef: string | null;
	modelCatalog: ModelCatalog | null;
}) {
	const parsedRef = parseAgentControllerRef(input.agentControllerRef);
	if (!parsedRef) {
		return null;
	}
	return input.modelCatalog?.agentControllers?.[parsedRef.id] ?? null;
}

function normalizeDisplayPart(value: string | null | undefined): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.length > 0 ? normalized : null;
}
