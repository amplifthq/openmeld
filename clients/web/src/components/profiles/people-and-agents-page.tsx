"use client";

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import {
	parseAgentControllerRef,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import type {
	AgentProfileCreationRequest,
	AuthProfileView,
	ModelCatalog,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuSubContent as DropdownMenuSubContent,
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { FunnelSimpleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	type AgentProfileActivityNavigation,
	resolveAgentProfileActivityPreview,
} from "#/components/agents/agent-profile-activity-preview";
import { AgentProfileCreationRequestsPanel } from "#/components/agents/agent-profile-creation-requests-panel";
import { AgentProfilesWorkspace } from "#/components/agents/agent-profiles-workspace";
import {
	type AgentProfileAvailabilityFilter,
	type AgentProfileAvailabilityFilterCounts,
	sortAgentProfilesForDisplay,
} from "#/components/agents/agents-page-agent-profile-helpers";
import { AgentProfilesCard } from "#/components/agents/agents-page-agent-profiles-card";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { DirectoryMembersOverview } from "#/components/directory/directory-members-overview";
import { CreateProfileDialog } from "#/components/profiles/create-profile-dialog";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	localAgentSidebarState,
	useAgentSidebarPreviewReady,
} from "#/lib/dev/agent-sidebar-fixtures";
import { isLocalWebOrigin } from "#/lib/local-web-origin";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentCreationPath } from "#/lib/organizations/organization-routes";
import { buildProfileHomeRoutes } from "#/lib/profile-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationProfileDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { agentProfileCreationRequestsQueryOptions } from "#/query/profiles/agent-profile-creation-requests";
import { startQueryKeys } from "#/query/query-keys";
import { SidebarFilterBadge } from "../app/sidebar-filter-badge";
import { useSidebarGroupFilter } from "../app/sidebar-group-filter";
import { SidebarSearchInput } from "../app/sidebar-search-input";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";

export type ProfileHomeId = "agents" | "people";
type AgentWorkspaceView = "agents" | "requests";

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
const EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID: ReadonlyMap<
	string,
	string
> = new Map();
const EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS: ReadonlySet<string> =
	new Set();

