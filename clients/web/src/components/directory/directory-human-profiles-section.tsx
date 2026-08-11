"use client";

import { buildProfileDetailsSnapshotFromHumanProfile } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	CenterAgentMemberResearchBatch,
	CenterAgentMemberResearchTask,
	ListOrganizationDocumentsResponse,
	OrganizationDirectoryResponse,
	OrganizationMemberOpenMeldServiceState,
	ProfileDetailsSnapshot,
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
	resolveStatusToneInteractiveTextClassName,
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
import type { AppShellAccount } from "#/components/app/app-shell-account";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
} from "#/components/directory/directory-card-grid";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { HumanProfileEditDialog } from "#/components/profiles/human-profile-edit-dialog";
import { ProfileDetailsDialog } from "#/components/profiles/profile-details-dialog";
import { ProfileCard } from "#/components/profiles/profile-list-item";
import { ProfilesSectionLayout } from "#/components/profiles/profiles-section-layout";
import {
	buildOrganizationDocumentPath,
	buildOrganizationNewDocumentPath,
} from "#/lib/organizations/organization-routes";
import {
	formatProfileDate,
	formatProfileDateTime,
} from "#/lib/profiles/profile-date-format";

export type DirectoryMemberResearchRequest =
	| { scope: "all" }
	| { scope: "member"; subjectUserId: string };

type DirectoryHumanProfileRole = "admin" | "member" | "owner" | "unknown";
export type DirectoryDocumentsStatus = "failed" | "loading" | "ready";
export type DirectoryMemberOpenMeldServiceDisplayState =
	| OrganizationMemberOpenMeldServiceState
	| "checking";

type DirectoryProfileReportDocument = Pick<
	ListOrganizationDocumentsResponse["documents"][number],
	"hasDraft" | "id" | "kind" | "subjectUserId"
>;

type DirectoryProfileReportAction =
	| { kind: "link"; path: string }
	| { kind: "unavailable"; reason: string };

export type DirectoryHumanProfileRow = {
	avatarImageUrl: string | null;
	canEdit: boolean;
	details: ProfileDetailsSnapshot | null;
	email: string;
	footerDetail: string;
	hasDraft: boolean;
	id: string;
	isDefault: boolean;
	isCurrentUser: boolean;
	name: string;
	reportAction: DirectoryProfileReportAction;
	profileHandle: string | null;
	profileStatus: "active" | "disabled" | null;
	role: DirectoryHumanProfileRole;
	userId: string;
	openMeldServiceState: DirectoryMemberOpenMeldServiceDisplayState | null;
};

