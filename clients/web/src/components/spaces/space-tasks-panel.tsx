"use client";

import type { SpaceTask, SpaceTaskPhase } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
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
import { SpaceTaskCreateDialog } from "./space-task-create-dialog";
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
		icon: CircleIcon,
	},
	{
		phase: "in_progress",
		title: "In progress",
		icon: ClockCountdownIcon,
	},
	{
		phase: "in_review",
		title: "In review",
		icon: FlowArrowIcon,
	},
] satisfies readonly {
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

export function EmptyTasksBoard(input: { phase?: SpaceTaskPhase }) {
	return (
		<div className="flex min-h-80 items-center justify-center rounded-lg border border-border border-dashed px-6 text-center">
			<div className="max-w-md">
				<CheckCircleIcon
					aria-hidden="true"
					className="mx-auto size-8 text-muted-foreground"
				/>
				<h3 className="mt-3 font-medium text-sm">
					{input.phase
						? `No ${formatSpaceTaskPhase(input.phase)} Tasks`
						: "No Tasks yet"}
				</h3>
				<p className="mt-1 text-muted-foreground text-sm leading-6">
					{input.phase ? (
						"Choose another phase to see more work."
					) : (
						<>Create a task here or from a message.</>
					)}
				</p>
			</div>
		</div>
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
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [creatingTask, setCreatingTask] = useState(false);
	const [localTaskId, setLocalTaskId] = useState<string | null>(null);
	const selectedTaskId =
		input.selectedTaskId === undefined ? localTaskId : input.selectedTaskId;
	const setSelectedTaskId = input.onSelectTask ?? setLocalTaskId;
	const [phase, setPhase] = useState<SpaceTaskPhase | undefined>();
	const {
		createTask,
		addAndAssignTask,
		commonAgentIds,
		outsideCommonAgents,
		projects,
		detailQuery,
		members,
		mutateTask,
		pendingTaskId,
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

	const canCreateTask = members.some(
		(member) => member.profileId === input.openMeldProfileId
	);
	const tasks = (tasksQuery.data?.tasks ?? []).filter(
		(task) =>
			!effectiveProjectId || task.projectIds.includes(effectiveProjectId)
	);
	const selectedTask = resolveSelectedTask(
		tasks,
		selectedTaskId,
		detailQuery.data?.task
	);
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
					onCreateTask={canCreateTask ? () => setCreatingTask(true) : undefined}
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
				{creatingTask && canCreateTask && (
					<SpaceTaskCreateDialog
						members={members}
						onClose={() => setCreatingTask(false)}
						onCreate={async (body) => {
							const task = await createTask(body);
							if (!task) {
								return false;
							}
							setSelectedTaskId(task.taskId);
							return true;
						}}
					/>
				)}
				{effectiveProjectId && tasks.length === 0 ? (
					<TaskBoardEmptyState
						phase={phase}
						selectedProjectId={effectiveProjectId}
						truncated={tasksQuery.data?.truncated ?? false}
					/>
				) : (
					<TaskBoardContent
						onOpenTask={setSelectedTaskId}
						phase={phase}
						selectedTaskId={selectedTaskId}
						selfProfileId={input.openMeldProfileId}
						tasks={tasks}
					/>
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

export function TaskBoardHeader(input: {
	onCreateTask?: () => void;
	onProjectChange?: (projectId: string) => void;
	onPhaseChange: (phase: SpaceTaskPhase | undefined) => void;
	phase?: SpaceTaskPhase;
	projects?: readonly { id: string; name: string }[];
	selectedProjectId?: string;
	tasks: readonly SpaceTask[];
	truncated: boolean;
}) {
	const activeCount = input.tasks.filter(
		(task) => task.phase !== "done" && task.phase !== "canceled"
	).length;
	let summary = "No active tasks";
	if (input.phase) {
		summary = `${input.tasks.length}${input.truncated ? "+" : ""} ${input.tasks.length === 1 ? "task" : "tasks"}`;
	} else if (activeCount > 0) {
		summary = `${activeCount} active ${activeCount === 1 ? "task" : "tasks"}${input.truncated ? " shown" : ""}`;
	}
	return (
		<header className="mb-4 flex items-start justify-between gap-4">
			<div>
				<h2 className="font-semibold text-base">Tasks</h2>
				<p className="mt-1 text-muted-foreground text-sm">{summary}</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{(input.projects?.length ?? 0) > 0 && (
					<Select
						onValueChange={(value) =>
							input.onProjectChange?.(value === "all" ? "" : value)
						}
						value={input.selectedProjectId || "all"}
					>
						<SelectTrigger
							aria-label="Filter tasks by Project"
							className="h-8 text-xs"
							displayValue={
								input.projects?.find((p) => p.id === input.selectedProjectId)
									?.name ?? "All Projects"
							}
						/>
						<SelectContent>
							<SelectItem index={0} value="all">
								All Projects
							</SelectItem>
							{input.projects?.map((p, index) => (
								<SelectItem index={index + 1} key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<Select
					onValueChange={(value) =>
						input.onPhaseChange(
							value === "all" ? undefined : (value as SpaceTaskPhase)
						)
					}
					value={input.phase ?? "all"}
				>
					<SelectTrigger
						aria-label="Filter tasks by status"
						className="h-8 text-xs"
						displayValue={
							input.phase ? formatSpaceTaskPhase(input.phase) : "All statuses"
						}
					/>
					<SelectContent>
						<SelectItem index={0} value="all">
							All statuses
						</SelectItem>
						{(
							["to_do", "in_progress", "in_review", "done", "canceled"] as const
						).map((value, index) => (
							<SelectItem index={index + 1} key={value} value={value}>
								{formatSpaceTaskPhase(value)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{input.onCreateTask ? (
					<Button onClick={input.onCreateTask} size="sm">
						New task
					</Button>
				) : null}
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
				</div>
			</div>
			<div className="space-y-3">
				{input.tasks.length === 0 ? (
					<div className="px-3 py-6 text-muted-foreground text-xs">
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
	}
) {
	if (input.tasks.length === 0) {
		return null;
	}
	return (
		<details>
			<summary className="cursor-pointer px-1 py-2 font-medium text-sm">
				{input.label} · {input.tasks.length}
			</summary>
			<div className="py-2">
				<TaskList {...input} />
			</div>
		</details>
	);
}

function TaskList(input: Omit<Parameters<typeof TaskColumn>[0], "column">) {
	return (
		<div className="space-y-2">
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
	);
}

function TaskBoardContent(
	input: Omit<Parameters<typeof TaskColumn>[0], "column"> & {
		phase?: SpaceTaskPhase;
	}
) {
	const { tasks, phase } = input;
	if (tasks.length === 0) {
		return <EmptyTasksBoard phase={phase} />;
	}
	if (phase) {
		return <TaskList {...input} />;
	}
	const doneTasks = tasks.filter((task) => task.phase === "done");
	const canceledTasks = tasks.filter((task) => task.phase === "canceled");
	return (
		<>
			<div className="grid items-start gap-4 md:grid-cols-3">
				{ACTIVE_COLUMNS.map((column) => (
					<TaskColumn
						column={column}
						key={column.phase}
						onOpenTask={input.onOpenTask}
						selectedTaskId={input.selectedTaskId}
						selfProfileId={input.selfProfileId}
						tasks={tasks.filter((task) => task.phase === column.phase)}
					/>
				))}
			</div>
			{doneTasks.length > 0 || canceledTasks.length > 0 ? (
				<div className="mt-6">
					<div className="space-y-2">
						<TaskHistory
							label="Done"
							onOpenTask={input.onOpenTask}
							selectedTaskId={input.selectedTaskId}
							selfProfileId={input.selfProfileId}
							tasks={doneTasks}
						/>
						<TaskHistory
							label="Canceled"
							onOpenTask={input.onOpenTask}
							selectedTaskId={input.selectedTaskId}
							selfProfileId={input.selfProfileId}
							tasks={canceledTasks}
						/>
					</div>
				</div>
			) : null}
		</>
	);
}
