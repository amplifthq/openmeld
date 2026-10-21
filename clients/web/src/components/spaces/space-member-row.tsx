import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
import { isAgentProfileWorkspaceBlockerReasonCode } from "@openmeld/agent-runtime";
import type { ModelCatalog } from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
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
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipHint,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	DotsThreeIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME } from "#/components/app/app-nav-item-style";
import { useMemberAgentProfileDisplayName } from "#/components/member-agents/use-member-agent-profile-display-name";
import { AgentProfileListItem } from "#/components/profiles/profile-list-item";
import { buildOpenMeldServiceSettingsPath } from "#/lib/settings-routes";
import { resolveSpaceMemberStatusBadgeDisplay } from "#/lib/spaces/presentation";
import { useMemberActivityTime } from "#/lib/spaces/use-member-activity-time";
import {
	isManualOnlyAgentRecoveryPlan,
	MANUAL_ONLY_AGENT_BADGE_LABEL,
} from "./space-agent-manual-participation";
import {
	SpaceAgentAvailabilityIndicator,
	SpaceMemberInlineStatusText,
} from "./space-member-inline-status-text";
import { isSameOwnerUserId } from "./space-member-ownership";
import {
	resolveSpaceMemberInlineStatusTextClassName,
	resolveSpaceMemberStatusTone,
} from "./space-member-status-tone";
import type { SpaceRemoveMemberResult } from "./space-members-drawer";
import { SpaceProfileIcon } from "./space-profile-icon";
import type { SpaceWakeStatusTransientState } from "./space-wake-status-refresh";
import { useSpaceProfileDetailsPopover } from "./use-space-profile-details-popover";

type SpaceMemberRowProps = {
	agentRecoveryPlan: AgentProfileReplyRecoveryPlan | null;
	centerAgentProfileId?: string | null;
	currentOwnerUserId: string | null;
	currentProfileId: string;
	density?: "compact" | "default";
	entry: SpaceMemberDirectoryEntry;
	entriesByProfileId?: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	isAgentWakeAvailabilityCheckPending: boolean;
	modelCatalog?: ModelCatalog | null;
	onCheckAgentWakeAvailability: (profileId: string) => Promise<void>;
	onRemoveFromSpace?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	memberTransientState: SpaceWakeStatusTransientState | null;
	showAgentConnectionDetail?: boolean;
	variant: "compact" | "full";
	/** Display-only Wake projection (the last Available snapshot) used ONLY for
	 * indicator + inline row visuals. Absent = no smoothing. Never read by the
	 * details dialog, recovery/Check-again decisions, sorting, or mention. */
	wakeDisplayEntry?: SpaceMemberDirectoryEntry | null;
};

type AgentSpaceMemberRowProps = Omit<SpaceMemberRowProps, "entry"> & {
	entry: SpaceMemberDirectoryEntry;
};

type HumanSpaceMemberRowProps = Omit<SpaceMemberRowProps, "entry"> & {
	entry: SpaceMemberDirectoryEntry;
};

const SPACE_MEMBER_NAME_CLASS_NAME = cn(
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
	"sm:text-[13px]"
);
const SPACE_MEMBER_ACTIVITY_PREFIX_PATTERN = /^Active here\s+/;
const SPACE_MEMBER_ACTIVITY_TOOLTIP = "Last activity in this Space";

export function SpaceMemberRow(input: SpaceMemberRowProps) {
	if (input.entry.profileKind === "agent") {
		return <AgentSpaceMemberRow {...input} entry={input.entry} />;
	}
	return <HumanSpaceMemberRow {...input} entry={input.entry} />;
}

