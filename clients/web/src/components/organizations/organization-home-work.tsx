"use client";

import type { CenterAgentTask } from "@openmeld/schemas/types";
import {
	CheckCircleIcon,
	ClockIcon,
	HashIcon,
	RobotIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { selectAccountSpaceSections } from "#/components/spaces/account-space-sections";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentTaskPath,
	buildOrganizationCenterAgentTasksPath,
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { centerAgentTasksInfiniteQueryOptions } from "#/query/organizations/center-agent-tasks";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { resolveTaskStatusPresentation } from "./center-agent-task-presentation";
import {
	OrganizationHomeEmpty,
	OrganizationHomeError,
	OrganizationHomeList,
	OrganizationHomeListItem,
	OrganizationHomeListSkeleton,
	OrganizationHomePanel,
	OrganizationHomeSection,
} from "./organization-home-ui";

const HOME_WORK_ITEM_LIMIT = 4;

export function OrganizationHomeWork() {
	const { currentOrganization } = useAppOrganization();
	return (
		<OrganizationHomeSection title="Work">
			<div className="grid min-w-0 gap-4 lg:grid-cols-2">
				<OrganizationHomeTasks
					organizationId={currentOrganization.id}
					organizationSlug={currentOrganization.slug}
				/>
				<OrganizationHomeSpaces
					organizationId={currentOrganization.id}
					organizationSlug={currentOrganization.slug}
				/>
			</div>
		</OrganizationHomeSection>
	);
}

function OrganizationHomeTasks(input: {
	organizationId: string;
	organizationSlug: string;
}) {
	const tasksQuery = useInfiniteQuery(
		centerAgentTasksInfiniteQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const needsActionTasksQuery = useInfiniteQuery(
		centerAgentTasksInfiniteQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
			status: "needs_attention",
		})
	);
	const tasks = selectHomeTasks([
		...(needsActionTasksQuery.data?.tasks ?? []),
		...(tasksQuery.data?.tasks ?? []),
	]);
	const hasNeedsAction = (needsActionTasksQuery.data?.tasks.length ?? 0) > 0;
	const taskRefreshFailed = tasksQuery.isError || needsActionTasksQuery.isError;
	const taskStatus = resolveHomeTaskStatus({
		hasNeedsAction,
		refreshFailed: taskRefreshFailed,
	});
	const taskDataUnavailable =
		(tasksQuery.isError && !tasksQuery.data) ||
		(needsActionTasksQuery.isError && !needsActionTasksQuery.data);
	const taskDataIsStale = taskRefreshFailed && !taskDataUnavailable;
	const taskDataIsPending =
		!(taskDataUnavailable || (tasksQuery.data && needsActionTasksQuery.data)) &&
		tasks.length === 0;

	return (
		<OrganizationHomePanel
			href={buildOrganizationCenterAgentTasksPath(input.organizationSlug)}
			status={taskStatus}
			title="Tasks"
		>
			{taskDataIsPending ? <OrganizationHomeListSkeleton /> : null}
			{taskDataIsStale ? (
				<StaleDataNotice
					label="Tasks may be out of date."
					onRetry={() =>
						Promise.all([tasksQuery.refetch(), needsActionTasksQuery.refetch()])
					}
				/>
			) : null}
			{taskDataUnavailable ? (
				<OrganizationHomeError
					label="Couldn’t load Tasks."
					onRetry={() =>
						Promise.all([tasksQuery.refetch(), needsActionTasksQuery.refetch()])
					}
				/>
			) : null}
			{!taskRefreshFailed &&
			tasksQuery.data &&
			needsActionTasksQuery.data &&
			tasks.length === 0 ? (
				<OrganizationHomeEmpty
					icon={<RobotIcon aria-hidden="true" className="size-4" />}
					label="No Tasks yet"
				/>
			) : null}
			{tasks.length > 0 ? (
				<OrganizationHomeList>
					{tasks.map((task) => {
						const status = resolveTaskStatusPresentation(task);
						return (
							<OrganizationHomeListItem
								href={buildOrganizationCenterAgentTaskPath({
									orgSlug: input.organizationSlug,
									taskId: task.id,
								})}
								icon={<TaskStatusIcon task={task} />}
								itemId={task.id}
								key={task.id}
								meta={status.label}
								title={task.title}
							/>
						);
					})}
				</OrganizationHomeList>
			) : null}
		</OrganizationHomePanel>
	);
}

function resolveHomeTaskStatus(input: {
	hasNeedsAction: boolean;
	refreshFailed: boolean;
}): string | undefined {
	if (input.refreshFailed) {
		return "Unavailable";
	}
	return input.hasNeedsAction ? "Needs action" : undefined;
}

function resolveHomeSpacesStatus(isUnavailable: boolean): string | undefined {
	return isUnavailable ? "Unavailable" : undefined;
}

