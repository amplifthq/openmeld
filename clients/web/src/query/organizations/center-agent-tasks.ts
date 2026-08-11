import { isCenterAgentTaskTerminalStatus } from "@openmeld/schemas";
import type {
	CenterAgentTaskDetail,
	CenterAgentTaskStatus,
	ListCenterAgentTasksResponse,
} from "@openmeld/schemas/types";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import {
	type CenterAgentTasksFailure,
	getCurrentCenterAgentTask,
	listCurrentCenterAgentTasks,
} from "#/lib/organizations/center-agent-tasks";
import { baseQueryOptions } from "#/query/query-config";

export const CENTER_AGENT_TASK_PAGE_LIMIT = 40;
export const CENTER_AGENT_TASK_LIST_POLL_INTERVAL_MS = 5000;
export const CENTER_AGENT_TASK_ACTIVE_POLL_INTERVAL_MS = 3000;

export const centerAgentTaskQueryKeys = {
	all: ["center-agent-tasks"] as const,
	organization: (organizationId: string) =>
		[...centerAgentTaskQueryKeys.all, organizationId] as const,
	list: (organizationId: string, status?: CenterAgentTaskStatus) =>
		status
			? ([
					...centerAgentTaskQueryKeys.organization(organizationId),
					"list",
					{ status },
				] as const)
			: ([
					...centerAgentTaskQueryKeys.organization(organizationId),
					"list",
				] as const),
	details: (organizationId: string) =>
		[
			...centerAgentTaskQueryKeys.organization(organizationId),
			"detail",
		] as const,
	detail: (organizationId: string, taskId: string) =>
		[...centerAgentTaskQueryKeys.details(organizationId), taskId] as const,
};

export function centerAgentTasksInfiniteQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	status?: CenterAgentTaskStatus;
}) {
	return infiniteQueryOptions<
		ListCenterAgentTasksResponse,
		CenterAgentTasksFailure,
		ReturnType<typeof selectCenterAgentTaskPages>,
		ReturnType<typeof centerAgentTaskQueryKeys.list>,
		string | undefined
	>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		initialPageParam: undefined,
		queryFn: async ({ pageParam, signal }) =>
			await listCurrentCenterAgentTasks({
				...(pageParam === undefined ? {} : { cursor: pageParam }),
				limit: CENTER_AGENT_TASK_PAGE_LIMIT,
				organizationId: input.organizationId,
				signal,
				...(input.status ? { status: input.status } : {}),
			}),
		queryKey: centerAgentTaskQueryKeys.list(input.organizationId, input.status),
		refetchInterval: CENTER_AGENT_TASK_LIST_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		select: selectCenterAgentTaskPages,
		staleTime: 2000,
	});
}

export function centerAgentTaskDetailQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	taskId: string;
}) {
	return queryOptions<CenterAgentTaskDetail, CenterAgentTasksFailure>({
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentCenterAgentTask({
				organizationId: input.organizationId,
				signal,
				taskId: input.taskId,
			}),
		queryKey: centerAgentTaskQueryKeys.detail(
			input.organizationId,
			input.taskId
		),
		refetchInterval: (query) =>
			query.state.data &&
			isCenterAgentTaskTerminalStatus(query.state.data.task.status)
				? false
				: CENTER_AGENT_TASK_ACTIVE_POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: (failureCount, error) =>
			error.status === 404
				? false
				: baseQueryOptions.retry(failureCount, error),
		staleTime: 1000,
	});
}

function selectCenterAgentTaskPages(input: {
	pageParams: readonly unknown[];
	pages: readonly ListCenterAgentTasksResponse[];
}) {
	return {
		...input,
		tasks: input.pages.flatMap((page) => page.tasks),
	};
}