function AgentSpaceMemberRow(input: AgentSpaceMemberRowProps) {
	const canManageAgentProfile = isOwnedByCurrentUser({
		currentOwnerUserId: input.currentOwnerUserId,
		ownerUserId: input.entry.ownerUserId,
	});
	const presentation = resolveAgentSpaceMemberRowPresentation({
		canManageAgentProfile,
		input,
	});
	const memberAgentDisplayName = useMemberAgentProfileDisplayName({
		agentControllerRef: input.entry.agentControllerRef,
		ownerName: input.entry.ownerName,
		profileId: input.entry.profileId,
		profileKind: input.entry.profileKind,
		profileName: input.entry.profileName,
	});
	const detailsDialog = useSpaceProfileDetailsPopover({
		centerAgentProfileId: input.centerAgentProfileId,
		currentOwnerUserId: input.currentOwnerUserId,
		entry: input.entry,
		entriesByProfileId: input.entriesByProfileId,
		modelCatalog: input.modelCatalog ?? null,
		orgSlug: input.orgSlug,
	});
	const actions = renderSpaceMemberActions({
		onRemoveFromSpace: input.onRemoveFromSpace,
		profileId: input.entry.profileId,
		profileName: input.entry.profileName,
		variant: input.variant,
	});

	return (
		<AgentProfileListItem
			actions={actions}
			badges={
				<SpaceMemberBadges
					canCheckAgentWakeAvailability={
						presentation.canCheckAgentWakeAvailability
					}
					entry={presentation.visualEntry}
					isAgentWakeAvailabilityCheckPending={
						input.isAgentWakeAvailabilityCheckPending
					}
					isSelf={false}
					onCheckAgentWakeAvailability={input.onCheckAgentWakeAvailability}
					statusIsRefreshing={presentation.availabilityIndicatorIsRefreshing}
					statusLabel={null}
					statusTooltip={presentation.availabilityIndicatorTooltip}
					variant={input.variant}
				/>
			}
			className={cn(
				input.density === "compact"
					? "px-1.5 py-2"
					: cn("px-3 py-3", input.variant === "full" ? "sm:px-4" : null)
			)}
			compact={input.density === "compact"}
			dimName={shouldDimProfileName({
				entry: input.entry,
				memberTransientState: presentation.visualDisplayedMemberTransientState,
			})}
			icon={
				<SpaceProfileIcon
					agentControllerRef={input.entry.agentControllerRef}
					avatarImageUrl={input.entry.avatarUrl}
					avatarModelId={input.entry.avatarModelId}
					avatarStyle={input.entry.avatarStyle}
					className="mt-0.5"
					isCenterAgent={input.entry.profileId === input.centerAgentProfileId}
					profileId={input.entry.profileId}
					profileKind={input.entry.profileKind}
					profileName={input.entry.profileName}
				/>
			}
			primaryDetail={presentation.primaryDetail}
			profileName={memberAgentDisplayName ?? input.entry.profileName}
			profileNameAdornment={
				<>
					<AgentSpaceMemberAvailabilityIndicator presentation={presentation} />
					<RemoteAgentIndicator
						agentControllerRef={input.entry.agentControllerRef}
					/>
				</>
			}
			profileNameClassName={SPACE_MEMBER_NAME_CLASS_NAME}
			profileSummaryAriaLabel={`Check ${input.entry.profileName} Profile`}
			profileSummaryTrigger={
				detailsDialog.profileDetailsPopoverTrigger ?? undefined
			}
		/>
	);
}

type AgentSpaceMemberRowPresentation = ReturnType<
	typeof resolveAgentSpaceMemberRowPresentation
>;

