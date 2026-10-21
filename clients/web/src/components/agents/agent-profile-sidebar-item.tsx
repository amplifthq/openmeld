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
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import { FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import {
	SidebarMenuActions,
	SidebarMenuButton,
} from "@openmeld/ui/fluid/sidebar-menu";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, StarIcon } from "@phosphor-icons/react";
import { memo } from "react";
import {
	AgentAccessIndicator,
	useColleagueAgentAccess,
} from "#/components/agent-access/agent-access-indicator";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { AgentProfileOperationalStatusIndicator } from "#/components/agents/agent-profile-operational-status";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { ProfileMenuItems } from "#/components/app/profile-menu-items";
import {
	AgentAvailabilityBadge,
	formatAgentWorkloadParts,
} from "#/components/member-agents/member-agent-directory-section";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { formatPublicWakeabilityReason } from "#/lib/agents/agent-viewer-access";
import {
	localAgentSidebarState,
	useAgentSidebarPreviewReady,
} from "#/lib/dev/agent-sidebar-fixtures";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import type { useSortableSidebarItem } from "../app/sidebar-drag";
import { SidebarRowAction } from "../app/sidebar-row-action";
import { AgentCard } from "./agent-card";
import { AgentGroupItem } from "./agent-group-context";

export const AgentProfileSidebarItem = memo(AgentProfileSidebarItemComponent);

