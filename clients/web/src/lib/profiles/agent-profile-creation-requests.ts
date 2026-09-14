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

export type OptimisticAgentProfileCreation = {
	configuration: AgentProfileCreationConfiguration;
	failureMessage: string | null;
	id: string;
	profileName: string;
	status: "creating" | "failed";
	targetOwnerUserId: string;
};

function createApi(organizationId: string) {
	return createOrganizationApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

export async function createAgentProfileCreationRequest(input: {
	configuration: AgentProfileCreationConfiguration;
	idempotencyKey: string;
	nativeSessionId?: string | null;
	onAccepted?: (
		request: AgentProfileCreationRequest,
		optimisticId: string
	) => void | Promise<void>;
	onFailed?: (
		creation: OptimisticAgentProfileCreation,
		failure: AgentProfileCreationRequestsFailure
	) => void;
	onStarted?: (creation: OptimisticAgentProfileCreation) => void;
	organizationId: string;
	profileName: string;
	requestedSpaceId?: string | null;
	sessionStrategy?: "new" | "resume" | "fork";
	targetOwnerUserId: string;
}): Promise<CreateAgentProfileCreationRequestResponse> {
	const optimisticCreation: OptimisticAgentProfileCreation = {
		configuration: input.configuration,
		failureMessage: null,
		id: `optimistic:${input.idempotencyKey}`,
		profileName: input.profileName,
		status: "creating",
		targetOwnerUserId: input.targetOwnerUserId,
	};
	try {
		input.onStarted?.(optimisticCreation);
	} catch (error) {
		console.warn("Could not present the Agent being created.", error);
	}
	let result: CreateAgentProfileCreationRequestResponse;
	try {
		result = await createApi(
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
		const failure = toStructuredApiClientFailure(error);
		try {
			input.onFailed?.(
				{
					...optimisticCreation,
					failureMessage: failure.message,
					status: "failed",
				},
				failure
			);
		} catch (presentationError) {
			console.warn(
				"Could not present the failed Agent creation request.",
				presentationError
			);
		}
		throw failure;
	}

	try {
		await input.onAccepted?.(result.request, optimisticCreation.id);
	} catch (error) {
		// The server has already accepted the request. A local navigation or cache
		// failure must not turn that accepted request into a creation failure.
		console.warn(
			"Could not present the accepted Agent creation request.",
			error
		);
	}

	return { ...result, request: await waitForCreationResult(result.request) };
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
