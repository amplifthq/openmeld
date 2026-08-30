"use client";

import {
	parseAgentControllerRef,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { Input } from "@openmeld/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { FunnelSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { AgentProfileCreationRequestsPanel } from "#/components/agents/agent-profile-creation-requests-panel";
import { AgentProfilesWorkspace } from "#/components/agents/agent-profiles-workspace";
import {
	type AgentProfileAvailabilityFilter,
	type AgentProfileAvailabilityFilterCounts,
	resolveAgentProfileAvailabilityFilterState,
	sortAgentProfilesForDisplay,
} from "#/components/agents/agents-page-agent-profile-helpers";
import { AgentProfilesCard } from "#/components/agents/agents-page-agent-profiles-card";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { DirectoryMembersOverview } from "#/components/directory/directory-members-overview";
import { CreateProfileDialog } from "#/components/profiles/create-profile-dialog";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildProfileHomeRoutes } from "#/lib/profile-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import {
	organizationDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { agentProfileCreationRequestsQueryOptions } from "#/query/profiles/agent-profile-creation-requests";
import { startQueryKeys } from "#/query/query-keys";

export type ProfileHomeId = "agents" | "people";

type AgentProfileListFilter =
	| AgentProfileAvailabilityFilter
	| "organization_members";
const AGENT_PROFILE_FILTER_OPTIONS = [
	{ label: "All", value: "all" },
	{ label: "Available", value: "available" },
	{ label: "Checking", value: "checking" },
	{ label: "Offline", value: "offline" },
	{ label: "Unavailable", value: "unavailable" },
] as const satisfies readonly {
	label: string;
	value: AgentProfileAvailabilityFilter;
}[];
const ORGANIZATION_MEMBER_AGENT_PROFILE_FILTER_OPTION = {
	label: "Organization members",
	value: "organization_members",
} as const satisfies {
	label: string;
	value: AgentProfileListFilter;
};
const EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID: ReadonlyMap<
	string,
	string
> = new Map();
const EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS: ReadonlySet<string> =
	new Set();

