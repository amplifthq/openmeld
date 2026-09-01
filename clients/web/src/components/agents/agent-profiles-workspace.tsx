"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import {
	parseAgentControllerRef,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowLeftIcon,
	ClipboardTextIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { AgentProfileOperationalStatusText } from "#/components/agents/agent-profile-operational-status";
import {
	type AgentProfileSidebarGroup,
	resolveAgentProfileSidebarGroups,
} from "#/components/agents/agent-profile-sidebar-groups";
import { AppContextualSidebarNav } from "#/components/app/app-contextual-layout";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import {
	APP_NAV_ITEM_TONE_CLASS_NAME,
	APP_NAV_ITEM_TYPOGRAPHY_CLASS_NAME,
} from "#/components/app/app-nav-item-style";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";

const AGENT_REQUESTS_DESCRIPTION =
	"Approve requests for Agents you’re being asked to own, and track requests you sent.";
const EMPTY_AGENT_PROFILE_OPERATIONAL_CONTEXT_BY_PROFILE_ID: ReadonlyMap<
	string,
	AgentProfileOperationalContextInput
> = new Map();

export type AgentProfilesWorkspaceProps = {
	activeView: "agents" | "requests";
	currentUserId: string;
	filterControl?: ReactNode;
	hasAnyProfiles?: boolean;
	isSearchActive?: boolean;
	initialSidebarStates?: AppSidebarPersistedStates;
	onCreateAgent: () => void;
	onSelectProfile: (profileId: string) => void;
	onViewChange: (view: "agents" | "requests") => void;
	pendingRequestCount: number;
	profiles: readonly AuthProfileView[];
	profilesErrorMessage?: string;
	profilesStatus?: "error" | "loading" | "ready";
	operationalContextByProfileId?: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
	readinessErrorByProfileId?: ReadonlyMap<string, string>;
	readinessPendingProfileIds?: ReadonlySet<string>;
	renderProfilesController: () => ReactNode;
	renderProfileDetail: (profile: AuthProfileView) => ReactNode;
	requestPanel: ReactNode;
	searchControl?: ReactNode;
	selectedProfileId: string | null;
	showAgentRequests?: boolean;
};

export function AgentProfilesWorkspace(input: AgentProfilesWorkspaceProps) {
	const groups = resolveAgentProfileSidebarGroups({
		currentUserId: input.currentUserId,
		profiles: input.profiles,
	});
	if (input.profilesStatus === "ready") {
		return (
			<ReadyAgentProfilesWorkspace
				groups={groups}
				input={input}
				key={input.profiles.length > 0 ? "has-profiles" : "no-profiles"}
			/>
		);
	}
	return (
		<AgentProfilesWorkspaceFrame
			groups={groups}
			implicitSelectedProfileId={null}
			input={input}
		/>
	);
}

function ReadyAgentProfilesWorkspace(input: {
	groups: readonly AgentProfileSidebarGroup[];
	input: AgentProfilesWorkspaceProps;
}) {
	const [implicitSelectedProfileId] = useState(
		() =>
			input.groups.flatMap((group) => group.profiles)[0]?.openMeldProfileId ??
			null
	);
	return (
		<AgentProfilesWorkspaceFrame
			groups={input.groups}
			implicitSelectedProfileId={implicitSelectedProfileId}
			input={input.input}
		/>
	);
}

function AgentProfilesWorkspaceFrame(input: {
	groups: readonly AgentProfileSidebarGroup[];
	implicitSelectedProfileId: string | null;
	input: AgentProfilesWorkspaceProps;
}) {
	const workspaceInput = input.input;
	const orderedProfiles = input.groups.flatMap((group) => group.profiles);
	const retainedImplicitProfileId = orderedProfiles.some(
		(profile) => profile.openMeldProfileId === input.implicitSelectedProfileId
	)
		? input.implicitSelectedProfileId
		: (orderedProfiles[0]?.openMeldProfileId ?? null);
	const requestedProfileId =
		workspaceInput.selectedProfileId ?? retainedImplicitProfileId;
	const selectedProfile = requestedProfileId
		? (orderedProfiles.find(
				(profile) => profile.openMeldProfileId === requestedProfileId
			) ?? null)
		: (orderedProfiles[0] ?? null);
	const selectionMissing =
		workspaceInput.selectedProfileId !== null && selectedProfile === null;
	const activeProfileId =
		workspaceInput.activeView === "agents"
			? (selectedProfile?.openMeldProfileId ?? null)
			: null;
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialInnerSidebarState={workspaceInput.initialSidebarStates?.inner}
			initialOuterSidebarState={workspaceInput.initialSidebarStates?.outer}
			mobileSidebarTitle="Agents"
			showMainHeader
			sidebar={
				<AgentProfilesWorkspaceSidebar
					activeProfileId={activeProfileId}
					groups={input.groups}
					input={workspaceInput}
				/>
			}
			sidebarPreferenceKey="agents"
			sidebarSeparatorLabel="Resize the Agents sidebar"
		>
			<AgentProfilesWorkspaceContent
				input={workspaceInput}
				selectedProfile={selectedProfile}
				selectionMissing={selectionMissing}
			/>
		</AppFullWidthLayout>
	);
}

