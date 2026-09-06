"use client";

import type {
	CenterAgentMemberResearchBatch,
	CenterAgentMemberResearchTask,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { type ReactNode, useEffect, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
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
import { localPeopleSidebarFixtures } from "#/lib/dev/people-sidebar-fixtures";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { PeopleSidebar } from "./people-sidebar";

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

const DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS = 60_000;

export function DirectoryHumanProfilesWorkspace(input: {
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
	orgSlug: string;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	profileReportsAreRetrying: boolean;
	profileReportsErrorMessage: string | null;
	recovery: LocalAgentRecoveryController;
	researchErrorMessage: string | null;
	selectedProfileId: string | null;
	state: DirectoryHumanProfilesViewState;
}) {
	const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
	const [previewReady, setPreviewReady] = useState(false);
	const preview = localPeopleSidebarFixtures({
		members: input.members,
		computerGroups: input.computerGroups,
		orgSlug: input.orgSlug,
		enabled: previewReady,
	});
	const selectedMember = resolveSelectedMember({
		members: preview.members,
		selectedProfileId: input.selectedProfileId,
	});
	const selectedComputerGroup = selectedMember
		? (preview.computerGroups.find(
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

	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mainSidebarContent={sidebar}
			showMainHeader
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
			) : (
				<HumanProfileWorkspaceState
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
	if (input.directoryError) {
		return (
			<p className="px-4 py-3 text-destructive text-sm" role="alert">
				{input.directoryError}
			</p>
		);
	}
	if (input.directoryIsPending) {
		return (
			<p className="px-4 py-3 text-muted-foreground text-sm">
				Loading computers…
			</p>
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
				directoryError={input.directoryError}
				directoryIsPending={input.directoryIsPending}
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
	emptyMessage: string;
	errorMessage: string | null;
	loading: boolean;
}) {
	const message = input.loading
		? "Loading people…"
		: (input.errorMessage ?? input.emptyMessage);
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
		input.members.find((member) => member.isCurrentUser) ??
		input.members[0] ??
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
