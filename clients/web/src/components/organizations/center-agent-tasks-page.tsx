"use client";

import type {
	CenterAgentTask,
	CenterAgentTaskState,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { resolveStatusToneBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppPageHeader } from "#/components/app/app-page-header";
import { resolveCenterAgentTaskErrorMessage } from "#/lib/organizations/center-agent-tasks";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentTaskPath } from "#/lib/organizations/organization-routes";
import { centerAgentTasksInfiniteQueryOptions } from "#/query/organizations/center-agent-tasks";
import {
	formatTaskOrigin,
	formatTaskRequester,
	resolveTaskStatusPresentation,
} from "./center-agent-task-presentation";

type TaskLane = CenterAgentTaskState;

const TASK_LANES = [
	{
		description: "Work the Center Agent is actively coordinating.",
		id: "active",
		label: "Active",
	},
	{
		description: "Tasks waiting for a decision, answer, or recovery action.",
		id: "needs_action",
		label: "Needs action",
	},
	{
		description: "Completed, failed, and stopped work remains available here.",
		id: "finished",
		label: "Finished",
	},
] as const satisfies readonly {
	description: string;
	id: TaskLane;
	label: string;
}[];

export function CenterAgentTasksPage() {
	const { currentOrganization } = useAppOrganization();
	const tasksQuery = useInfiniteQuery(
		centerAgentTasksInfiniteQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);

	return (
		<>
			<AppPageHeader
				description="Follow ongoing work, answer requests, and return to completed results."
				eyebrow="Center Agent"
				title="Tasks"
			/>
			{tasksQuery.isPending ? <CenterAgentTaskBoardSkeleton /> : null}
			{tasksQuery.isError && !tasksQuery.data ? (
				<section
					aria-labelledby="center-agent-tasks-error-title"
					className="rounded-md border border-destructive/50 bg-destructive/5 p-5"
				>
					<h2
						className="font-medium text-foreground text-sm"
						id="center-agent-tasks-error-title"
					>
						Couldn’t load Tasks
					</h2>
					<p className="mt-2 text-destructive text-sm" role="alert">
						{resolveCenterAgentTaskErrorMessage(tasksQuery.error, "list")}
					</p>
					<Button
						className="mt-4"
						disabled={tasksQuery.isRefetching}
						onClick={() => tasksQuery.refetch()}
						size="sm"
						type="button"
						variant="outline"
					>
						<ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
						Try again
					</Button>
				</section>
			) : null}
			{tasksQuery.data ? (
				<CenterAgentTaskBoard
					onLoadMore={
						tasksQuery.hasNextPage
							? () => tasksQuery.fetchNextPage()
							: undefined
					}
					organizationSlug={currentOrganization.slug}
					tasks={tasksQuery.data.tasks}
				/>
			) : null}
		</>
	);
}

function CenterAgentTaskBoard(input: {
	onLoadMore?: () => Promise<unknown>;
	organizationSlug: string;
	tasks: readonly CenterAgentTask[];
}) {
	const tasksByLane = groupTasksByLane(input.tasks);
	return (
		<div className="space-y-4">
			<div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3">
				{TASK_LANES.map((lane) => (
					<section
						aria-labelledby={`center-agent-task-lane-${lane.id}`}
						className="min-w-0 rounded-md border border-border/70 bg-muted/10 p-3"
						key={lane.id}
					>
						<header className="mb-3 flex items-start justify-between gap-3 px-1">
							<div className="min-w-0">
								<h2
									className="font-medium text-foreground text-sm"
									id={`center-agent-task-lane-${lane.id}`}
								>
									{lane.label}
								</h2>
								<p className="mt-1 text-muted-foreground text-xs leading-5">
									{lane.description}
								</p>
							</div>
							<Badge variant="outline">{tasksByLane[lane.id].length}</Badge>
						</header>
						<SharedLayoutGroup className="space-y-2">
							{tasksByLane[lane.id].length === 0 ? (
								<p className="rounded-md border border-border/60 border-dashed px-3 py-6 text-center text-muted-foreground text-xs">
									No Tasks here
								</p>
							) : (
								tasksByLane[lane.id].map((task) => (
									<SharedLayoutItem itemId={task.id} key={task.id}>
										<CenterAgentTaskCard
											organizationSlug={input.organizationSlug}
											task={task}
										/>
									</SharedLayoutItem>
								))
							)}
						</SharedLayoutGroup>
					</section>
				))}
			</div>
			{input.onLoadMore ? (
				<div className="flex justify-center">
					<Button
						onClick={() => input.onLoadMore?.()}
						size="sm"
						type="button"
						variant="outline"
					>
						Load more Tasks
					</Button>
				</div>
			) : null}
		</div>
	);
}

function CenterAgentTaskCard(input: {
	organizationSlug: string;
	task: CenterAgentTask;
}) {
	const status = resolveTaskStatusPresentation(input.task);
	const requester = formatTaskRequester(input.task);
	return (
		<Link
			className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
			to={buildOrganizationCenterAgentTaskPath({
				orgSlug: input.organizationSlug,
				taskId: input.task.id,
			})}
		>
			<Card
				className="gap-3 border border-border/70 bg-transparent ring-0"
				size="sm"
			>
				<CardHeader>
					<CardTitle className="line-clamp-2">{input.task.title}</CardTitle>
					<CardDescription className="line-clamp-2">
						{input.task.goal}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap items-center gap-2">
					<Badge
						className={resolveStatusToneBadgeClassName(status.tone)}
						variant="outline"
					>
						{status.label}
					</Badge>
					<span className="text-muted-foreground text-xs">
						{requester ? `${requester} · ` : ""}
						{formatTaskOrigin(input.task)}
					</span>
				</CardContent>
			</Card>
		</Link>
	);
}

function CenterAgentTaskBoardSkeleton() {
	return (
		<div aria-busy="true" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
			<span className="sr-only">Loading Tasks</span>
			{TASK_LANES.map((lane) => (
				<div
					className="space-y-3 rounded-md border border-border/70 p-3"
					key={lane.id}
				>
					<Skeleton className="h-4 w-28 motion-reduce:animate-none" />
					<Skeleton className="h-28 w-full motion-reduce:animate-none" />
					<Skeleton className="h-28 w-full motion-reduce:animate-none" />
				</div>
			))}
		</div>
	);
}

function groupTasksByLane(
	tasks: readonly CenterAgentTask[]
): Record<TaskLane, CenterAgentTask[]> {
	const grouped: Record<TaskLane, CenterAgentTask[]> = {
		active: [],
		finished: [],
		needs_action: [],
	};
	for (const task of [...tasks].sort(compareTaskUpdatedAt)) {
		grouped[task.state].push(task);
	}
	return grouped;
}

function compareTaskUpdatedAt(
	left: CenterAgentTask,
	right: CenterAgentTask
): number {
	return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}
