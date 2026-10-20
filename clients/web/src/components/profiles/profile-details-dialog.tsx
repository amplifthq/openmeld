"use client";

import { Popover } from "@base-ui/react/popover";
import {
	formatProfileKind,
	type ProfileDetailsSpaceMemberInput,
} from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	ModelCatalog,
	ProfileDetailsField,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSection,
	ProfileDetailsSectionId,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowRightIcon,
	CaretDownIcon,
	ChatCircleTextIcon,
	CopyIcon,
	GearIcon,
	PencilSimpleIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactElement, type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
	AgentAccessIndicator,
	resolveAgentChatActionLabel,
} from "#/components/agent-access/agent-access-indicator";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { AgentTaskActivitySummary } from "#/components/agents/agent-task-activity";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import type {
	DirectoryAgentProfileSummary,
	DirectoryHumanProfileComputer,
	DirectoryProjectionStatus,
} from "#/components/directory/directory-human-profile-model";
import {
	buildDirectoryAgentProfilesByOwner,
	resolveCurrentOrganizationComputersProjection,
	resolveHumanProfileComputer,
} from "#/components/directory/directory-human-profile-model";
import {
	DirectoryAgentProfilesSummary,
	DirectoryHumanProfileComputerSummary,
} from "#/components/directory/directory-human-profile-presentation";
import { useMemberAgentProfileDisplayName } from "#/components/member-agents/use-member-agent-profile-display-name";
import { AgentProfileUsage } from "#/components/profiles/agent-profile-usage";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { ProfileDetailsCurrentSession } from "#/components/profiles/profile-details-current-session";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";
import { useAppSettings } from "#/components/settings/use-app-settings";
import {
	SpaceAgentIssueRecoveryAction,
	useSpaceAgentRecoveryPlan,
} from "#/components/spaces/space-agent-recovery-context";
import { resolveSpaceMemberInlineStatusTextClassName } from "#/components/spaces/space-member-status-tone";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import {
	type AgentViewerAccess,
	formatPublicWakeabilityReason,
	useAgentViewerAccess,
	usePublicWakeabilityReason,
} from "#/lib/agents/agent-viewer-access";
import { copyTextToClipboard } from "#/lib/clipboard";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useMemberActivityTime } from "#/lib/spaces/use-member-activity-time";
import {
	organizationComputersQueryOptions,
	organizationProfileDirectoryQueryOptions,
} from "#/query/organizations/organization-directory";
import { ProfileCardHeader } from "./profile-card-header";

const AGENT_WORKSPACE_TECHNICAL_SECTION_IDS: ReadonlySet<ProfileDetailsSectionId> =
	new Set(["connection", "agent_controller_permission_mode", "advanced"]);

const AGENT_PROFILE_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	month: "short",
	timeZoneName: "short",
	year: "numeric",
});

const PROFILE_DETAILS_POPOVER_CLASS_NAME =
	"w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl outline-none";
const PROFILE_DETAILS_POPOVER_COLLISION_PADDING = 20;

export function AgentProfileMoreDetailsDialog(input: {
	agentProfile: AuthProfileView;
	details: ProfileDetailsSnapshot;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="flex max-h-[min(46rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader className="shrink-0 pr-8">
					<DialogTitle>More details</DialogTitle>
					<DialogDescription>
						Profile ID and creation details.
					</DialogDescription>
				</DialogHeader>

				<AgentProfileMoreDetailsContent
					details={input.details}
					profile={input.agentProfile}
				/>
			</DialogContent>
		</Dialog>
	);
}

