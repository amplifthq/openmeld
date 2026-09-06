"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import {
	parseAgentControllerRef,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { ThinkingIcon } from "@openmeld/ui/components/thinking-indicator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleIcon, StarIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { AgentProfileOperationalStatusIndicator } from "#/components/agents/agent-profile-operational-status";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import {
	localAgentSidebarState,
	useAgentSidebarPreviewReady,
} from "#/lib/dev/agent-sidebar-fixtures";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import type { useSortableSidebarItem } from "../app/sidebar-drag";
import { SidebarRowAction } from "../app/sidebar-row-action";

export const AgentProfileSidebarItem = memo(AgentProfileSidebarItemComponent);

export function AgentProfileSidebarItemComponent(input: {
	agentControllerRef: string | null;
	currentUserId: string;
	index: number;
	isActive: boolean;
	modelCatalog: ModelCatalog | null;
	onSelectProfile: (profileId: string) => void;
	operationalContext: AgentProfileOperationalContextInput | null;
	profile: AuthProfileView;
	readiness: GetAgentExecutionReadinessResponse | null;
	readinessErrorMessage: string | null;
	readinessIsPending: boolean;
	drag?: ReturnType<typeof useSortableSidebarItem>;
	starred?: boolean;
	actionsDisabled?: boolean;
	onToggleStar?: () => void;
	onChat?: () => void;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const agentControllerRef = resolveAgentProfileControllerRef(
		input.readiness,
		input.agentControllerRef
	);
	const presentation = resolveAgentProfileSidebarPresentation({
		agentControllerRef,
		errorMessage: input.readinessErrorMessage,
		isPending: input.readinessIsPending,
		modelCatalog: input.modelCatalog,
		readiness: input.readiness,
	});
	const previewReady = useAgentSidebarPreviewReady();
	const preview = localAgentSidebarState(
		input.profile.openMeldProfileId,
		previewReady
	);
	if (preview) {
		presentation.availabilityCategory =
			preview === "connect" ? "unavailable" : preview;
		presentation.availabilityAccessibilityLabel =
			preview === "connect"
				? "Connect"
				: preview[0].toUpperCase() + preview.slice(1);
		presentation.availabilityTooltip = `${presentation.availabilityAccessibilityLabel}. Local preview: simulated status.`;
		presentation.availabilityClassName =
			preview === "connect"
				? resolveStatusToneTextClassName("warning")
				: resolveAvailabilityClassName(presentation.availabilityCategory);
	}
	const isOwner = input.profile.ownerUserId === input.currentUserId;
	const hasReducedProminence =
		presentation.availabilityCategory === "offline" ||
		presentation.availabilityCategory === "unavailable";
	const profileNameClassName = cn(
		"min-w-0 truncate font-medium text-[13px]",
		hasReducedProminence ? "text-muted-foreground" : null
	);
	const availabilityDescriptionId = `agent-profile-availability-${input.profile.openMeldProfileId}`;
	return (
		<FluidNavMenuItem
			className="group/agent-row relative"
			index={input.index}
			ref={input.drag?.ref}
			style={input.drag?.style}
			value={input.profile.openMeldProfileId}
		>
			<button
				{...input.drag?.rowProps}
				aria-current={input.isActive ? "page" : undefined}
				aria-describedby={availabilityDescriptionId}
				aria-label={`Open ${input.profile.profileName}`}
				className={cn(
					"flex w-full min-w-0 items-start gap-2 px-2 py-1.5 text-left outline-none",
					APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
					APP_NAV_ITEM_TONE_CLASS_NAME,
					input.isActive ? "text-sidebar-accent-foreground" : null
				)}
				data-profile-id={input.profile.openMeldProfileId}
				onClick={() => {
					input.onSelectProfile(input.profile.openMeldProfileId);
					dismiss();
				}}
				type="button"
			>
				<AgentProfileControllerAvatar
					agentControllerRef={agentControllerRef}
					className={cn(
						"shrink-0",
						hasReducedProminence ? "opacity-55 grayscale" : null
					)}
					profileId={input.profile.openMeldProfileId}
					size={24}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className={profileNameClassName}>
							{input.profile.profileName}
						</span>
						<Tooltip>
							<TooltipTrigger
								render={
									<span
										aria-label={presentation.availabilityAccessibilityLabel}
										className={cn(
											"inline-flex shrink-0 items-center",
											presentation.availabilityClassName
										)}
										id={availabilityDescriptionId}
										role="img"
									/>
								}
							>
								{presentation.availabilityCategory === "checking" ? (
									<ThinkingIcon className="size-4" />
								) : (
									<span
										aria-hidden="true"
										className="size-1.5 rounded-full bg-current"
									/>
								)}
							</TooltipTrigger>
							<TooltipContent>
								{presentation.availabilityTooltip}
							</TooltipContent>
						</Tooltip>
						<AgentProfileOperationalStatusIndicator
							className="shrink-0"
							operationalContext={input.operationalContext}
						/>
					</span>
					{isOwner ? (
						<span className="truncate text-muted-foreground text-xs">
							{presentation.controllerModelSummary}
						</span>
					) : null}
				</span>
			</button>
			{(input.onToggleStar || input.onChat) && (
				<span className="absolute top-1 right-1 flex translate-x-1 rounded-md bg-sidebar opacity-0 transition-[opacity,translate] duration-150 ease-out group-focus-within/agent-row:translate-x-0 group-focus-within/agent-row:opacity-100 group-focus-within/agent-row:transition-none group-hover/agent-row:translate-x-0 group-hover/agent-row:opacity-100 motion-reduce:translate-x-0 motion-reduce:transition-none [@media(hover:none)]:translate-x-0 [@media(hover:none)]:opacity-100">
					{input.onChat && (
						<SidebarRowAction
							label={`Chat with ${input.profile.profileName}`}
							onClick={input.onChat}
						>
							<ChatCircleIcon />
						</SidebarRowAction>
					)}
					{input.onToggleStar && (
						<SidebarRowAction
							disabled={input.actionsDisabled}
							label={`${input.starred ? "Unstar" : "Star"} ${input.profile.profileName}`}
							onClick={input.onToggleStar}
						>
							<StarIcon weight={input.starred ? "fill" : "regular"} />
						</SidebarRowAction>
					)}
				</span>
			)}
		</FluidNavMenuItem>
	);
}

function resolveAgentProfileSidebarPresentation(input: {
	agentControllerRef: string | null;
	errorMessage: string | null;
	isPending: boolean;
	modelCatalog: ModelCatalog | null;
	readiness: GetAgentExecutionReadinessResponse | null;
}): {
	availabilityAccessibilityLabel: string;
	availabilityCategory: ReturnType<
		typeof resolveAgentWakeAvailabilityDisplayCategory
	> | null;
	availabilityClassName: string;
	availabilityLabel: string;
	availabilityTooltip: string;
	controllerModelSummary: string;
} {
	const parsedControllerRef = parseAgentControllerRef(input.agentControllerRef);
	const controllerName = parsedControllerRef
		? formatLocalAgentDisplayName(parsedControllerRef.id)
		: "No Controller connected";
	const controllerModelSummary =
		resolveAgentProfileControllerModelDetail({
			agentControllerRef: input.agentControllerRef,
			controllerDisplayName: controllerName,
			modelCatalog: input.modelCatalog,
			modelSelection:
				input.readiness?.primaryBinding?.modelSelection ??
				input.readiness?.publicProfileConfiguration?.modelSelection ??
				null,
		}) ?? controllerName;
	const wakeAvailability = input.readiness?.agentWakeAvailability ?? null;
	if (!wakeAvailability) {
		const availability = resolveMissingSidebarAvailability(input);
		return {
			availabilityAccessibilityLabel: availability.label,
			availabilityCategory: availability.category,
			availabilityClassName: availability.className,
			availabilityLabel: availability.label,
			availabilityTooltip: availability.tooltip,
			controllerModelSummary,
		};
	}
	const category =
		resolveAgentWakeAvailabilityDisplayCategory(wakeAvailability);
	return {
		availabilityAccessibilityLabel: input.errorMessage
			? `${wakeAvailability.badgeLabel}. Latest availability refresh was delayed.`
			: wakeAvailability.badgeLabel,
		availabilityCategory: category,
		availabilityClassName:
			wakeAvailability.phase === "connect_local_agent"
				? resolveStatusToneTextClassName("warning")
				: resolveAvailabilityClassName(category),
		availabilityLabel: resolveSidebarAvailabilityLabel(wakeAvailability),
		availabilityTooltip: wakeAvailability.tooltip,
		controllerModelSummary,
	};
}

function resolveSidebarAvailabilityLabel(
	wakeAvailability: NonNullable<
		GetAgentExecutionReadinessResponse["agentWakeAvailability"]
	>
): string {
	const category =
		resolveAgentWakeAvailabilityDisplayCategory(wakeAvailability);
	if (category === "available") {
		return "Available";
	}
	if (wakeAvailability.phase === "connect_local_agent") {
		return "Connect";
	}
	return category === "checking" ? "" : "Unavailable";
}

function resolveAgentProfileControllerRef(
	readiness: GetAgentExecutionReadinessResponse | null,
	fallbackAgentControllerRef: string | null = null
): string | null {
	return (
		readiness?.primaryBinding?.executionTarget?.agentControllerRef ??
		readiness?.publicProfileConfiguration?.agentControllerRef ??
		readiness?.agentControllerRef ??
		fallbackAgentControllerRef
	);
}

function resolveMissingSidebarAvailability(input: {
	errorMessage: string | null;
	isPending: boolean;
}) {
	if (input.errorMessage) {
		return {
			category: null,
			className: resolveStatusToneTextClassName("muted"),
			label: "Couldn’t check availability.",
			tooltip: input.errorMessage,
		};
	}
	if (input.isPending) {
		return {
			category: "checking" as const,
			className: resolveStatusToneTextClassName("checking"),
			label: "Checking",
			tooltip: "Checking Wake availability",
		};
	}
	return {
		category: null,
		className: "text-muted-foreground",
		label: "Not checked",
		tooltip: "Wake availability has not been checked yet",
	};
}

function resolveAvailabilityClassName(
	category: ReturnType<typeof resolveAgentWakeAvailabilityDisplayCategory>
): string {
	switch (category) {
		case "available":
			return resolveStatusToneTextClassName("ready");
		case "checking":
			return resolveStatusToneTextClassName("checking");
		case "unavailable":
			return resolveStatusToneTextClassName("muted");
		case "offline":
			return resolveStatusToneTextClassName("muted");
		default:
			return "text-muted-foreground";
	}
}
