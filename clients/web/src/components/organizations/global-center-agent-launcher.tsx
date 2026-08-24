"use client";

import { Popover } from "@base-ui/react/popover";
import type { CenterAgentTask } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { ArrowsOutSimpleIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type WheelEvent } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationCenterAgentTaskPath,
	buildOrganizationCenterAgentTasksPath,
} from "#/lib/organizations/organization-routes";
import {
	centerAgentTaskDetailQueryOptions,
	centerAgentTasksInfiniteQueryOptions,
} from "#/query/organizations/center-agent-tasks";
import { CenterAgentCompactConversation } from "./center-agent-compact-conversation";
import {
	CenterAgentTaskConversationSurface,
	useCenterAgentTaskConversation,
} from "./center-agent-task-conversation";
import { useCenterAgentConversationIntentPrefetch } from "./use-center-agent-conversation-intent-prefetch";

const QUICK_ACCESS_POPUP_CLASS_NAME =
	"flex max-h-[min(34rem,var(--available-height))] w-[min(26rem,calc(100vw-1rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl outline-none transition-[filter,opacity,scale,translate] duration-150 ease-out data-[ending-style]:translate-y-1 data-[starting-style]:translate-y-1 data-[ending-style]:scale-[0.98] data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[ending-style]:blur-[2px] motion-reduce:transition-opacity motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:blur-none";

export type GlobalCenterAgentLauncherProps = {
	currentPathname?: string;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
};

export function GlobalCenterAgentLauncher(
	input: GlobalCenterAgentLauncherProps = {}
) {
	const organizationContext = useOptionalAppOrganization();
	if (!organizationContext) {
		return null;
	}
	return (
		<OrganizationGlobalCenterAgentLauncher
			currentPathname={input.currentPathname ?? ""}
			onOpenChange={input.onOpenChange}
			open={input.open}
			organization={organizationContext.currentOrganization}
		/>
	);
}

function OrganizationGlobalCenterAgentLauncher(input: {
	currentPathname: string;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	organization: { id: string; slug: string };
}) {
	const [internalOpen, setInternalOpen] = useState(false);
	const prefetchCenterAgentConversation =
		useCenterAgentConversationIntentPrefetch();
	const open = input.open ?? internalOpen;
	const setOpen = input.onOpenChange ?? setInternalOpen;
	const chatPath = buildOrganizationCenterAgentChatPath(
		input.organization.slug
	);
	if (input.currentPathname === chatPath) {
		return null;
	}

	return (
		<Popover.Root modal={false} onOpenChange={setOpen} open={open}>
			<Popover.Trigger
				render={
					<Button
						aria-label="Open Center Agent"
						className="pointer-events-auto min-w-0 border-0 bg-transparent px-2 text-muted-foreground shadow-none transition-colors duration-100 hover:bg-muted hover:text-foreground aria-expanded:bg-transparent motion-reduce:transition-none dark:bg-transparent dark:aria-expanded:bg-transparent dark:hover:bg-muted/50"
						onFocus={prefetchCenterAgentConversation}
						onPointerEnter={prefetchCenterAgentConversation}
						size="sm"
						type="button"
						variant="ghost"
					/>
				}
			>
				<RobotIcon aria-hidden="true" className="size-3.5" />
				<span>Center Agent</span>
			</Popover.Trigger>

			<Popover.Portal>
				<Popover.Positioner
					align="end"
					className="isolate z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "start",
						side: "flip",
					}}
					collisionPadding={8}
					side="top"
					sideOffset={8}
				>
					<Popover.Popup
						aria-label="Center Agent quick access"
						className={`${QUICK_ACCESS_POPUP_CLASS_NAME} h-[min(34rem,var(--available-height))]`}
						role="dialog"
					>
						<CenterAgentChatQuickAccess organization={input.organization} />
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function CenterAgentChatQuickAccess(input: {
	organization: { id: string; slug: string };
}) {
	const chatPath = buildOrganizationCenterAgentChatPath(
		input.organization.slug
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<QuickAccessHeader
				expandLabel="Open full Center Agent Chat"
				expandPath={chatPath}
				title="Center Agent"
			/>
			<CenterAgentCompactConversation organizationId={input.organization.id} />
		</div>
	);
}

export type GlobalCenterAgentTaskLaunchersProps = {
	currentPathname?: string;
	onOpenTaskChange?: (taskId: string, open: boolean) => void;
	openTaskId?: string | null;
};

export function GlobalCenterAgentTaskLaunchers(
	input: GlobalCenterAgentTaskLaunchersProps = {}
) {
	const organizationContext = useOptionalAppOrganization();
	if (!organizationContext) {
		return null;
	}
	return (
		<OrganizationGlobalCenterAgentTaskLaunchers
			currentPathname={input.currentPathname ?? ""}
			onOpenTaskChange={input.onOpenTaskChange}
			openTaskId={input.openTaskId}
			organization={organizationContext.currentOrganization}
		/>
	);
}

