import { SkeletonTable } from "@openmeld/ui/components/skeleton-content";
import { agentCreationNeedsAttention } from "#/components/agents/agent-creation-history-model";
import { deleteAgentProfiles } from "#/components/agents/delete-agent-profiles";
import { readPendingAgentProfileCreationLocalSetup } from "#/lib/profiles/agent-profile-creation-local-setup";

("use client");

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
import type { HarnessKind } from "@openmeld/schemas";
import type {
	AuthProfileView,
	ModelCatalog,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type ReactNode,
	useEffect,
	useEffectEvent,
	useMemo,
	useState,
} from "react";
import { resolveTaskActivityAvailability } from "#/components/agents/agent-list-model";
import {
	type AgentProfileActivityNavigation,
	resolveAgentProfileActivityPreview,
} from "#/components/agents/agent-profile-activity-preview";
import { AgentProfileCreationRequestsPanel } from "#/components/agents/agent-profile-creation-requests-panel";
import {
	AgentProfilesWorkspace,
	type AgentProfilesWorkspaceProps,
} from "#/components/agents/agent-profiles-workspace";
import { AgentResolutionPage } from "#/components/agents/agent-resolution-page";
import { AgentProfilesCard } from "#/components/agents/agents-page-agent-profiles-card";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { DirectoryMembersOverview } from "#/components/directory/directory-members-overview";
import { ColleagueAgentPageSidebar } from "#/components/member-agents/colleague-agent-page-sidebar";
import { UnknownMemberAgentNotice } from "#/components/member-agents/member-agent-detail";
import { MemberAgentPageProvider } from "#/components/member-agents/member-agent-page-context";
import { MemberAgentPageSidebar } from "#/components/member-agents/member-agent-page-sidebar";
import { useMemberAgentDirectory } from "#/components/member-agents/use-member-agent-directory";
import { useMemberAgentSync } from "#/components/member-agents/use-member-agents";
import { CreateProfileDialog } from "#/components/profiles/create-profile-dialog";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { isLocalWebOrigin } from "#/lib/local-web-origin";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentsPath,
	buildOrganizationPersonAgentPath,
	buildOrganizationPersonAgentsPath,
	buildOrganizationPersonPath,
} from "#/lib/organizations/organization-routes";
import { buildProfileHomeRoutes } from "#/lib/profile-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationProfileDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import {
	agentProfileCreationRequestsQueryOptions,
	optimisticAgentProfileCreationsQueryOptions,
	removeOptimisticAgentProfileCreation,
} from "#/query/profiles/agent-profile-creation-requests";
import { startQueryKeys } from "#/query/query-keys";
import { resolveAgentListReturn } from "./agent-list-return";

export type ProfileHomeId = "agents" | "people";
type AgentWorkspaceView = "agents" | "requests";

const EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID: ReadonlyMap<
	string,
	string
> = new Map();
const EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS: ReadonlySet<string> =
	new Set();