function resolveAgentSpaceMemberRowPresentation(input: {
	canManageAgentProfile: boolean;
	input: AgentSpaceMemberRowProps;
}) {
	const manageableAgentRecoveryPlan = input.canManageAgentProfile
		? input.input.agentRecoveryPlan
		: null;
	const manageableMemberTransientState = input.canManageAgentProfile
		? input.input.memberTransientState
		: null;
	const rawDisplayedMemberTransientState = resolveDisplayedMemberTransientState(
		{
			entry: input.input.entry,
			manageableMemberTransientState,
		}
	);
	// Display-only Wake override: indicator + inline row visuals replay the last
	// Available snapshot (visualEntry), but every decision/diagnostic path keeps
	// reading the raw entry (input.entry) -- notably the profile details popover,
	// the recovery plan, Check-again gating, controller/model detail, and sorting.
	const visualEntry = input.input.wakeDisplayEntry ?? input.input.entry;
	const visualDisplayedMemberTransientState = input.input.wakeDisplayEntry
		? null
		: rawDisplayedMemberTransientState;
	const displayedAgentRecoveryPlan =
		input.input.entry.presenceStatus === "wakeable" ||
		rawDisplayedMemberTransientState === "checking" ||
		(input.input.entry.availabilityReasonCode !== null &&
			isAgentProfileWorkspaceBlockerReasonCode(
				input.input.entry.availabilityReasonCode
			))
			? null
			: manageableAgentRecoveryPlan;
	const availabilityIndicatorLabel = resolvePresenceStatusLabel({
		agentRecoveryPlan: displayedAgentRecoveryPlan,
		entry: visualEntry,
		memberTransientState: visualDisplayedMemberTransientState,
	});
	const availabilityIndicatorTooltip = resolvePresenceStatusTooltip({
		agentRecoveryPlan: displayedAgentRecoveryPlan,
		entry: visualEntry,
		memberTransientState: visualDisplayedMemberTransientState,
	});
	const isCompactWakeWaiting =
		input.input.density === "compact" &&
		visualDisplayedMemberTransientState === "active_wake_waiting_for_service";
	const availabilityIndicatorIsRefreshing = resolvePresenceStatusIsRefreshing({
		entry: visualEntry,
		memberTransientState: visualDisplayedMemberTransientState,
	});
	const availabilityIndicatorHref =
		input.canManageAgentProfile && visualDisplayedMemberTransientState === null
			? resolvePresenceIndicatorHref({
					entry: visualEntry,
					orgSlug: input.input.orgSlug,
				})
			: undefined;
	const canCheckAgentWakeAvailability =
		input.canManageAgentProfile &&
		input.input.entry.availabilityReasonCode ===
			"wake_route.registration_expired" &&
		rawDisplayedMemberTransientState === null;

	// Compact rows show a problem only as the status dot; its reason is in
	// the dot's tooltip and its fix in the profile popover.
	const statusDetailIsInTooltip =
		input.input.density === "compact" &&
		(visualDisplayedMemberTransientState === "checking" ||
			visualDisplayedMemberTransientState === "active_wake_in_progress" ||
			visualDisplayedMemberTransientState ===
				"active_wake_waiting_for_folder" ||
			visualEntry.presenceStatus === "checking_connection" ||
			visualEntry.availabilityCategory === "unavailable" ||
			visualEntry.availabilityCategory === "offline");
	const primaryDetail =
		input.input.variant === "compact"
			? resolveCompactDetail(visualEntry, false)
			: resolvePrimaryDetail(
					visualEntry,
					false,
					displayedAgentRecoveryPlan,
					visualDisplayedMemberTransientState,
					input.canManageAgentProfile,
					input.input.showAgentConnectionDetail !== false
				);
	return {
		availabilityIndicatorHref,
		availabilityIndicatorIsRefreshing,
		availabilityIndicatorLabel: isCompactWakeWaiting
			? "Waiting"
			: availabilityIndicatorLabel,
		availabilityIndicatorTone: resolvePresenceIndicatorTone({
			agentRecoveryPlan: displayedAgentRecoveryPlan,
			entry: visualEntry,
			memberTransientState: visualDisplayedMemberTransientState,
		}),
		availabilityIndicatorTooltip: isCompactWakeWaiting
			? "Wake waiting for this computer to reconnect"
			: availabilityIndicatorTooltip,
		canCheckAgentWakeAvailability,
		displayedAgentRecoveryPlan,
		primaryDetail: statusDetailIsInTooltip ? null : primaryDetail,
		rawDisplayedMemberTransientState,
		visualDisplayedMemberTransientState,
		visualEntry,
	};
}

function AgentSpaceMemberAvailabilityIndicator(input: {
	presentation: AgentSpaceMemberRowPresentation;
}) {
	if (!input.presentation.availabilityIndicatorLabel) {
		return null;
	}
	return (
		<SpaceAgentAvailabilityIndicator
			action={input.presentation.visualEntry.availabilityAction}
			category={input.presentation.visualEntry.availabilityCategory}
			href={input.presentation.availabilityIndicatorHref}
			isRefreshing={input.presentation.availabilityIndicatorIsRefreshing}
			label={input.presentation.availabilityIndicatorLabel}
			phase={input.presentation.visualEntry.availabilityPhase}
			reasonCode={input.presentation.visualEntry.availabilityReasonCode}
			tone={input.presentation.availabilityIndicatorTone}
			tooltip={input.presentation.availabilityIndicatorTooltip}
		/>
	);
}

