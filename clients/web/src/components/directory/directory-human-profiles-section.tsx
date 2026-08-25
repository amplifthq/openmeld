"use client";

import type {
	CenterAgentMemberResearchBatch,
	CenterAgentMemberResearchTask,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	DotsThreeIcon,
	FileTextIcon,
	InfoIcon,
	PencilSimpleIcon,
	PlusIcon,
	UserFocusIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
} from "#/components/directory/directory-card-grid";
import { DirectoryHumanProfileAvatar } from "#/components/directory/directory-human-profile-avatar";
import {
	DirectoryHumanProfileDetailsDrawer,
	type DirectoryHumanProfileResearchAction,
} from "#/components/directory/directory-human-profile-details-drawer";
import {
	resolveDirectoryEmailLabel,
	resolveDirectoryHumanProfileActivityLabel,
	resolveDirectoryIdentityAccountLabel,
} from "#/components/directory/directory-human-profile-format";
import type {
	DirectoryHumanProfileRow,
	DirectoryIdentityAccount,
} from "#/components/directory/directory-human-profile-model";
import {
	DirectoryComputerSummary,
	DirectoryIdentityAccountSummary,
} from "#/components/directory/directory-human-profile-presentation";
import { DirectoryHumanProfileRoleBadge } from "#/components/directory/directory-human-profile-role-badge";
import { DirectoryIdentityAccountActionLink } from "#/components/directory/directory-identity-account-action-link";
import { ProfileCard } from "#/components/profiles/profile-list-item";
import { ProfilesSectionLayout } from "#/components/profiles/profiles-section-layout";

export type DirectoryMemberResearchRequest =
	| { scope: "all" }
	| { scope: "member"; subjectUserId: string };

export type DirectoryHumanProfilesViewState = {
	context: "organization" | "personal";
	directMessage: "idle" | "pending";
	profiles: "loading" | "ready";
	research: "idle" | "pending";
};

type DirectoryHumanProfileCardState = Omit<
	DirectoryHumanProfilesViewState,
	"profiles"
> & {
	highlight: "default" | "highlighted";
};

const DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS = 60_000;

