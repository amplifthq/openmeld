import type {
	AgentActivitySnapshotQuery,
	AgentActivitySnapshotResponse,
	AgentActivityStatsQuery,
	AgentActivityStatsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	type AgentActivityFailure,
	readCurrentAgentActivitySnapshot,
	readCurrentAgentActivityStats,
} from "#/lib/organizations/agent-activity";
import { baseQueryOptions } from "#/query/query-config";

export const agentActivityQueryKeys = {
	all: ["agent-activity"] as const,
	organization: (organizationId: string) =>
		[...agentActivityQueryKeys.all, organizationId] as const,
	snapshot: (organizationId: string, query: AgentActivitySnapshotQuery = {}) =>
		[
			...agentActivityQueryKeys.organization(organizationId),
			"snapshot",
			query,
		] as const,
	stats: (organizationId: string, query: AgentActivityStatsQuery = {}) =>
		[
			...agentActivityQueryKeys.organization(organizationId),
			"stats",
			query,
		] as const,
};

export function agentActivitySnapshotQueryOptions(
	input: {
		enabled?: boolean;
		organizationId: string;
	} & AgentActivitySnapshotQuery
) {
	const query = {
		...(input.includeProviderMetadata === true
			? { includeProviderMetadata: true }
			: {}),
		...(input.memberUserId ? { memberUserId: input.memberUserId } : {}),
		...(input.projectId ? { projectId: input.projectId } : {}),
		...(input.provider ? { provider: input.provider } : {}),
		...(input.status ? { status: input.status } : {}),
	};
	return queryOptions<AgentActivitySnapshotResponse, AgentActivityFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentAgentActivitySnapshot({
				...query,
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: agentActivityQueryKeys.snapshot(input.organizationId, query),
		refetchInterval: 15_000,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 5000,
	});
}
export function agentActivityStatsQueryOptions(
	input: {
		enabled?: boolean;
		organizationId: string;
	} & AgentActivityStatsQuery
) {
	const query = input.projectId ? { projectId: input.projectId } : {};
	return queryOptions<AgentActivityStatsResponse, AgentActivityFailure>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await readCurrentAgentActivityStats({
				...query,
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: agentActivityQueryKeys.stats(input.organizationId, query),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 5 * 60_000,
	});
}
