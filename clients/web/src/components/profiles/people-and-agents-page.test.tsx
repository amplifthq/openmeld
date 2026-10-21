import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
	AuthProfileView,
	CurrentLocalRuntimeReplyReadinessResponse,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatAgentWakeAvailabilityCheckedAt } from "#/components/agents/agents-page-agent-profile-helpers";
import { PeopleAndAgentsPage } from "./people-and-agents-page";

const agentProfilesCardSpy = vi.hoisted(() => vi.fn());
const agentProfileCreationRequestsPanelSpy = vi.hoisted(() => vi.fn());
const agentProfilesWorkspaceSpy = vi.hoisted(() => vi.fn());
const appOuterRailSpy = vi.hoisted(() => vi.fn());
const createAgentProfilePageSpy = vi.hoisted(() => vi.fn());
const createProfileDialogSpy = vi.hoisted(() => vi.fn());
const directoryMembersOverviewSpy = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const currentOrganizationMock = vi.hoisted(() => ({
	id: "org-123",
	isPersonal: false,
	name: "Acme",
	slug: "acme",
}));
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useLocalAgentRecoveryControllerMock = vi.hoisted(() => vi.fn());
let organizationDirectoryFixture: OrganizationDirectoryResponse;

// These cases cover the per-Profile path; the MemberAgent path has its own
// tests in member-agents.integration.test.tsx.
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => false,
}));

vi.mock("../app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({ preferences: undefined }),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		activeOptions: _activeOptions,
		children,
		to,
		...props
	}: {
		activeOptions?: unknown;
		children: ReactNode;
		to: string;
	} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: currentOrganizationMock,
		currentUserId: "user-123",
	}),
}));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);
	return {
		...actual,
		useQuery: useQueryMock,
		useQueryClient: useQueryClientMock,
	};
});

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: (props: unknown) => {
		appOuterRailSpy(props);
		return <nav data-testid="outer-rail" />;
	},
}));

vi.mock("#/components/app/app-global-controls", () => ({
	AppGlobalControls: () => <div data-testid="global-controls" />,
}));

vi.mock("#/components/app/app-inner-sidebar", () => ({
	AppInnerSidebar: ({ children }: { children: ReactNode }) => (
		<aside data-testid="inner-sidebar">{children}</aside>
	),
}));

vi.mock("#/components/directory/directory-members-overview", () => ({
	DirectoryMembersOverview: (props: {
		currentOrganization: { isPersonal: boolean; name: string };
		onCreateProfile: () => void;
		storageScope: string;
	}) => {
		directoryMembersOverviewSpy(props);
		return (
			<section>
				Human Profiles overview
				<button onClick={props.onCreateProfile} type="button">
					Create Profile
				</button>
			</section>
		);
	},
}));

vi.mock("#/components/app/app-contextual-layout", () => ({
	AppContextualContentFrame: ({ children }: { children: ReactNode }) => (
		<main>{children}</main>
	),
	AppContextualSidebarNav: (props: {
		activeItemId: string;
		ariaLabel: string;
		groups: readonly {
			ariaLabel: string;
			id: string;
			items: readonly { id: string; label: string; to: string }[];
			label: string;
		}[];
		title: string;
	}) => (
		<section aria-label={props.ariaLabel}>
			<h2>{props.title}</h2>
			{props.groups.map((group) => (
				<nav aria-label={group.ariaLabel} key={group.id}>
					<h2>{group.label}</h2>
					{group.items.map((item) => (
						<a
							aria-current={item.id === props.activeItemId ? "page" : undefined}
							href={item.to}
							key={item.id}
						>
							{item.label}
						</a>
					))}
				</nav>
			))}
		</section>
	),
}));