export function DirectoryHumanProfilesSection(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	canCreateProfile: boolean;
	emptyMessage: string;
	errorMessage: string | null;
	focusProfileId: string | null;
	latestBatch: CenterAgentMemberResearchBatch | null;
	memberResearchError: { message: string; subjectUserId: string } | null;
	members: readonly DirectoryHumanProfileRow[];
	onCreateProfile: () => void;
	onFocusConsumed?: () => void;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onRequestChannelSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
	onDisconnectConnectedAccount: (identityLinkId: string) => void;
	onResearch: (subjectUserId: string) => void;
	onResearchAll: () => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	researchErrorMessage: string | null;
	state: DirectoryHumanProfilesViewState;
}) {
	const rowElementsRef = useRef(new Map<string, HTMLElement>());
	const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
	const [highlightedProfileId, setHighlightedProfileId] = useState<
		string | null
	>(null);
	const latestTasks = input.latestBatch?.tasks ?? [];
	const processedCount = input.activeBatch
		? input.activeBatch.completedCount + input.activeBatch.failedCount
		: 0;
	const profilesAreLoading = input.state.profiles === "loading";
	const researchIsPending = input.state.research === "pending";
	const learnAllLabel = resolveLearnAllActionLabel({
		activeBatch: input.activeBatch,
		isResearchPending: researchIsPending,
		pendingResearch: input.pendingResearch,
		processedCount,
	});

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			setActivityNowMs(Date.now());
		}, DIRECTORY_ACTIVITY_REFRESH_INTERVAL_MS);
		return () => window.clearInterval(intervalId);
	}, []);

	useEffect(() => {
		if (!input.focusProfileId || profilesAreLoading) {
			return;
		}
		const focusedProfile = input.members.find(
			(member) => member.id === input.focusProfileId
		);
		if (!focusedProfile) {
			return;
		}
		setHighlightedProfileId(focusedProfile.id);
		const focusedRow = rowElementsRef.current.get(focusedProfile.id);
		const openProfileButton = focusedRow?.querySelector<HTMLButtonElement>(
			"[data-profile-card-open]"
		);
		if (!openProfileButton) {
			return;
		}
		focusedRow?.scrollIntoView?.({ block: "center", behavior: "smooth" });
		openProfileButton.click();
		input.onFocusConsumed?.();
	}, [
		input.focusProfileId,
		input.members,
		input.onFocusConsumed,
		profilesAreLoading,
	]);

	let content: ReactNode;
	if (profilesAreLoading) {
		content = <HumanProfileRowsSkeleton />;
	} else if (input.errorMessage) {
		content = <ProfilesInlineState message={input.errorMessage} />;
	} else if (input.members.length === 0) {
		content = <ProfilesInlineState message={input.emptyMessage} />;
	} else {
		content = (
			<DirectoryCardGrid>
				{input.members.map((member) => (
					<DirectoryCardItem itemId={member.id} key={member.id}>
						<DirectoryHumanProfileCard
							activeBatch={input.activeBatch}
							activityNowMs={activityNowMs}
							latestTasks={latestTasks}
							member={member}
							memberResearchError={input.memberResearchError}
							onDisconnectConnectedAccount={input.onDisconnectConnectedAccount}
							onOpenDirectMessage={input.onOpenDirectMessage}
							onRequestChannelSetup={input.onRequestChannelSetup}
							onResearch={input.onResearch}
							pendingResearch={input.pendingResearch}
							rowRef={(node) => {
								if (node) {
									rowElementsRef.current.set(member.id, node);
								} else {
									rowElementsRef.current.delete(member.id);
								}
							}}
							state={{
								context: input.state.context,
								directMessage: input.state.directMessage,
								highlight:
									highlightedProfileId === member.id
										? "highlighted"
										: "default",
								research: input.state.research,
							}}
						/>
					</DirectoryCardItem>
				))}
			</DirectoryCardGrid>
		);
	}

	return (
		<ProfilesSectionLayout
			action={
				<div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
					<Button
						disabled={
							Boolean(input.activeBatch) ||
							researchIsPending ||
							input.members.length === 0
						}
						onClick={input.onResearchAll}
						size="sm"
					>
						<UserFocusIcon aria-hidden="true" data-icon="inline-start" />
						{learnAllLabel}
					</Button>
					{input.canCreateProfile ? (
						<Button onClick={input.onCreateProfile} size="sm" type="button">
							<PlusIcon aria-hidden="true" data-icon="inline-start" />
							Create Human Profile
						</Button>
					) : null}
				</div>
			}
			description={
				input.state.context === "organization"
					? "A Human Profile is the name and identity each member uses in Spaces. The Center Agent can learn about members and keep their Profile Reports up to date."
					: "Your Human Profile is the name and identity you use in Spaces."
			}
			headingLevel="h2"
			title="Human Profiles"
		>
			{input.researchErrorMessage ? (
				<ProfilesInlineState
					isDestructive={true}
					message={input.researchErrorMessage}
				/>
			) : null}
			{content}
		</ProfilesSectionLayout>
	);
}

