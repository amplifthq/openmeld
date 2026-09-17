"use client";

import { Popover } from "@base-ui/react/popover";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipHint,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { resolveStatusToneAttentionItemClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowsOutSimpleIcon, TrayIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { resolveInboxIndicatorClassName } from "#/lib/inbox/attention";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { OrganizationInboxPreview } from "./organization-inbox-preview";
import { useInboxAttention } from "./use-inbox-attention";

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
	const attention = useInboxAttention(currentOrganization.id);

	return (
		<Popover.Root modal={false} onOpenChange={setOpen} open={open}>
			<TooltipHint content={attention.label}>
				<Popover.Trigger
					render={
						<Button
							aria-label={`Open ${attention.label}`}
							className={cn(
								"pointer-events-auto min-w-0 border-0 bg-transparent px-2 text-muted-foreground shadow-none transition-colors duration-100 hover:bg-muted hover:text-foreground aria-expanded:bg-transparent motion-reduce:transition-none dark:bg-transparent dark:aria-expanded:bg-transparent dark:hover:bg-muted/50",
								attention.tone &&
									resolveStatusToneAttentionItemClassName(attention.tone)
							)}
							size="sm"
							type="button"
							variant="ghost"
						/>
					}
				>
					<TrayIcon aria-hidden="true" className="size-3.5" />
					<span>Inbox</span>
					{attention.indicatorTone ? (
						<span
							aria-hidden="true"
							className={cn(
								"status-dot",
								resolveInboxIndicatorClassName(attention.tone)
							)}
						/>
					) : null}
				</Popover.Trigger>
			</TooltipHint>

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
									{attention.status}
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

						<ScrollArea
							className="min-h-0"
							contentClassName="p-2"
							orientation="vertical"
						>
							<OrganizationInboxPreview
								currentOrganization={currentOrganization}
								enabled={open}
								onOpenItem={() => setOpen(false)}
							/>
						</ScrollArea>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
