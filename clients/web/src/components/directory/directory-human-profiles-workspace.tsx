"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	CenterAgentMemberResearchBatch,
	CenterAgentMemberResearchTask,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { PlusIcon, UserFocusIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { ComputersPicker } from "#/components/computers/computers-picker";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import {
	ConnectChannelAccountDialog,
	ManageChannelAccountDialog,
} from "#/components/directory/directory-channel-account-dialogs";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import {
	DirectoryHumanProfileDetails,
	type DirectoryHumanProfileResearchAction,
} from "#/components/directory/directory-human-profile-details";
import { resolveDirectoryHumanProfileActivityLabel } from "#/components/directory/directory-human-profile-format";
import type {
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";
import {
	DirectoryComputerStatusIcon,
	DirectoryIdentityAccountSummary,
} from "#/components/directory/directory-human-profile-presentation";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";

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
const MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS = 4;

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
	onCreateProfile: () => void;
	onDisconnectConnectedAccount: (identityLinkId: string) => void;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onRequestChannelSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	onResearchAll: () => void;
	onSelectProfile: (profileId: string) => void;
	orgSlug: string;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	recovery: LocalAgentRecoveryController;
	researchErrorMessage: string | null;
	selectedProfileId: string | null;
	sidebarLeadingContent?: ReactNode;
	state: DirectoryHumanProfilesViewState;
}) {
	const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
	const selectedMember = resolveSelectedMember({
		members: input.members,
		selectedProfileId: input.selectedProfileId,
	});
	const selectedComputerGroup = selectedMember
		? (input.computerGroups.find(
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
	const learnAllLabel = resolveLearnAllActionLabel({
		activeBatch: input.activeBatch,
		isResearchPending: input.state.research === "pending",
		pendingResearch: input.pendingResearch,
	});
	const compactLearnAllLabel =
		learnAllLabel === "Learn about all members" ? "Learn all" : learnAllLabel;

	useEffect(() => {
		const intervalId = window.setInterval(
			() => setActivityNowMs(Date.now()),
			DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS
		);
		return () => window.clearInterval(intervalId);
	}, []);

	const sidebar = (
		<AppContextualSidebarNav
			activeItemId={selectedMember?.id ?? null}
			ariaLabel="People"
			groups={[
				{
					ariaLabel: "Human Profiles",
					content: (
						<HumanProfileSidebarList
							activityNowMs={activityNowMs}
							computerGroups={input.computerGroups}
							emptyMessage={input.emptyMessage}
							errorMessage={input.errorMessage}
							members={input.members}
							onSelect={input.onSelectProfile}
							selectedProfileId={selectedMember?.id ?? null}
							state={input.state}
						/>
					),
					id: "human-profiles",
					label: "Human Profiles",
				},
			]}
			leadingContent={
				<div className="space-y-2">
					{input.sidebarLeadingContent}
					{input.canCreateProfile ? (
						<Button
							aria-label="Create Human Profile"
							className="w-full min-w-0 justify-start overflow-hidden"
							onClick={input.onCreateProfile}
							size="sm"
							type="button"
							variant="ghost"
						>
							<PlusIcon
								aria-hidden="true"
								className="shrink-0"
								data-icon="inline-start"
							/>
							<span
								aria-hidden="true"
								className="@[12rem]/contextual-sidebar:inline hidden truncate"
							>
								Create Human Profile
							</span>
							<span
								aria-hidden="true"
								className="@[12rem]/contextual-sidebar:hidden truncate"
							>
								Create
							</span>
						</Button>
					) : null}
					{input.state.context === "organization" ? (
						<Button
							aria-label={learnAllLabel}
							className="w-full min-w-0 justify-start overflow-hidden"
							disabled={
								Boolean(input.activeBatch) ||
								input.state.research === "pending" ||
								input.members.length === 0
							}
							onClick={input.onResearchAll}
							size="sm"
							type="button"
							variant="ghost"
						>
							<UserFocusIcon
								aria-hidden="true"
								className="shrink-0"
								data-icon="inline-start"
							/>
							<span
								aria-hidden="true"
								className="@[12rem]/contextual-sidebar:inline hidden truncate"
							>
								{learnAllLabel}
							</span>
							<span
								aria-hidden="true"
								className="@[12rem]/contextual-sidebar:hidden truncate"
							>
								{compactLearnAllLabel}
							</span>
						</Button>
					) : null}
				</div>
			}
			onActivate={input.onSelectProfile}
			title="People"
		/>
	);

	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialInnerSidebarState={input.initialSidebarStates?.inner}
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mobileSidebarTitle="People"
			showMainHeader
			sidebar={sidebar}
			sidebarPreferenceKey="people"
			sidebarSeparatorLabel="Resize the People sidebar"
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
							recovery={input.recovery}
						/>
					}
					directMessageIsPending={input.state.directMessage === "pending"}
					key={selectedMember.id}
					member={selectedMember}
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
	onDisconnectConnectedAccount: (identityLinkId: string) => void;
	onOpenDirectMessage: () => void;
	onRequestChannelSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
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
				onConnectAccount={(account) => setConnectableAccounts([account])}
				onEditingChange={setEditing}
				onManageAccount={setConnectedAccount}
				onOpenDirectMessage={input.onOpenDirectMessage}
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

function HumanProfileSidebarList(input: {
	activityNowMs: number;
	computerGroups: readonly OrganizationComputerGroup[];
	emptyMessage: string;
	errorMessage: string | null;
	members: readonly DirectoryHumanProfileRow[];
	onSelect: (profileId: string) => void;
	selectedProfileId: string | null;
	state: DirectoryHumanProfilesViewState;
}) {
	if (input.state.profiles === "loading") {
		return (
			<div className="space-y-1" data-testid="people-sidebar-loading">
				{["first", "second", "third"].map((id) => (
					<div className="flex min-h-20 items-start gap-2 px-2 py-2" key={id}>
						<Skeleton className="size-9 shrink-0 rounded-full" />
						<div className="flex-1 space-y-2 pt-1">
							<Skeleton className="h-3 w-3/4" />
							<Skeleton className="h-3 w-full" />
						</div>
					</div>
				))}
			</div>
		);
	}
	if (input.errorMessage) {
		return (
			<p className="px-2 py-3 text-destructive text-xs">{input.errorMessage}</p>
		);
	}
	if (input.members.length === 0) {
		return (
			<p className="px-2 py-3 text-muted-foreground text-xs">
				{input.emptyMessage}
			</p>
		);
	}
	return (
		<FluidNavMenu
			activeIndicatorClassName="bg-sidebar-accent"
			activeValue={input.selectedProfileId}
			aria-label="Human Profiles"
			focusIndicatorClassName="border-sidebar-ring"
			hoverIndicatorClassName="bg-sidebar-accent"
		>
			{input.members.map((member, index) => (
				<HumanProfileSidebarItem
					activityNowMs={input.activityNowMs}
					computerGroup={
						input.computerGroups.find(
							(group) => group.ownerUserId === member.userId
						) ?? null
					}
					index={index}
					isActive={member.id === input.selectedProfileId}
					key={member.id}
					member={member}
					onSelect={input.onSelect}
				/>
			))}
		</FluidNavMenu>
	);
}

function HumanProfileSidebarItem(input: {
	activityNowMs: number;
	computerGroup: OrganizationComputerGroup | null;
	index: number;
	isActive: boolean;
	member: DirectoryHumanProfileRow;
	onSelect: (profileId: string) => void;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const activityLabel = resolveDirectoryHumanProfileActivityLabel({
		lastActiveAt: input.member.lastActiveAt,
		nowMs: input.activityNowMs,
		profileStatus: input.member.profileStatus,
	});
	const localAgents = useMemo(
		() => resolveEnabledLocalAgents(input.computerGroup),
		[input.computerGroup]
	);
	const mappedAccounts = input.member.identityAccounts.filter(
		(account) => account.id !== null
	);
	const visibleLocalAgents = localAgents.slice(
		0,
		MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS
	);
	const hiddenLocalAgentCount = localAgents.length - visibleLocalAgents.length;
	return (
		<FluidNavMenuItem index={input.index} value={input.member.id}>
			<button
				aria-current={input.isActive ? "page" : undefined}
				aria-label={`Open ${input.member.name}'s profile`}
				className={cn(
					"flex min-h-20 w-full min-w-0 flex-row items-start gap-2 px-2 py-2 text-left outline-none",
					APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
					APP_NAV_ITEM_TONE_CLASS_NAME,
					input.isActive ? "text-sidebar-accent-foreground" : null
				)}
				onClick={() => {
					input.onSelect(input.member.id);
					dismiss();
				}}
				type="button"
			>
				<DirectoryHumanProfileAvatar context="sidebar" member={input.member} />
				<span className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
					<span
						className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden whitespace-nowrap"
						data-slot="human-profile-sidebar-heading"
					>
						<span className="min-w-0 truncate font-medium text-sm">
							{input.member.name}
						</span>
						<DirectoryComputerStatusIcon member={input.member} />
						{input.member.isCurrentUser ? (
							<span className="shrink-0 text-muted-foreground text-xs">
								(you)
							</span>
						) : null}
					</span>
					{mappedAccounts.length > 0 ? (
						<span
							className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap"
							data-slot="human-profile-channel-identities"
						>
							{mappedAccounts.map((account) => (
								<span
									className="min-w-0 shrink overflow-hidden"
									key={account.provider}
								>
									<DirectoryIdentityAccountSummary
										account={account}
										context="sidebar"
									/>
								</span>
							))}
						</span>
					) : null}
					{activityLabel ? (
						<span className="block truncate text-muted-foreground text-xs">
							{activityLabel}
						</span>
					) : null}
					{localAgents.length > 0 ? (
						<span className="flex min-h-4 min-w-0 items-center justify-end">
							<span
								aria-label={buildLocalAgentSummary(localAgents)}
								className="ml-auto flex shrink-0 items-center justify-end -space-x-1.5"
								role="img"
							>
								{visibleLocalAgents.map((agent) => (
									<Tooltip key={agent.agentId}>
										<TooltipTrigger
											render={
												<span
													aria-hidden="true"
													className="group/local-agent relative z-0 grid size-4 shrink-0 place-items-center hover:z-20"
													data-testid="human-profile-local-agent"
												/>
											}
										>
											<span
												className="relative isolate inline-grid size-4 overflow-hidden rounded-sm bg-sidebar p-px transition-transform duration-150 ease-[cubic-bezier(0.19,1,0.22,1)] before:absolute before:inset-0 before:bg-sidebar-accent before:content-[''] group-hover/local-agent:-translate-y-1 group-hover/local-agent:scale-[1.14] motion-reduce:transform-none motion-reduce:transition-none"
												data-slot="human-profile-local-agent-logo"
											>
												<LocalAgentLogo
													agentId={agent.agentId}
													className="relative z-10"
													size="xs"
												/>
											</span>
										</TooltipTrigger>
										<TooltipContent side="top" sideOffset={6}>
											{agent.displayName}
										</TooltipContent>
									</Tooltip>
								))}
								{hiddenLocalAgentCount > 0 ? (
									<Tooltip>
										<TooltipTrigger
											render={
												<span className="relative isolate z-10 inline-flex h-4 min-w-4 items-center justify-center overflow-hidden rounded-full bg-sidebar px-0.5 font-medium text-[9px] text-muted-foreground before:absolute before:inset-0 before:bg-sidebar-accent before:content-['']" />
											}
										>
											<span className="relative z-10">
												+{hiddenLocalAgentCount}
											</span>
										</TooltipTrigger>
										<TooltipContent side="top" sideOffset={6}>
											{localAgents
												.slice(MAX_VISIBLE_SIDEBAR_LOCAL_AGENTS)
												.map((agent) => agent.displayName)
												.join(", ")}
										</TooltipContent>
									</Tooltip>
								) : null}
							</span>
						</span>
					) : null}
				</span>
			</button>
		</FluidNavMenuItem>
	);
}

type LocalAgentIdentity = { agentId: string; displayName: string };

function resolveEnabledLocalAgents(
	group: OrganizationComputerGroup | null
): readonly LocalAgentIdentity[] {
	if (!group) {
		return [];
	}
	const agents = new Map<string, LocalAgentIdentity>();
	for (const computer of group.computers) {
		if (computer.ownedComputer) {
			appendOwnedComputerLocalAgents(
				agents,
				computer.ownedComputer.executionTargets
			);
			continue;
		}
		appendOrganizationComputerLocalAgents(agents, computer.localAgents);
	}
	return [...agents.values()].sort((left, right) =>
		left.displayName.localeCompare(right.displayName, "en", {
			sensitivity: "base",
		})
	);
}

function appendOwnedComputerLocalAgents(
	agents: Map<string, LocalAgentIdentity>,
	executionTargets: NonNullable<
		OrganizationComputerGroup["computers"][number]["ownedComputer"]
	>["executionTargets"]
): void {
	for (const target of executionTargets) {
		if (target.status === "stale") {
			continue;
		}
		for (const entry of target.localAgentCatalog.entries) {
			if (
				entry.enabled &&
				entry.detected &&
				entry.lifecycleStatus !== "suspended" &&
				hasLocalAgentLogo(entry.agentId)
			) {
				agents.set(entry.agentId, {
					agentId: entry.agentId,
					displayName: entry.displayName,
				});
			}
		}
	}
}

function appendOrganizationComputerLocalAgents(
	agents: Map<string, LocalAgentIdentity>,
	localAgents: OrganizationComputerGroup["computers"][number]["localAgents"]
): void {
	for (const localAgent of localAgents) {
		const parsed = parseAgentControllerRef(localAgent.agentControllerRef);
		if (
			localAgent.enabled &&
			parsed?.kind === "builtin" &&
			hasLocalAgentLogo(parsed.id)
		) {
			agents.set(parsed.id, {
				agentId: parsed.id,
				displayName: formatLocalAgentDisplayName(parsed.id),
			});
		}
	}
}

function buildLocalAgentSummary(
	localAgents: readonly LocalAgentIdentity[]
): string {
	return localAgents.map((agent) => `${agent.displayName} enabled`).join(", ");
}

function HumanProfileComputers(input: {
	directoryError: string | null;
	directoryIsPending: boolean;
	group: OrganizationComputerGroup | null;
	isOrganizationContext: boolean;
	orgSlug: string;
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
		? "Loading Human Profiles…"
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

function resolveLearnAllActionLabel(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	isResearchPending: boolean;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
}): string {
	if (input.activeBatch) {
		const processedCount =
			input.activeBatch.completedCount + input.activeBatch.failedCount;
		return `Learning ${processedCount}/${input.activeBatch.totalCount}`;
	}
	if (input.isResearchPending && input.pendingResearch?.scope === "all") {
		return "Starting…";
	}
	return "Learn about all members";
}
