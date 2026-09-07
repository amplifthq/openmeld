import {
	getAgentControllerPermissionModeDisplayMetadata,
	listAgentControllerCollaborationModeOptions,
	resolveAgentControllerModelCompatibility,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerPermissionMode,
	ModelCatalog,
	ModelCatalogModel,
} from "@openmeld/schemas/types";
import type { NewProfileKind } from "#/lib/profiles/create-profile-flow";
import type {
	AgentProfileModelCompatibilityContext,
	CreateProfileFormProps,
} from "./create-profile-form";

const REASONING_LEVEL_SPLIT_PATTERN = /[-_]/u;
const WORKING_FOLDER_SEPARATOR_PATTERN = /[\\/]/u;
const WORKING_FOLDER_TRAILING_SEPARATOR_PATTERN = /[\\/]+$/u;

export type AgentProfileConfigurationSummaries = {
	collaboration: string | null;
	model: string;
	owner: string;
	permission: string;
	session: string;
	workingFolder: string;
};

export type ResolvedModelCompatibility = {
	knownIncompatible: boolean;
	message: string | null;
	status:
		| "catalog_unavailable"
		| "not_offered"
		| "requires_newer_controller"
		| "supported"
		| "unknown";
};

export function buildBuiltinAgentControllerRef(agentId: string): string {
	return `builtin:${agentId}`;
}

export function formatModelOptionLabel(
	model: ModelCatalogModel,
	defaultModelId: string
): string {
	if (model.unavailable) {
		return `${model.displayName} (unavailable)`;
	}
	return model.id === defaultModelId
		? `${model.displayName} (default)`
		: model.displayName;
}

