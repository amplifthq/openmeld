"use client";
import { resolveInboxAttentionTone } from "#/lib/inbox/attention";

// Navigation position belongs to the section, not the currently open detail route.
const sidebarScrollPositions = new Map<string, number>();

import { SidebarContent } from "@openmeld/ui/fluid/sidebar";
import type { SidebarGeometry } from "@openmeld/ui/fluid/sidebar-state";
import { useQuery } from "@tanstack/react-query";
import { useMatches } from "@tanstack/react-router";
import { type ReactNode, useCallback, useState } from "react";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { AppOuterRailFrame } from "#/components/app/app-outer-rail-frame";
import { AppSidebarGroupStateProvider } from "#/components/app/app-sidebar-group";
import {
	resolveAppOuterRailDestinationFromMatches,
	resolveAppShellSectionFromMatches,
} from "#/components/app/shell-layout";
import { useCenterAgentConversationIntentPrefetch } from "#/components/organizations/use-center-agent-conversation-intent-prefetch";
import { useAccountAvatar } from "#/hooks/account.hooks";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import {
	OUTER_SIDEBAR_DEFAULT_STATE,
	resolveClientSidebarInitialState,
	type SidebarPersistedState,
	writeOuterSidebarStateCookie,
} from "#/lib/sidebar-width-cookie";
import {
	centerAgentInboxSummaryQueryOptions,
	spaceInboxSummaryQueryOptions,
} from "#/query/organizations/inbox";
import { AppCommandCenter } from "./app-command-center";
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
import { SidebarDestinationActionsProvider } from "./sidebar-destination-actions";

type AppOuterRailProps = {
	account: AppOuterRailAccount;
	contextualNavigation?: ReactNode;
	initialState?: SidebarPersistedState;
};

export function AppOuterRail({
	account,
	initialState,
	contextualNavigation,
}: AppOuterRailProps) {
	const { presentation } = useAppNavigationPresentation();
	const drawerPresentation = presentation === "drawer";
	const [state, setState] = useState<SidebarPersistedState>(() =>
		resolveClientSidebarInitialState(
			"outer",
			initialState ?? OUTER_SIDEBAR_DEFAULT_STATE
		)
	);
	const activeDestination = useMatches({
		select: resolveAppOuterRailDestinationFromMatches,
	});
	const widthKey = useMatches({ select: resolveAppShellSectionFromMatches });
	const displayState: SidebarPersistedState = {
		...state,
		width: state.pageWidths?.[widthKey] ?? OUTER_SIDEBAR_DEFAULT_STATE.width,
		...(drawerPresentation
			? ({ tier: "expanded", width: "100%" } as const)
			: {}),
	};
	const { currentOrganization } = useAppOrganization();
	const prefetchCenterAgentConversation =
		useCenterAgentConversationIntentPrefetch();
	const orgSlug = currentOrganization.slug;
	const centerAgentInboxSummary = useQuery(
		centerAgentInboxSummaryQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const centerAgentUnreadCount = Math.max(
		0,
		centerAgentInboxSummary.data?.unreadCount ?? 0
	);
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const scrollDestination =
		activeDestination === "spaces" || activeDestination === "directMessages"
			? "conversations"
			: activeDestination;
	const scrollKey = `${defaultHumanProfile?.openMeldProfileId ?? ""}:${currentOrganization.id}:${scrollDestination}:${presentation}`;
	const restoreSidebarScroll = useCallback(
		(node: HTMLDivElement | null) => {
			if (node) {
				node.scrollTop = sidebarScrollPositions.get(scrollKey) ?? 0;
			}
		},
		[scrollKey]
	);
	const spaceInboxSummary = useQuery(
		spaceInboxSummaryQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const spacesUnreadCount = Math.max(
		0,
		spaceInboxSummary.data?.ordinarySpaceUnreadCount ?? 0
	);
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

	const persistState = useCallback((next: SidebarPersistedState) => {
		writeOuterSidebarStateCookie(next);
		return next;
	}, []);

	const handleGeometryChange = useCallback(
		(geometry: SidebarGeometry) => {
			setState((current) =>
				persistState({
					...current,
					tier: geometry.mode,
					width: `${geometry.width}px`,
					pageWidths: {
						...current.pageWidths,
						[widthKey]: `${geometry.width}px`,
					},
				})
			);
		},
		[persistState, widthKey]
	);
	const handleCollapsedGroupIdsChange = useCallback(
		(collapsedGroupIds: readonly string[]) => {
			setState((current) => persistState({ ...current, collapsedGroupIds }));
		},
		[persistState]
	);

	return (
		<AppSidebarGroupStateProvider
			collapsedGroupIds={state.collapsedGroupIds}
			onCollapsedGroupIdsChange={handleCollapsedGroupIdsChange}
		>
			<AppCommandCenter />
			<AppOuterRailFrame
				onGeometryChange={handleGeometryChange}
				state={displayState}
				static={drawerPresentation}
			>
				{(mode) => (
					<SidebarDestinationActionsProvider>
						<AppSidebarHeader
							account={{ ...account, image: accountAvatarImage }}
							humanProfileAvatar={humanProfileAvatar}
							mode={mode}
							orgSlug={orgSlug}
						/>
						<div className="shrink-0 px-2" data-slot="main-sidebar-navigation">
							{buildAppRailGroups({
								orgSlug,
								centerAgentUnreadCount,
								prefetchCenterAgentConversation,
								spacesUnreadCount,
								chatUnreadCount: spaceInboxSummary.data?.chatUnreadCount,
								chatAttentionTone: resolveInboxAttentionTone({
									unresolvedActionCount:
										spaceInboxSummary.data?.chatUnresolvedActionCount,
									unreadUrgentUpdateCount:
										spaceInboxSummary.data?.chatUnreadUrgentUpdateCount,
								}),
							}).map((group, index) => (
								<AppRailNavigationGroup
									activeDestination={activeDestination}
									group={group}
									key={group.id}
									position={index}
									tier={mode === "hidden" ? "expanded" : mode}
								/>
							))}
						</div>
						<SidebarContent
							className={
								contextualNavigation && mode !== "icon" ? "mt-4" : undefined
							}
							contentClassName="px-2 pb-2"
							viewportProps={{
								onScroll: (event) =>
									sidebarScrollPositions.set(
										scrollKey,
										event.currentTarget.scrollTop
									),
							}}
							viewportRef={restoreSidebarScroll}
						>
							{contextualNavigation && mode !== "icon" ? (
								<div className="min-w-0" data-slot="main-sidebar-context">
									{contextualNavigation}
								</div>
							) : null}
						</SidebarContent>
						<AppSidebarFooter
							account={{ ...account, image: accountAvatarImage }}
							humanProfileAvatar={humanProfileAvatar}
							isSettingsActive={activeDestination === "settings"}
							mode={mode}
							orgSlug={orgSlug}
						/>
					</SidebarDestinationActionsProvider>
				)}
			</AppOuterRailFrame>
		</AppSidebarGroupStateProvider>
	);
}