function OrganizationHomeSpaces(input: {
	organizationId: string;
	organizationSlug: string;
}) {
	const { defaultHumanProfile, profilesQuery } = useDefaultHumanProfile();
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: Boolean(defaultHumanProfile),
			profileId: defaultHumanProfile?.openMeldProfileId ?? "",
		})
	);
	const spaces = selectHomeSpaces({
		organizationId: input.organizationId,
		pinnedItems: spacesQuery.data?.pinnedItems ?? [],
		spaceItems: spacesQuery.data?.spaceItems ?? [],
	});
	const defaultProfileUnavailable =
		profilesQuery.data !== undefined && !defaultHumanProfile;
	const profileDataUnavailable =
		hasNoDataAfterFailure(profilesQuery) || defaultProfileUnavailable;
	const profileDataIsStale =
		Boolean(defaultHumanProfile) &&
		hasCachedDataAfterRefreshFailure(profilesQuery);
	const spacesDataUnavailable = hasNoDataAfterFailure(spacesQuery);
	const spacesDataIsStale = hasCachedDataAfterRefreshFailure(spacesQuery);
	const spacesPreviewIsStale = profileDataIsStale || spacesDataIsStale;
	const spacesDataIsPending =
		(!profilesQuery.data && profilesQuery.isPending) ||
		(Boolean(defaultHumanProfile) && spacesQuery.isPending);
	const spacesUnavailable =
		profileDataUnavailable || spacesDataUnavailable || spacesPreviewIsStale;
	const showSpacesEmpty =
		Boolean(spacesQuery.data) &&
		spaces.length === 0 &&
		!(spacesUnavailable || spacesDataIsPending);

	return (
		<OrganizationHomePanel
			href={buildOrganizationSpacesPath(input.organizationSlug)}
			status={resolveHomeSpacesStatus(spacesUnavailable)}
			title="Spaces"
		>
			{spacesDataIsPending ? <OrganizationHomeListSkeleton /> : null}
			{spacesPreviewIsStale ? (
				<StaleDataNotice
					label="Spaces may be out of date."
					onRetry={() =>
						Promise.all([profilesQuery.refetch(), spacesQuery.refetch()])
					}
				/>
			) : null}
			{profileDataUnavailable || spacesDataUnavailable ? (
				<OrganizationHomeError
					label="Couldn’t load Spaces."
					onRetry={() =>
						profileDataUnavailable
							? profilesQuery.refetch()
							: spacesQuery.refetch()
					}
				/>
			) : null}
			{showSpacesEmpty ? (
				<OrganizationHomeEmpty
					actionHref={buildOrganizationSpacesPath(input.organizationSlug)}
					actionLabel="Open Spaces"
					icon={<HashIcon aria-hidden="true" className="size-4" />}
					label="No Spaces yet"
				/>
			) : null}
			{spaces.length > 0 ? (
				<OrganizationHomeList>
					{spaces.map((space) => (
						<OrganizationHomeListItem
							href={buildOrganizationSpacePath({
								orgSlug: input.organizationSlug,
								search: { profileId: space.openProfileId },
								spaceId: space.spaceId,
							})}
							icon={<HashIcon aria-hidden="true" className="size-4" />}
							itemId={space.spaceId}
							key={space.spaceId}
							meta={formatSpaceMembers(space.activeMemberCount)}
							title={space.spaceName}
						/>
					))}
				</OrganizationHomeList>
			) : null}
		</OrganizationHomePanel>
	);
}

function hasCachedDataAfterRefreshFailure(input: {
	data: unknown;
	isError: boolean;
}): boolean {
	return input.isError && input.data !== undefined;
}

function hasNoDataAfterFailure(input: {
	data: unknown;
	isError: boolean;
}): boolean {
	return input.isError && input.data === undefined;
}

function selectHomeTasks(tasks: readonly CenterAgentTask[]): CenterAgentTask[] {
	return [...new Map(tasks.map((task) => [task.id, task])).values()]
		.sort((left, right) => {
			const stateOrder = { needs_action: 0, active: 1, finished: 2 } as const;
			return (
				stateOrder[left.state] - stateOrder[right.state] ||
				Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
			);
		})
		.slice(0, HOME_WORK_ITEM_LIMIT);
}

function selectHomeSpaces(input: {
	organizationId: string;
	pinnedItems: readonly AccountSpaceItem[];
	spaceItems: readonly AccountSpaceItem[];
}): AccountSpaceItem[] {
	const sections = selectAccountSpaceSections({
		currentOrganizationId: input.organizationId,
		sections: {
			pinnedItems: input.pinnedItems,
			spaceItems: input.spaceItems,
		},
	});
	const seenSpaceIds = new Set<string>();
	const selectedSpaces: AccountSpaceItem[] = [];
	for (const space of [...sections.pinnedItems, ...sections.spaceItems]) {
		if (seenSpaceIds.has(space.spaceId)) {
			continue;
		}
		seenSpaceIds.add(space.spaceId);
		selectedSpaces.push(space);
		if (selectedSpaces.length === HOME_WORK_ITEM_LIMIT) {
			break;
		}
	}
	return selectedSpaces;
}

function TaskStatusIcon(input: { task: CenterAgentTask }) {
	if (input.task.state === "needs_action") {
		return <WarningCircleIcon aria-hidden="true" className="size-4" />;
	}
	if (input.task.state === "finished") {
		return <CheckCircleIcon aria-hidden="true" className="size-4" />;
	}
	return <ClockIcon aria-hidden="true" className="size-4" />;
}

function formatSpaceMembers(count: number | null): string | undefined {
	if (count === null) {
		return undefined;
	}
	return `${String(count)} ${count === 1 ? "member" : "members"}`;
}
