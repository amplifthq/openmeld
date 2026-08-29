"use client";

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
import type { ReactNode } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
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

export type AgentProfilesWorkspaceProps = {
	activeView: "agents" | "requests";
	currentUserId: string;
	filterControl?: ReactNode;
	hasAnyProfiles?: boolean;
	initialSidebarStates?: AppSidebarPersistedStates;
	onCreateAgent: () => void;
	onSelectProfile: (profileId: string) => void;
	onViewChange: (view: "agents" | "requests") => void;
	pendingRequestCount: number;
	profiles: readonly AuthProfileView[];
	profilesErrorMessage?: string;
	profilesStatus?: "error" | "loading" | "ready";
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
	readinessErrorByProfileId?: ReadonlyMap<string, string>;
	readinessPendingProfileIds?: ReadonlySet<string>;
	renderProfileDetail: (profile: AuthProfileView) => ReactNode;
	requestPanel: ReactNode;
	selectedProfileId: string | null;
	showAgentRequests?: boolean;
};

export function AgentProfilesWorkspace(input: AgentProfilesWorkspaceProps) {
	const groups = resolveAgentProfileSidebarGroups({
		currentUserId: input.currentUserId,
		profiles: input.profiles,
	});
	const orderedProfiles = groups.flatMap((group) => group.profiles);
	const selectedProfile =
		orderedProfiles.find(
			(profile) => profile.openMeldProfileId === input.selectedProfileId
		) ??
		orderedProfiles[0] ??
		null;
	const activeProfileId =
		input.activeView === "agents"
			? (selectedProfile?.openMeldProfileId ?? null)
			: null;
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialInnerSidebarState={input.initialSidebarStates?.inner}
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mobileSidebarTitle="Agents"
			showMainHeader
			sidebar={
				<AgentProfilesWorkspaceSidebar
					activeProfileId={activeProfileId}
					groups={groups}
					input={input}
				/>
			}
			sidebarPreferenceKey="agents"
			sidebarSeparatorLabel="Resize the Agents sidebar"
		>
			<AgentProfilesWorkspaceContent
				input={input}
				selectedProfile={selectedProfile}
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
						onSelectProfile={input.input.onSelectProfile}
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
					{input.input.filterControl ? (
						<div className="flex justify-end px-1 pt-1">
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
	if (input.selectedProfile) {
		return input.input.renderProfileDetail(input.selectedProfile);
	}
	return <AgentProfilesWorkspaceEmptyState input={input.input} />;
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
	return (
		<div className="grid min-h-full place-items-center px-6 py-12 text-center">
			<div className="max-w-sm space-y-2">
				<h1 className="font-medium text-base">
					{isFiltered ? "No Agents match this filter" : "No Agents yet"}
				</h1>
				<p className="text-muted-foreground text-sm">
					{isFiltered
						? "Choose another Wake availability filter to see more Agents."
						: "Create an Agent to give your team an AI teammate."}
				</p>
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
	onSelectProfile: (profileId: string) => void;
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
					index={index}
					isActive={profile.openMeldProfileId === input.activeProfileId}
					key={profile.openMeldProfileId}
					onSelectProfile={input.onSelectProfile}
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
	index: number;
	isActive: boolean;
	onSelectProfile: (profileId: string) => void;
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
					className="shrink-0"
					profileId={input.profile.openMeldProfileId}
					size={32}
				/>
				<span className="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
					<span className="truncate font-medium text-sm">
						{input.profile.profileName}
					</span>
					<span className="truncate text-muted-foreground text-xs">
						{presentation.controllerModelSummary}
					</span>
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
			className: resolveStatusToneTextClassName("warning"),
			label: "Unavailable",
			tooltip: input.errorMessage,
		};
	}
	if (input.isPending) {
		return {
			className: resolveStatusToneTextClassName("checking"),
			label: "Checking",
			tooltip: "Checking Wake availability",
		};
	}
	return {
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
			return resolveStatusToneTextClassName("warning");
		case "offline":
			return resolveStatusToneTextClassName("muted");
		default:
			return "text-muted-foreground";
	}
}
