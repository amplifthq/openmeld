import type {
	ListCenterAgentRoutineRunsResponse,
	ListCenterAgentRoutinesManagementResponse,
	ListCenterAgentRoutineTargetSpacesResponse,
} from "@openmeld/schemas/types";
import {
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	type CenterAgentRoutinesFailure,
	listCurrentCenterAgentRoutineRuns,
	listCurrentCenterAgentRoutines,
	listCurrentCenterAgentRoutineTargetSpaces,
} from "#/lib/organizations/center-agent-routines";
import { centerAgentDirectMessageOpenQueryOptions } from "#/query/organizations/center-agent";
import { baseQueryOptions } from "#/query/query-config";

export const centerAgentRoutineQueryKeys = {
	all: ["center-agent-routines"] as const,
	organization: (organizationId: string) =>
		[...centerAgentRoutineQueryKeys.all, organizationId] as const,
	list: (organizationId: string) =>
		[
			...centerAgentRoutineQueryKeys.organization(organizationId),
			"list",
		] as const,
	targetSpaces: (organizationId: string) =>
		[
			...centerAgentRoutineQueryKeys.organization(organizationId),
			"target-spaces",
		] as const,
	runs: (organizationId: string, routineId: string) =>
		[
			...centerAgentRoutineQueryKeys.organization(organizationId),
			"runs",
			routineId,
		] as const,
};

export const CENTER_AGENT_ROUTINE_RUN_PAGE_LIMIT = 5;

export function centerAgentRoutinesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListCenterAgentRoutinesManagementResponse,
		CenterAgentRoutinesFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentCenterAgentRoutines({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentRoutineQueryKeys.list(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function centerAgentRoutineTargetSpacesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListCenterAgentRoutineTargetSpacesResponse,
		CenterAgentRoutinesFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentCenterAgentRoutineTargetSpaces({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: centerAgentRoutineQueryKeys.targetSpaces(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export async function prepareCenterAgentRoutineTargetSpaces(input: {
	organizationId: string;
	queryClient: QueryClient;
}): Promise<ListCenterAgentRoutineTargetSpacesResponse> {
	await input.queryClient.fetchQuery({
		...centerAgentDirectMessageOpenQueryOptions({
			organizationId: input.organizationId,
		}),
		staleTime: 0,
	});
	return await input.queryClient.fetchQuery({
		...centerAgentRoutineTargetSpacesQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		}),
		staleTime: 0,
	});
}

export function centerAgentRoutineRunsInfiniteQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	routineId: string;
}) {
	return infiniteQueryOptions({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		getNextPageParam: (lastPage: ListCenterAgentRoutineRunsResponse) =>
			lastPage.runs.length === CENTER_AGENT_ROUTINE_RUN_PAGE_LIMIT
				? lastPage.runs.at(-1)?.scheduledFor
				: undefined,
		initialPageParam: undefined as number | undefined,
		queryFn: async ({
			pageParam,
			signal,
		}: {
			pageParam: number | undefined;
			signal: AbortSignal;
		}) =>
			await listCurrentCenterAgentRoutineRuns({
				...(pageParam === undefined ? {} : { beforeScheduledFor: pageParam }),
				limit: CENTER_AGENT_ROUTINE_RUN_PAGE_LIMIT,
				organizationId: input.organizationId,
				routineId: input.routineId,
				signal,
			}),
		queryKey: centerAgentRoutineQueryKeys.runs(
			input.organizationId,
			input.routineId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export async function invalidateCenterAgentRoutineFacts(input: {
	organizationId: string;
	queryClient: QueryClient;
	routineId?: string;
}): Promise<void> {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: centerAgentRoutineQueryKeys.list(input.organizationId),
		}),
		...(input.routineId
			? [
					input.queryClient.invalidateQueries({
						queryKey: centerAgentRoutineQueryKeys.runs(
							input.organizationId,
							input.routineId
						),
					}),
				]
			: []),
	]);
}