function OrganizationGlobalCenterAgentTaskLaunchers(input: {
	currentPathname: string;
	onOpenTaskChange?: (taskId: string, open: boolean) => void;
	openTaskId?: string | null;
	organization: { id: string; slug: string };
}) {
	const [dismissedTaskIds, setDismissedTaskIds] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	const [retainedTaskIds, setRetainedTaskIds] = useState<ReadonlySet<string>>(
		() => new Set()
	);
	const [internalOpenTaskId, setInternalOpenTaskId] = useState<string | null>(
		null
	);
	const openTaskId = input.openTaskId ?? internalOpenTaskId;
	const tasksQuery = useInfiniteQuery(
		centerAgentTasksInfiniteQueryOptions({
			enabled: true,
			organizationId: input.organization.id,
		})
	);
	const currentTaskId = resolveCenterAgentTaskId({
		organizationSlug: input.organization.slug,
		pathname: input.currentPathname,
	});
	const taskResults = tasksQuery.data?.tasks ?? [];
	const activeTaskIdsKey = serializeActiveTaskIds(taskResults);
	useEffect(() => {
		if (!activeTaskIdsKey) {
			return;
		}
		const activeTaskIds = activeTaskIdsKey.split("\0");
		setRetainedTaskIds((current) => {
			const next = new Set(current);
			for (const taskId of activeTaskIds) {
				next.add(taskId);
			}
			return next.size === current.size ? current : next;
		});
	}, [activeTaskIdsKey]);
	const tasks = taskResults.filter(
		(task) =>
			(task.state !== "finished" || retainedTaskIds.has(task.id)) &&
			task.id !== currentTaskId &&
			!dismissedTaskIds.has(task.id)
	);

	if (tasks.length === 0) {
		return null;
	}

	const setOpenTask = (taskId: string, open: boolean) => {
		if (input.onOpenTaskChange) {
			input.onOpenTaskChange(taskId, open);
			return;
		}
		setInternalOpenTaskId(open ? taskId : null);
	};

	return (
		<fieldset
			aria-label="Open Tasks"
			className="scrollbar-hide pointer-events-auto m-0 w-[min(34rem,calc(100vw-15rem))] min-w-0 overflow-x-auto overscroll-x-contain border-0 p-0"
			onWheel={scrollTaskStripWithWheel}
		>
			<SharedLayoutGroup className="flex w-max min-w-full items-center justify-end gap-0.5">
				{tasks.map((task) => (
					<CenterAgentTaskLauncher
						key={task.id}
						onDismiss={() => {
							setDismissedTaskIds((current) => new Set(current).add(task.id));
							if (openTaskId === task.id) {
								setOpenTask(task.id, false);
							}
						}}
						onOpenChange={(open) => setOpenTask(task.id, open)}
						open={openTaskId === task.id}
						organization={input.organization}
						task={task}
					/>
				))}
			</SharedLayoutGroup>
		</fieldset>
	);
}

function serializeActiveTaskIds(tasks: readonly CenterAgentTask[]): string {
	const activeTaskIds: string[] = [];
	for (const task of tasks) {
		if (task.state !== "finished") {
			activeTaskIds.push(task.id);
		}
	}
	return activeTaskIds.join("\0");
}

function CenterAgentTaskLauncher(input: {
	onDismiss: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organization: { id: string; slug: string };
	task: CenterAgentTask;
}) {
	const needsAction = input.task.state === "needs_action";
	const openLabel = `Open Task ${input.task.title}${needsAction ? ", Needs action" : ""}`;
	return (
		<SharedLayoutItem itemId={input.task.id}>
			<div className="flex h-7 w-fit max-w-56 items-center rounded-md">
				<Popover.Root
					modal={false}
					onOpenChange={input.onOpenChange}
					open={input.open}
				>
					<Popover.Trigger
						render={
							<Button
								aria-label={openLabel}
								className="min-w-0 border-0 bg-transparent ps-2 pe-0.5 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent max-lg:max-w-[12.5rem] dark:bg-transparent dark:aria-expanded:bg-transparent dark:hover:bg-transparent"
								size="sm"
								type="button"
								variant="ghost"
							/>
						}
					>
						{needsAction ? (
							<span
								aria-hidden="true"
								className="size-2 shrink-0 rounded-full bg-amber-400"
								data-slot="task-attention-indicator"
							/>
						) : null}
						<span className="truncate">{input.task.title}</span>
					</Popover.Trigger>
					<Popover.Portal>
						<Popover.Positioner
							align="end"
							className="isolate z-50"
							collisionAvoidance={{
								align: "shift",
								fallbackAxisSide: "start",
								side: "flip",
							}}
							collisionPadding={8}
							side="top"
							sideOffset={8}
						>
							<Popover.Popup
								aria-label={`${input.task.title} quick access`}
								className={`${QUICK_ACCESS_POPUP_CLASS_NAME} h-[min(34rem,var(--available-height))]`}
								role="dialog"
							>
								<CenterAgentTaskQuickAccess
									organization={input.organization}
									taskId={input.task.id}
								/>
							</Popover.Popup>
						</Popover.Positioner>
					</Popover.Portal>
				</Popover.Root>
				<Button
					aria-label={`Close ${input.task.title} shortcut`}
					className="size-6 shrink-0 border-0 bg-transparent p-0 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground dark:bg-transparent dark:hover:bg-transparent"
					onClick={input.onDismiss}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<XIcon aria-hidden="true" className="size-3" />
				</Button>
			</div>
		</SharedLayoutItem>
	);
}

