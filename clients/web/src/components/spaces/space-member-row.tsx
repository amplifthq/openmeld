import type { AgentProfileReplyRecoveryPlan } from "@openmeld/agent-profile";
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
import type { StatusTone } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	DotsThreeIcon,
	InfoIcon,
	TrashIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME } from "#/components/app/app-nav-item-style";
import { AgentProfileListItem } from "#/components/profiles/profile-list-item";
import { buildOpenMeldServiceSettingsPath } from "#/lib/settings-routes";
import { resolveSpaceMemberStatusBadgeDisplay } from "#/lib/spaces/presentation";
import {
	isManualOnlyAgentRecoveryPlan,
	MANUAL_ONLY_AGENT_BADGE_LABEL,
} from "./space-agent-manual-participation";
import {
	type SpaceAgentProfileBindingRecoveryPlan,
	SpaceAgentRecoveryActionControl,
} from "./space-agent-recovery-action";
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
import { useSpaceProfileDetailsDialog } from "./use-space-profile-details-dialog";

type SpaceMemberRowProps = {
	agentRecoveryPlan: AgentProfileReplyRecoveryPlan | null;
	centerAgentProfileId?: string | null;
	currentOwnerUserId: string | null;
	currentProfileId: string;
	entry: SpaceMemberDirectoryEntry;
	isAgentWakeAvailabilityCheckPending: boolean;
	isAgentRecoveryPending: boolean;
	modelCatalog?: ModelCatalog | null;
	onAgentRecoveryAction: (
		plan: SpaceAgentProfileBindingRecoveryPlan
	) => Promise<void>;
	onCheckAgentWakeAvailability: (profileId: string) => Promise<void>;
	onEditAgentProfile?: (profileId: string) => void;
	onRemoveFromSpace?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	orgSlug: string;
	prepareSetupHref?: string;
	memberTransientState: SpaceWakeStatusTransientState | null;
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
	const manageableAgentRecoveryPlan = canManageAgentProfile
		? input.agentRecoveryPlan
		: null;
	const manageableMemberTransientState = canManageAgentProfile
		? input.memberTransientState
		: null;
	const rawDisplayedMemberTransientState = resolveDisplayedMemberTransientState(
		{
			entry: input.entry,
			manageableMemberTransientState,
		}
	);
	// Display-only Wake override: indicator + inline row visuals replay the last
	// Available snapshot (visualEntry), but every decision/diagnostic path keeps
	// reading the raw entry (input.entry) -- notably useSpaceProfileDetailsDialog,
	// the recovery plan, Check-again gating, controller/model detail, and sorting.
	const visualEntry = input.wakeDisplayEntry ?? input.entry;
	const visualDisplayedMemberTransientState = input.wakeDisplayEntry
		? null
		: rawDisplayedMemberTransientState;
	const displayedAgentRecoveryPlan =
		input.entry.presenceStatus === "wakeable" ||
		rawDisplayedMemberTransientState === "checking" ||
		input.entry.availabilityReasonCode === "agent_profile.organization_mismatch"
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
	const availabilityIndicatorIsRefreshing = resolvePresenceStatusIsRefreshing({
		entry: visualEntry,
		memberTransientState: visualDisplayedMemberTransientState,
	});
	const availabilityIndicatorHref =
		canManageAgentProfile && visualDisplayedMemberTransientState === null
			? resolvePresenceIndicatorHref({
					entry: visualEntry,
					orgSlug: input.orgSlug,
				})
			: undefined;
	const availabilityIndicator = availabilityIndicatorLabel ? (
		<SpaceAgentAvailabilityIndicator
			action={visualEntry.availabilityAction}
			category={visualEntry.availabilityCategory}
			href={availabilityIndicatorHref}
			isRefreshing={availabilityIndicatorIsRefreshing}
			label={availabilityIndicatorLabel}
			phase={visualEntry.availabilityPhase}
			reasonCode={visualEntry.availabilityReasonCode}
			tone={resolvePresenceIndicatorTone({
				agentRecoveryPlan: displayedAgentRecoveryPlan,
				entry: visualEntry,
				memberTransientState: visualDisplayedMemberTransientState,
			})}
			tooltip={availabilityIndicatorTooltip}
		/>
	) : null;
	const canCheckAgentWakeAvailability =
		canManageAgentProfile &&
		input.entry.availabilityReasonCode === "wake_route.registration_expired" &&
		rawDisplayedMemberTransientState === null;

	const primaryDetail =
		input.variant === "compact"
			? resolveCompactDetail(visualEntry, false)
			: resolvePrimaryDetail(
					visualEntry,
					false,
					displayedAgentRecoveryPlan,
					visualDisplayedMemberTransientState,
					canManageAgentProfile
				);
	const recoveryActionControl =
		input.variant === "full" &&
		shouldShowAgentRecoveryActionControl(displayedAgentRecoveryPlan) &&
		rawDisplayedMemberTransientState === null ? (
			<SpaceAgentRecoveryActionControl
				isPending={input.isAgentRecoveryPending}
				onAction={input.onAgentRecoveryAction}
				orgSlug={input.orgSlug}
				plan={displayedAgentRecoveryPlan}
				prepareSetupHref={input.prepareSetupHref}
			/>
		) : null;
	const detailsDialog = useSpaceProfileDetailsDialog({
		currentOwnerUserId: input.currentOwnerUserId,
		entry: input.entry,
		modelCatalog: input.modelCatalog ?? null,
	});
	const actions = renderSpaceMemberActions({
		onEditAgentProfile: resolveOwnedAgentProfileEditAction({
			canManageAgentProfile,
			onEditAgentProfile: input.onEditAgentProfile,
		}),
		onOpenProfileDetails: detailsDialog.openProfileDetails,
		onRemoveFromSpace: input.onRemoveFromSpace,
		profileId: input.entry.profileId,
		profileName: input.entry.profileName,
		variant: input.variant,
	});

	return (
		<>
			<AgentProfileListItem
				actions={actions}
				badges={
					<SpaceMemberBadges
						canCheckAgentWakeAvailability={canCheckAgentWakeAvailability}
						entry={visualEntry}
						isAgentWakeAvailabilityCheckPending={
							input.isAgentWakeAvailabilityCheckPending
						}
						isSelf={false}
						onCheckAgentWakeAvailability={input.onCheckAgentWakeAvailability}
						statusIsRefreshing={availabilityIndicatorIsRefreshing}
						statusLabel={null}
						statusTooltip={availabilityIndicatorTooltip}
						variant={input.variant}
					/>
				}
				className={cn("px-3 py-3", input.variant === "full" ? "sm:px-4" : null)}
				dimName={shouldDimProfileName({
					entry: input.entry,
					memberTransientState: visualDisplayedMemberTransientState,
				})}
				icon={
					<SpaceProfileIcon
						agentControllerRef={input.entry.agentControllerRef}
						avatarImageUrl={input.entry.avatarUrl}
						className="mt-0.5"
						isCenterAgent={input.entry.profileId === input.centerAgentProfileId}
						profileId={input.entry.profileId}
						profileKind={input.entry.profileKind}
						profileName={input.entry.profileName}
					/>
				}
				onProfileSummaryClick={detailsDialog.openProfileDetails}
				primaryDetail={primaryDetail}
				profileName={input.entry.profileName}
				profileNameAdornment={availabilityIndicator}
				profileNameClassName={SPACE_MEMBER_NAME_CLASS_NAME}
				profileSummaryAriaLabel={`About ${input.entry.profileName}`}
			>
				{recoveryActionControl}
			</AgentProfileListItem>
			{detailsDialog.profileDetailsDialog}
		</>
	);
}

