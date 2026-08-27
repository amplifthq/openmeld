"use client";

import { resolveAgentWakeAvailabilityDisplayCategory } from "@openmeld/agent-runtime";
import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	TabsSubtle,
	TabsSubtleItem,
	TabsSubtlePanel,
} from "@openmeld/ui/fluid/tabs-subtle";
import { FunnelSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { AgentProfileCreationRequestsPanel } from "#/components/agents/agent-profile-creation-requests-panel";
import {
	type AgentProfileAvailabilityFilter,
	type AgentProfileAvailabilityFilterCounts,
	summarizeAgentProfileAvailabilityFilters,
} from "#/components/agents/agents-page-agent-profile-helpers";
import { AgentProfilesCard } from "#/components/agents/agents-page-agent-profiles-card";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { DirectoryMembersOverview } from "#/components/directory/directory-members-overview";
import { CreateProfileDialog } from "#/components/profiles/create-profile-dialog";
import { ProfilesSectionLayout } from "#/components/profiles/profiles-section-layout";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildProfileHomeRoutes } from "#/lib/profile-routes";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
} from "#/lib/sidebar-width-cookie";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
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

const PROFILE_HOME_COPY = {
	agents: {
		title: "Agents",
	},
	people: {
		title: "People",
	},
} as const satisfies Record<ProfileHomeId, { title: string }>;

