"use client";

import type { SpaceTask, SpaceTaskPhase } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	CheckCircleIcon,
	CircleIcon,
	ClockCountdownIcon,
	FlowArrowIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { ReadPausedState } from "#/components/app/read-paused-state";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { mayShowCachedReadData } from "#/lib/query-display";
import { buildSpaceMessageFocusHref } from "#/lib/spaces/thread-navigation";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { SpaceTasksSkeleton } from "./space-panel-skeletons";
import { SpaceTaskCard } from "./space-task-card";
import { SpaceTaskDetailDrawer } from "./space-task-detail-drawer";
import { formatSpaceTaskPhase } from "./space-task-presentation";
import {
	type SpaceTasksPanelProps,
	useSpaceTasksPanelController,
} from "./use-space-tasks-panel-controller";

const ACTIVE_COLUMNS = [
	{
		phase: "to_do",
		title: "To do",
		description: "Accepted work waiting to begin",
		icon: CircleIcon,
	},
	{
		phase: "in_progress",
		title: "In progress",
		description: "A person or Agent is advancing it",
		icon: ClockCountdownIcon,
	},
	{
		phase: "in_review",
		title: "In review",
		description: "A result is waiting for acceptance",
		icon: FlowArrowIcon,
	},
] satisfies readonly {
	description: string;
	icon: typeof CircleIcon;
	phase: SpaceTaskPhase;
	title: string;
}[];

function TasksRefreshNotice(input: {
	isFetching: boolean;
	isRefetchError: boolean;
	onRetry: () => void;
}) {
	if (!input.isRefetchError) {
		return null;
	}
	return (
		<output className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-card/35 px-4 py-3 text-sm">
			<span>Couldn't refresh Tasks. Showing the last loaded board.</span>
			<Button
				disabled={input.isFetching}
				onClick={input.onRetry}
				size="sm"
				variant="outline"
			>
				Retry
			</Button>
		</output>
	);
}

function TasksReadGate(input: {
	isPaused: boolean;
	isPending: boolean;
	onRetry: () => void;
	showPending: boolean;
}) {
	if (input.isPending) {
		if (input.isPaused) {
			return <ReadPausedState subject="Tasks" />;
		}
		return input.showPending ? <SpaceTasksSkeleton /> : null;
	}
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<div className="max-w-sm text-center">
				<p className="font-medium text-sm">Tasks couldn't load</p>
				<p className="mt-1 text-muted-foreground text-sm">
					OpenMeld couldn't read the shared Task board.
				</p>
				<Button
					className="mt-4"
					onClick={input.onRetry}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			</div>
		</div>
	);
}

function shouldBlockTasksRead(input: {
	hasData: boolean;
	isError: boolean;
	error: unknown;
}): boolean {
	return (
		!input.hasData || (input.isError && !mayShowCachedReadData(input.error))
	);
}