export function AgentProfileDetailsContent(input: {
	chatHref?: string;
	className?: string;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending?: boolean;
	isCenterAgent?: boolean;
	moreDetailsHref?: string;
	onOpenDirectMessage?: () => void;
	onNavigate?: () => void;
}) {
	const canEdit = input.details.viewerScope === "owner_self";
	const showAvailability =
		!input.isCenterAgent || input.entry.availabilityCategory !== "available";
	// A problem has one place in the popover: the footer, next to its fix.
	const issueLabel = showAvailability
		? resolveAgentIssueLabel(input.entry)
		: null;
	const availabilitySummary =
		showAvailability &&
		issueLabel === null &&
		input.entry.availabilitySummary !== resolveAgentPresenceSummary(input.entry)
			? input.entry.availabilitySummary
			: null;
	const colleague = useColleagueAgentPopoverState({
		entry: input.entry,
		isColleagueAgent: !(canEdit || input.isCenterAgent),
	});

	return (
		<ScrollArea
			className={cn("min-h-0 flex-1", input.className)}
			contentClassName="pr-1"
			data-testid="profile-details-popover-scroll-area"
		>
			<AgentProfileDetailsHeader
				canEdit={canEdit}
				details={input.details}
				entry={input.entry}
				isCenterAgent={input.isCenterAgent === true}
				moreDetailsHref={input.moreDetailsHref}
				onNavigate={input.onNavigate}
				showAvailability={showAvailability && issueLabel === null}
			/>
			<AgentProfileDirectMessageAction
				access={colleague.access}
				href={input.chatHref}
				isPending={input.isDirectMessagePending === true}
				onNavigate={input.onNavigate}
				onOpen={input.onOpenDirectMessage}
				profileName={input.entry.profileName}
				unavailableReason={colleague.chatUnavailableReason}
			/>
			{availabilitySummary ? (
				<p className="mt-3 border-border border-t pt-3 text-muted-foreground text-xs">
					{availabilitySummary}
				</p>
			) : null}
			{!input.isCenterAgent && (
				<div className="mt-3 border-border border-t pt-3 empty:hidden">
					<AgentProfileUsage
						profileId={input.entry.profileId}
						variant="popover"
					/>
				</div>
			)}
			<AgentTaskActivitySummary profileId={input.entry.profileId} />
			{issueLabel ? (
				<AgentProfileIssueFooter
					entry={input.entry}
					label={issueLabel}
					publicReason={colleague.reason}
				/>
			) : null}
		</ScrollArea>
	);
}

/**
 * Why this Agent can't work right now, with the same fix the Space offers
 * everywhere else. Without a fix for this viewer, the shared summary says
 * what to do instead.
 */
function AgentProfileIssueFooter(input: {
	entry: SpaceMemberDirectoryEntry;
	label: string;
	publicReason: string | null;
}) {
	const hasRecovery = useSpaceAgentRecoveryPlan(input.entry.profileId) !== null;
	return (
		<div
			className="mt-3 flex min-w-0 items-center gap-2 border-border border-t pt-3"
			data-slot="agent-profile-issue-footer"
		>
			<div className="grid min-w-0 flex-1 gap-0.5">
				<p
					className={cn(
						"flex min-w-0 items-center gap-1.5 font-medium text-xs",
						resolveSpaceMemberInlineStatusTextClassName(input.entry)
					)}
				>
					<WarningCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="truncate">{input.label}</span>
				</p>
				{!hasRecovery &&
				(input.publicReason ?? input.entry.availabilitySummary) ? (
					<p className="text-muted-foreground text-xs">
						{input.publicReason ?? input.entry.availabilitySummary}
					</p>
				) : null}
			</div>
			<SpaceAgentIssueRecoveryAction
				className="mt-0 shrink-0"
				profileId={input.entry.profileId}
			/>
		</div>
	);
}

/** A colleague's access and the reason the Agent can't work, if named. */
function useColleagueAgentPopoverState(input: {
	entry: SpaceMemberDirectoryEntry;
	isColleagueAgent: boolean;
}) {
	const access = useAgentViewerAccess({
		ownerName: input.entry.ownerName,
		ownerUserId: input.entry.ownerUserId,
		profileId: input.entry.profileId,
	});
	const publicReason = usePublicWakeabilityReason({
		enabled: input.isColleagueAgent,
		profileId: input.entry.profileId,
	});
	const reason = publicReason
		? formatPublicWakeabilityReason(publicReason)
		: null;
	return {
		access: input.isColleagueAgent ? access : null,
		chatUnavailableReason:
			input.isColleagueAgent &&
			input.entry.availabilityCategory === "unavailable"
				? (reason ?? "This Agent is unavailable")
				: null,
		reason,
	};
}

function resolveAgentIssueLabel(
	entry: SpaceMemberDirectoryEntry
): string | null {
	if (
		entry.availabilityCategory !== "unavailable" &&
		entry.availabilityCategory !== "offline"
	) {
		return null;
	}
	return entry.availabilityBadgeLabel ?? resolveAgentPresenceSummary(entry);
}

