"use client";

import type { SpaceTask, SpaceTaskPhase } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	CheckCircleIcon,
	CircleIcon,
	ClockCountdownIcon,
	FlowArrowIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { SpaceTaskCard } from "./space-task-card";
import { SpaceTaskDetailDrawer } from "./space-task-detail-drawer";
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

export function SpaceTasksPanel(input: SpaceTasksPanelProps) {
	const { members, mutateTask, pendingTaskId, tasksQuery } =
		useSpaceTasksPanelController(input);
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

	if (tasksQuery.isPending) {
		return <SpaceTasksSkeleton />;
	}
	if (tasksQuery.isError) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6">
				<div className="max-w-sm text-center">
					<p className="font-medium text-sm">Tasks couldn't load</p>
					<p className="mt-1 text-muted-foreground text-sm">
						OpenMeld couldn't read the shared Task board.
					</p>
					<Button
						className="mt-4"
						onClick={() => tasksQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	const tasks = tasksQuery.data?.tasks ?? [];
	const activeTaskCount = tasks.filter(
		(task) => task.phase !== "done" && task.phase !== "canceled"
	).length;
	const doneTasks = tasks.filter((task) => task.phase === "done");
	const canceledTasks = tasks.filter((task) => task.phase === "canceled");
	const selectedTask =
		tasks.find((task) => task.taskId === selectedTaskId) ?? null;

	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto max-w-[1600px] p-4 sm:p-6">
				<header className="mb-4 flex items-start justify-between gap-4">
					<div>
						<h2 className="font-semibold text-base">Tasks</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{activeTaskCount === 0
								? "No active commitments"
								: `${activeTaskCount} active ${activeTaskCount === 1 ? "commitment" : "commitments"}`}
						</p>
					</div>
				</header>
				{tasksQuery.data?.truncated ? (
					<p className="mb-4 rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm">
						Showing the 500 most recently active Tasks. Use a phase filter
						through the API to inspect older history.
					</p>
				) : null}

				{tasks.length === 0 ? (
					<div className="flex min-h-80 items-center justify-center rounded-lg border border-border border-dashed px-6 text-center">
						<div className="max-w-md">
							<CheckCircleIcon
								aria-hidden="true"
								className="mx-auto size-8 text-muted-foreground"
							/>
							<h3 className="mt-3 font-medium text-sm">No Tasks yet</h3>
							<p className="mt-1 text-muted-foreground text-sm leading-6">
								Tasks begin in Messages when someone gives a person or Agent a
								clear deliverable. Small questions and quick actions stay in the
								conversation.
							</p>
						</div>
					</div>
				) : (
					<>
						<div className="grid items-start gap-4 md:grid-cols-3">
							{ACTIVE_COLUMNS.map((column) => (
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
										selectedTaskId={selectedTaskId}
										selfProfileId={input.openMeldProfileId}
										tasks={doneTasks}
									/>
									<TaskHistory
										label="Canceled"
										onOpenTask={setSelectedTaskId}
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
				busy={selectedTask !== null && pendingTaskId === selectedTask.taskId}
				key={selectedTask?.taskId ?? "closed"}
				members={members}
				onMutate={async (body) => {
					if (!selectedTask) {
						return false;
					}
					return await mutateTask(selectedTask.taskId, body);
				}}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedTaskId(null);
					}
				}}
				onOpenThread={input.onOpenThread}
				open={selectedTask !== null}
				selfProfileId={input.openMeldProfileId}
				task={selectedTask}
			/>
		</div>
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
	input: Omit<Parameters<typeof TaskColumn>[0], "column"> & { label: string }
) {
	if (input.tasks.length === 0) {
		return null;
	}
	return (
		<details className="rounded-lg border border-border">
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

function SpaceTasksSkeleton() {
	return (
		<output aria-label="Loading Tasks" className="block p-4 sm:p-6">
			<div className="grid gap-4 md:grid-cols-3">
				{ACTIVE_COLUMNS.map((column) => (
					<div key={column.phase}>
						<Skeleton className="mb-3 h-8 w-32" />
						<Skeleton className="h-24 w-full rounded-lg" />
					</div>
				))}
			</div>
		</output>
	);
}
