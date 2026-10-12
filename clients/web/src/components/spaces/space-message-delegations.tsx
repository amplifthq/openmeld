import type {
	SpaceMessageDelegations as DelegationProjection,
	SpaceMessageDelegatedTask,
} from "@openmeld/schemas/types";
import { buildPublicSpaceEntryUrl } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resolveWakeStopTargetForProgressItem } from "#/lib/spaces/wake-stop-target";
import { spaceMessageDetailsQueryOptions } from "#/query/spaces/message-details";
import {
	delegatedTaskStatus,
	delegatedWorkSummary,
	delegationCompletionLabel,
} from "./space-message-delegations-presentation";
import { taskAccessLabel } from "./space-message-task-context";
import {
	SpaceWakeStopControl,
	type SpaceWakeStopRequestHandler,
	useSpaceWakeStopRequestStatuses,
} from "./space-wake-stop-control";

type DelegationProps = {
	spaceId: string;
	signalId: string;
	openMeldProfileId?: string;
	spacePassword?: string;
	profileNames?: ReadonlyMap<string, string>;
	onJumpToMessage: (signalId: string) => void;
	canJumpToMessage: (signalId: string) => boolean;
	onWakeStopRequest?: SpaceWakeStopRequestHandler;
};

export function SpaceMessageDelegations(
	input: DelegationProps & { data: DelegationProjection }
) {
	const [showMore, setShowMore] = useState(false);
	if (input.data.groups.length === 0) {
		return null;
	}
	return (
		<section aria-label="Delegated work" className="grid min-w-0 gap-3">
			<div>
				<h3 className="font-medium text-sm">Delegated work</h3>
				<p className="text-muted-foreground text-sm">
					{delegatedWorkSummary(input.data)}
				</p>
			</div>
			{input.data.groups.map((group) => (
				<div className="grid min-w-0 gap-3" key={group.delegationId}>
					<p className="text-muted-foreground text-sm">
						{delegationCompletionLabel(
							group,
							input.profileNames?.get(group.coordinatorProfileId) ??
								"The coordinating Agent"
						)}
					</p>
					<ul className="grid gap-3">
						{group.children.map((child) => (
							<DelegatedTaskRow {...input} child={child} key={child.key} />
						))}
					</ul>
				</div>
			))}
			{input.data.nextCursor && showMore ? (
				<MoreDelegations {...input} cursor={input.data.nextCursor} />
			) : null}
			{input.data.nextCursor && !showMore ? (
				<Button
					className="justify-self-start"
					onClick={() => setShowMore(true)}
					size="sm"
					variant="outline"
				>
					Show more delegated work
				</Button>
			) : null}
		</section>
	);
}

function MoreDelegations(input: DelegationProps & { cursor: string }) {
	const query = useQuery(
		spaceMessageDetailsQueryOptions({
			...input,
			delegationCursor: input.cursor,
			enabled: true,
		})
	);
	if (query.isError) {
		return (
			<p role="alert">
				Delegated work could not be loaded.{" "}
				<Button onClick={() => query.refetch()} size="sm" variant="ghost">
					Try again
				</Button>
			</p>
		);
	}
	return query.data?.delegations ? (
		<SpaceMessageDelegations {...input} data={query.data.delegations} />
	) : (
		<p className="text-muted-foreground text-sm">Loading delegated work…</p>
	);
}

function DelegatedTaskRow(
	input: DelegationProps & { child: SpaceMessageDelegatedTask }
) {
	const child = input.child;
	const status = delegatedTaskStatus(child);
	const assignment = child.taskContext?.assignment;
	return (
		<li className="grid min-w-0 gap-2 border-border border-l-2 pl-3 text-sm">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<span className="min-w-0 break-words font-medium">
					{child.role === "fallback" ? "Fallback · " : ""}
					{child.targetLabel ?? "Delegated task"}
				</span>
				<span
					className={
						status === "Failed" || status === "Reply failed"
							? "text-destructive"
							: "text-muted-foreground"
					}
				>
					{status}
				</span>
			</div>
			{child.taskPreview ? (
				<p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
					{child.taskPreview}
				</p>
			) : null}
			{assignment?.readStatus === "found" ? (
				<p className="text-muted-foreground">
					{assignment.workspace === "isolated"
						? "Isolated task folder"
						: "Current working folder"}{" "}
					· {taskAccessLabel(child.taskContext)}
				</p>
			) : null}
			{child.availability === "unavailable" ? (
				<p className="text-muted-foreground">
					This task is not available to view. Its result has not been assumed.
				</p>
			) : null}
			{child.progress?.message && !child.outcome ? (
				<p className="text-muted-foreground">{child.progress.message}</p>
			) : null}
			<DelegatedTaskActions {...input} />
		</li>
	);
}

function DelegatedTaskActions(
	input: DelegationProps & { child: SpaceMessageDelegatedTask }
) {
	const stopRequestStatusBySelectorKey = useSpaceWakeStopRequestStatuses();
	const child = input.child;
	const childSpaceId = child.spaceId;
	const sourceSignalId = child.sourceSignalId;
	if (!(childSpaceId && sourceSignalId)) {
		return null;
	}
	let label = "Open task";
	if (child.progress?.pendingInteraction) {
		label = child.progress.pendingInteraction.canRespond
			? "Respond to pending input"
			: "Open waiting task";
	} else if (
		child.outcome?.status === "failed" ||
		child.outcome?.status === "publication_failed"
	) {
		label = "Open task and recovery";
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			<TaskMessageLink
				{...input}
				childSpaceId={childSpaceId}
				signalId={sourceSignalId}
			>
				{label}
			</TaskMessageLink>
			{child.resultSignalId ? (
				<TaskMessageLink
					{...input}
					childSpaceId={childSpaceId}
					signalId={child.resultSignalId}
				>
					View result
				</TaskMessageLink>
			) : null}
			{input.onWakeStopRequest &&
			childSpaceId === input.spaceId &&
			child.progress &&
			!child.outcome ? (
				<SpaceWakeStopControl
					onStopWake={input.onWakeStopRequest}
					target={resolveWakeStopTargetForProgressItem({
						item: child.progress,
						viewerProfileId: input.openMeldProfileId,
						stopRequestStatusBySelectorKey,
					})}
					variant="details"
				/>
			) : null}
		</div>
	);
}

function TaskMessageLink(
	input: DelegationProps & {
		childSpaceId: string;
		signalId: string;
		children: string;
	}
) {
	if (
		input.childSpaceId === input.spaceId &&
		input.canJumpToMessage(input.signalId)
	) {
		return (
			<Button
				onClick={() => input.onJumpToMessage(input.signalId)}
				size="sm"
				variant="outline"
			>
				{input.children}
			</Button>
		);
	}
	const href = buildPublicSpaceEntryUrl({
		origin: null,
		target: { spaceId: input.childSpaceId, signalId: input.signalId },
	});
	return (
		<a
			className="inline-flex min-h-9 items-center rounded-md border border-border px-3 font-medium text-sm hover:bg-muted focus-visible:outline-2"
			href={href ?? undefined}
		>
			{input.children}
		</a>
	);
}
