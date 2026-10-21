import { createAgentAccessApi } from "@openmeld/api-client";
import type {
	AgentAccessDecision,
	AgentAccessRequestView,
	AgentProfileAccessGrantView,
	ListAgentAccessRequestsQuery,
} from "@openmeld/schemas";
import {
	type QueryClient,
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { invalidateInboxFacts } from "./organizations/inbox";

// Agent owner consent requests and grants (member-agent-program.md §4.6).
// Core owns their state; Web reads it and polls while a request is open.

const PENDING_REFETCH_MS = 15_000;

export const agentAccessQueryKeys = {
	all: (organizationId: string) => ["agent-access", organizationId] as const,
	request: (organizationId: string, requestId: string) =>
		[
			...agentAccessQueryKeys.all(organizationId),
			"request",
			requestId,
		] as const,
	list: (organizationId: string, query: ListAgentAccessRequestsQuery) =>
		[...agentAccessQueryKeys.all(organizationId), "list", query] as const,
	grants: (organizationId: string, profileId: string) =>
		[...agentAccessQueryKeys.all(organizationId), "grants", profileId] as const,
	viewerGrants: (organizationId: string) =>
		[...agentAccessQueryKeys.all(organizationId), "viewer-grants"] as const,
};

function agentAccessApi(organizationId: string) {
	return createAgentAccessApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

function hasPendingRequest(requests: readonly AgentAccessRequestView[] = []) {
	return requests.some((request) => request.status === "pending");
}

/** Every request and grant view, in any Organization, after a live change. */
export function invalidateAgentAccessQueries(queryClient: QueryClient): void {
	queryClient
		.invalidateQueries({ queryKey: ["agent-access"] })
		.catch((error: unknown) =>
			console.warn("Failed to refresh Agent requests.", error)
		);
}

async function invalidateAgentAccess(input: {
	organizationId: string;
	queryClient: QueryClient;
}) {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: agentAccessQueryKeys.all(input.organizationId),
		}),
		invalidateInboxFacts(input),
	]);
}

export function useAgentAccessRequest(requestId: string) {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useQuery({
		queryKey: agentAccessQueryKeys.request(organizationId, requestId),
		enabled: Boolean(organizationId) && isMemberAgentsEnabled(),
		queryFn: async () =>
			(await agentAccessApi(organizationId).get(requestId)).request,
		retry: false,
		refetchInterval: (query) =>
			query.state.data?.status === "pending" ? PENDING_REFETCH_MS : false,
	});
}

/** Requests the viewer can see, as owner or requester, optionally for one Space. */
export function useAgentAccessRequests(
	query: ListAgentAccessRequestsQuery,
	options: { enabled?: boolean } = {}
) {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useQuery({
		queryKey: agentAccessQueryKeys.list(organizationId, query),
		enabled:
			(options.enabled ?? true) &&
			Boolean(organizationId) &&
			isMemberAgentsEnabled(),
		queryFn: async () =>
			(await agentAccessApi(organizationId).list(query)).requests,
		staleTime: 10_000,
		refetchInterval: (current) =>
			hasPendingRequest(current.state.data) ? PENDING_REFETCH_MS : false,
		refetchIntervalInBackground: false,
	});
}

export function useDecideAgentAccessRequest() {
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useMutation({
		mutationFn: async (input: {
			requestId: string;
			decision: AgentAccessDecision;
		}) =>
			await agentAccessApi(organizationId).decide(
				input.requestId,
				input.decision
			),
		retry: false,
		onSuccess: (response) => {
			queryClient.setQueryData(
				agentAccessQueryKeys.request(organizationId, response.request.id),
				response.request
			);
		},
		onSettled: async () =>
			await invalidateAgentAccess({ organizationId, queryClient }),
	});
}

export function useWithdrawAgentAccessRequest() {
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useMutation({
		mutationFn: async (requestId: string) =>
			await agentAccessApi(organizationId).withdraw(requestId),
		retry: false,
		onSettled: async () =>
			await invalidateAgentAccess({ organizationId, queryClient }),
	});
}

export function useRequestAgentForSpace() {
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useMutation({
		mutationFn: async (input: {
			spaceId: string;
			agentProfileId: string;
			signalId?: string;
		}) => await agentAccessApi(organizationId).requestForSpace(input),
		retry: false,
		onSettled: async () =>
			await invalidateAgentAccess({ organizationId, queryClient }),
	});
}

/** Owner-only: who may use this Agent Profile without asking. */
export function agentProfileAccessGrantsQueryOptions(input: {
	organizationId: string;
	profileId: string;
	enabled?: boolean;
}) {
	return queryOptions({
		queryKey: agentAccessQueryKeys.grants(
			input.organizationId,
			input.profileId
		),
		enabled:
			(input.enabled ?? true) &&
			Boolean(input.organizationId && input.profileId) &&
			isMemberAgentsEnabled(),
		queryFn: async () =>
			(await agentAccessApi(input.organizationId).listGrants(input.profileId))
				.grants,
		retry: false,
	});
}

/** Profile IDs of colleagues' Agents the viewer may use without asking. */
export function useViewerAgentAccessGrants() {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useQuery({
		queryKey: agentAccessQueryKeys.viewerGrants(organizationId),
		enabled: Boolean(organizationId) && isMemberAgentsEnabled(),
		queryFn: async () =>
			(await agentAccessApi(organizationId).listViewerGrants()).grants.map(
				(grant) => grant.profileId
			),
		retry: false,
		staleTime: 30_000,
	});
}

/**
 * Owner-only: removes grants one by one; anything already running
 * finishes. Core broadcasts each change to the Spaces it concerns.
 */
export function useRevokeAgentAccessGrants() {
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useMutation({
		mutationFn: async (
			grants: readonly Pick<AgentProfileAccessGrantView, "id" | "profileId">[]
		) => {
			const api = agentAccessApi(organizationId);
			for (const grant of grants) {
				await api.revokeGrant(grant.profileId, grant.id);
			}
		},
		retry: false,
		onSettled: async () =>
			await invalidateAgentAccess({ organizationId, queryClient }),
	});
}

/** Owner-only: always allows a member, for example after Allow once. */
export function useAlwaysAllowAgentAccess() {
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	return useMutation({
		mutationFn: async (input: { profileId: string; granteeUserId: string }) =>
			await agentAccessApi(organizationId).alwaysAllow(
				input.profileId,
				input.granteeUserId
			),
		retry: false,
		onSettled: async () =>
			await invalidateAgentAccess({ organizationId, queryClient }),
	});
}
