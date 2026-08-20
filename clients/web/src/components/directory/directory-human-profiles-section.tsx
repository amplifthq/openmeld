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
import { DirectoryHumanProfileDetailsDrawer } from "#/components/directory/directory-human-profile-details-drawer";
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
		rowElementsRef.current
			.get(focusedProfile.id)
			?.scrollIntoView?.({ block: "center", behavior: "smooth" });
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
	onResearch: (subjectUserId: string) => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	rowRef: (node: HTMLElement | null) => void;
	state: DirectoryHumanProfileCardState;
}) {
	const [isDetailsOpen, setIsDetailsOpen] = useState(false);
	const [isEditingDetails, setIsEditingDetails] = useState(false);
	const [connectableAccount, setConnectableAccount] =
		useState<DirectoryIdentityAccount | null>(null);
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
	const openProfile = (editing: boolean) => {
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
						onOpenDetails={() => openProfile(false)}
					/>
				}
				icon={
					<DirectoryHumanProfileAvatar context="card" member={input.member} />
				}
				menu={
					<HumanProfileCardActions
						activeBatch={input.activeBatch}
						directMessageIsPending={input.state.directMessage === "pending"}
						isResearchPending={input.state.research === "pending"}
						isStarting={isStarting}
						member={input.member}
						memberResearchError={memberResearchError}
						onEdit={() => openProfile(true)}
						onOpenDirectMessage={async () => {
							await input.onOpenDirectMessage(input.member.id);
						}}
						onOpenProfile={() => openProfile(false)}
						onResearch={input.onResearch}
						task={task}
					/>
				}
				onProfileSummaryClick={() => openProfile(false)}
				profileSummaryAriaLabel={`Open ${input.member.name}'s profile`}
				rowRef={input.rowRef}
				secondarySubtitle={resolveDirectoryHumanProfileActivityLabel({
					lastUsedAt: input.member.lastUsedAt,
					nowMs: input.activityNowMs,
					profileStatus: input.member.profileStatus,
				})}
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
					setIsDetailsOpen(false);
					setIsEditingDetails(false);
					setConnectableAccount(account);
				}}
				onEditingChange={setIsEditingDetails}
				onManageAccount={(account) => {
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
					input.onOpenDirectMessage(input.member.id).catch((error) => {
						console.error("Human Profile Direct Message action failed.", error);
					});
				}}
				open={isDetailsOpen}
			/>
			<ConnectChannelAccountDialog
				account={connectableAccount}
				onOpenChange={(open) => {
					if (!open) {
						setConnectableAccount(null);
					}
				}}
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
	onOpenDetails: () => void;
}) {
	if (input.accounts.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			{input.accounts.map((account) => (
				<button
					aria-label={`${account.providerLabel} account: ${resolveDirectoryIdentityAccountLabel(account)}`}
					className="inline-flex items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
					key={account.provider}
					onClick={input.onOpenDetails}
					type="button"
				>
					<DirectoryIdentityAccountSummary account={account} context="card" />
				</button>
			))}
		</div>
	);
}

function ConnectChannelAccountDialog(input: {
	account: DirectoryIdentityAccount | null;
	onOpenChange: (open: boolean) => void;
}) {
	const [copied, setCopied] = useState(false);
	const providerLabel = input.account?.providerLabel ?? "Channel";
	const requestText = `Connect this ${providerLabel} account to my OpenMeld profile`;
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setCopied(false);
				}
				input.onOpenChange(open);
			}}
			open={input.account !== null}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect your {providerLabel} account</DialogTitle>
					<DialogDescription>
						Open {providerLabel}, send the Center Agent the message below, then
						use the private connection button it sends you. You will review both
						accounts before anything changes.
					</DialogDescription>
				</DialogHeader>
				<div className="rounded-md border border-border bg-muted/30 px-3 py-2 font-medium text-sm">
					{requestText}
				</div>
				<DialogFooter className="sm:justify-between">
					{input.account?.channelsPath ? (
						<Link
							className={buttonVariants({ size: "sm", variant: "ghost" })}
							to={input.account.channelsPath}
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
			</DialogContent>
		</Dialog>
	);
}

function ManageChannelAccountDialog(input: {
	account: DirectoryIdentityAccount | null;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.account !== null}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Manage connected account</DialogTitle>
					<DialogDescription>
						{input.account
							? `This ${input.account.providerLabel} account is linked to the OpenMeld profile.`
							: "This account is linked to the OpenMeld profile."}
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm leading-6">
					If this is the wrong account, disconnect it here. Then prove the
					correct account from that channel to connect again. This does not
					disconnect the Organization's{" "}
					{input.account?.providerLabel ?? "Channel"}
					connection.
				</p>
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
	activeBatch: CenterAgentMemberResearchBatch | null;
	directMessageIsPending: boolean;
	isResearchPending: boolean;
	isStarting: boolean;
	member: DirectoryHumanProfileRow;
	memberResearchError: string | null;
	onEdit: () => void;
	onOpenDirectMessage: () => Promise<void>;
	onOpenProfile: () => void;
	onResearch: (subjectUserId: string) => void;
	task: CenterAgentMemberResearchTask | undefined;
}) {
	const learnActionLabel = resolveLearnActionLabel({
		displayName: input.member.name,
		hasDraft: input.member.hasDraft,
		hasStartError: Boolean(input.memberResearchError),
		isStarting: input.isStarting,
		task: input.task,
	});
	const learnActionDescription = `Learn about ${input.member.name} and update their Profile Report.`;
	const canOpenDirectMessage =
		input.member.profileStatus === "active" && !input.member.isCurrentUser;
	let profileKnowledgeAction: ReactNode = null;
	if (input.member.reportAction.kind === "link") {
		const profileReportActionLabel = input.member.hasDraft
			? `Open ${input.member.name}'s Profile Report — updates to review and save`
			: `Open ${input.member.name}'s Profile Report`;
		profileKnowledgeAction = (
			<Tooltip>
				<TooltipTrigger
					render={
						<Link
							aria-label={profileReportActionLabel}
							className={cn(
								buttonVariants({ size: "icon", variant: "ghost" }),
								input.member.hasDraft ? "text-amber-500" : null
							)}
							to={input.member.reportAction.path}
						/>
					}
				>
					<FileTextIcon aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent side="bottom">
					{input.member.hasDraft
						? "Profile Report has updates to review and save"
						: "Profile Report"}
				</TooltipContent>
			</Tooltip>
		);
	} else if (input.member.reportAction.kind === "learn") {
		profileKnowledgeAction = (
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-description={learnActionDescription}
							aria-label={learnActionLabel}
							disabled={
								!input.member.userId ||
								Boolean(input.activeBatch) ||
								input.isResearchPending
							}
							onClick={() => input.onResearch(input.member.userId)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<UserFocusIcon aria-hidden="true" />
						</Button>
					}
				/>
				<TooltipContent side="bottom">{learnActionLabel}</TooltipContent>
			</Tooltip>
		);
	}

	return (
		<div className="flex items-center justify-end gap-1">
			{profileKnowledgeAction}
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
