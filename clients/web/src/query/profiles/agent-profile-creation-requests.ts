import type {
	AgentProfileCreationRequest,
	GetAgentProfileCreationApprovalPreferenceResponse,
	ListAgentProfileCreationRequestsResponse,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { queryOptions, skipToken } from "@tanstack/react-query";
import {
	clearAgentCreationIntent,
	readAgentCreationIntent,
	rememberAgentCreationIntent,
} from "#/lib/profiles/agent-creation-intent";
import {
	type AgentProfileCreationRequestsFailure,
	createAgentProfileCreationRequest,
	getAgentProfileCreationApprovalPreference,
	listAgentProfileCreationRequests,
	type OptimisticAgentProfileCreation,
	readAgentProfileCreationRequest,
} from "#/lib/profiles/agent-profile-creation-requests";
import {
	baseQueryOptions,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";

export const agentProfileCreationRequestQueryKeys = {
	all: ["agent-profile-creation-requests"] as const,
	request: (organizationId: string, requestId: string) =>
		["agent-profile-creation-request", organizationId, requestId] as const,
	byIntent: (organizationId: string, idempotencyKey: string) =>
		["agent-profile-creation-intent", organizationId, idempotencyKey] as const,
	byOrganization: (organizationId: string) =>
		[...agentProfileCreationRequestQueryKeys.all, organizationId] as const,
	optimisticByOrganization: (organizationId: string) =>
		[
			...agentProfileCreationRequestQueryKeys.byOrganization(organizationId),
			"optimistic",
		] as const,
	preference: (organizationId: string) =>
		[
			...agentProfileCreationRequestQueryKeys.byOrganization(organizationId),
			"preference",
		] as const,
} as const;

export function agentProfileCreationRequestQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	requestId: string;
}) {
	return queryOptions<
		AgentProfileCreationRequest | null,
		AgentProfileCreationRequestsFailure
	>({
		enabled: input.enabled,
		queryFn: async () =>
			await readAgentProfileCreationRequest({
				organizationId: input.organizationId,
				requestId: input.requestId,
			}),
		queryKey: agentProfileCreationRequestQueryKeys.request(
			input.organizationId,
			input.requestId
		),
		refetchInterval: (query) =>
			query.state.data === null ||
			query.state.data?.status === "approved" ||
			query.state.data?.status === "pending"
				? 2000
				: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 1000,
	});
}

// Keep the exact unacknowledged intent across the optimistic route unmount.
// A lost response is not evidence that Core did not create the Agent.
export async function createPresentedAgentProfileCreationRequest({
	queryClient,
	...input
}: Parameters<typeof createAgentProfileCreationRequest>[0] & {
	queryClient: QueryClient;
	intentStorageScope?: string;
	clearIntentOnAcceptance?: boolean;
}) {
	if (!input.onStarted) {
		return await createAgentProfileCreationRequest(input);
	}
	const requestFingerprint = JSON.stringify([
		input.organizationId,
		input.targetOwnerUserId,
		input.profileName,
		input.configuration,
		input.nativeSessionId ?? null,
		input.requestedSpaceId ?? null,
		input.sessionStrategy ?? "new",
	]);
	const previous = queryClient
		.getQueryData<readonly OptimisticAgentProfileCreation[]>(
			agentProfileCreationRequestQueryKeys.optimisticByOrganization(
				input.organizationId
			)
		)
		?.find((creation) => creation.requestFingerprint === requestFingerprint);
	const persisted = input.intentStorageScope
		? readAgentCreationIntent(input.intentStorageScope, input.organizationId)
		: null;
	const idempotencyKey =
		previous?.id.slice("optimistic:".length) ??
		(persisted?.fingerprint === requestFingerprint
			? persisted.idempotencyKey
			: input.idempotencyKey);
	const present = (creation: OptimisticAgentProfileCreation) =>
		upsertOptimisticAgentProfileCreation({
			...input,
			queryClient,
			creation: { ...creation, requestFingerprint },
		});
	const result = await createAgentProfileCreationRequest({
		...input,
		idempotencyKey,
		onStarted: (creation) => {
			if (input.intentStorageScope) {
				rememberAgentCreationIntent({
					fingerprint: requestFingerprint,
					idempotencyKey,
					organizationId: input.organizationId,
					profileName: input.profileName,
					scope: input.intentStorageScope,
				});
			}
			present(creation);
			input.onStarted?.(creation);
		},
		onFailed: (creation, failure) => {
			present(creation);
			input.onFailed?.(creation, failure);
		},
		onAccepted: async (request, optimisticId) => {
			if (input.intentStorageScope && input.clearIntentOnAcceptance !== false) {
				clearAgentCreationIntent({
					idempotencyKey,
					organizationId: input.organizationId,
					scope: input.intentStorageScope,
				});
			}
			upsertAcceptedAgentProfileCreationRequest({
				...input,
				queryClient,
				request,
			});
			removeOptimisticAgentProfileCreation({
				...input,
				queryClient,
				id: optimisticId,
			});
			await input.onAccepted?.(request, optimisticId);
		},
	});
	if (input.waitForCompletion !== false) {
		upsertAcceptedAgentProfileCreationRequest({
			...input,
			queryClient,
			request: result.request,
		});
	}
	return result;
}