export function DirectoryHumanProfilesSection(input: {
	activeBatch: CenterAgentMemberResearchBatch | null;
	canCreateProfile: boolean;
	emptyMessage: string;
	errorMessage: string | null;
	focusProfileId: string | null;
	isOrganizationContext: boolean;
	isPending: boolean;
	isDirectMessagePending: boolean;
	isResearchPending: boolean;
	latestBatch: CenterAgentMemberResearchBatch | null;
	memberResearchError: { message: string; subjectUserId: string } | null;
	members: readonly DirectoryHumanProfileRow[];
	onCreateProfile: () => void;
	onFocusConsumed?: () => void;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	onResearchAll: () => void;
	organizationName: string;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	researchErrorMessage: string | null;
}) {
	const rowElementsRef = useRef(new Map<string, HTMLElement>());
	const [highlightedProfileId, setHighlightedProfileId] = useState<
		string | null
	>(null);
	const latestTasks = input.latestBatch?.tasks ?? [];
	const processedCount = input.activeBatch
		? input.activeBatch.completedCount + input.activeBatch.failedCount
		: 0;
	const learnAllLabel = resolveLearnAllActionLabel({
		activeBatch: input.activeBatch,
		isResearchPending: input.isResearchPending,
		pendingResearch: input.pendingResearch,
		processedCount,
	});

	useEffect(() => {
		if (!input.focusProfileId || input.isPending) {
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
		input.isPending,
		input.members,
		input.onFocusConsumed,
	]);

	let content: ReactNode;
	if (input.isPending) {
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
							isDirectMessagePending={input.isDirectMessagePending}
							isHighlighted={highlightedProfileId === member.id}
							isOrganizationContext={input.isOrganizationContext}
							isResearchPending={input.isResearchPending}
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
							input.isResearchPending ||
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
				input.isOrganizationContext
					? "A Human Profile is the name and identity each member uses in Spaces. The Center Agent can learn about members and draft Profile Reports for review."
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
	isHighlighted: boolean;
	isOrganizationContext: boolean;
	isDirectMessagePending: boolean;
	isResearchPending: boolean;
	latestTasks: readonly CenterAgentMemberResearchTask[];
	member: DirectoryHumanProfileRow;
	memberResearchError: { message: string; subjectUserId: string } | null;
	onOpenDirectMessage: (profileId: string) => Promise<void>;
	onResearch: (subjectUserId: string) => void;
	pendingResearch: DirectoryMemberResearchRequest | undefined;
	rowRef: (node: HTMLElement | null) => void;
}) {
	const task = input.latestTasks.find(
		(candidate) => candidate.subjectUserId === input.member.userId
	);
	const isStarting =
		input.isResearchPending &&
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
				input.isHighlighted
					? "border-ring bg-muted/30 ring-1 ring-ring/60"
					: null
			)}
			footerLeft={input.member.footerDetail}
			footerRight={<HumanProfileMemberBadges member={input.member} />}
			icon={<HumanProfileIcon member={input.member} />}
			menu={
				<HumanProfileCardActions
					activeBatch={input.activeBatch}
					directMessageIsPending={input.isDirectMessagePending}
					isResearchPending={input.isResearchPending}
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
				input.isOrganizationContext
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
	const reportActionLabel = input.member.hasDraft
		? "Report waiting for review"
		: "Report";
	const reportActionClassName = cn(
		buttonVariants({ size: "sm", variant: "ghost" }),
		input.member.hasDraft
			? resolveStatusToneInteractiveTextClassName("warning")
			: null
	);

	return (
		<div className="space-y-2">
			{input.member.reportAction.kind === "link" ? (
				<Link
					className={reportActionClassName}
					to={input.member.reportAction.path}
				>
					<FileTextIcon aria-hidden="true" data-icon="inline-start" />
					{reportActionLabel}
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
	const learnActionDescription = `Learn about ${input.member.name} and draft Profile Report updates for review.`;
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

export function buildOrganizationHumanProfileRows(input: {
	canCreateProfiles: boolean;
	currentUserId: string;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	memberOpenMeldServiceFallbackState: DirectoryMemberOpenMeldServiceDisplayState;
	memberOpenMeldServiceStatesByUserId: ReadonlyMap<
		string,
		OrganizationMemberOpenMeldServiceState
	>;
	members: OrganizationDirectoryResponse["members"];
	orgSlug: string;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	return input.members.map((member) => {
		const document = reportsBySubject.get(member.user.id);
		const humanProfile = member.humanProfile;
		const isCurrentUser = member.user.id === input.currentUserId;
		return {
			avatarImageUrl: member.user.image,
			canEdit: isCurrentUser && humanProfile?.status === "active",
			details:
				humanProfile?.status === "active"
					? buildProfileDetailsSnapshotFromHumanProfile({
							profileHandle: humanProfile.profileHandle,
							profileId: humanProfile.profileId,
							profileName: humanProfile.profileName,
							profileStatus: humanProfile.status,
							viewerScope: isCurrentUser ? "owner_self" : "observer",
						})
					: null,
			email: member.user.email,
			footerDetail: resolveOrganizationHumanProfileLastActiveLabel(
				humanProfile?.lastUsedAt ?? null
			),
			hasDraft: document?.hasDraft ?? false,
			id: humanProfile?.profileId ?? `member:${member.memberId}`,
			isDefault: false,
			isCurrentUser,
			name: humanProfile?.profileName || member.user.name || member.user.email,
			reportAction: resolveProfileReportAction({
				canCreate: input.canCreateProfiles,
				document,
				documentsStatus: input.documentsStatus,
				orgSlug: input.orgSlug,
				subjectUserId: member.user.id,
			}),
			profileHandle: humanProfile?.profileHandle ?? null,
			profileStatus: humanProfile?.status ?? null,
			role: resolveDirectoryHumanProfileRole(member.role),
			userId: member.user.id,
			openMeldServiceState:
				input.memberOpenMeldServiceStatesByUserId.get(member.user.id) ??
				input.memberOpenMeldServiceFallbackState,
		};
	});
}

function resolveOrganizationHumanProfileLastActiveLabel(
	lastUsedAt: string | null
): string {
	const formatted = formatProfileDateTime(lastUsedAt);
	return formatted ? `Last active ${formatted}` : "No recent activity";
}

export function buildPersonalHumanProfileRows(input: {
	account: AppShellAccount;
	canCreateHumanProfile: boolean;
	canCreateProfiles: boolean;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
	profiles: readonly AuthProfileView[];
	subjectUserId: string;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	const document = reportsBySubject.get(input.subjectUserId);
	const reportAction = resolveProfileReportAction({
		canCreate: input.canCreateProfiles,
		document,
		documentsStatus: input.documentsStatus,
		orgSlug: input.orgSlug,
		subjectUserId: input.subjectUserId,
	});
	const hasDraft = document?.hasDraft ?? false;
	const profile =
		input.profiles.find((candidate) => candidate.isDefault) ??
		input.profiles[0];
	if (!profile) {
		return [
			{
				avatarImageUrl: null,
				canEdit: false,
				details: null,
				email: input.account.email?.trim() || "Current member",
				footerDetail: resolveMissingPersonalHumanProfileMessage(
					input.canCreateHumanProfile
				),
				hasDraft,
				id: `member:${input.subjectUserId || input.orgSlug}`,
				isDefault: false,
				isCurrentUser: true,
				name:
					input.account.name?.trim() ||
					input.account.email?.trim() ||
					"Current member",
				reportAction,
				profileHandle: null,
				profileStatus: null,
				role: "owner",
				userId: input.subjectUserId,
				openMeldServiceState: null,
			},
		];
	}
	return [
		{
			avatarImageUrl: profile.avatarUrl ?? null,
			canEdit: profile.isDefault && profile.status === "active",
			details:
				profile.status === "active"
					? buildProfileDetailsSnapshotFromHumanProfile({
							profileHandle: profile.profileHandle,
							profileId: profile.openMeldProfileId,
							profileName: profile.profileName,
							profileStatus: profile.status,
							viewerScope: "owner_self",
						})
					: null,
			email: input.account.email?.trim() || "Current member",
			footerDetail: resolvePersonalHumanProfileFooterDetail(profile),
			hasDraft,
			id: profile.openMeldProfileId,
			isDefault: profile.isDefault,
			isCurrentUser: true,
			name: profile.profileName,
			reportAction,
			profileHandle: profile.profileHandle,
			profileStatus: profile.status,
			role: "owner",
			userId: input.subjectUserId,
			openMeldServiceState: null,
		},
	];
}

export function resolveMissingPersonalHumanProfileMessage(
	canCreateHumanProfile: boolean
): string {
	return canCreateHumanProfile
		? "You don't have a Human Profile in this workspace yet. Create one to choose the name and identity you use in Spaces."
		: "You don't have a Human Profile in this workspace yet.";
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

function resolveProfileReportAction(input: {
	canCreate: boolean;
	document: DirectoryProfileReportDocument | undefined;
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
	subjectUserId: string;
}): DirectoryProfileReportAction {
	if (input.documentsStatus === "loading") {
		return {
			kind: "unavailable",
			reason: "Report access is loading.",
		};
	}
	if (input.documentsStatus === "failed") {
		return {
			kind: "unavailable",
			reason: "Report unavailable because Documents could not be loaded.",
		};
	}
	if (input.document) {
		return {
			kind: "link",
			path: buildOrganizationDocumentPath({
				documentId: input.document.id,
				orgSlug: input.orgSlug,
			}),
		};
	}
	if (input.canCreate) {
		return {
			kind: "link",
			path: buildOrganizationNewDocumentPath({
				kind: "member_profile",
				orgSlug: input.orgSlug,
				subjectUserId: input.subjectUserId,
			}),
		};
	}
	return {
		kind: "unavailable",
		reason: "Only organization owners and admins can create this report.",
	};
}

function indexProfileReportDocuments(
	documents: readonly DirectoryProfileReportDocument[]
): ReadonlyMap<string, DirectoryProfileReportDocument> {
	const documentsBySubject = new Map<string, DirectoryProfileReportDocument>();
	for (const document of documents) {
		if (document.kind === "member_profile" && document.subjectUserId) {
			documentsBySubject.set(document.subjectUserId, document);
		}
	}
	return documentsBySubject;
}

function resolveDirectoryHumanProfileRole(
	role: string
): DirectoryHumanProfileRole {
	switch (role) {
		case "admin":
		case "member":
		case "owner":
			return role;
		default:
			return "unknown";
	}
}

function resolvePersonalHumanProfileFooterDetail(
	profile: AuthProfileView
): string {
	const primary = profile.isDefault
		? "Default Human Profile for this account"
		: "Human teammate identity for Spaces";
	const lastUsed = formatProfileDate(profile.lastUsedAt);
	if (lastUsed) {
		return `${primary} / Last used ${lastUsed}`;
	}
	const created = formatProfileDate(profile.createdAt);
	return created ? `${primary} / Created ${created}` : primary;
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
	role: DirectoryHumanProfileRole
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
