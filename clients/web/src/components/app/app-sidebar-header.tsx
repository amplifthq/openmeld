"use client";

import { SidebarHeader } from "@openmeld/ui/fluid/sidebar";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { cn } from "@openmeld/ui/lib/utils";
import { MagnifyingGlassIcon, TrayIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { InboxAttentionBadge } from "#/components/inbox/inbox-attention-badge";
import { useInboxAttention } from "#/components/inbox/use-inbox-attention";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationInboxPath } from "#/lib/organizations/organization-routes";
import { AppCreateMenu } from "./app-create-menu";
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
	const iconOnly = mode === "icon";
	const actionClass =
		"flex size-10 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/60 text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring";
	return (
		<SidebarHeader
			className={cn(
				"gap-2 p-2 pt-3 pb-4",
				presentation === "drawer" &&
					"[&_a]:min-h-11 [&_a]:min-w-11 [&_button]:min-h-11 [&_button]:min-w-11"
			)}
		>
			<div className={cn("min-w-0", iconOnly && "flex justify-center")}>
				<OrganizationSwitcher
					account={account}
					humanProfileAvatar={humanProfileAvatar}
					tier={mode === "hidden" ? "expanded" : mode}
				/>
			</div>
			<div className="flex flex-col items-center gap-2 py-1">
				<button
					aria-label="Search or run a command"
					className={actionClass}
					onClick={() =>
						window.dispatchEvent(new Event("openmeld:command-center"))
					}
					type="button"
				>
					<MagnifyingGlassIcon className="size-5" />
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
						<TrayIcon className="size-5" />
						<InboxAttentionBadge
							count={attention.count}
							indicatorTone={attention.indicatorTone}
							tone={attention.tone}
						/>
					</Link>
				</CollapsedRailTooltip>
				<AppCreateMenu orgSlug={orgSlug} />
			</div>
		</SidebarHeader>
	);
}
