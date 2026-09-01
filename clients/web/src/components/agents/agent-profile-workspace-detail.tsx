"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import { resolveAgentWakeAvailabilityDisplayCategory } from "@openmeld/agent-runtime";
import type {
	AgentWakeAvailability,
	AuthProfileView,
	ProfileDetailsRecoveryAction,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { AgentProfileOperationalStatusText } from "#/components/agents/agent-profile-operational-status";
import { ProfileDetailsContent } from "#/components/profiles/profile-details-dialog";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";

const AGENT_OPERATIONAL_CONTEXT_SECTION_IDS = [
	"activity",
	"wake_availability",
] as const;

export function AgentProfileWorkspaceDetail(input: {
	canEdit: boolean;
	agentControllerRef: string | null;
	controllerModelSummary: string;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	editContent: ReactNode;
	editDisabled: boolean;
	editing: boolean;
	isDirectMessagePending: boolean;
	isRecoveryActionPending: boolean;
	operationalContext: AgentProfileOperationalContextInput | null;
	onEdit: () => void;
	onOpenDirectMessage: () => void;
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
	const fallbackAvailability = resolveFallbackWakeAvailability({
		wakeAvailability: displayedWakeAvailability,
		wakeAvailabilityErrorMessage: input.wakeAvailabilityErrorMessage,
		wakeAvailabilityIsPending: input.wakeAvailabilityIsPending,
	});
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
	return (
		<div
			className="@container/agent-detail mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
			data-testid="agent-profile-workspace-detail"
		>
			<div className="flex min-w-0 @[42rem]/agent-detail:flex-row flex-col @[42rem]/agent-detail:items-start gap-4">
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
					<div className="min-w-0 flex-1 pt-1">
						<h1
							className={cn(
								"select-text break-words font-semibold text-xl leading-7",
								hasReducedProminence ? "text-muted-foreground" : null
							)}
						>
							{input.profile.profileName}
						</h1>
						<p className="mt-1 break-words text-muted-foreground text-sm">
							{input.controllerModelSummary}
						</p>
					</div>
				</div>
				<div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 self-end">
					<Button
						disabled={input.isDirectMessagePending}
						onClick={input.onOpenDirectMessage}
						size="sm"
						type="button"
						variant="outline"
					>
						<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
						Direct Message
					</Button>
					{input.editing || !input.canEdit ? null : (
						<Button
							disabled={input.editDisabled}
							onClick={input.onEdit}
							size="sm"
							type="button"
							variant="outline"
						>
							<PencilSimpleIcon aria-hidden="true" data-icon="inline-start" />
							Edit Agent
						</Button>
					)}
					{input.overflowActions}
				</div>
			</div>
			{showOwnerOperationalContext ? (
				<AgentProfileOperationalContextPanel
					fallbackAvailability={fallbackAvailability}
					isRecoveryActionPending={input.isRecoveryActionPending}
					onRecoveryAction={input.onRecoveryAction}
					operationalContext={input.operationalContext}
					projectedRecoveryAction={projectedRecoveryAction ?? null}
					wakeAvailability={displayedWakeAvailability}
					wakeAvailabilityRecoveryActions={
						input.wakeAvailabilityRecoveryActions
					}
				/>
			) : null}
			{input.supportingContent ? (
				<div className="max-w-3xl">{input.supportingContent}</div>
			) : null}

			{input.editing ? (
				input.editContent
			) : (
				<ProfileDetailsContent
					collapseAgentTechnicalDetails={showOwnerOperationalContext}
					currentSession={input.currentSession}
					details={input.details}
					excludedSectionIds={
						showOwnerOperationalContext
							? AGENT_OPERATIONAL_CONTEXT_SECTION_IDS
							: undefined
					}
					isRecoveryActionPending={input.isRecoveryActionPending}
					onRecoveryAction={input.onRecoveryAction}
					showSummary={false}
				/>
			)}
		</div>
	);
}

function AgentProfileOperationalContextPanel(input: {
	fallbackAvailability: ReturnType<typeof resolveFallbackWakeAvailability>;
	isRecoveryActionPending: boolean;
	onRecoveryAction?: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	operationalContext: AgentProfileOperationalContextInput | null;
	projectedRecoveryAction: ProfileDetailsRecoveryAction | null;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityRecoveryActions?: ReactNode;
}) {
	let recoveryAction: ReactNode = null;
	if (input.projectedRecoveryAction && input.onRecoveryAction) {
		recoveryAction = (
			<ProfileDetailsRecoveryActionButton
				isPending={input.isRecoveryActionPending}
				onRecoveryAction={input.onRecoveryAction}
				recoveryAction={input.projectedRecoveryAction}
			/>
		);
	} else if (input.wakeAvailabilityRecoveryActions) {
		recoveryAction = input.wakeAvailabilityRecoveryActions;
	}
	return (
		<section
			aria-labelledby="agent-operational-context-heading"
			className="min-w-0"
		>
			<h2
				className="font-medium text-muted-foreground text-xs"
				id="agent-operational-context-heading"
			>
				Operational context
			</h2>
			<div className="mt-2 grid min-w-0 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
				<OperationalContextFact label="Work">
					<AgentProfileOperationalStatusText
						className="text-sm"
						operationalContext={input.operationalContext}
					/>
					<AgentProfileWorkLocations
						operationalContext={input.operationalContext}
					/>
				</OperationalContextFact>
				<OperationalContextFact label="Wakeability">
					<WakeabilityValue
						fallbackAvailability={input.fallbackAvailability}
						wakeAvailability={input.wakeAvailability}
					/>
				</OperationalContextFact>
				<OperationalContextFact
					description="This Controller has not reported reliable Usage."
					label="Usage"
				>
					<span data-reported="false">Not reported</span>
				</OperationalContextFact>
				<OperationalContextFact
					description="No confirmed timing has been reported for saved settings."
					label="Settings timing"
				>
					<span data-reported="false">Not reported</span>
				</OperationalContextFact>
			</div>
			{input.fallbackAvailability.diagnostic ? (
				<p
					className="mt-2 max-w-2xl text-muted-foreground text-sm"
					role={
						input.fallbackAvailability.label === "Unavailable"
							? "alert"
							: undefined
					}
				>
					{input.fallbackAvailability.diagnostic}
				</p>
			) : null}
			{recoveryAction ? <div className="mt-3">{recoveryAction}</div> : null}
		</section>
	);
}

function OperationalContextFact(input: {
	children: ReactNode;
	description?: string;
	label: string;
}) {
	return (
		<div className="min-w-0 bg-background px-3 py-3">
			<p className="text-muted-foreground text-xs">{input.label}</p>
			<div className="mt-1 break-words font-medium text-sm">
				{input.children}
			</div>
			{input.description ? (
				<p className="mt-1 text-muted-foreground text-xs leading-5">
					{input.description}
				</p>
			) : null}
		</div>
	);
}

function AgentProfileWorkLocations(input: {
	operationalContext: AgentProfileOperationalContextInput | null;
}) {
	const operationalContext = input.operationalContext;
	if (!operationalContext) {
		return null;
	}
	return (
		<div className="mt-1 space-y-1 font-normal text-muted-foreground text-xs leading-5">
			{operationalContext.currentWorkLocation ? (
				<p className="break-words">
					Current: {operationalContext.currentWorkLocation}
				</p>
			) : null}
			{operationalContext.queuedWorkLocations.length > 0 ? (
				<details className="group/work-queue">
					<summary className="min-h-6 cursor-pointer list-none rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
						{operationalContext.queuedWorkLocations.length} queued
					</summary>
					<ol className="mt-1 list-decimal space-y-1 pl-4">
						{operationalContext.queuedWorkLocations.map((location) => (
							<li className="break-words" key={location}>
								{location}
							</li>
						))}
					</ol>
				</details>
			) : null}
		</div>
	);
}

function WakeabilityValue(input: {
	fallbackAvailability: ReturnType<typeof resolveFallbackWakeAvailability>;
	wakeAvailability: AgentWakeAvailability | null;
}) {
	const label =
		input.wakeAvailability?.badgeLabel ?? input.fallbackAvailability.label;
	const tooltip =
		input.wakeAvailability?.tooltip ?? input.fallbackAvailability.tooltip;
	const category = resolveAgentWakeAvailabilityDisplayCategory(
		input.wakeAvailability
	);
	let textClassName = input.wakeAvailability
		? "text-foreground"
		: input.fallbackAvailability.className;
	if (category === "offline" || category === "unavailable") {
		textClassName = "text-muted-foreground";
	}
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn("inline-flex min-w-0 text-sm", textClassName)}
						data-availability-action={
							input.wakeAvailability?.action ?? undefined
						}
						data-availability-phase={input.wakeAvailability?.phase ?? undefined}
						data-availability-reason-code={
							input.wakeAvailability?.reasonCode ?? undefined
						}
						title={tooltip}
					/>
				}
			>
				{label}
			</TooltipTrigger>
			<TooltipContent className="max-w-sm" side="top">
				{tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

function resolveFallbackWakeAvailability(input: {
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
}) {
	if (input.wakeAvailability) {
		return { className: "", diagnostic: null, label: "", tooltip: "" };
	}
	if (input.wakeAvailabilityErrorMessage) {
		return {
			className: resolveStatusToneTextClassName("muted"),
			diagnostic: input.wakeAvailabilityErrorMessage,
			label: "Unavailable",
			tooltip: "Status unavailable",
		};
	}
	if (input.wakeAvailabilityIsPending) {
		return {
			className: resolveStatusToneTextClassName("checking"),
			diagnostic: null,
			label: "Loading",
			tooltip: "Loading Wake availability",
		};
	}
	return {
		className: "text-muted-foreground",
		diagnostic: "OpenMeld has not checked this Agent on this computer yet.",
		label: "Not checked",
		tooltip: "Wake availability not checked yet",
	};
}
