"use client";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useMatches } from "@tanstack/react-router";
import { useInboxAttention } from "#/components/inbox/use-inbox-attention";
import { useCenterAgentConversationIntentPrefetch } from "#/components/organizations/use-center-agent-conversation-intent-prefetch";
import { useAccountAvatar } from "#/hooks/account.hooks";
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
	return (
		<aside
			className={cn(
				APP_APPLICATION_RAIL_CLASS_NAME,
				presentation === "drawer" && "w-full"
			)}
			data-slot="app-outer-rail"
			data-testid="app-outer-rail"
		>
			<AppCommandCenter />
			<SidebarDestinationActionsProvider>
				<AppSidebarHeader
					account={{ ...account, image: accountAvatarImage }}
					humanProfileAvatar={humanProfileAvatar}
					mode={mode}
				/>
				<div
					className="min-h-0 flex-1 overflow-y-auto px-1"
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
				</div>
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
}
