import type { GetSpaceMessageDetailsResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	postNewTaskFromMessage,
	type SpaceNewTaskSource,
} from "#/lib/spaces/new-task-from-message";
import { spaceQueryKeys } from "#/query/spaces/status";

type WakeTarget =
	GetSpaceMessageDetailsResponse["wakeContext"]["targets"][number];

export function SpaceMessageTaskContext(input: {
	canStartNewTask: boolean;
	data: GetSpaceMessageDetailsResponse;
	profileId?: string;
	spaceId: string;
	spacePassword?: string;
}) {
	const queryClient = useQueryClient();
	const reviewTitleId = useId();
	const [review, setReview] = useState<{
		target: WakeTarget;
		source: SpaceNewTaskSource;
		profileId: string;
	} | null>(null);
	const [sending, setSending] = useState(false);
	const [sentTargets, setSentTargets] = useState<Set<string>>(() => new Set());
	const [error, setError] = useState<string | null>(null);
	const sendingRef = useRef(false);
	const source = input.data.newTaskSource;
	const targets = input.data.wakeContext.targets.filter(
		(target) => target.taskContext
	);
	if (targets.length === 0) {
		return null;
	}
	const startNewTask = async () => {
		if (!review || sendingRef.current || !input.canStartNewTask) {
			return;
		}
		if (review.profileId !== input.profileId) {
			setError(
				"Your acting profile changed. Cancel and review the new task again."
			);
			return;
		}
		const source = review.source;
		sendingRef.current = true;
		setSending(true);
		setError(null);
		try {
			await postNewTaskFromMessage({
				api: createUnscopedWebSpaceApi({ openMeldProfileId: review.profileId }),
				profileId: review.profileId,
				spaceId: input.spaceId,
				spacePassword: input.spacePassword,
				targetProfileId: review.target.targetProfileId,
				source,
			});
			setSentTargets(
				(previous) => new Set([...previous, review.target.targetProfileId])
			);
			setReview(null);
			// Publication was accepted. Execution and the visible reply still come
			// from the normal Space/RuntimeCoordinator projections.
			const keys = [
				spaceQueryKeys.history(input.spaceId, input.profileId),
				spaceQueryKeys.threads(input.spaceId, input.profileId),
				...(source.threadId
					? [
							spaceQueryKeys.threadSignals(
								input.spaceId,
								source.threadId,
								input.profileId
							),
						]
					: []),
			];
			await Promise.allSettled(
				keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
			);
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "The new task could not be confirmed. Try again to check the same request."
			);
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	};
	return (
		<section aria-label="Task context" className="grid gap-3">
			<h3 className="font-medium text-sm">Task context</h3>
			{targets.map((target) => (
				<TaskContextRow
					canStartNewTask={input.canStartNewTask && Boolean(input.profileId)}
					hasSource={Boolean(source)}
					key={target.targetProfileId}
					onReview={() => {
						if (source && input.profileId) {
							setError(null);
							setReview({
								target,
								source: structuredClone(source),
								profileId: input.profileId,
							});
						}
					}}
					pending={sending}
					sent={sentTargets.has(target.targetProfileId)}
					target={target}
				/>
			))}
			{review ? (
				<section
					aria-labelledby={reviewTitleId}
					className="grid gap-3 border-border border-t pt-4 text-sm"
				>
					<h4 className="font-medium" id={reviewTitleId}>
						Start a new task with {review.target.targetLabel ?? "this Agent"}
					</h4>
					<p className="text-muted-foreground">
						You'll send this as a new request from your current profile. Your
						permissions apply; the original requester's approvals aren't carried
						over. The Agent uses its current settings and computer access
						policy. This starts a separate conversation and may repeat work
						already done.
					</p>
					<p className="text-muted-foreground">
						If you already sent this recovery, it returns to the same new task.
						Use the composer to start another task.
					</p>
					<div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm">
						{review.source.text}
					</div>
					{review.source.files?.length ? (
						<p className="text-muted-foreground text-sm">
							Included files:{" "}
							{review.source.files.map((file) => file.name).join(", ")}
						</p>
					) : null}
					<p className="text-muted-foreground text-sm">
						The new request will appear in{" "}
						{review.source.threadId ? "this thread" : "the Space conversation"}.
						Only the selected Agent will be woken.
					</p>
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					<div className="flex justify-end gap-2">
						<Button
							disabled={sending}
							onClick={() => setReview(null)}
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={sending || !input.canStartNewTask}
							onClick={startNewTask}
							type="button"
						>
							{sending ? "Sending…" : "Send new task"}
						</Button>
					</div>
				</section>
			) : null}
		</section>
	);
}

export function taskAccessLabel(task: WakeTarget["taskContext"]): string {
	const assignment = task?.assignment;
	if (assignment?.readStatus !== "found") {
		return "Task context unavailable";
	}
	if (assignment.permissionSource === "agent_settings") {
		return "Agent settings";
	}
	return {
		space_context: "Space context only",
		read_only: "Read-only files",
		workspace: "Restricted project access",
	}[assignment.access];
}

function conversationLabel(task: WakeTarget["taskContext"]): string {
	switch (task?.conversationResume?.status) {
		case "continued":
			return "Continued conversation";
		case "not_bound":
			return "New conversation";
		case "replaced_by_provider":
			return "Conversation replaced by the Agent Controller";
		default:
			return "Conversation start not recorded";
	}
}

function TaskContextRow(input: {
	canStartNewTask: boolean;
	hasSource: boolean;
	onReview: () => void;
	pending: boolean;
	sent: boolean;
	target: WakeTarget;
}) {
	const task = input.target.taskContext;
	const assignment = task?.assignment;
	const found = assignment?.readStatus === "found" ? assignment : null;
	const spaceOnly = found?.access === "space_context";
	const canRecover = spaceOnly && input.canStartNewTask && !input.sent;
	return (
		<div className="grid gap-2 border-border border-l-2 pl-3 text-sm">
			<p className="font-medium">
				{input.target.targetLabel ?? "Agent"} · {taskAccessLabel(task)}
			</p>
			{found ? (
				<p className="text-muted-foreground">
					{conversationLabel(task)} ·{" "}
					{found.workspace === "isolated"
						? "Isolated task folder"
						: "Current working folder"}
				</p>
			) : (
				<p className="text-muted-foreground">
					Effective task settings aren't available for this Wake.
				</p>
			)}
			{spaceOnly && (
				<p className="text-muted-foreground">
					This task has no project checkout. Continuing it keeps its existing
					restrictions.
				</p>
			)}
			{found?.permissionSource === "agent_settings" && (
				<p className="text-muted-foreground">
					Uses the Agent's settings and the computer's file access policy. A
					working folder alone does not determine network or GitHub access.
				</p>
			)}
			{input.sent && (
				<output>New task sent. Follow its progress in the conversation.</output>
			)}
			{canRecover && input.hasSource && (
				<Button
					className="justify-self-start"
					disabled={input.pending}
					onClick={input.onReview}
					size="sm"
					type="button"
					variant="outline"
				>
					Start a new task
				</Button>
			)}
			{canRecover && !input.hasSource && (
				<p className="text-muted-foreground">
					Choose New task in the composer to review the request and its files.
				</p>
			)}
		</div>
	);
}
