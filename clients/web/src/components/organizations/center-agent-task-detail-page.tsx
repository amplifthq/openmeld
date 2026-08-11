"use client";

import { REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE } from "@openmeld/schemas";
import type { CenterAgentTaskDetail } from "@openmeld/schemas/types";
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
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { resolveStatusToneBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	PlusIcon,
	StopIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import {
	resolveCenterAgentTaskErrorMessage,
	retryCurrentCenterAgentTask,
	stopCurrentCenterAgentTask,
} from "#/lib/organizations/center-agent-tasks";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentTasksPath,
} from "#/lib/organizations/organization-routes";
import {
	centerAgentTaskDetailQueryOptions,
	centerAgentTaskQueryKeys,
} from "#/query/organizations/center-agent-tasks";
import {
	CenterAgentTaskConversationSurface,
	useCenterAgentTaskConversation,
} from "./center-agent-task-conversation";
import {
	formatTaskOrigin,
	formatTaskOriginProvider,
	formatTaskRequester,
	resolveTaskStatusPresentation,
} from "./center-agent-task-presentation";

export function CenterAgentTaskDetailPage(input: { taskId: string }) {
	const queryClient = useQueryClient();
	const { currentOrganization } = useAppOrganization();
	const [stopConfirmationOpen, setStopConfirmationOpen] = useState(false);
	const detailQuery = useQuery(
		centerAgentTaskDetailQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
			taskId: input.taskId,
		})
	);
	const conversation = useCenterAgentTaskConversation({
		detail: detailQuery.data,
		organizationId: currentOrganization.id,
		taskId: input.taskId,
	});
	const stopMutation = useMutation({
		mutationFn: async (version: number) =>
			await stopCurrentCenterAgentTask({
				expectedVersion: version,
				organizationId: currentOrganization.id,
				taskId: input.taskId,
			}),
		onSuccess: async (detail) => {
			setStopConfirmationOpen(false);
			queryClient.setQueryData(
				centerAgentTaskQueryKeys.detail(currentOrganization.id, detail.task.id),
				detail
			);
			await queryClient.invalidateQueries({
				queryKey: centerAgentTaskQueryKeys.list(currentOrganization.id),
			});
		},
	});
	const retryMutation = useMutation({
		mutationFn: async (version: number) =>
			await retryCurrentCenterAgentTask({
				expectedVersion: version,
				idempotencyKey: crypto.randomUUID(),
				organizationId: currentOrganization.id,
				taskId: input.taskId,
			}),
		onSuccess: async (detail) => {
			queryClient.setQueryData(
				centerAgentTaskQueryKeys.detail(currentOrganization.id, detail.task.id),
				detail
			);
			await queryClient.invalidateQueries({
				queryKey: centerAgentTaskQueryKeys.list(currentOrganization.id),
			});
		},
	});

	if (detailQuery.isPending) {
		return <CenterAgentTaskDetailSkeleton />;
	}
	if (detailQuery.isError || !detailQuery.data) {
		return (
			<section className="m-auto max-w-md rounded-md border border-destructive/50 bg-destructive/5 p-5">
				<h1 className="font-medium text-foreground text-lg">
					Couldn’t load this Task
				</h1>
				<p className="mt-2 text-destructive text-sm" role="alert">
					{resolveCenterAgentTaskErrorMessage(detailQuery.error, "get")}
				</p>
				<div className="mt-4 flex flex-wrap gap-2">
					<Button
						onClick={() => detailQuery.refetch()}
						size="sm"
						type="button"
						variant="outline"
					>
						<ArrowClockwiseIcon aria-hidden="true" data-icon="inline-start" />
						Try again
					</Button>
					<Link
						className={buttonVariants({ size: "sm", variant: "ghost" })}
						to={buildOrganizationCenterAgentTasksPath(currentOrganization.slug)}
					>
						Back to Tasks
					</Link>
				</div>
			</section>
		);
	}

	const detail = detailQuery.data;
	const task = detail.task;
	const originProvider = formatTaskOriginProvider(task);
	const requester = formatTaskRequester(task);
	const status = resolveTaskStatusPresentation(task);
	const actionError = stopMutation.error ?? retryMutation.error;
	const actionErrorKind = resolveTaskActionErrorKind({
		retryError: retryMutation.error,
		stopError: stopMutation.error,
	});
	const actionPending =
		conversation.isPending || stopMutation.isPending || retryMutation.isPending;
	const canStop =
		task.status === "queued" ||
		task.status === "running" ||
		task.status === "needs_attention";
	const activeAttempt = detail.attempts.find(
		(attempt) => attempt.generation === task.activeAttemptGeneration
	);
	const requiresNewTask =
		activeAttempt?.failureCode ===
		REMOTE_AGENT_CONVERSATION_HISTORY_LIMIT_EXCEEDED_REASON_CODE;
	const canRetry =
		!requiresNewTask && (task.status === "failed" || task.status === "stopped");

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
			<Link
				className={`${buttonVariants({ size: "sm", variant: "ghost" })} w-fit`}
				to={buildOrganizationCenterAgentTasksPath(currentOrganization.slug)}
			>
				<ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
				Tasks
			</Link>
			<AppPageHeader
				action={
					<>
						{canStop ? (
							<Button
								disabled={actionPending}
								onClick={() => setStopConfirmationOpen(true)}
								size="sm"
								type="button"
								variant="outline"
							>
								<StopIcon aria-hidden="true" data-icon="inline-start" />
								Stop
							</Button>
						) : null}
						{requiresNewTask ? (
							<Link
								className={buttonVariants({ size: "sm" })}
								to={buildOrganizationCenterAgentChatPath(
									currentOrganization.slug
								)}
							>
								<PlusIcon aria-hidden="true" data-icon="inline-start" />
								Start a new Task
							</Link>
						) : null}
						{canRetry ? (
							<Button
								disabled={actionPending}
								onClick={() => retryMutation.mutate(task.version)}
								size="sm"
								type="button"
							>
								<ArrowClockwiseIcon
									aria-hidden="true"
									data-icon="inline-start"
								/>
								Retry
							</Button>
						) : null}
					</>
				}
				description={task.goal}
				eyebrow="Center Agent Task"
				title={task.title}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<Badge
					className={resolveStatusToneBadgeClassName(status.tone)}
					variant="outline"
				>
					{status.label}
				</Badge>
				<span className="text-muted-foreground text-xs">
					{requester ? `${requester} · ` : ""}
					{formatTaskOrigin(task)}
				</span>
			</div>
			{originProvider && task.origin.kind === "message_channel" ? (
				<CenterAgentTaskReplyDestination
					destination={task.origin.destination}
					providerName={originProvider}
				/>
			) : null}
			<CenterAgentTaskConversationSurface
				controller={conversation}
				detail={detail}
			/>
			{actionError ? (
				<p className="text-destructive text-sm" role="alert">
					{resolveCenterAgentTaskErrorMessage(actionError, actionErrorKind)}
				</p>
			) : null}
			<AlertDialog
				onOpenChange={(open) => {
					if (!stopMutation.isPending) {
						setStopConfirmationOpen(open);
					}
				}}
				open={stopConfirmationOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Stop this Task?</AlertDialogTitle>
						<AlertDialogDescription>
							The Center Agent will stop the current work. You can return to the
							conversation later, but finished work will not continue
							automatically.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={stopMutation.isPending}>
							Keep working
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={stopMutation.isPending}
							onClick={() => stopMutation.mutate(task.version)}
							type="button"
							variant="destructive"
						>
							{stopMutation.isPending ? "Stopping" : "Stop Task"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

type MessageChannelTaskOrigin = Extract<
	CenterAgentTaskDetail["task"]["origin"],
	{ kind: "message_channel" }
>;

function CenterAgentTaskReplyDestination(input: {
	destination: MessageChannelTaskOrigin["destination"];
	providerName: "Feishu" | "Lark" | "Slack";
}) {
	const fields = resolveReplyDestinationFields(input.destination);
	return (
		<section
			aria-label="Reply destination"
			className="rounded-md border border-border/70 bg-muted/20 px-3 py-2.5"
		>
			<p className="text-muted-foreground text-xs">
				Replies from this Task also return to this exact {input.providerName}{" "}
				destination.
			</p>
			<dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
				{fields.map((field) => (
					<div
						className="flex min-w-0 items-baseline gap-1.5"
						key={field.label}
					>
						<dt className="text-muted-foreground">{field.label}</dt>
						<dd>
							<code className="break-all font-mono text-foreground">
								{field.value}
							</code>
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function resolveReplyDestinationFields(
	destination: MessageChannelTaskOrigin["destination"]
): ReadonlyArray<{ label: string; value: string }> {
	if (destination.provider === "slack") {
		return [
			{ label: "Workspace", value: destination.teamId },
			{ label: "Channel", value: destination.channelId },
			{ label: "Thread", value: destination.rootMessageId },
		];
	}
	return [
		{ label: "Chat", value: destination.chatId },
		...(destination.threadId
			? [{ label: "Thread", value: destination.threadId }]
			: []),
		{ label: "Root message", value: destination.rootMessageId },
	];
}

function resolveTaskActionErrorKind(input: {
	retryError: unknown;
	stopError: unknown;
}): "retry" | "stop" {
	if (input.stopError) {
		return "stop";
	}
	return "retry";
}

function CenterAgentTaskDetailSkeleton() {
	return (
		<div aria-busy="true" className="mx-auto w-full max-w-3xl space-y-4">
			<span className="sr-only">Loading Task</span>
			<Skeleton className="h-8 w-48 motion-reduce:animate-none" />
			<Skeleton className="h-24 w-full motion-reduce:animate-none" />
			<Skeleton className="h-32 w-full motion-reduce:animate-none" />
			<Skeleton className="h-32 w-full motion-reduce:animate-none" />
		</div>
	);
}
