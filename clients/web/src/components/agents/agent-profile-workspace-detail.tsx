"use client";

import { Popover } from "@base-ui/react/popover";
import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import { resolveAgentWakeAvailabilityDisplayCategory } from "@openmeld/agent-runtime";
import type {
	AgentWakeAvailability,
	AuthProfileView,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Card, CardContent, CardFooter } from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
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
	HashIcon,
	PencilSimpleIcon,
	ProhibitIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";
import type {
	AgentProfileActivityDestination,
	AgentProfileActivityNavigation,
} from "#/components/agents/agent-profile-activity-preview";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { TextShimmer } from "#/components/motion-primitives/text-shimmer";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";
import { SpaceAgentOrb } from "#/components/spaces/space-agent-orb";

export function AgentProfileWorkspaceDetail(input: {
	activityNavigation: AgentProfileActivityNavigation | null;
	agentControllerRef: string | null;
	canEdit: boolean;
	controllerModelSummary: string;
	configurationContent?: ReactNode;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	isDirectMessagePending: boolean;
	isRecoveryActionPending: boolean;
	operationalContext: AgentProfileOperationalContextInput | null;
	onOpenDirectMessage: () => void;
	onRenameProfile: (profileName: string) => Promise<void>;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	overflowActions: ReactNode;
	profile: AuthProfileView;
	supportingContent?: ReactNode;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
	wakeAvailabilityRecoveryActions?: ReactNode;
}) {
	const displayedWakeAvailability = input.wakeAvailabilityErrorMessage
		? null
		: input.wakeAvailability;
	const showOwnerOperationalContext =
		input.details.viewerScope === "owner_self";
	const projectedRecoveryAction = input.details.sections.find(
		(section) => section.id === "activity"
	)?.recoveryAction;
	let availabilityCategory = resolveAgentWakeAvailabilityDisplayCategory(
		displayedWakeAvailability
	);
	if (!displayedWakeAvailability && input.wakeAvailabilityErrorMessage) {
		availabilityCategory = "unavailable";
	}
	const hasReducedProminence =
		availabilityCategory === "offline" ||
		availabilityCategory === "unavailable";
	const visibleActivityNavigation = showOwnerOperationalContext
		? input.activityNavigation
		: null;
	const currentActivityDestination = resolveCurrentActivityDestination({
		activityNavigation: visibleActivityNavigation,
		currentSession: input.currentSession,
	});
	let operationalRecoveryAction: ReactNode = null;
	if (
		showOwnerOperationalContext &&
		projectedRecoveryAction &&
		input.onRecoveryAction
	) {
		operationalRecoveryAction = (
			<ProfileDetailsRecoveryActionButton
				compact={projectedRecoveryAction.kind === "skip_interrupted_work"}
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
			<div className="flex min-w-0 @[42rem]/agent-detail:flex-row flex-col @[42rem]/agent-detail:items-end gap-4">
				<div className="flex min-w-0 flex-1 items-start gap-4">
					<AgentProfileControllerAvatar
						agentControllerRef={input.agentControllerRef}
						className={cn(
							"shrink-0",
							hasReducedProminence ? "opacity-55 grayscale" : null
						)}
						profileId={input.profile.openMeldProfileId}
						size={96}
					/>
					<div className="flex @[42rem]/agent-detail:h-24 min-w-0 flex-1 flex-col pt-1">
						<AgentProfileNameEditor
							canEdit={input.canEdit}
							hasReducedProminence={hasReducedProminence}
							onRenameProfile={input.onRenameProfile}
							profileName={input.profile.profileName}
						/>
						<p className="mt-1 break-words text-muted-foreground text-sm">
							{input.controllerModelSummary}
						</p>
						<AgentProfilePresence
							currentDestination={currentActivityDestination}
							operationalContext={input.operationalContext}
							wakeAvailability={displayedWakeAvailability}
							wakeAvailabilityErrorMessage={input.wakeAvailabilityErrorMessage}
							wakeAvailabilityIsPending={input.wakeAvailabilityIsPending}
							wakeAvailabilityRecoveryActions={
								showOwnerOperationalContext
									? input.wakeAvailabilityRecoveryActions
									: null
							}
						/>
					</div>
				</div>
				<div className="flex max-w-full shrink-0 flex-wrap items-end gap-2 self-end">
					<Button
						disabled={input.isDirectMessagePending}
						onClick={input.onOpenDirectMessage}
						size="sm"
						type="button"
						variant="default"
					>
						<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
						Direct Message
					</Button>
					{input.overflowActions}
				</div>
			</div>
			<AgentProfileCurrentActivity
				activityNavigation={visibleActivityNavigation}
				currentSession={input.currentSession}
				operationalContext={input.operationalContext}
				recoveryAction={operationalRecoveryAction}
				recoveryActionKind={projectedRecoveryAction?.kind ?? null}
			/>
			{input.configurationContent}
			{input.supportingContent ? (
				<div className="max-w-3xl">{input.supportingContent}</div>
			) : null}
		</div>
	);
}

type AgentProfilePresenceStatus =
	| "available"
	| "checking"
	| "needs_attention"
	| "unavailable"
	| "waiting"
	| "working";

function AgentProfilePresence(input: {
	currentDestination: AgentProfileActivityDestination | null;
	operationalContext: AgentProfileOperationalContextInput | null;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
	wakeAvailabilityRecoveryActions?: ReactNode;
}) {
	const presentation = resolveAgentProfilePresence(input);
	const waitingWork = formatWaitingWork({
		operationalContext: input.operationalContext,
	});
	const linkableDestination =
		presentation.status === "working" ||
		presentation.status === "needs_attention" ||
		presentation.status === "waiting"
			? input.currentDestination
			: null;
	const interactiveLabelClassName = linkableDestination
		? "underline-offset-4 group-hover/presence:underline group-focus-visible/presence:underline"
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
	const presenceLabel = presentation.shimmer ? (
		<TextShimmer
			as="span"
			className={cn(
				"font-medium text-sm leading-5",
				presentation.textClassName,
				presentation.status === "working"
					? null
					: "[--base-color:var(--color-sky-700)] [--base-gradient-color:var(--color-sky-300)] dark:[--base-color:var(--color-sky-300)] dark:[--base-gradient-color:var(--color-sky-100)]",
				interactiveLabelClassName
			)}
			duration={1.8}
		>
			{presentation.label}
		</TextShimmer>
	) : (
		<span
			className={cn(
				"font-medium text-sm leading-5",
				presentation.textClassName,
				interactiveLabelClassName
			)}
		>
			{presentation.label}
		</span>
	);
	const presenceStatus = linkableDestination ? (
		<a
			aria-label={resolveActivityDestinationAriaLabel(linkableDestination)}
			className="group/presence inline-flex min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
			href={linkableDestination.href}
		>
			{presenceIcon}
			{presenceLabel}
		</a>
	) : (
		<>
			{presenceIcon}
			{presenceLabel}
		</>
	);
	return (
		<div
			aria-live="polite"
			className="@[42rem]/agent-detail:mt-auto mt-3 flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
			data-agent-presence-status={presentation.status}
			data-testid="agent-profile-presence"
			title={presentation.tooltip}
		>
			{presenceStatus}
			{waitingWork ? (
				<span
					className={cn(
						"rounded-full border px-2 py-0.5 font-medium text-xs",
						resolveStatusToneBadgeClassName("muted")
					)}
				>
					{waitingWork.countLabel}
				</span>
			) : null}
			{input.wakeAvailabilityErrorMessage ? (
				<span className="text-muted-foreground text-xs" role="alert">
					Couldn’t check availability.
					<span className="sr-only"> {input.wakeAvailabilityErrorMessage}</span>
				</span>
			) : null}
			{input.wakeAvailabilityRecoveryActions}
		</div>
	);
}

function resolveAgentProfilePresence(input: {
	currentDestination: AgentProfileActivityDestination | null;
	operationalContext: AgentProfileOperationalContextInput | null;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
}): {
	label: string;
	shimmer: boolean;
	status: AgentProfilePresenceStatus;
	textClassName: string;
	tooltip: string;
} {
	const operationalContext = input.operationalContext;
	if (operationalContext?.status === "checking") {
		return {
			label: "Checking activity",
			shimmer: true,
			status: "checking",
			textClassName: resolveStatusToneTextClassName("checking"),
			tooltip: "Checking this Agent’s latest activity and Wake availability.",
		};
	}
	if (operationalContext?.status === "working") {
		const currentWorkLocation = input.currentDestination?.title ?? null;
		return {
			label: currentWorkLocation
				? `Working in ${currentWorkLocation}`
				: "Working",
			shimmer: true,
			status: "working",
			textClassName: "text-foreground",
			tooltip: currentWorkLocation
				? `Working in ${currentWorkLocation}`
				: "This Agent is working now.",
		};
	}
	if (
		operationalContext?.status === "paused" &&
		operationalContext.recoveryAction
	) {
		return {
			label: "Needs attention",
			shimmer: false,
			status: "needs_attention",
			textClassName: resolveStatusToneIconClassName("warning"),
			tooltip: "Work is paused and needs your attention.",
		};
	}
	if (operationalContext?.status === "paused") {
		return {
			label: "Waiting to continue",
			shimmer: true,
			status: "waiting",
			textClassName: resolveStatusToneTextClassName("checking"),
			tooltip: "The current work will continue when this Agent is ready.",
		};
	}
	if (input.wakeAvailabilityErrorMessage) {
		return {
			label: "Unavailable for Wake",
			shimmer: false,
			status: "unavailable",
			textClassName: resolveStatusToneTextClassName("muted"),
			tooltip: input.wakeAvailabilityErrorMessage,
		};
	}
	if (input.wakeAvailabilityIsPending || !input.wakeAvailability) {
		return {
			label: "Checking availability",
			shimmer: true,
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
			shimmer: true,
			status: "checking",
			textClassName: resolveStatusToneTextClassName("checking"),
			tooltip: input.wakeAvailability.summary,
		};
	}
	if (availabilityCategory === "available") {
		return {
			label: "Available for Wake",
			shimmer: false,
			status: "available",
			textClassName: resolveStatusToneTextClassName("ready"),
			tooltip: input.wakeAvailability.tooltip,
		};
	}
	return {
		label: "Unavailable for Wake",
		shimmer: false,
		status: "unavailable",
		textClassName: resolveStatusToneTextClassName("muted"),
		tooltip: input.wakeAvailability.tooltip,
	};
}

function AgentProfilePresenceIcon(input: {
	status: AgentProfilePresenceStatus;
}) {
	if (input.status === "working") {
		return <SpaceAgentOrb data-testid="agent-profile-presence-orb" />;
	}
	if (input.status === "available") {
		return (
			<CheckCircleIcon aria-hidden="true" className="size-5" weight="fill" />
		);
	}
	if (input.status === "needs_attention") {
		return (
			<WarningCircleIcon aria-hidden="true" className="size-5" weight="fill" />
		);
	}
	if (input.status === "unavailable") {
		return <ProhibitIcon aria-hidden="true" className="size-5" />;
	}
	return <ClockCountdownIcon aria-hidden="true" className="size-5" />;
}

function AgentProfileCurrentActivity(input: {
	activityNavigation: AgentProfileActivityNavigation | null;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	operationalContext: AgentProfileOperationalContextInput | null;
	recoveryAction: ReactNode;
	recoveryActionKind: ProfileDetailsRecoveryAction["kind"] | null;
}) {
	const currentDestination = resolveCurrentActivityDestination(input);
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
			neutralActivitySummary
		)
	) {
		return null;
	}
	let activityContent: ReactNode = null;
	if (hasActivityDestinations || interruptedRecoveryAction) {
		activityContent = (
			<CardContent className="min-w-0 py-4">
				<ActivityDestinationsPanel
					currentDestination={currentDestination}
					currentWorkLocation={
						input.operationalContext?.currentWorkLocation ?? null
					}
					interruptedRecoveryAction={interruptedRecoveryAction}
					isWorking={input.operationalContext?.status === "working"}
					queuedDestinations={queuedDestinations}
				/>
			</CardContent>
		);
	} else if (neutralActivitySummary) {
		activityContent = (
			<CardContent className="min-w-0 py-4">
				<FluidCardGroup aria-label="Current activity" role="list">
					<FluidCardItem
						className="border border-border/70"
						itemId="activity-summary"
						role="listitem"
					>
						<div className="flex min-w-0 items-center gap-3 px-4 py-3">
							<DesktopTowerIcon
								aria-hidden="true"
								className="size-5 shrink-0 text-muted-foreground"
							/>
							<span className="truncate font-medium text-sm">
								{neutralActivitySummary}
							</span>
						</div>
					</FluidCardItem>
				</FluidCardGroup>
			</CardContent>
		);
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
			<Card
				className="gap-0 overflow-hidden py-0"
				data-testid="agent-current-activity"
			>
				{activityContent}
				{footerRecoveryAction ? (
					<CardFooter className="flex-col items-start gap-3 border-border/70">
						{footerRecoveryAction}
					</CardFooter>
				) : null}
			</Card>
		</section>
	);
}