export function PeopleAndAgentsPage(input: {
	activeAgentView?: "agents" | "requests";
	activeSectionId: ProfileHomeId;
	focusRequestId?: string | null;
	focusProfileId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	onAgentViewChange?: (view: "agents" | "requests") => void;
	onFocusConsumed?: () => void;
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
	const activeSectionCopy = PROFILE_HOME_COPY[input.activeSectionId];
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
		loadSetupState: false,
	});
	const organizationDirectoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: isOrganizationContext,
			organizationId: currentOrganization.id,
		})
	);
	const agentProfileFilterCounts = useMemo(() => {
		if (isOrganizationContext && organizationDirectoryQuery.data) {
			return summarizeOrganizationAgentProfileAvailabilityFilters(
				organizationDirectoryQuery.data.agentProfiles.filter(
					(profile) => profile.managedRole !== "center_agent"
				)
			);
		}
		return summarizeAgentProfileAvailabilityFilters({
			errorByProfileId: recovery.agentExecutionReadinessErrorByProfileId,
			pendingProfileIds: recovery.agentExecutionReadinessPendingProfileIds,
			profiles: recovery.agentProfiles,
			readinessByProfileId: recovery.agentExecutionReadinessByProfileId,
		});
	}, [
		isOrganizationContext,
		organizationDirectoryQuery.data,
		recovery.agentExecutionReadinessByProfileId,
		recovery.agentExecutionReadinessErrorByProfileId,
		recovery.agentExecutionReadinessPendingProfileIds,
		recovery.agentProfiles,
	]);
	const agentProfilesAreEmpty =
		input.activeSectionId === "agents" &&
		resolveAgentProfilesEmptyState({
			agentProfiles: recovery.agentProfiles,
			agentProfilesQueryState: recovery.agentProfilesQuery,
			directory: organizationDirectoryQuery.data ?? null,
			directoryQueryState: organizationDirectoryQuery,
			isOrganizationContext,
		});
	if (activeAgentView === "requests") {
		return (
			<AgentRequestsHome
				currentUserId={currentUserId}
				directoryQuery={organizationDirectoryQuery}
				focusRequestId={input.focusRequestId ?? null}
				initialSidebarStates={input.initialSidebarStates}
				onOpenAgent={(profileId) => {
					navigate({
						search: { profileId },
						to: profileHomeRoutes.agents,
					}).catch((error: unknown) => {
						console.error("Failed to open the created Agent.", error);
					});
				}}
				onViewChange={input.onAgentViewChange}
				organizationId={currentOrganization.id}
				organizationName={currentOrganization.name}
				orgSlug={orgSlug}
				recovery={recovery}
			/>
		);
	}

	const handleProfileCreated = (profile: AuthProfileView) => {
		queryClient
			.invalidateQueries({
				queryKey: startQueryKeys.profilesForStorageScope(recovery.storageScope),
			})
			.catch((error: unknown) => {
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
			organizationAuthorizationContext={
				isOrganizationContext && input.activeSectionId === "agents"
					? {
							organizationId: currentOrganization.id,
							organizationName: currentOrganization.name,
						}
					: undefined
			}
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
	const profilesContent: ReactNode = isOrganizationContext ? (
		<OrganizationAgentProfilesPanel
			availabilityFilter={resolveAgentProfileAvailabilityFilter(
				agentProfileFilter
			)}
			currentUserId={recovery.storageScope}
			directoryQuery={organizationDirectoryQuery}
			focusProfileId={input.focusProfileId}
			onCreateProfile={() => setIsCreateProfileOpen(true)}
			onFocusConsumed={input.onFocusConsumed}
			orgSlug={orgSlug}
			recovery={recovery}
		/>
	) : (
		<AgentProfilesPanel
			availabilityFilter={resolveAgentProfileAvailabilityFilter(
				agentProfileFilter
			)}
			fallbackOwnerLabel={fallbackOwnerLabel}
			focusProfileId={input.focusProfileId}
			onCreateProfile={() => setIsCreateProfileOpen(true)}
			onFocusConsumed={input.onFocusConsumed}
			orgSlug={orgSlug}
			recovery={recovery}
		/>
	);

	return (
		<AppFullWidthLayout
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
		>
			<ProfilesSectionLayout
				action={
					input.activeSectionId === "agents" ? (
						<div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
							{agentProfilesAreEmpty ? null : (
								<Button
									className="w-full sm:w-auto"
									onClick={() => setIsCreateProfileOpen(true)}
									size="sm"
								>
									<PlusIcon aria-hidden="true" data-icon="inline-start" />
									Create Agent
								</Button>
							)}
							<AgentProfileFilterSelect
								counts={agentProfileFilterCounts}
								includeOrganizationMemberFilter={isOrganizationContext}
								onValueChange={setAgentProfileFilter}
								value={agentProfileFilter}
							/>
						</div>
					) : undefined
				}
				description={resolveProfilesSectionDescription({
					agentView: activeAgentView,
					isOrganizationContext,
					organizationName: currentOrganization.name,
					sectionId: input.activeSectionId,
				})}
				title={activeSectionCopy.title}
			>
				{input.activeSectionId === "agents" && isOrganizationContext ? (
					<>
						<TabsSubtle
							className="w-fit max-w-full"
							idPrefix="agents-view"
							onSelect={(index) =>
								input.onAgentViewChange?.(index === 1 ? "requests" : "agents")
							}
							selectedIndex={0}
						>
							<TabsSubtleItem index={0} label="Agents" />
							<TabsSubtleItem index={1} label="Requests" />
						</TabsSubtle>
						<TabsSubtlePanel idPrefix="agents-view" index={0} selectedIndex={0}>
							{profilesContent}
						</TabsSubtlePanel>
					</>
				) : (
					profilesContent
				)}
			</ProfilesSectionLayout>
			{createProfileDialog}
		</AppFullWidthLayout>
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

function AgentRequestsHome(input: {
	currentUserId: string;
	directoryQuery: {
		data?: OrganizationDirectoryResponse;
		error: { message: string } | null;
		isError: boolean;
	};
	focusRequestId: string | null;
	initialSidebarStates?: AppSidebarPersistedStates;
	onOpenAgent: (profileId: string) => void;
	onViewChange?: (view: "agents" | "requests") => void;
	organizationId: string;
	organizationName: string;
	orgSlug: string;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
}) {
	const [isCreateAgentOpen, setIsCreateAgentOpen] = useState(false);
	let content: ReactNode;
	if (input.directoryQuery.data) {
		content = (
			<AgentProfileCreationRequestsPanel
				currentUserId={input.currentUserId}
				directory={input.directoryQuery.data}
				focusRequestId={input.focusRequestId}
				onCreateAgent={() => setIsCreateAgentOpen(true)}
				onOpenAgent={input.onOpenAgent}
				organizationId={input.organizationId}
			/>
		);
	} else if (input.directoryQuery.isError) {
		content = (
			<p className="rounded-md border border-destructive/30 px-4 py-4 text-destructive text-sm">
				{input.directoryQuery.error?.message ?? "Couldn’t load requests."}
			</p>
		);
	} else {
		content = (
			<p className="rounded-md border border-border/70 px-4 py-6 text-muted-foreground text-sm">
				Loading requests…
			</p>
		);
	}

	return (
		<AppFullWidthLayout
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
		>
			<ProfilesSectionLayout
				description="Review Agent creation requests that need your approval and track requests you sent to teammates."
				title="Agents"
			>
				<TabsSubtle
					className="w-fit max-w-full"
					idPrefix="agents-view"
					onSelect={(index) =>
						input.onViewChange?.(index === 1 ? "requests" : "agents")
					}
					selectedIndex={1}
				>
					<TabsSubtleItem index={0} label="Agents" />
					<TabsSubtleItem index={1} label="Requests" />
				</TabsSubtle>
				<TabsSubtlePanel idPrefix="agents-view" index={1} selectedIndex={1}>
					{content}
				</TabsSubtlePanel>
			</ProfilesSectionLayout>
			{isCreateAgentOpen ? (
				<CreateProfileDialog
					allowTeammateRequests={true}
					currentUserId={input.currentUserId}
					onAgentRequestCreated={(request) => {
						if (request.createdAgentProfileId) {
							input.onOpenAgent(request.createdAgentProfileId);
						}
					}}
					onOpenChange={setIsCreateAgentOpen}
					onProfileCreated={(profile) =>
						input.onOpenAgent(profile.openMeldProfileId)
					}
					open={true}
					organizationAuthorizationContext={{
						organizationId: input.organizationId,
						organizationName: input.organizationName,
					}}
					organizationId={input.organizationId}
					orgSlug={input.orgSlug}
					recovery={input.recovery}
				/>
			) : null}
		</AppFullWidthLayout>
	);
}

function resolveProfilesSectionDescription(input: {
	agentView: "agents" | "requests";
	isOrganizationContext: boolean;
	organizationName: string;
	sectionId: ProfileHomeId;
}): string {
	if (input.sectionId === "agents") {
		if (input.agentView === "requests") {
			return "Review Agent creation requests that need your approval and track requests you sent to teammates.";
		}
		return input.isOrganizationContext
			? `Agents are the AI teammates in ${input.organizationName}. See who manages each one and whether it’s ready to work in Spaces.`
			: "Agents are your AI teammates. See whether each one is ready to work in Spaces.";
	}

	return input.isOrganizationContext
		? `See who belongs to ${input.organizationName}, invite teammates, and manage how each person appears in Spaces.`
		: "See the identity you use in Spaces.";
}

function resolveAgentProfilesEmptyState(input: {
	agentProfiles: readonly AuthProfileView[];
	agentProfilesQueryState: { isError?: boolean; isPending?: boolean };
	directory: OrganizationDirectoryResponse | null;
	directoryQueryState: { isError?: boolean; isPending?: boolean };
	isOrganizationContext: boolean;
}): boolean {
	if (input.isOrganizationContext) {
		return (
			!(
				input.directoryQueryState.isPending || input.directoryQueryState.isError
			) &&
			(input.directory?.agentProfiles.filter(
				(profile) => profile.managedRole !== "center_agent"
			).length ?? 0) === 0
		);
	}

	return (
		!(
			input.agentProfilesQueryState.isPending ||
			input.agentProfilesQueryState.isError
		) && input.agentProfiles.length === 0
	);
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
				className="size-7 min-w-0 justify-center px-0 text-muted-foreground hover:text-foreground [&>span>span]:sr-only [&>span]:flex-none [&>svg]:hidden"
				displayValue={displayValue}
				icon={FunnelSimpleIcon}
				variant="borderless"
			/>
			<SelectContent className="w-44 -translate-x-[calc(100%-1.75rem)]">
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

function OrganizationAgentProfilesPanel(input: {
	availabilityFilter: AgentProfileAvailabilityFilter;
	currentUserId: string;
	directoryQuery: OrganizationDirectoryQueryState;
	focusProfileId: string | null;
	onCreateProfile: () => void;
	onFocusConsumed?: () => void;
	orgSlug: string;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
}) {
	const directory = input.directoryQuery.data ?? null;
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
		for (const profile of directory?.agentProfiles ?? []) {
			if (profile.managedRole === "center_agent") {
				continue;
			}
			profiles.push(buildAuthProfileViewFromOrganizationAgentProfile(profile));
			readinessByProfileId.set(profile.profileId, profile.readiness);
		}
		return { profiles, readinessByProfileId };
	}, [directory?.agentProfiles]);

	return (
		<AgentProfilesCard
			agentExecutionReadinessByProfileId={
				organizationAgentProjection.readinessByProfileId
			}
			agentExecutionReadinessErrorByProfileId={
				EMPTY_AGENT_PROFILE_READINESS_ERROR_BY_PROFILE_ID
			}
			agentExecutionReadinessPendingProfileIds={
				EMPTY_AGENT_PROFILE_READINESS_PENDING_PROFILE_IDS
			}
			agentProfiles={organizationAgentProjection.profiles}
			agentProfilesQueryState={input.directoryQuery}
			availabilityFilter={input.availabilityFilter}
			canManageProfile={(profile) =>
				profile.ownerUserId === input.currentUserId
			}
			fallbackOwnerLabel="Unknown member"
			focusProfileId={input.focusProfileId}
			isCurrentComputer={true}
			onCreateProfile={input.onCreateProfile}
			onFocusProfileConsumed={input.onFocusConsumed}
			queryClient={queryClient}
			recovery={input.recovery}
			serviceUpdatePath={accountServiceUpdatePath}
			setupPath={accountComputerSetupPath}
			showOwnerGroups={true}
		/>
	);
}

function AgentProfilesPanel(input: {
	availabilityFilter: AgentProfileAvailabilityFilter;
	fallbackOwnerLabel: string;
	focusProfileId: string | null;
	onCreateProfile: () => void;
	onFocusConsumed?: () => void;
	orgSlug: string;
	recovery: ReturnType<typeof useLocalAgentRecoveryController>;
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

	return (
		<AgentProfilesCard
			availabilityFilter={input.availabilityFilter}
			fallbackOwnerLabel={input.fallbackOwnerLabel}
			focusProfileId={input.focusProfileId}
			isCurrentComputer={true}
			onCreateProfile={input.onCreateProfile}
			onFocusProfileConsumed={input.onFocusConsumed}
			queryClient={queryClient}
			recovery={input.recovery}
			serviceUpdatePath={accountServiceUpdatePath}
			setupPath={accountComputerSetupPath}
		/>
	);
}

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