function HumanSpaceMemberRow(input: HumanSpaceMemberRowProps) {
	const activityTime = useMemberActivityTime(input.entry);
	const isSelf = input.entry.profileId === input.currentProfileId;
	const displayedMemberTransientState = resolveDisplayedMemberTransientState({
		entry: input.entry,
		manageableMemberTransientState: input.memberTransientState,
	});
	const presenceStatusLabel = resolvePresenceStatusLabel({
		agentRecoveryPlan: null,
		entry: input.entry,
		memberTransientState: displayedMemberTransientState,
	});
	const resolvedPrimaryDetail =
		input.variant === "compact"
			? resolveCompactDetail(input.entry, isSelf)
			: resolvePrimaryDetail(
					input.entry,
					isSelf,
					null,
					displayedMemberTransientState
				);
	const spaceActivityLabel =
		isSelf || input.entry.liveNow || !activityTime
			? null
			: `Active here ${activityTime}`;
	const primaryDetail = spaceActivityLabel ? (
		<SpaceMemberActivityText label={spaceActivityLabel} />
	) : (
		resolvedPrimaryDetail
	);
	const detailsDialog = useSpaceProfileDetailsPopover({
		centerAgentProfileId: input.centerAgentProfileId,
		currentOwnerUserId: input.currentOwnerUserId,
		entry: input.entry,
		entriesByProfileId: input.entriesByProfileId,
		modelCatalog: input.modelCatalog ?? null,
		orgSlug: input.orgSlug,
	});
	const actions = renderSpaceMemberActions({
		onRemoveFromSpace: input.onRemoveFromSpace,
		profileId: input.entry.profileId,
		profileName: input.entry.profileName,
		variant: input.variant,
	});

	return (
		<AgentProfileListItem
			actions={actions}
			badges={
				<SpaceMemberBadges
					activityLabel={
						input.density === "compact" && spaceActivityLabel
							? spaceActivityLabel.replace(
									SPACE_MEMBER_ACTIVITY_PREFIX_PATTERN,
									""
								)
							: null
					}
					canCheckAgentWakeAvailability={false}
					entry={input.entry}
					isAgentWakeAvailabilityCheckPending={false}
					isSelf={isSelf}
					onCheckAgentWakeAvailability={input.onCheckAgentWakeAvailability}
					statusIsRefreshing={resolvePresenceStatusIsRefreshing({
						entry: input.entry,
						memberTransientState: displayedMemberTransientState,
					})}
					statusLabel={presenceStatusLabel}
					statusTooltip={resolvePresenceStatusTooltip({
						agentRecoveryPlan: null,
						entry: input.entry,
						memberTransientState: displayedMemberTransientState,
					})}
					variant={input.variant}
				/>
			}
			className={cn(
				input.density === "compact"
					? "px-1.5 py-2"
					: cn("px-3 py-3", input.variant === "full" ? "sm:px-4" : null)
			)}
			compact={input.density === "compact"}
			icon={
				<SpaceProfileIcon
					agentControllerRef={input.entry.agentControllerRef}
					avatarImageUrl={input.entry.avatarUrl}
					avatarModelId={input.entry.avatarModelId}
					avatarStyle={input.entry.avatarStyle}
					className="mt-0.5"
					profileId={input.entry.profileId}
					profileKind={input.entry.profileKind}
					profileName={input.entry.profileName}
				/>
			}
			primaryDetail={input.density === "compact" ? null : primaryDetail}
			profileName={input.entry.profileName}
			profileNameClassName={SPACE_MEMBER_NAME_CLASS_NAME}
			profileSummaryAriaLabel={`Check ${input.entry.profileName} Profile`}
			profileSummaryTrigger={
				detailsDialog.profileDetailsPopoverTrigger ?? undefined
			}
		/>
	);
}

