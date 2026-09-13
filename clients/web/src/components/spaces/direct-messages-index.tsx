"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppMainContent } from "#/components/app/app-main-content";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	AppDirectMessageShell,
	SpaceWindowShell,
} from "#/components/spaces/app-space-shell";
import { ChatsDirectory } from "#/components/spaces/chats-directory";
import { SpaceProfileRequiredState } from "#/components/spaces/space-profile-required-state";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
} from "#/lib/sidebar-width-cookie";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";

export function DirectMessagesIndexContent(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
	orgSlug: string;
}) {
	const { state, storageScope } = useStartFlowState();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({ enabled: true, storageScope })
	);
	const profileId = resolveAppSpacesProfileId({
		profiles: profilesQuery.data ?? [],
		selectedHumanProfileId: state.selectedHumanProfileId,
	});

	if (profilesQuery.isPending) {
		return (
			<DirectMessagesEntryShell
				initialSidebarStates={input.initialSidebarStates}
			>
				<DirectMessagesLoadingState />
			</DirectMessagesEntryShell>
		);
	}

	if (profilesQuery.isError && profilesQuery.data === undefined) {
		return (
			<DirectMessagesEntryShell
				initialSidebarStates={input.initialSidebarStates}
			>
				<div className="max-w-sm text-center">
					<h1 className="font-medium text-base">
						Couldn&apos;t Load Your Profile
					</h1>
					<p className="mt-2 text-muted-foreground text-sm">
						OpenMeld could not load the profile used for chats.
					</p>
				</div>
			</DirectMessagesEntryShell>
		);
	}

	if (!profileId) {
		return (
			<DirectMessagesEntryShell
				initialSidebarStates={input.initialSidebarStates}
			>
				<SpaceProfileRequiredState recommendedHumanProfile={null} />
			</DirectMessagesEntryShell>
		);
	}

	return (
		<AppDirectMessageShell
			currentProfileId={profileId}
			currentSpaceId=""
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
			initialSidebarState={
				input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner
			}
		>
			<ChatsDirectory />
		</AppDirectMessageShell>
	);
}

function DirectMessagesEntryShell(input: {
	children: ReactNode;
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	return (
		<SpaceWindowShell
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
			initialSidebarState={
				input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner
			}
			sidebarPreferenceKey="direct-messages"
		>
			<AppMainContent>
				<div className="flex h-full items-center justify-center px-6 py-10">
					{input.children}
				</div>
			</AppMainContent>
		</SpaceWindowShell>
	);
}

function DirectMessagesLoadingState() {
	return (
		<output
			aria-label="Loading chats"
			className="flex h-full items-center justify-center text-muted-foreground text-sm"
		>
			Loading chats…
		</output>
	);
}