export function SpaceTasksPanel(input: SpaceTasksPanelProps) {
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [phase, setPhase] = useState<SpaceTaskPhase | undefined>();
	const {
		addAndAssignTask,
		commonAgentIds,
		detailQuery,
		members,
		mutateTask,
		outsideCommonAgents,
		pendingTaskId,
		projects,
		tasksQuery,
	} = useSpaceTasksPanelController(input, { phase, taskId: selectedTaskId });
	const effectiveProjectId = projects.some(
		(project) => project.id === selectedProjectId
	)
		? selectedProjectId
		: "";
	const showPending = useDelayedPending(
		tasksQuery.isPending && tasksQuery.fetchStatus !== "paused"
	);

	if (
		shouldBlockTasksRead({
			error: tasksQuery.error,
			hasData: Boolean(tasksQuery.data),
			isError: tasksQuery.isError,
		})
	) {
		return (
			<TasksReadGate
				isPaused={tasksQuery.fetchStatus === "paused"}
				isPending={tasksQuery.isPending}
				onRetry={() => tasksQuery.refetch()}
				showPending={showPending}
			/>
		);
	}

	const tasks = (tasksQuery.data?.tasks ?? []).filter(
		(task) =>
			!effectiveProjectId || task.projectIds.includes(effectiveProjectId)
	);
	const selectedTask = resolveSelectedTask(
		tasks,
		selectedTaskId,
		detailQuery.data?.task
	);
	const doneTasks = tasks.filter((task) => task.phase === "done");
	const canceledTasks = tasks.filter((task) => task.phase === "canceled");
	const spaceHref = input.organizationSlug
		? buildOrganizationSpacePath({
				orgSlug: input.organizationSlug,
				spaceId: input.spaceId,
			})
		: `/spaces/${encodeURIComponent(input.spaceId)}`;

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="mx-auto max-w-[1600px] p-4 sm:p-6">
				<TasksRefreshNotice
					isFetching={tasksQuery.isFetching}
					isRefetchError={tasksQuery.isRefetchError}
					onRetry={() => tasksQuery.refetch()}
				/>
				<TaskBoardHeader
					onPhaseChange={setPhase}
					onProjectChange={(projectId) => {
						setSelectedProjectId(projectId);
						setSelectedTaskId(null);
					}}
					phase={phase}
					projects={projects}
					selectedProjectId={effectiveProjectId}
					tasks={tasks}
					truncated={tasksQuery.data?.truncated ?? false}
				/>
				{tasksQuery.data?.truncated ? (
					<p className="mb-4 rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
						{phase
							? "Showing the 500 most recently updated Tasks in this phase. Older Tasks are not included."
							: "Showing up to 500 Tasks, with active work first. Choose a phase to inspect its work and history."}
					</p>
				) : null}

				{tasks.length === 0 ? (
					<TaskBoardEmptyState
						phase={phase}
						selectedProjectId={effectiveProjectId}
						truncated={tasksQuery.data?.truncated ?? false}
					/>
				) : (
					<>
						<div className="grid items-start gap-4 md:grid-cols-3">
							{ACTIVE_COLUMNS.filter(
								(column) => !phase || phase === column.phase
							).map((column) => (
								<TaskColumn
									column={column}
									key={column.phase}
									onOpenTask={setSelectedTaskId}
									selectedTaskId={selectedTaskId}
									selfProfileId={input.openMeldProfileId}
									tasks={tasks.filter((task) => task.phase === column.phase)}
								/>
							))}
						</div>
						{doneTasks.length > 0 || canceledTasks.length > 0 ? (
							<div className="mt-6 border-border border-t pt-4">
								<p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
									History
								</p>
								<div className="space-y-2">
									<TaskHistory
										label="Done"
										onOpenTask={setSelectedTaskId}
										open={phase === "done"}
										selectedTaskId={selectedTaskId}
										selfProfileId={input.openMeldProfileId}
										tasks={doneTasks}
									/>
									<TaskHistory
										label="Canceled"
										onOpenTask={setSelectedTaskId}
										open={phase === "canceled"}
										selectedTaskId={selectedTaskId}
										selfProfileId={input.openMeldProfileId}
										tasks={canceledTasks}
									/>
								</div>
							</div>
						) : null}
					</>
				)}
			</div>
			<SpaceTaskDetailDrawer
				busy={isTaskPending(selectedTask, pendingTaskId)}
				commonAgentIds={commonAgentIds}
				detail={detailQuery.data}
				error={detailQuery.isError}
				key={selectedTaskId ?? "closed"}
				loading={selectedTaskId !== null && detailQuery.isPending}
				members={members}
				onAddAndAssign={(profileId) =>
					addAndAssignSelectedTask(selectedTask, profileId, addAndAssignTask)
				}
				onMutate={(body) =>
					mutateSelectedTask(selectedTaskId, body, mutateTask)
				}
				onOpenChange={(open) =>
					handleTaskDrawerOpenChange(open, setSelectedTaskId)
				}
				onOpenThread={input.onOpenThread}
				onRefresh={() => detailQuery.refetch()}
				open={selectedTaskId !== null}
				outsideCommonAgents={outsideCommonAgents}
				projects={projects}
				selfProfileId={input.openMeldProfileId}
				sourceHref={
					selectedTask?.sourceSignalId
						? buildSpaceMessageFocusHref(spaceHref, selectedTask.sourceSignalId)
						: undefined
				}
				spaceName={input.spaceName ?? "this Space"}
				task={selectedTask}
			/>
		</ScrollArea>
	);
}

