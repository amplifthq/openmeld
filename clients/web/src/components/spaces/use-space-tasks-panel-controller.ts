"use client";

import { describeLinkedGitHubIssueClosePrompt } from "@openmeld/schemas/schemas";
import type {
	MutateSpaceTaskBody,
	SpaceMembersSnapshot,
	SpaceTaskPhase,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { baseQueryOptions } from "#/query/query-config";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";
import { mutateSpaceTaskWithConflictRefresh } from "./space-task-mutation";

export type SpaceTasksPanelProps = {
	membersSnapshot: SpaceMembersSnapshot | null;
	onOpenThread?: (threadId: string) => void;
	openMeldProfileId?: string;
	organizationSlug?: string;
	spaceId: string;
};

export function useSpaceTasksPanelController(
	input: SpaceTasksPanelProps,
	selection: { phase?: SpaceTaskPhase; taskId: string | null }
) {
	const api = useMemo(
		() =>
			input.organizationSlug
				? createOrganizationScopedWebSpaceApi({
						organizationSlug: input.organizationSlug,
						...(input.openMeldProfileId
							? { openMeldProfileId: input.openMeldProfileId }
							: {}),
					})
				: createUnscopedWebSpaceApi(
						input.openMeldProfileId
							? { openMeldProfileId: input.openMeldProfileId }
							: {}
					),
		[input.openMeldProfileId, input.organizationSlug]
	);
	const queryClient = useQueryClient();
	const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
	const tasksQuery = useQuery({
		queryKey: spaceTaskQueryKeys.list(input.spaceId, selection.phase),
		queryFn: async ({ signal }) =>
			await api.listTasks({
				spaceId: input.spaceId,
				phase: selection.phase,
				signal,
			}),
		gcTime: baseQueryOptions.gcTime,
		refetchOnWindowFocus: true,
		retry: baseQueryOptions.retry,
		staleTime: 3000,
	});
	const detailQuery = useQuery({
		queryKey: spaceTaskQueryKeys.detail(
			input.spaceId,
			selection.taskId ?? "",
			input.openMeldProfileId
		),
		queryFn: async ({ signal }) =>
			await api.getTask({
				spaceId: input.spaceId,
				taskId: selection.taskId ?? "",
				includeAffordances: true,
				signal,
			}),
		enabled: selection.taskId !== null,
		staleTime: 0,
		retry: baseQueryOptions.retry,
	});
	const members = useMemo(
		() =>
			[
				...(input.membersSnapshot?.humans ?? []),
				...(input.membersSnapshot?.agents ?? []),
			].filter((member) => member.status === "active"),
		[input.membersSnapshot]
	);

	const mutateTask = async (
		taskId: string,
		body: MutateSpaceTaskBody
	): Promise<boolean> => {
		setPendingTaskId(taskId);
		try {
			const receipt = await mutateSpaceTaskWithConflictRefresh({
				mutate: (mutation) =>
					api.mutateTask({
						body: mutation,
						spaceId: input.spaceId,
						taskId,
					}),
				refresh: () =>
					queryClient.invalidateQueries({
						queryKey: spaceTaskQueryKeys.space(input.spaceId),
					}),
				request: body,
			});
			await queryClient.invalidateQueries({
				queryKey: spaceTaskQueryKeys.space(input.spaceId),
			});
			const githubClosePrompt = describeLinkedGitHubIssueClosePrompt(
				receipt.task
			);
			if (githubClosePrompt) {
				toast.message(githubClosePrompt);
			}
			return true;
		} catch (error) {
			toast.error(resolveSpaceTaskErrorMessage(error));
			return false;
		} finally {
			setPendingTaskId(null);
		}
	};

	return {
		createTask: async (
			body: import("@openmeld/schemas/types").CreateSpaceTaskBody
		) => {
			try {
				const receipt = await api.createTask({ spaceId: input.spaceId, body });
				queryClient.setQueryData(
					spaceTaskQueryKeys.detail(
						input.spaceId,
						receipt.task.taskId,
						input.openMeldProfileId
					),
					receipt
				);
				await queryClient.invalidateQueries({
					queryKey: spaceTaskQueryKeys.space(input.spaceId),
				});
				return receipt.task;
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: "Couldn't create task. Try again."
				);
				return null;
			}
		},
		detailQuery,
		members,
		mutateTask,
		pendingTaskId,
		tasksQuery,
	};
}

function resolveSpaceTaskErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return "OpenMeld couldn't update this Task. Refresh it and try again.";
}