export function PeopleAndAgentsPage(input: {
	activityPreview?: boolean;
	activeAgentView?: AgentWorkspaceView;
	activeSectionId: ProfileHomeId;
	focusRequestId?: string | null;
	focusProfileId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	onAgentViewChange?: (view: AgentWorkspaceView, profileId?: string) => void;
}) {
	const account = useAppShellAccount();
	const previewReady = useAgentSidebarPreviewReady();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const sidebarPreferences = useSidebarPreferences(
		currentUserId,
		currentOrganization.id
	);
	const agentGroups = useSidebarGroupFilter([
		{ id: "starred", label: "Starred" },
		...(sidebarPreferences.preferences?.agents?.groups ?? []).map((group) => ({
			id: group.id,
			label: group.name,
		})),
		{ id: "ungrouped", label: "Ungrouped" },
	]);
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false);
	const [agentOwnerId, setAgentOwnerId] = useState<string | null>(null);
	const [agentProfileFilter, setAgentProfileFilter] =
		useState<AgentProfileListFilter>("all");
	const [agentProfileSearchQuery, setAgentProfileSearchQuery] = useState("");
	const [activityPreview, setActivityPreview] = useState(false);
	useEffect(() => {
		const isLocalHost = isLocalWebOrigin(window.location.origin);
		const isPreviewRequested =
			input.activityPreview === true ||
			new URLSearchParams(window.location.search).get("activityPreview") ===
				"1";
		setActivityPreview(isLocalHost && isPreviewRequested);
	}, [input.activityPreview]);
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
		loadAgentProfiles: input.activeSectionId === "agents",
		loadAgentExecutionReadiness: false,
		loadSetupState: false,
	});
	const organizationProfileDirectoryQuery = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const organizationAgentRuntimeOverviewQuery = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const modelCatalogQuery = useQuery(modelCatalogQueryOptions());
	const agentProfileFilterCounts = useMemo(() => {
		return summarizeOrganizationAgentProfileAvailabilityFilters({
			previewReady,
			profiles: (
				organizationProfileDirectoryQuery.data?.agentProfiles ?? []
			).filter(
				(profile) =>
					profile.managedRole !== "center_agent" &&
					(!agentOwnerId || profile.ownerUserId === agentOwnerId)
			),
			runtimeOverview: organizationAgentRuntimeOverviewQuery.data,
			runtimeOverviewFailed:
				organizationAgentRuntimeOverviewQuery.isError &&
				!organizationAgentRuntimeOverviewQuery.data,
			runtimeOverviewPending:
				organizationAgentRuntimeOverviewQuery.isPending &&
				!organizationAgentRuntimeOverviewQuery.data,
		});
	}, [
		organizationAgentRuntimeOverviewQuery.data,
		organizationAgentRuntimeOverviewQuery.isError,
		organizationAgentRuntimeOverviewQuery.isPending,
		organizationProfileDirectoryQuery.data?.agentProfiles,
		previewReady,
		agentOwnerId,
	]);
	const handleProfileCreated = (profile: AuthProfileView) => {
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: startQueryKeys.profilesForStorageScope(recovery.storageScope),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.directory(currentOrganization.id),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.profileDirectory(
					currentOrganization.id
				),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.agentRuntimeOverview(
					currentOrganization.id
				),
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
			search: {
				activityPreview: activityPreview ? 1 : undefined,
				profileId: profile.openMeldProfileId,
			},
			to: targetRoute,
		}).catch((error: unknown) => {
			console.error("Failed to open the created profile.", error);
		});
	};
	const handleAgentRequestCreated = (request: AgentProfileCreationRequest) => {
		if (request.createdAgentProfileId) {
			navigate({
				search: {
					activityPreview: activityPreview ? 1 : undefined,
					profileId: request.createdAgentProfileId,
				},
				to: profileHomeRoutes.agents,
			}).catch((error: unknown) => {
				console.error("Failed to open the created Agent.", error);
			});
			return;
		}
		input.onAgentViewChange?.("requests");
	};
	const createProfileDialog = isCreateProfileOpen ? (
		<CreateProfileDialog
			allowTeammateRequests={isOrganizationContext}
			currentUserId={currentUserId}
			onAgentRequestCreated={handleAgentRequestCreated}
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
					directoryQuery={organizationProfileDirectoryQuery}
					focusProfileId={input.focusProfileId}
					initialSidebarStates={input.initialSidebarStates}
					modelCatalog={modelCatalogQuery.data ?? null}
					onCreateProfile={() => setIsCreateProfileOpen(true)}
					recovery={recovery}
					runtimeOverview={organizationAgentRuntimeOverviewQuery.data}
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
				activityPreview={activityPreview}
				agentProfileSearchQuery={agentProfileSearchQuery}
				availabilityFilter={resolveAgentProfileAvailabilityFilter(
					agentProfileFilter
				)}
				currentUserId={currentUserId}
				fallbackOwnerLabel={fallbackOwnerLabel}
				filterBadges={
					<>
						{agentGroups.badges}
						{agentProfileFilter !== "all" || agentOwnerId ? (
							<div className="flex flex-wrap gap-1 px-1 pt-1">
								{agentProfileFilter !== "all" && (
									<SidebarFilterBadge
										label={
											AGENT_PROFILE_FILTER_OPTIONS.find(
												(option) => option.value === agentProfileFilter
											)?.label ?? agentProfileFilter
										}
										onRemove={() => setAgentProfileFilter("all")}
									/>
								)}
								{agentOwnerId && (
									<SidebarFilterBadge
										label={`Owner: ${organizationProfileDirectoryQuery.data?.agentProfiles.find((profile) => profile.ownerUserId === agentOwnerId)?.ownerName ?? "Selected member"}`}
										onRemove={() => setAgentOwnerId(null)}
									/>
								)}
							</div>
						) : null}
					</>
				}
				filterControl={
					<AgentProfileFilterSelect
						counts={agentProfileFilterCounts}
						groupMenu={agentGroups.menu}
						includeOrganizationMemberFilter={isOrganizationContext}
						onOwnerChange={setAgentOwnerId}
						onValueChange={setAgentProfileFilter}
						ownerId={agentOwnerId}
						profiles={
							organizationProfileDirectoryQuery.data?.agentProfiles ?? []
						}
						value={agentProfileFilter}
					/>
				}
				focusRequestId={input.focusRequestId ?? null}
				groupFilterIds={agentGroups.selected}
				initialSidebarStates={input.initialSidebarStates}
				isOrganizationContext={isOrganizationContext}
				modelCatalog={modelCatalogQuery.data ?? null}
				onCreateAgent={() => {
					navigate({ to: buildOrganizationAgentCreationPath(orgSlug) }).catch(
						(error: unknown) => {
							console.error("Failed to open Create Agent.", error);
						}
					);
				}}
				onSelectProfile={(profileId) => {
					navigate({
						search: {
							activityPreview: activityPreview ? 1 : undefined,
							profileId,
						},
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
				ownerId={agentOwnerId}
				profileDirectoryQuery={organizationProfileDirectoryQuery}
				recovery={recovery}
				runtimeOverviewQuery={organizationAgentRuntimeOverviewQuery}
				searchControl={
					<SidebarSearchInput
						destination="agents"
						label="Search Agents"
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
	activeAgentView: AgentWorkspaceView | undefined;
	activeSectionId: ProfileHomeId;
	isOrganizationContext: boolean;
}): AgentWorkspaceView {
	return input.activeSectionId === "agents" &&
		input.activeAgentView === "requests" &&
		input.isOrganizationContext
		? "requests"
		: "agents";
}

function buildOrganizationAgentProjection(input: {
	currentUserId: string;
	ownedProfiles: readonly AuthProfileView[];
	profileDirectory: OrganizationProfileDirectoryResponse | undefined;
	runtimeOverview: OrganizationAgentRuntimeOverviewResponse | undefined;
}) {
	const profiles: AuthProfileView[] = [];
	const ownedProfilesById = new Map(
		input.ownedProfiles.map((profile) => [profile.openMeldProfileId, profile])
	);
	const profileById = new Map<
		string,
		OrganizationProfileDirectoryResponse["agentProfiles"][number]
	>();
	const operationalContextByProfileId = new Map<
		string,
		AgentProfileOperationalContextInput
	>();
	const agentControllerRefByProfileId = new Map<string, string | null>();
	const ownerAvatarUrlByUserId = new Map<string, string | null>();
	const readinessByProfileId = new Map<
		string,
		OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]["readiness"]
	>();
	for (const member of input.profileDirectory?.members ?? []) {
		ownerAvatarUrlByUserId.set(member.userId, member.user.image);
	}
	for (const profile of input.profileDirectory?.agentProfiles ?? []) {
		if (profile.managedRole === "center_agent") {
			continue;
		}
		profileById.set(profile.profileId, profile);
		agentControllerRefByProfileId.set(
			profile.profileId,
			profile.agentControllerRef
		);
		const ownedProfile = ownedProfilesById.get(profile.profileId);
		profiles.push({
			...buildAuthProfileViewFromOrganizationAgentProfile(profile),
			// The directory owns shared identity; the owner's Auth profile owns
			// saved configuration, which the directory intentionally does not expose.
			...(profile.ownerUserId === input.currentUserId && ownedProfile
				? { defaultProjectId: ownedProfile.defaultProjectId }
				: {}),
		});
	}
	for (const runtime of input.runtimeOverview?.agentProfiles ?? []) {
		readinessByProfileId.set(runtime.profileId, runtime.readiness);
		const profile = profileById.get(runtime.profileId);
		if (profile && runtime.operationalContext) {
			operationalContextByProfileId.set(
				runtime.profileId,
				projectAgentProfileOperationalContext(
					runtime.operationalContext,
					profile.ownerUserId === input.currentUserId
				)
			);
		}
	}
	return {
		agentControllerRefByProfileId,
		operationalContextByProfileId,
		ownerAvatarUrlByUserId,
		profiles,
		readinessByProfileId,
	};
}

function AgentsWorkspaceHome(input: {
	groupFilterIds: readonly string[];
	activeView: AgentWorkspaceView;
	activityPreview: boolean;
	availabilityFilter: AgentProfileAvailabilityFilter;
	ownerId: string | null;
	agentProfileSearchQuery: string;
	currentUserId: string;
	runtimeOverviewQuery: OrganizationAgentRuntimeOverviewQueryState;
	profileDirectoryQuery: OrganizationProfileDirectoryQueryState;
	fallbackOwnerLabel: string;
	filterControl: ReactNode;
	filterBadges: ReactNode;
	focusRequestId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	isOrganizationContext: boolean;
	modelCatalog: ModelCatalog | null;
	onCreateAgent: () => void;
	onSelectProfile: (profileId: string) => void;
	onViewChange: (view: AgentWorkspaceView, profileId?: string) => void;
	organizationId: string;
	orgSlug: string;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
	searchControl: ReactNode;
	selectedProfileId: string | null;
}) {
	const queryClient = useQueryClient();
	const previewReady = useAgentSidebarPreviewReady();
	const accountComputerSetupPath = buildConnectComputerPath({
		orgSlug: input.orgSlug,
	});
	const accountServiceUpdatePath = buildConnectComputerPath({
		orgSlug: input.orgSlug,
		serviceAction: "update_service",
		session: "fresh",
	});
	const organizationAgentProjection = useMemo(
		() =>
			buildOrganizationAgentProjection({
				currentUserId: input.currentUserId,
				ownedProfiles: input.recovery.agentProfiles,
				profileDirectory: input.profileDirectoryQuery.data,
				runtimeOverview: input.runtimeOverviewQuery.data,
			}),
		[
			input.currentUserId,
			input.recovery.agentProfiles,
			input.profileDirectoryQuery.data,
			input.runtimeOverviewQuery.data,
		]
	);
	const agentProfiles = organizationAgentProjection.profiles;
	const readinessByProfileId = useMemo(() => {
		if (!input.activityPreview) {
			return organizationAgentProjection.readinessByProfileId;
		}
		const previewReadiness = new Map(
			organizationAgentProjection.readinessByProfileId
		);
		for (const profile of agentProfiles) {
			const readiness = previewReadiness.get(profile.openMeldProfileId);
			if (
				profile.ownerUserId !== input.currentUserId ||
				!readiness ||
				!resolveAgentProfileActivityPreview(profile.profileName, input.orgSlug)
			) {
				continue;
			}
			previewReadiness.set(profile.openMeldProfileId, {
				...readiness,
				routeDeviceId: "device-fixture-felix",
				runtimeDeviceDisplayName: "Felix test MacBook Pro",
			});
		}
		return previewReadiness;
	}, [
		agentProfiles,
		input.activityPreview,
		input.currentUserId,
		input.orgSlug,
		organizationAgentProjection.readinessByProfileId,
	]);
	const activityPresentation = useMemo(() => {
		if (!input.activityPreview) {
			return {
				navigationByProfileId: new Map<
					string,
					AgentProfileActivityNavigation
				>(),
				operationalContextByProfileId:
					organizationAgentProjection.operationalContextByProfileId,
			};
		}
		const previewContexts = new Map(
			organizationAgentProjection.operationalContextByProfileId
		);
		const previewNavigation = new Map<string, AgentProfileActivityNavigation>();
		for (const profile of agentProfiles) {
			const preview = resolveAgentProfileActivityPreview(
				profile.profileName,
				input.orgSlug
			);
			if (preview) {
				previewContexts.set(
					profile.openMeldProfileId,
					preview.operationalContext
				);
				previewNavigation.set(profile.openMeldProfileId, preview.navigation);
			}
		}
		return {
			navigationByProfileId: previewNavigation,
			operationalContextByProfileId: previewContexts,
		};
	}, [
		agentProfiles,
		input.activityPreview,
		input.orgSlug,
		organizationAgentProjection,
	]);
	const operationalContextByProfileId =
		activityPresentation.operationalContextByProfileId;
	const errorByProfileId = useMemo(
		() =>
			input.runtimeOverviewQuery.isError
				? new Map(
						agentProfiles.map((profile) => [
							profile.openMeldProfileId,
							input.runtimeOverviewQuery.error?.message ??
								"OpenMeld couldn't load this Agent's current availability.",
						])
					)
				: EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID,
		[
			agentProfiles,
			input.runtimeOverviewQuery.error?.message,
			input.runtimeOverviewQuery.isError,
		]
	);
	const pendingProfileIds = useMemo(
		() =>
			input.runtimeOverviewQuery.isPending && !input.runtimeOverviewQuery.data
				? new Set(agentProfiles.map((profile) => profile.openMeldProfileId))
				: EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS,
		[
			agentProfiles,
			input.runtimeOverviewQuery.data,
			input.runtimeOverviewQuery.isPending,
		]
	);
	const availabilityFilteredAgentProfiles = useMemo(
		() =>
			sortAgentProfilesForDisplay({
				profiles: agentProfiles,
				readinessByProfileId,
			}).filter(
				(profile) =>
					(!input.ownerId || profile.ownerUserId === input.ownerId) &&
					(input.availabilityFilter === "all" ||
						resolveOrganizationAgentProfileAvailabilityState({
							previewReady,
							errorByProfileId,
							pendingProfileIds,
							profileId: profile.openMeldProfileId,
							readinessByProfileId,
						}) === input.availabilityFilter)
			),
		[
			agentProfiles,
			errorByProfileId,
			input.availabilityFilter,
			input.ownerId,
			previewReady,
			pendingProfileIds,
			readinessByProfileId,
		]
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
			input.ownerId !== null ||
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
		input.ownerId,
		input.selectedProfileId,
		normalizedSearchQuery,
		visibleAgentProfiles,
	]);
	const sidebarSelectedProfileId =
		(normalizedSearchQuery.length > 0 || input.ownerId !== null) &&
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
		isError: input.profileDirectoryQuery.isError,
		isPending: input.profileDirectoryQuery.isPending,
	});
	const profilesErrorMessage = input.profileDirectoryQuery.error?.message;
	let requestPanel: ReactNode = null;
	if (input.profileDirectoryQuery.data) {
		requestPanel = (
			<AgentProfileCreationRequestsPanel
				currentUserId={input.currentUserId}
				directory={input.profileDirectoryQuery.data}
				focusRequestId={input.focusRequestId}
				onCreateAgent={input.onCreateAgent}
				onOpenAgent={(profileId) => {
					input.onViewChange("agents", profileId);
				}}
				organizationId={input.organizationId}
				storageScope={input.recovery.storageScope}
			/>
		);
	} else if (input.profileDirectoryQuery.isError) {
		requestPanel = (
			<p className="rounded-md border border-destructive/30 px-4 py-4 text-destructive text-sm">
				{input.profileDirectoryQuery.error?.message ??
					"Couldn’t load Agent requests."}
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
		<AgentsWorkspaceHomeView
			accountComputerSetupPath={accountComputerSetupPath}
			accountServiceUpdatePath={accountServiceUpdatePath}
			activityPresentation={activityPresentation}
			agentControllerRefByProfileId={
				organizationAgentProjection.agentControllerRefByProfileId
			}
			agentProfiles={agentProfiles}
			errorByProfileId={errorByProfileId}
			input={input}
			normalizedSearchQuery={normalizedSearchQuery}
			operationalContextByProfileId={operationalContextByProfileId}
			ownerAvatarUrlByUserId={
				organizationAgentProjection.ownerAvatarUrlByUserId
			}
			pendingProfileIds={pendingProfileIds}
			pendingRequestCount={pendingRequestCount}
			profilesErrorMessage={profilesErrorMessage}
			profilesStatus={profilesStatus}
			queryClient={queryClient}
			readinessByProfileId={readinessByProfileId}
			requestPanel={requestPanel}
			sidebarAgentProfiles={sidebarAgentProfiles}
			sidebarSelectedProfileId={sidebarSelectedProfileId}
		/>
	);
}

function AgentsWorkspaceHomeView(input: {
	accountComputerSetupPath: string;
	accountServiceUpdatePath: string;
	activityPresentation: {
		navigationByProfileId: ReadonlyMap<string, AgentProfileActivityNavigation>;
		operationalContextByProfileId: ReadonlyMap<
			string,
			AgentProfileOperationalContextInput
		>;
	};
	agentProfiles: readonly AuthProfileView[];
	agentControllerRefByProfileId: ReadonlyMap<string, string | null>;
	errorByProfileId: ReadonlyMap<string, string>;
	input: Parameters<typeof AgentsWorkspaceHome>[0];
	normalizedSearchQuery: string;
	operationalContextByProfileId: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	ownerAvatarUrlByUserId: ReadonlyMap<string, string | null>;
	pendingProfileIds: ReadonlySet<string>;
	pendingRequestCount: number;
	profilesErrorMessage: string | undefined;
	profilesStatus: "error" | "loading" | "ready";
	queryClient: ReturnType<typeof useQueryClient>;
	readinessByProfileId: ReadonlyMap<
		string,
		OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]["readiness"]
	>;
	requestPanel: ReactNode;
	sidebarAgentProfiles: readonly AuthProfileView[];
	sidebarSelectedProfileId: string | null;
}) {
	const workspace = input.input;
	const wakeAvailabilityNowMs = useMinuteNowMs();
	return (
		<AgentProfilesWorkspace
			activeView={workspace.activeView}
			agentControllerRefByProfileId={input.agentControllerRefByProfileId}
			currentUserId={workspace.currentUserId}
			filterBadges={workspace.filterBadges}
			filterControl={workspace.filterControl}
			groupFilterIds={workspace.groupFilterIds}
			hasAnyProfiles={input.agentProfiles.length > 0}
			initialSidebarStates={workspace.initialSidebarStates}
			isOrganizationContext={workspace.isOrganizationContext}
			isSearchActive={input.normalizedSearchQuery.length > 0}
			modelCatalog={workspace.modelCatalog}
			onCreateAgent={workspace.onCreateAgent}
			onSelectProfile={workspace.onSelectProfile}
			onViewChange={workspace.onViewChange}
			operationalContextByProfileId={input.operationalContextByProfileId}
			pendingRequestCount={input.pendingRequestCount}
			profiles={input.sidebarAgentProfiles}
			profilesErrorMessage={input.profilesErrorMessage}
			profilesStatus={input.profilesStatus}
			readinessByProfileId={input.readinessByProfileId}
			readinessErrorByProfileId={input.errorByProfileId}
			readinessPendingProfileIds={input.pendingProfileIds}
			renderProfileDetail={(profile) => (
				<AgentProfilesCard
					agentControllerRefByProfileId={input.agentControllerRefByProfileId}
					agentExecutionReadinessByProfileId={input.readinessByProfileId}
					agentExecutionReadinessErrorByProfileId={input.errorByProfileId}
					agentExecutionReadinessIsRefreshing={
						workspace.runtimeOverviewQuery.isFetching === true &&
						workspace.runtimeOverviewQuery.data !== undefined
					}
					agentExecutionReadinessPendingProfileIds={input.pendingProfileIds}
					agentProfileActivityNavigationByProfileId={
						input.activityPresentation.navigationByProfileId
					}
					agentProfileOperationalContextByProfileId={
						input.operationalContextByProfileId
					}
					agentProfiles={input.agentProfiles}
					agentProfilesQueryState={{ isError: false, isPending: false }}
					availabilityFilter="all"
					canManageProfile={(candidate) =>
						candidate.ownerUserId === workspace.currentUserId
					}
					fallbackOwnerLabel={workspace.fallbackOwnerLabel}
					focusProfileId={profile.openMeldProfileId}
					isCurrentComputer={true}
					key={profile.openMeldProfileId}
					ownerAvatarUrlByUserId={input.ownerAvatarUrlByUserId}
					presentation="detail"
					queryClient={input.queryClient}
					recovery={workspace.recovery}
					serviceUpdatePath={input.accountServiceUpdatePath}
					setupPath={input.accountComputerSetupPath}
					wakeAvailabilityNowMs={wakeAvailabilityNowMs}
				/>
			)}
			renderProfilesController={() => (
				<AgentProfilesCard
					agentControllerRefByProfileId={input.agentControllerRefByProfileId}
					agentExecutionReadinessByProfileId={input.readinessByProfileId}
					agentExecutionReadinessErrorByProfileId={input.errorByProfileId}
					agentExecutionReadinessIsRefreshing={
						workspace.runtimeOverviewQuery.isFetching === true &&
						workspace.runtimeOverviewQuery.data !== undefined
					}
					agentExecutionReadinessPendingProfileIds={input.pendingProfileIds}
					agentProfileOperationalContextByProfileId={
						input.operationalContextByProfileId
					}
					agentProfiles={input.agentProfiles}
					agentProfilesQueryState={{ isError: false, isPending: false }}
					availabilityFilter="all"
					canManageProfile={(candidate) =>
						candidate.ownerUserId === workspace.currentUserId
					}
					fallbackOwnerLabel={workspace.fallbackOwnerLabel}
					focusProfileId={null}
					isCurrentComputer={true}
					ownerAvatarUrlByUserId={input.ownerAvatarUrlByUserId}
					presentation="controller"
					queryClient={input.queryClient}
					recovery={workspace.recovery}
					serviceUpdatePath={input.accountServiceUpdatePath}
					setupPath={input.accountComputerSetupPath}
					wakeAvailabilityNowMs={wakeAvailabilityNowMs}
				/>
			)}
			requestPanel={input.requestPanel}
			searchControl={workspace.searchControl}
			selectedProfileId={input.sidebarSelectedProfileId}
			showAgentRequests={workspace.isOrganizationContext}
		/>
	);
}