export function PeopleAndAgentsPage(input: {
	activeAgentView?: "agents" | "requests";
	activeSectionId: ProfileHomeId;
	focusRequestId?: string | null;
	focusProfileId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	onAgentViewChange?: (view: "agents" | "requests", profileId?: string) => void;
}) {
	const account = useAppShellAccount();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false);
	const [agentProfileFilter, setAgentProfileFilter] =
		useState<AgentProfileListFilter>("all");
	const [agentProfileSearchQuery, setAgentProfileSearchQuery] = useState("");
	const isOrganizationContext = currentOrganization.isPersonal !== true;
	const activeAgentView = resolveActiveAgentView({
		activeAgentView: input.activeAgentView,
		activeSectionId: input.activeSectionId,
		isOrganizationContext,
	});
	const fallbackOwnerLabel =
		(account.name ?? account.email ?? "This member").trim() || "This member";
	const recovery = useLocalAgentRecoveryController({
		agentExecutionReadinessScope: "bound_runtime",
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	const organizationDirectoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const agentProfileFilterCounts = useMemo(() => {
		return summarizeOrganizationAgentProfileAvailabilityFilters(
			(organizationDirectoryQuery.data?.agentProfiles ?? []).filter(
				(profile) => profile.managedRole !== "center_agent"
			)
		);
	}, [organizationDirectoryQuery.data?.agentProfiles]);
	const handleProfileCreated = (profile: AuthProfileView) => {
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: startQueryKeys.profilesForStorageScope(recovery.storageScope),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.directory(currentOrganization.id),
			}),
		]).catch((error: unknown) => {
			console.error(
				"Failed to refresh Profiles after profile creation.",
				error
			);
		});
		const targetRoute =
			profile.profileKind === "agent"
				? profileHomeRoutes.agents
				: profileHomeRoutes.people;
		navigate({
			search: { profileId: profile.openMeldProfileId },
			to: targetRoute,
		}).catch((error: unknown) => {
			console.error("Failed to open the created profile.", error);
		});
	};
	const createProfileDialog = isCreateProfileOpen ? (
		<CreateProfileDialog
			allowTeammateRequests={isOrganizationContext}
			currentUserId={currentUserId}
			onAgentRequestCreated={(request) => {
				if (request.createdAgentProfileId) {
					navigate({
						search: { profileId: request.createdAgentProfileId },
						to: profileHomeRoutes.agents,
					}).catch((error: unknown) => {
						console.error("Failed to open the created Agent.", error);
					});
					return;
				}
				input.onAgentViewChange?.("requests");
			}}
			onOpenChange={setIsCreateProfileOpen}
			onProfileCreated={handleProfileCreated}
			open={true}
			organizationId={currentOrganization.id}
			recovery={recovery}
		/>
	) : null;
	if (input.activeSectionId === "people") {
		return (
			<>
				<DirectoryMembersOverview
					account={account}
					currentOrganization={currentOrganization}
					currentUserId={currentUserId}
					directoryQuery={organizationDirectoryQuery}
					focusProfileId={input.focusProfileId}
					initialSidebarStates={input.initialSidebarStates}
					onCreateProfile={() => setIsCreateProfileOpen(true)}
					recovery={recovery}
					storageScope={recovery.storageScope}
				/>
				{createProfileDialog}
			</>
		);
	}
	return (
		<>
			<AgentsWorkspaceHome
				activeView={activeAgentView}
				agentProfileSearchQuery={agentProfileSearchQuery}
				availabilityFilter={resolveAgentProfileAvailabilityFilter(
					agentProfileFilter
				)}
				currentUserId={currentUserId}
				directoryQuery={organizationDirectoryQuery}
				fallbackOwnerLabel={fallbackOwnerLabel}
				filterControl={
					<AgentProfileFilterSelect
						counts={agentProfileFilterCounts}
						includeOrganizationMemberFilter={isOrganizationContext}
						onValueChange={setAgentProfileFilter}
						value={agentProfileFilter}
					/>
				}
				focusRequestId={input.focusRequestId ?? null}
				initialSidebarStates={input.initialSidebarStates}
				isOrganizationContext={isOrganizationContext}
				onCreateAgent={() => setIsCreateProfileOpen(true)}
				onSelectProfile={(profileId) => {
					navigate({
						search: { profileId },
						to: profileHomeRoutes.agents,
					}).catch((error: unknown) => {
						console.error("Failed to open the selected Agent.", error);
					});
				}}
				onViewChange={(view, profileId) =>
					input.onAgentViewChange?.(view, profileId)
				}
				organizationId={currentOrganization.id}
				orgSlug={orgSlug}
				recovery={recovery}
				searchControl={
					<AgentProfileSearchInput
						onValueChange={setAgentProfileSearchQuery}
						value={agentProfileSearchQuery}
					/>
				}
				selectedProfileId={input.focusProfileId}
			/>
			{createProfileDialog}
		</>
	);
}

function resolveActiveAgentView(input: {
	activeAgentView: "agents" | "requests" | undefined;
	activeSectionId: ProfileHomeId;
	isOrganizationContext: boolean;
}): "agents" | "requests" {
	return input.activeSectionId === "agents" &&
		input.activeAgentView === "requests" &&
		input.isOrganizationContext
		? "requests"
		: "agents";
}

