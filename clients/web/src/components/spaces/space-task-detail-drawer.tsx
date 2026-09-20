"use client";

import type { MutateSpaceTaskBody, SpaceTask } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Textarea } from "@openmeld/ui/components/textarea";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	CircleNotchIcon,
	RobotIcon,
	UserIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, useState } from "react";
import { Drawer } from "vaul";
import {
	describeSpaceTaskAttention,
	formatSpaceTaskPhase,
	type SpaceTaskMember,
} from "./space-task-presentation";

type TaskMutationWithoutControl<T> = T extends unknown
	? Omit<T, "expectedRevision" | "operationId">
	: never;
type SpaceTaskMutationDraft = TaskMutationWithoutControl<MutateSpaceTaskBody>;
type MutateTask = (body: SpaceTaskMutationDraft) => Promise<boolean>;

export type SpaceTaskDetailDrawerProps = {
	busy: boolean;
	members: readonly SpaceTaskMember[];
	onMutate: (body: MutateSpaceTaskBody) => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
	onOpenThread?: (threadId: string) => void;
	open: boolean;
	selfProfileId?: string;
	task: SpaceTask | null;
};

export function SpaceTaskDetailDrawer(input: SpaceTaskDetailDrawerProps) {
	const task = input.task;
	const mutate = (body: SpaceTaskMutationDraft) => {
		if (!task) {
			return Promise.resolve(false);
		}
		return input.onMutate({
			...body,
			expectedRevision: task.revision,
			operationId: crypto.randomUUID(),
		} as MutateSpaceTaskBody);
	};

	return (
		<Drawer.Root
			autoFocus
			direction="right"
			onOpenChange={input.onOpenChange}
			open={input.open && task !== null}
		>
			<Drawer.Portal>
				<Drawer.Overlay className="fixed inset-0 z-40 bg-background/55 backdrop-blur-[2px] motion-reduce:transition-none" />
				<Drawer.Content
					className="fixed top-0 right-0 bottom-0 z-50 flex border-border border-l bg-background shadow-2xl outline-none motion-reduce:transition-none"
					data-testid="space-task-detail-drawer"
					style={
						{
							"--initial-transform": "calc(100% + 1px)",
							width: "min(32rem, 100vw)",
						} as CSSProperties
					}
				>
					{task ? (
						<div className="flex min-h-0 w-full flex-col">
							<header className="flex shrink-0 items-start justify-between gap-3 border-border border-b px-5 py-4">
								<div className="min-w-0">
									<div className="flex items-start gap-2">
										<Drawer.Title className="min-w-0 font-medium text-base leading-6">
											{task.title}
										</Drawer.Title>
										<Badge className="mt-0.5 shrink-0" variant="outline">
											{formatSpaceTaskPhase(task.phase)}
										</Badge>
									</div>
									<p className="mt-1 text-muted-foreground text-xs">
										Requested by {task.requestedBy.profileName}
									</p>
									<Drawer.Description className="mt-1 text-sm">
										{describeSpaceTaskAttention({
											selfProfileId: input.selfProfileId,
											task,
										})}
									</Drawer.Description>
								</div>
								<Drawer.Close asChild>
									<Button
										aria-label="Close task details"
										className="-mr-1 shrink-0"
										size="icon-sm"
										type="button"
										variant="ghost"
									>
										<XIcon aria-hidden="true" />
									</Button>
								</Drawer.Close>
							</header>
							<ScrollArea
								className="min-h-0 flex-1"
								contentClassName="px-5 py-5"
								data-vaul-no-drag
								orientation="vertical"
							>
								<SpaceTaskDetailBody
									busy={input.busy}
									members={input.members}
									mutate={mutate}
									onOpenThread={input.onOpenThread}
									selfProfileId={input.selfProfileId}
									task={task}
								/>
							</ScrollArea>
						</div>
					) : null}
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

function SpaceTaskDetailBody(input: {
	busy: boolean;
	members: readonly SpaceTaskMember[];
	mutate: MutateTask;
	onOpenThread?: (threadId: string) => void;
	selfProfileId?: string;
	task: SpaceTask;
}) {
	const task = input.task;
	return (
		<div>
			{task.description ? (
				<p className="whitespace-pre-wrap text-sm">{task.description}</p>
			) : null}
			{task.completionConditions.length > 0 ? (
				<div className={task.description ? "mt-4" : undefined}>
					<p className="font-medium text-muted-foreground text-xs">Done when</p>
					<ul className="mt-1 space-y-1 text-sm">
						{task.completionConditions.map((condition) => (
							<li className="flex gap-2" key={condition}>
								<CheckCircleIcon
									aria-hidden="true"
									className="mt-0.5 size-4 shrink-0 text-muted-foreground"
								/>
								<span>{condition}</span>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{task.externalWorkItems.length > 0 ? (
				<div className="mt-4">
					<p className="font-medium text-muted-foreground text-xs">
						Linked GitHub issues
					</p>
					<ul className="mt-1 space-y-1 text-sm">
						{task.externalWorkItems.map((item) => (
							<li
								key={`${item.provider}:${item.owner}/${item.repo}#${item.number}`}
							>
								<a
									className="text-foreground underline-offset-2 hover:underline"
									href={item.url}
									rel="noreferrer"
									target="_blank"
								>
									{item.owner}/{item.repo}#{item.number}
								</a>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
				<TaskRole label="Assignee" value={task.assignee} />
				<TaskRole
					fallback="Submission completes the Task"
					label="Reviewer"
					value={task.reviewer}
				/>
			</div>

			{input.selfProfileId ? (
				<>
					<TaskAssignmentControls input={input} mutate={input.mutate} />
					<TaskWorkflowControls input={input} mutate={input.mutate} />
				</>
			) : null}

			{task.result ? (
				<div className="mt-4 rounded-md bg-muted/50 p-3">
					<p className="font-medium text-xs">Latest result</p>
					<p className="mt-1 whitespace-pre-wrap text-sm">
						{task.result.summary}
					</p>
				</div>
			) : null}
			{task.threadId && input.onOpenThread ? (
				<Button
					className="mt-3 px-0"
					onClick={() => input.onOpenThread?.(task.threadId ?? "")}
					size="sm"
					variant="link"
				>
					<ArrowSquareOutIcon aria-hidden="true" />
					Open source Thread
				</Button>
			) : null}
			<TaskLifecycleControls input={input} mutate={input.mutate} />
		</div>
	);
}

function TaskAssignmentControls(input: {
	input: {
		busy: boolean;
		members: readonly SpaceTaskMember[];
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	const task = input.input.task;
	const isRequester = task.requestedBy.profileId === input.input.selfProfileId;
	const active = task.phase !== "done" && task.phase !== "canceled";
	if (!(isRequester && active)) {
		return null;
	}
	return (
		<div className="mt-3 grid gap-2 sm:grid-cols-2">
			<MemberSelect
				disabled={input.input.busy}
				label="Assign"
				members={input.input.members.filter(
					(member) => member.profileId !== task.reviewer?.profileId
				)}
				onChange={(profileId) =>
					input.mutate({
						action: "assign",
						assigneeProfileId: profileId,
					})
				}
				value={task.assignee?.profileId ?? ""}
			/>
			<MemberSelect
				disabled={input.input.busy || task.phase === "in_review"}
				label="Review by"
				members={input.input.members.filter(
					(member) => member.profileId !== task.assignee?.profileId
				)}
				onChange={(profileId) =>
					input.mutate({
						action: "set_reviewer",
						reviewerProfileId: profileId,
					})
				}
				value={task.reviewer?.profileId ?? ""}
			/>
		</div>
	);
}

function TaskWorkflowControls(input: {
	input: {
		busy: boolean;
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	return (
		<>
			<TaskStartControl {...input} />
			<TaskResultControl {...input} />
			<TaskReviewControl {...input} />
			<TaskHumanReworkControl {...input} />
		</>
	);
}

function TaskStartControl(input: {
	input: {
		busy: boolean;
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	const task = input.input.task;
	if (
		task.phase !== "to_do" ||
		task.assignee?.profileId !== input.input.selfProfileId
	) {
		return null;
	}
	return (
		<Button
			className="mt-4 w-full"
			disabled={input.input.busy}
			onClick={() => input.mutate({ action: "mark_in_progress" })}
			size="sm"
		>
			{input.input.busy ? <CircleNotchIcon className="animate-spin" /> : null}
			Start work
		</Button>
	);
}

function TaskResultControl(input: {
	input: {
		busy: boolean;
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	const [summary, setSummary] = useState("");
	const task = input.input.task;
	if (
		task.phase !== "in_progress" ||
		task.assignee?.profileId !== input.input.selfProfileId
	) {
		return null;
	}
	return (
		<div className="mt-4 space-y-2">
			<label className="font-medium text-xs" htmlFor={`${task.taskId}-result`}>
				Result summary
			</label>
			<Textarea
				id={`${task.taskId}-result`}
				onChange={(event) => setSummary(event.target.value)}
				placeholder="What changed, where the result is, and how it was verified"
				rows={3}
				value={summary}
			/>
			<Button
				disabled={input.input.busy || !summary.trim()}
				onClick={async () => {
					if (
						await input.mutate({
							action: "submit_result",
							summary: summary.trim(),
						})
					) {
						setSummary("");
					}
				}}
				size="sm"
			>
				Submit result
			</Button>
		</div>
	);
}

function TaskReviewControl(input: {
	input: {
		busy: boolean;
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	const [feedback, setFeedback] = useState("");
	const task = input.input.task;
	if (
		task.phase !== "in_review" ||
		task.reviewer?.profileId !== input.input.selfProfileId
	) {
		return null;
	}
	return (
		<div className="mt-4 space-y-2">
			<label className="font-medium text-xs" htmlFor={`${task.taskId}-review`}>
				Review note
			</label>
			<Textarea
				id={`${task.taskId}-review`}
				onChange={(event) => setFeedback(event.target.value)}
				placeholder="Optional when accepting; required when requesting changes"
				rows={2}
				value={feedback}
			/>
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={input.input.busy}
					onClick={() =>
						input.mutate({
							action: "review",
							decision: "accepted",
							feedback: feedback.trim() || null,
						})
					}
					size="sm"
				>
					Accept
				</Button>
				<Button
					disabled={input.input.busy || !feedback.trim()}
					onClick={() =>
						input.mutate({
							action: "review",
							decision: "changes_requested",
							feedback: feedback.trim(),
						})
					}
					size="sm"
					variant="outline"
				>
					Request changes
				</Button>
			</div>
		</div>
	);
}

function TaskHumanReworkControl(input: {
	input: {
		busy: boolean;
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	const task = input.input.task;
	if (
		!task.needsHumanDecision ||
		task.requestedBy.profileId !== input.input.selfProfileId
	) {
		return null;
	}
	return (
		<div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
			<p className="text-sm">
				Needs decision — two rework rounds did not pass review.
			</p>
			<Button
				className="mt-2"
				disabled={input.input.busy}
				onClick={() =>
					input.mutate({
						action: "continue_rework",
						reason: "Requester authorized another correction.",
					})
				}
				size="sm"
				variant="outline"
			>
				Authorize another correction
			</Button>
		</div>
	);
}

function TaskLifecycleControls(input: {
	input: {
		busy: boolean;
		selfProfileId?: string;
		task: SpaceTask;
	};
	mutate: MutateTask;
}) {
	const task = input.input.task;
	if (task.requestedBy.profileId !== input.input.selfProfileId) {
		return null;
	}
	if (task.phase !== "done" && task.phase !== "canceled") {
		return (
			<Button
				className="mt-3"
				disabled={input.input.busy}
				onClick={() =>
					input.mutate({
						action: "cancel",
						reason: "Requester canceled the Task.",
					})
				}
				size="sm"
				variant="ghost"
			>
				Cancel Task
			</Button>
		);
	}
	return (
		<Button
			className="mt-3"
			disabled={input.input.busy}
			onClick={() =>
				input.mutate({
					action: "reopen",
					reason: "Requester reopened the Task.",
				})
			}
			size="sm"
			variant="outline"
		>
			Reopen Task
		</Button>
	);
}

function TaskRole(input: {
	fallback?: string;
	label: string;
	value: SpaceTask["assignee"];
}) {
	const Icon = input.value?.profileKind === "agent" ? RobotIcon : UserIcon;
	return (
		<div className="min-w-0 rounded-md bg-muted/50 px-2.5 py-2">
			<p className="text-muted-foreground">{input.label}</p>
			<p className="mt-0.5 flex items-center gap-1.5 truncate font-medium">
				{input.value ? <Icon aria-hidden="true" className="size-3.5" /> : null}
				{input.value?.profileName ?? input.fallback ?? "Unassigned"}
			</p>
		</div>
	);
}

function MemberSelect(input: {
	disabled: boolean;
	label: string;
	members: readonly SpaceTaskMember[];
	onChange: (profileId: string | null) => void;
	value: string;
}) {
	return (
		<label className="text-muted-foreground text-xs">
			{input.label}
			<select
				className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-foreground text-sm"
				disabled={input.disabled}
				onChange={(event) => input.onChange(event.target.value || null)}
				value={input.value}
			>
				<option value="">None</option>
				{input.members.map((member) => (
					<option key={member.profileId} value={member.profileId}>
						{member.profileName} ·{" "}
						{member.profileKind === "agent" ? "Agent" : "Person"}
					</option>
				))}
			</select>
		</label>
	);
}