function AgentProfileDetailsHeader(input: {
	canEdit: boolean;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	isCenterAgent: boolean;
	moreDetailsHref?: string;
	onNavigate?: () => void;
	showAvailability: boolean;
}) {
	const memberAgentDisplayName = useMemberAgentProfileDisplayName({
		agentControllerRef: input.entry.agentControllerRef,
		ownerName: input.entry.ownerName,
		profileId: input.entry.profileId,
		profileKind: input.isCenterAgent ? "center_agent" : input.entry.profileKind,
		profileName: input.entry.profileName,
	});
	const modelSummary =
		selectDetailsRows(input.details, ["model"])[0]?.value ??
		input.entry.controllerDisplayName ??
		"Agent";
	const presenceSummary = input.showAvailability
		? resolveAgentPresenceSummary(input.entry)
		: null;
	return (
		<ProfileCardHeader
			action={
				input.isCenterAgent ? (
					<CenterAgentSettingsAction onNavigate={input.onNavigate} />
				) : (
					<AgentProfileDetailsAction
						canEdit={input.canEdit}
						href={input.moreDetailsHref}
						onNavigate={input.onNavigate}
						profileName={input.entry.profileName}
					/>
				)
			}
			avatar={
				input.isCenterAgent ? (
					<SpaceProfileIcon
						agentControllerRef={input.entry.agentControllerRef}
						avatarModelId={input.entry.avatarModelId}
						avatarStyle={input.entry.avatarStyle}
						botInteraction="playful"
						clickable
						isCenterAgent
						profileId={input.entry.profileId}
						profileKind="agent"
						profileName={input.entry.profileName}
						size="md"
					/>
				) : (
					<AgentProfileControllerAvatar
						agentControllerRef={input.entry.agentControllerRef}
						avatarStyle={input.entry.avatarStyle}
						botInteraction="playful"
						clickable
						modelId={input.entry.avatarModelId}
						profileId={input.entry.profileId}
						profileName={input.entry.profileName}
						size={48}
					/>
				)
			}
			badge={
				<>
					{" "}
					{!input.isCenterAgent && (
						<RemoteAgentIndicator
							agentControllerRef={input.entry.agentControllerRef}
						/>
					)}
					{presenceSummary ? (
						<span
							className={cn(
								"ml-1.5 inline-block font-normal text-xs",
								resolveSpaceMemberInlineStatusTextClassName(input.entry)
							)}
						>
							{presenceSummary}
						</span>
					) : null}
				</>
			}
			name={memberAgentDisplayName ?? input.entry.profileName}
		>
			<p className="mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-sm">
				{input.isCenterAgent && (
					<RemoteAgentIndicator
						agentControllerRef={input.entry.agentControllerRef}
					/>
				)}
				<span className="truncate">{modelSummary}</span>
			</p>
			{!input.isCenterAgent && <AgentProfileOwner entry={input.entry} />}
		</ProfileCardHeader>
	);
}

function CenterAgentSettingsAction(input: { onNavigate?: () => void }) {
	const openSettings = useAppSettings();
	return (
		<TooltipHint content="Center Agent settings">
			<Button
				aria-label="Open Center Agent settings"
				className="shrink-0"
				onClick={() => {
					input.onNavigate?.();
					openSettings("center-agent").catch((error: Error) =>
						toast.error(error.message)
					);
				}}
				size="icon-sm"
				type="button"
				variant="ghost"
			>
				<GearIcon aria-hidden="true" />
			</Button>
		</TooltipHint>
	);
}

function AgentProfileOwner({ entry }: { entry: SpaceMemberDirectoryEntry }) {
	const organization = useOptionalAppOrganization();
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: Boolean(organization && entry.ownerUserId),
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	const owner = directory.data?.members.find(
		(member) => member.userId === entry.ownerUserId
	);
	const name = owner?.humanProfile?.profileName ?? entry.ownerName;
	const access = useAgentViewerAccess({
		ownerName: name,
		ownerUserId: entry.ownerUserId,
		profileId: entry.profileId,
	});
	if (!name) {
		return null;
	}
	return (
		<>
			<p className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs">
				<span className="shrink-0">Owned by</span>
				{owner?.humanProfile && (
					<DitherProfileAvatar
						avatarImageUrl={owner.user.image}
						profileId={owner.humanProfile.profileId}
						profileKind="human"
						profileName={name}
						size={16}
					/>
				)}
				<span className="min-w-0 truncate text-foreground">{name}</span>
			</p>
			{access ? (
				<AgentAccessIndicator access={access} className="mt-1" />
			) : null}
		</>
	);
}

