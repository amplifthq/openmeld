"use client";

import {
	SPACE_TASK_COMPLETION_CONDITION_MAX_CHARS,
	SPACE_TASK_COMPLETION_CONDITION_MAX_ITEMS,
	SPACE_TASK_DESCRIPTION_MAX_CHARS,
	SPACE_TASK_RESULT_SUMMARY_MAX_CHARS,
	SPACE_TASK_REVIEW_FEEDBACK_MAX_CHARS,
	SPACE_TASK_TITLE_MAX_CHARS,
} from "@openmeld/schemas/schemas";
import type {
	MutateSpaceTaskBody,
	Project,
	SpaceTask,
	SpaceTaskAction,
	SpaceTaskEvent,
	SpaceTaskResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Textarea } from "@openmeld/ui/components/textarea";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	ArrowSquareOutIcon,
	RobotIcon,
	UserIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, useState } from "react";
import { Drawer } from "vaul";
import { TaskMemberSelect } from "./space-task-draft-fields";
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
	commonAgentIds: ReadonlySet<string>;
	outsideCommonAgents: readonly {
		profileId: string;
		profileName: string;
		ownerName: string | null;
	}[];
	onAddAndAssign: (profileId: string) => Promise<{
		membership: "confirmed" | "unknown";
		assigned: boolean;
		message: string | null;
	}>;
	spaceName: string;
	detail?: SpaceTaskResponse;
	error: boolean;
	loading: boolean;
	members: readonly SpaceTaskMember[];
	onMutate: (body: MutateSpaceTaskBody) => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
	onOpenThread?: (threadId: string) => void;
	onRefresh: () => void;
	open: boolean;
	projects: readonly Project[];
	selfProfileId?: string;
	sourceHref?: string;
	task: SpaceTask | null;
};

export function SpaceTaskDetailDrawer(input: SpaceTaskDetailDrawerProps) {
	const task = input.detail?.task ?? input.task;
	const mutate: MutateTask = (body) =>
		task
			? input.onMutate({
					...body,
					expectedRevision: task.revision,
					operationId: crypto.randomUUID(),
				} as MutateSpaceTaskBody)
			: Promise.resolve(false);
	return (
		<Drawer.Root
			autoFocus
			direction="right"
			modal={false}
			onOpenChange={input.onOpenChange}
			open={input.open}
		>
			<Drawer.Portal>
				<Drawer.Content
					className="fixed top-0 right-0 bottom-0 z-50 flex border-border border-l bg-background shadow-sm outline-none motion-reduce:transition-none"
					data-testid="space-task-detail-drawer"
					style={
						{
							"--initial-transform": "calc(100% + 1px)",
							width: "min(32rem, 100vw)",
						} as CSSProperties
					}
				>
					<div className="flex min-h-0 w-full flex-col">
						<header className="flex shrink-0 items-start justify-between gap-3 border-border border-b px-5 py-4">
							<div className="min-w-0">
								<div className="flex items-start gap-2">
									<Drawer.Title className="min-w-0 font-medium text-base leading-6">
										{task?.title ?? "Task details"}
									</Drawer.Title>
									{task ? (
										<Badge className="mt-0.5 shrink-0" variant="outline">
											{formatSpaceTaskPhase(task.phase)}
										</Badge>
									) : null}
								</div>
								{task ? (
									<p className="mt-1 text-muted-foreground text-xs">
										Requested by {task.requestedBy.profileName}
									</p>
								) : null}
								<Drawer.Description className="mt-1 text-sm">
									{task
										? describeSpaceTaskAttention({
												selfProfileId: input.selfProfileId,
												task,
											})
										: "Read the brief, result, and next actions."}
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
							{input.loading && !task ? (
								<output className="mb-4 block text-muted-foreground text-sm">
									Loading Task details…
								</output>
							) : null}
							{input.error ? (
								<div
									className="mb-4 rounded-md border border-border p-3 text-sm"
									role="alert"
								>
									<p>
										Task details couldn't load. Refresh to see available
										actions.
									</p>
									<Button
										className="mt-2"
										onClick={input.onRefresh}
										size="sm"
										variant="outline"
									>
										Try again
									</Button>
								</div>
							) : null}
							{task ? (
								<SpaceTaskDetailBody
									allowedActions={
										input.error || !input.selfProfileId
											? []
											: (input.detail?.allowedActions ?? [])
									}
									busy={input.busy}
									commonAgentIds={input.commonAgentIds}
									events={input.detail?.events ?? []}
									key={task.taskId}
									members={input.members}
									mutate={mutate}
									onAddAndAssign={input.onAddAndAssign}
									onOpenThread={input.onOpenThread}
									onRefresh={input.onRefresh}
									outsideCommonAgents={input.outsideCommonAgents}
									pendingActions={input.detail?.pendingActions ?? []}
									projects={input.projects}
									selfProfileId={input.selfProfileId}
									sourceHref={input.sourceHref}
									spaceName={input.spaceName}
									task={task}
								/>
							) : null}
						</ScrollArea>
					</div>
				</Drawer.Content>
			</Drawer.Portal>
		</Drawer.Root>
	);
}

