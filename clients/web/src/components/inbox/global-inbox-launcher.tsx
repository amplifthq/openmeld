"use client";

import { Popover } from "@base-ui/react/popover";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { ArrowsOutSimpleIcon, TrayIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { inboxSummaryQueryOptions } from "#/query/organizations/inbox";
import { OrganizationInboxPreview } from "./organization-inbox-preview";

const INBOX_ATTENTION_INDICATOR_CLASS_NAME = `${resolveStatusToneStrongTextClassName("warning")} min-w-[1ch] text-center font-semibold tabular-nums`;

export type GlobalInboxLauncherProps = {
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
};

export function GlobalInboxLauncher(input: GlobalInboxLauncherProps = {}) {
	const organizationContext = useOptionalAppOrganization();
	if (!organizationContext) {
		return null;
	}
	return (
		<OrganizationGlobalInboxLauncher
			currentOrganization={organizationContext.currentOrganization}
			onOpenChange={input.onOpenChange}
			open={input.open}
		/>
	);
}

function OrganizationGlobalInboxLauncher(input: {
	currentOrganization: OrganizationSummary;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
}) {
	const { currentOrganization } = input;
	const [internalOpen, setInternalOpen] = useState(false);
	const open = input.open ?? internalOpen;
	const setOpen = input.onOpenChange ?? setInternalOpen;
	const summaryQuery = useQuery(
		inboxSummaryQueryOptions({ organizationId: currentOrganization.id })
	);
	const unresolvedActionCount = summaryQuery.data?.unresolvedActionCount ?? 0;
	const summaryUnavailable = summaryQuery.isError && !summaryQuery.data;
	const totalUnreadCount = summaryQuery.data?.totalUnreadCount ?? 0;
	const actionSummary = `${unresolvedActionCount} ${
		unresolvedActionCount === 1 ? "item needs" : "items need"
	} your attention`;
	const triggerLabel = resolveInboxTriggerLabel({
		actionSummary,
		summaryUnavailable,
		unresolvedActionCount,
	});
	const previewStatus = resolveInboxPreviewStatus({
		actionSummary,
		isError: summaryUnavailable,
		isPending: summaryQuery.isPending,
		totalUnreadCount,
		unresolvedActionCount,
	});
	let attentionIndicator: ReactNode = null;
	if (summaryUnavailable) {
		attentionIndicator = (
			<span aria-hidden="true" className={INBOX_ATTENTION_INDICATOR_CLASS_NAME}>
				!
			</span>
		);
	} else if (unresolvedActionCount > 0) {
		attentionIndicator = (
			<span aria-hidden="true" className={INBOX_ATTENTION_INDICATOR_CLASS_NAME}>
				{formatAttentionCount(unresolvedActionCount)}
			</span>
		);
	}

	return (
		<Popover.Root modal={false} onOpenChange={setOpen} open={open}>
			<Popover.Trigger
				render={
					<Button
						aria-label={triggerLabel}
						className="pointer-events-auto min-w-0 border-0 bg-transparent px-2 text-muted-foreground shadow-none transition-colors duration-100 hover:bg-muted hover:text-foreground aria-expanded:bg-transparent motion-reduce:transition-none dark:bg-transparent dark:aria-expanded:bg-transparent dark:hover:bg-muted/50"
						size="sm"
						type="button"
						variant="ghost"
					/>
				}
			>
				<TrayIcon aria-hidden="true" className="size-3.5" />
				<span>Inbox</span>
				{attentionIndicator}
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
						aria-label="Inbox preview"
						className="flex max-h-[min(34rem,var(--available-height))] w-[min(26rem,calc(100vw-1rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl outline-none transition-[filter,opacity,scale,translate] duration-150 ease-out data-[ending-style]:translate-y-1 data-[starting-style]:translate-y-1 data-[ending-style]:scale-[0.98] data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[ending-style]:blur-[2px] motion-reduce:transition-opacity motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0 motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:blur-none"
						role="dialog"
					>
						<header className="flex min-w-0 items-center justify-between gap-3 border-border/70 border-b px-3 py-2.5">
							<div className="min-w-0">
								<h2
									className="font-semibold text-foreground text-sm"
									id="inbox-preview-title"
								>
									Inbox
								</h2>
								<output
									aria-live="polite"
									className="truncate text-muted-foreground text-xs"
								>
									{previewStatus}
								</output>
							</div>
							<Tooltip>
								<TooltipTrigger
									render={
										<Link
											aria-label="Open full Inbox"
											className={buttonVariants({
												size: "icon-sm",
												variant: "ghost",
											})}
											onClick={() => setOpen(false)}
											to={buildOrganizationInboxPath(currentOrganization.slug)}
										/>
									}
								>
									<ArrowsOutSimpleIcon aria-hidden="true" />
								</TooltipTrigger>
								<TooltipContent side="top">Open full Inbox</TooltipContent>
							</Tooltip>
						</header>

						<div className="min-h-0 overflow-y-auto p-2">
							<OrganizationInboxPreview
								currentOrganization={currentOrganization}
								enabled={open}
								onOpenItem={() => setOpen(false)}
							/>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function formatAttentionCount(count: number): string {
	return count > 99 ? "99+" : String(count);
}

function resolveInboxTriggerLabel(input: {
	actionSummary: string;
	summaryUnavailable: boolean;
	unresolvedActionCount: number;
}): string {
	if (input.summaryUnavailable) {
		return "Open Inbox preview, attention status unavailable";
	}
	if (input.unresolvedActionCount > 0) {
		return `Open Inbox preview, ${input.actionSummary}`;
	}
	return "Open Inbox preview";
}

function resolveInboxPreviewStatus(input: {
	actionSummary: string;
	isError: boolean;
	isPending: boolean;
	totalUnreadCount: number;
	unresolvedActionCount: number;
}): string {
	if (input.isError) {
		return "Couldn’t check for updates";
	}
	if (input.isPending) {
		return "Checking for updates…";
	}
	if (input.unresolvedActionCount > 0) {
		return input.actionSummary;
	}
	if (input.totalUnreadCount > 0) {
		return `${input.totalUnreadCount} unread`;
	}
	return "All caught up";
}