export function optimisticAgentProfileCreationsQueryOptions(
	organizationId: string
) {
	return queryOptions<readonly OptimisticAgentProfileCreation[]>({
		queryFn: skipToken,
		gcTime: Number.POSITIVE_INFINITY,
		queryKey:
			agentProfileCreationRequestQueryKeys.optimisticByOrganization(
				organizationId
			),
	});
}

export function upsertOptimisticAgentProfileCreation(input: {
	creation: OptimisticAgentProfileCreation;
	organizationId: string;
	queryClient: QueryClient;
}): void {
	input.queryClient.setQueryData<readonly OptimisticAgentProfileCreation[]>(
		agentProfileCreationRequestQueryKeys.optimisticByOrganization(
			input.organizationId
		),
		(current = []) => [
			input.creation,
			...current.filter((creation) => creation.id !== input.creation.id),
		]
	);
}

export function removeOptimisticAgentProfileCreation(input: {
	id: string;
	organizationId: string;
	queryClient: QueryClient;
}): void {
	input.queryClient.setQueryData<readonly OptimisticAgentProfileCreation[]>(
		agentProfileCreationRequestQueryKeys.optimisticByOrganization(
			input.organizationId
		),
		(current = []) => current.filter((creation) => creation.id !== input.id)
	);
}

export function upsertAcceptedAgentProfileCreationRequest(input: {
	organizationId: string;
	queryClient: QueryClient;
	request: AgentProfileCreationRequest;
}): void {
	input.queryClient.setQueryData<ListAgentProfileCreationRequestsResponse>(
		agentProfileCreationRequestQueryKeys.byOrganization(input.organizationId),
		(current) => {
			if (!current) {
				return {
					organizationId: input.organizationId,
					requests: [input.request],
				};
			}
			return {
				...current,
				requests: [
					input.request,
					...current.requests.filter(
						(request) => request.id !== input.request.id
					),
				],
			};
		}
	);
}

export function agentProfileCreationRequestsQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListAgentProfileCreationRequestsResponse,
		AgentProfileCreationRequestsFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await listAgentProfileCreationRequests({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
			input.organizationId
		),
		refetchOnWindowFocus: true,
		refetchInterval: (query) =>
			query.state.data?.requests.some(
				(request) => request.status === "approved"
			)
				? 5000
				: false,
		retry: baseQueryOptions.retry,
		staleTime: 5000,
	});
}

export function agentProfileCreationApprovalPreferenceQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		GetAgentProfileCreationApprovalPreferenceResponse,
		AgentProfileCreationRequestsFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async () =>
			await getAgentProfileCreationApprovalPreference({
				organizationId: input.organizationId,
			}),
		queryKey: agentProfileCreationRequestQueryKeys.preference(
			input.organizationId
		),
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