function SpaceMemberActivityText(input: { label: string }) {
	const accessibleLabel = `${input.label}. ${SPACE_MEMBER_ACTIVITY_TOOLTIP}`;
	const activity = (
		<TooltipHint content={SPACE_MEMBER_ACTIVITY_TOOLTIP}>
			<span
				aria-label={accessibleLabel}
				className="cursor-help break-words"
				role="note"
			>
				{input.label}
			</span>
		</TooltipHint>
	);

	return (
		<Tooltip>
			<TooltipTrigger render={activity} />
			<TooltipContent
				className="max-w-sm whitespace-normal text-left leading-5"
				side="top"
			>
				{SPACE_MEMBER_ACTIVITY_TOOLTIP}
			</TooltipContent>
		</Tooltip>
	);
}

function SpaceMemberBadges(input: {
	activityLabel?: string | null;
	canCheckAgentWakeAvailability: boolean;
	entry: SpaceMemberDirectoryEntry;
	isAgentWakeAvailabilityCheckPending: boolean;
	isSelf: boolean;
	onCheckAgentWakeAvailability: (profileId: string) => Promise<void>;
	statusIsRefreshing: boolean;
	statusLabel: string | null;
	statusTooltip: string;
	variant: "compact" | "full";
}) {
	return (
		<>
			{input.isSelf ? (
				<SpaceMemberInlineStatusText
					className="text-muted-foreground"
					label="You"
					testId="space-member-self-status"
					tooltip="This is you"
				/>
			) : null}
			{input.statusLabel && input.entry.profileKind === "human" ? (
				<SpaceMemberInlineStatusText
					className={resolveSpaceMemberInlineStatusTextClassName(input.entry)}
					isRefreshing={input.statusIsRefreshing}
					label={input.statusLabel}
					testId="space-member-presence-status"
					tooltip={input.statusTooltip}
				/>
			) : null}
			{input.activityLabel ? (
				<SpaceMemberInlineStatusText
					className="shrink text-muted-foreground"
					label={input.activityLabel}
					testId="space-member-activity-status"
					tooltip={SPACE_MEMBER_ACTIVITY_TOOLTIP}
				/>
			) : null}
			{input.canCheckAgentWakeAvailability ? (
				<SpaceAgentWakeAvailabilityCheckAction
					isPending={input.isAgentWakeAvailabilityCheckPending}
					onCheckAgain={() =>
						input.onCheckAgentWakeAvailability(input.entry.profileId)
					}
				/>
			) : null}
			{input.entry.mentionLabel && input.variant === "full" ? (
				<span className="inline-flex max-w-full items-center break-all border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
					{input.entry.mentionLabel}
				</span>
			) : null}
		</>
	);
}

function renderSpaceMemberActions(input: {
	onRemoveFromSpace?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	profileId: string;
	profileName: string;
	variant: "compact" | "full";
}) {
	if (input.variant !== "full" || !input.onRemoveFromSpace) {
		return null;
	}
	return (
		<SpaceMemberActionsMenu
			onRemoveFromSpace={input.onRemoveFromSpace}
			profileId={input.profileId}
			profileName={input.profileName}
		/>
	);
}