function AgentProfilesWorkspaceSidebar(input: {
	activeProfileId: string | null;
	groups: readonly AgentProfileSidebarGroup[];
	input: AgentProfilesWorkspaceProps;
}) {
	return (
		<AppContextualSidebarNav
			activeItemId={input.activeProfileId}
			ariaLabel="Agents"
			groups={input.groups.map((group) => ({
				ariaLabel: `${group.label} Agents`,
				content: (
					<AgentProfileSidebarList
						activeProfileId={input.activeProfileId}
						currentUserId={input.input.currentUserId}
						onSelectProfile={input.input.onSelectProfile}
						operationalContextByProfileId={
							input.input.operationalContextByProfileId ??
							EMPTY_AGENT_PROFILE_OPERATIONAL_CONTEXT_BY_PROFILE_ID
						}
						profiles={group.profiles}
						readinessByProfileId={input.input.readinessByProfileId}
						readinessErrorByProfileId={
							input.input.readinessErrorByProfileId ?? new Map()
						}
						readinessPendingProfileIds={
							input.input.readinessPendingProfileIds ?? new Set()
						}
					/>
				),
				id: group.id,
				label: group.label,
			}))}
			leadingContent={
				<div className="space-y-1">
					<Button
						className="w-full min-w-0 justify-start overflow-hidden"
						onClick={input.input.onCreateAgent}
						size="sm"
						type="button"
						variant="ghost"
					>
						<PlusIcon aria-hidden="true" className="shrink-0" />
						<span className="truncate">Create Agent</span>
					</Button>
					{input.input.showAgentRequests === false ? null : (
						<Button
							aria-description={AGENT_REQUESTS_DESCRIPTION}
							aria-label={
								input.input.pendingRequestCount > 0
									? `Agent requests, ${input.input.pendingRequestCount} pending`
									: "Agent requests"
							}
							className={cn(
								"w-full min-w-0 justify-start overflow-hidden",
								input.input.activeView === "requests"
									? "bg-sidebar-accent"
									: null
							)}
							onClick={() => input.input.onViewChange("requests")}
							size="sm"
							type="button"
							variant="ghost"
						>
							<ClipboardTextIcon aria-hidden="true" className="shrink-0" />
							<span className="min-w-0 flex-1 truncate text-left">
								Agent requests
							</span>
							{input.input.pendingRequestCount > 0 ? (
								<Badge className="shrink-0" variant="secondary">
									{input.input.pendingRequestCount}
								</Badge>
							) : null}
						</Button>
					)}
					{input.input.searchControl || input.input.filterControl ? (
						<div className="flex min-w-0 items-center gap-1.5 px-1 pt-1">
							{input.input.searchControl}
							{input.input.filterControl}
						</div>
					) : null}
				</div>
			}
			onActivate={input.input.onSelectProfile}
			title="Agents"
		/>
	);
}