function resolveSelectedTask(
	tasks: readonly SpaceTask[],
	taskId: string | null,
	detailTask?: SpaceTask
): SpaceTask | null {
	return detailTask ?? tasks.find((task) => task.taskId === taskId) ?? null;
}

async function addAndAssignSelectedTask(
	task: SpaceTask | null,
	profileId: string,
	addAndAssignTask: ReturnType<
		typeof useSpaceTasksPanelController
	>["addAndAssignTask"]
) {
	if (!task) {
		return {
			membership: "unknown" as const,
			assigned: false,
			message: "Task details are unavailable.",
		};
	}
	return await addAndAssignTask(task.taskId, profileId, task.revision);
}

async function mutateSelectedTask(
	taskId: string | null,
	body: Parameters<
		ReturnType<typeof useSpaceTasksPanelController>["mutateTask"]
	>[1],
	mutateTask: ReturnType<typeof useSpaceTasksPanelController>["mutateTask"]
): Promise<boolean> {
	if (!taskId) {
		return false;
	}
	return await mutateTask(taskId, body);
}

function handleTaskDrawerOpenChange(
	open: boolean,
	setSelectedTaskId: (taskId: string | null) => void
): void {
	if (!open) {
		setSelectedTaskId(null);
	}
}

function isTaskPending(
	task: SpaceTask | null,
	pendingTaskId: string | null
): boolean {
	return task !== null && pendingTaskId === task.taskId;
}

function TaskBoardEmptyState(input: {
	phase?: SpaceTaskPhase;
	selectedProjectId: string;
	truncated: boolean;
}) {
	let title = "No Tasks yet";
	let description =
		"Tasks begin in Messages when someone gives a person or Agent a clear deliverable. Small questions and quick actions stay in the conversation.";
	if (input.phase) {
		title = `No ${formatSpaceTaskPhase(input.phase)} Tasks`;
		description = "Choose another phase to see more work.";
	}
	if (input.selectedProjectId) {
		if (!input.phase) {
			title = input.truncated
				? "No matching Tasks in this page"
				: "No Tasks for this Project";
		}
		description = input.truncated
			? "Older Tasks may not be included. Choose a phase or clear the Project filter to inspect more work."
			: "Choose another Project or clear the filter to see more work in this Space.";
	}
	return (
		<div className="flex min-h-80 items-center justify-center rounded-lg border border-border border-dashed px-6 text-center">
			<div className="max-w-md">
				<CheckCircleIcon
					aria-hidden="true"
					className="mx-auto size-8 text-muted-foreground"
				/>
				<h3 className="mt-3 font-medium text-sm">{title}</h3>
				<p className="mt-1 text-muted-foreground text-sm leading-6">
					{description}
				</p>
			</div>
		</div>
	);
}