function AgentProfileDetailsAction(input: {
	canEdit: boolean;
	href?: string;
	profileName: string;
	onNavigate?: () => void;
}) {
	if (!input.href) {
		return null;
	}
	return (
		<Link
			aria-label={
				input.canEdit
					? `Edit ${input.profileName}`
					: `View ${input.profileName}'s profile`
			}
			className={cn(
				buttonVariants({ size: "icon-xs", variant: "ghost" }),
				"shrink-0"
			)}
			onClick={input.onNavigate}
			to={input.href}
		>
			{input.canEdit ? (
				<PencilSimpleIcon aria-hidden="true" />
			) : (
				<ArrowRightIcon aria-hidden="true" />
			)}
		</Link>
	);
}

function AgentProfileDirectMessageAction(input: {
	access?: AgentViewerAccess | null;
	href?: string;
	isPending: boolean;
	onOpen?: () => void;
	profileName: string;
	onNavigate?: () => void;
	unavailableReason?: string | null;
}) {
	if (!(input.href || input.onOpen)) {
		return null;
	}
	const content = (
		<>
			<ChatCircleTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="truncate">
				{resolveAgentChatActionLabel({
					access: input.access ?? null,
					profileName: input.profileName,
				})}
			</span>
		</>
	);
	if (input.unavailableReason) {
		return (
			<TooltipHint
				content={`Can’t start work right now: ${input.unavailableReason}.`}
			>
				<span className="mt-3 flex w-full">
					<Button
						className="w-full min-w-0 justify-center px-4"
						disabled
						type="button"
						variant="default"
					>
						{content}
					</Button>
				</span>
			</TooltipHint>
		);
	}
	if (input.href) {
		return (
			<Link
				className={cn(
					buttonVariants({ size: "default", variant: "default" }),
					"mt-3 w-full min-w-0 justify-center px-4"
				)}
				onClick={input.onNavigate}
				to={input.href}
			>
				{content}
			</Link>
		);
	}
	return (
		<Button
			className="mt-3 w-full min-w-0 justify-center px-4"
			disabled={input.isPending}
			onClick={input.onOpen}
			type="button"
			variant="default"
		>
			{content}
		</Button>
	);
}

