import {
	resolveAgentControllerPermissionModeForController,
	resolveNativeAgentControllerCollaborationModeForController,
} from "@openmeld/agent-runtime";
import {
	createOrganizationApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { canonicalizeBuiltinAgentControllerRef } from "@openmeld/schemas";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	GetAgentProfileCreationDefaultsResponse,
	ModelCatalog,
	Project,
	SetAgentProfileCreationDefaultsResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function getAgentProfileCreationDefaults(input: {
	agentControllerRef: string;
	organizationId: string;
}): Promise<GetAgentProfileCreationDefaultsResponse> {
	try {
		return await createOrganizationApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).getAgentProfileCreationDefaults(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setAgentProfileCreationDefaults(input: {
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	agentControllerPermissionMode: AgentControllerPermissionMode | null;
	agentControllerRef: string;
	defaultProjectId: string | null;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	organizationId: string;
	reasoningLevel: string | null;
}): Promise<SetAgentProfileCreationDefaultsResponse> {
	try {
		return await createOrganizationApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).setAgentProfileCreationDefaults(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveRememberedAgentProfileCreationDefaults(input: {
	agentId: string;
	defaults: GetAgentProfileCreationDefaultsResponse;
	modelCatalog: ModelCatalog | null;
	projects: readonly Project[];
}): {
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	agentControllerPermissionMode: AgentControllerPermissionMode;
	agentControllerPermissionModeConfirmed: boolean;
	defaultProjectId: string | null;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	reasoningLevel: string | null;
} {
	const expectedAgentControllerRef = canonicalizeBuiltinAgentControllerRef(
		input.agentId
	);
	const defaultsMatchController =
		expectedAgentControllerRef === input.defaults.agentControllerRef;
	const controller = input.modelCatalog?.agentControllers[input.agentId];
	const model = controller?.models.find(
		(candidate) =>
			defaultsMatchController &&
			candidate.id === input.defaults.modelId &&
			!candidate.unavailable
	);
	const modelId = model?.id ?? null;
	const reasoningLevel = model?.supportedReasoningLevels.includes(
		input.defaults.reasoningLevel ?? ""
	)
		? input.defaults.reasoningLevel
		: null;
	const defaultProjectId = input.projects.some(
		(project) =>
			defaultsMatchController && project.id === input.defaults.defaultProjectId
	)
		? input.defaults.defaultProjectId
		: null;
	const agentControllerPermissionMode =
		resolveAgentControllerPermissionModeForController(
			defaultsMatchController
				? input.defaults.agentControllerPermissionMode
				: null,
			{ agentControllerRef: expectedAgentControllerRef }
		);

	return {
		agentControllerCollaborationMode: defaultsMatchController
			? (resolveNativeAgentControllerCollaborationModeForController(
					input.defaults.agentControllerCollaborationMode,
					{ agentControllerRef: expectedAgentControllerRef }
				) ?? null)
			: null,
		agentControllerPermissionMode,
		defaultProjectId,
		agentControllerPermissionModeConfirmed:
			defaultsMatchController &&
			input.defaults.updatedAt !== null &&
			input.defaults.agentControllerPermissionMode ===
				agentControllerPermissionMode,
		modelId,
		openCodePermission:
			defaultsMatchController && input.agentId === "opencode"
				? input.defaults.openCodePermission
				: null,
		reasoningLevel,
	};
}
