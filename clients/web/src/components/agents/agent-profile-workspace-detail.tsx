"use client";

import { Popover } from "@base-ui/react/popover";
import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import {
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import type {
	AgentWakeAvailability,
	AuthProfileView,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { CardFooter } from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { FluidContextMenuScope } from "@openmeld/ui/fluid/context-menu";
import {
	resolveStatusToneBadgeClassName,
	resolveStatusToneIconClassName,
	resolveStatusToneTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowRightIcon,
	ChatCircleTextIcon,
	CheckCircleIcon,
	ClockCountdownIcon,
	DesktopTowerIcon,
	PencilSimpleIcon,
	ProhibitIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AgentAccessIndicator,
	assertNeverColleagueState,
	resolveAgentChatActionLabel,
	resolveColleagueRequestSpaceId,
	useOpenColleagueRequestSpace,
} from "#/components/agent-access/agent-access-indicator";
import { AgentProfileAccessOverview } from "#/components/agent-access/agent-access-sections";
import { AgentAvatarEditor } from "#/components/agents/agent-avatar-editor";
import type {
	AgentProfileActivityDestination,
	AgentProfileActivityNavigation,
} from "#/components/agents/agent-profile-activity-preview";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import { AgentProfileConversationsSection } from "#/components/directory/agent-conversations-section";
import {
	MemberAgentNewProfileButton,
	MemberAgentSensitiveChanges,
} from "#/components/member-agents/member-agent-page-context";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";
import {
	type AgentViewerAccess,
	formatPublicWakeabilityReason,
	useAgentViewerAccess,
	usePublicWakeabilityReason,
} from "#/lib/agents/agent-viewer-access";
import {
	type ColleagueAccess,
	useColleagueAccessState,
} from "#/lib/agents/colleague-access-state";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { updateAgentAvatar } from "#/lib/profiles/update-agent-avatar";
import { useAgentAvatarInvalidationScope } from "#/query/profiles/agent-avatar-context";
import {
	AgentTaskActivityTime,
	useAgentTaskActivity,
} from "./agent-task-activity";
import { formatAgentWakeAvailabilityCheckedAt } from "./agents-page-agent-profile-helpers";

export type AgentProfileOwnerIdentity = {
	name: string;
	avatarUrl: string | null | undefined;
	profileId: string;
};

function AgentProfileOwnerLine(input: {
	owner: AgentProfileOwnerIdentity;
	access: AgentViewerAccess | null;
	accessRemoved?: boolean;
}) {
	return (
		<p className="mt-1 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
			Owned by
			<DitherProfileAvatar
				avatarImageUrl={input.owner.avatarUrl}
				profileId={input.owner.profileId}
				profileKind="human"
				profileName={input.owner.name}
				size={16}
			/>
			<span className="truncate text-foreground">{input.owner.name}</span>
			{input.access ? (
				<>
					<span aria-hidden="true">·</span>
					<AgentAccessIndicator access={input.access} />
				</>
			) : null}
			{input.accessRemoved ? (
				<>
					<span aria-hidden="true">·</span>
					<span className="shrink-0" data-testid="agent-access-removed">
						Access removed
					</span>
				</>
			) : null}
		</p>
	);
}

/** What a colleague sees: their access and why the Agent can't work. */
function useColleagueAgentState(input: {
	availabilityCategory: string;
	isColleagueAgent: boolean;
	ownerName: string | undefined;
	ownerUserId: string | null | undefined;
	profileId: string;
}) {
	const access = useAgentViewerAccess({
		ownerName: input.ownerName,
		ownerUserId: input.ownerUserId,
		profileId: input.profileId,
	});
	const publicReason = usePublicWakeabilityReason({
		enabled: input.isColleagueAgent,
		profileId: input.profileId,
	});
	const reason = publicReason
		? formatPublicWakeabilityReason(publicReason)
		: null;
	// Offline Agents still take messages that wait for them; unavailable
	// ones can't, so a colleague isn't offered a chat that goes nowhere.
	const chatUnavailableReason =
		input.isColleagueAgent && input.availabilityCategory === "unavailable"
			? (reason ?? "This Agent is unavailable")
			: null;
	const colleagueAccess = useColleagueAccessState({
		ownerUserId: input.isColleagueAgent ? input.ownerUserId : null,
		profileId: input.profileId,
	});
	return { access, chatUnavailableReason, colleagueAccess, reason };
}

/**
 * The header's chat action. A colleague's Agent that asks its owner first
 * offers "Ask to use"; one that can't work right now is disabled with why.
 */
function AgentProfileChatAction(input: {
	access: AgentViewerAccess | null;
	isPending: boolean;
	colleagueAccess: ColleagueAccess | null;
	onOpen: () => void;
	profileName: string;
	unavailableReason: string | null;
}) {
	const openRequestSpace = useOpenColleagueRequestSpace();
	const asksOwner = input.access?.kind === "asks_owner";
	// The label depends on the request state; wait for it instead of flashing.
	if (asksOwner && input.colleagueAccess === null) {
		return null;
	}
	const requestSpaceId = resolveColleagueRequestSpaceId(input.colleagueAccess);
	const button = (
		<Button
			disabled={input.isPending || input.unavailableReason !== null}
			onClick={() =>
				requestSpaceId ? openRequestSpace(requestSpaceId) : input.onOpen()
			}
			size="sm"
			type="button"
			variant="default"
		>
			<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
			{resolveAgentChatActionLabel({
				access: input.access,
				colleagueAccess: input.colleagueAccess,
				profileName: input.profileName,
			})}
		</Button>
	);
	let tooltip: string | null = null;
	if (input.unavailableReason !== null) {
		tooltip = `Can’t start work right now: ${input.unavailableReason}.`;
	} else if (input.access?.kind === "asks_owner") {
		tooltip = resolveColleagueChatTooltip({
			ownerName: input.colleagueAccess?.ownerName ?? input.access.ownerName,
			state: input.colleagueAccess?.state,
		});
	}
	return tooltip ? (
		<TooltipHint content={tooltip}>
			<span className="inline-flex">{button}</span>
		</TooltipHint>
	) : (
		button
	);
}

function resolveColleagueChatTooltip(input: {
	ownerName: string;
	state: ColleagueAccess["state"] | undefined;
}): string | null {
	switch (input.state) {
		case undefined:
		case "none":
		case "draft":
			return `${input.ownerName} approves before it starts work for you.`;
		case "revoked":
			return `${input.ownerName} removed your access. Ask to use it again.`;
		case "waiting":
			return `${input.ownerName} hasn’t answered your request yet.`;
		case "declined":
			return `${input.ownerName} declined your request.`;
		case "approved_once":
		case "always_allowed":
		case "not_required":
			return null;
		default:
			return assertNeverColleagueState(input.state);
	}
}

export function AgentProfileWorkspaceDetail(input: {
	directMessageEnabled?: boolean;
	activityNavigation: AgentProfileActivityNavigation | null;
	agentControllerRef: string | null;
	canEdit: boolean;
	controllerModelSummary: string;
	modelId?: string | null;
	modelIsLoading?: boolean;
	configurationContent?: ReactNode;
	details: ProfileDetailsSnapshot;
	isDirectMessagePending: boolean;
	isRecoveryActionPending: boolean;
	operationalContext: AgentProfileOperationalContextInput | null;
	onOpenDirectMessage: () => void;
	onRenameProfile: (profileName: string) => Promise<void>;
	onAvatarUpdated?: (profile: AuthProfileView) => void;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	overflowActions: ReactNode;
	profile: AuthProfileView;
	supportingContent?: ReactNode;
	conversationViewerProfileId?: string | null;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityCheckedAt: string | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
	wakeAvailabilityIsRefreshing: boolean;
	wakeAvailabilityNowMs: number;
	headerRecoveryActions?: ReactNode;
	/** Shown under the name; identity, not a setting. */
	owner?: AgentProfileOwnerIdentity | null;
}) {
	const [savingAvatar, setSavingAvatar] = useState(false);
	const queryClient = useQueryClient();
	const avatarInvalidationScope = useAgentAvatarInvalidationScope();
	const taskActivity = useAgentTaskActivity(
		input.profile.openMeldProfileId,
		true
	);
	const displayedWakeAvailability = input.wakeAvailability;
	const showOwnerOperationalContext =
		input.details.viewerScope === "owner_self";
	const projectedRecoveryAction = input.details.sections.find(
		(section) => section.id === "activity"
	)?.recoveryAction;
	const availabilityCategory = resolveAgentWakeAvailabilityDisplayCategory(
		displayedWakeAvailability
	);
	const hasReducedProminence =
		availabilityCategory === "offline" ||
		availabilityCategory === "unavailable";
	const colleague = useColleagueAgentState({
		availabilityCategory,
		isColleagueAgent: !showOwnerOperationalContext,
		ownerName: input.owner?.name,
		ownerUserId: input.profile.ownerUserId,
		profileId: input.profile.openMeldProfileId,
	});
	const visibleActivityNavigation = showOwnerOperationalContext
		? (input.activityNavigation ?? taskActivity.navigation)
		: null;
	let operationalRecoveryAction: ReactNode = null;
	if (
		showOwnerOperationalContext &&
		projectedRecoveryAction &&
		input.onRecoveryAction
	) {
		operationalRecoveryAction = (
			<ProfileDetailsRecoveryActionButton
				compact={isInterruptedWorkRecoveryActionKind(
					projectedRecoveryAction.kind
				)}
				isPending={input.isRecoveryActionPending}
				onRecoveryAction={input.onRecoveryAction}
				recoveryAction={projectedRecoveryAction}
			/>
		);
	}
	return (
		<div
			className="@container/agent-detail mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
			data-testid="agent-profile-workspace-detail"
		>
			<FluidContextMenuScope
				target={
					<div className="flex min-w-0 @[42rem]/agent-detail:flex-row flex-col @[42rem]/agent-detail:items-end gap-4">
						<div className="flex min-w-0 flex-1 items-start gap-4">
							{input.agentControllerRef ===
							HOSTED_REMOTE_AGENT_CONTROLLER_REF ? (
								<AgentAvatarEditor
									avatarStyle={input.profile.avatarStyle}
									canEdit={input.canEdit}
									centerAgent={false}
									modelId={input.modelId}
									onSave={async (avatarStyle) => {
										if (
											avatarStyle !== "automatic" &&
											avatarStyle !== "fluid"
										) {
											return;
										}
										setSavingAvatar(true);
										try {
											const updated = await updateAgentAvatar(
												{
													profileId: input.profile.openMeldProfileId,
													avatarStyle,
												},
												queryClient,
												avatarInvalidationScope
											);
											input.onAvatarUpdated?.(updated);
											toast.success("Avatar updated.");
										} catch (error) {
											toast.error("Unable to save avatar. Try again.");
											throw error;
										} finally {
											setSavingAvatar(false);
										}
									}}
									profileId={input.profile.openMeldProfileId}
									profileName={input.profile.profileName}
									saving={savingAvatar}
									size={96}
								/>
							) : (
								<AgentProfileControllerAvatar
									agentControllerRef={input.agentControllerRef}
									avatarStyle={input.profile.avatarStyle}
									className={cn(
										"shrink-0",
										hasReducedProminence ? "opacity-55 grayscale" : null
									)}
									profileId={input.profile.openMeldProfileId}
									profileName={input.profile.profileName}
									size={96}
									working={input.operationalContext?.status === "working"}
								/>
							)}
							<div className="flex @[42rem]/agent-detail:min-h-24 min-w-0 flex-1 flex-col pt-1">
								<div className="flex min-w-0 items-center gap-2">
									<AgentProfileNameEditor
										adornment={
											<RemoteAgentIndicator
												agentControllerRef={input.agentControllerRef}
											/>
										}
										canEdit={input.canEdit}
										hasReducedProminence={hasReducedProminence}
										onRenameProfile={input.onRenameProfile}
										profileName={input.profile.profileName}
									/>
								</div>
								{input.modelIsLoading ? (
									<Skeleton
										aria-label="Loading model"
										className="mt-2 h-4 w-40 rounded-sm"
									/>
								) : (
									<p className="mt-1 break-words text-muted-foreground text-sm">
										{input.controllerModelSummary}
									</p>
								)}
								{input.owner ? (
									<AgentProfileOwnerLine
										access={colleague.access}
										accessRemoved={
											colleague.colleagueAccess?.state === "revoked"
										}
										owner={input.owner}
									/>
								) : null}
								<AgentProfilePresence
									headerRecoveryActions={
										showOwnerOperationalContext
											? input.headerRecoveryActions
											: null
									}
									publicReason={colleague.reason}
									wakeAvailability={displayedWakeAvailability}
									wakeAvailabilityCheckedAt={input.wakeAvailabilityCheckedAt}
									wakeAvailabilityErrorMessage={
										input.wakeAvailabilityErrorMessage
									}
									wakeAvailabilityIsPending={input.wakeAvailabilityIsPending}
									wakeAvailabilityIsRefreshing={
										input.wakeAvailabilityIsRefreshing
									}
									wakeAvailabilityNowMs={input.wakeAvailabilityNowMs}
								/>
							</div>
						</div>
						<div className="flex @[42rem]/agent-detail:h-24 max-w-full shrink-0 flex-col items-end gap-2 @[42rem]/agent-detail:self-start self-end">
							<div className="@[42rem]/agent-detail:mt-auto flex max-w-full flex-wrap items-end justify-end gap-2">
								{input.directMessageEnabled !== false && (
									<AgentProfileChatAction
										access={colleague.access}
										colleagueAccess={colleague.colleagueAccess}
										isPending={input.isDirectMessagePending}
										onOpen={input.onOpenDirectMessage}
										profileName={input.profile.profileName}
										unavailableReason={colleague.chatUnavailableReason}
									/>
								)}
								<MemberAgentNewProfileButton />
								{input.overflowActions}
							</div>
						</div>
					</div>
				}
			/>
			<AgentProfileCurrentActivity
				activityNavigation={visibleActivityNavigation}
				isLoading={
					taskActivity.enabled &&
					taskActivity.isPending &&
					!input.operationalContext
				}
				isUnavailable={
					taskActivity.enabled &&
					taskActivity.isError &&
					!input.operationalContext
				}
				lastTaskActivityAt={taskActivity.activity?.lastTaskActivityAt}
				operationalContext={input.operationalContext}
				recoveryAction={operationalRecoveryAction}
				recoveryActionKind={projectedRecoveryAction?.kind ?? null}
				workload={taskActivity.activity?.workload}
			/>
			{input.configurationContent}
			{input.supportingContent ? (
				<div className="max-w-3xl">{input.supportingContent}</div>
			) : null}
			{showOwnerOperationalContext && input.conversationViewerProfileId ? (
				<AgentProfileConversationsSection
					agent={{
						id: input.profile.openMeldProfileId,
						name: input.profile.profileName,
						agentControllerRef: input.agentControllerRef,
					}}
					key={input.profile.openMeldProfileId}
					viewerProfileId={input.conversationViewerProfileId}
				/>
			) : null}
			<AgentProfileAccessOverview
				isOwner={showOwnerOperationalContext}
				ownerUserId={input.profile.ownerUserId}
				profileId={input.profile.openMeldProfileId}
				profileName={input.profile.profileName}
			>
				<MemberAgentSensitiveChanges />
			</AgentProfileAccessOverview>
		</div>
	);
}

type AgentProfilePresenceStatus =
	| "available"
	| "checking"
	| "offline"
	| "unknown"
	| "unavailable";

function AgentProfilePresence(input: {
	headerRecoveryActions: ReactNode;
	/** A colleague's view of why the Agent can't work. */
	publicReason?: string | null;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityCheckedAt: string | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
	wakeAvailabilityIsRefreshing: boolean;
	wakeAvailabilityNowMs: number;
}) {
	if (input.wakeAvailabilityIsPending && !input.wakeAvailability) {
		return (
			<SkeletonRegion className="mt-3" label="Loading Agent availability">
				<Skeleton className="h-5 w-36" />
			</SkeletonRegion>
		);
	}
	const presentation = resolveAgentProfilePresence(input);
	const checkedAt = input.wakeAvailability
		? formatAgentWakeAvailabilityCheckedAt(
				input.wakeAvailabilityCheckedAt,
				input.wakeAvailabilityNowMs
			)
		: null;
	const presenceIcon = (
		<span
			className={cn(
				"inline-flex size-5 shrink-0 items-center justify-center",
				presentation.textClassName
			)}
		>
			<AgentProfilePresenceIcon status={presentation.status} />
		</span>
	);
	const presenceLabel = (
		<span
			className={cn(
				"font-medium text-sm leading-5",
				presentation.textClassName
			)}
			role={
				input.wakeAvailabilityErrorMessage && !input.wakeAvailability
					? "alert"
					: undefined
			}
		>
			{presentation.label}
			{input.wakeAvailabilityErrorMessage && !input.wakeAvailability ? (
				<span className="sr-only"> {input.wakeAvailabilityErrorMessage}</span>
			) : null}
		</span>
	);
	return (
		<TooltipHint content={presentation.tooltip}>
			<div
				aria-live="polite"
				className="@[42rem]/agent-detail:mt-auto mt-3 flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
				data-agent-presence-status={presentation.status}
				data-testid="agent-profile-presence"
			>
				{presenceIcon}
				{presenceLabel}
				{checkedAt ? (
					<span className="text-muted-foreground text-xs leading-5">
						· {checkedAt}
					</span>
				) : null}
				{input.wakeAvailability && input.wakeAvailabilityIsRefreshing ? (
					<span className="text-muted-foreground text-xs leading-5">
						Refreshing…
					</span>
				) : null}
				{presentation.reason ? (
					<span className="text-muted-foreground text-xs leading-5">
						{presentation.reason}
					</span>
				) : null}
				{input.headerRecoveryActions ? (
					<div
						className="flex max-w-full flex-wrap items-center gap-2"
						data-testid="agent-profile-header-recovery-actions"
					>
						{input.headerRecoveryActions}
					</div>
				) : null}
				{input.wakeAvailabilityErrorMessage && input.wakeAvailability ? (
					<span className="text-muted-foreground text-xs" role="alert">
						Couldn’t refresh availability.
						<span className="sr-only">
							{" "}
							{input.wakeAvailabilityErrorMessage}
						</span>
					</span>
				) : null}
			</div>
		</TooltipHint>
	);
}

function resolveAgentProfilePresence(input: {
	headerRecoveryActions: ReactNode;
	publicReason?: string | null;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityCheckedAt: string | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
	wakeAvailabilityIsRefreshing: boolean;
	wakeAvailabilityNowMs: number;
}): {
	label: string;
	reason: string | null;
	status: AgentProfilePresenceStatus;
	textClassName: string;
	tooltip: string;
} {
	if (input.wakeAvailabilityErrorMessage && !input.wakeAvailability) {
		return {
			label: "Couldn’t check availability.",
			reason: null,
			status: "unknown",
			textClassName: resolveStatusToneTextClassName("muted"),
			tooltip: input.wakeAvailabilityErrorMessage,
		};
	}
	if (input.wakeAvailabilityIsPending || !input.wakeAvailability) {
		return {
			label: "Checking…",
			reason: null,
			status: "checking",
			textClassName: resolveStatusToneTextClassName("checking"),
			tooltip: "Checking whether this Agent is available for Wake.",
		};
	}
	const availabilityCategory = resolveAgentWakeAvailabilityDisplayCategory(
		input.wakeAvailability
	);
	if (availabilityCategory === "checking") {
		return {
			label: input.wakeAvailability.label,
			reason: null,
			status: "checking",
			textClassName: resolveStatusToneTextClassName("checking"),
			tooltip: input.wakeAvailability.summary,
		};
	}
	if (availabilityCategory === "available") {
		return {
			label: input.wakeAvailability.badgeLabel,
			reason: null,
			status: "available",
			textClassName: resolveStatusToneTextClassName("ready"),
			tooltip: input.wakeAvailability.tooltip,
		};
	}
	return {
		label: input.wakeAvailability.badgeLabel,
		reason:
			input.publicReason ??
			resolveUnavailableWakeReason(input.wakeAvailability),
		status: availabilityCategory,
		textClassName: resolveStatusToneTextClassName("muted"),
		tooltip: input.wakeAvailability.tooltip,
	};
}

function resolveUnavailableWakeReason(
	wakeAvailability: AgentWakeAvailability
): string | null {
	const summary = wakeAvailability.summary.trim();
	if (
		summary.length === 0 ||
		summary.toLowerCase() === "unavailable for wake" ||
		summary.toLowerCase() === "this agent is unavailable for wake."
	) {
		return null;
	}
	return summary;
}

function AgentProfilePresenceIcon(input: {
	status: AgentProfilePresenceStatus;
}) {
	if (input.status === "available") {
		return (
			<CheckCircleIcon aria-hidden="true" className="size-5" weight="fill" />
		);
	}
	if (input.status === "unavailable" || input.status === "offline") {
		return <ProhibitIcon aria-hidden="true" className="size-5" />;
	}
	return <ClockCountdownIcon aria-hidden="true" className="size-5" />;
}

function AgentProfileCurrentActivity(input: {
	workload?: import("@openmeld/schemas/types").AgentWorkloadSnapshot;
	isLoading?: boolean;
	isUnavailable?: boolean;
	activityNavigation: AgentProfileActivityNavigation | null;
	lastTaskActivityAt?: string | null;
	operationalContext: AgentProfileOperationalContextInput | null;
	recoveryAction: ReactNode;
	recoveryActionKind: ProfileDetailsRecoveryAction["kind"] | null;
}) {
	if (input.workload) {
		return (
			<AgentProfileWorkload
				activityNavigation={input.activityNavigation}
				lastTaskActivityAt={input.lastTaskActivityAt}
				operationalContext={input.operationalContext}
				recoveryAction={input.recoveryAction}
				recoveryActionKind={input.recoveryActionKind}
				workload={input.workload}
			/>
		);
	}
	if (input.isLoading || input.isUnavailable) {
		return (
			<section className="space-y-3">
				<h2 className="font-medium text-sm">Current activity</h2>
				{input.isLoading ? (
					<SkeletonRegion label="Loading Agent activity">
						<Skeleton className="h-4 w-48" />
					</SkeletonRegion>
				) : (
					<p className="text-muted-foreground text-sm">
						Current activity unavailable.
					</p>
				)}
			</section>
		);
	}
	const currentDestination = input.activityNavigation?.current ?? null;
	const queuedDestinations = input.activityNavigation?.queued ?? [];
	const { footerRecoveryAction, interruptedRecoveryAction } =
		resolveActivityRecoveryActions(input);
	const hasActivityDestinations =
		currentDestination !== null || queuedDestinations.length > 0;
	const neutralActivitySummary =
		hasActivityDestinations || interruptedRecoveryAction
			? null
			: resolveNeutralActivitySummary(input.operationalContext);
	if (
		!(
			hasActivityDestinations ||
			interruptedRecoveryAction ||
			footerRecoveryAction ||
			neutralActivitySummary ||
			input.lastTaskActivityAt
		)
	) {
		return null;
	}
	let activityContent: ReactNode = null;
	if (hasActivityDestinations || interruptedRecoveryAction) {
		activityContent = (
			<div className="min-w-0">
				<ActivityDestinationsPanel
					currentDestination={currentDestination}
					currentWorkLocation={
						input.operationalContext?.currentWorkLocation ?? null
					}
					interruptedRecoveryAction={interruptedRecoveryAction}
					isWorking={input.operationalContext?.status === "working"}
					queuedDestinations={queuedDestinations}
				/>
			</div>
		);
	} else if (neutralActivitySummary) {
		activityContent = <p className="text-sm">{neutralActivitySummary}</p>;
	}
	return (
		<section
			aria-labelledby="agent-current-activity-heading"
			className="grid min-w-0 gap-3"
		>
			<div className="grid gap-1">
				<h2 className="font-medium text-sm" id="agent-current-activity-heading">
					Current activity
				</h2>
			</div>
			<div className="grid gap-2" data-testid="agent-current-activity">
				{activityContent}
				<AgentTaskActivityTime timestamp={input.lastTaskActivityAt} />
				{footerRecoveryAction ? (
					<CardFooter className="flex-col items-start gap-3 border-border/70">
						{footerRecoveryAction}
					</CardFooter>
				) : null}
			</div>
		</section>
	);
}

function AgentProfileWorkload(input: {
	workload: import("@openmeld/schemas/types").AgentWorkloadSnapshot;
	recoveryAction: ReactNode;
	recoveryActionKind: ProfileDetailsRecoveryAction["kind"] | null;
	activityNavigation: AgentProfileActivityNavigation | null;
	operationalContext: AgentProfileOperationalContextInput | null;
	lastTaskActivityAt?: string | null;
}) {
	const organization = useOptionalAppOrganization();
	const workload = input.workload;
	const { footerRecoveryAction, interruptedRecoveryAction } =
		resolveActivityRecoveryActions(input);
	const recoveryContext = interruptedRecoveryAction ? (
		<ActivityDestinationsPanel
			currentDestination={input.activityNavigation?.current ?? null}
			currentWorkLocation={
				input.operationalContext?.currentWorkLocation ?? null
			}
			interruptedRecoveryAction={interruptedRecoveryAction}
			isWorking={false}
			queuedDestinations={[]}
		/>
	) : null;
	if (workload.status !== "ready") {
		return (
			<section className="grid gap-2">
				<h2 className="font-medium text-sm">Current activity</h2>
				<p className="text-muted-foreground text-sm">
					Current activity unavailable. Try refreshing.
				</p>
				{recoveryContext}
				{footerRecoveryAction}
			</section>
		);
	}
	const queued = workload.waitingCount + workload.queuedMessageCount;
	const hiddenCount =
		workload.activeCount +
		queued +
		workload.pausedMessageCount -
		workload.items.length;
	const summary =
		[
			...(workload.activeCount ? [`${workload.activeCount} active`] : []),
			...(queued ? [`${queued} queued`] : []),
			...(workload.pausedMessageCount
				? [`${workload.pausedMessageCount} paused`]
				: []),
		].join(" · ") ||
		resolveNeutralActivitySummary(input.operationalContext) ||
		"No current work";
	return (
		<section aria-label="Current activity" className="grid min-w-0 gap-3">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<h2 className="font-medium text-sm">Current activity</h2>
				<span className="text-muted-foreground text-sm">{summary}</span>
			</div>
			{recoveryContext}
			{organization && workload.items.length > 0 ? (
				<FluidCardGroup className="grid min-w-0 gap-2" role="list">
					{workload.items.map((item) => (
						<FluidCardItem
							className="border border-border/70"
							itemId={item.id}
							key={item.id}
							role="listitem"
						>
							<ActivityDestinationLink
								destination={{
									href: buildOrganizationSpacePath({
										orgSlug: organization.currentOrganization.slug,
										spaceId: item.location.spaceId,
									}),
									source: "space",
									title: item.text || item.location.spaceName,
								}}
								sourceLabel={item.location.spaceName}
								state={
									(
										{
											active: "working",
											waiting: "queued",
											queued_message: "queued",
											paused_message: "paused",
										} as const
									)[item.kind]
								}
								trailingAction={null}
							/>
						</FluidCardItem>
					))}
				</FluidCardGroup>
			) : null}
			{hiddenCount > 0 ? (
				<p className="text-muted-foreground text-xs">
					{hiddenCount === 1
						? "1 item is in a conversation you can't access."
						: `${hiddenCount} items are in conversations you can't access.`}
				</p>
			) : null}
			{footerRecoveryAction}
			<AgentTaskActivityTime timestamp={input.lastTaskActivityAt} />
		</section>
	);
}

// Both of these decide the fate of the interrupted Wake itself, so they belong
// beside it rather than in the card footer that starts queued work.
function isInterruptedWorkRecoveryActionKind(
	kind: ProfileDetailsRecoveryAction["kind"]
): boolean {
	return kind === "skip_interrupted_work" || kind === "fork_interrupted_work";
}

function resolveActivityRecoveryActions(input: {
	recoveryAction: ReactNode;
	recoveryActionKind: ProfileDetailsRecoveryAction["kind"] | null;
}): {
	footerRecoveryAction: ReactNode;
	interruptedRecoveryAction: ReactNode;
} {
	if (
		input.recoveryActionKind &&
		isInterruptedWorkRecoveryActionKind(input.recoveryActionKind)
	) {
		return {
			footerRecoveryAction: null,
			interruptedRecoveryAction: input.recoveryAction,
		};
	}
	return {
		footerRecoveryAction: input.recoveryAction,
		interruptedRecoveryAction: null,
	};
}

function resolveNeutralActivitySummary(
	operationalContext: AgentProfileOperationalContextInput | null
): string | null {
	if (!operationalContext) {
		return null;
	}
	if (
		operationalContext.status === "checking" ||
		operationalContext.status === "idle"
	) {
		return null;
	}
	const waitingSuffix =
		operationalContext.waitingCount > 0
			? ` · ${operationalContext.waitingCount} queued`
			: "";
	return operationalContext.status === "working"
		? `Active task${waitingSuffix}`
		: `Waiting to continue${waitingSuffix}`;
}

function ActivityDestinationsPanel(input: {
	currentDestination: AgentProfileActivityDestination | null;
	currentWorkLocation: string | null;
	interruptedRecoveryAction: ReactNode;
	isWorking: boolean;
	queuedDestinations: readonly AgentProfileActivityDestination[];
}) {
	const entries: ActivityDestinationEntry[] = [];
	if (input.currentDestination) {
		let currentState: ActivityDestinationState = "current";
		if (input.interruptedRecoveryAction) {
			currentState = "interrupted";
		} else if (input.isWorking) {
			currentState = "working";
		}
		entries.push({
			destination: input.currentDestination,
			kind: "destination",
			state: currentState,
			trailingAction: input.interruptedRecoveryAction,
		});
	} else if (input.interruptedRecoveryAction) {
		entries.push({
			kind: "interrupted_fallback",
			recoveryAction: input.interruptedRecoveryAction,
			title: input.currentWorkLocation,
		});
	}
	entries.push(
		...input.queuedDestinations.map(
			(destination): ActivityDestinationEntry => ({
				destination,
				kind: "destination",
				state: "up_next",
				trailingAction: null,
			})
		)
	);
	let gridColumnsClassName =
		"grid-cols-1 @[36rem]/agent-detail:grid-cols-2 @[54rem]/agent-detail:grid-cols-3";
	if (entries.length === 1) {
		gridColumnsClassName = "grid-cols-1";
	} else if (entries.length === 2) {
		gridColumnsClassName = "grid-cols-1 @[36rem]/agent-detail:grid-cols-2";
	}
	return (
		<FluidCardGroup
			aria-label="Current activity"
			className={cn("grid min-w-0 gap-2", gridColumnsClassName)}
			role="list"
		>
			{entries.map((entry) => {
				if (entry.kind === "interrupted_fallback") {
					return (
						<InterruptedWorkFallbackItem
							key="interrupted-work"
							recoveryAction={entry.recoveryAction}
							title={entry.title}
						/>
					);
				}
				const isInterrupted = entry.state === "interrupted";
				return (
					<FluidCardItem
						className={cn(
							"border",
							isInterrupted
								? "border-amber-700/35 dark:border-amber-500/35"
								: "border-border/70"
						)}
						data-testid={
							isInterrupted ? "agent-current-interrupted-work" : undefined
						}
						itemId={`${entry.destination.source}:${entry.destination.href}:${entry.destination.title}`}
						key={`${entry.destination.source}:${entry.destination.href}:${entry.destination.title}`}
						role="listitem"
					>
						<ActivityDestinationLink
							destination={entry.destination}
							state={entry.state}
							trailingAction={entry.trailingAction}
						/>
					</FluidCardItem>
				);
			})}
		</FluidCardGroup>
	);
}

type ActivityDestinationState =
	| "queued"
	| "paused"
	| "current"
	| "interrupted"
	| "up_next"
	| "working";

type ActivityDestinationEntry =
	| {
			destination: AgentProfileActivityDestination;
			kind: "destination";
			state: ActivityDestinationState;
			trailingAction: ReactNode;
	  }
	| {
			kind: "interrupted_fallback";
			recoveryAction: ReactNode;
			title: string | null;
	  };

function ActivityDestinationLink(input: {
	sourceLabel?: string;
	destination: AgentProfileActivityDestination;
	state: ActivityDestinationState;
	trailingAction: ReactNode;
}) {
	const sourceLabel =
		input.sourceLabel ??
		input.destination.computerName ??
		resolveActivitySourceLabel(input.destination.source);
	const isInterrupted = input.state === "interrupted";
	let icon = <DesktopTowerIcon aria-hidden="true" className="size-4" />;
	if (
		input.destination.source === "space" ||
		input.destination.source === "direct_message"
	) {
		icon = <ChatCircleTextIcon aria-hidden="true" className="size-4" />;
	}
	return (
		<div className="flex min-w-0 items-center">
			<Link
				aria-label={resolveActivityDestinationAriaLabel(input.destination)}
				className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md bg-transparent px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
				to={input.destination.href}
			>
				<span className="shrink-0 text-muted-foreground">{icon}</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-sm">
						{input.destination.title}
						{input.destination.conversationId ? (
							<span className="text-muted-foreground">
								{" · "}
								{input.destination.conversationId}
							</span>
						) : null}
					</span>
					<span className="mt-0.5 flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
						<span>{sourceLabel}</span>
					</span>
				</span>
				<Badge
					className={resolveActivityDestinationStateBadgeClassName(input.state)}
					variant={isInterrupted ? "outline" : "secondary"}
				>
					{resolveActivityDestinationStateLabel(input.state)}
				</Badge>
				<ArrowRightIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
				/>
			</Link>
			{input.trailingAction ? (
				<div className="shrink-0 pe-3">{input.trailingAction}</div>
			) : null}
		</div>
	);
}

function resolveActivityDestinationStateLabel(
	state: ActivityDestinationState
): string {
	if (state === "queued") {
		return "Queued";
	}
	if (state === "paused") {
		return "Paused";
	}
	if (state === "working") {
		return "Active task";
	}
	if (state === "up_next") {
		return "Up next";
	}
	if (state === "interrupted") {
		return "Needs attention";
	}
	return "Current";
}

function resolveActivityDestinationStateBadgeClassName(
	state: ActivityDestinationState
): string {
	if (state === "interrupted") {
		return resolveStatusToneBadgeClassName("warning");
	}
	if (state === "working" || state === "current") {
		return "text-primary";
	}
	return "text-muted-foreground";
}

function resolveActivityDestinationAriaLabel(
	destination: AgentProfileActivityDestination
): string {
	return `Open ${resolveActivitySourceLabel(destination.source)}: ${destination.title}`;
}

function InterruptedWorkFallbackItem(input: {
	recoveryAction: ReactNode;
	title: string | null;
}) {
	return (
		<FluidCardItem
			className="border border-amber-700/35 dark:border-amber-500/35"
			data-testid="agent-current-interrupted-work"
			itemId="interrupted-work"
			role="listitem"
		>
			<div className="flex min-h-14 min-w-0 items-center gap-3 px-3 py-2.5">
				<WarningCircleIcon
					aria-hidden="true"
					className={cn(
						"size-4 shrink-0",
						resolveStatusToneIconClassName("warning")
					)}
					weight="fill"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-sm">
						{input.title ?? "Current work"}
					</span>
				</span>
				<Badge
					className={resolveStatusToneBadgeClassName("warning")}
					variant="outline"
				>
					Needs attention
				</Badge>
				<div className="shrink-0">{input.recoveryAction}</div>
			</div>
		</FluidCardItem>
	);
}

function resolveActivitySourceLabel(
	source: AgentProfileActivityDestination["source"]
): string {
	if (source === "space") {
		return "Space";
	}
	if (source === "direct_message") {
		return "Direct Message";
	}
	return "Computer";
}

function AgentProfileNameEditor(input: {
	adornment?: ReactNode;
	canEdit: boolean;
	hasReducedProminence: boolean;
	onRenameProfile: (profileName: string) => Promise<void>;
	profileName: string;
}) {
	const canEdit = input.canEdit;
	const [open, setOpen] = useState(false);
	const [draftName, setDraftName] = useState(input.profileName);
	const [isSaving, setIsSaving] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	useEffect(() => {
		if (!open) {
			setDraftName(input.profileName);
		}
	}, [input.profileName, open]);
	const normalizedName = draftName.trim();
	const saveDisabled =
		isSaving ||
		normalizedName.length === 0 ||
		normalizedName === input.profileName;
	const heading = (
		<h1
			className={cn(
				"select-text break-words font-semibold text-xl leading-7",
				input.hasReducedProminence ? "text-muted-foreground" : null
			)}
		>
			{input.profileName}
		</h1>
	);
	if (!canEdit) {
		return (
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-1.5">
					{heading}
					{input.adornment}
				</div>
			</div>
		);
	}
	return (
		<Popover.Root
			onOpenChange={(nextOpen) => {
				if (!isSaving) {
					setErrorMessage(null);
					setOpen(nextOpen);
				}
			}}
			open={open}
		>
			<div className="group/name flex min-w-0 items-center gap-1.5">
				{heading}
				{input.adornment}
				<Popover.Trigger
					render={
						<Button
							aria-label="Edit Name"
							size="icon-sm"
							type="button"
							variant="ghost"
						/>
					}
				>
					<PencilSimpleIcon aria-hidden="true" />
				</Popover.Trigger>
			</div>
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						className="w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-border/75 bg-popover p-4 text-popover-foreground shadow-xl outline-none"
						finalFocus={false}
					>
						<label className="font-medium text-sm" htmlFor="agent-profile-name">
							Name
						</label>
						<Input
							autoFocus
							className="mt-2"
							disabled={isSaving}
							id="agent-profile-name"
							onChange={(event) => setDraftName(event.target.value)}
							value={draftName}
						/>
						{errorMessage ? (
							<p className="mt-2 text-destructive text-xs" role="alert">
								{errorMessage}
							</p>
						) : null}
						<div className="mt-4 flex justify-end gap-2 border-border/70 border-t pt-3">
							<Button
								disabled={isSaving}
								onClick={() => setOpen(false)}
								size="sm"
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={saveDisabled}
								onClick={() => {
									setIsSaving(true);
									setErrorMessage(null);
									input
										.onRenameProfile(normalizedName)
										.then(() => setOpen(false))
										.catch((error: unknown) => {
											setErrorMessage(
												error instanceof Error
													? error.message
													: "OpenMeld couldn’t rename this Agent."
											);
										})
										.finally(() => setIsSaving(false));
								}}
								size="sm"
								type="button"
							>
								{isSaving ? "Saving…" : "Save changes"}
							</Button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