export function AgentProfileDetailsPopover(input: {
	chatHref?: string;
	details: ProfileDetailsSnapshot;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending?: boolean;
	isCenterAgent?: boolean;
	moreDetailsHref?: string;
	onOpenDirectMessage?: () => void;
	trigger: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover.Root modal={false} onOpenChange={setOpen} open={open}>
			<Popover.Trigger render={input.trigger} />
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "none",
						side: "flip",
					}}
					collisionPadding={PROFILE_DETAILS_POPOVER_COLLISION_PADDING}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						aria-label={`${input.entry.profileName} Profile`}
						className={cn(
							PROFILE_DETAILS_POPOVER_CLASS_NAME,
							"max-h-[var(--available-height)] overflow-hidden"
						)}
						role="dialog"
					>
						<AgentProfileDetailsContent
							chatHref={input.chatHref}
							className="max-h-[min(34rem,calc(var(--available-height)-1.5rem))]"
							details={input.details}
							entry={input.entry}
							isCenterAgent={input.isCenterAgent}
							isDirectMessagePending={input.isDirectMessagePending}
							moreDetailsHref={input.moreDetailsHref}
							onNavigate={() => setOpen(false)}
							onOpenDirectMessage={input.onOpenDirectMessage}
						/>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function HumanProfileDetailsPopover(input: {
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry;
	isSelf?: boolean;
	isDirectMessagePending?: boolean;
	modelCatalog: ModelCatalog | null;
	onOpenDirectMessage?: () => void;
	organizationId: string | null;
	orgSlug?: string;
	profileHref?: string;
	trigger: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const activityTime = useMemberActivityTime(input.entry);
	const canLoadCollaborationDetails = Boolean(
		input.organizationId && input.orgSlug && input.entry.ownerUserId
	);
	return (
		<Popover.Root modal={false} onOpenChange={setOpen} open={open}>
			<Popover.Trigger render={input.trigger} />
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "none",
						side: "flip",
					}}
					collisionPadding={PROFILE_DETAILS_POPOVER_COLLISION_PADDING}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						aria-label={`${input.entry.profileName} Profile`}
						className={PROFILE_DETAILS_POPOVER_CLASS_NAME}
						role="dialog"
					>
						{canLoadCollaborationDetails ? (
							<HumanProfileDetailsPopoverWithCollaboration
								activityTime={activityTime}
								currentOwnerUserId={input.currentOwnerUserId}
								entry={input.entry}
								isDirectMessagePending={input.isDirectMessagePending === true}
								isSelf={input.isSelf === true}
								modelCatalog={input.modelCatalog}
								onNavigate={() => setOpen(false)}
								onOpenDirectMessage={input.onOpenDirectMessage}
								organizationId={input.organizationId ?? ""}
								orgSlug={input.orgSlug ?? ""}
								profileHref={input.profileHref}
							/>
						) : (
							<HumanProfileDetailsPopoverContent
								activityTime={activityTime}
								entry={input.entry}
								isDirectMessagePending={input.isDirectMessagePending === true}
								isSelf={input.isSelf === true}
								onNavigate={() => setOpen(false)}
								onOpenDirectMessage={input.onOpenDirectMessage}
								profileHref={input.profileHref}
							/>
						)}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

export function HistoricalProfilePopover(input: {
	entry: Pick<
		ProfileDetailsSpaceMemberInput,
		"profileId" | "profileKind" | "profileName" | "agentControllerRef"
	>;
	isSelf: boolean;
	isCenterAgent: boolean;
	chatHref?: string;
	trigger: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover.Root modal={false} onOpenChange={setOpen} open={open}>
			<Popover.Trigger render={input.trigger} />
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "none",
						side: "flip",
					}}
					collisionPadding={PROFILE_DETAILS_POPOVER_COLLISION_PADDING}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						aria-label={`${input.entry.profileName} Profile`}
						className={cn(
							PROFILE_DETAILS_POPOVER_CLASS_NAME,
							"max-h-[var(--available-height)] overflow-hidden"
						)}
						role="dialog"
					>
						<div className="flex min-w-0 items-start gap-3">
							<SpaceProfileIcon
								agentControllerRef={input.entry.agentControllerRef}
								botInteraction="playful"
								clickable
								isCenterAgent={input.isCenterAgent}
								profileId={input.entry.profileId}
								profileKind={input.entry.profileKind}
								profileName={input.entry.profileName}
								size="md"
							/>
							<div className="min-w-0 flex-1 pt-0.5">
								<h2 className="break-words font-semibold text-base">
									{input.entry.profileName}
									{input.isSelf ? (
										<span className="font-normal text-muted-foreground text-sm">
											{" "}
											· You
										</span>
									) : null}
								</h2>
							</div>
							{input.isCenterAgent && (
								<CenterAgentSettingsAction onNavigate={() => setOpen(false)} />
							)}
						</div>
						{input.chatHref ? (
							<AgentProfileDirectMessageAction
								href={input.chatHref}
								isPending={false}
								onNavigate={() => setOpen(false)}
								profileName={input.entry.profileName}
							/>
						) : null}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function HumanProfileDetailsPopoverWithCollaboration(input: {
	activityTime: string | null;
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending: boolean;
	isSelf: boolean;
	modelCatalog: ModelCatalog | null;
	onOpenDirectMessage?: () => void;
	onNavigate?: () => void;
	organizationId: string;
	orgSlug: string;
	profileHref?: string;
}) {
	const profileDirectoryQuery = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const computersQuery = useQuery(
		organizationComputersQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const agentProfiles = profileDirectoryQuery.data
		? (buildDirectoryAgentProfilesByOwner({
				members: profileDirectoryQuery.data.members,
				agentProfiles: profileDirectoryQuery.data.agentProfiles,
				orgSlug: input.orgSlug,
			}).get(input.entry.ownerUserId ?? "") ?? [])
		: [];
	const agentsStatus = resolveDirectoryProjectionStatus({
		isError: profileDirectoryQuery.isError,
		isPending: profileDirectoryQuery.isPending,
	});
	const { data: currentComputers, status: computersStatus } =
		resolveCurrentOrganizationComputersProjection(computersQuery);
	const computer = resolveHumanProfileComputer({
		computers: currentComputers,
		isCurrentUser: input.entry.ownerUserId === input.currentOwnerUserId,
		orgSlug: input.orgSlug,
		status: computersStatus,
		userId: input.entry.ownerUserId ?? "",
	});
	return (
		<HumanProfileDetailsPopoverContent
			activityTime={input.activityTime}
			agentProfiles={agentProfiles}
			agentsStatus={agentsStatus}
			computer={computer}
			entry={input.entry}
			isDirectMessagePending={input.isDirectMessagePending}
			isSelf={input.isSelf}
			modelCatalog={input.modelCatalog}
			onNavigate={input.onNavigate}
			onOpenDirectMessage={input.onOpenDirectMessage}
			profileHref={input.profileHref}
		/>
	);
}

function resolveDirectoryProjectionStatus(input: {
	isError: boolean;
	isPending: boolean;
}): DirectoryProjectionStatus {
	if (input.isPending) {
		return "loading";
	}
	return input.isError ? "failed" : "ready";
}

function HumanProfileDetailsPopoverContent(input: {
	activityTime: string | null;
	agentProfiles?: readonly DirectoryAgentProfileSummary[];
	agentsStatus?: DirectoryProjectionStatus;
	computer?: DirectoryHumanProfileComputer;
	entry: SpaceMemberDirectoryEntry;
	isDirectMessagePending: boolean;
	isSelf: boolean;
	modelCatalog?: ModelCatalog | null;
	onOpenDirectMessage?: () => void;
	onNavigate?: () => void;
	profileHref?: string;
}) {
	const showAgentProfiles =
		input.agentsStatus === "ready" &&
		Boolean(input.agentProfiles && input.agentProfiles.length > 0);
	return (
		<>
			<div className="flex min-w-0 items-start gap-3">
				<SpaceProfileIcon
					agentControllerRef={null}
					avatarImageUrl={input.entry.avatarUrl}
					profileId={input.entry.profileId}
					profileKind="human"
					profileName={input.entry.profileName}
					size="md"
				/>
				<div className="min-w-0 flex-1 pt-0.5">
					<div className="flex min-w-0 items-baseline gap-x-1.5">
						<p className="truncate font-semibold text-base text-foreground">
							{input.entry.profileName}
						</p>
						{input.isSelf ? (
							<span className="shrink-0 text-muted-foreground text-sm before:mr-1.5 before:content-['·']">
								You
							</span>
						) : null}
						{input.activityTime ? (
							<TooltipHint content="Last activity in this Space">
								<span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs before:mr-1.5 before:content-['·']">
									{input.activityTime}
								</span>
							</TooltipHint>
						) : null}
					</div>
					{input.computer ? (
						<div className="mt-2 min-w-0 text-muted-foreground text-xs">
							<DirectoryHumanProfileComputerSummary
								computer={input.computer}
								ownerName={input.entry.profileName}
							/>
						</div>
					) : null}
				</div>
				{input.profileHref ? (
					<TooltipHint content="View profile">
						<Link
							aria-label={`View ${input.entry.profileName} profile`}
							className={cn(
								buttonVariants({ size: "icon-xs", variant: "ghost" }),
								"shrink-0"
							)}
							onClick={input.onNavigate}
							to={input.profileHref}
						>
							<ArrowRightIcon aria-hidden="true" />
						</Link>
					</TooltipHint>
				) : null}
			</div>
			<AgentProfileDirectMessageAction
				isPending={input.isDirectMessagePending}
				onOpen={input.onOpenDirectMessage}
				profileName={input.entry.profileName}
			/>
			{showAgentProfiles && input.agentProfiles ? (
				<div className="mt-4 border-border border-t pt-4">
					<DirectoryAgentProfilesSummary
						modelCatalog={input.modelCatalog ?? null}
						ownerName={input.entry.profileName}
						path={input.profileHref}
						profiles={input.agentProfiles}
						status={input.agentsStatus}
						variant="popover"
					/>
				</div>
			) : null}
		</>
	);
}

function resolveAgentPresenceSummary(
	entry: SpaceMemberDirectoryEntry
): string | null {
	if (entry.availabilityReasonCode === "agent_execution.ready") {
		return "Available for Wake";
	}
	if (entry.availabilityBadgeLabel) {
		return entry.availabilityBadgeLabel;
	}
	switch (entry.presenceStatus) {
		case "wakeable":
			return "Available for Wake";
		case "checking_connection":
			return "Checking";
		case "offline":
			return "Offline";
		case "unavailable":
			return "Unavailable";
		default:
			return entry.presenceLabel ?? entry.availabilitySummary;
	}
}

function AgentProfileMoreDetailsContent(input: {
	details: ProfileDetailsSnapshot;
	profile: AuthProfileView;
}) {
	const details = buildAgentProfileMoreDetailsSnapshot(input);
	return (
		<ProfileDetailsContent
			className="min-h-0 flex-1 pr-1"
			details={details}
			showSummary={false}
			testId="profile-details-dialog-scroll-area"
		/>
	);
}

function buildAgentProfileMoreDetailsSnapshot(input: {
	details: ProfileDetailsSnapshot;
	profile: AuthProfileView;
}): ProfileDetailsSnapshot {
	const profileRows = selectDetailsRows(input.details, [
		"profile_id",
		"created_from",
		"created_at",
		"updated_at",
	]).map((row) => {
		if (row.id === "created_at") {
			return {
				...row,
				value: formatAgentProfileTimestamp(input.profile.createdAt),
			};
		}
		if (row.id === "updated_at") {
			return {
				...row,
				value: formatAgentProfileTimestamp(input.profile.updatedAt),
			};
		}
		return row;
	});
	const sections: ProfileDetailsSection[] = [];
	if (profileRows.length > 0) {
		sections.push({
			id: "profile",
			recoveryAction: null,
			rows: profileRows,
			title: "Profile details",
		});
	}
	return { ...input.details, sections };
}

function selectDetailsRows(
	details: ProfileDetailsSnapshot,
	rowIds: readonly string[]
): ProfileDetailsField[] {
	const rowsById = new Map<string, ProfileDetailsField>();
	for (const section of details.sections) {
		for (const row of section.rows) {
			rowsById.set(row.id, row);
		}
	}
	return rowIds.flatMap((rowId) => {
		const row = rowsById.get(rowId);
		return row ? [row] : [];
	});
}

function formatAgentProfileTimestamp(value: string): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: AGENT_PROFILE_TIMESTAMP_FORMATTER.format(date);
}

export function ProfileDetailsContent(input: {
	className?: string;
	collapseAgentTechnicalDetails?: boolean;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	excludedSectionIds?: readonly ProfileDetailsSectionId[];
	isDirectMessagePending?: boolean;
	isRecoveryActionPending?: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	onOpenDirectMessage?: () => void;
	showSummary?: boolean;
	summaryAvatar?: ReactNode;
	testId?: string;
}) {
	const excludedSectionIds = new Set(input.excludedSectionIds ?? []);
	const visibleSections = input.details.sections.filter(
		(section) => !excludedSectionIds.has(section.id)
	);
	const technicalSections = input.collapseAgentTechnicalDetails
		? visibleSections.filter((section) =>
				AGENT_WORKSPACE_TECHNICAL_SECTION_IDS.has(section.id)
			)
		: [];
	const primarySections = input.collapseAgentTechnicalDetails
		? visibleSections.filter(
				(section) => !AGENT_WORKSPACE_TECHNICAL_SECTION_IDS.has(section.id)
			)
		: visibleSections;
	const showCollapsedTechnicalDetails =
		input.collapseAgentTechnicalDetails === true &&
		(Boolean(input.currentSession) || technicalSections.length > 0);
	return (
		<ScrollArea
			className={cn("min-w-0", input.className)}
			data-testid={input.testId}
		>
			{input.showSummary === false ? null : (
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="flex min-w-0 items-start gap-2.5">
						{input.summaryAvatar}
						<div className="min-w-0">
							<p className="break-words font-medium text-sm">
								{input.details.profileName}
							</p>
							<p className="text-muted-foreground text-xs">
								{formatProfileKind(input.details.profileKind)}
							</p>
						</div>
					</div>
					{input.onOpenDirectMessage ? (
						<Button
							className="shrink-0"
							disabled={input.isDirectMessagePending === true}
							onClick={input.onOpenDirectMessage}
							size="sm"
							type="button"
							variant="outline"
						>
							<ChatCircleTextIcon data-icon="inline-start" />
							Direct Message
						</Button>
					) : null}
				</div>
			)}
			{input.currentSession && !input.collapseAgentTechnicalDetails ? (
				<ProfileDetailsCurrentSession
					className="mt-5"
					currentSession={input.currentSession}
				/>
			) : null}

			<div className="mt-5 min-w-0 space-y-5">
				{primarySections.map((section) => (
					<ProfileDetailsSectionView
						isRecoveryActionPending={input.isRecoveryActionPending === true}
						key={section.id}
						onRecoveryAction={input.onRecoveryAction}
						section={section}
					/>
				))}
				{showCollapsedTechnicalDetails ? (
					<details
						className="group min-w-0 overflow-hidden rounded-md border border-border"
						data-testid="profile-technical-details"
					>
						<summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 font-medium text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
							<span className="min-w-0 flex-1">Technical details</span>
							<CaretDownIcon
								aria-hidden="true"
								className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
							/>
						</summary>
						<div className="min-w-0 space-y-5 border-border border-t px-3 py-3">
							{input.currentSession ? (
								<ProfileDetailsCurrentSession
									currentSession={input.currentSession}
								/>
							) : null}
							{technicalSections.map((section) => (
								<ProfileDetailsSectionView
									isRecoveryActionPending={
										input.isRecoveryActionPending === true
									}
									key={section.id}
									onRecoveryAction={input.onRecoveryAction}
									section={section}
								/>
							))}
						</div>
					</details>
				) : null}
			</div>
		</ScrollArea>
	);
}

function ProfileDetailsSectionView(input: {
	isRecoveryActionPending: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	section: ProfileDetailsSection;
}) {
	const recoveryAction = input.section.recoveryAction;
	return (
		<section className="min-w-0 space-y-2">
			<h3 className="font-medium text-muted-foreground text-xs">
				{input.section.title}
			</h3>
			<div className="min-w-0 divide-y divide-border overflow-hidden rounded-md border border-border">
				{input.section.rows.map((row) => (
					<ProfileDetailsFieldRow
						key={`${input.section.id}:${row.id}`}
						row={row}
					/>
				))}
			</div>
			{recoveryAction && input.onRecoveryAction ? (
				<ProfileDetailsRecoveryActionButton
					isPending={input.isRecoveryActionPending}
					onRecoveryAction={input.onRecoveryAction}
					recoveryAction={recoveryAction}
				/>
			) : null}
		</section>
	);
}

function ProfileDetailsFieldRow(input: { row: ProfileDetailsField }) {
	const value = (
		<span
			className={cn(
				"min-w-0 whitespace-pre-wrap break-all text-xs [overflow-wrap:anywhere]",
				input.row.valueKind === "identifier" || input.row.valueKind === "path"
					? "font-mono"
					: null
			)}
		>
			{input.row.value}
		</span>
	);

	if (input.row.copy) {
		return (
			<button
				aria-label={input.row.copy.label}
				className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:ring-inset"
				onClick={async () => {
					await copyDetailsValue({
						successMessage:
							input.row.copy?.successMessage ?? `${input.row.label} copied.`,
						value: input.row.value,
					});
				}}
				type="button"
			>
				<span className="min-w-0 space-y-1">
					<span className="block text-muted-foreground text-xs">
						{input.row.label}
					</span>
					{value}
				</span>
				<CopyIcon className="mt-5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
			</button>
		);
	}

	return (
		<div className="min-w-0 space-y-1 px-3 py-2">
			<p className="text-muted-foreground text-xs">{input.row.label}</p>
			{value}
		</div>
	);
}

async function copyDetailsValue(input: {
	successMessage: string;
	value: string;
}) {
	if (await copyTextToClipboard(input.value)) {
		toast.success(input.successMessage);
		return;
	}

	toast.error(
		"OpenMeld could not copy this automatically. Select the text and copy it manually."
	);
}
