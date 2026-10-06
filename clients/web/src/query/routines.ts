import type {
	ListCenterAgentRoutineRunsResponse,
	ListCenterAgentRoutineTargetSpacesResponse,
	ListRoutineManagementResponse,
} from "@openmeld/schemas/types";
import {
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import {
	listCurrentRoutineRuns,
	listCurrentRoutines,
	listCurrentRoutineTargetSpaces,
	type RoutinesFailure,
} from "#/lib/routines/api";
import { organizationUsageQueryKeys } from "#/query/organizations/organization-usage";
import { baseQueryOptions } from "#/query/query-config";

export const routineQueryKeys = {
	all: ["routines"] as const,
	organization: (organizationId: string) =>
		[...routineQueryKeys.all, organizationId] as const,
	list: (organizationId: string) =>
		[...routineQueryKeys.organization(organizationId), "list"] as const,
	targetSpaces: (organizationId: string, agentProfileId?: string) =>
		[
			...routineQueryKeys.organization(organizationId),
			"target-spaces",
			agentProfileId ?? "center",
		] as const,
	runs: (organizationId: string, routineId: string) =>
		[
			...routineQueryKeys.organization(organizationId),
			"runs",
			routineId,
		] as const,
};

export const ROUTINE_RUN_PAGE_LIMIT = 5;

export function routinesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
}) {
	return queryOptions<ListRoutineManagementResponse, RoutinesFailure>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentRoutines({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: routineQueryKeys.list(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function routineTargetSpacesQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	agentProfileId?: string;
}) {
	return queryOptions<
		ListCenterAgentRoutineTargetSpacesResponse,
		RoutinesFailure
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentRoutineTargetSpaces({
				organizationId: input.organizationId,
				agentProfileId: input.agentProfileId,
				signal,
			}),
		queryKey: routineQueryKeys.targetSpaces(
			input.organizationId,
			input.agentProfileId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function routineRunsInfiniteQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	routineId: string;
}) {
	return infiniteQueryOptions({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		getNextPageParam: (lastPage: ListCenterAgentRoutineRunsResponse) =>
			lastPage.runs.length === ROUTINE_RUN_PAGE_LIMIT
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
			await listCurrentRoutineRuns({
				...(pageParam === undefined ? {} : { beforeScheduledFor: pageParam }),
				limit: ROUTINE_RUN_PAGE_LIMIT,
				organizationId: input.organizationId,
				routineId: input.routineId,
				signal,
			}),
		queryKey: routineQueryKeys.runs(input.organizationId, input.routineId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export async function invalidateRoutineFacts(input: {
	organizationId: string;
	queryClient: QueryClient;
	routineId?: string;
}): Promise<void> {
	await Promise.all([
		input.queryClient.invalidateQueries({
			queryKey: organizationUsageQueryKeys.overview(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: routineQueryKeys.list(input.organizationId),
		}),
		...(input.routineId
			? [
					input.queryClient.invalidateQueries({
						queryKey: routineQueryKeys.runs(
							input.organizationId,
							input.routineId
						),
					}),
				]
			: []),
	]);
}