function TaskBoardHeader(input: {
	onProjectChange: (projectId: string) => void;
	onPhaseChange: (phase: SpaceTaskPhase | undefined) => void;
	phase?: SpaceTaskPhase;
	projects: readonly { id: string; name: string }[];
	selectedProjectId: string;
	tasks: readonly SpaceTask[];
	truncated: boolean;
}) {
	const activeCount = input.tasks.filter(
		(task) => task.phase !== "done" && task.phase !== "canceled"
	).length;
	let summary = "No active commitments";
	if (input.phase) {
		summary = `${input.tasks.length}${input.truncated ? "+" : ""} ${formatSpaceTaskPhase(input.phase)} Tasks`;
	} else if (activeCount > 0) {
		summary = `${activeCount} active ${activeCount === 1 ? "commitment" : "commitments"}${input.truncated ? " shown" : ""}`;
	}
	return (
		<header className="mb-4 flex items-start justify-between gap-4">
			<div>
				<h2 className="font-semibold text-base">Tasks</h2>
				<p className="mt-1 text-muted-foreground text-sm">{summary}</p>
			</div>
			<div className="flex gap-3">
				{input.projects.length > 0 ? (
					<label className="text-muted-foreground text-xs">
						Project
						<select
							className="mt-1 block h-8 rounded-md border border-input bg-background px-2 text-foreground text-sm"
							onChange={(event) => input.onProjectChange(event.target.value)}
							value={input.selectedProjectId}
						>
							<option value="">All Projects</option>
							{input.projects.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name}
								</option>
							))}
						</select>
					</label>
				) : null}
				<label className="text-muted-foreground text-xs">
					Phase
					<select
						className="mt-1 block h-8 rounded-md border border-input bg-background px-2 text-foreground text-sm"
						onChange={(event) =>
							input.onPhaseChange(
								event.target.value
									? (event.target.value as SpaceTaskPhase)
									: undefined
							)
						}
						value={input.phase ?? ""}
					>
						<option value="">All phases</option>
						{(
							["to_do", "in_progress", "in_review", "done", "canceled"] as const
						).map((value) => (
							<option key={value} value={value}>
								{formatSpaceTaskPhase(value)}
							</option>
						))}
					</select>
				</label>
			</div>
		</header>
	);
}

function TaskColumn(input: {
	column: (typeof ACTIVE_COLUMNS)[number];
	onOpenTask: (taskId: string) => void;
	selectedTaskId: string | null;
	selfProfileId?: string;
	tasks: readonly SpaceTask[];
}) {
	const Icon = input.column.icon;
	return (
		<section aria-labelledby={`space-task-column-${input.column.phase}`}>
			<div className="mb-2 flex items-start gap-2 px-1">
				<Icon aria-hidden="true" className="mt-0.5 size-4" />
				<div>
					<h3
						className="font-medium text-sm"
						id={`space-task-column-${input.column.phase}`}
					>
						{input.column.title} · {input.tasks.length}
					</h3>
					<p className="text-muted-foreground text-xs">
						{input.column.description}
					</p>
				</div>
			</div>
			<div className="space-y-3">
				{input.tasks.length === 0 ? (
					<div className="rounded-lg border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-xs">
						Nothing here
					</div>
				) : null}
				{input.tasks.map((task) => (
					<SpaceTaskCard
						key={task.taskId}
						onOpen={() => input.onOpenTask(task.taskId)}
						selected={input.selectedTaskId === task.taskId}
						selfProfileId={input.selfProfileId}
						task={task}
					/>
				))}
			</div>
		</section>
	);
}

function TaskHistory(
	input: Omit<Parameters<typeof TaskColumn>[0], "column"> & {
		label: string;
		open?: boolean;
	}
) {
	if (input.tasks.length === 0) {
		return null;
	}
	return (
		<details
			className="rounded-lg border border-border"
			open={input.open || undefined}
		>
			<summary className="cursor-pointer px-4 py-3 font-medium text-sm">
				{input.label} · {input.tasks.length}
			</summary>
			<div className="grid gap-3 border-border border-t p-3 md:grid-cols-2 xl:grid-cols-3">
				{input.tasks.map((task) => (
					<SpaceTaskCard
						key={task.taskId}
						onOpen={() => input.onOpenTask(task.taskId)}
						selected={input.selectedTaskId === task.taskId}
						selfProfileId={input.selfProfileId}
						task={task}
					/>
				))}
			</div>
		</details>
	);
}
