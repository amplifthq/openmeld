import type {
	CenterAgentModelConfigurationResponse,
	CenterAgentOrganizationMemoryPolicyResponse,
	GetCenterAgentDesignationResponse,
	GetCenterAgentDirectMessageSpaceProjectionResponse,
	GetCenterAgentOperatingStateResponse,
	ListCenterAgentAuditJournalResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	type CenterAgentFailure,
	listCurrentCenterAgentAuditJournal,
	openCurrentCenterAgentDirectMessageSpace,
	readCurrentCenterAgentDesignation,
	readCurrentCenterAgentDirectMessageSpaceProjection,
	readCurrentCenterAgentModel,
	readCurrentCenterAgentOperatingState,
} from "#/lib/organizations/center-agent";
import { readCurrentOrganizationCenterAgentMemoryPolicy } from "#/lib/organizations/center-agent-memory";
import {
	baseQueryOptions,
	ROUTE_REVISIT_GC_TIME_MS,
} from "#/query/query-config";

const CENTER_AGENT_DIRECT_MESSAGE_STALE_TIME_MS = 5 * 60 * 1000;

export const centerAgentQueryKeys = {
	all: ["center-agent"] as const,
	designation: (organizationId: string) =>
		[...centerAgentQueryKeys.all, organizationId, "designation"] as const,
	operatingState: (organizationId: string) =>
		[...centerAgentQueryKeys.all, organizationId, "operating-state"] as const,
	model: (organizationId: string) =>
		[...centerAgentQueryKeys.all, organizationId, "model"] as const,
	directMessageSpaceProjection: (organizationId: string, spaceId?: string) =>
		[
			...centerAgentQueryKeys.all,
			organizationId,
			"dm-space-projection",
			...(spaceId === undefined ? [] : ["session", spaceId]),
		] as const,
	directMessageSpaceOpen: (organizationId: string) =>
		[...centerAgentQueryKeys.all, organizationId, "dm-space-open"] as const,
	auditJournal: (organizationId: string) =>
		[...centerAgentQueryKeys.all, organizationId, "audit-journal"] as const,
	memoryPolicy: (organizationId: string) =>
		[...centerAgentQueryKeys.all, organizationId, "memory-policy"] as const,
};

export function centerAgentDirectMessageOpenQueryOptions(input: {
	organizationId: string;
}) {
	return queryOptions({
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) => {
			const response = await openCurrentCenterAgentDirectMessageSpace({
				organizationId: input.organizationId,
				signal,
			});
			if (response.organizationId !== input.organizationId) {
				const message = `Center Agent DM identity mismatch: expected organization ${input.organizationId}, received ${response.organizationId}.`;
				throw Object.assign(new Error(message), {
					code: "gateway.invalid_response" as const,
					requestId: null,
					schemaIssueMessage: message,
					schemaIssuePath: "organizationId",
					status: 200,
					upstreamCode: null,
				});
			}
			return response;
		},
		queryKey: centerAgentQueryKeys.directMessageSpaceOpen(input.organizationId),
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: CENTER_AGENT_DIRECT_MESSAGE_STALE_TIME_MS,
	});
}

export function centerAgentDesignationQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<GetCenterAgentDesignationResponse, CenterAgentFailure>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentCenterAgentDesignation({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentQueryKeys.designation(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function centerAgentOperatingStateQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<GetCenterAgentOperatingStateResponse, CenterAgentFailure>(
		{
			enabled: input.enabled,
			gcTime: baseQueryOptions.gcTime,
			queryFn: async ({ signal }) =>
				await readCurrentCenterAgentOperatingState({
					organizationId: input.organizationId,
					signal,
				}),
			queryKey: centerAgentQueryKeys.operatingState(input.organizationId),
			refetchOnWindowFocus: false,
			retry: baseQueryOptions.retry,
			staleTime: 10_000,
		}
	);
}

export function centerAgentModelQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		CenterAgentModelConfigurationResponse,
		CenterAgentFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentCenterAgentModel({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentQueryKeys.model(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function centerAgentDirectMessageSpaceProjectionQueryOptions(input: {
	spaceId?: string;
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		GetCenterAgentDirectMessageSpaceProjectionResponse,
		CenterAgentFailure
	>({
		enabled: input.enabled,
		gcTime: ROUTE_REVISIT_GC_TIME_MS,
		queryFn: async ({ signal }) =>
			await readCurrentCenterAgentDirectMessageSpaceProjection({
				...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentQueryKeys.directMessageSpaceProjection(
			input.organizationId,
			input.spaceId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: CENTER_AGENT_DIRECT_MESSAGE_STALE_TIME_MS,
	});
}

export function centerAgentAuditJournalQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<ListCenterAgentAuditJournalResponse, CenterAgentFailure>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentCenterAgentAuditJournal({
				limit: 25,
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentQueryKeys.auditJournal(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function centerAgentMemoryPolicyQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<CenterAgentOrganizationMemoryPolicyResponse>({
		enabled: input.enabled,
		queryFn: async () =>
			await readCurrentOrganizationCenterAgentMemoryPolicy({
				organizationId: input.organizationId,
			}),
		queryKey: centerAgentQueryKeys.memoryPolicy(input.organizationId),
		refetchOnWindowFocus: false,
		retry: 1,
		staleTime: 30_000,
	});
}
