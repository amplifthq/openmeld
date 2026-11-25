"use client";

import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	SkeletonRegion,
	SkeletonRows,
} from "@openmeld/ui/components/skeleton-content";
import { ArrowLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { ComputerCardsSkeleton } from "#/components/computers/computer-cards-skeleton";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import { DirectoryHumanProfileDetails } from "#/components/directory/directory-human-profile-details";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";
import { useHumanPresence } from "#/components/profiles/human-presence";
import { localPeopleSidebarFixtures } from "#/lib/dev/people-sidebar-fixtures";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { MemberLocalAgents } from "./member-local-agents";
import { MemberSharedActivity } from "./member-shared-activity";
import { PeopleSidebar } from "./people-sidebar";
import { TeamHeader } from "./team-header";
import { TeamHome } from "./team-home";
import { TeamHomeSkeleton } from "./team-home-skeleton";
import {
	TeamSidebarHeader,
	TeamSidebarHeaderActionsProvider,
} from "./team-sidebar-header";

type LocalAgentRecoveryController = ReturnType<
	typeof useLocalAgentRecoveryController
>;

export type DirectoryHumanProfilesViewState = {
	context: "organization" | "personal";
	directMessage: "idle" | "pending";
	profiles: "loading" | "ready";
};

const DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS = 30_000;

export function DirectoryHumanProfilesWorkspace(input: {
	canCreateProfile: boolean;
	computerGroups: readonly OrganizationComputerGroup[];
	directoryError: string | null;
	directoryIsPending: boolean;
	memberActions?: ReactNode;
	emptyMessage: string;
	errorMessage: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	members: readonly DirectoryHumanProfileRow[];
	onCreateProfile: () => void;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onSelectProfile: (profileId: string) => void;
	onInviteMembers?: () => void;
	orgSlug: string;
	organizationId?: string;
	recovery: LocalAgentRecoveryController;
	selectedProfileId: string | null;
	state: DirectoryHumanProfilesViewState;
	strictComputerGroups?: readonly OrganizationComputerGroup[];
}) {
	const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
	const presence = useHumanPresence();
	const membersWithPresence = input.members.map((member) => ({
		...member,
		presence: presence.get(member.id) ?? ("unknown" as const),
	}));
	const [previewReady, setPreviewReady] = useState(false);
	const preview = localPeopleSidebarFixtures({
		members: membersWithPresence,
		computerGroups: input.computerGroups,
		orgSlug: input.orgSlug,
		enabled: previewReady,
	});
	const selectedMember = resolveSelectedMember({
		members: preview.members,
		selectedProfileId: input.selectedProfileId,
	});
	const selectedComputerGroup = selectedMember
		? ((input.strictComputerGroups ?? preview.computerGroups).find(
				(group) => group.ownerUserId === selectedMember.userId
			) ?? null)
		: null;
	const selectedInventory = input.recovery.localRuntimesQuery;
	const agentInventoryFailed = selectedMember?.isCurrentUser
		? selectedInventory.isError || selectedInventory.fetchStatus === "paused"
		: Boolean(input.directoryError);
	const agentInventoryPending = selectedMember?.isCurrentUser
		? selectedInventory.isPending
		: input.directoryIsPending;
	const openProfileChat = (id: string) => {
		input.onOpenDirectMessage(id).catch((error) => {
			console.error("Team conversation failed to open.", error);
		});
	};

	useEffect(() => {
		setPreviewReady(true);
		const intervalId = window.setInterval(
			() => setActivityNowMs(Date.now()),
			DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS
		);
		return () => window.clearInterval(intervalId);
	}, []);

	const sidebar = (
		<PeopleSidebar
			activityNowMs={activityNowMs}
			chatPending={input.state.directMessage === "pending"}
			computerGroups={preview.computerGroups}
			error={input.errorMessage}
			loading={input.state.profiles === "loading"}
			members={preview.members}
			onChat={input.onOpenDirectMessage}
			onSelect={input.onSelectProfile}
			selectedProfileId={selectedMember?.id ?? null}
		/>
	);
	const showTeamHome =
		!input.selectedProfileId &&
		input.state.profiles === "ready" &&
		!input.errorMessage;
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			defaultModuleSidebarOpen={!!input.selectedProfileId}
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mainHeader={
				input.selectedProfileId ? (
					<div className="flex h-full items-center justify-between gap-2 px-3 sm:px-4">
						<Link
							className={buttonVariants({ size: "sm", variant: "ghost" })}
							search={{}}
							to={buildOrganizationPeoplePath(input.orgSlug)}
						>
							<ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
							Back to Team
						</Link>
						{selectedMember && input.memberActions}
					</div>
				) : (
					<TeamHeader
						actions={
							input.onInviteMembers ? (
								<Button onClick={input.onInviteMembers} size="sm">
									<PlusIcon />
									Invite members
								</Button>
							) : undefined
						}
						active="people"
					/>
				)
			}
			mainSidebar={{
				key: "people",
				label: "People",
				content: (
					<TeamSidebarHeaderActionsProvider>
						<TeamSidebarHeader />
						{sidebar}
					</TeamSidebarHeaderActionsProvider>
				),
			}}
			showMainHeader
		>
			{selectedMember ? (
				<SelectedHumanProfileWorkspace
					activityContent={
						input.organizationId &&
						selectedMember.profileStatus === "active" ? (
							<MemberSharedActivity
								memberUserId={selectedMember.userId}
								nowMs={activityNowMs}
								organizationId={input.organizationId}
							/>
						) : null
					}
					directMessageIsPending={input.state.directMessage === "pending"}
					key={selectedMember.id}
					localAgentsContent={
						<MemberLocalAgents
							chatPending={input.state.directMessage === "pending"}
							failed={agentInventoryFailed}
							group={agentInventoryFailed ? null : selectedComputerGroup}
							member={selectedMember}
							nowMs={activityNowMs}
							onOpenAgent={openProfileChat}
							onOpenHuman={() => openProfileChat(selectedMember.id)}
							pending={agentInventoryPending}
						/>
					}
					member={selectedMember}
					onOpenDirectMessage={() => openProfileChat(selectedMember.id)}
				/>
			) : null}
			{!selectedMember && showTeamHome && (
				<TeamHome
					activityNowMs={activityNowMs}
					chatPending={input.state.directMessage === "pending"}
					computerGroups={preview.computerGroups}
					members={preview.members}
					onChat={input.onOpenDirectMessage}
					onSelect={input.onSelectProfile}
				/>
			)}
			{!(selectedMember || showTeamHome) && (
				<HumanProfileWorkspaceState
					detail={Boolean(input.selectedProfileId)}
					emptyMessage={input.emptyMessage}
					errorMessage={input.errorMessage}
					loading={input.state.profiles === "loading"}
				/>
			)}
		</AppFullWidthLayout>
	);
}

