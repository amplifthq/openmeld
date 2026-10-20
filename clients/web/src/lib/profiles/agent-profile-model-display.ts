import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { isHostedAgentControllerRef } from "@openmeld/schemas";
import type {
	AgentProfileBindingModelSelection,
	ModelCatalog,
	ModelCatalogModel,
} from "@openmeld/schemas/types";

import { formatAgentProfileReasoningLevel } from "./agent-profile-template-name";

const MODEL_DEFAULT_REASONING_LABEL = "model default";

export function resolveAgentProfileControllerModelDetail(input: {
	agentControllerRef?: string | null;
	controllerDisplayName?: string | null;
	modelCatalog?: ModelCatalog | null;
	modelSelection?: AgentProfileBindingModelSelection | null;
}): string | null {
	const controllerDisplayName = normalizeDisplayPart(
		isHostedAgentControllerRef(input.agentControllerRef)
			? "Remote"
			: input.controllerDisplayName
	);
	// With no saved model the harness picks one, which may not be the
	// catalog default: name only the controller, with no jargon.
	if (
		input.agentControllerRef &&
		!isHostedAgentControllerRef(input.agentControllerRef) &&
		!normalizeDisplayPart(input.modelSelection?.modelId)
	) {
		return controllerDisplayName;
	}
	const effectiveModel = resolveAgentProfileModel({
		agentControllerRef: input.agentControllerRef ?? null,
		modelCatalog: input.modelCatalog ?? null,
		modelSelection: input.modelSelection ?? null,
	});
	const reasoningDisplay = resolveReasoningDisplay({
		effectiveModel,
		modelSelection: input.modelSelection ?? null,
	});
	const modelDisplayName =
		normalizeDisplayPart(effectiveModel.catalogModel?.displayName) ??
		effectiveModel.modelId;
	const parts = [
		controllerDisplayName,
		modelDisplayName,
		reasoningDisplay,
	].filter((value): value is string => Boolean(value));
	return parts.length > 0 ? parts.join(" · ") : null;
}

export function resolveAgentProfileModel(input: {
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
	return (
		input.modelCatalog?.agentControllers?.[
			isHostedAgentControllerRef(input.agentControllerRef)
				? "center-agent"
				: parsedRef.id
		] ?? null
	);
}

function normalizeDisplayPart(value: string | null | undefined): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.length > 0 ? normalized : null;
}

/**
 * The Model card's value: the model and reasoning a new chat uses, without the
 * controller name. With no saved reasoning the harness picks its own, which
 * local harnesses do not report, so the value names only the model.
 */
export function resolveAgentProfileModelCardValue(input: {
	agentControllerRef: string | null;
	modelCatalog: ModelCatalog | null;
	modelSelection: AgentProfileBindingModelSelection | null;
}): { value: string } | null {
	const effectiveModel = resolveAgentProfileModel(input);
	const modelDisplayName =
		normalizeDisplayPart(effectiveModel.catalogModel?.displayName) ??
		effectiveModel.modelId;
	if (!modelDisplayName) {
		return null;
	}
	const reasoningLevel = normalizeDisplayPart(
		input.modelSelection?.reasoningLevel
	);
	return {
		value: [
			modelDisplayName,
			reasoningLevel ? formatAgentProfileReasoningLevel(reasoningLevel) : null,
		]
			.filter(Boolean)
			.join(" · "),
	};
}
