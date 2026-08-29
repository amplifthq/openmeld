import {
	createAgentProfileBindingApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	DisableAgentProfilePrimaryBindingResponse,
	EnsureAgentProfilePrimaryBindingResponse,
	GetAgentProfileControllerChangeEligibilityResponse,
	GetAgentProfilePrimaryBindingResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readAgentProfilePrimaryBinding(input: {
	agentProfileId: string;
	organizationId: string;
}): Promise<GetAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).getPrimaryBinding({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readAgentProfileControllerChangeEligibility(input: {
	agentProfileId: string;
	organizationId: string;
}): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			})
		).getControllerChangeEligibility({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateAgentProfilePrimaryBindingAgentControllerPermissionMode(input: {
	actorProfileId?: string | null;
	agentControllerPermissionMode: AgentControllerPermissionMode;
	agentProfileId: string;
	organizationId: string;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).updatePrimaryBindingAgentControllerPermissionMode({
			agentControllerPermissionMode: input.agentControllerPermissionMode,
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateAgentProfilePrimaryBindingAgentControllerCollaborationMode(input: {
	actorProfileId?: string | null;
	agentControllerCollaborationMode: AgentControllerCollaborationMode;
	agentProfileId: string;
	organizationId: string;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).updatePrimaryBindingAgentControllerCollaborationMode({
			agentControllerCollaborationMode: input.agentControllerCollaborationMode,
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateAgentProfilePrimaryBindingModelSelection(input: {
	actorProfileId?: string | null;
	agentProfileId: string;
	modelId: string;
	organizationId: string;
	reasoningLevel?: string | null;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).updatePrimaryBindingModelSelection({
			agentProfileId: input.agentProfileId,
			modelId: input.modelId,
			...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateAgentProfilePrimaryBindingOpenCodePermission(input: {
	actorProfileId?: string | null;
	agentProfileId: string;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	organizationId: string;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).updatePrimaryBindingOpenCodePermission({
			agentProfileId: input.agentProfileId,
			openCodePermission: input.openCodePermission,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function disableAgentProfilePrimaryBinding(input: {
	actorProfileId?: string | null;
	agentProfileId: string;
	organizationId: string;
}): Promise<DisableAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createOrganizationScopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
				organizationId: input.organizationId,
			})
		).disablePrimaryBinding({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