function AgentProfilesWorkspaceContent(input: {
	input: AgentProfilesWorkspaceProps;
	selectionMissing: boolean;
	selectedProfile: AuthProfileView | null;
}) {
	if (input.input.activeView === "requests") {
		return <AgentRequestsWorkspace input={input.input} />;
	}
	if (input.input.profilesStatus === "loading") {
		return (
			<output className="grid min-h-full place-items-center px-6 py-12 text-center text-muted-foreground text-sm">
				Loading Agents…
			</output>
		);
	}
	if (input.input.profilesStatus === "error") {
		return (
			<div className="grid min-h-full place-items-center px-6 py-12 text-center">
				<div className="max-w-md space-y-2" role="alert">
					<h1 className="font-medium text-base">Couldn’t load Agents</h1>
					<p className="text-destructive text-sm">
						{input.input.profilesErrorMessage ??
							"OpenMeld couldn’t load this Agent list. Try again."}
					</p>
				</div>
			</div>
		);
	}
	const profilesController =
		(input.input.hasAnyProfiles ?? input.input.profiles.length > 0)
			? input.input.renderProfilesController()
			: null;
	if (input.selectionMissing) {
		return (
			<>
				{profilesController}
				<div className="grid min-h-full place-items-center px-6 py-12 text-center">
					<div className="max-w-md space-y-2">
						<h1 className="font-medium text-base">Agent not found</h1>
						<p className="text-muted-foreground text-sm">
							This Agent no longer exists, or it isn’t available in this
							Organization.
						</p>
					</div>
				</div>
			</>
		);
	}
	if (input.selectedProfile) {
		return input.input.renderProfileDetail(input.selectedProfile);
	}
	return (
		<>
			{profilesController}
			<AgentProfilesWorkspaceEmptyState input={input.input} />
		</>
	);
}

function AgentRequestsWorkspace(input: { input: AgentProfilesWorkspaceProps }) {
	return (
		<div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
			<header className="space-y-1">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<h1 className="font-semibold text-xl">Agent requests</h1>
						<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
							{AGENT_REQUESTS_DESCRIPTION}
						</p>
					</div>
					<Button
						onClick={() => input.input.onViewChange("agents")}
						size="sm"
						type="button"
						variant="outline"
					>
						<ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
						Back to Agents
					</Button>
				</div>
			</header>
			{input.input.requestPanel}
		</div>
	);
}

function AgentProfilesWorkspaceEmptyState(input: {
	input: AgentProfilesWorkspaceProps;
}) {
	const isFiltered = input.input.hasAnyProfiles === true;
	const isSearchActive = input.input.isSearchActive === true;
	let title = "No Agents yet";
	let description = "Create an Agent to give your team an AI teammate.";
	if (isSearchActive) {
		title = "No Agents found";
		description = "Try another name, owner, Controller, or model.";
	} else if (isFiltered) {
		title = "No Agents match this filter";
		description = "Choose another Wake availability filter to see more Agents.";
	}
	return (
		<div className="grid min-h-full place-items-center px-6 py-12 text-center">
			<div className="max-w-sm space-y-2">
				<h1 className="font-medium text-base">{title}</h1>
				<p className="text-muted-foreground text-sm">{description}</p>
				{isFiltered ? null : (
					<Button onClick={input.input.onCreateAgent} size="sm" type="button">
						<PlusIcon aria-hidden="true" data-icon="inline-start" />
						Create Agent
					</Button>
				)}
			</div>
		</div>
	);
}

function AgentProfileSidebarList(input: {
	activeProfileId: string | null;
	currentUserId: string;
	onSelectProfile: (profileId: string) => void;
	operationalContextByProfileId: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	profiles: readonly AuthProfileView[];
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
	readinessErrorByProfileId: ReadonlyMap<string, string>;
	readinessPendingProfileIds: ReadonlySet<string>;
}) {
	return (
		<FluidNavMenu
			activeIndicatorClassName="bg-sidebar-accent"
			activeValue={input.activeProfileId}
			aria-label="Agents by owner"
			focusIndicatorClassName="border-sidebar-ring"
			hoverIndicatorClassName="bg-sidebar-accent"
		>
			{input.profiles.map((profile, index) => (
				<AgentProfileSidebarItem
					currentUserId={input.currentUserId}
					index={index}
					isActive={profile.openMeldProfileId === input.activeProfileId}
					key={profile.openMeldProfileId}
					onSelectProfile={input.onSelectProfile}
					operationalContext={
						input.operationalContextByProfileId.get(
							profile.openMeldProfileId
						) ?? null
					}
					profile={profile}
					readiness={
						input.readinessByProfileId.get(profile.openMeldProfileId) ?? null
					}
					readinessErrorMessage={
						input.readinessErrorByProfileId.get(profile.openMeldProfileId) ??
						null
					}
					readinessIsPending={input.readinessPendingProfileIds.has(
						profile.openMeldProfileId
					)}
				/>
			))}
		</FluidNavMenu>
	);
}