function resolveActivityRecoveryActions(input: {
	recoveryAction: ReactNode;
	recoveryActionKind: ProfileDetailsRecoveryAction["kind"] | null;
}): {
	footerRecoveryAction: ReactNode;
	interruptedRecoveryAction: ReactNode;
} {
	if (input.recoveryActionKind === "skip_interrupted_work") {
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
	if (operationalContext.status === "checking") {
		return "Checking activity";
	}
	if (operationalContext.status === "idle") {
		return "No current work";
	}
	const waitingSuffix =
		operationalContext.waitingCount > 0
			? ` · ${operationalContext.waitingCount} queued`
			: "";
	return operationalContext.status === "working"
		? `Working${waitingSuffix}`
		: `Waiting to continue${waitingSuffix}`;
}

function resolveCurrentActivityDestination(input: {
	activityNavigation: AgentProfileActivityNavigation | null;
	currentSession?: { href: string; title: string };
}): AgentProfileActivityDestination | null {
	if (input.activityNavigation?.current) {
		return input.activityNavigation.current;
	}
	return input.currentSession
		? {
				href: input.currentSession.href,
				source: "computer",
				title: input.currentSession.title,
			}
		: null;
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
	destination: AgentProfileActivityDestination;
	state: ActivityDestinationState;
	trailingAction: ReactNode;
}) {
	const sourceLabel = resolveActivitySourceLabel(input.destination.source);
	const isInterrupted = input.state === "interrupted";
	let icon = <DesktopTowerIcon aria-hidden="true" className="size-4" />;
	if (input.destination.source === "space") {
		icon = <HashIcon aria-hidden="true" className="size-4" />;
	} else if (input.destination.source === "direct_message") {
		icon = <ChatCircleTextIcon aria-hidden="true" className="size-4" />;
	}
	return (
		<div className="flex min-w-0 items-center">
			<a
				aria-label={resolveActivityDestinationAriaLabel(input.destination)}
				className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md bg-transparent px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
				href={input.destination.href}
			>
				<span className="shrink-0 text-muted-foreground">{icon}</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-sm">
						{input.destination.title}
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
			</a>
			{input.trailingAction ? (
				<div className="shrink-0 pe-3">{input.trailingAction}</div>
			) : null}
		</div>
	);
}

function resolveActivityDestinationStateLabel(
	state: ActivityDestinationState
): string {
	if (state === "working") {
		return "Working";
	}
	if (state === "up_next") {
		return "Up next";
	}
	if (state === "interrupted") {
		return "Needs attention";
	}
	return "Next work";
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

function formatWaitingWork(input: {
	operationalContext: AgentProfileOperationalContextInput | null;
}): { countLabel: string } | null {
	const waitingCount = input.operationalContext?.waitingCount ?? 0;
	if (waitingCount < 1) {
		return null;
	}
	return { countLabel: `${waitingCount} queued` };
}

function AgentProfileNameEditor(input: {
	canEdit: boolean;
	hasReducedProminence: boolean;
	onRenameProfile: (profileName: string) => Promise<void>;
	profileName: string;
}) {
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
	if (!input.canEdit) {
		return heading;
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