function HumanSpaceMemberRow(input: HumanSpaceMemberRowProps) {
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
	const primaryDetail =
		input.variant === "compact"
			? resolveCompactDetail(input.entry, isSelf)
			: resolvePrimaryDetail(
					input.entry,
					isSelf,
					null,
					displayedMemberTransientState
				);
	const detailsDialog = useSpaceProfileDetailsDialog({
		currentOwnerUserId: input.currentOwnerUserId,
		entry: input.entry,
		modelCatalog: input.modelCatalog ?? null,
	});
	const actions = renderSpaceMemberActions({
		onRemoveFromSpace: input.onRemoveFromSpace,
		profileId: input.entry.profileId,
		profileName: input.entry.profileName,
		variant: input.variant,
	});

	return (
		<>
			<AgentProfileListItem
				actions={actions}
				badges={
					<SpaceMemberBadges
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
				className={cn("px-3 py-3", input.variant === "full" ? "sm:px-4" : null)}
				icon={
					<SpaceProfileIcon
						agentControllerRef={input.entry.agentControllerRef}
						avatarImageUrl={input.entry.avatarUrl}
						className="mt-0.5"
						profileId={input.entry.profileId}
						profileKind={input.entry.profileKind}
						profileName={input.entry.profileName}
					/>
				}
				onProfileSummaryClick={detailsDialog.openProfileDetails}
				primaryDetail={primaryDetail}
				profileName={input.entry.profileName}
				profileNameClassName={SPACE_MEMBER_NAME_CLASS_NAME}
				profileSummaryAriaLabel={`About ${input.entry.profileName}`}
			/>
			{detailsDialog.profileDetailsDialog}
		</>
	);
}

function SpaceMemberBadges(input: {
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
	onEditAgentProfile?: (profileId: string) => void;
	onOpenProfileDetails?: () => void;
	onRemoveFromSpace?: (profileId: string) => Promise<SpaceRemoveMemberResult>;
	profileId: string;
	profileName: string;
	variant: "compact" | "full";
}) {
	if (
		input.variant !== "full" ||
		!(
			input.onOpenProfileDetails ||
			input.onEditAgentProfile ||
			input.onRemoveFromSpace
		)
	) {
		return null;
	}
	return (
		<SpaceMemberActionsMenu
			onEditAgentProfile={input.onEditAgentProfile}
			onOpenProfileDetails={input.onOpenProfileDetails}
			onRemoveFromSpace={input.onRemoveFromSpace}
			profileId={input.profileId}
			profileName={input.profileName}
		/>
	);
}

function resolveOwnedAgentProfileEditAction(input: {
	canManageAgentProfile: boolean;
	onEditAgentProfile?: (profileId: string) => void;
}): ((profileId: string) => void) | undefined {
	if (!input.canManageAgentProfile) {
		return undefined;
	}
	return input.onEditAgentProfile;
}

function SpaceMemberActionsMenu(input: {
	onEditAgentProfile?: (profileId: string) => void;
	onOpenProfileDetails?: () => void;
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
					{input.onOpenProfileDetails ? (
						<DropdownMenuItem
							className="text-sm"
							onClick={input.onOpenProfileDetails}
						>
							<InfoIcon aria-hidden="true" />
							About profile
						</DropdownMenuItem>
					) : null}
					{input.onEditAgentProfile ? (
						<DropdownMenuItem
							className="text-sm"
							onClick={() => {
								input.onEditAgentProfile?.(input.profileId);
							}}
						>
							<WrenchIcon aria-hidden="true" />
							Edit Agent
						</DropdownMenuItem>
					) : null}
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

function isRouteReconnectRecoveryReasonCode(reasonCode: string): boolean {
	return (
		reasonCode === "agent_execution.route_missing" ||
		reasonCode === "agent_execution.route_offline" ||
		reasonCode === "agent_execution.route_unavailable" ||
		reasonCode === "route.not_registered" ||
		reasonCode === "route.offline" ||
		reasonCode === "route.unavailable"
	);
}

function resolvePresenceIndicatorTone(input: {
	agentRecoveryPlan: AgentProfileReplyRecoveryPlan | null;
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): StatusTone {
	if (input.entry.availabilityPhase === "provider_sign_in_needed") {
		return "warning";
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
	return entry.liveNow ? "Live human" : (entry.lastSeenLabel ?? "Human");
}

function resolvePrimaryDetail(
	entry: SpaceMemberDirectoryEntry,
	isSelf: boolean,
	agentRecoveryPlan?: AgentProfileReplyRecoveryPlan | null,
	memberTransientState: SpaceWakeStatusTransientState | null = null,
	canManageAgentProfile = false
): string {
	if (entry.profileKind === "agent") {
		return resolveAgentPrimaryDetail({
			agentRecoveryPlan,
			canManageAgentProfile,
			entry,
			memberTransientState,
		});
	}

	if (isSelf) {
		return entry.liveNow
			? "You are live in this space."
			: "You are in this space.";
	}

	return entry.liveNow ? "Live human" : (entry.lastSeenLabel ?? "Human");
}

function resolveAgentPrimaryDetail(input: {
	agentRecoveryPlan?: AgentProfileReplyRecoveryPlan | null;
	canManageAgentProfile: boolean;
	entry: SpaceMemberDirectoryEntry;
	memberTransientState: SpaceWakeStatusTransientState | null;
}): string {
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
		input.entry.presenceStatus !== "wakeable" &&
		input.entry.availabilitySummary
	) {
		return input.entry.availabilitySummary;
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
		case "active_wake_waiting_for_service":
			return "A Wake is waiting for OpenMeld Service to reconnect.";
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

function shouldShowAgentRecoveryActionControl(
	plan: AgentProfileReplyRecoveryPlan | null
): plan is Exclude<AgentProfileReplyRecoveryPlan, { kind: "none" }> {
	return (
		shouldShowAgentRecoveryAction(plan) &&
		!isRouteReconnectRecoveryReasonCode(plan.recoveryReasonCode)
	);
}

function isOwnedByCurrentUser(input: {
	currentOwnerUserId: string | null;
	ownerUserId: string | null | undefined;
}): boolean {
	return isSameOwnerUserId(input);
}