export function formatReasoningLevelLabel(level: string): string {
	return level
		.split(REASONING_LEVEL_SPLIT_PATTERN)
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

export function resolveAgentProfileConfigurationSummaries(
	form: CreateProfileFormProps
): AgentProfileConfigurationSummaries {
	const controller = form.modelCatalog?.agentControllers[form.boundAgentId];
	const effectiveModelId =
		form.boundModelId || controller?.defaultModelId || "";
	const selectedModel = controller?.models.find(
		(model) => model.id === effectiveModelId
	);
	const modelSummary = selectedModel
		? formatModelOptionLabel(selectedModel, controller?.defaultModelId ?? "")
		: "Controller default";
	const reasoningSummary = form.boundReasoningLevel
		? formatReasoningLevelLabel(form.boundReasoningLevel)
		: "Model default";
	const collaborationOptions = listAgentControllerCollaborationModeOptions({
		agentControllerRef: buildBuiltinAgentControllerRef(form.boundAgentId),
	});
	const collaborationSummary =
		collaborationOptions.find(
			(option) => option.value === form.boundAgentControllerCollaborationMode
		)?.label ??
		collaborationOptions[0]?.label ??
		"Controller default";
	const permissionSummary = getAgentControllerPermissionModeDisplayMetadata(
		form.boundAgentControllerPermissionMode,
		{ agentControllerRef: buildBuiltinAgentControllerRef(form.boundAgentId) }
	).label;

	return {
		collaboration:
			collaborationOptions.length > 0 ? collaborationSummary : null,
		model: `${modelSummary} · ${reasoningSummary}`,
		owner: form.agentOwnershipSummary ?? "You",
		permission: permissionSummary,
		session: form.agentSessionSummary ?? "New session",
		workingFolder:
			form.projectSelectionSummary ??
			resolveProjectFolderCardSummary(form.projectFolderPath),
	};
}

export function resolveCreateProfileSubmitBlockReason(input: {
	additionalHumanProfileCreationEnabled: boolean;
	additionalSubmitBlockReason?: string | null;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	boundModelId: string;
	isResolvingAccount: boolean;
	profileKind: NewProfileKind | null;
	profileName: string;
	projectSelectionBlockReason?: string | null;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
}): string | null {
	if (input.profileKind === null) {
		return input.additionalHumanProfileCreationEnabled
			? "Choose a person or Agent Profile."
			: "Choose an Agent Profile.";
	}
	if (input.profileName.trim().length === 0) {
		return "Enter a profile name.";
	}
	if (input.isResolvingAccount) {
		return "Loading account profiles.";
	}
	if (input.additionalSubmitBlockReason) {
		return input.additionalSubmitBlockReason;
	}
	if (input.profileKind === "agent" && !input.boundAgentId) {
		return "Choose a local agent to continue. Connect a computer if none are available.";
	}
	if (input.projectSelectionBlockReason) {
		return input.projectSelectionBlockReason;
	}
	if (
		resolveSelectedModelCompatibility({
			agentId: input.boundAgentId,
			modelCatalog: input.modelCatalog,
			modelCompatibilityContext: input.modelCompatibilityContext,
			modelId: input.boundModelId,
		})?.knownIncompatible
	) {
		return `Choose a model available in ${input.modelCompatibilityContext?.controllerDisplayName ?? "this local agent"} on this computer.`;
	}
	if (requiresUnconfirmedAgentControllerPermissionMode(input)) {
		return "Confirm this permissions mode before creating the profile.";
	}
	return null;
}

export function resolveModelCompatibility(input: {
	controller: NonNullable<ModelCatalog["agentControllers"][string]>;
	context?: AgentProfileModelCompatibilityContext | null;
	modelId: string;
}): ResolvedModelCompatibility {
	const model = input.controller.models.find(
		(candidate) => candidate.id === input.modelId
	);
	const compatibility = resolveAgentControllerModelCompatibility({
		controller: input.controller,
		installedVersion: input.context?.installedVersion ?? null,
		modelId: input.modelId,
		reportedModelIds: input.context?.reportedModelIds ?? null,
	});
	if (compatibility.status === "not_offered") {
		return {
			knownIncompatible: true,
			message: `${model?.displayName ?? input.modelId} isn't available in ${input.context?.controllerDisplayName ?? "this local agent"} on this computer. Choose another model or update or change the installation.`,
			status: compatibility.status,
		};
	}
	if (compatibility.status === "requires_newer_controller") {
		return {
			knownIncompatible: true,
			message: `${model?.displayName ?? input.modelId} requires ${input.context?.controllerDisplayName ?? "this local agent"} ${compatibility.minimumVersion} or later. This computer has ${compatibility.currentVersion}. Choose another model or update or change the installation.`,
			status: compatibility.status,
		};
	}
	return {
		knownIncompatible: compatibility.status === "catalog_unavailable",
		message: null,
		status: compatibility.status,
	};
}

export function resolveSelectedModelCompatibility(input: {
	agentId: string;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	modelId: string;
}): ResolvedModelCompatibility | null {
	const controller = input.modelCatalog?.agentControllers[input.agentId];
	if (!controller) {
		return null;
	}
	return resolveModelCompatibility({
		controller,
		context:
			input.modelCompatibilityContext?.agentControllerId === input.agentId
				? input.modelCompatibilityContext
				: null,
		modelId: input.modelId || controller.defaultModelId,
	});
}

function requiresUnconfirmedAgentControllerPermissionMode(input: {
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	profileKind: NewProfileKind | null;
}): boolean {
	if (input.profileKind !== "agent" || !input.boundAgentId) {
		return false;
	}
	const metadata = getAgentControllerPermissionModeDisplayMetadata(
		input.boundAgentControllerPermissionMode,
		{ agentControllerRef: buildBuiltinAgentControllerRef(input.boundAgentId) }
	);
	return (
		metadata.requiresExplicitConfirmation &&
		!input.boundAgentControllerPermissionModeConfirmed
	);
}

function resolveProjectFolderCardSummary(projectFolderPath: string): string {
	const normalizedPath = projectFolderPath
		.trim()
		.replace(WORKING_FOLDER_TRAILING_SEPARATOR_PATTERN, "");
	if (!normalizedPath) {
		return "OpenMeld managed";
	}
	return (
		normalizedPath.split(WORKING_FOLDER_SEPARATOR_PATTERN).at(-1) ??
		normalizedPath
	);
}
