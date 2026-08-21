import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentProfileCreationApprovalPolicy,
	AgentProfileCreationConfiguration,
	AgentProfileCreationRequestMutationResponse,
	CreateAgentProfileCreationRequestResponse,
	GetAgentProfileCreationApprovalPreferenceResponse,
	ListAgentProfileCreationRequestsResponse,
	SetAgentProfileCreationApprovalPreferenceResponse,
} from "@openmeld/schemas/types";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type AgentProfileCreationRequestsFailure = StructuredApiClientFailure;

function createApi(organizationId: string) {
	return createOrganizationApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function createAgentProfileCreationRequest(input: {
	configuration: AgentProfileCreationConfiguration;
	idempotencyKey: string;
	nativeSessionId?: string | null;
	organizationId: string;
	profileName: string;
	requestedSpaceId?: string | null;
	sessionStrategy?: "new" | "resume" | "fork";
	targetOwnerUserId: string;
}): Promise<CreateAgentProfileCreationRequestResponse> {
	try {
		return await createApi(
			input.organizationId
		).createAgentProfileCreationRequest({
			configuration: input.configuration,
			idempotencyKey: input.idempotencyKey,
			nativeSessionId: input.nativeSessionId,
			organizationId: input.organizationId,
			profileName: input.profileName,
			requestedSpaceId: input.requestedSpaceId,
			sessionStrategy: input.sessionStrategy ?? "new",
			source: "web",
			targetOwnerUserId: input.targetOwnerUserId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listAgentProfileCreationRequests(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListAgentProfileCreationRequestsResponse> {
	try {
		return await createApi(
			input.organizationId
		).listAgentProfileCreationRequests({
			organizationId: input.organizationId,
			signal: input.signal,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function decideAgentProfileCreationRequest(input: {
	decision: "approve" | "decline";
	organizationId: string;
	requestId: string;
}): Promise<AgentProfileCreationRequestMutationResponse> {
	try {
		return await createApi(
			input.organizationId
		).decideAgentProfileCreationRequest(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function cancelAgentProfileCreationRequest(input: {
	organizationId: string;
	requestId: string;
}): Promise<AgentProfileCreationRequestMutationResponse> {
	try {
		return await createApi(
			input.organizationId
		).cancelAgentProfileCreationRequest(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function retryAgentProfileCreationRequest(input: {
	organizationId: string;
	requestId: string;
}): Promise<AgentProfileCreationRequestMutationResponse> {
	try {
		return await createApi(
			input.organizationId
		).retryAgentProfileCreationRequest(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function getAgentProfileCreationApprovalPreference(input: {
	organizationId: string;
}): Promise<GetAgentProfileCreationApprovalPreferenceResponse> {
	try {
		return await createApi(
			input.organizationId
		).getAgentProfileCreationApprovalPreference(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function setAgentProfileCreationApprovalPreference(input: {
	existingSessionPolicy: AgentProfileCreationApprovalPolicy;
	newSessionPolicy: AgentProfileCreationApprovalPolicy;
	organizationId: string;
}): Promise<SetAgentProfileCreationApprovalPreferenceResponse> {
	try {
		return await createApi(
			input.organizationId
		).setAgentProfileCreationApprovalPreference(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
