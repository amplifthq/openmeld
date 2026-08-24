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
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readAgentProfilePrimaryBinding(input: {
	agentProfileId: string;
}): Promise<GetAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation()
		).getPrimaryBinding({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readAgentProfileControllerChangeEligibility(input: {
	agentProfileId: string;
}): Promise<GetAgentProfileControllerChangeEligibilityResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation()
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
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
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
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
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
	reasoningLevel?: string | null;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
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
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
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
}): Promise<DisableAgentProfilePrimaryBindingResponse> {
	try {
		return await createAgentProfileBindingApi(
			createUnscopedWebOpenMeldApiFoundation({
				...(input.actorProfileId
					? { openMeldProfileId: input.actorProfileId }
					: {}),
			})
		).disablePrimaryBinding({
			agentProfileId: input.agentProfileId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
