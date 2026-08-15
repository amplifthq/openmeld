"use client";

import type {
	CenterAgentMemberResearchBatch,
	CenterAgentMemberResearchTask,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	resolveStatusToneCompactBadgeClassName,
	resolveStatusToneIndicatorClassName,
	resolveStatusToneTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ChatCircleTextIcon,
	DotsThreeIcon,
	FileTextIcon,
	InfoIcon,
	PencilSimpleIcon,
	PlusIcon,
	UserFocusIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
} from "#/components/directory/directory-card-grid";
import type {
	DirectoryHumanProfileRow,
	DirectoryMemberOpenMeldServiceDisplayState,
} from "#/components/directory/directory-human-profile-model";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { HumanProfileEditDialog } from "#/components/profiles/human-profile-edit-dialog";
import { ProfileDetailsDialog } from "#/components/profiles/profile-details-dialog";
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
	onResearch: (subjectUserId: string) => void;
	onResearchAll: () => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	researchErrorMessage: string | null;
	state: DirectoryHumanProfilesViewState;
}) {
	const rowElementsRef = useRef(new Map<string, HTMLElement>());
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
							latestTasks={latestTasks}
							member={member}
							memberResearchError={input.memberResearchError}
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
	latestTasks: readonly CenterAgentMemberResearchTask[];
	member: DirectoryHumanProfileRow;
	memberResearchError: { message: string; subjectUserId: string } | null;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	rowRef: (node: HTMLElement | null) => void;
	state: DirectoryHumanProfileCardState;
}) {
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
	return (
		<ProfileCard
			actions={
				<HumanProfileReportContent
					member={input.member}
					memberResearchError={memberResearchError}
				/>
			}
			className={cn(
				"min-h-40",
				input.state.highlight === "highlighted"
					? "border-ring bg-muted/30 ring-1 ring-ring/60"
					: null
			)}
			footerLeft={input.member.footerDetail}
			footerRight={<HumanProfileMemberBadges member={input.member} />}
			icon={<HumanProfileIcon member={input.member} />}
			menu={
				<HumanProfileCardActions
					activeBatch={input.activeBatch}
					directMessageIsPending={input.state.directMessage === "pending"}
					isResearchPending={input.state.research === "pending"}
					isStarting={isStarting}
					member={input.member}
					memberResearchError={memberResearchError}
					onOpenDirectMessage={async () => {
						await input.onOpenDirectMessage(input.member.id);
					}}
					onResearch={input.onResearch}
					task={task}
				/>
			}
			rowRef={input.rowRef}
			secondarySubtitle={
				<span className="flex flex-col items-start">
					<span>{input.member.email}</span>
					{input.member.openMeldServiceState ? (
						<MemberOpenMeldServiceStatus
							state={input.member.openMeldServiceState}
						/>
					) : null}
				</span>
			}
			subtitle={
				input.member.profileHandle
					? `Handle ${input.member.profileHandle}`
					: "Human Profile not connected"
			}
			testId={
				input.state.context === "organization"
					? "organization-human-profile-row"
					: "human-profile-row"
			}
			title={input.member.name}
		/>
	);
}

