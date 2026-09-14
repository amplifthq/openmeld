"use client";

import { SidebarHeader } from "@openmeld/ui/fluid/sidebar";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import { cn } from "@openmeld/ui/lib/utils";
import { AppCreateMenu } from "./app-create-menu";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
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
	const { presentation } = useAppNavigationPresentation();
	const iconOnly = mode === "icon";
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
				<AppCreateMenu orgSlug={orgSlug} />
			</div>
		</SidebarHeader>
	);
}