function AgentsWorkspaceHome(input: {
	activeView: "agents" | "requests";
	availabilityFilter: AgentProfileAvailabilityFilter;
	agentProfileSearchQuery: string;
	currentUserId: string;
	directoryQuery: OrganizationDirectoryQueryState;
	fallbackOwnerLabel: string;
	filterControl: ReactNode;
	focusRequestId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	isOrganizationContext: boolean;
	onCreateAgent: () => void;
	onSelectProfile: (profileId: string) => void;
	onViewChange: (view: "agents" | "requests", profileId?: string) => void;
	organizationId: string;
	orgSlug: string;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
	searchControl: ReactNode;
	selectedProfileId: string | null;
}) {
	const queryClient = useQueryClient();
	const accountComputerSetupPath = buildConnectComputerPath({
		orgSlug: input.orgSlug,
	});
	const accountServiceUpdatePath = buildConnectComputerPath({
		orgSlug: input.orgSlug,
		serviceAction: "update_service",
		session: "fresh",
	});
	const organizationAgentProjection = useMemo(() => {
		const profiles: AuthProfileView[] = [];
		const readinessByProfileId = new Map<
			string,
			OrganizationDirectoryResponse["agentProfiles"][number]["readiness"]
		>();
		for (const profile of input.directoryQuery.data?.agentProfiles ?? []) {
			if (profile.managedRole === "center_agent") {
				continue;
			}
			profiles.push(buildAuthProfileViewFromOrganizationAgentProfile(profile));
			readinessByProfileId.set(profile.profileId, profile.readiness);
		}
		return { profiles, readinessByProfileId };
	}, [input.directoryQuery.data?.agentProfiles]);
	const agentProfiles = organizationAgentProjection.profiles;
	const readinessByProfileId = organizationAgentProjection.readinessByProfileId;
	const errorByProfileId = EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID;
	const pendingProfileIds = EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS;
	const availabilityFilteredAgentProfiles = useMemo(
		() =>
			sortAgentProfilesForDisplay({
				profiles: agentProfiles,
				readinessByProfileId,
			}).filter(
				(profile) =>
					input.availabilityFilter === "all" ||
					resolveAgentProfileAvailabilityFilterState({
						errorByProfileId,
						pendingProfileIds,
						profileId: profile.openMeldProfileId,
						readinessByProfileId,
					}) === input.availabilityFilter
			),
		[agentProfiles, input.availabilityFilter, readinessByProfileId]
	);
	const normalizedSearchQuery = normalizeAgentProfileSearchText(
		input.agentProfileSearchQuery
	);
	const visibleAgentProfiles = useMemo(
		() =>
			normalizedSearchQuery.length === 0
				? availabilityFilteredAgentProfiles
				: availabilityFilteredAgentProfiles.filter((profile) =>
						matchesAgentProfileSearch({
							profile,
							query: normalizedSearchQuery,
							readiness:
								readinessByProfileId.get(profile.openMeldProfileId) ?? null,
						})
					),
		[
			availabilityFilteredAgentProfiles,
			normalizedSearchQuery,
			readinessByProfileId,
		]
	);
	const sidebarAgentProfiles = useMemo(() => {
		const selectedProfile = agentProfiles.find(
			(profile) => profile.openMeldProfileId === input.selectedProfileId
		);
		if (
			normalizedSearchQuery.length > 0 ||
			!selectedProfile ||
			visibleAgentProfiles.some(
				(profile) =>
					profile.openMeldProfileId === selectedProfile.openMeldProfileId
			)
		) {
			return visibleAgentProfiles;
		}
		return [selectedProfile, ...visibleAgentProfiles];
	}, [
		agentProfiles,
		input.selectedProfileId,
		normalizedSearchQuery,
		visibleAgentProfiles,
	]);
	const sidebarSelectedProfileId =
		normalizedSearchQuery.length > 0 &&
		input.selectedProfileId !== null &&
		!sidebarAgentProfiles.some(
			(profile) => profile.openMeldProfileId === input.selectedProfileId
		)
			? null
			: input.selectedProfileId;
	const requestsQuery = useQuery(
		agentProfileCreationRequestsQueryOptions({
			enabled: input.isOrganizationContext,
			organizationId: input.organizationId,
		})
	);
	const pendingRequestCount =
		requestsQuery.data?.requests?.filter(
			(request) => request.status === "pending"
		).length ?? 0;
	const profilesStatus = resolveAgentProfilesStatus({
		isError: input.directoryQuery.isError,
		isPending: input.directoryQuery.isPending,
	});
	const profilesErrorMessage = input.directoryQuery.error?.message;
	let requestPanel: ReactNode = null;
	if (input.directoryQuery.data) {
		requestPanel = (
			<AgentProfileCreationRequestsPanel
				currentUserId={input.currentUserId}
				directory={input.directoryQuery.data}
				focusRequestId={input.focusRequestId}
				onCreateAgent={input.onCreateAgent}
				onOpenAgent={(profileId) => {
					input.onViewChange("agents", profileId);
				}}
				organizationId={input.organizationId}
			/>
		);
	} else if (input.directoryQuery.isError) {
		requestPanel = (
			<p className="rounded-md border border-destructive/30 px-4 py-4 text-destructive text-sm">
				{input.directoryQuery.error?.message ?? "Couldn’t load Agent requests."}
			</p>
		);
	} else if (input.isOrganizationContext) {
		requestPanel = (
			<p className="rounded-md border border-border/70 px-4 py-6 text-muted-foreground text-sm">
				Loading Agent requests…
			</p>
		);
	}

	return (
		<AgentProfilesWorkspace
			activeView={input.activeView}
			currentUserId={input.currentUserId}
			filterControl={input.filterControl}
			hasAnyProfiles={agentProfiles.length > 0}
			initialSidebarStates={input.initialSidebarStates}
			isSearchActive={normalizedSearchQuery.length > 0}
			onCreateAgent={input.onCreateAgent}
			onSelectProfile={input.onSelectProfile}
			onViewChange={input.onViewChange}
			pendingRequestCount={pendingRequestCount}
			profiles={sidebarAgentProfiles}
			profilesErrorMessage={profilesErrorMessage}
			profilesStatus={profilesStatus}
			readinessByProfileId={readinessByProfileId}
			readinessErrorByProfileId={errorByProfileId}
			readinessPendingProfileIds={pendingProfileIds}
			renderProfileDetail={(profile) => (
				<AgentProfilesCard
					agentExecutionReadinessByProfileId={readinessByProfileId}
					agentExecutionReadinessErrorByProfileId={errorByProfileId}
					agentExecutionReadinessPendingProfileIds={pendingProfileIds}
					agentProfiles={agentProfiles}
					agentProfilesQueryState={{ isError: false, isPending: false }}
					availabilityFilter="all"
					canManageProfile={(candidate) =>
						candidate.ownerUserId === input.currentUserId
					}
					fallbackOwnerLabel={input.fallbackOwnerLabel}
					focusProfileId={profile.openMeldProfileId}
					isCurrentComputer={true}
					key={profile.openMeldProfileId}
					presentation="detail"
					queryClient={queryClient}
					recovery={input.recovery}
					serviceUpdatePath={accountServiceUpdatePath}
					setupPath={accountComputerSetupPath}
				/>
			)}
			renderProfilesController={() => (
				<AgentProfilesCard
					agentExecutionReadinessByProfileId={readinessByProfileId}
					agentExecutionReadinessErrorByProfileId={errorByProfileId}
					agentExecutionReadinessPendingProfileIds={pendingProfileIds}
					agentProfiles={agentProfiles}
					agentProfilesQueryState={{ isError: false, isPending: false }}
					availabilityFilter="all"
					canManageProfile={(candidate) =>
						candidate.ownerUserId === input.currentUserId
					}
					fallbackOwnerLabel={input.fallbackOwnerLabel}
					focusProfileId={null}
					isCurrentComputer={true}
					presentation="controller"
					queryClient={queryClient}
					recovery={input.recovery}
					serviceUpdatePath={accountServiceUpdatePath}
					setupPath={accountComputerSetupPath}
				/>
			)}
			requestPanel={requestPanel}
			searchControl={input.searchControl}
			selectedProfileId={sidebarSelectedProfileId}
			showAgentRequests={input.isOrganizationContext}
		/>
	);
}