type TaskControlInput = {
	allowedActions: readonly SpaceTaskAction[];
	busy: boolean;
	commonAgentIds: ReadonlySet<string>;
	mutate: MutateTask;
	selfProfileId?: string;
	task: SpaceTask;
};

function formatEventAttribution(actor: SpaceTaskEvent["actor"]) {
	return "provider" in actor ? "GitHub" : actor.profileName;
}

function formatResultAttribution(actor: SpaceTaskEvent["actor"]) {
	return "provider" in actor
		? "Recorded from GitHub"
		: `Submitted by ${actor.profileName}`;
}

function SpaceTaskDetailBody(
	input: TaskControlInput & {
		events: readonly SpaceTaskEvent[];
		pendingActions: NonNullable<SpaceTaskResponse["pendingActions"]>;
		members: readonly SpaceTaskMember[];
		projects: readonly Project[];
		outsideCommonAgents: SpaceTaskDetailDrawerProps["outsideCommonAgents"];
		onAddAndAssign: SpaceTaskDetailDrawerProps["onAddAndAssign"];
		spaceName: string;
		onOpenThread?: (threadId: string) => void;
		onRefresh: () => void;
		sourceHref?: string;
	}
) {
	const task = input.task;
	return (
		<div>
			{task.description ? (
				<p className="whitespace-pre-wrap break-words text-sm">
					{task.description}
				</p>
			) : null}
			{task.completionConditions.length > 0 ? (
				<div className="mt-4">
					<p className="font-medium text-muted-foreground text-xs">Done when</p>
					<ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
						{task.completionConditions.map((condition, index) => (
							<li key={`${index}-${condition}`}>{condition}</li>
						))}
					</ul>
				</div>
			) : null}
			<TaskSourceLink
				onOpenThread={input.onOpenThread}
				sourceHref={input.sourceHref}
				threadId={task.threadId}
			/>
			<TaskProjectsSection
				allowed={input.allowedActions.includes("set_projects")}
				busy={input.busy}
				mutate={input.mutate}
				projects={input.projects}
				task={task}
			/>
			{input.allowedActions.includes("update_brief") ? (
				<TaskBriefEditor {...input} />
			) : null}
			{task.externalWorkItems.length > 0 ? (
				<div className="mt-4">
					<p className="font-medium text-muted-foreground text-xs">
						Linked issues
					</p>
					<ul className="mt-1 space-y-1 text-sm">
						{task.externalWorkItems.map((item) => (
							<li
								key={
									item.provider === "github"
										? `${item.owner}/${item.repo}#${item.number}`
										: item.id
								}
							>
								<a
									className="underline underline-offset-2"
									href={item.url}
									rel="noreferrer"
									target="_blank"
								>
									{item.provider === "github"
										? `${item.owner}/${item.repo}#${item.number}`
										: item.identifier}
								</a>
								<span className="ml-2 text-muted-foreground">
									{item.provider === "linear"
										? "Status not monitored"
										: (item.lastObservedState ?? "Status not checked")}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{task.result ? (
				<section className="mt-4 rounded-md bg-muted/50 p-3">
					<h3 className="font-medium text-xs">
						Result {task.result.resultRevision}
					</h3>
					<p className="mt-1 whitespace-pre-wrap break-words text-sm">
						{task.result.summary}
					</p>
					<p className="mt-2 text-muted-foreground text-xs">
						{formatResultAttribution(task.result.submittedBy)}
					</p>
				</section>
			) : null}
			{task.review ? (
				<section className="mt-3 rounded-md border border-border p-3">
					<h3 className="font-medium text-xs">
						{task.review.decision === "accepted"
							? "Accepted"
							: "Changes requested"}{" "}
						· Result {task.review.resultRevision}
					</h3>
					{task.review.feedback ? (
						<p className="mt-1 whitespace-pre-wrap break-words text-sm">
							{task.review.feedback}
						</p>
					) : null}
					<p className="mt-2 text-muted-foreground text-xs">
						Reviewed by {task.review.reviewedBy.profileName}
					</p>
				</section>
			) : null}
			<div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
				{input.allowedActions.includes("assign") ? null : (
					<TaskRole label="Assignee" value={task.assignee} />
				)}
				{input.allowedActions.includes("set_reviewer") ? null : (
					<TaskRole fallback="None" label="Reviewer" value={task.reviewer} />
				)}
			</div>
			{input.pendingActions.length > 0 ? (
				<section
					aria-label="Task delivery"
					className="mt-4 rounded-md border border-border p-3"
				>
					<p className="font-medium text-xs">Delivery status</p>
					<ul className="mt-2 space-y-2 text-sm">
						{input.pendingActions.map((action, index) => (
							<li key={`${action.kind}-${index}`}>
								{formatTaskDeliveryKind(action.kind)}:{" "}
								{action.state === "pending" ? "pending" : "needs attention"}.
								{action.error ? (
									<span className="block text-muted-foreground">
										{action.error}
									</span>
								) : null}
							</li>
						))}
					</ul>
					<Button
						className="mt-2"
						onClick={input.onRefresh}
						size="sm"
						variant="outline"
					>
						Refresh status
					</Button>
				</section>
			) : null}
			<TaskAssignmentControls {...input} />
			{input.allowedActions.includes("mark_in_progress") ? (
				<Button
					className="mt-4 w-full"
					disabled={input.busy}
					onClick={() => input.mutate({ action: "mark_in_progress" })}
					size="sm"
				>
					Mark in progress
				</Button>
			) : null}
			{input.allowedActions.includes("submit_result") ? (
				<TaskResultControl {...input} />
			) : null}
			{input.allowedActions.includes("review") ? (
				<TaskReviewControl {...input} key={task.result?.resultRevision} />
			) : null}
			{task.needsHumanDecision ? (
				<div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
					<p className="text-sm">
						Two automatic rework rounds did not pass review. A human requester
						or Space owner must decide how to proceed.
					</p>
					{input.allowedActions.includes("continue_rework") ? (
						<Button
							className="mt-2"
							disabled={input.busy}
							onClick={() =>
								input.mutate({
									action: "continue_rework",
									reason: "Authorized another correction.",
								})
							}
							size="sm"
							variant="outline"
						>
							Authorize another correction
						</Button>
					) : null}
				</div>
			) : null}
			<TaskLifecycleControls {...input} />
			{input.events.length > 0 ? (
				<details className="mt-5 border-border border-t pt-3">
					<summary className="cursor-pointer font-medium text-sm">
						Activity · {input.events.length}
					</summary>
					<ol className="mt-3 space-y-3">
						{input.events.map((event) => (
							<li className="text-xs" key={event.eventId}>
								<p className="font-medium">
									{formatTaskEvent(event.type)} ·{" "}
									{formatEventAttribution(event.actor)}
								</p>
								{event.detail ? (
									<p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
										{event.detail}
									</p>
								) : null}
								<time
									className="mt-1 block text-muted-foreground"
									dateTime={event.createdAt}
								>
									{new Date(event.createdAt).toLocaleString()}
								</time>
							</li>
						))}
					</ol>
				</details>
			) : null}
		</div>
	);
}

function TaskProjectsSection(input: {
	allowed: boolean;
	busy: boolean;
	mutate: MutateTask;
	projects: readonly Project[];
	task: SpaceTask;
}) {
	const [editing, setEditing] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const names = input.task.projectIds.map(
		(id) =>
			input.projects.find((project) => project.id === id)?.name ??
			"Unavailable Project"
	);
	return (
		<section className="mt-4 border-border border-t pt-4">
			<div className="flex items-center justify-between gap-2">
				<h3 className="font-medium text-muted-foreground text-xs">Projects</h3>
				{input.allowed &&
				(input.projects.length > 0 || input.task.projectIds.length > 0) &&
				!editing ? (
					<Button
						onClick={() => {
							setSelected(input.task.projectIds);
							setEditing(true);
						}}
						size="sm"
						variant="outline"
					>
						Edit Projects
					</Button>
				) : null}
			</div>
			<p className="mt-1 text-sm">
				{names.length > 0 ? names.join(", ") : "No Project associated"}
			</p>
			{editing ? (
				<form
					className="mt-3 grid gap-3 rounded-md border p-3"
					onSubmit={async (event) => {
						event.preventDefault();
						if (
							await input.mutate({
								action: "set_projects",
								projectIds: selected,
							})
						) {
							setEditing(false);
						}
					}}
				>
					<p className="text-muted-foreground text-xs">
						Choose the work scope for this Task. This does not start an Agent or
						change access.
					</p>
					{selected
						.filter(
							(id) => !input.projects.some((project) => project.id === id)
						)
						.map((id) => (
							<div
								className="flex items-center justify-between gap-2 text-sm"
								key={id}
							>
								<span>Unavailable Project</span>
								<Button
									aria-label="Remove unavailable Project"
									disabled={input.busy}
									onClick={() =>
										setSelected((current) =>
											current.filter((projectId) => projectId !== id)
										)
									}
									size="sm"
									type="button"
									variant="outline"
								>
									Remove
								</Button>
							</div>
						))}
					{input.projects.map((project) => (
						<label className="flex items-center gap-2 text-sm" key={project.id}>
							<input
								checked={selected.includes(project.id)}
								disabled={input.busy}
								onChange={(event) =>
									setSelected((current) =>
										event.target.checked
											? [...current, project.id]
											: current.filter((id) => id !== project.id)
									)
								}
								type="checkbox"
							/>
							{project.name}
						</label>
					))}
					<div className="flex gap-2">
						<Button disabled={input.busy} size="sm" type="submit">
							Save Projects
						</Button>
						<Button
							disabled={input.busy}
							onClick={() => setEditing(false)}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
					</div>
				</form>
			) : null}
		</section>
	);
}

function TaskBriefEditor(input: TaskControlInput) {
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState(input.task.title);
	const [description, setDescription] = useState(input.task.description ?? "");
	const [conditions, setConditions] = useState(
		input.task.completionConditions.join("\n")
	);
	const completionConditions = conditions
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const valid =
		title.trim() &&
		completionConditions.length <= SPACE_TASK_COMPLETION_CONDITION_MAX_ITEMS &&
		completionConditions.every(
			(line) => line.length <= SPACE_TASK_COMPLETION_CONDITION_MAX_CHARS
		);
	if (!editing) {
		return (
			<Button
				className="mt-3 block"
				onClick={() => {
					setTitle(input.task.title);
					setDescription(input.task.description ?? "");
					setConditions(input.task.completionConditions.join("\n"));
					setEditing(true);
				}}
				size="sm"
				variant="outline"
			>
				Edit brief
			</Button>
		);
	}
	return (
		<form
			className="mt-4 space-y-3 rounded-md border border-border p-3"
			onSubmit={async (event) => {
				event.preventDefault();
				if (
					valid &&
					(await input.mutate({
						action: "update_brief",
						title: title.trim(),
						description: description.trim() || null,
						completionConditions,
					}))
				) {
					setEditing(false);
				}
			}}
		>
			<label className="block text-xs" htmlFor={`${input.task.taskId}-title`}>
				Title
				<Input
					className="mt-1"
					id={`${input.task.taskId}-title`}
					maxLength={SPACE_TASK_TITLE_MAX_CHARS}
					onChange={(event) => setTitle(event.target.value)}
					required
					value={title}
				/>
			</label>
			<label className="block text-xs" htmlFor={`${input.task.taskId}-brief`}>
				Brief
				<Textarea
					className="mt-1"
					id={`${input.task.taskId}-brief`}
					maxLength={SPACE_TASK_DESCRIPTION_MAX_CHARS}
					onChange={(event) => setDescription(event.target.value)}
					rows={4}
					value={description}
				/>
			</label>
			<label
				className="block text-xs"
				htmlFor={`${input.task.taskId}-conditions`}
			>
				Done when · one condition per line
				<Textarea
					className="mt-1"
					id={`${input.task.taskId}-conditions`}
					onChange={(event) => setConditions(event.target.value)}
					rows={3}
					value={conditions}
				/>
			</label>
			{valid ? null : (
				<p className="text-destructive text-xs">
					Add a title and up to {SPACE_TASK_COMPLETION_CONDITION_MAX_ITEMS}{" "}
					conditions of {SPACE_TASK_COMPLETION_CONDITION_MAX_CHARS} characters
					each.
				</p>
			)}
			<div className="flex gap-2">
				<Button disabled={input.busy || !valid} size="sm" type="submit">
					Save brief
				</Button>
				<Button
					disabled={input.busy}
					onClick={() => setEditing(false)}
					size="sm"
					type="button"
					variant="ghost"
				>
					Discard edits
				</Button>
			</div>
		</form>
	);
}

function TaskAssignmentControls(
	input: TaskControlInput & {
		members: readonly SpaceTaskMember[];
		outsideCommonAgents: SpaceTaskDetailDrawerProps["outsideCommonAgents"];
		onAddAndAssign: SpaceTaskDetailDrawerProps["onAddAndAssign"];
		spaceName: string;
	}
) {
	const [addingProfileId, setAddingProfileId] = useState<string | null>(null);
	const [outcome, setOutcome] = useState<string | null>(null);
	const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set());
	return (
		<div className="mt-3 grid gap-2 sm:grid-cols-2">
			{input.allowedActions.includes("assign") ? (
				<MemberSelect
					commonAgentIds={input.commonAgentIds}
					disabled={input.busy}
					label="Assignee"
					members={input.members.filter(
						(member) => member.profileId !== input.task.reviewer?.profileId
					)}
					onChange={(profileId) =>
						input.mutate({ action: "assign", assigneeProfileId: profileId })
					}
					value={input.task.assignee?.profileId ?? ""}
				/>
			) : null}
			{input.allowedActions.includes("set_reviewer") ? (
				<MemberSelect
					disabled={input.busy}
					label="Reviewer"
					members={input.members.filter(
						(member) => member.profileId !== input.task.assignee?.profileId
					)}
					onChange={(profileId) =>
						input.mutate({
							action: "set_reviewer",
							reviewerProfileId: profileId,
						})
					}
					value={input.task.reviewer?.profileId ?? ""}
				/>
			) : null}
			{input.allowedActions.includes("assign") &&
			input.outsideCommonAgents.some(
				(agent) => !addedIds.has(agent.profileId)
			) ? (
				<div className="grid gap-2 rounded-md border p-3 text-sm sm:col-span-2">
					<p className="font-medium">Common Agents outside this Space</p>
					{input.outsideCommonAgents
						.filter((agent) => !addedIds.has(agent.profileId))
						.map((agent) => (
							<div className="grid gap-1" key={agent.profileId}>
								<p>
									{agent.profileName}
									{agent.ownerName ? ` · Owner: ${agent.ownerName}` : ""}
								</p>
								<p className="text-muted-foreground text-xs">
									Add this Agent{agent.ownerName ? " and its owner" : ""} to{" "}
									{input.spaceName}, then assign the Task. They will see this
									Space.
								</p>
								<Button
									disabled={input.busy || addingProfileId !== null}
									onClick={async () => {
										setAddingProfileId(agent.profileId);
										setOutcome(null);
										try {
											const result = await input.onAddAndAssign(
												agent.profileId
											);
											setOutcome(
												result.message ??
													`${agent.profileName} is in this Space and was assigned.`
											);
											if (result.membership === "confirmed") {
												setAddedIds(
													(current) => new Set([...current, agent.profileId])
												);
											}
										} finally {
											setAddingProfileId(null);
										}
									}}
									size="sm"
									type="button"
									variant="outline"
								>
									{addingProfileId === agent.profileId
										? "Adding…"
										: "Add and assign"}
								</Button>
							</div>
						))}
				</div>
			) : null}
			{outcome ? (
				<output className="text-sm sm:col-span-2">{outcome}</output>
			) : null}
		</div>
	);
}

function TaskResultControl(input: TaskControlInput) {
	const [summary, setSummary] = useState("");
	return (
		<div className="mt-4 space-y-2">
			<label
				className="font-medium text-xs"
				htmlFor={`${input.task.taskId}-result`}
			>
				Result summary
			</label>
			<Textarea
				id={`${input.task.taskId}-result`}
				maxLength={SPACE_TASK_RESULT_SUMMARY_MAX_CHARS}
				onChange={(event) => setSummary(event.target.value)}
				placeholder="What changed, where the result is, and how it was verified"
				rows={3}
				value={summary}
			/>
			<Button
				disabled={input.busy || !summary.trim()}
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

function TaskReviewControl(input: TaskControlInput) {
	const [feedback, setFeedback] = useState("");
	const result = input.task.result;
	if (!result) {
		return null;
	}
	const override = input.task.reviewer?.profileId !== input.selfProfileId;
	return (
		<div className="mt-4 space-y-2">
			<label
				className="font-medium text-xs"
				htmlFor={`${input.task.taskId}-review`}
			>
				Review note{override ? " · required for an owner override" : ""}
			</label>
			<Textarea
				id={`${input.task.taskId}-review`}
				maxLength={SPACE_TASK_REVIEW_FEEDBACK_MAX_CHARS}
				onChange={(event) => setFeedback(event.target.value)}
				placeholder={
					override
						? "Explain why you are overriding the assigned reviewer"
						: "Optional when accepting; required when requesting changes"
				}
				rows={2}
				value={feedback}
			/>
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={input.busy || (override && !feedback.trim())}
					onClick={() =>
						input.mutate({
							action: "review",
							decision: "accepted",
							expectedResultRevision: result.resultRevision,
							feedback: feedback.trim() || null,
						})
					}
					size="sm"
				>
					Accept result {result.resultRevision}
				</Button>
				<Button
					disabled={input.busy || !feedback.trim()}
					onClick={() =>
						input.mutate({
							action: "review",
							decision: "changes_requested",
							expectedResultRevision: result.resultRevision,
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

function TaskLifecycleControls(input: TaskControlInput) {
	if (input.allowedActions.includes("cancel")) {
		return (
			<Button
				className="mt-3"
				disabled={input.busy}
				onClick={() =>
					input.mutate({ action: "cancel", reason: "Canceled the Task." })
				}
				size="sm"
				variant="ghost"
			>
				Cancel task
			</Button>
		);
	}
	if (input.allowedActions.includes("reopen")) {
		return (
			<Button
				className="mt-3"
				disabled={input.busy}
				onClick={() =>
					input.mutate({ action: "reopen", reason: "Reopened the Task." })
				}
				size="sm"
				variant="outline"
			>
				Reopen task
			</Button>
		);
	}
	return null;
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
				{input.value ? (
					<Icon aria-hidden="true" className="size-3.5 shrink-0" />
				) : null}
				{input.value?.profileName ?? input.fallback ?? "Unassigned"}
			</p>
		</div>
	);
}

function TaskSourceLink(input: {
	onOpenThread?: (threadId: string) => void;
	sourceHref?: string;
	threadId: string | null;
}) {
	if (!(input.sourceHref || (input.threadId && input.onOpenThread))) {
		return null;
	}
	return (
		<div className="mt-3 flex flex-wrap gap-3">
			{input.sourceHref ? (
				<a
					className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
					href={input.sourceHref}
				>
					<ArrowSquareOutIcon aria-hidden="true" /> View message
				</a>
			) : null}
			{input.threadId && input.onOpenThread ? (
				<Button
					className="px-0"
					onClick={() => input.onOpenThread?.(input.threadId ?? "")}
					size="sm"
					variant="link"
				>
					Open discussion
				</Button>
			) : null}
		</div>
	);
}

function MemberSelect(input: {
	commonAgentIds?: ReadonlySet<string>;
	disabled: boolean;
	label: string;
	members: readonly SpaceTaskMember[];
	onChange: (profileId: string | null) => void;
	value: string;
}) {
	return <TaskMemberSelect {...input} />;
}

function formatTaskEvent(type: SpaceTaskEvent["type"]): string {
	const labels: Record<SpaceTaskEvent["type"], string> = {
		created: "Created",
		assigned: "Assignment changed",
		brief_updated: "Brief updated",
		projects_set: "Projects changed",
		reviewer_set: "Reviewer changed",
		marked_in_progress: "Work started",
		result_submitted: "Result submitted",
		review_accepted: "Review accepted",
		changes_requested: "Changes requested",
		canceled: "Canceled",
		reopened: "Reopened",
		rework_continued: "Further rework authorized",
		external_work_item_attached: "Issue linked",
		external_work_item_detached: "Issue unlinked",
		external_work_item_observed: "GitHub issue status checked",
	};
	return labels[type];
}

function formatTaskDeliveryKind(
	kind: NonNullable<SpaceTaskResponse["pendingActions"]>[number]["kind"]
): string {
	switch (kind) {
		case "handoff":
			return "Review or rework handoff";
		case "completion":
			return "Completion notice";
		case "stop":
			return "Execution stop request";
		case "github_projection":
			return "GitHub issue link sync";
		case "project_projection":
			return "Project work link sync";
		default:
			return "Task delivery";
	}
}
