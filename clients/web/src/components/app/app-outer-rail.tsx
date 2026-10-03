"use client";

import {
	ContextMenu,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuRadioItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { SIDEBAR_ICON_WIDTH } from "@openmeld/ui/fluid/sidebar-state";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMatches } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useInboxAttention } from "#/components/inbox/use-inbox-attention";
import { useCenterAgentConversationIntentPrefetch } from "#/components/organizations/use-center-agent-conversation-intent-prefetch";
import { useAccountAvatar } from "#/hooks/account.hooks";
import {
	SIDEBAR_DISPLAY_CHOICES,
	type SidebarDisplay,
	useSidebarDisplayPreference,
} from "#/lib/appearance/sidebar-preference";
import { resolveInboxAttentionTone } from "#/lib/inbox/attention";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import {
	centerAgentInboxSummaryQueryOptions,
	spaceInboxSummaryQueryOptions,
} from "#/query/organizations/inbox";
import { AppCommandCenter } from "./app-command-center";
import { APP_APPLICATION_RAIL_CLASS_NAME } from "./app-nav-item-style";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import {
	AppRailNavigationGroup,
	buildAppRailGroups,
} from "./app-rail-navigation";
import { AppSidebarFooter } from "./app-sidebar-footer";
import { AppSidebarHeader } from "./app-sidebar-header";
import type {
	AppOuterRailAccount,
	HumanProfileAvatarIdentity,
} from "./app-workspace-switcher";
import { resolveAppOuterRailDestinationFromMatches } from "./shell-layout";
import { SidebarDestinationActionsProvider } from "./sidebar-destination-actions";

export function AppOuterRail({ account }: { account: AppOuterRailAccount }) {
	const { presentation } = useAppNavigationPresentation();
	const { display, setDisplay } = useSidebarDisplayPreference();
	const mode = presentation === "drawer" ? "expanded" : "icon";
	const activeDestination = useMatches({
		select: resolveAppOuterRailDestinationFromMatches,
	});
	const { currentOrganization } = useAppOrganization();
	const inboxAttention = useInboxAttention(currentOrganization.id);
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const { data: currentAccountAvatar } = useAccountAvatar();
	const accountAvatarImage = currentAccountAvatar?.avatar ?? null;
	const humanProfileAvatar: HumanProfileAvatarIdentity | null =
		defaultHumanProfile
			? {
					avatarImageUrl: accountAvatarImage,
					profileId: defaultHumanProfile.openMeldProfileId,
					profileName:
						account.name?.trim() ||
						account.email?.trim() ||
						defaultHumanProfile.profileName,
				}
			: null;
	const center = useQuery(
		centerAgentInboxSummaryQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const inbox = useQuery(
		spaceInboxSummaryQueryOptions({ organizationId: currentOrganization.id })
	);
	const prefetchCenterAgentConversation =
		useCenterAgentConversationIntentPrefetch();
	const rail = (
		<aside
			className={cn(
				APP_APPLICATION_RAIL_CLASS_NAME,
				presentation === "drawer" && "w-full"
			)}
			data-presentation={presentation}
			data-slot="app-outer-rail"
			data-testid="app-outer-rail"
			style={
				{ "--app-rail-icon-width": `${SIDEBAR_ICON_WIDTH}px` } as CSSProperties
			}
		>
			<AppCommandCenter />
			<SidebarDestinationActionsProvider>
				<AppSidebarHeader
					account={{ ...account, image: accountAvatarImage }}
					humanProfileAvatar={humanProfileAvatar}
					mode={mode}
				/>
				<ScrollArea
					className="min-h-0 flex-1"
					contentClassName="px-1 pt-1.5"
					data-slot="main-sidebar-navigation"
				>
					{buildAppRailGroups({
						orgSlug: currentOrganization.slug,
						inboxAttention,
						centerAgentUnreadCount: Math.max(0, center.data?.unreadCount ?? 0),
						spacesUnreadCount: Math.max(
							0,
							inbox.data?.ordinarySpaceUnreadCount ?? 0
						),
						chatUnreadCount: inbox.data?.chatUnreadCount,
						chatAttentionTone: resolveInboxAttentionTone({
							unresolvedActionCount: inbox.data?.chatUnresolvedActionCount,
							unreadUrgentUpdateCount: inbox.data?.chatUnreadUrgentUpdateCount,
						}),
						prefetchCenterAgentConversation,
					}).map((group, index) => (
						<AppRailNavigationGroup
							activeDestination={activeDestination}
							group={group}
							key={group.id}
							position={index}
							tier={mode}
						/>
					))}
				</ScrollArea>
				<AppSidebarFooter
					account={{ ...account, image: accountAvatarImage }}
					humanProfileAvatar={humanProfileAvatar}
					isSettingsActive={activeDestination === "settings"}
					mode={mode}
					orgSlug={currentOrganization.slug}
				/>
			</SidebarDestinationActionsProvider>
		</aside>
	);
	if (presentation === "drawer") {
		return rail;
	}
	return (
		<ContextMenu>
			<ContextMenuTrigger render={rail} />
			<FluidDropdownMenuContent
				alignOffset={4}
				className="w-44"
				gapClick
				side="right"
				sideOffset={0}
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Show</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						onValueChange={(value) => setDisplay(value as SidebarDisplay)}
						value={display}
					>
						{SIDEBAR_DISPLAY_CHOICES.map((choice, index) => (
							<FluidDropdownMenuRadioItem
								closeOnClick
								index={index}
								key={choice.value}
								value={choice.value}
							>
								{choice.label}
							</FluidDropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</FluidDropdownMenuContent>
		</ContextMenu>
	);
}
