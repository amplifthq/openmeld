import type { ModelCatalog } from "@openmeld/schemas/types";

const REASONING_LEVEL_SPLIT_PATTERN = /[-_]/u;

export function buildAgentProfileTemplateName(input: {
	agentId: string;
	existingNames: readonly string[];
	localAgentDisplayName: string;
	modelCatalog: ModelCatalog | null;
	modelId: string;
	ownerDisplayName: string;
	reasoningLevel: string;
}): string {
	const ownerName = normalizeNamePart(input.ownerDisplayName);
	const localAgentName = normalizeNamePart(input.localAgentDisplayName);
	const modelName = resolveAgentProfileTemplateModelName({
		agentId: input.agentId,
		modelCatalog: input.modelCatalog,
		modelId: input.modelId,
	});
	const reasoningName = formatAgentProfileReasoningLevel(input.reasoningLevel);
	const baseName = [ownerName, localAgentName, modelName, reasoningName]
		.filter((part): part is string => Boolean(part))
		.join(" ");

	return resolveUniqueAgentProfileName({
		baseName: baseName || "Agent",
		existingNames: input.existingNames,
	});
}

export function resolveAgentProfileTemplateModelName(input: {
	agentId: string;
	modelCatalog: ModelCatalog | null;
	modelId: string;
}): string | null {
	const controller = input.modelCatalog?.agentControllers[input.agentId];
	if (!controller) {
		return normalizeNamePart(input.modelId);
	}
	const effectiveModelId = input.modelId || controller.defaultModelId;
	const model = controller.models.find(
		(candidate) => candidate.id === effectiveModelId
	);
	return normalizeNamePart(model?.displayName ?? effectiveModelId);
}

export function formatAgentProfileReasoningLevel(level: string): string | null {
	const normalized = normalizeNamePart(level);
	if (!normalized) {
		return null;
	}
	return normalized
		.split(REASONING_LEVEL_SPLIT_PATTERN)
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

export function resolveUniqueAgentProfileName(input: {
	baseName: string;
	existingNames: readonly string[];
}): string {
	const baseName = normalizeNamePart(input.baseName) || "Agent";
	const normalizedExistingNames = new Set<string>();
	for (const name of input.existingNames) {
		const normalizedName = normalizeComparableName(name);
		if (normalizedName) {
			normalizedExistingNames.add(normalizedName);
		}
	}
	if (!normalizedExistingNames.has(normalizeComparableName(baseName))) {
		return baseName;
	}

	let suffix = 1;
	while (
		normalizedExistingNames.has(
			normalizeComparableName(`${baseName} (${suffix})`)
		)
	) {
		suffix += 1;
	}
	return `${baseName} (${suffix})`;
}

function normalizeNamePart(value: string | null | undefined): string | null {
	const normalized = value?.trim().replace(/\s+/gu, " ") ?? "";
	return normalized.length > 0 ? normalized : null;
}

function normalizeComparableName(value: string): string {
	return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