function SpaceMemberActionsMenu(input: {
	onRemoveFromSpace?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	profileId: string;
	profileName: string;
}) {
	const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);
	const [isRemovePending, setIsRemovePending] = useState(false);
	const [removeErrorMessage, setRemoveErrorMessage] = useState<string | null>(
		null
	);
	const removeDialogTitle = `Remove ${input.profileName} from this Space?`;

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Member options for ${input.profileName}`}
							size="icon-sm"
							type="button"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-52" sideOffset={8}>
					{input.onRemoveFromSpace ? (
						<DropdownMenuItem
							className="text-sm"
							disabled={isRemovePending}
							onClick={() => {
								setRemoveErrorMessage(null);
								setIsRemoveDialogOpen(true);
							}}
							variant="destructive"
						>
							<TrashIcon aria-hidden="true" />
							Remove from Space
						</DropdownMenuItem>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			{input.onRemoveFromSpace ? (
				<Dialog onOpenChange={setIsRemoveDialogOpen} open={isRemoveDialogOpen}>
					<DialogContent className="sm:max-w-md">
						<DialogHeader>
							<DialogTitle>{removeDialogTitle}</DialogTitle>
							<DialogDescription>
								This removes the Profile from this Space. It does not delete the
								Profile.
							</DialogDescription>
						</DialogHeader>
						{removeErrorMessage ? (
							<p className="rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm">
								{removeErrorMessage}
							</p>
						) : null}
						<DialogFooter>
							<Button
								disabled={isRemovePending}
								onClick={() => {
									setIsRemoveDialogOpen(false);
								}}
								type="button"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={isRemovePending}
								onClick={async () => {
									setIsRemovePending(true);
									setRemoveErrorMessage(null);
									try {
										const result = await input.onRemoveFromSpace?.(
											input.profileId
										);
										if (!result) {
											return;
										}
										setIsRemoveDialogOpen(false);
										toast.success(
											result.removedCount > 0
												? `${input.profileName} was removed from this Space.`
												: `${input.profileName} is no longer in this Space.`
										);
									} catch (error) {
										console.error("Failed to remove Space member.", error);
										setRemoveErrorMessage(
											formatRemoveMemberErrorMessage({
												error,
												profileName: input.profileName,
											})
										);
									} finally {
										setIsRemovePending(false);
									}
								}}
								type="button"
								variant="destructive"
							>
								<TrashIcon aria-hidden="true" data-icon="inline-start" />
								{isRemovePending ? "Removing..." : "Remove from Space"}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) : null}
		</>
	);
}

function formatRemoveMemberErrorMessage(input: {
	error: unknown;
	profileName: string;
}): string {
	const detail =
		input.error instanceof Error && input.error.message.trim().length > 0
			? ` ${input.error.message}`
			: "";
	return `OpenMeld could not remove ${input.profileName} from this Space.${detail}`;
}

function SpaceAgentWakeAvailabilityCheckAction(input: {
	isPending: boolean;
	onCheckAgain: () => Promise<void>;
}) {
	return (
		<Button
			disabled={input.isPending}
			onClick={async () => {
				await input.onCheckAgain();
			}}
			size="xs"
			type="button"
			variant="outline"
		>
			<ArrowsClockwiseIcon aria-hidden="true" data-icon="inline-start" />
			{input.isPending ? "Checking..." : "Check again"}
		</Button>
	);
}

function resolveDisplayedMemberTransientState(input: {
	entry: SpaceMemberDirectoryEntry;
	manageableMemberTransientState: SpaceWakeStatusTransientState | null;
}): SpaceWakeStatusTransientState | null {
	if (input.entry.profileKind !== "agent") {
		return input.manageableMemberTransientState;
	}

	if (input.entry.availabilityBadgeLabel !== null) {
		if (
			input.manageableMemberTransientState === "active_wake_in_progress" ||
			input.manageableMemberTransientState ===
				"active_wake_waiting_for_folder" ||
			input.manageableMemberTransientState === "active_wake_waiting_for_service"
		) {
			return input.manageableMemberTransientState;
		}
		if (
			input.manageableMemberTransientState === "checking" &&
			input.entry.availabilityReasonCode === "wake_route.registration_expired"
		) {
			return input.manageableMemberTransientState;
		}
		return null;
	}

	if (
		input.entry.presenceStatus === "wakeable" &&
		input.manageableMemberTransientState === "checking"
	) {
		return null;
	}

	return input.manageableMemberTransientState;
}

function resolvePresenceStatusLabel(input: {
	agentRecoveryPlan: AgentProfileReplyRecoveryPlan | null;
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): string | null {
	if (input.memberTransientState === "active_wake_in_progress") {
		return "Working";
	}
	if (input.memberTransientState === "active_wake_waiting_for_folder") {
		return "Waiting";
	}
	if (input.memberTransientState === "checking") {
		const baseStatus = resolveSpaceMemberStatusBadgeDisplay(input.entry);
		return input.entry.presenceStatus === "wakeable"
			? (baseStatus?.label ?? "Available")
			: "Checking";
	}
	if (
		input.entry.profileKind === "agent" &&
		input.entry.availabilityBadgeLabel
	) {
		return (
			resolveSpaceMemberStatusBadgeDisplay(input.entry)?.label ??
			input.entry.availabilityBadgeLabel
		);
	}
	if (isManualOnlyAgentRecoveryPlan(input.agentRecoveryPlan)) {
		return MANUAL_ONLY_AGENT_BADGE_LABEL;
	}
	return resolveSpaceMemberStatusBadgeDisplay(input.entry)?.label ?? null;
}

function resolvePresenceStatusTooltip(input: {
	agentRecoveryPlan: AgentProfileReplyRecoveryPlan | null;
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): string {
	if (input.memberTransientState === "active_wake_in_progress") {
		return "Wake in progress";
	}
	if (input.memberTransientState === "active_wake_waiting_for_folder") {
		return "Waiting for another task in its folder to finish";
	}
	if (input.memberTransientState === "checking") {
		return input.entry.presenceStatus === "wakeable"
			? "Available for Wake"
			: "Checking Wake availability";
	}

	if (input.entry.profileKind === "agent" && input.entry.availabilityTooltip) {
		return input.entry.availabilityTooltip;
	}

	if (shouldShowAgentRecoveryAction(input.agentRecoveryPlan)) {
		return input.agentRecoveryPlan.title;
	}

	return (
		resolveSpaceMemberStatusBadgeDisplay(input.entry)?.tooltip ??
		input.entry.presenceLabel ??
		"Profile status"
	);
}

function resolvePresenceStatusIsRefreshing(input: {
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): boolean {
	return (
		input.memberTransientState === "active_wake_in_progress" ||
		(input.memberTransientState === "checking" &&
			input.entry.presenceStatus !== "wakeable") ||
		(resolveSpaceMemberStatusBadgeDisplay(input.entry)?.isRefreshing ?? false)
	);
}

function resolvePresenceIndicatorHref(input: {
	entry: SpaceMemberDirectoryEntry;
	orgSlug: string;
}): string | undefined {
	if (
		input.entry.profileKind !== "agent" ||
		!(
			input.entry.availabilityReasonCode === "service.update_required" ||
			input.entry.availabilityReasonCode === "background_helper.update_required"
		)
	) {
		return undefined;
	}

	return buildOpenMeldServiceSettingsPath({ orgSlug: input.orgSlug });
}

function resolvePresenceIndicatorTone(input: {
	agentRecoveryPlan: AgentProfileReplyRecoveryPlan | null;
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): StatusTone {
	if (input.entry.availabilityPhase === "provider_sign_in_needed") {
		return "warning";
	}
	if (input.memberTransientState === "active_wake_waiting_for_folder") {
		return "checking";
	}
	if (
		input.memberTransientState === "active_wake_in_progress" ||
		input.memberTransientState === "checking"
	) {
		return input.entry.presenceStatus === "wakeable" ? "ready" : "checking";
	}
	if (isManualOnlyAgentRecoveryPlan(input.agentRecoveryPlan)) {
		return "muted";
	}
	if (hasAgentAvailabilityLabel(input.entry)) {
		return resolveSpaceMemberStatusTone(input.entry);
	}
	if (shouldShowAgentRecoveryAction(input.agentRecoveryPlan)) {
		return "warning";
	}
	return resolveSpaceMemberStatusTone(input.entry);
}

function hasAgentAvailabilityLabel(entry: SpaceMemberDirectoryEntry): boolean {
	return entry.profileKind === "agent" && entry.availabilityBadgeLabel !== null;
}

function shouldDimProfileName(input: {
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): boolean {
	if (input.memberTransientState === "active_wake_in_progress") {
		return false;
	}
	return (
		input.entry.profileKind === "agent" &&
		(input.entry.availabilityCategory === "offline" ||
			input.entry.availabilityCategory === "unavailable" ||
			input.entry.presenceStatus === "offline" ||
			input.entry.presenceStatus === "unavailable")
	);
}

function resolveCompactDetail(
	entry: SpaceMemberDirectoryEntry,
	isSelf: boolean
): string {
	if (entry.profileKind === "agent") {
		return entry.controllerDisplayName ?? entry.presenceLabel ?? "Agent";
	}
	if (isSelf) {
		return entry.liveNow ? "You are live" : "You are here";
	}
	return entry.liveNow ? "Live" : "Person";
}

function resolvePrimaryDetail(
	entry: SpaceMemberDirectoryEntry,
	isSelf: boolean,
	agentRecoveryPlan?: AgentProfileReplyRecoveryPlan | null,
	memberTransientState: SpaceWakeStatusTransientState | null = null,
	canManageAgentProfile = false,
	showAgentConnectionDetail = true
): string | null {
	if (entry.profileKind === "agent") {
		return resolveAgentPrimaryDetail({
			agentRecoveryPlan,
			canManageAgentProfile,
			entry,
			memberTransientState,
			showAgentConnectionDetail,
		});
	}

	if (isSelf) {
		return entry.liveNow
			? "You are live in this space."
			: "You are in this space.";
	}

	return entry.liveNow ? "Live" : "Person";
}

function resolveAgentPrimaryDetail(input: {
	agentRecoveryPlan?: AgentProfileReplyRecoveryPlan | null;
	canManageAgentProfile: boolean;
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
	showAgentConnectionDetail: boolean;
}): string | null {
	const transientDetail = resolveMemberTransientPrimaryDetail(
		input.memberTransientState
	);
	if (transientDetail) {
		return transientDetail;
	}
	if (
		input.entry.presenceStatus === "checking_connection" &&
		!input.entry.availabilitySummary
	) {
		return "OpenMeld is checking this agent's local connection.";
	}
	if (
		input.canManageAgentProfile &&
		input.entry.presenceStatus !== "wakeable" &&
		input.entry.availabilitySummary
	) {
		return input.entry.availabilitySummary;
	}
	if (!input.showAgentConnectionDetail) {
		return null;
	}

	const controllerLocation = formatControllerLocation(input.entry);
	if (!controllerLocation) {
		return input.entry.ownerDisplay
			? `Owned by ${input.entry.ownerDisplay}`
			: "Agent";
	}
	if (!input.canManageAgentProfile) {
		return formatPublicAgentControlDetail(input.entry, controllerLocation);
	}
	if (
		!shouldShowAgentRecoveryAction(input.agentRecoveryPlan ?? null) &&
		input.entry.presenceStatus === "wakeable"
	) {
		return `Connected to ${formatControllerDeviceLocation(input.entry) ?? controllerLocation}`;
	}
	return `Local setup preference: ${formatControllerDeviceLocation(input.entry) ?? controllerLocation}`;
}

function formatPublicAgentControlDetail(
	entry: SpaceMemberDirectoryEntry,
	controllerLocation: string
): string {
	const ownerLabel = entry.ownerDisplay
		? ` · Owned by ${entry.ownerDisplay}`
		: "";
	return `Controlled by ${controllerLocation}${ownerLabel}`;
}

function resolveMemberTransientPrimaryDetail(
	memberTransientState: SpaceWakeStatusTransientState | null
): string | null {
	switch (memberTransientState) {
		case "active_wake_in_progress":
			return "This agent is working on a Wake in this Space.";
		case "active_wake_waiting_for_folder":
			return "This agent's task waits for another task on its computer that uses the same folder. It has not started.";
		case "active_wake_waiting_for_service":
			return "A Wake is waiting for the computer to reconnect.";
		case "checking":
			return "OpenMeld is checking this agent's local connection.";
		default:
			return null;
	}
}

function formatControllerLocation(
	entry: SpaceMemberDirectoryEntry
): string | null {
	if (!entry.controllerDisplayName) {
		return null;
	}

	return entry.runtimeDeviceDisplayName
		? `${entry.runtimeDeviceDisplayName} ${entry.controllerDisplayName}`
		: entry.controllerDisplayName;
}

function formatControllerDeviceLocation(
	entry: SpaceMemberDirectoryEntry
): string | null {
	return entry.runtimeDeviceDisplayName ?? null;
}

function shouldShowAgentRecoveryAction(
	plan: AgentProfileReplyRecoveryPlan | null
): plan is Exclude<AgentProfileReplyRecoveryPlan, { kind: "none" }> {
	return Boolean(plan && plan.kind !== "none");
}

function isOwnedByCurrentUser(input: {
	currentOwnerUserId: string | null;
	ownerUserId: string | null | undefined;
}): boolean {
	return isSameOwnerUserId(input);
}

import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