function AgentProfileSearchInput(input: {
	onValueChange: (value: string) => void;
	value: string;
}) {
	return (
		<div className="relative min-w-0 flex-1">
			<MagnifyingGlassIcon
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				aria-label="Search Agents"
				autoComplete="off"
				className="pl-7"
				name="agent-search"
				onChange={(event) => input.onValueChange(event.target.value)}
				placeholder="Search Agents"
				spellCheck={false}
				type="search"
				value={input.value}
			/>
		</div>
	);
}

function matchesAgentProfileSearch(input: {
	profile: AuthProfileView;
	query: string;
	readiness:
		| OrganizationDirectoryResponse["agentProfiles"][number]["readiness"]
		| null;
}): boolean {
	const agentControllerRef =
		input.readiness?.primaryBinding?.executionTarget?.agentControllerRef ??
		input.readiness?.agentControllerRef ??
		null;
	const parsedControllerRef = parseAgentControllerRef(agentControllerRef);
	const searchableText = normalizeAgentProfileSearchText(
		[
			input.profile.profileName,
			input.profile.profileHandle,
			input.profile.ownerName,
			parsedControllerRef?.id,
			parsedControllerRef
				? formatLocalAgentDisplayName(parsedControllerRef.id)
				: null,
			input.readiness?.primaryBinding?.modelSelection?.modelId,
		]
			.filter((value): value is string => Boolean(value))
			.join(" ")
	);
	return input.query.split(" ").every((term) => searchableText.includes(term));
}