function DirectoryHumanProfileCard(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	activityNowMs: number;
	latestTasks: readonly CenterAgentMemberResearchTask[];
	member: DirectoryHumanProfileRow;
	memberResearchError: { message: string; subjectUserId: string } | null;
	onDisconnectConnectedAccount: (identityLinkId: string) => void;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onRequestChannelSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	rowRef: (node: HTMLElement | null) => void;
	state: DirectoryHumanProfileCardState;
}) {
	const profileReturnFocusRef = useRef<HTMLElement>(null);
	const [isDetailsOpen, setIsDetailsOpen] = useState(false);
	const [isEditingDetails, setIsEditingDetails] = useState(false);
	const [connectableAccounts, setConnectableAccounts] = useState<
		readonly DirectoryIdentityAccount[] | null
	>(null);
	const [connectedAccount, setConnectedAccount] =
		useState<DirectoryIdentityAccount | null>(null);
	const task = input.latestTasks.find(
		(candidate) => candidate.subjectUserId === input.member.userId
	);
	const isStarting =
		input.state.research === "pending" &&
		input.pendingResearch?.scope === "member" &&
		input.pendingResearch.subjectUserId === input.member.userId;
	const memberResearchError =
		input.memberResearchError?.subjectUserId === input.member.userId
			? input.memberResearchError.message
			: null;
	const researchAction: DirectoryHumanProfileResearchAction | null =
		input.member.profileReport.state === "unavailable"
			? null
			: {
					description: `Learn about ${input.member.name} and update their Profile Report.`,
					disabled:
						!input.member.userId ||
						Boolean(input.activeBatch) ||
						input.state.research === "pending",
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
	const openProfile = (editing: boolean) => {
		profileReturnFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		setIsEditingDetails(editing);
		setIsDetailsOpen(true);
	};
	return (
		<>
			<ProfileCard
				actions={
					input.member.notice || memberResearchError ? (
						<HumanProfileCardNotice
							member={input.member}
							memberResearchError={memberResearchError}
						/>
					) : undefined
				}
				className={cn(
					"min-h-48",
					input.state.highlight === "highlighted"
						? "border-ring bg-muted/30 ring-1 ring-ring/60"
						: null
				)}
				footerLeft={<DirectoryComputerSummary member={input.member} />}
				footerRight={
					<HumanProfileIdentitySummary
						accounts={input.member.identityAccounts}
						onConnectAccounts={setConnectableAccounts}
						onOpenDetails={() => openProfile(false)}
					/>
				}
				icon={
					<DirectoryHumanProfileAvatar context="card" member={input.member} />
				}
				menu={
					<HumanProfileCardActions
						directMessageIsPending={input.state.directMessage === "pending"}
						member={input.member}
						onEdit={() => openProfile(true)}
						onOpenDirectMessage={async () => {
							await input.onOpenDirectMessage(input.member.id);
						}}
						onOpenProfile={() => openProfile(false)}
						researchAction={researchAction}
					/>
				}
				onCardClick={() => openProfile(false)}
				onProfileSummaryClick={() => openProfile(false)}
				profileSummaryAriaLabel={`Open ${input.member.name}'s profile`}
				rowRef={input.rowRef}
				secondarySubtitle={
					resolveDirectoryHumanProfileActivityLabel({
						lastActiveAt: input.member.lastActiveAt,
						nowMs: input.activityNowMs,
						profileStatus: input.member.profileStatus,
					}) ?? undefined
				}
				subtitle={resolveDirectoryEmailLabel(input.member.email)}
				testId={
					input.state.context === "organization"
						? "organization-human-profile-row"
						: "human-profile-row"
				}
				title={input.member.name}
				titleAction={
					<DirectoryHumanProfileRoleBadge role={input.member.role} />
				}
				titleAdornment={
					input.member.isCurrentUser ? (
						<span className="text-muted-foreground text-xs">(you)</span>
					) : null
				}
			/>
			<DirectoryHumanProfileDetailsDrawer
				activityNowMs={input.activityNowMs}
				directMessageIsPending={input.state.directMessage === "pending"}
				editing={isEditingDetails}
				member={input.member}
				onConnectAccount={(account) => {
					profileReturnFocusRef.current = null;
					setIsDetailsOpen(false);
					setIsEditingDetails(false);
					setConnectableAccounts([account]);
				}}
				onEditingChange={setIsEditingDetails}
				onManageAccount={(account) => {
					profileReturnFocusRef.current = null;
					setIsDetailsOpen(false);
					setIsEditingDetails(false);
					setConnectedAccount(account);
				}}
				onOpenChange={(open) => {
					setIsDetailsOpen(open);
					if (!open) {
						setIsEditingDetails(false);
					}
				}}
				onOpenDirectMessage={() => {
					profileReturnFocusRef.current = null;
					input.onOpenDirectMessage(input.member.id).catch((error) => {
						console.error("Human Profile Direct Message action failed.", error);
					});
				}}
				open={isDetailsOpen}
				researchAction={researchAction}
				returnFocusRef={profileReturnFocusRef}
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
						setConnectedAccount(null);
					}
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

function HumanProfileCardNotice(input: {
	member: DirectoryHumanProfileRow;
	memberResearchError: string | null;
}) {
	if (!(input.member.notice || input.memberResearchError)) {
		return null;
	}
	return (
		<div className="space-y-2">
			{input.member.notice ? (
				<p className="text-muted-foreground text-sm leading-6">
					{input.member.notice}
				</p>
			) : null}
			{input.memberResearchError ? (
				<p className="text-destructive text-xs leading-5">
					{input.memberResearchError}
				</p>
			) : null}
		</div>
	);
}

function HumanProfileIdentitySummary(input: {
	accounts: readonly DirectoryIdentityAccount[];
	onConnectAccounts: (accounts: readonly DirectoryIdentityAccount[]) => void;
	onOpenDetails: () => void;
}) {
	if (input.accounts.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			{input.accounts.map((account) => {
				const canConnect = account.action !== null;
				if (
					account.action?.path &&
					account.action.kind !== "connect_via_center_agent"
				) {
					return (
						<DirectoryIdentityAccountActionLink
							actionKind={account.action.kind}
							ariaLabel={account.action.label}
							className="inline-flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
							key={account.provider}
							path={account.action.path}
						>
							<DirectoryIdentityAccountSummary
								account={account}
								context="card"
							/>
						</DirectoryIdentityAccountActionLink>
					);
				}
				return (
					<button
						aria-label={
							canConnect
								? account.action?.label
								: `${account.providerLabel} account: ${resolveDirectoryIdentityAccountLabel(account)}`
						}
						className="inline-flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
						key={account.provider}
						onClick={() => {
							if (canConnect) {
								input.onConnectAccounts([account]);
								return;
							}
							input.onOpenDetails();
						}}
						type="button"
					>
						<DirectoryIdentityAccountSummary account={account} context="card" />
					</button>
				);
			})}
		</div>
	);
}

function ConnectChannelAccountDialog(input: {
	accounts: readonly DirectoryIdentityAccount[] | null;
	onOpenChange: (open: boolean) => void;
	onRequestSetup: (
		provider: DirectoryIdentityAccount["provider"]
	) => Promise<void>;
}) {
	const [copied, setCopied] = useState(false);
	const [pendingProvider, setPendingProvider] = useState<
		DirectoryIdentityAccount["provider"] | null
	>(null);
	const account = input.accounts?.length === 1 ? input.accounts[0] : null;
	const providerLabel = account?.providerLabel ?? "Channel";
	const requestText = `Connect this ${providerLabel} account to my OpenMeld profile`;
	const isProviderProof = account?.action?.kind === "connect_via_center_agent";
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setCopied(false);
					setPendingProvider(null);
				}
				input.onOpenChange(open);
			}}
			open={input.accounts !== null}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{input.accounts && input.accounts.length > 1
							? "Connect a channel"
							: (account?.action?.label ??
								`Connect your ${providerLabel} account`)}
					</DialogTitle>
					<DialogDescription>
						{isProviderProof
							? `Open ${providerLabel}, send the Center Agent the message below, then use the private connection button it sends you. You will review both accounts before anything changes.`
							: "Choose the Channel you want to use with your OpenMeld profile."}
					</DialogDescription>
				</DialogHeader>
				{isProviderProof ? (
					<div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-medium text-sm">
						{requestText}
					</div>
				) : (
					<div className="space-y-2">
						{input.accounts?.map((candidate) => (
							<ChannelSetupChoice
								account={candidate}
								key={candidate.provider}
								onRequestSetup={async () => {
									setPendingProvider(candidate.provider);
									try {
										await input.onRequestSetup(candidate.provider);
										input.onOpenChange(false);
									} finally {
										setPendingProvider(null);
									}
								}}
								pending={pendingProvider === candidate.provider}
							/>
						))}
					</div>
				)}
				{isProviderProof ? (
					<DialogFooter className="sm:justify-between">
						{account?.channelsPath ? (
							<Link
								className={buttonVariants({ size: "sm", variant: "ghost" })}
								to={account.channelsPath}
							>
								View Channels
							</Link>
						) : null}
						<Button
							onClick={() => {
								navigator.clipboard
									.writeText(requestText)
									.then(() => setCopied(true))
									.catch((error: unknown) => {
										console.error(
											"Could not copy the Message Channel account connection request.",
											error
										);
									});
							}}
							size="sm"
							type="button"
						>
							{copied ? "Copied" : "Copy message"}
						</Button>
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ChannelSetupChoice(input: {
	account: DirectoryIdentityAccount;
	onRequestSetup: () => Promise<void>;
	pending: boolean;
}) {
	const action = input.account.action;
	if (!action) {
		return null;
	}
	const content = (
		<>
			<DirectoryIdentityAccountSummary
				account={input.account}
				context="detail"
			/>
			<span className="ml-auto font-medium text-sm">{action.label}</span>
		</>
	);
	const className =
		"flex min-h-12 w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted/40";
	if (action.path) {
		return (
			<DirectoryIdentityAccountActionLink
				actionKind={action.kind}
				className={className}
				path={action.path}
			>
				{content}
			</DirectoryIdentityAccountActionLink>
		);
	}
	if (action.kind === "ask_admin") {
		return (
			<button
				className={className}
				disabled={input.pending}
				onClick={() => {
					input.onRequestSetup().catch(() => undefined);
				}}
				type="button"
			>
				{content}
			</button>
		);
	}
	return <div className={className}>{content}</div>;
}

function ManageChannelAccountDialog(input: {
	account: DirectoryIdentityAccount | null;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
	profileName: string;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.account !== null}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						Manage {input.account?.providerLabel ?? "Channel"} account
					</DialogTitle>
					<DialogDescription>
						{input.account
							? `Disconnect this account from ${input.profileName}. The Organization's ${input.account.providerLabel} connection will stay active.`
							: `Disconnect this account from ${input.profileName}. The Organization's Channel connection will stay active.`}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						onClick={input.onDisconnect}
						type="button"
						variant="destructive"
					>
						Disconnect account
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function HumanProfileCardActions(input: {
	directMessageIsPending: boolean;
	member: DirectoryHumanProfileRow;
	onEdit: () => void;
	onOpenDirectMessage: () => Promise<void>;
	onOpenProfile: () => void;
	researchAction: DirectoryHumanProfileResearchAction | null;
}) {
	const canOpenDirectMessage =
		input.member.profileStatus === "active" && !input.member.isCurrentUser;
	let profileReportAction: ReactNode = null;
	if (input.member.profileReport.state === "available") {
		const profileReportActionLabel = input.member.profileReport.hasDraft
			? `Open ${input.member.name}'s Profile Report — updates to review and save`
			: `Open ${input.member.name}'s Profile Report`;
		profileReportAction = (
			<Tooltip>
				<TooltipTrigger
					render={
						<Link
							aria-label={profileReportActionLabel}
							className={cn(
								buttonVariants({ size: "icon", variant: "ghost" }),
								input.member.profileReport.hasDraft ? "text-amber-500" : null
							)}
							to={input.member.profileReport.path}
						/>
					}
				>
					<FileTextIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{input.member.profileReport.hasDraft
						? "Profile Report has updates to review and save"
						: "Profile Report"}
				</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<div className="flex items-center justify-end gap-1">
			{profileReportAction}
			{input.researchAction ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-description={input.researchAction.description}
								aria-label={input.researchAction.label}
								disabled={input.researchAction.disabled}
								onClick={input.researchAction.onSelect}
								size="icon"
								type="button"
								variant="ghost"
							>
								<UserFocusIcon aria-hidden="true" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">
						{input.researchAction.label}
					</TooltipContent>
				</Tooltip>
			) : null}
			{canOpenDirectMessage ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Direct Message"
								disabled={input.directMessageIsPending}
								onClick={() => {
									input.onOpenDirectMessage().catch((error) => {
										console.error(
											"Human Profile Direct Message action failed.",
											error
										);
									});
								}}
								size="icon"
								type="button"
								variant="ghost"
							>
								<ChatCircleTextIcon aria-hidden="true" />
							</Button>
						}
					/>
					<TooltipContent side="bottom">Direct Message</TooltipContent>
				</Tooltip>
			) : null}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Profile options for ${input.member.name}`}
							size="icon"
							type="button"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent
					align="end"
					className="min-w-48"
					sideOffset={8}
				>
					<FluidDropdownMenuItem
						className="text-sm"
						index={0}
						onClick={input.onOpenProfile}
					>
						<InfoIcon aria-hidden="true" />
						View profile
					</FluidDropdownMenuItem>
					{input.member.canEdit ? (
						<FluidDropdownMenuItem
							className="text-sm"
							index={1}
							onClick={input.onEdit}
						>
							<PencilSimpleIcon aria-hidden="true" />
							Edit profile
						</FluidDropdownMenuItem>
					) : null}
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</div>
	);
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
	if (input.task?.status === "failed") {
		return "Try again";
	}
	if (input.hasStartError) {
		return "Try again";
	}
	return `Learn about ${input.displayName}`;
}

function resolveLearnAllActionLabel(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	isResearchPending: boolean;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	processedCount: number;
}): string {
	if (input.activeBatch) {
		return `Learning ${input.processedCount}/${input.activeBatch.totalCount}`;
	}
	if (input.isResearchPending && input.pendingResearch?.scope === "all") {
		return "Starting…";
	}
	return "Learn about all members";
}
const HUMAN_PROFILE_ROW_SKELETON_IDS = ["first", "second", "third"] as const;

function HumanProfileRowsSkeleton() {
	return (
		<div className="grid gap-3 lg:grid-cols-2">
			<span className="sr-only">Loading profiles.</span>
			{HUMAN_PROFILE_ROW_SKELETON_IDS.map((id) => (
				<div
					className="min-h-40 border border-border/70 bg-card px-4 py-4"
					key={id}
				>
					<div className="flex items-start gap-3">
						<Skeleton className="size-14 shrink-0" />
						<div className="min-w-0 flex-1 space-y-2">
							<Skeleton className="h-4 w-48 max-w-full" />
							<Skeleton className="h-3 w-64 max-w-full" />
						</div>
					</div>
					<div className="mt-8 border-border/70 border-t pt-3">
						<Skeleton className="h-3 w-56 max-w-full" />
					</div>
				</div>
			))}
		</div>
	);
}

function ProfilesInlineState(input: {
	isDestructive?: boolean;
	message: string;
}) {
	return (
		<div
			className={cn(
				"rounded-md border bg-background/20 px-4 py-3 text-sm",
				input.isDestructive
					? "border-destructive/50 text-destructive"
					: "border-border/70 text-muted-foreground"
			)}
		>
			{input.message}
		</div>
	);
}