function useMinuteNowMs(): number {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const intervalId = window.setInterval(() => {
			setNowMs(Date.now());
		}, 60_000);
		return () => window.clearInterval(intervalId);
	}, []);
	return nowMs;
}

function matchesAgentProfileSearch(input: {
	profile: AuthProfileView;
	query: string;
	readiness:
		| OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]["readiness"]
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
	groupMenu: ReactNode;
	counts: AgentProfileAvailabilityFilterCounts;
	includeOrganizationMemberFilter: boolean;
	onValueChange: (value: AgentProfileListFilter) => void;
	value: AgentProfileListFilter;
	ownerId: string | null;
	onOwnerChange: (id: string | null) => void;
	profiles: readonly Pick<AuthProfileView, "ownerUserId" | "ownerName">[];
}) {
	const owners = [
		...new Map(
			input.profiles.map((p) => [
				p.ownerUserId,
				p.ownerName?.trim() || "Unknown member",
			])
		).entries(),
	].sort((a, b) => a[1].localeCompare(b[1]));
	const displayValue =
		AGENT_PROFILE_FILTER_OPTIONS.find((o) => o.value === input.value)?.label ??
		"All";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`Filter Agents. Current filter: ${displayValue}, ${resolveAgentProfileListFilterCount({ counts: input.counts, value: input.value })} ${resolveAgentProfileListFilterCount({ counts: input.counts, value: input.value }) === 1 ? "Agent" : "Agents"}.`}
						className="size-6 [&_svg]:size-3.5"
						size="icon"
						variant="ghost"
					/>
				}
			>
				<FunnelSimpleIcon />
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent
				align="end"
				className="w-60 max-w-[calc(100vw-2rem)]"
			>
				{AGENT_PROFILE_FILTER_OPTIONS.map((option, index) => (
					<FluidDropdownMenuItem
						aria-label={`${option.label}, ${resolveAgentProfileListFilterCount({ counts: input.counts, value: option.value })} ${resolveAgentProfileListFilterCount({ counts: input.counts, value: option.value }) === 1 ? "Agent" : "Agents"}`}
						index={index}
						key={option.value}
						onClick={() => input.onValueChange(option.value)}
					>
						<span className="w-4">
							{input.value === option.value ? "✓" : ""}
						</span>
						<span className="min-w-0 flex-1 text-left">{option.label}</span>
						<span className="text-muted-foreground">
							{resolveAgentProfileListFilterCount({
								counts: input.counts,
								value: option.value,
							})}
						</span>
					</FluidDropdownMenuItem>
				))}
				{input.groupMenu}
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						Owner:{" "}
						{input.ownerId
							? (owners.find((o) => o[0] === input.ownerId)?.[1] ??
								"Selected member")
							: "Anyone"}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
						<FluidDropdownMenuItem
							index={0}
							onClick={() => input.onOwnerChange(null)}
						>
							Anyone
						</FluidDropdownMenuItem>
						{owners.map(([id, name], index) => (
							<FluidDropdownMenuItem
								index={index + 1}
								key={id}
								onClick={() => input.onOwnerChange(id)}
							>
								<span className="w-4">{input.ownerId === id ? "✓" : ""}</span>
								{name}
							</FluidDropdownMenuItem>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			</FluidDropdownMenuContent>
		</DropdownMenu>
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

type OrganizationProfileDirectoryQueryState = {
	data?: OrganizationProfileDirectoryResponse;
	error: { message?: string } | null;
	isError: boolean;
	isPending: boolean;
};

type OrganizationAgentRuntimeOverviewQueryState = {
	data?: OrganizationAgentRuntimeOverviewResponse;
	error: { message?: string } | null;
	isError: boolean;
	isFetching?: boolean;
	isPending: boolean;
};

function summarizeOrganizationAgentProfileAvailabilityFilters(input: {
	previewReady?: boolean;
	profiles: readonly OrganizationProfileDirectoryResponse["agentProfiles"][number][];
	runtimeOverview?: OrganizationAgentRuntimeOverviewResponse;
	runtimeOverviewFailed: boolean;
	runtimeOverviewPending: boolean;
}): AgentProfileAvailabilityFilterCounts {
	const summary: AgentProfileAvailabilityFilterCounts = {
		all: input.profiles.length,
		available: 0,
		checking: 0,
		offline: 0,
		unavailable: 0,
	};
	const readinessByProfileId = new Map(
		(input.runtimeOverview?.agentProfiles ?? []).map((profile) => [
			profile.profileId,
			profile.readiness,
		])
	);
	const errorByProfileId = input.runtimeOverviewFailed
		? new Map(
				input.profiles.map((profile) => [profile.profileId, "unavailable"])
			)
		: EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID;
	const pendingProfileIds = input.runtimeOverviewPending
		? new Set(input.profiles.map((profile) => profile.profileId))
		: EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS;
	for (const profile of input.profiles) {
		const category = resolveOrganizationAgentProfileAvailabilityState({
			previewReady: input.previewReady,
			errorByProfileId,
			pendingProfileIds,
			profileId: profile.profileId,
			readinessByProfileId,
		});
		summary[category] += 1;
	}
	return summary;
}

function resolveOrganizationAgentProfileAvailabilityState(input: {
	previewReady?: boolean;
	errorByProfileId: ReadonlyMap<string, string>;
	pendingProfileIds: ReadonlySet<string>;
	profileId: string;
	readinessByProfileId: ReadonlyMap<
		string,
		OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]["readiness"]
	>;
}): Exclude<AgentProfileAvailabilityFilter, "all"> {
	const preview = localAgentSidebarState(input.profileId, input.previewReady);
	if (preview) {
		return preview === "connect" ? "unavailable" : preview;
	}
	const readiness = input.readinessByProfileId.get(input.profileId);
	if (readiness) {
		return resolveAgentWakeAvailabilityDisplayCategory(
			readiness.agentWakeAvailability
		);
	}
	if (input.pendingProfileIds.has(input.profileId)) {
		return "checking";
	}
	if (input.errorByProfileId.has(input.profileId)) {
		return "checking";
	}
	return "checking";
}

function buildAuthProfileViewFromOrganizationAgentProfile(
	profile: OrganizationProfileDirectoryResponse["agentProfiles"][number]
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

function projectAgentProfileOperationalContext(
	operationalContext: NonNullable<
		OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]["operationalContext"]
	>,
	isOwner: boolean
): AgentProfileOperationalContextInput {
	const hasWorkLocations =
		operationalContext.status === "working" ||
		operationalContext.status === "paused";
	return {
		currentWorkLocation:
			isOwner && hasWorkLocations
				? (operationalContext.currentWorkLocation?.spaceName ?? null)
				: null,
		queuedWorkLocations:
			isOwner && hasWorkLocations
				? (operationalContext.queuedWorkLocations?.map(
						(location) => location.spaceName
					) ?? [])
				: [],
		recoveryAction:
			isOwner &&
			operationalContext.status === "paused" &&
			operationalContext.recoveryAction
				? { kind: operationalContext.recoveryAction }
				: null,
		...(isOwner &&
		operationalContext.status === "paused" &&
		operationalContext.recoveryTargetWakeLifecycleId
			? {
					recoveryTargetWakeLifecycleId:
						operationalContext.recoveryTargetWakeLifecycleId,
				}
			: {}),
		status: operationalContext.status,
		waitingCount: hasWorkLocations ? operationalContext.waitingCount : 0,
	};
}
