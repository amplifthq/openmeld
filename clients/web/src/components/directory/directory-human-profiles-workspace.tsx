import { TeamHeader } from "./team-header";

("use client");

import type {
	CenterAgentMemberResearchBatch,
	CenterAgentMemberResearchTask,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	SkeletonRegion,
	SkeletonRows,
} from "@openmeld/ui/components/skeleton-content";
import { PlusIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { ComputerCardsSkeleton } from "#/components/computers/computer-cards-skeleton";
import { ComputersPicker } from "#/components/computers/computers-picker";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import {
	ConnectChannelAccountDialog,
	ManageChannelAccountDialog,
} from "#/components/directory/directory-channel-account-dialogs";
import {
	DirectoryHumanProfileDetails,
	type DirectoryHumanProfileResearchAction,
} from "#/components/directory/directory-human-profile-details";
import type {
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";
import { useHumanPresence } from "#/components/profiles/human-presence";
import { localPeopleSidebarFixtures } from "#/lib/dev/people-sidebar-fixtures";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { PeopleSidebar } from "./people-sidebar";
import { TeamHome } from "./team-home";
import { TeamHomeSkeleton } from "./team-home-skeleton";

type LocalAgentRecoveryController = ReturnType<
	typeof useLocalAgentRecoveryController
>;

export type DirectoryMemberResearchRequest =
	| { scope: "all" }
	| { scope: "member"; subjectUserId: string };

export type DirectoryHumanProfilesViewState = {
	context: "organization" | "personal";
	directMessage: "idle" | "pending";
	profiles: "loading" | "ready";
	research: "idle" | "pending";
};

const DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS = 30_000;

export function DirectoryHumanProfilesWorkspace(input: {
	presentation?: "page" | "sidebar";
	activeBatch: CenterAgentMemberResearchBatch | null;
	canCreateProfile: boolean;
	computerGroups: readonly OrganizationComputerGroup[];
	directoryError: string | null;
	directoryIsPending: boolean;
	emptyMessage: string;
	errorMessage: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	latestBatch: CenterAgentMemberResearchBatch | null;
	memberResearchError: { message: string; subjectUserId: string } | null;
	members: readonly DirectoryHumanProfileRow[];
	modelCatalog?: ModelCatalog | null;
	onCreateProfile: () => void;
	onDisconnectConnectedAccount: (identityLinkId: string) => void;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onRetryProfileReports: () => void;
	onRequestChannelSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	onResearchAll: () => void;
	onSelectProfile: (profileId: string) => void;
	onInviteMembers?: () => void;
	orgSlug: string;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	profileReportsAreRetrying: boolean;
	profileReportsErrorMessage: string | null;
	recovery: LocalAgentRecoveryController;
	researchErrorMessage: string | null;
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
	const researchAction = selectedMember
		? resolveResearchAction({
				activeBatch: input.activeBatch,
				latestBatch: input.latestBatch,
				member: selectedMember,
				memberResearchError: input.memberResearchError,
				onResearch: input.onResearch,
				pendingResearch: input.pendingResearch,
				state: input.state,
			})
		: null;

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
	if (input.presentation === "sidebar") {
		return sidebar;
	}

	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mainHeader={
				input.selectedProfileId ? undefined : (
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
			mainSidebarContent={sidebar}
			showMainHeader={!input.selectedProfileId}
		>
			{input.researchErrorMessage ? (
				<p className="m-4 rounded-md border border-destructive/50 px-4 py-3 text-destructive text-sm">
					{input.researchErrorMessage}
				</p>
			) : null}
			{selectedMember ? (
				<SelectedHumanProfileWorkspace
					activityNowMs={activityNowMs}
					computersContent={
						<HumanProfileComputers
							directoryError={input.directoryError}
							directoryIsPending={input.directoryIsPending}
							group={selectedComputerGroup}
							isOrganizationContext={input.state.context === "organization"}
							orgSlug={input.orgSlug}
							profileId={selectedMember.id}
							recovery={input.recovery}
						/>
					}
					directMessageIsPending={input.state.directMessage === "pending"}
					key={selectedMember.id}
					member={selectedMember}
					modelCatalog={input.modelCatalog ?? null}
					onDisconnectConnectedAccount={input.onDisconnectConnectedAccount}
					onOpenDirectMessage={() => {
						input.onOpenDirectMessage(selectedMember.id).catch((error) => {
							console.error(
								"Human Profile Direct Message action failed.",
								error
							);
						});
					}}
					onRequestChannelSetup={input.onRequestChannelSetup}
					onRetryProfileReports={input.onRetryProfileReports}
					profileReportsAreRetrying={input.profileReportsAreRetrying}
					profileReportsErrorMessage={input.profileReportsErrorMessage}
					researchAction={researchAction}
				/>
			) : null}
			{!selectedMember && showTeamHome && (
				<TeamHome
					activityNowMs={activityNowMs}
					computerGroups={preview.computerGroups}
					members={preview.members}
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
	activityNowMs: number;
	computersContent: ReactNode;
	directMessageIsPending: boolean;
	member: DirectoryHumanProfileRow;
	modelCatalog: ModelCatalog | null;
	onDisconnectConnectedAccount: (identityLinkId: string) => void;
	onOpenDirectMessage: () => void;
	onRequestChannelSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
	onRetryProfileReports: () => void;
	profileReportsAreRetrying: boolean;
	profileReportsErrorMessage: string | null;
	researchAction: DirectoryHumanProfileResearchAction | null;
}) {
	const [editing, setEditing] = useState(false);
	const [connectableAccounts, setConnectableAccounts] = useState<
		readonly DirectoryIdentityAccount[] | null
	>(null);
	const [connectedAccount, setConnectedAccount] =
		useState<DirectoryIdentityAccount | null>(null);

	return (
		<>
			<DirectoryHumanProfileDetails
				activityNowMs={input.activityNowMs}
				computersContent={input.computersContent}
				directMessageIsPending={input.directMessageIsPending}
				editing={editing}
				member={input.member}
				modelCatalog={input.modelCatalog}
				onConnectAccount={(account) => setConnectableAccounts([account])}
				onEditingChange={setEditing}
				onManageAccount={setConnectedAccount}
				onOpenDirectMessage={input.onOpenDirectMessage}
				onRetryProfileReports={input.onRetryProfileReports}
				profileReportsAreRetrying={input.profileReportsAreRetrying}
				profileReportsErrorMessage={input.profileReportsErrorMessage}
				researchAction={input.researchAction}
			/>
			<ConnectChannelAccountDialog
				accounts={connectableAccounts}
				onOpenChange={(open) => {
					if (!open) {
						setConnectableAccounts(null);
					}
				}}
				onRequestSetup={input.onRequestChannelSetup}
			/>
			<ManageChannelAccountDialog
				account={connectedAccount}
				onDisconnect={() => {
					if (connectedAccount?.id) {
						input.onDisconnectConnectedAccount(connectedAccount.id);
					}
					setConnectedAccount(null);
				}}
				onOpenChange={(open) => {
					if (!open) {
						setConnectedAccount(null);
					}
				}}
				profileName={input.member.name}
			/>
		</>
	);
}

function HumanProfileComputers(input: {
	directoryError: string | null;
	directoryIsPending: boolean;
	group: OrganizationComputerGroup | null;
	isOrganizationContext: boolean;
	orgSlug: string;
	profileId: string;
	recovery: LocalAgentRecoveryController;
}) {
	// The current user's inventory is independently authorized. Another member's
	// projection cannot hold it back, but remains required for that member's list.
	const needsTeamProjection = !input.group?.isCurrentUser;
	const inventory = input.recovery.localRuntimesQuery;
	if (
		!needsTeamProjection &&
		(inventory.isError || inventory.fetchStatus === "paused")
	) {
		return (
			<div className="space-y-3 p-4">
				<p className="text-muted-foreground text-sm" role="alert">
					Your computers could not be loaded.
				</p>
				<Button
					disabled={inventory.isFetching}
					onClick={() => inventory.refetch()}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			</div>
		);
	}
	if (needsTeamProjection && input.directoryError) {
		return (
			<p className="px-4 py-3 text-destructive text-sm" role="alert">
				{input.directoryError}
			</p>
		);
	}
	if (needsTeamProjection && input.directoryIsPending) {
		return (
			<div className="p-4">
				<ComputerCardsSkeleton />
			</div>
		);
	}
	if (!input.group) {
		return (
			<p className="px-4 py-3 text-muted-foreground text-sm">
				No computers connected.
			</p>
		);
	}
	const isReconcilingCurrentToolsStatus =
		input.recovery.currentLocalRuntimeReplyReadinessQuery.isFetching &&
		!input.recovery.currentLocalRuntimeReplyReadinessQuery.isFetchedAfterMount;
	return (
		<div className="p-4">
			<ComputersPicker
				computerGroups={[input.group]}
				directoryError={needsTeamProjection ? input.directoryError : null}
				directoryIsPending={needsTeamProjection && input.directoryIsPending}
				isOrganizationContext={input.isOrganizationContext}
				isPending={
					input.group.isCurrentUser &&
					input.recovery.localRuntimesQuery.isPending
				}
				isReconcilingCurrentToolsStatus={isReconcilingCurrentToolsStatus}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				recovery={input.recovery}
			/>
		</div>
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

function resolveResearchAction(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	latestBatch: CenterAgentMemberResearchBatch | null;
	member: DirectoryHumanProfileRow;
	memberResearchError: { message: string; subjectUserId: string } | null;
	onResearch: (subjectUserId: string) => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	state: DirectoryHumanProfilesViewState;
}): DirectoryHumanProfileResearchAction | null {
	if (input.member.profileReport.state === "unavailable") {
		return null;
	}
	const task = input.latestBatch?.tasks.find(
		(candidate) => candidate.subjectUserId === input.member.userId
	);
	const memberResearchError =
		input.memberResearchError?.subjectUserId === input.member.userId
			? input.memberResearchError.message
			: null;
	const isStarting =
		input.state.research === "pending" &&
		input.pendingResearch?.scope === "member" &&
		input.pendingResearch.subjectUserId === input.member.userId;
	return {
		description: `Learn about ${input.member.name} and update their Profile Report.`,
		disabled:
			!input.member.userId ||
			Boolean(input.activeBatch) ||
			input.state.research === "pending",
		errorMessage: memberResearchError,
		label: resolveLearnActionLabel({
			displayName: input.member.name,
			hasDraft:
				input.member.profileReport.state === "available" &&
				input.member.profileReport.hasDraft,
			hasStartError: Boolean(memberResearchError),
			isStarting,
			task,
		}),
		onSelect: () => input.onResearch(input.member.userId),
	};
}

function resolveLearnActionLabel(input: {
	displayName: string;
	hasDraft: boolean;
	hasStartError: boolean;
	isStarting: boolean;
	task: CenterAgentMemberResearchTask | undefined;
}): string {
	if (input.isStarting) {
		return "Starting…";
	}
	if (input.task?.status === "queued" || input.task?.status === "running") {
		return input.hasDraft ? "Finishing…" : "Learning…";
	}
	if (input.task?.status === "failed" || input.hasStartError) {
		return "Try again";
	}
	return `Learn about ${input.displayName}`;
}
