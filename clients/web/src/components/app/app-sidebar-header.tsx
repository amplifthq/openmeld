"use client";

import { SidebarHeader, SidebarTrigger } from "@openmeld/ui/fluid/sidebar";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	MagnifyingGlassIcon,
	SidebarSimpleIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { InboxAttentionBadge } from "#/components/inbox/inbox-attention-badge";
import { useInboxAttention } from "#/components/inbox/use-inbox-attention";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { CollapsedRailTooltip } from "./app-rail-navigation";
import {
	type AppOuterRailAccount,
	type HumanProfileAvatarIdentity,
	OrganizationSwitcher,
} from "./app-workspace-switcher";

export function AppSidebarHeader({
	account,
	humanProfileAvatar,
	mode,
	orgSlug,
}: {
	account: AppOuterRailAccount;
	humanProfileAvatar: HumanProfileAvatarIdentity | null;
	mode: SidebarMode;
	orgSlug: string;
}) {
	const { dismiss, presentation } = useAppNavigationPresentation();
	const { currentOrganization } = useAppOrganization();
	const attention = useInboxAttention(currentOrganization.id);
	const router = useRouter();
	const canGoBack = useCanGoBack();
	const iconOnly = mode === "icon";
	const actionClass =
		"flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent";
	return (
		<SidebarHeader
			className={cn(
				"gap-2 p-2 pt-3",
				presentation === "drawer" &&
					"[&_a]:min-h-11 [&_a]:min-w-11 [&_button]:min-h-11 [&_button]:min-w-11"
			)}
		>
			<div className={cn("flex items-center gap-0", iconOnly && "flex-col")}>
				{presentation === "inline" && (
					<CollapsedRailTooltip
						label="Toggle sidebar"
						side={iconOnly ? "right" : "top"}
					>
						<SidebarTrigger className={actionClass}>
							<SidebarSimpleIcon className="size-4" />
						</SidebarTrigger>
					</CollapsedRailTooltip>
				)}
				{!iconOnly && (
					<>
						<CollapsedRailTooltip label="Back" side="top">
							<button
								aria-label="Back"
								className={actionClass}
								disabled={!canGoBack}
								onClick={() => router.history.back()}
								type="button"
							>
								<ArrowLeftIcon className="size-4" />
							</button>
						</CollapsedRailTooltip>
						<CollapsedRailTooltip label="Forward" side="top">
							<button
								aria-label="Forward"
								className={actionClass}
								onClick={() => router.history.forward()}
								type="button"
							>
								<ArrowRightIcon className="size-4" />
							</button>
						</CollapsedRailTooltip>
					</>
				)}
				{!iconOnly && <span className="flex-1" />}
				<button
					aria-label="Search or run a command"
					className={actionClass}
					onClick={() =>
						window.dispatchEvent(new Event("openmeld:command-center"))
					}
					type="button"
				>
					<MagnifyingGlassIcon className="size-4" />
				</button>
				<CollapsedRailTooltip
					label={attention.label}
					side={iconOnly ? "right" : "top"}
				>
					<Link
						aria-label={attention.label}
						className={cn(actionClass, "relative")}
						onClick={dismiss}
						to={buildOrganizationInboxPath(orgSlug)}
					>
						<TrayIcon className="size-4" />
						<InboxAttentionBadge
							count={attention.count}
							tone={attention.tone}
						/>
					</Link>
				</CollapsedRailTooltip>
			</div>
			<div className={cn("min-w-0", iconOnly && "flex justify-center")}>
				<OrganizationSwitcher
					account={account}
					humanProfileAvatar={humanProfileAvatar}
					tier={mode === "hidden" ? "expanded" : mode}
				/>
			</div>
		</SidebarHeader>
	);
}
