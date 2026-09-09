import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	AgentProfileCreationApprovalPolicy,
	AgentProfileCreationConfiguration,
	AgentProfileCreationRequest,
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
		const result = await createApi(
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
		return { ...result, request: await waitForCreationResult(result.request) };
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

async function waitForCreationResult(
	initial: AgentProfileCreationRequest
): Promise<AgentProfileCreationRequest> {
	let current = initial;
	const deadline = Date.now() + 60_000;
	let delayMs = 1000;
	while (current.status === "approved" && Date.now() < deadline) {
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(delayMs, deadline - Date.now()))
		);
		if (Date.now() >= deadline) {
			break;
		}
		try {
			const response = await createApi(
				initial.organizationId
			).listAgentProfileCreationRequests({
				organizationId: initial.organizationId,
				requestId: initial.id,
				timeoutMs: Math.max(1, Math.min(10_000, deadline - Date.now())),
			});
			current =
				response.requests.find((request) => request.id === initial.id) ??
				current;
		} catch (error) {
			// Losing a status read cannot turn the accepted creation into a failure.
			console.warn(
				"Could not refresh the accepted Agent creation request.",
				toStructuredApiClientFailure(error).code
			);
			return current;
		}
		delayMs = Math.min(5000, delayMs + 1000);
	}
	return current;
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
		const result = await createApi(
			input.organizationId
		).retryAgentProfileCreationRequest(input);
		return { request: await waitForCreationResult(result.request) };
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