export function AgentProfileSidebarItemComponent(input: {
	selection?: import("./agent-list-selection").AgentCardSelection;
	variant?: "sidebar" | "card";
	avatarSize?: number;
	agentControllerRef: string | null;
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
	/** Running and queued work the viewer may see, for the card variant. */
	workload?: { runningCount: number | null; queuedCount: number | null };
}) {
	const { dismiss } = useAppNavigationPresentation();
	const { currentOrganization } = useAppOrganization();
	const menu = (
		<ProfileMenuItems
			disabled={input.actionsDisabled}
			href={`${buildOrganizationAgentsPath(currentOrganization.slug)}?profileId=${encodeURIComponent(input.profile.openMeldProfileId)}`}
			onChat={input.onChat}
			onOpen={() => {
				input.onSelectProfile(input.profile.openMeldProfileId);
				dismiss();
			}}
			onToggleStar={input.onToggleStar}
			starred={input.starred}
		/>
	);
	const agentControllerRef = resolveAgentProfileControllerRef(
		input.readiness,
		input.agentControllerRef
	);
	const avatarModelId = resolveSidebarAvatarModelId(
		input.readiness,
		input.modelCatalog
	);
	const presentation = resolveAgentProfileSidebarPresentation({
		agentControllerRef,
		errorMessage: input.readinessErrorMessage,
		isPending: input.readinessIsPending,
		modelCatalog: input.modelCatalog,
		readiness: input.readiness,
	});
	const colleagueAccess = useColleagueAgentAccess({
		ownerUserId: input.profile.ownerUserId,
		profileId: input.profile.openMeldProfileId,
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
	const hasReducedProminence =
		presentation.availabilityCategory === "offline" ||
		presentation.availabilityCategory === "unavailable";
	const avatarClassName = cn("shrink-0", {
		"opacity-55 grayscale": hasReducedProminence,
	});
	const profileNameClassName = cn(
		"min-w-0 truncate font-medium text-[13px]",
		hasReducedProminence ? "text-muted-foreground" : null
	);
	const availabilityDescriptionId = `agent-profile-availability-${input.profile.openMeldProfileId}`;
	const hasActions = Boolean(input.onToggleStar ?? input.onChat);
	const indicators = (
		<>
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
						<span aria-hidden="true" className="status-dot bg-current" />
					)}
				</TooltipTrigger>
				<TooltipContent>{presentation.availabilityTooltip}</TooltipContent>
			</Tooltip>
			<RemoteAgentIndicator agentControllerRef={agentControllerRef} />
			<AgentProfileOperationalStatusIndicator
				className="shrink-0"
				operationalContext={input.operationalContext}
			/>
		</>
	);
	if (input.variant === "card") {
		return (
			<FluidContextMenu
				target={
					<AgentGroupItem
						index={input.index}
						value={input.profile.openMeldProfileId}
					>
						<AgentCard
							badge={renderAvailabilityPill({
								errorMessage: input.readinessErrorMessage,
								id: availabilityDescriptionId,
								presentation,
							})}
							describedBy={availabilityDescriptionId}
							description={describeAgentCard({
								colleague: Boolean(colleagueAccess),
								summary: presentation.controllerModelSummary,
								workload: input.workload,
							})}
							indicators={
								<>
									<RemoteAgentIndicator
										agentControllerRef={agentControllerRef}
									/>
									<AgentProfileOperationalStatusIndicator
										className="shrink-0"
										operationalContext={input.operationalContext}
									/>
								</>
							}
							meta={renderColleagueAccessMeta(colleagueAccess)}
							name={input.profile.profileName}
							onClick={() => {
								input.onSelectProfile(input.profile.openMeldProfileId);
								dismiss();
							}}
							profileId={input.profile.openMeldProfileId}
							renderAvatar={(size) => (
								<AgentProfileControllerAvatar
									agentControllerRef={agentControllerRef}
									avatarStyle={input.profile.avatarStyle}
									className={avatarClassName}
									modelId={avatarModelId}
									profileId={input.profile.openMeldProfileId}
									profileName={input.profile.profileName}
									size={size}
									working={input.operationalContext?.status === "working"}
								/>
							)}
							selection={input.selection}
						/>
					</AgentGroupItem>
				}
			>
				{menu}
			</FluidContextMenu>
		);
	}

	return (
		<FluidContextMenu
			target={
				<FluidNavMenuItem
					className="relative"
					index={input.index}
					ref={input.drag?.ref}
					style={input.drag?.style}
					value={input.profile.openMeldProfileId}
				>
					<SidebarMenuButton
						actionLayout="heading"
						isActive={input.isActive}
						{...input.drag?.rowProps}
						aria-current={input.isActive ? "page" : undefined}
						aria-describedby={availabilityDescriptionId}
						aria-label={`Open ${input.profile.profileName}`}
						className={cn(
							"h-auto min-w-0 items-start gap-1.5 py-1 text-left outline-none",
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
							avatarStyle={input.profile.avatarStyle}
							className={avatarClassName}
							modelId={avatarModelId}
							profileId={input.profile.openMeldProfileId}
							profileName={input.profile.profileName}
							size={input.avatarSize ?? 20}
							working={input.operationalContext?.status === "working"}
						/>
						<span className="flex min-w-0 flex-1 flex-col overflow-hidden">
							<span
								className="flex min-w-0 items-center gap-1.5"
								data-sidebar="menu-heading"
							>
								<span className={profileNameClassName}>
									{input.profile.profileName}
								</span>
								{indicators}
							</span>
							<span className="truncate text-muted-foreground text-xs">
								{presentation.controllerModelSummary}
							</span>
						</span>
					</SidebarMenuButton>
					{hasActions && (
						<SidebarMenuActions showOnHover>
							{input.onChat && (
								<SidebarRowAction
									label={`Chat with ${input.profile.profileName}`}
									onClick={input.onChat}
								>
									<ChatCircleTextIcon />
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
						</SidebarMenuActions>
					)}
				</FluidNavMenuItem>
			}
		>
			{menu}
		</FluidContextMenu>
	);
}

/**
 * The card's status pill. Quiet until availability is read; a failed first
 * read shows a neutral pill, never a guessed verdict.
 */
function renderAvailabilityPill(input: {
	errorMessage: string | null;
	id: string;
	presentation: ReturnType<typeof resolveAgentProfileSidebarPresentation>;
}) {
	const { presentation } = input;
	if (!(presentation.availabilityCategory || input.errorMessage)) {
		return null;
	}
	return (
		<AgentAvailabilityBadge
			category={presentation.availabilityCategory}
			id={input.id}
			label="Couldn’t check"
			tooltip={presentation.availabilityTooltip}
		/>
	);
}

/**
 * A colleague's card leads with access, so its line carries only work; the
 * viewer's own card names its controller and model too.
 */
function describeAgentCard(input: {
	colleague: boolean;
	summary: string | null;
	workload?: { runningCount: number | null; queuedCount: number | null };
}): string {
	const work = input.workload ? formatAgentWorkloadParts(input.workload) : [];
	return [input.colleague ? null : input.summary, ...work]
		.filter(Boolean)
		.join(" · ");
}

function renderColleagueAccessMeta(
	access: ReturnType<typeof useColleagueAgentAccess>
) {
	return access ? <AgentAccessIndicator access={access} /> : null;
}

function resolveSidebarAvatarModelId(
	readiness: GetAgentExecutionReadinessResponse | null,
	catalog: ModelCatalog | null
): string | null {
	return (
		readiness?.primaryBinding?.modelSelection?.modelId ??
		readiness?.publicProfileConfiguration?.modelSelection?.modelId ??
		catalog?.agentControllers["center-agent"]?.hostedRuntimePolicy
			?.personalRemoteAgentDefaultModelId ??
		null
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
		availabilityTooltip: input.readiness?.publicWakeabilityReason
			? `${wakeAvailability.badgeLabel}: ${formatPublicWakeabilityReason(input.readiness.publicWakeabilityReason)}`
			: wakeAvailability.tooltip,
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