function HumanProfileReportContent(input: {
	member: DirectoryHumanProfileRow;
	memberResearchError: string | null;
}) {
	const reportActionClassName = buttonVariants({
		size: "sm",
		variant: "ghost",
	});

	return (
		<div className="space-y-2">
			{input.member.reportAction.kind === "link" ? (
				<Link
					className={reportActionClassName}
					to={input.member.reportAction.path}
				>
					<FileTextIcon aria-hidden="true" data-icon="inline-start" />
					Profile Report
				</Link>
			) : (
				<Button
					aria-label="Report unavailable"
					disabled={true}
					size="sm"
					type="button"
					variant="ghost"
				>
					<FileTextIcon aria-hidden="true" data-icon="inline-start" />
					Report
				</Button>
			)}
			{input.member.reportAction.kind === "unavailable" ? (
				<p className="text-muted-foreground text-xs leading-5">
					{input.member.reportAction.reason}
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

function HumanProfileCardActions(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	directMessageIsPending: boolean;
	isResearchPending: boolean;
	isStarting: boolean;
	member: DirectoryHumanProfileRow;
	memberResearchError: string | null;
	onOpenDirectMessage: () => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	task: CenterAgentMemberResearchTask | undefined;
}) {
	const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
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

	return (
		<>
			<div className="flex items-center justify-end gap-1">
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
				{input.member.canEdit ? (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Edit Human Profile"
									onClick={() => setIsEditDialogOpen(true)}
									size="icon"
									type="button"
									variant="ghost"
								>
									<PencilSimpleIcon aria-hidden="true" />
								</Button>
							}
						/>
						<TooltipContent side="bottom">Edit Human Profile</TooltipContent>
					</Tooltip>
				) : null}
				{input.member.details ? (
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
						<DropdownMenuContent
							align="end"
							className="min-w-48"
							sideOffset={8}
						>
							<DropdownMenuItem
								className="text-sm"
								onClick={() => setIsDetailsDialogOpen(true)}
							>
								<InfoIcon aria-hidden="true" />
								About profile
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
			{input.member.details ? (
				<ProfileDetailsDialog
					details={input.member.details}
					isDirectMessagePending={input.directMessageIsPending}
					onOpenChange={setIsDetailsDialogOpen}
					onOpenDirectMessage={
						canOpenDirectMessage
							? () => {
									input.onOpenDirectMessage().catch((error) => {
										console.error(
											"Human Profile Direct Message action failed.",
											error
										);
									});
								}
							: undefined
					}
					open={isDetailsDialogOpen}
				/>
			) : null}
			{input.member.canEdit ? (
				<HumanProfileEditDialog
					onOpenChange={setIsEditDialogOpen}
					open={isEditDialogOpen}
					profileName={input.member.name}
				/>
			) : null}
		</>
	);
}

function MemberOpenMeldServiceStatus(input: {
	state: DirectoryMemberOpenMeldServiceDisplayState;
}) {
	const presentation = resolveMemberOpenMeldServicePresentation(input.state);
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap",
				resolveStatusToneTextClassName(presentation.tone)
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					resolveStatusToneIndicatorClassName(presentation.tone, "quiet")
				)}
			/>
			{presentation.label}
		</span>
	);
}

function resolveMemberOpenMeldServicePresentation(
	state: DirectoryMemberOpenMeldServiceDisplayState
): { label: string; tone: "checking" | "muted" | "ready" | "warning" } {
	switch (state) {
		case "connected":
			return { label: "OpenMeld Service connected", tone: "ready" };
		case "needs_attention":
			return {
				label: "OpenMeld Service needs attention",
				tone: "warning",
			};
		case "not_connected":
			return { label: "OpenMeld Service not connected", tone: "muted" };
		case "checking":
			return { label: "Checking OpenMeld Service…", tone: "checking" };
		default:
			return {
				label: "OpenMeld Service status unavailable",
				tone: "muted",
			};
	}
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
function HumanProfileMemberBadges(input: { member: DirectoryHumanProfileRow }) {
	return (
		<span className="flex flex-wrap items-center justify-end gap-2">
			{input.member.isDefault ? (
				<span
					className={cn(
						"rounded-sm border px-2 py-0.5 font-medium text-[0.7rem]",
						resolveStatusToneCompactBadgeClassName("ready")
					)}
				>
					Default
				</span>
			) : null}
			{input.member.profileStatus ? (
				<span className="rounded-sm border border-border bg-background px-2 py-0.5 text-[0.7rem] text-muted-foreground">
					{resolveHumanProfileStatusLabel(input.member.profileStatus)}
				</span>
			) : null}
			<span className="rounded-sm border border-border bg-background px-2 py-0.5 text-[0.7rem] text-muted-foreground">
				{resolveDirectoryHumanProfileRoleLabel(input.member.role)}
			</span>
		</span>
	);
}

function resolveDirectoryHumanProfileRoleLabel(
	role: DirectoryHumanProfileRow["role"]
): string {
	switch (role) {
		case "admin":
			return "Admin";
		case "member":
			return "Member";
		case "owner":
			return "Owner";
		default:
			return "Unknown role";
	}
}

function resolveHumanProfileStatusLabel(status: "active" | "disabled"): string {
	return status === "active" ? "Active" : "Disabled";
}

function HumanProfileIcon(input: { member: DirectoryHumanProfileRow }) {
	if (input.member.profileStatus !== null) {
		return (
			<DitherProfileAvatar
				avatarImageUrl={input.member.avatarImageUrl}
				className="mt-0.5"
				data-testid={`human-profile-avatar-${input.member.id}`}
				profileId={input.member.id}
				profileKind="human"
				profileName={input.member.name}
				size={40}
			/>
		);
	}

	return (
		<span className="grid size-11 shrink-0 place-items-center border border-border bg-background text-muted-foreground">
			<UserIcon aria-hidden="true" className="size-5" />
		</span>
	);
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
						<Skeleton className="size-11 shrink-0" />
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