function scrollTaskStripWithWheel(event: WheelEvent<HTMLFieldSetElement>) {
	const strip = event.currentTarget;
	if (strip.scrollWidth <= strip.clientWidth) {
		return;
	}
	const delta =
		Math.abs(event.deltaX) > Math.abs(event.deltaY)
			? event.deltaX
			: event.deltaY;
	if (delta === 0) {
		return;
	}
	const maximum = strip.scrollWidth - strip.clientWidth;
	const nextScrollLeft = Math.max(
		0,
		Math.min(maximum, strip.scrollLeft + delta)
	);
	if (nextScrollLeft === strip.scrollLeft) {
		return;
	}
	event.preventDefault();
	strip.scrollLeft = nextScrollLeft;
}

function CenterAgentTaskQuickAccess(input: {
	organization: { id: string; slug: string };
	taskId: string;
}) {
	const taskPath = buildOrganizationCenterAgentTaskPath({
		orgSlug: input.organization.slug,
		taskId: input.taskId,
	});
	const taskQuery = useQuery(
		centerAgentTaskDetailQueryOptions({
			enabled: true,
			organizationId: input.organization.id,
			taskId: input.taskId,
		})
	);
	const conversation = useCenterAgentTaskConversation({
		detail: taskQuery.data,
		organizationId: input.organization.id,
		taskId: input.taskId,
	});

	return (
		<>
			<QuickAccessHeader
				expandLabel="Open full Task"
				expandPath={taskPath}
				title={taskQuery.data?.task.title ?? "Task"}
			/>
			<div className="flex min-h-64 flex-1 flex-col overflow-hidden">
				{taskQuery.isPending ? (
					<div aria-busy="true" className="space-y-3 p-3">
						<span className="sr-only">Loading Task</span>
						<Skeleton className="h-5 w-2/3 motion-reduce:animate-none" />
						<Skeleton className="h-16 w-full motion-reduce:animate-none" />
					</div>
				) : null}
				{taskQuery.isError || !taskQuery.data ? (
					<div className="space-y-3 p-3 text-sm" role="alert">
						<p>Couldn’t load this Task.</p>
						<Button
							onClick={() => taskQuery.refetch()}
							size="sm"
							type="button"
							variant="outline"
						>
							Try again
						</Button>
					</div>
				) : null}
				{taskQuery.data ? (
					<CenterAgentTaskConversationSurface
						compact
						controller={conversation}
						detail={taskQuery.data}
					/>
				) : null}
			</div>
		</>
	);
}

function QuickAccessHeader(input: {
	expandLabel: string;
	expandPath: string;
	subtitle?: string;
	title: string;
}) {
	return (
		<header className="flex min-w-0 items-center justify-between gap-3 border-border/70 border-b px-3 py-2.5">
			<div className="min-w-0">
				<h2 className="font-semibold text-foreground text-sm">{input.title}</h2>
				{input.subtitle ? (
					<p className="truncate text-muted-foreground text-xs">
						{input.subtitle}
					</p>
				) : null}
			</div>
			<Tooltip>
				<TooltipTrigger
					render={
						<Link
							aria-label={input.expandLabel}
							className={buttonVariants({
								size: "icon-sm",
								variant: "ghost",
							})}
							to={input.expandPath}
						/>
					}
				>
					<ArrowsOutSimpleIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent side="top">{input.expandLabel}</TooltipContent>
			</Tooltip>
		</header>
	);
}

function resolveCenterAgentTaskId(input: {
	organizationSlug: string;
	pathname: string;
}): string | null {
	const prefix = `${buildOrganizationCenterAgentTasksPath(input.organizationSlug)}/`;
	if (!input.pathname.startsWith(prefix)) {
		return null;
	}
	const encodedTaskId = input.pathname.slice(prefix.length);
	if (!encodedTaskId || encodedTaskId.includes("/")) {
		return null;
	}
	try {
		return decodeURIComponent(encodedTaskId);
	} catch {
		return null;
	}
}
