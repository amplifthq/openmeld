"use client";

import type {
	CenterAgentTaskDetail,
	CenterAgentTaskEvent,
} from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowUpIcon, RobotIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
} from "#/components/ibelick/prompt-input";
import { Bubble, BubbleContent } from "#/components/spaces/primitives/bubble";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "#/components/spaces/primitives/message";
import { SpaceMessageBody } from "#/components/spaces/space-message-body";
import {
	resolveSpaceMessageBubblePresentationClass,
	resolveSpaceMessageContentLayoutClassName,
	resolveSpaceMessageContentPaddingClassName,
	SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
} from "#/components/spaces/space-message-bubble-style";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import { EMPTY_COMPOSER_DRAFT_CONTENT } from "#/lib/composer-draft-storage";
import {
	continueCurrentCenterAgentTask,
	resolveCenterAgentTaskErrorMessage,
} from "#/lib/organizations/center-agent-tasks";
import { centerAgentTaskQueryKeys } from "#/query/organizations/center-agent-tasks";

type TaskContinuationRequest = {
	text: string;
	version: number;
};

export function useCenterAgentTaskConversation(input: {
	detail: CenterAgentTaskDetail | null | undefined;
	organizationId: string;
	taskId: string;
}) {
	const queryClient = useQueryClient();
	const requesterUserId = input.detail?.task.requesterUserId?.trim() ?? "";
	const composerDraft = useComposerDraft({
		scope: requesterUserId
			? {
					kind: "center_agent_task",
					organizationId: input.organizationId,
					ownerAccountId: requesterUserId,
					taskId: input.taskId,
				}
			: null,
	});
	const composerText = composerDraft.content.text;
	const setComposerText = (text: string) => {
		composerDraft.setContent((currentDraft) => ({
			...currentDraft,
			text,
		}));
	};
	const [pendingReplacement, setPendingReplacement] =
		useState<TaskContinuationRequest | null>(null);
	const continueMutation = useMutation({
		mutationFn: async (request: TaskContinuationRequest) =>
			await continueCurrentCenterAgentTask({
				expectedVersion: request.version,
				idempotencyKey: crypto.randomUUID(),
				organizationId: input.organizationId,
				taskId: input.taskId,
				text: request.text,
			}),
		onSuccess: async (detail) => {
			composerDraft.setContent(EMPTY_COMPOSER_DRAFT_CONTENT);
			setPendingReplacement(null);
			queryClient.setQueryData(
				centerAgentTaskQueryKeys.detail(input.organizationId, detail.task.id),
				detail
			);
			await queryClient.invalidateQueries({
				queryKey: centerAgentTaskQueryKeys.list(input.organizationId),
			});
		},
	});
	const status = input.detail?.task.status;
	const canContinue =
		status === "queued" ||
		status === "running" ||
		status === "needs_attention" ||
		status === "succeeded";
	const replacingActiveInstruction =
		status === "queued" || status === "running";

	return {
		canContinue,
		composerText,
		error: continueMutation.error,
		isPending: continueMutation.isPending,
		mode: replacingActiveInstruction
			? ("replace" as const)
			: ("message" as const),
		pendingReplacement,
		setComposerText,
		setPendingReplacement,
		submit(text: string) {
			if (!input.detail) {
				return;
			}
			const request = { text, version: input.detail.task.version };
			if (replacingActiveInstruction) {
				setPendingReplacement(request);
				return;
			}
			continueMutation.mutate(request);
		},
		confirmReplacement() {
			if (pendingReplacement) {
				continueMutation.mutate(pendingReplacement);
			}
		},
	};
}

export type CenterAgentTaskConversationController = ReturnType<
	typeof useCenterAgentTaskConversation
>;

export function CenterAgentTaskConversationSurface(input: {
	compact?: boolean;
	controller: CenterAgentTaskConversationController;
	detail: CenterAgentTaskDetail;
}) {
	return (
		<section
			className={cn(
				"flex min-h-0 flex-col",
				input.compact ? "min-h-64 flex-1" : "gap-3"
			)}
			data-slot="task-conversation-surface"
		>
			<div
				className={cn(
					"min-h-0",
					input.compact ? "flex-1 overflow-y-auto px-2 py-2" : ""
				)}
			>
				<CenterAgentTaskConversation detail={input.detail} />
			</div>
			{input.controller.error ? (
				<p className="px-3 text-destructive text-sm" role="alert">
					{resolveCenterAgentTaskErrorMessage(
						input.controller.error,
						"continue"
					)}
				</p>
			) : null}
			{input.controller.canContinue ? (
				<div
					className={cn(
						"shrink-0 bg-background",
						input.compact
							? "border-border/70 border-t bg-popover p-3"
							: "sticky bottom-0 z-10 pt-2 pb-1"
					)}
				>
					<CenterAgentTaskComposer
						disabled={input.controller.isPending}
						mode={input.controller.mode}
						onSubmit={input.controller.submit}
						onTextChange={input.controller.setComposerText}
						text={input.controller.composerText}
					/>
				</div>
			) : null}
			<ReplaceTaskInstructionDialog controller={input.controller} />
		</section>
	);
}