vi.mock("#/components/app/app-contextual-layout-style", () => ({
	APP_CONTEXTUAL_MAIN_TEXT_BASE_START_CLASS_NAME: "contextual-main-text",
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

vi.mock("#/components/agents/use-local-agent-recovery-controller", () => ({
	useLocalAgentRecoveryController: useLocalAgentRecoveryControllerMock,
}));

vi.mock("#/components/agents/agents-page-agent-profiles-card", () => ({
	AgentProfilesCard: (props: {
		agentProfileOperationalContextByProfileId?: ReadonlyMap<string, unknown>;
		agentProfiles?: readonly AuthProfileView[];
		availabilityFilter: string;
		canManageProfile?: (profile: AuthProfileView) => boolean;
		focusProfileId: string | null;
		isCurrentComputer: boolean;
		onCreateProfile?: () => void;
		presentation?: "cards" | "controller" | "detail";
		showOwnerGroups?: boolean;
		wakeAvailabilityNowMs: number;
	}) => {
		agentProfilesCardSpy(props);
		const [editing, setEditing] = useState(false);
		if (props.presentation === "controller") {
			return null;
		}
		const profileName =
			props.agentProfiles?.find(
				(profile) => profile.openMeldProfileId === props.focusProfileId
			)?.profileName ??
			props.agentProfiles?.[0]?.profileName ??
			"Agent";
		return (
			<section data-testid="agent-profiles-card">
				{editing ? `Editing ${profileName}` : `Viewing ${profileName}`}
				<button onClick={() => setEditing(true)} type="button">
					Edit Agent
				</button>
				<button onClick={props.onCreateProfile} type="button">
					Create an Agent
				</button>
			</section>
		);
	},
}));

vi.mock("#/components/agents/agent-profile-creation-requests-panel", () => ({
	AgentProfileCreationRequestsPanel: (props: {
		onOpenAgent: (profileId: string) => void;
	}) => {
		agentProfileCreationRequestsPanelSpy(props);
		return (
			<button
				onClick={() =>
					props.onOpenAgent("agt_11111111-1111-4111-8111-111111111111")
				}
				type="button"
			>
				Open requested Agent
			</button>
		);
	},
}));

vi.mock("#/components/agents/agent-profiles-workspace", () => ({
	AgentProfilesWorkspace: (props: {
		activeView: "agents" | "requests";
		filterControl?: ReactNode;
		isSearchActive?: boolean;
		onCreateAgent: () => void;
		onSelectProfile: (profileId: string) => void;
		onViewChange: (view: "agents" | "requests") => void;
		creationAttentionCount: number;
		profiles: readonly AuthProfileView[];
		renderProfilesController: () => ReactNode;
		renderProfileDetail: (profile: AuthProfileView) => ReactNode;
		requestPanel: ReactNode;
		selectedProfileId: string | null;
		showAgentRequests?: boolean;
		searchControl?: ReactNode;
		wakeAvailabilityNowMs: number;
	}) => {
		agentProfilesWorkspaceSpy(props);
		const selectedProfile =
			props.profiles.find(
				(profile) => profile.openMeldProfileId === props.selectedProfileId
			) ?? props.profiles[0];
		let content: ReactNode = selectedProfile
			? props.renderProfileDetail(selectedProfile)
			: props.renderProfilesController();
		if (props.activeView === "requests") {
			content = props.requestPanel;
		}
		return (
			<section>
				<aside data-testid="inner-sidebar">
					<h1>Agents</h1>
					<button onClick={props.onCreateAgent} type="button">
						Create Agent
					</button>
					{props.showAgentRequests === false ? null : (
						<button
							onClick={() => props.onViewChange("requests")}
							type="button"
						>
							Agent requests
						</button>
					)}
					{props.searchControl}
					{props.filterControl}
				</aside>
				{content}
			</section>
		);
	},
}));

vi.mock("#/components/profiles/create-profile-dialog", () => ({
	CreateAgentProfilePage: (props: {
		onProfileCreated?: (profile: AuthProfileView) => void;
		organizationId: string;
	}) => {
		createAgentProfilePageSpy(props);
		return (
			<button
				onClick={() =>
					props.onProfileCreated?.(
						buildAgentProfile("agent-new", "Felix Codex")
					)
				}
				type="button"
			>
				Create agent profile
			</button>
		);
	},
	CreateProfileDialog: (props: {
		onProfileCreated?: (profile: AuthProfileView) => void;
		organizationId: string;
	}) => {
		createProfileDialogSpy(props);
		return (
			<button
				onClick={() => props.onProfileCreated?.(buildHumanProfile("human-new"))}
				type="button"
			>
				Create human profile
			</button>
		);
	},
}));

function buildHumanProfile(profileId: string): AuthProfileView {
	return {
		openMeldProfileId: profileId,
		createdAt: "2026-06-01T00:00:00.000Z",
		createdByUserId: "user-123",
		creatorProfileId: null,
		isDefault: profileId === "human-default",
		lastUsedAt: "2026-06-02T00:00:00.000Z",
		managedRole: null,
		ownerUserId: "user-123",
		ownerName: "Felix",
		profileHandle: "felix",
		profileKind: "human",
		profileName: "Felix",
		source: "auth_bootstrap",
		status: "active",
		updatedAt: "2026-06-02T00:00:00.000Z",
	};
}

function buildAgentProfile(
	profileId: string,
	profileName: string
): AuthProfileView {
	return {
		...buildHumanProfile(profileId),
		isDefault: false,
		managedRole: null,
		openMeldProfileId: profileId,
		profileHandle: profileId,
		profileKind: "agent",
		profileName,
		source: "cli_create",
	};
}

function buildOrganizationDirectory(): OrganizationDirectoryResponse {
	return {
		organizationId: "org-123",
		generatedAt: "2026-07-06T00:00:00.000Z",
		members: [
			{
				humanProfile: {
					lastUsedAt: "2026-07-05T20:30:00.000Z",
					profileHandle: "felix",
					profileId: "11111111-1111-4111-8111-111111111111",
					profileName: "Felix",
					status: "active",
				},
				joinedAt: "2026-07-06T00:00:00.000Z",
				memberId: "member-1",
				organizationId: "org-123",
				role: "owner",
				user: {
					email: "felix@example.com",
					id: "user-123",
					image: null,
					name: "Felix",
				},
				userId: "user-123",
			},
		],
		agentProfiles: [
			{
				organizationId: "org-123",
				ownerUserId: "user-123",
				createdAt: "2026-07-06T00:00:00.000Z",
				createdByUserId: "user-123",
				creatorProfileId: null,
				isDefault: false,
				lastUsedAt: null,
				managedRole: null,
				ownerName: "Felix",
				profileHandle: "scout",
				profileKind: "agent",
				profileId: "agt_11111111-1111-4111-8111-111111111111",
				profileName: "Scout",
				operationalContext: {
					currentWorkLocation: {
						spaceId: "space-launch",
						spaceName: "Launch planning",
					},
					queuedWorkLocations: [
						{
							spaceId: "space-follow-up",
							spaceName: "Customer follow-up",
						},
					],
					status: "working",
					waitingCount: 1,
				},
				source: "cli_create",
				readiness: {
					agentControllerRef: "builtin:codex",
					agentExecutionReadiness: {
						agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
						displayState: "ready",
						facts: {
							binding: {
								reasonCodes: [],
								routable: true,
								source: "binding_truth",
							},
							claim: {
								executionBlocked: false,
								grantsClaimSuccess: false,
								reasonCodes: [],
								source: "not_checked",
							},
							localService: {
								reachable: true,
								reasonCodes: [],
								refreshable: true,
								source: "runtime_transport",
							},
							profile: {
								active: true,
								reasonCodes: [],
								source: "profile_identity",
							},
							providerAccount: {
								blocked: false,
								expiresAtMs: null,
								observedAtMs: null,
								provider: null,
								reasonCodes: [],
								source: "not_checked",
							},
							providerConversation: {
								agentControllerConversationId: null,
								errorCode: null,
								errorMessage: null,
								errorType: null,
								expiresAtMs: null,
								method: null,
								observedAtMs: null,
								provider: null,
								ready: true,
								reasonCodes: [],
								required: false,
								source: "not_required",
								status: "not_required",
							},
							readinessImpact: {
								blocked: false,
								expiresAtMs: null,
								impactKind: null,
								observedAtMs: null,
								reasonCodes: [],
								source: "not_checked",
							},
							route: {
								deviceId: "device-1",
								lane: "dev-local",
								observedAt: "2026-07-06T00:00:00.000Z",
								online: true,
								reasonCodes: [],
								source: "daemon_route",
							},
							runtime: {
								ready: true,
								reasonCodes: [],
								source: "prepare_readiness",
							},
							service: {
								executionCompatible: true,
								expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
								observedEpoch: null,
								reasonCodes: [],
								source: "runtime_transport",
							},
						},
						primaryAction: "none",
						reasonCodes: [],
					},
					agentWakeAvailability: {
						action: "none",
						badgeLabel: "Available",
						category: "available",
						isRefreshing: false,
						label: "Available for Wake",
						phase: "available",
						reasonCode: null,
						status: "available_for_wake",
						summary: "This agent can reply in Spaces.",
						tooltip: "Available for Wake",
					},
					agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
					agentWakeRouteRegistration: {
						daemonSessionId: "daemon-session-1",
						deviceId: "device-1",
						lane: "dev-local",
						reasonCode: null,
						reportedAtMs: 1_783_396_800_000,
						serviceVersion: "0.7.57",
						status: "registered",
					},
					generatedAt: "2026-07-06T00:00:00.000Z",
					ownerUserId: "user-123",
					primaryActionPlan: {
						action: "none",
						target: null,
					},
					primaryBinding: null,
					profileName: "Scout",
					routeDeviceId: "device-1",
					routeLane: "dev-local",
					runtimeDeviceDisplayName: "Felix's MacBook Pro",
					wakeRouteEvidence: {
						observedAt: "2026-07-06T00:00:00.000Z",
						reasonCode: "online",
						status: "online",
					},
					wakeRouteStatus: {
						connectionGeneration: 1,
						daemonSessionId: "daemon-session-1",
						deviceId: "device-1",
						lane: "dev-local",
						lastHeartbeatMs: 1_783_396_800_000,
						leaseEpoch: 1,
						status: "ready",
					},
				},
				status: "active",
				updatedAt: "2026-07-06T00:00:00.000Z",
			},
		],
	};
}

function buildOrganizationProfileDirectory(
	directory: OrganizationDirectoryResponse
): OrganizationProfileDirectoryResponse {
	return {
		agentProfiles: directory.agentProfiles.map(
			({ operationalContext: _operationalContext, readiness, ...profile }) => ({
				...profile,
				agentControllerRef: readiness.agentControllerRef,
			})
		),
		generatedAt: directory.generatedAt,
		members: directory.members,
		organizationId: directory.organizationId,
	};
}

function buildOrganizationAgentRuntimeOverview(
	directory: OrganizationDirectoryResponse
): OrganizationAgentRuntimeOverviewResponse {
	return {
		agentProfiles: directory.agentProfiles.map((profile) => ({
			...(profile.operationalContext
				? { operationalContext: profile.operationalContext }
				: {}),
			profileId: profile.profileId,
			readiness: profile.readiness,
		})),
		generatedAt: directory.generatedAt,
		organizationId: directory.organizationId,
	};
}

function resolveOrganizationProjectionQuery(
	queryKey: readonly unknown[],
	directory: OrganizationDirectoryResponse
) {
	if (queryKey.includes("profile-directory")) {
		return {
			data: buildOrganizationProfileDirectory(directory),
			error: null,
			isError: false,
			isPending: false,
		};
	}
	if (queryKey.includes("agent-runtime-overview")) {
		return {
			data: buildOrganizationAgentRuntimeOverview(directory),
			error: null,
			isError: false,
			isPending: false,
		};
	}
	return null;
}

function buildRecoveryStub(
	input: {
		localRuntimeCount?: number;
		openMeldToolsUpdateAvailable?: boolean;
	} = {}
) {
	const localRuntimeCount =
		input.localRuntimeCount ?? (input.openMeldToolsUpdateAvailable ? 1 : 0);
	const currentReadiness = input.openMeldToolsUpdateAvailable
		? ({
				canReplyFromThisComputer: true,
				currentTarget: {
					availability: "resolved",
					deviceId: "device-1",
					runtimeLane: "dev-local",
				},
				generatedAt: "2026-07-06T00:00:00.000Z",
				localComponents: {
					cli: { status: "current", wakeBlocked: false },
					service: { status: "update_available", wakeBlocked: false },
					skills: { status: "current", wakeBlocked: false },
				},
				message: "This computer is ready.",
				nextAction: "none",
				primaryBlocker: "none",
				runtime: {
					deviceDisplayName: "This MacBook",
					deviceId: "device-1",
					executionTargetStatus: "ready",
					lastObservedAtMs: 1_700_000_000_000,
					reasonCodes: [],
					runtimeLane: "dev-local",
					openMeldServiceRuntimeId: null,
				},
				service: {
					connected: true,
					executionCompatibility: null,
					matchingCurrentRuntime: true,
					reasonCodes: [],
					sessionDeviceId: "device-1",
					sessionLane: "dev-local",
				},
				status: "ready",
			} as unknown as CurrentLocalRuntimeReplyReadinessResponse)
		: null;

	return {
		agentExecutionReadinessByProfileId: new Map(),
		agentExecutionReadinessErrorByProfileId: new Map(),
		agentExecutionReadinessPendingProfileIds: new Set<string>(),
		agentProfiles: [],
		agentProfilesQuery: { isPending: false, isSuccess: true },
		currentLocalRuntimeReplyReadinessQuery: {
			data: currentReadiness,
		},
		deviceId: null,
		localRuntimesQuery: {
			data: {
				localRuntimes: Array.from(
					{ length: localRuntimeCount },
					(_, index) => ({
						deviceId: `device-${index + 1}`,
					})
				),
			},
			isPending: false,
		},
		refreshAll: vi.fn(),
		runtimeLane: null,
		storageScope: "user-123",
	};
}

describe("PeopleAndAgentsPage", () => {
	beforeEach(() => {
		agentProfilesCardSpy.mockReset();
		agentProfileCreationRequestsPanelSpy.mockReset();
		agentProfilesWorkspaceSpy.mockReset();
		appOuterRailSpy.mockReset();
		createAgentProfilePageSpy.mockReset();
		createProfileDialogSpy.mockReset();
		directoryMembersOverviewSpy.mockReset();
		invalidateQueriesMock.mockReset().mockResolvedValue(undefined);
		navigateMock.mockReset().mockResolvedValue(undefined);
		Object.assign(currentOrganizationMock, {
			id: "org-123",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		});
		organizationDirectoryFixture = buildOrganizationDirectory();
		useQueryMock
			.mockReset()
			.mockImplementation((options: { queryKey?: unknown }) => {
				const queryKey = Array.isArray(options?.queryKey)
					? options.queryKey
					: [];
				const organizationProjection = resolveOrganizationProjectionQuery(
					queryKey,
					organizationDirectoryFixture
				);
				if (organizationProjection) {
					return organizationProjection;
				}
				if (queryKey.includes("agent-profile-creation-requests")) {
					return {
						data: { organizationId: "org-123", requests: [] },
						error: null,
						isError: false,
						isPending: false,
					};
				}
				return {
					data: [buildHumanProfile("human-default")],
					error: null,
					isError: false,
					isPending: false,
				};
			});
		useQueryClientMock.mockReset().mockReturnValue({
			invalidateQueries: invalidateQueriesMock,
		});
		useLocalAgentRecoveryControllerMock
			.mockReset()
			.mockReturnValue(buildRecoveryStub());
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("scopes a person's Agent list and detail selection to that owner", () => {
		const ownAgent = organizationDirectoryFixture.agentProfiles[0];
		if (!ownAgent) {
			throw new Error("Expected an Agent fixture.");
		}
		const otherAgent = {
			...ownAgent,
			ownerUserId: "user-other",
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "Other Agent",
		};
		organizationDirectoryFixture.agentProfiles = [ownAgent, otherAgent];
		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={otherAgent.profileId}
				personId="11111111-1111-4111-8111-111111111111"
			/>
		);
		const workspace = agentProfilesWorkspaceSpy.mock.calls.at(-1)?.[0];
		expect(
			workspace.profiles.map(
				(profile: AuthProfileView) => profile.openMeldProfileId
			)
		).toEqual([ownAgent.profileId]);
		expect(workspace.selectedProfileId).toBe(otherAgent.profileId);
		expect(
			workspace.profiles.some(
				(profile: AuthProfileView) =>
					profile.openMeldProfileId === workspace.selectedProfileId
			)
		).toBe(false);
	});

	it("keeps saved Project preferences when projecting the Organization directory", () => {
		const profileId = "agt_11111111-1111-4111-8111-111111111111";
		const ownedProfile = {
			...buildAgentProfile(profileId, "Scout"),
			defaultProjectId: "project-portal",
		};
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			...buildRecoveryStub(),
			agentProfiles: [ownedProfile],
		});
		const view = render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={profileId}
			/>
		);
		expect(
			agentProfilesCardSpy.mock.calls.at(-1)?.[0].agentProfiles[0]
				.defaultProjectId
		).toBe("project-portal");
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			...buildRecoveryStub(),
			agentProfiles: [{ ...ownedProfile, defaultProjectId: null }],
		});
		view.rerender(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={profileId}
			/>
		);
		expect(
			agentProfilesCardSpy.mock.calls.at(-1)?.[0].agentProfiles[0]
				.defaultProjectId
		).toBeNull();
	});

	it("shows the saved Agent avatar from the Organization directory", () => {
		organizationDirectoryFixture.agentProfiles[0].avatarStyle = "fluid";
		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		expect(
			agentProfilesCardSpy.mock.calls.at(-1)?.[0].agentProfiles[0].avatarStyle
		).toBe("fluid");
	});

	it("renders Agents with a secondary sidebar and selected detail", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		expect(screen.getByTestId("inner-sidebar")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Agent requests" })).toBeTruthy();
		expect(agentProfilesWorkspaceSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				activeView: "agents",
				currentUserId: "user-123",
				profiles: [
					expect.objectContaining({
						ownerUserId: "user-123",
						profileName: "Scout",
						openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
					}),
				],
				selectedProfileId: "agt_11111111-1111-4111-8111-111111111111",
			})
		);
		expect(agentProfilesCardSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfiles: [
					expect.objectContaining({
						ownerUserId: "user-123",
						profileName: "Scout",
						openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
					}),
				],
				availabilityFilter: "all",
				canManageProfile: expect.any(Function),
				focusProfileId: "agt_11111111-1111-4111-8111-111111111111",
				presentation: "detail",
			})
		);
		const agentProfilesCardProps = agentProfilesCardSpy.mock.calls.at(-1)?.[0];
		const [organizationAgentProfile] = agentProfilesCardProps.agentProfiles;
		expect(
			agentProfilesCardProps.canManageProfile(organizationAgentProfile)
		).toBe(true);
		expect(
			agentProfilesCardProps.canManageProfile({
				...organizationAgentProfile,
				ownerUserId: "another-user",
			})
		).toBe(false);
	});

	it.each([
		"agents",
		"requests",
	] as const)("loads status for the visible Agent sidebar in the %s view", (activeAgentView) => {
		render(
			<PeopleAndAgentsPage
				activeAgentView={activeAgentView}
				activeSectionId="agents"
				focusProfileId={null}
			/>
		);
		const runtimeQueryOptions = useQueryMock.mock.calls.find(([options]) =>
			options.queryKey?.includes("agent-runtime-overview")
		)?.[0];
		expect(runtimeQueryOptions?.enabled).toBe(true);
	});

	it("renders People without loading Agent runtime state", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="people"
				focusProfileId="human-default"
			/>
		);

		const runtimeQueryOptions = useQueryMock.mock.calls.find(([options]) =>
			options.queryKey?.includes("agent-runtime-overview")
		)?.[0];
		expect(runtimeQueryOptions).toEqual(
			expect.objectContaining({ enabled: false })
		);
		expect(directoryMembersOverviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				directoryQuery: expect.objectContaining({
					data: expect.objectContaining({ agentProfiles: expect.any(Array) }),
				}),
			})
		);
		expect(
			directoryMembersOverviewSpy.mock.calls.at(-1)?.[0]
		).not.toHaveProperty("runtimeOverview");
	});

	it("renders Agent identities while runtime state is still loading", () => {
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			if (queryKey.includes("profile-directory")) {
				return {
					data: buildOrganizationProfileDirectory(organizationDirectoryFixture),
					error: null,
					isError: false,
					isPending: false,
				};
			}
			if (queryKey.includes("agent-runtime-overview")) {
				return {
					data: undefined,
					error: null,
					isError: false,
					isPending: true,
				};
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: { organizationId: "org-123", requests: [] },
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		const workspaceProps = agentProfilesWorkspaceSpy.mock.calls.at(-1)?.[0];
		expect(workspaceProps.profiles).toEqual([
			expect.objectContaining({
				openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
				profileName: "Scout",
			}),
		]);
		expect(workspaceProps.profilesStatus).toBe("ready");
		expect([...workspaceProps.readinessPendingProfileIds]).toEqual([
			"agt_11111111-1111-4111-8111-111111111111",
		]);
		expect(workspaceProps.readinessIsRefreshing).toBeUndefined();
	});

	it("keeps the cached Core overview visible while a background refresh runs", () => {
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			const organizationProjection = resolveOrganizationProjectionQuery(
				queryKey,
				organizationDirectoryFixture
			);
			if (organizationProjection) {
				return queryKey.includes("agent-runtime-overview")
					? { ...organizationProjection, isFetching: true }
					: organizationProjection;
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: { organizationId: "org-123", requests: [] },
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		const workspaceProps = agentProfilesWorkspaceSpy.mock.calls.at(-1)?.[0];
		expect(workspaceProps.readinessIsRefreshing).toBeUndefined();
		expect(agentProfilesCardSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				agentExecutionReadinessIsRefreshing: true,
				agentExecutionReadinessByProfileId: expect.any(Map),
			})
		);
	});

	it("keeps the cached Core overview alongside a background refresh failure", () => {
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			const organizationProjection = resolveOrganizationProjectionQuery(
				queryKey,
				organizationDirectoryFixture
			);
			if (organizationProjection) {
				return queryKey.includes("agent-runtime-overview")
					? {
							...organizationProjection,
							error: new Error("Core could not refresh Wake availability."),
							isError: true,
						}
					: organizationProjection;
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: { organizationId: "org-123", requests: [] },
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		const workspaceProps = agentProfilesWorkspaceSpy.mock.calls.at(-1)?.[0];
		expect(workspaceProps.readinessByProfileId.size).toBe(1);
		expect(
			workspaceProps.readinessErrorByProfileId.get(
				"agt_11111111-1111-4111-8111-111111111111"
			)
		).toBe("Core could not refresh Wake availability.");
	});

	it("advances one shared Wake availability clock every minute", () => {
		const checkedAt = "2026-09-04T12:00:00.000Z";
		vi.useFakeTimers();
		vi.setSystemTime(checkedAt);
		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		let detailNowMs =
			agentProfilesCardSpy.mock.calls.at(-1)?.[0].wakeAvailabilityNowMs;
		expect(formatAgentWakeAvailabilityCheckedAt(checkedAt, detailNowMs)).toBe(
			"checked just now"
		);

		act(() => vi.advanceTimersByTime(60_000));
		detailNowMs =
			agentProfilesCardSpy.mock.calls.at(-1)?.[0].wakeAvailabilityNowMs;
		expect(formatAgentWakeAvailabilityCheckedAt(checkedAt, detailNowMs)).toBe(
			"checked 1 minute ago"
		);

		act(() => vi.advanceTimersByTime(120_000));
		detailNowMs =
			agentProfilesCardSpy.mock.calls.at(-1)?.[0].wakeAvailabilityNowMs;
		expect(formatAgentWakeAvailabilityCheckedAt(checkedAt, detailNowMs)).toBe(
			"checked 3 minutes ago"
		);
	});

	it("counts self-requests needing attention without work in progress or teammate requests", () => {
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			const organizationProjection = resolveOrganizationProjectionQuery(
				queryKey,
				organizationDirectoryFixture
			);
			if (organizationProjection) {
				return organizationProjection;
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: {
						organizationId: "org-123",
						requests: [
							{
								id: "request-pending",
								status: "pending",
								requesterUserId: "user-123",
								targetOwnerUserId: "user-123",
							},
							{
								id: "request-approved",
								status: "approved",
								requesterUserId: "user-123",
								targetOwnerUserId: "user-123",
							},
							{
								id: "request-other-requester",
								status: "approved",
								requesterUserId: "user-other",
								targetOwnerUserId: "user-123",
							},
							{
								id: "request-completed",
								status: "completed",
								requesterUserId: "user-123",
								targetOwnerUserId: "user-123",
							},
							{
								id: "request-teammate",
								status: "approved",
								requesterUserId: "user-123",
								targetOwnerUserId: "user-other",
							},
						],
					},
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		expect(agentProfilesWorkspaceSpy).toHaveBeenCalledWith(
			expect.objectContaining({ creationAttentionCount: 1 })
		);
	});

	it.each([
		false,
		true,
	])("refreshes before opening the created Agent and respects leaving the page: %s", async (leavePage) => {
		const refreshes: (() => void)[] = [];
		invalidateQueriesMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					refreshes.push(resolve);
				})
		);
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			const organizationProjection = resolveOrganizationProjectionQuery(
				queryKey,
				organizationDirectoryFixture
			);
			if (organizationProjection) {
				return organizationProjection;
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: {
						organizationId: "org-123",
						requests: [
							{
								createdAgentProfileId: "agent-created",
								id: "request-completed",
								status: "completed",
							},
						],
					},
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		const page = render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={null}
				focusRequestId="request-completed"
			/>
		);

		expect(navigateMock).not.toHaveBeenCalled();
		if (leavePage) {
			page.unmount();
		}
		await act(() => {
			for (const finish of refreshes) {
				finish();
			}
		});
		if (leavePage) {
			expect(navigateMock).not.toHaveBeenCalled();
		} else {
			await waitFor(() => {
				expect(navigateMock).toHaveBeenCalledWith({
					to: "/o/acme/agents?profileId=agent-created",
				});
			});
		}
		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["organizations", "org-123", "profile-directory"],
		});
	});

	it.each([
		{ personId: undefined, returnToAgentDirectory: undefined },
		{
			personId: "11111111-1111-4111-8111-111111111111",
			returnToAgentDirectory: true,
		},
	])("preserves the Agent directory return route when selecting an Agent: %j", (input) => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={null}
				{...input}
			/>
		);

		agentProfilesWorkspaceSpy.mock.calls
			.at(-1)?.[0]
			.onSelectProfile("agt_11111111-1111-4111-8111-111111111111");

		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/people/11111111-1111-4111-8111-111111111111/agents/agt_11111111-1111-4111-8111-111111111111",
			search: { from: "agents" },
		});
	});

	it("passes the Core-owned workload summary and owner locations into Profile Details", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		const detailCall = [...agentProfilesCardSpy.mock.calls]
			.reverse()
			.find(([props]) => props.presentation === "detail")?.[0];
		expect(
			detailCall?.agentProfileOperationalContextByProfileId?.get(
				"agt_11111111-1111-4111-8111-111111111111"
			)
		).toEqual({
			currentWorkLocation: "Launch planning",
			queuedWorkLocations: ["Customer follow-up"],
			recoveryAction: null,
			status: "working",
			waitingCount: 1,
		});
	});

	it("passes the exact owner recovery action into Profile Details", () => {
		const profile = organizationDirectoryFixture.agentProfiles[0];
		if (
			!profile?.operationalContext ||
			profile.operationalContext.status !== "working"
		) {
			throw new Error("Expected the Agent workload fixture.");
		}
		profile.operationalContext = {
			...profile.operationalContext,
			recoveryAction: "skip_interrupted_work",
			recoveryTargetWakeLifecycleId: "twl_interrupted",
			status: "paused",
		};

		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		const detailCall = [...agentProfilesCardSpy.mock.calls]
			.reverse()
			.find(([props]) => props.presentation === "detail")?.[0];
		expect(
			detailCall?.agentProfileOperationalContextByProfileId?.get(
				"agt_11111111-1111-4111-8111-111111111111"
			)
		).toEqual({
			currentWorkLocation: "Launch planning",
			queuedWorkLocations: ["Customer follow-up"],
			recoveryAction: { kind: "skip_interrupted_work" },
			recoveryTargetWakeLifecycleId: "twl_interrupted",
			status: "paused",
			waitingCount: 1,
		});
	});

	it("redacts recovery actions from a teammate's Agent Profile", () => {
		const profile = organizationDirectoryFixture.agentProfiles[0];
		if (
			!profile?.operationalContext ||
			profile.operationalContext.status !== "working"
		) {
			throw new Error("Expected the Agent workload fixture.");
		}
		profile.ownerUserId = "another-user";
		profile.operationalContext = {
			...profile.operationalContext,
			recoveryAction: "skip_interrupted_work",
			recoveryTargetWakeLifecycleId: "twl_private",
			status: "paused",
		};

		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId="agt_11111111-1111-4111-8111-111111111111"
			/>
		);

		const detailCall = [...agentProfilesCardSpy.mock.calls]
			.reverse()
			.find(([props]) => props.presentation === "detail")?.[0];
		expect(
			detailCall?.agentProfileOperationalContextByProfileId?.get(
				"agt_11111111-1111-4111-8111-111111111111"
			)
		).toEqual({
			currentWorkLocation: null,
			queuedWorkLocations: [],
			recoveryAction: null,
			status: "paused",
			waitingCount: 1,
		});
	});

	it("resets profile-specific detail state when selecting another Agent", () => {
		const directory = buildOrganizationDirectory();
		const firstAgent = directory.agentProfiles[0];
		if (!firstAgent) {
			throw new Error("Expected the directory Agent fixture.");
		}
		const secondAgent = {
			...firstAgent,
			ownerName: "Mira",
			ownerUserId: "user-456",
			profileHandle: "analyst",
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "Analyst",
		};
		directory.agentProfiles = [firstAgent, secondAgent];
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			const organizationProjection = resolveOrganizationProjectionQuery(
				queryKey,
				directory
			);
			if (organizationProjection) {
				return organizationProjection;
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: { organizationId: "org-123", requests: [] },
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		const { rerender } = render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={firstAgent.profileId}
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		expect(screen.getByText("Editing Scout")).toBeTruthy();

		rerender(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={secondAgent.profileId}
			/>
		);
		expect(screen.getByText("Viewing Analyst")).toBeTruthy();
		expect(screen.queryByText("Editing Analyst")).toBeNull();
	});

	it("opens an Agent from requests with one view-and-profile transition", () => {
		const onAgentViewChange = vi.fn();
		render(
			<PeopleAndAgentsPage
				activeAgentView="requests"
				activeSectionId="agents"
				focusProfileId="agent-before-request"
				onAgentViewChange={onAgentViewChange}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Open requested Agent" })
		);

		expect(onAgentViewChange).toHaveBeenCalledTimes(1);
		expect(onAgentViewChange).toHaveBeenCalledWith(
			"agents",
			"agt_11111111-1111-4111-8111-111111111111"
		);
	});

	it("keeps the routed selection independent of the complete Agent list", async () => {
		const directory = buildOrganizationDirectory();
		const firstAgent = directory.agentProfiles[0];
		if (!firstAgent) {
			throw new Error("Expected the directory Agent fixture.");
		}
		const secondAgent = {
			...firstAgent,
			ownerName: "Mira",
			ownerUserId: "user-456",
			profileHandle: "analyst",
			profileId: "agt_22222222-2222-4222-8222-222222222222",
			profileName: "Analyst",
		};
		directory.agentProfiles = [firstAgent, secondAgent];
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			const organizationProjection = resolveOrganizationProjectionQuery(
				queryKey,
				directory
			);
			if (organizationProjection) {
				return organizationProjection;
			}
			if (queryKey.includes("agent-profile-creation-requests")) {
				return {
					data: { organizationId: "org-123", requests: [] },
					error: null,
					isError: false,
					isPending: false,
				};
			}
			return {
				data: [buildHumanProfile("human-default")],
				error: null,
				isError: false,
				isPending: false,
			};
		});

		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={secondAgent.profileId}
			/>
		);

		await waitFor(() => {
			expect(
				agentProfilesWorkspaceSpy.mock.calls
					.at(-1)?.[0]
					.profiles.map((profile: AuthProfileView) => profile.openMeldProfileId)
			).toEqual([firstAgent.profileId, secondAgent.profileId]);
			expect(
				agentProfilesCardSpy.mock.calls
					.at(-1)?.[0]
					.agentProfiles.map(
						(profile: AuthProfileView) => profile.openMeldProfileId
					)
			).toEqual([firstAgent.profileId, secondAgent.profileId]);
		});
		expect(screen.getByText("Viewing Analyst")).toBeTruthy();
	});

	it("keeps Create Agent in the sidebar when the list is empty", () => {
		const onAgentViewChange = vi.fn();
		Object.assign(currentOrganizationMock, {
			id: "user-123",
			isPersonal: true,
			name: "Personal",
			slug: "personal",
		});
		const emptyDirectory = {
			...buildOrganizationDirectory(),
			agentProfiles: [],
		};
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			return (
				resolveOrganizationProjectionQuery(queryKey, emptyDirectory) ?? {
					data: [buildHumanProfile("human-default")],
					error: null,
					isError: false,
					isPending: false,
				}
			);
		});

		render(
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={null}
				onAgentViewChange={onAgentViewChange}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));

		expect(navigateMock).toHaveBeenCalledWith({ to: "/o/personal/new-agent" });
		expect(screen.queryByRole("button", { name: "Agent requests" })).toBeNull();
	});

	it("uses only the canonical Personal Workspace directory instead of account-wide Agent Profiles", () => {
		Object.assign(currentOrganizationMock, {
			id: "org-personal",
			isPersonal: true,
			name: "Personal",
			slug: "personal",
		});
		const directory = buildOrganizationDirectory();
		directory.organizationId = "org-personal";
		directory.agentProfiles = directory.agentProfiles.map((profile) => ({
			...profile,
			organizationId: "org-personal",
			profileName: "Personal Scout",
		}));
		useQueryMock.mockImplementation((options: { queryKey?: unknown }) => {
			const queryKey = Array.isArray(options?.queryKey) ? options.queryKey : [];
			return (
				resolveOrganizationProjectionQuery(queryKey, directory) ?? {
					data: [buildHumanProfile("human-default")],
					error: null,
					isError: false,
					isPending: false,
				}
			);
		});
		useLocalAgentRecoveryControllerMock.mockReturnValue({
			...buildRecoveryStub(),
			agentProfiles: [
				buildAgentProfile("agent-amplift", "Codex - openmeld"),
				buildAgentProfile(
					"agent-production-smoke",
					"Production Smoke Codex — Aug 28"
				),
			],
		});

		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		expect(useLocalAgentRecoveryControllerMock).toHaveBeenCalledWith(
			expect.objectContaining({
				loadAgentProfiles: true,
				loadAgentExecutionReadiness: false,
			})
		);
		expect(
			agentProfilesWorkspaceSpy.mock.calls
				.at(-1)?.[0]
				.profiles.map((profile: AuthProfileView) => profile.profileName)
		).toEqual(["Personal Scout"]);
		expect(
			agentProfilesCardSpy.mock.calls
				.at(-1)?.[0]
				.agentProfiles.map((profile: AuthProfileView) => profile.profileName)
		).toEqual(["Personal Scout"]);
	});

	it("opens Agent creation in its own route in the active workspace", () => {
		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		expect(navigateMock).toHaveBeenCalledWith({ to: "/o/acme/new-agent" });
		expect(createAgentProfilePageSpy).not.toHaveBeenCalled();
	});

	it("creates Human Profiles directly in the active workspace", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="people"
				focusProfileId="human-default"
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

		expect(createProfileDialogSpy).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-123" })
		);
	});

	it("delegates organization Human Profiles and member controls to one overview", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="people"
				focusProfileId="human-default"
			/>
		);

		expect(screen.queryByText("People")).toBeNull();
		expect(screen.getByText("Human Profiles overview")).toBeTruthy();
		expect(directoryMembersOverviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				currentOrganization: expect.objectContaining({
					id: "org-123",
					isPersonal: false,
				}),
				focusProfileId: "human-default",
				storageScope: "user-123",
			})
		);
	});

	it("delegates personal Human Profiles without creating a second member list", () => {
		Object.assign(currentOrganizationMock, {
			id: "user-123",
			isPersonal: true,
			name: "Personal",
			slug: "personal",
		});

		render(
			<PeopleAndAgentsPage
				activeSectionId="people"
				focusProfileId="human-default"
			/>
		);

		expect(
			screen.queryByText("See the identity you use in Spaces.")
		).toBeNull();
		expect(screen.getByText("Human Profiles overview")).toBeTruthy();
		expect(directoryMembersOverviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				currentOrganization: expect.objectContaining({ isPersonal: true }),
				storageScope: "user-123",
			})
		);
	});
});