export function PeopleAndAgentsPage(input: {
	returnToAgentDirectory?: boolean;
	personId?: string;
	activityPreview?: boolean;
	activeAgentView?: AgentWorkspaceView;
	activeSectionId: ProfileHomeId;
	focusRequestId?: string | null;
	focusProfileId: string | null;
	focusMemberAgentId?: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	onAgentViewChange?: (view: AgentWorkspaceView, profileId?: string) => void;
}) {
	const account = useAppShellAccount();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const profileHomeRoutes = buildProfileHomeRoutes(orgSlug);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCreateProfileOpen, setIsCreateProfileOpen] = useState(false);
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
			enabled: input.activeSectionId === "agents",
			organizationId: currentOrganization.id,
		})
	);
	const person = organizationProfileDirectoryQuery.data?.members.find(
		(member) =>
			(member.humanProfile?.profileId ?? `member:${member.memberId}`) ===
			input.personId
	);
	const scopedOwnerId = person?.userId ?? null;
	const modelCatalogQuery = useQuery(modelCatalogQueryOptions());
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
				profileId: profile.openMeldProfileId,
			},
			to: targetRoute,
		}).catch((error: unknown) => {
			console.error("Failed to open the created profile.", error);
		});
	};
	const createProfileDialog = isCreateProfileOpen ? (
		<CreateProfileDialog
			allowTeammateRequests={isOrganizationContext}
			currentUserId={currentUserId}
			onAgentRequestAccepted={(request, optimisticId) => {
				if (
					new URLSearchParams(window.location.search).get("requestId") !==
					optimisticId
				) {
					return;
				}
				input.onAgentViewChange?.("agents", request.id);
			}}
			onAgentRequestStarted={(creation) => {
				setIsCreateProfileOpen(false);
				input.onAgentViewChange?.("agents", creation.id);
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
					directoryQuery={organizationProfileDirectoryQuery}
					focusProfileId={input.focusProfileId}
					initialSidebarStates={input.initialSidebarStates}
					modelCatalog={modelCatalogQuery.data ?? null}
					onCreateProfile={() => setIsCreateProfileOpen(true)}
					recovery={recovery}
					storageScope={recovery.storageScope}
				/>
				{createProfileDialog}
			</>
		);
	}
	if (input.personId && !person) {
		return (
			<AgentResolutionPage
				detail={Boolean(input.focusProfileId)}
				error={organizationProfileDirectoryQuery.isError}
				initialSidebarStates={input.initialSidebarStates}
				isPending={organizationProfileDirectoryQuery.isPending}
				isRetrying={organizationProfileDirectoryQuery.isFetching}
				message={
					organizationProfileDirectoryQuery.isError
						? "Couldn’t load this member."
						: "Member not found in this workspace."
				}
				onRetry={
					organizationProfileDirectoryQuery.isError
						? () => {
								organizationProfileDirectoryQuery
									.refetch()
									.catch(console.error);
							}
						: undefined
				}
			/>
		);
	}
	return (
		<>
			<AgentsWorkspaceHome
				activeView={activeAgentView}
				activityPreview={activityPreview}
				agentListReturn={resolveAgentListReturn({
					agentsPath: profileHomeRoutes.agents,
					returnToAgentDirectory: input.returnToAgentDirectory,
				})}
				currentUserId={currentUserId}
				fallbackOwnerLabel={fallbackOwnerLabel}
				focusRequestId={input.focusRequestId ?? null}
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
					const directory = organizationProfileDirectoryQuery.data;
					const ownerUserId = directory?.agentProfiles.find(
						(profile) => profile.profileId === profileId
					)?.ownerUserId;
					const owner = directory?.members.find(
						(member) => member.userId === ownerUserId
					);
					const resolvedPersonId = owner
						? (owner.humanProfile?.profileId ?? `member:${owner.memberId}`)
						: null;
					const personId = input.personId ?? resolvedPersonId;
					navigate({
						search:
							input.returnToAgentDirectory || (!input.personId && personId)
								? { from: "agents" }
								: undefined,
						to: personId
							? buildOrganizationPersonAgentPath({
									orgSlug,
									personId,
									agentId: profileId,
								})
							: `${profileHomeRoutes.agents}?profileId=${encodeURIComponent(profileId)}`,
					}).catch((error: unknown) => {
						console.error("Failed to open the selected Agent.", error);
					});
				}}
				onViewChange={(view, profileId) =>
					input.onAgentViewChange?.(view, profileId)
				}
				organizationId={currentOrganization.id}
				orgSlug={orgSlug}
				ownerId={scopedOwnerId}
				person={
					person && input.personId
						? {
								id: input.personId,
								name: person.user.name,
								path: buildOrganizationPersonPath({
									orgSlug,
									personId: input.personId,
								}),
								agentsPath: buildOrganizationPersonAgentsPath({
									orgSlug,
									personId: input.personId,
								}),
							}
						: undefined
				}
				profileDirectoryQuery={organizationProfileDirectoryQuery}
				recovery={recovery}
				runtimeOverviewQuery={organizationAgentRuntimeOverviewQuery}
				selectedMemberAgentId={input.focusMemberAgentId ?? null}
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
	agentListReturn?: { to: string; label: string };
	person?: { id: string; name: string; path: string; agentsPath: string };
	activeView: AgentWorkspaceView;
	activityPreview: boolean;
	ownerId: string | null;
	currentUserId: string;
	runtimeOverviewQuery: OrganizationAgentRuntimeOverviewQueryState;
	profileDirectoryQuery: OrganizationProfileDirectoryQueryState;
	fallbackOwnerLabel: string;
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
	selectedProfileId: string | null;
	selectedMemberAgentId: string | null;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	useMemberAgentSync();
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
	const agentProfiles = useMemo(
		() =>
			organizationAgentProjection.profiles.filter(
				(profile) => !input.ownerId || profile.ownerUserId === input.ownerId
			),
		[organizationAgentProjection.profiles, input.ownerId]
	);
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
	const sidebarAgentProfiles = agentProfiles;
	const sidebarSelectedProfileId = input.selectedProfileId;
	const requestsQuery = useQuery(
		agentProfileCreationRequestsQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const optimisticCreationsQuery = useQuery(
		optimisticAgentProfileCreationsQueryOptions(input.organizationId)
	);
	const optimisticCreations = Array.isArray(optimisticCreationsQuery.data)
		? optimisticCreationsQuery.data
		: [];
	const creationAttentionCount =
		requestsQuery.data?.requests?.filter(
			(request) =>
				request.requesterUserId === input.currentUserId &&
				request.targetOwnerUserId === input.currentUserId &&
				agentCreationNeedsAttention(
					request,
					Boolean(
						readPendingAgentProfileCreationLocalSetup({
							organizationId: input.organizationId,
							requestId: request.id,
							storageScope: input.recovery.storageScope,
						})
					)
				)
		).length ?? 0;
	const selectCreatedProfile = useEffectEvent(input.onSelectProfile);
	useEffect(() => {
		let cancelled = false;
		if (!input.focusRequestId) {
			return;
		}
		const focusedRequest = requestsQuery.data?.requests.find(
			(request) => request.id === input.focusRequestId
		);
		if (
			focusedRequest?.status === "completed" &&
			focusedRequest.createdAgentProfileId
		) {
			const createdAgentProfileId = focusedRequest.createdAgentProfileId;
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: startQueryKeys.profilesForStorageScope(
						input.recovery.storageScope
					),
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.profileDirectory(
						input.organizationId
					),
				}),
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.agentRuntimeOverview(
						input.organizationId
					),
				}),
			])
				.then(() => {
					if (!cancelled) {
						selectCreatedProfile(createdAgentProfileId);
					}
				})
				.catch((error: unknown) => {
					console.error("Failed to open the created Agent.", error);
				});
		}
		return () => {
			cancelled = true;
		};
	}, [
		input.focusRequestId,
		input.organizationId,
		input.recovery.storageScope,
		queryClient,
		requestsQuery.data,
	]);
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
				onOpenRequest={(requestId) => input.onViewChange("requests", requestId)}
				organizationId={input.organizationId}
				orgSlug={input.orgSlug}
				storageScope={input.recovery.storageScope}
			/>
		);
	} else if (input.profileDirectoryQuery.isError) {
		requestPanel = (
			<p className="rounded-md border border-destructive/30 px-4 py-4 text-destructive text-sm">
				{input.profileDirectoryQuery.error?.message ??
					"Couldn’t load Agent creation history."}
			</p>
		);
	} else if (input.isOrganizationContext) {
		requestPanel = (
			<SkeletonTable columns={4} label="Loading Agent creation history" />
		);
	}

	const runtimeOverviewByProfileId = useMemo(
		() =>
			new Map(
				(input.runtimeOverviewQuery.data?.agentProfiles ?? []).map((item) => [
					item.profileId,
					item,
				])
			),
		[input.runtimeOverviewQuery.data]
	);
	const memberAgentDirectory = useMemberAgentDirectory({
		profiles: agentProfiles,
		runtimeByProfileId: runtimeOverviewByProfileId,
	});
	const [pinnedHarnessKind, setPinnedHarnessKind] =
		useState<HarnessKind | null>(null);
	// The Agent page is its Profile's page: opened by MemberAgent it shows
	// the default Profile; a Profile of the viewer's own Agent shows its Agent.
	const memberAgentPageRow =
		memberAgentDirectory?.rows.find((row) =>
			input.selectedMemberAgentId
				? row.memberAgentId === input.selectedMemberAgentId
				: row.profiles.some(
						(profile) => profile.openMeldProfileId === input.selectedProfileId
					)
		) ?? null;
	const memberAgentPageProfile = memberAgentPageRow
		? (memberAgentPageRow.profiles.find(
				(profile) =>
					profile.openMeldProfileId ===
					(input.selectedProfileId ?? memberAgentPageRow.defaultProfileId)
			) ??
			memberAgentPageRow.profiles[0] ??
			null)
		: null;
	const memberAgents = memberAgentDirectory
		? {
				onOpenMemberAgent: (memberAgentId: string) => {
					navigate({
						to: buildOrganizationAgentsPath(input.orgSlug),
						search: { memberAgentId },
					}).catch(console.error);
				},
				selectedMemberAgentId: input.selectedMemberAgentId,
				renderMemberAgentDetail: (
					_memberAgentId: string,
					renderProfile: (profile: AuthProfileView) => ReactNode
				) =>
					memberAgentPageProfile ? (
						renderProfile(memberAgentPageProfile)
					) : (
						<UnknownMemberAgentNotice
							agentsPath={buildOrganizationAgentsPath(input.orgSlug)}
						/>
					),
				memberAgentSidebar: memberAgentPageRow ? (
					<MemberAgentPageSidebar
						activeProfileId={memberAgentPageProfile?.openMeldProfileId ?? null}
						defaultProfileId={memberAgentPageRow.defaultProfileId}
						displayName={memberAgentPageRow.displayName}
						harnessKind={memberAgentPageRow.harnessKind}
						memberAgentId={memberAgentPageRow.memberAgentId}
						onSelectProfile={input.onSelectProfile}
						profiles={memberAgentPageRow.profiles}
					/>
				) : (
					renderColleagueAgentSidebar({
						agentControllerRefByProfileId:
							organizationAgentProjection.agentControllerRefByProfileId,
						currentUserId: input.currentUserId,
						members: input.profileDirectoryQuery.data?.members ?? [],
						onSelectProfile: input.onSelectProfile,
						profiles: agentProfiles,
						selectedProfileId: input.selectedProfileId,
					})
				),
			}
		: null;
	const memberAgentPage = memberAgentPageRow
		? {
				row: memberAgentPageRow,
				onCreateProfile:
					memberAgentPageRow.harnessKind === "hosted"
						? undefined
						: () => setPinnedHarnessKind(memberAgentPageRow.harnessKind),
			}
		: null;
	return (
		<MemberAgentPageProvider value={memberAgentPage}>
			<AgentsWorkspaceHomeView
				accountComputerSetupPath={accountComputerSetupPath}
				accountServiceUpdatePath={accountServiceUpdatePath}
				activityPresentation={activityPresentation}
				agentControllerRefByProfileId={
					organizationAgentProjection.agentControllerRefByProfileId
				}
				agentProfiles={agentProfiles}
				creationAttentionCount={creationAttentionCount}
				creationRequests={[
					...optimisticCreations,
					...(requestsQuery.data?.requests ?? []),
				]}
				errorByProfileId={errorByProfileId}
				input={input}
				memberAgents={memberAgents}
				operationalContextByProfileId={operationalContextByProfileId}
				ownerAvatarUrlByUserId={
					organizationAgentProjection.ownerAvatarUrlByUserId
				}
				pendingProfileIds={pendingProfileIds}
				profilesErrorMessage={profilesErrorMessage}
				profilesStatus={profilesStatus}
				queryClient={queryClient}
				readinessByProfileId={readinessByProfileId}
				requestPanel={requestPanel}
				runtimeOverviewByProfileId={runtimeOverviewByProfileId}
				sidebarAgentProfiles={sidebarAgentProfiles}
				sidebarSelectedProfileId={sidebarSelectedProfileId}
			/>
			{pinnedHarnessKind ? (
				<CreateProfileDialog
					agentOnly
					allowTeammateRequests={false}
					currentUserId={input.currentUserId}
					onOpenChange={(open) => {
						if (!open) {
							setPinnedHarnessKind(null);
						}
					}}
					onProfileCreated={(profile) => {
						setPinnedHarnessKind(null);
						Promise.all([
							queryClient.invalidateQueries({
								queryKey: memberAgentQueryKeys.all(input.organizationId),
							}),
							queryClient.invalidateQueries({
								queryKey: organizationQueryKeys.profileDirectory(
									input.organizationId
								),
							}),
						])
							.then(() => input.onSelectProfile(profile.openMeldProfileId))
							.catch(console.error);
					}}
					open={true}
					organizationId={input.organizationId}
					pinnedHarnessKind={pinnedHarnessKind}
					recovery={input.recovery}
				/>
			) : null}
		</MemberAgentPageProvider>
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
	creationRequests: NonNullable<
		AgentProfilesWorkspaceProps["creationRequests"]
	>;
	agentControllerRefByProfileId: ReadonlyMap<string, string | null>;
	errorByProfileId: ReadonlyMap<string, string>;
	input: Parameters<typeof AgentsWorkspaceHome>[0];
	operationalContextByProfileId: ReadonlyMap<
		string,
		AgentProfileOperationalContextInput
	>;
	ownerAvatarUrlByUserId: ReadonlyMap<string, string | null>;
	pendingProfileIds: ReadonlySet<string>;
	creationAttentionCount: number;
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
	runtimeOverviewByProfileId: ReadonlyMap<
		string,
		OrganizationAgentRuntimeOverviewResponse["agentProfiles"][number]
	>;
	memberAgents: Pick<
		AgentProfilesWorkspaceProps,
		| "onOpenMemberAgent"
		| "selectedMemberAgentId"
		| "renderMemberAgentDetail"
		| "memberAgentSidebar"
	> | null;
}) {
	const workspace = input.input;
	const wakeAvailabilityNowMs = useMinuteNowMs();
	return (
		<AgentProfilesWorkspace
			{...input.memberAgents}
			activeView={workspace.activeView}
			agentControllerRefByProfileId={input.agentControllerRefByProfileId}
			agentListReturn={workspace.agentListReturn}
			canCreateAgent={
				!workspace.ownerId || workspace.ownerId === workspace.currentUserId
			}
			creationAttentionCount={input.creationAttentionCount}
			creationRequests={input.creationRequests}
			currentUserId={workspace.currentUserId}
			directoryProfiles={
				workspace.profileDirectoryQuery.data?.agentProfiles ?? []
			}
			hasAnyProfiles={input.agentProfiles.length > 0}
			initialSidebarStates={workspace.initialSidebarStates}
			isOrganizationContext={workspace.isOrganizationContext}
			lastTaskActivityByProfileId={
				new Map(
					(workspace.runtimeOverviewQuery.data?.agentProfiles ?? []).map(
						(profile) => [profile.profileId, profile.lastTaskActivityAt ?? null]
					)
				)
			}
			members={workspace.profileDirectoryQuery.data?.members ?? []}
			modelCatalog={workspace.modelCatalog}
			onCreateAgent={workspace.onCreateAgent}
			onDeleteProfiles={(profiles) =>
				deleteAgentProfiles({
					profiles,
					currentUserId: workspace.currentUserId,
					organizationId: workspace.organizationId,
					queryClient: input.queryClient,
					storageScope: workspace.recovery.storageScope,
				})
			}
			onDismissCreation={(id) =>
				removeOptimisticAgentProfileCreation({
					id,
					organizationId: workspace.organizationId,
					queryClient: input.queryClient,
				})
			}
			onOpenCreationRequest={(requestId) =>
				workspace.onViewChange("requests", requestId)
			}
			onSelectProfile={workspace.onSelectProfile}
			onViewChange={workspace.onViewChange}
			operationalContextByProfileId={input.operationalContextByProfileId}
			person={workspace.person}
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
			runtimeOverviewByProfileId={input.runtimeOverviewByProfileId}
			selectedProfileId={input.sidebarSelectedProfileId}
			showAgentRequests={workspace.isOrganizationContext}
			taskActivityAvailable={resolveTaskActivityAvailability(
				workspace.runtimeOverviewQuery.data
			)}
		/>
	);
}