export function CenterAgentTaskConversation(input: {
	detail: CenterAgentTaskDetail;
}) {
	const events = [...input.detail.events].sort(
		(left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
	);
	return (
		<section
			aria-labelledby="center-agent-task-conversation-title"
			data-slot="task-conversation"
		>
			<h2 className="sr-only" id="center-agent-task-conversation-title">
				Task conversation
			</h2>
			{events.length === 0 ? (
				<p className="px-4 py-8 text-center text-muted-foreground text-sm">
					The Center Agent will post updates here as work begins.
				</p>
			) : (
				<ol aria-label="Task conversation" className="space-y-1">
					{events.map((event) => (
						<CenterAgentTaskConversationEvent event={event} key={event.id} />
					))}
				</ol>
			)}
		</section>
	);
}

function CenterAgentTaskConversationEvent(input: {
	event: CenterAgentTaskEvent;
}) {
	if (isCenterAgentTaskStatusEvent(input.event)) {
		return (
			<li
				className="flex items-center gap-2 px-3 py-1 text-muted-foreground text-xs"
				data-slot="task-status-event"
			>
				<span aria-hidden="true" className="status-dot bg-border" />
				<p className="whitespace-pre-wrap leading-5">{input.event.text}</p>
			</li>
		);
	}

	const requesterMessage =
		input.event.actor === "requester" &&
		(input.event.kind === "task_created" ||
			input.event.kind === "requester_message");
	const needsAttention = input.event.kind === "needs_attention";
	const align = requesterMessage ? "end" : "start";
	const selfMessageContentLayoutClassName =
		resolveSpaceMessageContentLayoutClassName({ isSelf: requesterMessage });
	return (
		<li className="px-3 py-2">
			<Message align={align} data-space-self-message={String(requesterMessage)}>
				<MessageContent
					className={cn("min-w-0 gap-0", SPACE_MESSAGE_SURFACE_WIDTH_CLASS)}
				>
					<MessageHeader
						className={requesterMessage ? "justify-end px-0" : "gap-1.5 px-0"}
					>
						{requesterMessage ? null : (
							<RobotIcon aria-hidden="true" className="size-3.5" />
						)}
						{needsAttention ? (
							<span aria-hidden="true" className="status-dot bg-amber-400" />
						) : null}
						<span>{resolveTaskEventActorLabel(input.event)}</span>
					</MessageHeader>
					<Bubble align={align}>
						<BubbleContent
							className={cn(
								"flex min-w-0 flex-col gap-2",
								resolveSpaceMessageContentPaddingClassName({
									isSelf: requesterMessage,
								}),
								SPACE_MESSAGE_SURFACE_WIDTH_CLASS,
								selfMessageContentLayoutClassName,
								resolveSpaceMessageBubblePresentationClass({
									isSelf: requesterMessage,
								})
							)}
						>
							<SpaceMessageBody
								containerClassName={selfMessageContentLayoutClassName}
								item={{
									actorProfileKind: requesterMessage ? undefined : "agent",
									agentStreamState: undefined,
									centerAgentTaskReferences: [],
									isAgentFinalReply: input.event.kind === "task_succeeded",
									navigationAction: undefined,
									text: input.event.text,
								}}
							/>
						</BubbleContent>
					</Bubble>
				</MessageContent>
			</Message>
		</li>
	);
}

function CenterAgentTaskComposer(input: {
	disabled: boolean;
	mode: "message" | "replace";
	onSubmit: (text: string) => void;
	onTextChange: (text: string) => void;
	text: string;
}) {
	const replacing = input.mode === "replace";
	const submit = () => {
		const text = input.text.trim();
		if (text && !input.disabled) {
			input.onSubmit(text);
		}
	};
	return (
		<PromptInput
			className="w-full"
			disabled={input.disabled}
			onSubmit={submit}
			onValueChange={input.onTextChange}
			value={input.text}
		>
			<PromptInputTextarea
				aria-label="Message this Task"
				autoComplete="off"
				className="px-1 py-2 text-sm leading-6 placeholder:text-muted-foreground"
				name="task-message"
				placeholder={
					replacing ? "Send a new instruction…" : "Message this Task…"
				}
			/>
			<PromptInputActions className="min-w-0 justify-between gap-3 border-border border-t pt-2">
				<p className="min-w-0 flex-1 truncate text-muted-foreground text-xs leading-5">
					{replacing
						? "A new instruction replaces the work in progress."
						: "Continue in this Task context."}
				</p>
				<PromptInputAction
					tooltip={input.disabled ? "Sending…" : "Send message"}
				>
					<Button
						aria-label="Send message"
						disabled={input.disabled || input.text.trim().length === 0}
						onClick={submit}
						size="icon-sm"
						type="button"
					>
						<ArrowUpIcon aria-hidden="true" />
					</Button>
				</PromptInputAction>
			</PromptInputActions>
		</PromptInput>
	);
}

function ReplaceTaskInstructionDialog(input: {
	controller: CenterAgentTaskConversationController;
}) {
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!(open || input.controller.isPending)) {
					input.controller.setPendingReplacement(null);
				}
			}}
			open={input.controller.pendingReplacement !== null}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Replace the current instruction?</AlertDialogTitle>
					<AlertDialogDescription>
						The Center Agent will stop the work in progress and start a new
						attempt with your new instruction. Work already completed will
						remain in this Task.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={input.controller.isPending}>
						Keep current work
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={input.controller.isPending}
						onClick={input.controller.confirmReplacement}
						type="button"
						variant="destructive"
					>
						{input.controller.isPending
							? "Starting new attempt"
							: "Stop work and start new attempt"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function isCenterAgentTaskStatusEvent(event: CenterAgentTaskEvent): boolean {
	return (
		event.kind === "stop_requested" ||
		event.kind === "task_failed" ||
		event.kind === "task_stopped"
	);
}

function resolveTaskEventActorLabel(event: CenterAgentTaskEvent): string {
	if (event.actor === "requester") {
		return "You";
	}
	if (event.actor === "center_agent" || event.kind === "task_succeeded") {
		return event.kind === "needs_attention"
			? "Center Agent · Needs action"
			: "Center Agent";
	}
	return "Task update";
}