function normalizeAgentProfileSearchText(value: string): string {
	return value
		.normalize("NFKD")
		.toLocaleLowerCase("en")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function resolveAgentProfilesStatus(input: {
	isError: boolean;
	isPending: boolean;
}): "error" | "loading" | "ready" {
	if (input.isPending) {
		return "loading";
	}
	return input.isError ? "error" : "ready";
}

function AgentProfileFilterSelect(input: {
	counts: AgentProfileAvailabilityFilterCounts;
	includeOrganizationMemberFilter: boolean;
	onValueChange: (value: AgentProfileListFilter) => void;
	value: AgentProfileListFilter;
}) {
	const options = input.includeOrganizationMemberFilter
		? [
				AGENT_PROFILE_FILTER_OPTIONS[0],
				ORGANIZATION_MEMBER_AGENT_PROFILE_FILTER_OPTION,
				...AGENT_PROFILE_FILTER_OPTIONS.slice(1),
			]
		: AGENT_PROFILE_FILTER_OPTIONS;
	const currentOption =
		options.find((option) => option.value === input.value) ??
		AGENT_PROFILE_FILTER_OPTIONS[0];
	const displayValue = formatAgentProfileFilterOptionName({
		count: resolveAgentProfileListFilterCount({
			counts: input.counts,
			value: currentOption.value,
		}),
		label: currentOption.label,
	});

	return (
		<Select
			onValueChange={(value) => {
				input.onValueChange(value as AgentProfileListFilter);
			}}
			value={input.value}
		>
			<SelectTrigger
				aria-label={`Filter Agents. Current filter: ${displayValue}.`}
				className="size-8 min-w-0 justify-center px-0 text-muted-foreground hover:text-foreground [&>span>span]:sr-only [&>span]:flex-none [&>svg]:hidden"
				displayValue={displayValue}
				icon={FunnelSimpleIcon}
				variant="borderless"
			/>
			<SelectContent className="w-44 -translate-x-[calc(100%-2rem)]">
				{options.map((option, index) => (
					<SelectItem index={index} key={option.value} value={option.value}>
						<span className="sr-only">
							{formatAgentProfileFilterOptionName({
								count: resolveAgentProfileListFilterCount({
									counts: input.counts,
									value: option.value,
								}),
								label: option.label,
							})}
						</span>
						<span
							aria-hidden="true"
							className="flex min-w-0 flex-1 items-center justify-between gap-6"
						>
							<span className="min-w-0 truncate">{option.label}</span>
							<span className="shrink-0 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
								{resolveAgentProfileListFilterCount({
									counts: input.counts,
									value: option.value,
								})}
							</span>
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function resolveAgentProfileAvailabilityFilter(
	filter: AgentProfileListFilter
): AgentProfileAvailabilityFilter {
	return filter === "organization_members" ? "all" : filter;
}

function resolveAgentProfileListFilterCount(input: {
	counts: AgentProfileAvailabilityFilterCounts;
	value: AgentProfileListFilter;
}): number {
	return input.value === "organization_members"
		? input.counts.all
		: input.counts[input.value];
}

function formatAgentProfileFilterOptionName(input: {
	count: number;
	label: string;
}) {
	const profileLabel = input.count === 1 ? "Agent" : "Agents";
	return `${input.label}, ${input.count} ${profileLabel}`;
}

type OrganizationDirectoryQueryState = {
	data?: OrganizationDirectoryResponse;
	error: { message?: string } | null;
	isError: boolean;
	isPending: boolean;
};

function summarizeOrganizationAgentProfileAvailabilityFilters(
	profiles: readonly OrganizationDirectoryResponse["agentProfiles"][number][]
): AgentProfileAvailabilityFilterCounts {
	const summary: AgentProfileAvailabilityFilterCounts = {
		all: profiles.length,
		available: 0,
		checking: 0,
		offline: 0,
		unavailable: 0,
	};
	for (const profile of profiles) {
		const category = resolveAgentWakeAvailabilityDisplayCategory(
			profile.readiness.agentWakeAvailability
		);
		summary[category] += 1;
	}
	return summary;
}

function buildAuthProfileViewFromOrganizationAgentProfile(
	profile: OrganizationDirectoryResponse["agentProfiles"][number]
): AuthProfileView {
	return {
		avatarUrl: profile.avatarUrl,
		createdAt: profile.createdAt,
		createdByUserId: profile.createdByUserId,
		creatorProfileId: profile.creatorProfileId,
		isDefault: profile.isDefault,
		lastUsedAt: profile.lastUsedAt,
		managedRole: profile.managedRole,
		ownerName: profile.ownerName,
		ownerUserId: profile.ownerUserId,
		profileHandle: profile.profileHandle,
		profileKind: profile.profileKind,
		profileName: profile.profileName,
		source: profile.source,
		status: profile.status,
		updatedAt: profile.updatedAt,
		openMeldProfileId: profile.profileId,
	};
}