function AgentProfileSidebarItem(input: {
	currentUserId: string;
	index: number;
	isActive: boolean;
	onSelectProfile: (profileId: string) => void;
	operationalContext: AgentProfileOperationalContextInput | null;
	profile: AuthProfileView;
	readiness: GetAgentExecutionReadinessResponse | null;
	readinessErrorMessage: string | null;
	readinessIsPending: boolean;
}) {
	const { dismiss } = useAppNavigationPresentation();
	const agentControllerRef = resolveAgentProfileControllerRef(input.readiness);
	const presentation = resolveAgentProfileSidebarPresentation({
		errorMessage: input.readinessErrorMessage,
		isPending: input.readinessIsPending,
		readiness: input.readiness,
	});
	const isOwner = input.profile.ownerUserId === input.currentUserId;
	const hasReducedProminence =
		presentation.availabilityCategory === "offline" ||
		presentation.availabilityCategory === "unavailable";
	return (
		<FluidNavMenuItem
			index={input.index}
			value={input.profile.openMeldProfileId}
		>
			<button
				aria-current={input.isActive ? "page" : undefined}
				aria-label={`Open ${input.profile.profileName}`}
				className={cn(
					"flex w-full min-w-0 items-start gap-2 px-2 py-2 text-left outline-none",
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
					size={32}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
					<span className="flex min-w-0 items-center justify-between gap-2">
						<span
							className={cn(
								"min-w-0 truncate font-medium text-sm",
								hasReducedProminence ? "text-muted-foreground" : null
							)}
						>
							{input.profile.profileName}
						</span>
						<AgentProfileOperationalStatusText
							className="shrink-0"
							operationalContext={input.operationalContext}
						/>
					</span>
					{isOwner ? (
						<span className="truncate text-muted-foreground text-xs">
							{presentation.controllerModelSummary}
						</span>
					) : null}
					<Tooltip>
						<TooltipTrigger
							render={
								<span
									className={cn(
										"min-w-0 truncate font-medium text-xs",
										presentation.availabilityClassName
									)}
									title={presentation.availabilityTooltip}
								/>
							}
						>
							{presentation.availabilityLabel}
						</TooltipTrigger>
						<TooltipContent side="top">
							{presentation.availabilityTooltip}
						</TooltipContent>
					</Tooltip>
				</span>
			</button>
		</FluidNavMenuItem>
	);
}

function resolveAgentProfileSidebarPresentation(input: {
	errorMessage: string | null;
	isPending: boolean;
	readiness: GetAgentExecutionReadinessResponse | null;
}): {
	availabilityCategory: ReturnType<
		typeof resolveAgentWakeAvailabilityDisplayCategory
	> | null;
	availabilityClassName: string;
	availabilityLabel: string;
	availabilityTooltip: string;
	controllerModelSummary: string;
} {
	const agentControllerRef = resolveAgentProfileControllerRef(input.readiness);
	const parsedControllerRef = parseAgentControllerRef(agentControllerRef);
	const controllerName = parsedControllerRef
		? formatLocalAgentDisplayName(parsedControllerRef.id)
		: "No Controller connected";
	const modelId =
		input.readiness?.primaryBinding?.modelSelection?.modelId?.trim();
	const wakeAvailability = input.readiness?.agentWakeAvailability ?? null;
	if (input.errorMessage || !wakeAvailability) {
		const availability = resolveMissingSidebarAvailability(input);
		return {
			availabilityCategory: availability.category,
			availabilityClassName: availability.className,
			availabilityLabel: availability.label,
			availabilityTooltip: availability.tooltip,
			controllerModelSummary: modelId
				? `${controllerName} · ${modelId}`
				: controllerName,
		};
	}
	const category =
		resolveAgentWakeAvailabilityDisplayCategory(wakeAvailability);
	return {
		availabilityCategory: category,
		availabilityClassName: resolveAvailabilityClassName(category),
		availabilityLabel: wakeAvailability.badgeLabel,
		availabilityTooltip: wakeAvailability.tooltip,
		controllerModelSummary: modelId
			? `${controllerName} · ${modelId}`
			: controllerName,
	};
}

function resolveAgentProfileControllerRef(
	readiness: GetAgentExecutionReadinessResponse | null
): string | null {
	return (
		readiness?.primaryBinding?.executionTarget?.agentControllerRef ??
		readiness?.agentControllerRef ??
		null
	);
}

function resolveMissingSidebarAvailability(input: {
	errorMessage: string | null;
	isPending: boolean;
}) {
	if (input.errorMessage) {
		return {
			category: "unavailable" as const,
			className: resolveStatusToneTextClassName("muted"),
			label: "Unavailable",
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
