"use client";

import { Button } from "@openmeld/ui/components/button";
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	AppDirectMessageShell,
	SpaceWindowShell,
} from "#/components/spaces/app-space-shell";
import { NewDirectMessageDialog } from "#/components/spaces/new-direct-message-dialog";
import { SpaceProfileRequiredState } from "#/components/spaces/space-profile-required-state";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
	getAppSidebarStatesForRoute,
} from "#/lib/sidebar-width-cookie";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";

export const Route = createFileRoute("/o/$orgSlug/chats/")({
	staticData: appShellStaticData.directMessages,
	pendingComponent: DirectMessagesPendingRoute,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("direct-messages"),
	}),
	component: DirectMessagesIndexRoute,
});

function DirectMessagesPendingRoute() {
	return (
		<SpaceWindowShell
			initialOuterSidebarState={APP_SIDEBAR_DEFAULT_STATES.outer}
			initialSidebarState={APP_SIDEBAR_DEFAULT_STATES.inner}
			sidebarPreferenceKey="direct-messages"
		>
			<AppMainContent>
				<DirectMessagesLoadingState />
			</AppMainContent>
		</SpaceWindowShell>
	);
}

function DirectMessagesIndexRoute() {
	const { orgSlug } = Route.useParams();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<DirectMessagesIndexContent
			initialSidebarStates={sidebarStates}
			orgSlug={orgSlug}
		/>
	);
}

export function DirectMessagesIndexContent(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
	orgSlug: string;
}) {
	const [creating, setCreating] = useState(false);
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
			<AppMainContent>
				<div className="flex h-full items-center justify-center px-6 py-10">
					<div className="flex max-w-sm flex-col items-center text-center">
						<span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
							<ChatCircleTextIcon aria-hidden="true" className="size-5" />
						</span>
						<h1 className="mt-4 font-medium text-base">Your chats</h1>
						<p className="mt-2 text-muted-foreground text-sm leading-6">
							Chat with people, local agents, and remote agents.
						</p>
						<Button
							className="mt-5"
							onClick={() => setCreating(true)}
							variant="outline"
						>
							New chat
						</Button>
						<NewDirectMessageDialog
							onOpenChange={setCreating}
							open={creating}
						/>
					</div>
				</div>
			</AppMainContent>
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
