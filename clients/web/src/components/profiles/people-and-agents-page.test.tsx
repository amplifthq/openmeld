import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type {
	AuthProfileView,
	CurrentLocalRuntimeReplyReadinessResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleAndAgentsPage } from "./people-and-agents-page";

const agentProfilesCardSpy = vi.hoisted(() => vi.fn());
const appOuterRailSpy = vi.hoisted(() => vi.fn());
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
const computerAttentionToneMock = vi.hoisted(() => vi.fn());
const FILTER_AGENTS_NAME = /Filter Agents/;
const CHECKING_AGENTS_FILTER_NAME = /Current filter: Checking, 0 Agents/;
const CREATE_AN_AGENT_PROFILE_NAME = /Create an Agent/;

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
	AppOuterRail: (props: {
		computerAttentionTone?: "warning" | "danger" | null;
	}) => {
		appOuterRailSpy(props);
		return <nav data-testid="outer-rail" />;
	},
}));

vi.mock("#/components/app/app-global-controls", () => ({
	AppGlobalControls: () => <div data-testid="global-controls" />,
}));

vi.mock("#/components/app/use-computer-attention-tone", () => ({
	useComputerAttentionTone: computerAttentionToneMock,
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
		agentProfiles?: readonly AuthProfileView[];
		availabilityFilter: string;
		canManageProfile?: (profile: AuthProfileView) => boolean;
		focusProfileId: string | null;
		isCurrentComputer: boolean;
		onCreateProfile?: () => void;
		showOwnerGroups?: boolean;
	}) => {
		agentProfilesCardSpy(props);
		return (
			<section data-testid="agent-profiles-card">
				Agents Card
				<button onClick={props.onCreateProfile} type="button">
					Create an Agent
				</button>
			</section>
		);
	},
}));

vi.mock("#/components/profiles/create-profile-dialog", () => ({
	CreateProfileDialog: (props: {
		onProfileCreated?: (profile: AuthProfileView) => void;
		organizationAuthorizationContext?: {
			organizationId: string;
			organizationName: string;
		};
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
		appOuterRailSpy.mockReset();
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
		useQueryMock
			.mockReset()
			.mockImplementation((options: { queryKey?: unknown }) => {
				const queryKey = Array.isArray(options?.queryKey)
					? options.queryKey
					: [];
				if (queryKey.includes("directory")) {
					return {
						data: buildOrganizationDirectory(),
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
		computerAttentionToneMock.mockReset().mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("renders Agents as an independent home without a Directory sidebar", () => {
		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId="agt-1" />
		);

		expect(screen.getByTestId("outer-rail")).toBeTruthy();
		expect(screen.queryByTestId("inner-sidebar")).toBeNull();
		expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
		expect(
			screen.getByText(
				"Agents are the AI teammates in Acme. See who manages each one and whether it’s ready to work in Spaces."
			)
		).toBeTruthy();
		expect(screen.queryByText("Directory")).toBeNull();
		expect(screen.getByRole("button", { name: "Create Agent" })).toBeTruthy();
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
				focusProfileId: "agt-1",
				showOwnerGroups: true,
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

	it("keeps the Computer attention marker visible from Agents", () => {
		computerAttentionToneMock.mockReturnValue("warning");

		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		expect(appOuterRailSpy).toHaveBeenCalledWith(
			expect.objectContaining({ computerAttentionTone: "warning" })
		);
	});

	it("does not mark Computers without current attention", () => {
		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		expect(appOuterRailSpy).toHaveBeenCalledWith(
			expect.objectContaining({ computerAttentionTone: null })
		);
	});

	it("moves the create action into the empty Agents card", () => {
		Object.assign(currentOrganizationMock, {
			id: "user-123",
			isPersonal: true,
			name: "Personal",
			slug: "personal",
		});

		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		expect(screen.queryByRole("button", { name: "Create Agent" })).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_AN_AGENT_PROFILE_NAME })
		);

		expect(createProfileDialogSpy).toHaveBeenCalled();
	});

	it("passes organization authorization context when creating from organization Agents", () => {
		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));

		expect(createProfileDialogSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationAuthorizationContext: {
					organizationId: "org-123",
					organizationName: "Acme",
				},
			})
		);
	});

	it("does not pass organization authorization context from People", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="people"
				focusProfileId="human-default"
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

		expect(createProfileDialogSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationAuthorizationContext: undefined,
			})
		);
	});

	it("filters organization Agents by Wake availability", async () => {
		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		fireEvent.click(screen.getByRole("combobox", { name: FILTER_AGENTS_NAME }));
		const organizationMembersOption = await screen.findByRole("option", {
			name: "Organization members, 1 Agent",
		});
		expect(
			within(organizationMembersOption).getByText("Organization members")
		).toBeTruthy();
		const checkingOption = await screen.findByRole("option", {
			name: "Checking, 0 Agents",
		});
		expect(within(checkingOption).getByText("Checking")).toBeTruthy();
		expect(within(checkingOption).getByText("0")).toBeTruthy();
		fireEvent.click(checkingOption);

		await waitFor(() => {
			expect(
				screen.getByRole("combobox", {
					name: CHECKING_AGENTS_FILTER_NAME,
				})
			).toBeTruthy();
			expect(agentProfilesCardSpy).toHaveBeenLastCalledWith(
				expect.objectContaining({ availabilityFilter: "checking" })
			);
		});
	});

	it("delegates organization Human Profiles and member controls to one overview", () => {
		render(
			<PeopleAndAgentsPage
				activeSectionId="people"
				focusProfileId="human-default"
			/>
		);

		expect(
			screen.getByText(
				"See who belongs to Acme, invite teammates, and manage how each person appears in Spaces."
			)
		).toBeTruthy();
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
			screen.getByText("See the identity you use in Spaces.")
		).toBeTruthy();
		expect(screen.getByText("Human Profiles overview")).toBeTruthy();
		expect(directoryMembersOverviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				currentOrganization: expect.objectContaining({ isPersonal: true }),
				storageScope: "user-123",
			})
		);
	});

	it("opens the created profile on the matching first-level home", () => {
		render(
			<PeopleAndAgentsPage activeSectionId="agents" focusProfileId={null} />
		);

		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Create human profile" })
		);

		expect(invalidateQueriesMock).toHaveBeenCalledWith({
			queryKey: ["start", "profiles", "user-123"],
		});
		expect(navigateMock).toHaveBeenCalledWith({
			search: { profileId: "human-new" },
			to: "/o/acme/people",
		});
	});
});
