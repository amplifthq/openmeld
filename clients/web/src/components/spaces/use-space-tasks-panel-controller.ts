"use client";

import { describeLinkedGitHubIssueClosePrompt } from "@openmeld/schemas/schemas";
import type {
	MutateSpaceTaskBody,
	SpaceMembersSnapshot,
	SpaceTaskPhase,
} from "@openmeld/schemas/types";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	projectCommonAgentsQueryOptions,
	projectsQueryOptions,
} from "#/query/organizations/projects";
import { baseQueryOptions } from "#/query/query-config";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";
import { spaceQueryKeys } from "#/query/spaces/status";
import { mutateSpaceTaskWithConflictRefresh } from "./space-task-mutation";

export type SpaceTasksPanelProps = {
	membersSnapshot: SpaceMembersSnapshot | null;
	onOpenThread?: (threadId: string) => void;
	openMeldProfileId?: string;
	organizationId?: string;
	organizationSlug?: string;
	spaceId: string;
	spaceName?: string | null;
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
	const projectQueriesEnabled = Boolean(
		input.organizationId && input.openMeldProfileId
	);
	const projectsQuery = useQuery(
		projectsQueryOptions({
			enabled: projectQueriesEnabled,
			organizationId: input.organizationId ?? "",
		})
	);
	const profileDirectory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: projectQueriesEnabled,
			organizationId: input.organizationId ?? "",
		})
	);
	const selectedTask =
		detailQuery.data?.task ??
		tasksQuery.data?.tasks.find((task) => task.taskId === selection.taskId);
	const commonAgentQueries = useQueries({
		queries: (selectedTask?.projectIds ?? []).map((projectId) => ({
			...projectCommonAgentsQueryOptions({
				organizationId: input.organizationId ?? "",
				projectId,
			}),
			enabled: projectQueriesEnabled,
		})),
	});
	const commonAgentIds = new Set(
		commonAgentQueries.flatMap(
			(query) => query.data?.commonAgents.agentProfileIds ?? []
		)
	);
	const outsideCommonAgents = (profileDirectory.data?.agentProfiles ?? [])
		.filter(
			(profile) =>
				profile.status === "active" &&
				commonAgentIds.has(profile.profileId) &&
				!members.some((member) => member.profileId === profile.profileId)
		)
		.map((profile) => ({
			profileId: profile.profileId,
			profileName: profile.profileName,
			ownerName: profile.ownerUserId
				? (profile.ownerName ?? "Agent owner")
				: null,
		}));

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

	const addAndAssignTask = async (
		taskId: string,
		agentProfileId: string,
		expectedRevision: number
	): Promise<{
		membership: "confirmed" | "unknown";
		assigned: boolean;
		message: string | null;
	}> => {
		try {
			await api.addOrganizationDirectoryProfilesToSpace({
				directoryProfileIds: [agentProfileId],
				spaceId: input.spaceId,
			});
		} catch (error) {
			return {
				membership: "unknown",
				assigned: false,
				message: `OpenMeld could not confirm the membership change: ${resolveSpaceTaskErrorMessage(error)} Refresh members before trying again.`,
			};
		}
		const assigned = await mutateTask(taskId, {
			action: "assign",
			assigneeProfileId: agentProfileId,
			expectedRevision,
			operationId: crypto.randomUUID(),
		});
		let refreshFailed = false;
		if (input.openMeldProfileId) {
			try {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: spaceQueryKeys.members(
							input.spaceId,
							input.openMeldProfileId
						),
					}),
					queryClient.invalidateQueries({
						queryKey: spaceQueryKeys.status(
							input.spaceId,
							input.openMeldProfileId
						),
					}),
				]);
			} catch {
				refreshFailed = true;
			}
		}
		let message: string | null = null;
		if (!assigned) {
			message =
				"Space membership was updated, but the Task assignment did not complete. Refresh the Task and try assignment again.";
		} else if (refreshFailed) {
			message =
				"The Task was assigned, but Space members could not refresh. Reload the Space to see the latest membership.";
		}
		return {
			membership: "confirmed",
			assigned,
			message,
		};
	};

	return {
		addAndAssignTask,
		commonAgentIds,
		detailQuery,
		members,
		mutateTask,
		outsideCommonAgents,
		pendingTaskId,
		projects: projectsQuery.data?.projects ?? [],
		tasksQuery,
	};
}

function resolveSpaceTaskErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return "OpenMeld couldn't update this Task. Refresh it and try again.";
}