function SelectedHumanProfileWorkspace(input: {
	activityContent: ReactNode;
	directMessageIsPending: boolean;
	localAgentsContent: ReactNode;
	member: DirectoryHumanProfileRow;
	onOpenDirectMessage: () => void;
}) {
	const [editing, setEditing] = useState(false);
	return (
		<DirectoryHumanProfileDetails
			{...input}
			editing={editing}
			onEditingChange={setEditing}
		/>
	);
}

function HumanProfileWorkspaceState(input: {
	detail: boolean;
	emptyMessage: string;
	errorMessage: string | null;
	loading: boolean;
}) {
	if (input.loading) {
		return input.detail ? (
			<SkeletonRegion
				className="mx-auto w-full max-w-5xl space-y-6 p-6"
				label="Loading member"
			>
				<div className="space-y-6">
					<div className="flex items-center gap-4">
						<Skeleton className="size-24 rounded-full" />
						<div className="min-w-0 space-y-3">
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-48" />
						</div>
					</div>
					<Skeleton className="h-4 w-24" />
					<SkeletonRows label="Loading profile details" />
					<ComputerCardsSkeleton />
				</div>
			</SkeletonRegion>
		) : (
			<TeamHomeSkeleton className="p-6" label="Loading people" />
		);
	}
	const message = input.errorMessage ?? input.emptyMessage;
	return (
		<div className="grid min-h-full place-items-center px-6 py-12 text-center">
			<p className="max-w-md text-muted-foreground text-sm">{message}</p>
		</div>
	);
}

function resolveSelectedMember(input: {
	members: readonly DirectoryHumanProfileRow[];
	selectedProfileId: string | null;
}): DirectoryHumanProfileRow | null {
	return (
		input.members.find((member) => member.id === input.selectedProfileId) ??
		null
	);
}