/**
 * A colleague's Agent page gets the same chats sidebar as the viewer's own
 * Agent, never the folded list of the owner's Agents.
 */
function renderColleagueAgentSidebar(input: {
	agentControllerRefByProfileId: ReadonlyMap<string, string | null>;
	currentUserId: string;
	members: NonNullable<
		OrganizationProfileDirectoryQueryState["data"]
	>["members"];
	onSelectProfile: (profileId: string) => void;
	profiles: readonly AuthProfileView[];
	selectedProfileId: string | null;
}): ReactNode {
	const ownerUserId = input.profiles.find(
		(profile) => profile.openMeldProfileId === input.selectedProfileId
	)?.ownerUserId;
	if (!ownerUserId || ownerUserId === input.currentUserId) {
		return undefined;
	}
	const owner = input.members.find((member) => member.userId === ownerUserId);
	return (
		<ColleagueAgentPageSidebar
			agentControllerRefByProfileId={input.agentControllerRefByProfileId}
			onSelectProfile={input.onSelectProfile}
			ownerName={owner?.humanProfile?.profileName ?? owner?.user.name ?? ""}
			profiles={input.profiles}
			selectedProfileId={input.selectedProfileId}
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

function resolveAgentProfilesStatus(input: {
	isError: boolean;
	isPending: boolean;
}): "error" | "loading" | "ready" {
	if (input.isPending) {
		return "loading";
	}
	return input.isError ? "error" : "ready";
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

function buildAuthProfileViewFromOrganizationAgentProfile(
	profile: OrganizationProfileDirectoryResponse["agentProfiles"][number]
): AuthProfileView {
	return {
		avatarStyle: profile.avatarStyle,
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
