"use client";

import { Popover } from "@base-ui/react/popover";
import type {} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { ArrowsOutSimpleIcon, RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationRootPath,
} from "#/lib/organizations/organization-routes";
import { CenterAgentCompactConversation } from "./center-agent-compact-conversation";
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
	if (
		input.currentPathname === chatPath ||
		input.currentPathname === buildOrganizationRootPath(input.organization.slug)
	) {
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
