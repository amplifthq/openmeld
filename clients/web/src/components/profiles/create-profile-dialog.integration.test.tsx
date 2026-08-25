import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import { agentExecutionReadinessQueryKeys } from "#/query/agents/execution-readiness";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CreateProfileDialog } from "./create-profile-dialog";

const FELIX_ID = "11111111-1111-4111-8111-111111111111";
const NEW_HUMAN_ID = "55555555-5555-4555-8555-555555555555";
const NEW_AGENT_ID = "agt_99999999-9999-4999-8999-999999999999";
const CREATE_PROFILE_BUTTON_PATTERN = /create profile/i;
const CREATING_PROFILE_BUTTON_PATTERN = /creating profile/i;
const CHOOSE_LATER_PATTERN = /Choose later/i;
const HUMAN_PROFILE_CARD_PATTERN = /Human profile/i;
const AGENT_PROFILE_CARD_PATTERN = /Agent profile/i;
const OPENCODE_AGENT_PATTERN = /opencode/i;
const USE_AGENT_PROFILE_IN_ACME_PATTERN = /Use this Agent in Acme/;
const AUTO_AUTHORIZE_NEW_AGENT_PROFILES_IN_ACME_PATTERN =
	/Automatically authorize my new Agents in Acme/;
const BORDER_CLASS_PATTERN = /\bborder\b/;
const ASHLEY_RELEASE_SESSION_PATTERN = /Prepare the release · Codex · OpenMeld/;
const SPACE_JOIN_REQUIRES_HUMAN_MESSAGE =
	"Add a human profile to this account before bringing profiles into this Space.";

const listStartProfilesMock = vi.hoisted(() => vi.fn());
const getProfileCapabilitiesMock = vi.hoisted(() => vi.fn());
const createStartHumanProfileMock = vi.hoisted(() => vi.fn());
const createStartAgentProfileMock = vi.hoisted(() => vi.fn());
const deleteStartAgentProfileMock = vi.hoisted(() => vi.fn());
const addMembersMock = vi.hoisted(() => vi.fn());
const recordProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const refreshAllMock = vi.hoisted(() => vi.fn());
const checkRuntimeReadinessMock = vi.hoisted(() => vi.fn());
const ensureRuntimeBindingMock = vi.hoisted(() => vi.fn());
const setCurrentAgentProfileWorkspaceMock = vi.hoisted(() => vi.fn());
const getOrganizationBindingAuthorizationPreferenceMock = vi.hoisted(() =>
	vi.fn()
);
const bulkAuthorizeAgentProfileBindingsForOrganizationMock = vi.hoisted(() =>
	vi.fn()
);
const setOrganizationBindingAuthorizationPreferenceMock = vi.hoisted(() =>
	vi.fn()
);
const getAgentProfileCreationDefaultsMock = vi.hoisted(() => vi.fn());
const setAgentProfileCreationDefaultsMock = vi.hoisted(() => vi.fn());
const listProjectsMock = vi.hoisted(() => vi.fn());
const readOrganizationDirectoryMock = vi.hoisted(() => vi.fn());
const readOrganizationComputersMock = vi.hoisted(() => vi.fn());
const readCurrentAgentActivitySessionsMock = vi.hoisted(() => vi.fn());
const createAgentProfileCreationRequestMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: vi.fn(),
		warning: toastWarningMock,
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<button data-to={to} type="button">
			{children}
		</button>
	),
}));

vi.mock("@openmeld/api-client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@openmeld/api-client")>();
	return {
		...actual,
		createCurrentDeviceApi: () => ({
			setCurrentAgentProfileWorkspace: setCurrentAgentProfileWorkspaceMock,
		}),
	};
});

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: () => listStartProfilesMock(),
}));

vi.mock("#/lib/profiles/profile-capabilities", () => ({
	getProfileCapabilities: () => getProfileCapabilitiesMock(),
}));

vi.mock("#/lib/profiles/create-human-profile", () => ({
	createStartHumanProfile: (
		...args: Parameters<typeof createStartHumanProfileMock>
	) => createStartHumanProfileMock(...args),
}));

vi.mock("#/lib/profiles/create-agent-profile", () => ({
	createStartAgentProfile: (
		...args: Parameters<typeof createStartAgentProfileMock>
	) => createStartAgentProfileMock(...args),
}));

vi.mock("#/lib/profiles/delete-agent-profile", () => ({
	deleteStartAgentProfile: (
		...args: Parameters<typeof deleteStartAgentProfileMock>
	) => deleteStartAgentProfileMock(...args),
}));

vi.mock("#/lib/spaces/api", () => ({
	createOrganizationScopedWebSpaceApi: () => ({
		addMembers: addMembersMock,
	}),
}));

vi.mock("#/lib/onboarding/record-profile-space-history", () => ({
	recordProfileSpaceHistory: (
		...args: Parameters<typeof recordProfileSpaceHistoryMock>
	) => recordProfileSpaceHistoryMock(...args),
}));

vi.mock("#/lib/profiles/agent-profile-runtime-binding", () => ({
	checkWebAgentProfileRuntimeReadiness: (
		...args: Parameters<typeof checkRuntimeReadinessMock>
	) => checkRuntimeReadinessMock(...args),
	ensureWebAgentProfileRuntimeBinding: (
		...args: Parameters<typeof ensureRuntimeBindingMock>
	) => ensureRuntimeBindingMock(...args),
	formatWebAgentProfileRuntimeBindingFailure: () =>
		"OpenMeld could not save this local agent connection.",
	formatWebAgentProfileRuntimeBindingFailureActionLabel: () =>
		"Connect local agent",
	formatWebAgentProfileRuntimeReadinessFailure: () =>
		"OpenMeld could not confirm this computer can use that local agent.",
	shouldOfferWebAgentProfileSetupRefresh: () => false,
}));

vi.mock("#/lib/profiles/organization-binding-authorizations", () => ({
	bulkAuthorizeAgentProfileBindingsForOrganization: (
		...args: Parameters<
			typeof bulkAuthorizeAgentProfileBindingsForOrganizationMock
		>
	) => bulkAuthorizeAgentProfileBindingsForOrganizationMock(...args),
	getOrganizationBindingAuthorizationPreference: (
		...args: Parameters<
			typeof getOrganizationBindingAuthorizationPreferenceMock
		>
	) => getOrganizationBindingAuthorizationPreferenceMock(...args),
	setOrganizationBindingAuthorizationPreference: (
		...args: Parameters<
			typeof setOrganizationBindingAuthorizationPreferenceMock
		>
	) => setOrganizationBindingAuthorizationPreferenceMock(...args),
}));

vi.mock(
	"#/lib/profiles/agent-profile-creation-defaults",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("#/lib/profiles/agent-profile-creation-defaults")
			>();
		return {
			...actual,
			getAgentProfileCreationDefaults: (
				...args: Parameters<typeof getAgentProfileCreationDefaultsMock>
			) => getAgentProfileCreationDefaultsMock(...args),
			setAgentProfileCreationDefaults: (
				...args: Parameters<typeof setAgentProfileCreationDefaultsMock>
			) => setAgentProfileCreationDefaultsMock(...args),
		};
	}
);

vi.mock("#/query/organizations/projects", () => ({
	projectsQueryOptions: (input: { organizationId: string }) => ({
		queryFn: async () => await listProjectsMock(input),
		queryKey: ["organizations", input.organizationId, "projects"],
		staleTime: Number.POSITIVE_INFINITY,
	}),
}));

vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationDirectory: (
		...args: Parameters<typeof readOrganizationDirectoryMock>
	) => readOrganizationDirectoryMock(...args),
}));

vi.mock("#/lib/organizations/organization-computers", () => ({
	readCurrentOrganizationComputers: (
		...args: Parameters<typeof readOrganizationComputersMock>
	) => readOrganizationComputersMock(...args),
}));

vi.mock("#/lib/organizations/agent-activity", () => ({
	readCurrentAgentActivitySessions: (
		...args: Parameters<typeof readCurrentAgentActivitySessionsMock>
	) => readCurrentAgentActivitySessionsMock(...args),
}));

vi.mock(
	"#/lib/profiles/agent-profile-creation-requests",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("#/lib/profiles/agent-profile-creation-requests")
			>();
		return {
			...actual,
			createAgentProfileCreationRequest: (
				...args: Parameters<typeof createAgentProfileCreationRequestMock>
			) => createAgentProfileCreationRequestMock(...args),
		};
	}
);

vi.mock("#/query/config/model-catalog", () => ({
	modelCatalogQueryOptions: () => ({
		queryKey: ["config", "model-catalog"],
		queryFn: async () => ({
			schemaVersion: 1,
			updatedAt: "2026-06-18T00:00:00.000Z",
			agentControllers: {
				codex: {
					defaultModelId: "gpt-5.5",
					models: [
						{
							id: "gpt-5.5",
							displayName: "GPT-5.5",
							unavailable: false,
							supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
							minCliVersion: null,
						},
						{
							id: "gpt-5.4-mini",
							displayName: "GPT-5.4 Mini",
							unavailable: false,
							supportedReasoningLevels: ["low", "medium", "high", "xhigh"],
							minCliVersion: null,
						},
					],
				},
				"claude-code": {
					defaultModelId: "claude-opus-4-8",
					models: [
						{
							id: "claude-opus-4-8",
							displayName: "Claude Opus 4.8",
							unavailable: false,
							supportedReasoningLevels: [
								"low",
								"medium",
								"high",
								"xhigh",
								"max",
							],
							minCliVersion: "2.1.154",
						},
					],
				},
				cursor: {
					defaultModelId: "default[]",
					models: [
						{
							id: "default[]",
							displayName: "Auto",
							unavailable: false,
							supportedReasoningLevels: [],
							minCliVersion: null,
						},
						{
							id: "gpt-5.6-sol[context=272k,reasoning=high,fast=false]",
							displayName: "gpt-5.6-sol",
							unavailable: false,
							supportedReasoningLevels: [],
							minCliVersion: null,
						},
					],
				},
				opencode: {
					defaultModelId: "opencode/north-mini-code-free",
					models: [
						{
							id: "opencode/north-mini-code-free",
							displayName: "OpenCode North Mini Code Free",
							unavailable: false,
							supportedReasoningLevels: ["none", "high"],
							minCliVersion: null,
						},
						{
							id: "opencode/deepseek-v4-flash-free",
							displayName: "OpenCode DeepSeek V4 Flash Free",
							unavailable: false,
							supportedReasoningLevels: ["low", "medium", "high", "max"],
							minCliVersion: null,
						},
					],
				},
			},
		}),
		staleTime: Number.POSITIVE_INFINITY,
	}),
}));

type DialogRecovery = ComponentProps<typeof CreateProfileDialog>["recovery"];

function buildFakeRecovery(
	catalogEntries: readonly unknown[] = [],
	input: {
		fetchStatus?: "fetching" | "idle" | "paused";
		setProfileWorkspaceSupported?: boolean;
	} = {}
): DialogRecovery {
	const fetchStatus = input.fetchStatus ?? "idle";
	const setProfileWorkspaceSupported =
		input.setProfileWorkspaceSupported ?? true;
	return {
		deviceId: "device-123",
		runtimeLane: "dev-local",
		runContext: { localAgentIds: [] },
		storageScope: "scope-test",
		refreshAll: refreshAllMock,
		// Exercise the real-app fallback: the current-device target is unresolved
		// (selectedExecutionTarget + currentComputer null, no isCurrent computer),
		// so the catalog must be found via the reported localRuntimes computer.
		selectedExecutionTarget: null,
		currentComputer: null,
		currentDeviceTargetQuery: { data: undefined, fetchStatus },
		currentLocalRuntimeReplyReadinessQuery: { data: undefined, fetchStatus },
		localRuntimesQuery: {
			data: {
				currentDeviceId: null,
				currentRuntimeLane: null,
				localRuntimes:
					catalogEntries.length > 0
						? [
								{
									deviceId: "device-123",
									isCurrent: false,
									executionTargets: [
										{
											deviceId: "device-123",
											isCurrent: false,
											localAgentControl: {
												refreshCatalog: true,
												setEnabled: true,
												setProfileWorkspace: setProfileWorkspaceSupported,
											},
											localAgentCatalog: { entries: catalogEntries },
											runtimeLane: "dev-local",
										},
									],
								},
							]
						: [],
			},
			fetchStatus,
		},
	} as unknown as DialogRecovery;
}

function buildCrossComputerRecovery(): DialogRecovery {
	const codexCatalog = [
		buildCatalogEntry({
			agentId: "codex",
			launchStatus: "ready",
			selectable: true,
		}),
	];
	const recovery = buildFakeRecovery(codexCatalog);
	const currentComputer = recovery.localRuntimesQuery.data?.localRuntimes[0];
	if (!currentComputer) {
		throw new Error("Expected the fake current Computer.");
	}
	return {
		...recovery,
		localRuntimesQuery: {
			...recovery.localRuntimesQuery,
			data: {
				...recovery.localRuntimesQuery.data,
				localRuntimes: [
					{ ...currentComputer, connectedComputerId: "computer-current" },
					{
						...currentComputer,
						connectedComputerId: "computer-session",
						deviceId: "device-session",
						executionTargets: [
							{
								...currentComputer.executionTargets[0],
								deviceId: "device-session",
								runtimeLane: "canary",
							},
						],
					},
				],
			},
		},
	} as DialogRecovery;
}

function buildCatalogEntry(input: {
	agentId: string;
	detected?: boolean;
	displayName?: string;
	enabled?: boolean;
	launchStatus: string;
	lifecycleStatus?: "active" | "suspended";
	selectable: boolean;
	targetKind?: string;
}) {
	return {
		agentId: input.agentId,
		displayName: input.displayName ?? input.agentId,
		targetKind: input.targetKind ?? "builtin",
		detected: input.detected ?? input.launchStatus === "ready",
		enabled: input.enabled ?? input.launchStatus === "ready",
		lifecycleStatus: input.lifecycleStatus ?? "active",
		launchStatus: input.launchStatus,
		selectable: input.selectable,
		selectableReason: input.selectable ? null : "not_detected",
	};
}

function buildHumanProfileFixture() {
	return {
		openMeldProfileId: FELIX_ID,
		profileName: "Felix",
		profileHandle: "felix",
		profileKind: "human" as const,
		isDefault: true,
		status: "active" as const,
		ownerUserId: "user-123",
		source: "manual" as const,
		bindingState: "unbound" as const,
		createdByUserId: "user-123",
		creatorProfileId: null,
		lastUsedAt: null,
		createdAt: "2026-04-19T00:00:00.000Z",
		updatedAt: "2026-04-19T00:00:00.000Z",
	};
}

function buildAgentProfileFixture() {
	return {
		...buildHumanProfileFixture(),
		openMeldProfileId: NEW_AGENT_ID,
		profileName: "Research Agent",
		profileKind: "agent" as const,
		isDefault: false,
	};
}

function buildProjectFixture() {
	return {
		archivedAtMs: null,
		canArchive: true,
		canManage: true,
		createdAtMs: 1,
		createdByUserId: "user-123",
		id: "project-1",
		name: "OpenMeld",
		organizationId: "organization-123",
		repositoryFingerprint: null,
		repositoryUrl: null,
		slug: "openmeld",
		updatedAtMs: 1,
	};
}

function renderCreateProfileDialog(
	overrides: Partial<ComponentProps<typeof CreateProfileDialog>> = {}
) {
	const onOpenChange = vi.fn();
	const queryClient = createTestQueryClient();
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<TooltipProvider>
				<StartFlowStateProvider>
					<CreateProfileDialog
						onOpenChange={onOpenChange}
						open={true}
						organizationId="organization-123"
						recovery={buildFakeRecovery()}
						{...overrides}
					/>
				</StartFlowStateProvider>
			</TooltipProvider>
		</TestQueryClientProvider>
	);
	return { onOpenChange, queryClient };
}

async function fillProfileForm(input: { kind: RegExp; name: string }) {
	await waitFor(() => {
		expect(listStartProfilesMock).toHaveBeenCalled();
		expect(getProfileCapabilitiesMock).toHaveBeenCalled();
	});
	fireEvent.click(await screen.findByRole("tab", { name: input.kind }));
	fireEvent.change(screen.getByLabelText("Profile name"), {
		target: { value: input.name },
	});
	const submitButton = screen.getByRole("button", {
		name: CREATE_PROFILE_BUTTON_PATTERN,
	}) as HTMLButtonElement;
	await waitFor(() => {
		expect(submitButton.disabled).toBe(false);
	});
	fireEvent.click(submitButton);
}

async function selectAgentProfileKind() {
	fireEvent.click(
		await screen.findByRole("tab", { name: AGENT_PROFILE_CARD_PATTERN })
	);
}

describe("CreateProfileDialog", () => {
	beforeEach(() => {
		getProfileCapabilitiesMock.mockReset().mockResolvedValue({
			additionalHumanProfileCreationEnabled: true,
			ok: true,
		});
		listStartProfilesMock
			.mockReset()
			.mockResolvedValue([buildHumanProfileFixture()]);
		createStartHumanProfileMock.mockReset().mockResolvedValue({
			...buildHumanProfileFixture(),
			openMeldProfileId: NEW_HUMAN_ID,
			profileName: "Work",
			isDefault: false,
		});
		createStartAgentProfileMock
			.mockReset()
			.mockResolvedValue(buildAgentProfileFixture());
		deleteStartAgentProfileMock
			.mockReset()
			.mockResolvedValue(buildAgentProfileFixture());
		addMembersMock.mockReset().mockResolvedValue({
			addedMemberIds: [NEW_AGENT_ID],
			alreadyMemberIds: [],
			items: [],
		});
		recordProfileSpaceHistoryMock.mockReset().mockResolvedValue(undefined);
		refreshAllMock.mockReset().mockResolvedValue(undefined);
		checkRuntimeReadinessMock.mockReset().mockResolvedValue({
			agentControllerRef: "builtin:codex",
			deviceId: "device-123",
			lane: "dev-local",
			reasonCodes: ["agent_profile_binding.command_eligible"],
			routable: true,
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "runtime-123",
			},
			status: "accepted",
		});
		ensureRuntimeBindingMock.mockReset().mockResolvedValue({
			agentControllerRef: "builtin:codex",
			deviceId: "device-123",
			lane: "dev-local",
			outcome: "created",
			reasonCodes: ["agent_profile_binding.command_eligible"],
			routable: true,
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "runtime-123",
			},
			status: "accepted",
		});
		setCurrentAgentProfileWorkspaceMock.mockReset().mockResolvedValue({
			agentProfileId: NEW_AGENT_ID,
			status: "updated",
			workspaceMode: "openmeld_managed",
			workspacePath:
				"/Users/felix/.openmeld-dev/profiles/agt_99999999-9999-4999-8999-999999999999/workspace",
		});
		getOrganizationBindingAuthorizationPreferenceMock
			.mockReset()
			.mockResolvedValue({
				autoAuthorizeAgentProfileBindings: false,
			});
		bulkAuthorizeAgentProfileBindingsForOrganizationMock
			.mockReset()
			.mockResolvedValue({
				authorizations: [],
			});
		setOrganizationBindingAuthorizationPreferenceMock
			.mockReset()
			.mockResolvedValue({
				autoAuthorizeAgentProfileBindings: true,
			});
		listProjectsMock.mockReset().mockResolvedValue({ projects: [] });
		readOrganizationDirectoryMock.mockReset().mockResolvedValue({
			agentProfiles: [],
			generatedAt: "2026-08-20T00:00:00.000Z",
			members: [
				{ user: { name: "Felix" }, userId: "user-123" },
				{ user: { name: "Ashley" }, userId: "user-ashley" },
			],
			organizationId: "organization-123",
		});
		readOrganizationComputersMock.mockReset().mockResolvedValue({
			computers: [
				{
					computerId: "device-ashley",
					deviceDisplayName: "Ashley's Mac Studio",
					deviceType: "desktop",
					lastSeenAtMs: 1_775_952_000_000,
					localAgents: [
						{
							agentControllerRef: "builtin:codex",
							enabled: true,
							status: "ready",
						},
					],
					osVersion: "25.5.0",
					ownerUserId: "user-ashley",
					platformFamily: "macOS",
					serviceState: "connected",
				},
			],
			generatedAt: "2026-08-20T00:00:00.000Z",
			organizationId: "organization-123",
		});
		readCurrentAgentActivitySessionsMock.mockReset().mockResolvedValue({
			asOfMs: 1_787_220_000_000,
			coverage: [],
			nextCursor: null,
			organization: { id: "organization-123", name: "Acme" },
			sessions: [],
		});
		createAgentProfileCreationRequestMock.mockReset().mockResolvedValue({
			replayed: false,
			request: {
				actorProfileId: FELIX_ID,
				completedAt: null,
				configuration: {
					agentControllerPermissionMode: "codex:askForApproval",
					agentControllerRef: "builtin:codex",
					authorizeForOrganization: true,
					defaultProjectId: "project-1",
					modelId: "gpt-5.4-mini",
					openCodePermission: null,
					reasoningLevel: "high",
					targetComputerId: "device-ashley",
				},
				createdAgentProfileId: null,
				createdAt: "2026-08-20T00:00:00.000Z",
				decidedAt: null,
				failureMessage: null,
				id: "apcr-teammate",
				nativeSessionId: null,
				organizationId: "organization-123",
				profileName: "Release Agent",
				requestedSpaceId: null,
				requesterUserId: "user-123",
				sessionStrategy: "new",
				source: "web",
				status: "pending",
				statusReason: "approval_required",
				targetOwnerUserId: "user-ashley",
				updatedAt: "2026-08-20T00:00:00.000Z",
			},
		});
		getAgentProfileCreationDefaultsMock
			.mockReset()
			.mockImplementation(async ({ agentControllerRef, organizationId }) => ({
				agentControllerPermissionMode: null,
				agentControllerRef,
				defaultProjectId: null,
				modelId: null,
				openCodePermission: null,
				organizationId,
				reasoningLevel: null,
				updatedAt: null,
				userId: "user-123",
			}));
		setAgentProfileCreationDefaultsMock
			.mockReset()
			.mockImplementation(async (defaults) => ({
				...defaults,
				updatedAt: "2026-08-18T12:00:00.000Z",
				userId: "user-123",
			}));
		toastErrorMock.mockReset();
		toastWarningMock.mockReset();
	});

	it("prefills a working Session Resume and gives only the lightweight Fork suggestion", async () => {
		renderCreateProfileDialog({
			agentActivitySessionPreset: {
				agentControllerRef: "builtin:codex",
				computerId: "computer-1",
				localAgentName: "Codex",
				mode: "resume",
				nativeSessionId: "native-codex-thread-1",
				nativeSessionTitle: "Build Session Inventory",
				organizationId: "organization-123",
				ownerUserId: "user-123",
				projectId: "project-1",
				provider: "codex",
				status: "working",
			},
		});

		expect(
			await screen.findByText(
				"Connect this working Session to a new Agent. Fork it instead when you want to preserve the work already in progress."
			)
		).toBeTruthy();
		expect(
			(screen.getByLabelText("Profile name") as HTMLInputElement).value
		).toBe("Build Session Inventory");
		expect(
			screen.getByRole("heading", { name: "Create a new Agent" })
		).toBeTruthy();
		expect(
			screen.queryByRole("tab", { name: HUMAN_PROFILE_CARD_PATTERN })
		).toBeNull();
		expect(
			screen.queryByRole("tab", { name: AGENT_PROFILE_CARD_PATTERN })
		).toBeNull();
		expect(screen.getByText("Local agent for this Session")).toBeTruthy();
		expect(
			screen.getByText(
				"This Session stays connected to Codex on this computer."
			)
		).toBeTruthy();
		expect(screen.queryByText("Choose later")).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: CREATE_PROFILE_BUTTON_PATTERN,
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(
			await screen.findByText(
				"Connect this Session's computer and make Codex available before creating the profile."
			)
		).toBeTruthy();
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(screen.queryByText("Recommended score")).toBeNull();
	});

	it("targets Session Resume at the selected Session Computer", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		renderCreateProfileDialog({
			agentActivitySessionPreset: {
				agentControllerRef: "builtin:codex",
				computerId: "computer-session",
				localAgentName: "Codex",
				mode: "resume",
				nativeSessionId: "native-codex-thread-1",
				nativeSessionTitle: "Build Session Inventory",
				organizationId: "organization-123",
				ownerUserId: "user-123",
				projectId: "project-1",
				provider: "codex",
				status: "idle",
			},
			recovery: buildCrossComputerRecovery(),
		});

		const submitButton = await screen.findByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		});
		await waitFor(() => {
			expect((submitButton as HTMLButtonElement).disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentControllerConversationId: "native-codex-thread-1",
					deviceId: "device-session",
					runtimeLane: "canary",
					sessionInventorySelection: expect.objectContaining({
						computerId: "computer-session",
					}),
				})
			);
		});
	});

	it("uses a fresh creation key after stale Resume cleanup", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		ensureRuntimeBindingMock
			.mockResolvedValueOnce({
				agentControllerRef: "builtin:codex",
				reason: "binding_rejected",
				reasonCodes: ["agent_profile_binding.session_resume_unavailable"],
				routable: false,
				status: "rejected",
			})
			.mockResolvedValueOnce({
				agentControllerRef: "builtin:codex",
				deviceId: "device-session",
				lane: "canary",
				outcome: "created",
				reasonCodes: ["agent_profile_binding.command_eligible"],
				routable: true,
				openMeldServiceRuntimeId: {
					source: "runtime_registry_authority",
					value: "runtime-123",
				},
				status: "accepted",
			});
		renderCreateProfileDialog({
			agentActivitySessionPreset: {
				agentControllerRef: "builtin:codex",
				computerId: "computer-session",
				localAgentName: "Codex",
				mode: "resume",
				nativeSessionId: "native-codex-thread-1",
				nativeSessionTitle: "Build Session Inventory",
				organizationId: "organization-123",
				ownerUserId: "user-123",
				projectId: "project-1",
				provider: "codex",
				status: "idle",
			},
			recovery: buildCrossComputerRecovery(),
		});

		const submitButton = await screen.findByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		});
		await waitFor(() => {
			expect((submitButton as HTMLButtonElement).disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(deleteStartAgentProfileMock).toHaveBeenCalledWith({
				data: NEW_AGENT_ID,
			});
			expect((submitButton as HTMLButtonElement).disabled).toBe(false);
		});
		const firstKey =
			createStartAgentProfileMock.mock.calls[0]?.[0].data.idempotencyKey;
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(createStartAgentProfileMock).toHaveBeenCalledTimes(2);
		});
		const secondKey =
			createStartAgentProfileMock.mock.calls[1]?.[0].data.idempotencyKey;
		expect(firstKey).toEqual(expect.any(String));
		expect(secondKey).toEqual(expect.any(String));
		expect(secondKey).not.toBe(firstKey);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("creates a human profile on the account with the acting human as creator and joins no Space", async () => {
		const { onOpenChange } = renderCreateProfileDialog();

		await fillProfileForm({ kind: HUMAN_PROFILE_CARD_PATTERN, name: "Work" });

		await waitFor(() => {
			expect(createStartHumanProfileMock).toHaveBeenCalledWith({
				data: { profileName: "Work", creatorProfileId: FELIX_ID },
			});
		});
		expect(addMembersMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(refreshAllMock).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	it("keeps a teammate-owned Space request out of the members panel until approval", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		const onAfterJoin = vi.fn().mockResolvedValue(undefined);
		renderCreateProfileDialog({
			allowTeammateRequests: true,
			currentUserId: "user-123",
			onAfterJoin,
			organizationAuthorizationContext: {
				organizationId: "organization-123",
				organizationName: "Acme",
			},
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});

		fireEvent.click(
			await screen.findByRole("tab", { name: AGENT_PROFILE_CARD_PATTERN })
		);
		await waitFor(() => {
			expect(readOrganizationDirectoryMock).toHaveBeenCalled();
		});
		const teammateOwnerChoice = screen.getByRole("radio", {
			name: "A teammate",
		});
		await waitFor(() => {
			expect(teammateOwnerChoice.getAttribute("aria-disabled")).toBeNull();
		});
		fireEvent.click(teammateOwnerChoice);
		await screen.findByRole("combobox", { name: "Agent owner" });
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Agent owner" }).textContent
			).toContain("Ashley");
		});
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Release Agent" },
		});
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Default Project" }));
		fireEvent.click(await screen.findByRole("option", { name: "OpenMeld" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(
			await screen.findByRole("option", { name: "GPT-5.4 Mini" })
		);
		fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
		fireEvent.click(await screen.findByRole("option", { name: "High" }));
		fireEvent.click(screen.getByRole("button", { name: "Request Agent" }));

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith({
				configuration: {
					agentControllerPermissionMode: "codex:askForApproval",
					agentControllerRef: "builtin:codex",
					authorizeForOrganization: true,
					defaultProjectId: "project-1",
					modelId: "gpt-5.4-mini",
					openCodePermission: null,
					reasoningLevel: "high",
					targetComputerId: "device-ashley",
				},
				idempotencyKey: expect.any(String),
				nativeSessionId: null,
				organizationId: "organization-123",
				profileName: "Release Agent",
				requestedSpaceId: "space-123",
				sessionStrategy: "new",
				targetOwnerUserId: "user-ashley",
			});
		});
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(onAfterJoin).not.toHaveBeenCalled();
	});

	it("requests a teammate-owned Agent by resuming a Session chosen in the same dialog", async () => {
		getProfileCapabilitiesMock.mockResolvedValue({
			additionalHumanProfileCreationEnabled: false,
			ok: true,
		});
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		readCurrentAgentActivitySessionsMock.mockResolvedValue({
			asOfMs: 1_787_220_000_000,
			coverage: [],
			nextCursor: null,
			organization: { id: "organization-123", name: "Acme" },
			sessions: [
				{
					bindingState: "unbound",
					boundAgentProfileId: null,
					canFork: false,
					canResume: true,
					computer: {
						id: "device-ashley",
						lastSeenAtMs: 1_787_220_000_000,
						name: "Ashley's Mac Studio",
						state: "online",
					},
					dataState: "current",
					inventoryUpdatedAtMs: 1_787_220_000_000,
					lastActiveAtMs: 1_787_219_000_000,
					localAgent: {
						agentControllerRef: "builtin:codex",
						name: "Codex",
						provider: "codex",
					},
					nativeSessionId: "native-ashley-release",
					nativeSessionTitle: "Prepare the release",
					organization: { id: "organization-123", name: "Acme" },
					origin: "local",
					owner: { name: "Ashley", userId: "user-ashley" },
					project: { id: "project-1", name: "OpenMeld", slug: "openmeld" },
					startedAtMs: 1_787_218_000_000,
					status: "idle",
				},
			],
		});
		const { onOpenChange } = renderCreateProfileDialog({
			allowTeammateRequests: true,
			currentUserId: "user-123",
			organizationAuthorizationContext: {
				organizationId: "organization-123",
				organizationName: "Acme",
			},
		});

		await waitFor(() => {
			expect(readOrganizationDirectoryMock).toHaveBeenCalled();
		});
		const teammateOwnerChoice = screen.getByRole("radio", {
			name: "A teammate",
		});
		await waitFor(() => {
			expect(teammateOwnerChoice.getAttribute("aria-disabled")).toBeNull();
		});
		fireEvent.click(teammateOwnerChoice);
		expect(onOpenChange).not.toHaveBeenCalled();
		await screen.findByRole("combobox", { name: "Agent owner" });
		fireEvent.click(
			await screen.findByRole("radio", { name: "Use an existing Session" })
		);
		fireEvent.click(await screen.findByRole("combobox", { name: "Session" }));
		fireEvent.click(
			await screen.findByRole("option", {
				name: ASHLEY_RELEASE_SESSION_PATTERN,
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Request Agent" }));

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerRef: "builtin:codex",
						defaultProjectId: "project-1",
						targetComputerId: "device-ashley",
					}),
					nativeSessionId: "native-ashley-release",
					profileName: "Prepare the release",
					sessionStrategy: "resume",
					targetOwnerUserId: "user-ashley",
				})
			);
		});
	});

	it("defaults a working forkable teammate Session to Fork", async () => {
		getProfileCapabilitiesMock.mockResolvedValue({
			additionalHumanProfileCreationEnabled: false,
			ok: true,
		});
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		readCurrentAgentActivitySessionsMock.mockResolvedValue({
			asOfMs: 1_787_220_000_000,
			coverage: [],
			nextCursor: null,
			organization: { id: "organization-123", name: "Acme" },
			sessions: [
				{
					bindingState: "unbound",
					boundAgentProfileId: null,
					canFork: true,
					canResume: true,
					computer: {
						id: "device-ashley",
						lastSeenAtMs: 1_787_220_000_000,
						name: "Ashley's Mac Studio",
						state: "online",
					},
					dataState: "current",
					inventoryUpdatedAtMs: 1_787_220_000_000,
					lastActiveAtMs: 1_787_219_000_000,
					localAgent: {
						agentControllerRef: "builtin:codex",
						name: "Codex",
						provider: "codex",
					},
					nativeSessionId: "native-ashley-release",
					nativeSessionTitle: "Prepare the release",
					organization: { id: "organization-123", name: "Acme" },
					origin: "local",
					owner: { name: "Ashley", userId: "user-ashley" },
					project: { id: "project-1", name: "OpenMeld", slug: "openmeld" },
					startedAtMs: 1_787_218_000_000,
					status: "working",
				},
			],
		});
		renderCreateProfileDialog({
			allowTeammateRequests: true,
			currentUserId: "user-123",
			organizationAuthorizationContext: {
				organizationId: "organization-123",
				organizationName: "Acme",
			},
		});

		await waitFor(() => {
			expect(readOrganizationDirectoryMock).toHaveBeenCalled();
		});
		const teammateChoice = screen.getByRole("radio", { name: "A teammate" });
		await waitFor(() => {
			expect(teammateChoice.getAttribute("aria-disabled")).toBeNull();
		});
		fireEvent.click(teammateChoice);
		await screen.findByRole("combobox", { name: "Agent owner" });
		fireEvent.click(
			await screen.findByRole("radio", { name: "Use an existing Session" })
		);
		fireEvent.click(await screen.findByRole("combobox", { name: "Session" }));
		fireEvent.click(
			await screen.findByRole("option", {
				name: ASHLEY_RELEASE_SESSION_PATTERN,
			})
		);

		expect(
			screen.getByRole("radio", { name: "Fork" }).getAttribute("aria-checked")
		).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Request Agent" }));

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					nativeSessionId: "native-ashley-release",
					profileName: "Prepare the release",
					sessionStrategy: "fork",
					targetOwnerUserId: "user-ashley",
				})
			);
		});
	});

	it("opens a teammate Session from Agent Activity as an approval request", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		renderCreateProfileDialog({
			agentActivitySessionPreset: {
				agentControllerRef: "builtin:codex",
				computerId: "connected-computer-ashley",
				localAgentName: "Codex",
				mode: "fork",
				nativeSessionId: "native-ashley-release",
				nativeSessionTitle: "Prepare the release",
				organizationId: "organization-123",
				ownerUserId: "user-ashley",
				projectId: "project-1",
				provider: "codex",
				status: "working",
			},
			allowTeammateRequests: true,
			currentUserId: "user-123",
			organizationAuthorizationContext: {
				organizationId: "organization-123",
				organizationName: "Acme",
			},
		});

		expect(
			await screen.findByText(
				"Request an Agent for Ashley from a copy of this Session. The original stays unchanged."
			)
		).toBeTruthy();
		const submitButton = await screen.findByRole("button", {
			name: "Request Agent",
		});
		await waitFor(() => {
			expect((submitButton as HTMLButtonElement).disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						targetComputerId: "connected-computer-ashley",
					}),
					nativeSessionId: "native-ashley-release",
					sessionStrategy: "fork",
					targetOwnerUserId: "user-ashley",
				})
			);
		});
	});

	it("refreshes the new Agent and its readiness after a completed Fork request", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		const onAfterJoin = vi.fn().mockResolvedValue(undefined);
		createAgentProfileCreationRequestMock.mockResolvedValue({
			replayed: false,
			request: {
				actorProfileId: FELIX_ID,
				completedAt: "2026-08-20T00:00:05.000Z",
				configuration: {
					agentControllerPermissionMode: "codex:askForApproval",
					agentControllerRef: "builtin:codex",
					authorizeForOrganization: true,
					defaultProjectId: "project-1",
					modelId: "gpt-5.4-mini",
					openCodePermission: null,
					reasoningLevel: "high",
					targetComputerId: "computer-session",
				},
				createdAgentProfileId: NEW_AGENT_ID,
				createdAt: "2026-08-20T00:00:00.000Z",
				decidedAt: "2026-08-20T00:00:01.000Z",
				failureMessage: null,
				id: "apcr-self-fork",
				nativeSessionId: "native-codex-thread-1",
				organizationId: "organization-123",
				profileName: "Build Session Inventory",
				requestedSpaceId: "space-123",
				requesterUserId: "user-123",
				sessionStrategy: "fork",
				source: "web",
				status: "completed",
				statusReason: "created",
				targetOwnerUserId: "user-123",
				updatedAt: "2026-08-20T00:00:05.000Z",
			},
		});
		const { queryClient } = renderCreateProfileDialog({
			agentActivitySessionPreset: {
				agentControllerRef: "builtin:codex",
				computerId: "computer-session",
				localAgentName: "Codex",
				mode: "fork",
				nativeSessionId: "native-codex-thread-1",
				nativeSessionTitle: "Build Session Inventory",
				organizationId: "organization-123",
				ownerUserId: "user-123",
				projectId: "project-1",
				provider: "codex",
				status: "working",
			},
			currentUserId: "user-123",
			onAfterJoin,
			recovery: buildCrossComputerRecovery(),
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		const submitButton = await screen.findByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		});
		await waitFor(() => {
			expect((submitButton as HTMLButtonElement).disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(invalidateQueriesSpy).toHaveBeenCalledWith({
				queryKey: startQueryKeys.profilesForStorageScope("scope-test"),
				refetchType: "active",
			});
			expect(invalidateQueriesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					queryKey:
						agentExecutionReadinessQueryKeys.batchesForStorageScope(
							"scope-test"
						),
				})
			);
			expect(onAfterJoin).toHaveBeenCalledWith({
				openMeldProfileId: NEW_AGENT_ID,
				profileKind: "agent",
			});
		});
	});

	it("opens directly as Agent creation when additional Human creation is disabled", async () => {
		getProfileCapabilitiesMock.mockResolvedValue({
			additionalHumanProfileCreationEnabled: false,
			ok: true,
		});
		renderCreateProfileDialog();

		await waitFor(() => {
			expect(getProfileCapabilitiesMock).toHaveBeenCalled();
		});
		expect(
			screen.queryByRole("tab", { name: AGENT_PROFILE_CARD_PATTERN })
		).toBeNull();
		expect(
			screen.queryByRole("tab", { name: HUMAN_PROFILE_CARD_PATTERN })
		).toBeNull();
		expect(screen.getByText("Create an Agent on this account.")).toBeTruthy();
		expect(screen.getByLabelText("Profile name")).toBeTruthy();
		expect(
			screen.getByRole("radio", { name: CHOOSE_LATER_PATTERN })
		).toBeTruthy();
	});

	it("explains why Create profile is disabled until a profile kind is chosen", async () => {
		renderCreateProfileDialog();

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});

		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(submitButton.disabled).toBe(true);
		expect(
			screen.getByText("Choose an Agent Profile or Human Profile.")
		).toBeTruthy();

		await selectAgentProfileKind();

		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		expect(
			screen.queryByText("Choose an Agent Profile or Human Profile.")
		).toBeNull();
	});

	it("keeps the create form shrinkable inside the Dialog", async () => {
		renderCreateProfileDialog();

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		const panel = screen.getByTestId("create-profile-panel");

		expect(panel.tagName).toBe("FORM");
		expect(panel.className).toContain("min-w-0");
		expect(panel.className).toContain("min-h-0");
		expect(screen.getByTestId("create-profile-actions")).not.toBeNull();
	});

	it("keeps the Working folder state and create action clear while Projects load", async () => {
		listProjectsMock.mockImplementation(() => new Promise(() => undefined));
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));

		expect(await screen.findByText("Working folder")).toBeTruthy();
		expect(
			screen.getByRole("status", { name: "Loading working folder choices" })
		).toBeTruthy();
		const actions = screen.getByTestId("create-profile-actions");
		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(actions.contains(submitButton)).toBe(true);
		expect(submitButton.disabled).toBe(true);
		expect(
			screen.getByText("Loading your Projects and saved working folder.")
		).toBeTruthy();
	});

	it("creates an agent profile with Choose later and joins no Space", async () => {
		renderCreateProfileDialog();

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(createStartAgentProfileMock).toHaveBeenCalledWith({
				data: {
					creatorProfileId: FELIX_ID,
					idempotencyKey: expect.any(String),
					organizationId: "organization-123",
					profileName: "Research Agent",
				},
			});
		});
		expect(addMembersMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(refreshAllMock).toHaveBeenCalled();
		});
	});

	it("turns two same-tick form submits into one Agent Profile creation", async () => {
		const pendingCreates: Array<
			(profile: ReturnType<typeof buildAgentProfileFixture>) => void
		> = [];
		createStartAgentProfileMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					pendingCreates.push(resolve);
				})
		);
		renderCreateProfileDialog();

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		const form = submitButton.closest("form");
		if (!form) {
			throw new Error("Expected Create profile button inside a form.");
		}

		act(() => {
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true })
			);
			form.dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true })
			);
		});

		await waitFor(() => {
			expect(createStartAgentProfileMock).toHaveBeenCalled();
		});
		expect(createStartAgentProfileMock).toHaveBeenCalledTimes(1);
		const creatingButton = screen.getByRole("button", {
			name: CREATING_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(creatingButton.disabled).toBe(true);
		expect(creatingButton.getAttribute("aria-busy")).toBe("true");
		for (const resolveCreate of pendingCreates) {
			resolveCreate(buildAgentProfileFixture());
		}
		await waitFor(() => {
			expect(refreshAllMock).toHaveBeenCalled();
		});
	});

	it("reuses the creation idempotency key when the same Agent Profile intent is retried", async () => {
		createStartAgentProfileMock
			.mockRejectedValueOnce(new Error("Auth is temporarily unavailable."))
			.mockResolvedValueOnce(buildAgentProfileFixture());
		renderCreateProfileDialog();

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await screen.findByText("Auth is temporarily unavailable.");
		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(createStartAgentProfileMock).toHaveBeenCalledTimes(2);
		});
		const firstIdempotencyKey =
			createStartAgentProfileMock.mock.calls[0]?.[0].data.idempotencyKey;
		const secondIdempotencyKey =
			createStartAgentProfileMock.mock.calls[1]?.[0].data.idempotencyKey;
		expect(firstIdempotencyKey).toEqual(expect.any(String));
		expect(secondIdempotencyKey).toBe(firstIdempotencyKey);
	});

	it("joins the new profile into the Space as the acting human and refreshes the members panel", async () => {
		const onAfterJoin = vi.fn().mockResolvedValue(undefined);
		renderCreateProfileDialog({
			onAfterJoin,
			organizationId: "organization-123",
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(createStartAgentProfileMock).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(addMembersMock).toHaveBeenCalledWith({
				spaceId: "space-123",
				memberProfileIds: [NEW_AGENT_ID],
				requestContext: expect.objectContaining({
					actorContext: expect.objectContaining({
						openMeldProfileId: FELIX_ID,
					}),
				}),
			});
		});
		await waitFor(() => {
			expect(recordProfileSpaceHistoryMock).toHaveBeenCalledWith({
				spaceId: "space-123",
				spaceName: "Design Room",
				profileIds: [NEW_AGENT_ID],
				creatorProfileId: FELIX_ID,
				creatorKind: "human",
			});
		});
		await waitFor(() => {
			expect(onAfterJoin).toHaveBeenCalledWith(
				expect.objectContaining({
					openMeldProfileId: NEW_AGENT_ID,
					profileKind: "agent",
				})
			);
		});
	});

	it("keeps the created Agent in the Space when local Binding setup fails", async () => {
		ensureRuntimeBindingMock.mockResolvedValue({
			reasonCodes: ["agent_profile_binding.runtime_unavailable"],
			status: "retry_required",
		});
		const onAfterJoin = vi.fn().mockResolvedValue(undefined);
		const onProfileCreated = vi.fn();
		const { onOpenChange } = renderCreateProfileDialog({
			onAfterJoin,
			onProfileCreated,
			organizationId: "organization-123",
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(addMembersMock).toHaveBeenCalledWith({
				spaceId: "space-123",
				memberProfileIds: [NEW_AGENT_ID],
				requestContext: expect.objectContaining({
					actorContext: expect.objectContaining({
						openMeldProfileId: FELIX_ID,
					}),
				}),
			});
		});
		await waitFor(() => {
			expect(onProfileCreated).toHaveBeenCalledWith(
				expect.objectContaining({ openMeldProfileId: NEW_AGENT_ID })
			);
			expect(onOpenChange).toHaveBeenCalledWith(false);
			expect(toastWarningMock).toHaveBeenCalledWith(
				expect.stringContaining(
					"was created and added to Design Room, but local setup isn't complete"
				)
			);
		});
		expect(addMembersMock.mock.invocationCallOrder[0]).toBeLessThan(
			ensureRuntimeBindingMock.mock.invocationCallOrder[0] ?? 0
		);
		expect(createStartAgentProfileMock).toHaveBeenCalledTimes(1);
	});

	it("reports a created profile as partial success when Space membership fails", async () => {
		addMembersMock.mockRejectedValue(
			new Error("Space membership is unavailable.")
		);
		const onProfileCreated = vi.fn();
		const { onOpenChange } = renderCreateProfileDialog({
			onProfileCreated,
			organizationId: "organization-123",
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(addMembersMock).toHaveBeenCalledTimes(1);
			expect(onProfileCreated).toHaveBeenCalledWith(
				expect.objectContaining({ openMeldProfileId: NEW_AGENT_ID })
			);
			expect(onOpenChange).toHaveBeenCalledWith(false);
			expect(toastErrorMock).toHaveBeenCalledWith(
				expect.stringContaining(
					"was created, but OpenMeld couldn't add it to Design Room"
				)
			);
			expect(toastErrorMock).toHaveBeenCalledWith(
				expect.stringContaining(
					"Add the existing profile from the Members panel"
				)
			);
		});
		expect(createStartAgentProfileMock).toHaveBeenCalledTimes(1);
	});

	it("does not create an orphan agent when the account has no human profile in a Space", async () => {
		listStartProfilesMock.mockReset().mockResolvedValue([]);
		renderCreateProfileDialog({
			organizationId: "organization-123",
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(screen.getByText(SPACE_JOIN_REQUIRES_HUMAN_MESSAGE)).toBeTruthy();
		});
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(addMembersMock).not.toHaveBeenCalled();
	});

	it("offers selectable builtin local agents from the catalog as binding choices", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "cursor",
					launchStatus: "ready",
					selectable: true,
				}),
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
				buildCatalogEntry({
					agentId: "claude-code",
					detected: true,
					enabled: true,
					launchStatus: "needs_choice",
					selectable: true,
				}),
				buildCatalogEntry({
					agentId: "grok-build",
					launchStatus: "ready",
					selectable: true,
				}),
				buildCatalogEntry({
					agentId: "adel",
					launchStatus: "not_available",
					selectable: false,
				}),
			]),
		});

		await selectAgentProfileKind();

		await waitFor(() => {
			expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
		});
		expect(screen.getAllByText("Claude Code").length).toBeGreaterThan(0);
		const codexChoice = screen.getByRole("radio", { name: "Codex" });
		const claudeChoice = screen.getByRole("radio", { name: "Claude Code" });
		const grokChoice = screen.getByRole("radio", { name: "Grok Build" });
		const cursorChoice = screen.getByRole("radio", { name: "Cursor" });
		expect(codexChoice.compareDocumentPosition(claudeChoice)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(claudeChoice.compareDocumentPosition(grokChoice)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(grokChoice.compareDocumentPosition(cursorChoice)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(screen.getByTestId("local-agent-logo-grok-build")).toBeTruthy();
		expect(screen.queryByText("Adel")).toBeNull();
	});

	it("prepares a managed workspace for an unbound Agent when the current Service supports it", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "grok-build",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Future Grok Agent",
		});

		await waitFor(() => {
			expect(setCurrentAgentProfileWorkspaceMock).toHaveBeenCalledWith({
				agentProfileId: NEW_AGENT_ID,
				workspaceMode: "openmeld_managed",
			});
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("creates an unbound Agent without contacting a historical Service for workspace setup", async () => {
		const { onOpenChange } = renderCreateProfileDialog({
			recovery: buildFakeRecovery(
				[
					buildCatalogEntry({
						agentId: "grok-build",
						launchStatus: "ready",
						selectable: true,
					}),
				],
				{ setProfileWorkspaceSupported: false }
			),
		});

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Manual Teammate",
		});

		await waitFor(() => {
			expect(createStartAgentProfileMock).toHaveBeenCalled();
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(setCurrentAgentProfileWorkspaceMock).not.toHaveBeenCalled();
	});

	it("shows local agent loading state before treating the catalog as empty", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([], { fetchStatus: "fetching" }),
		});

		await selectAgentProfileKind();

		await waitFor(() => {
			expect(
				screen.getByText("Checking local agents on this computer.")
			).toBeTruthy();
		});
		const loadingStatus = screen.getByRole("status", {
			name: "Loading local agents",
		});
		expect(loadingStatus.tagName).toBe("OUTPUT");
		expect(
			screen.queryByText(
				"No available local agents were detected on this computer, so you can choose one later."
			)
		).toBeNull();
	});

	it("does not offer suspended local agents as new binding choices", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "openclaw",
					launchStatus: "ready",
					lifecycleStatus: "suspended",
					selectable: true,
				}),
			]),
		});

		await selectAgentProfileKind();

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		expect(screen.queryByRole("radio", { name: "Openclaw" })).toBeNull();
		expect(screen.queryByText("Openclaw")).toBeNull();
	});

	it("saves selected model and reasoning as Binding intent", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Codex permissions mode" })
			).toBeTruthy();
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Approve for me" }));
		await waitFor(() => {
			expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(screen.getByRole("option", { name: "GPT-5.4 Mini" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
		fireEvent.click(screen.getByRole("option", { name: "Medium" }));

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentProfileId: NEW_AGENT_ID,
					agentControllerPermissionMode: "codex:approveForMe",
					agentControllerRef: "builtin:codex",
					modelId: "gpt-5.4-mini",
					reasoningLevel: "medium",
				})
			);
		});
	});

	it("authorizes a bound Agent Profile for the current organization when created from Directory", async () => {
		const { queryClient } = renderCreateProfileDialog({
			organizationAuthorizationContext: {
				organizationId: "org-123",
				organizationName: "Acme",
			},
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));

		const organizationAccessCheckbox = await screen.findByLabelText(
			USE_AGENT_PROFILE_IN_ACME_PATTERN
		);
		expect((organizationAccessCheckbox as HTMLInputElement).checked).toBe(true);

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(
				bulkAuthorizeAgentProfileBindingsForOrganizationMock
			).toHaveBeenCalledWith({
				agentProfileIds: [NEW_AGENT_ID],
				organizationId: "org-123",
			});
		});
		expect(
			setOrganizationBindingAuthorizationPreferenceMock
		).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(invalidateQueriesSpy).toHaveBeenCalledWith({
				queryKey: organizationQueryKeys.directory("org-123"),
				refetchType: "active",
			});
		});
	});

	it("can enable future organization authorization while authorizing the new Agent Profile", async () => {
		renderCreateProfileDialog({
			organizationAuthorizationContext: {
				organizationId: "org-123",
				organizationName: "Acme",
			},
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		fireEvent.click(
			await screen.findByLabelText(
				AUTO_AUTHORIZE_NEW_AGENT_PROFILES_IN_ACME_PATTERN
			)
		);

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(
				bulkAuthorizeAgentProfileBindingsForOrganizationMock
			).toHaveBeenCalledWith({
				agentProfileIds: [NEW_AGENT_ID],
				organizationId: "org-123",
			});
		});
		await waitFor(() => {
			expect(
				setOrganizationBindingAuthorizationPreferenceMock
			).toHaveBeenCalledWith({
				autoAuthorizeAgentProfileBindings: true,
				organizationId: "org-123",
			});
		});
	});

	it("does not ask again when new Agent Profiles are already automatically authorized for the organization", async () => {
		getOrganizationBindingAuthorizationPreferenceMock.mockResolvedValue({
			autoAuthorizeAgentProfileBindings: true,
		});
		renderCreateProfileDialog({
			organizationAuthorizationContext: {
				organizationId: "org-123",
				organizationName: "Acme",
			},
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));

		await waitFor(() => {
			expect(
				screen.getByText(
					"New connected Agents are automatically authorized for this organization."
				)
			).toBeTruthy();
		});
		expect(
			screen.queryByLabelText(USE_AGENT_PROFILE_IN_ACME_PATTERN)
		).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(
				bulkAuthorizeAgentProfileBindingsForOrganizationMock
			).toHaveBeenCalledWith({
				agentProfileIds: [NEW_AGENT_ID],
				organizationId: "org-123",
			});
		});
	});

	it("uses the managed Project folder when a bound agent is created without a custom folder", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Working folder" }).textContent
			).toContain("Let OpenMeld choose");
		});
		expect(screen.queryByLabelText("Custom working folder path")).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(setCurrentAgentProfileWorkspaceMock).toHaveBeenCalledWith({
				agentProfileId: NEW_AGENT_ID,
				workspaceMode: "openmeld_managed",
			});
		});
	});

	it("saves a custom Project folder when a bound agent is created with an absolute folder path", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Working folder" }));
		fireEvent.click(
			await screen.findByRole("option", {
				name: "Choose a folder on this computer…",
			})
		);
		await waitFor(() => {
			expect(screen.getByLabelText("Custom working folder path")).toBeTruthy();
		});
		fireEvent.change(screen.getByLabelText("Custom working folder path"), {
			target: { value: "/Users/felix/Desktop/work/openmeld " },
		});

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(setCurrentAgentProfileWorkspaceMock).toHaveBeenCalledWith({
				agentProfileId: NEW_AGENT_ID,
				workspaceMode: "custom",
				workspacePath: "/Users/felix/Desktop/work/openmeld ",
			});
		});
	});

	it("saves selected OpenCode model variant as Binding intent", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "opencode",
					displayName: "OpenCode",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "OpenCode Agent" },
		});
		fireEvent.click(
			screen.getByRole("radio", { name: OPENCODE_AGENT_PATTERN })
		);
		await waitFor(() => {
			expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(
			screen.getByRole("option", {
				name: "OpenCode DeepSeek V4 Flash Free",
			})
		);
		fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
		fireEvent.click(screen.getByRole("option", { name: "Max" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "File changes" })
			).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("combobox", { name: "File changes" }));
		fireEvent.click(screen.getByRole("option", { name: "Ask before running" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Shell commands" }));
		fireEvent.click(screen.getByRole("option", { name: "Deny" }));

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentProfileId: NEW_AGENT_ID,
					agentControllerRef: "builtin:opencode",
					modelId: "opencode/deepseek-v4-flash-free",
					openCodePermission: {
						bash: "deny",
						edit: "ask",
					},
					reasoningLevel: "max",
				})
			);
		});
		await waitFor(() => {
			expect(setAgentProfileCreationDefaultsMock).toHaveBeenCalledWith({
				agentControllerPermissionMode: null,
				agentControllerRef: "builtin:opencode",
				defaultProjectId: null,
				modelId: "opencode/deepseek-v4-flash-free",
				openCodePermission: { bash: "deny", edit: "ask" },
				organizationId: "organization-123",
				reasoningLevel: "max",
			});
		});
	});

	it("restores creation choices per Local Agent without leaking them when the Agent changes", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		getAgentProfileCreationDefaultsMock.mockImplementation(
			async ({ agentControllerRef, organizationId }) => ({
				agentControllerPermissionMode:
					agentControllerRef === "builtin:codex" ? "codex:approveForMe" : null,
				agentControllerRef,
				defaultProjectId:
					agentControllerRef === "builtin:codex" ? "project-1" : null,
				modelId: agentControllerRef === "builtin:codex" ? "gpt-5.4-mini" : null,
				openCodePermission: null,
				organizationId,
				reasoningLevel: agentControllerRef === "builtin:codex" ? "high" : null,
				updatedAt: "2026-08-18T12:00:00.000Z",
				userId: "user-123",
			})
		);
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
				buildCatalogEntry({
					agentId: "claude-code",
					displayName: "Claude Code",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		fireEvent.click(
			await screen.findByRole("tab", { name: AGENT_PROFILE_CARD_PATTERN })
		);
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Codex permissions mode" })
					.textContent
			).toContain("Approve for me");
			expect(
				screen.getByRole("combobox", { name: "Model" }).textContent
			).toContain("GPT-5.4 Mini");
			expect(
				screen.getByRole("combobox", { name: "Reasoning effort" }).textContent
			).toContain("High");
			expect(
				screen.getByRole("combobox", { name: "Working folder" }).textContent
			).toContain("OpenMeld");
		});

		fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", {
					name: "Claude Code permissions mode",
				}).textContent
			).toContain("Ask permissions");
			expect(
				screen.getByRole("combobox", { name: "Model" }).textContent
			).toContain("Use controller default");
			expect(
				screen.getByRole("combobox", { name: "Working folder" }).textContent
			).toContain("Let OpenMeld choose");
		});
	});

	it("does not render Agent Controller Permission Mode for unsupported local controllers", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "openclaw",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "OpenClaw Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Openclaw" }));

		await waitFor(() => {
			expect(
				screen.queryByRole("combobox", {
					name: "Agent Controller permissions mode",
				})
			).toBeNull();
		});

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalled();
		});
		expect(ensureRuntimeBindingMock.mock.calls[0]?.[0]).toMatchObject({
			agentControllerRef: "builtin:openclaw",
		});
		expect(ensureRuntimeBindingMock.mock.calls[0]?.[0]).not.toHaveProperty(
			"agentControllerPermissionMode"
		);
	});

	it("resets Agent Controller Permission Mode when the selected local controller changes", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
				buildCatalogEntry({
					agentId: "claude-code",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Codex permissions mode" })
			).toBeTruthy();
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Approve for me" }));
		expect(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
				.textContent
		).toContain("Approve for me");

		fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));

		await waitFor(() => {
			expect(
				screen.getByRole("combobox", {
					name: "Claude Code permissions mode",
				}).textContent
			).toContain("Ask permissions");
		});
	});

	it("renders Agent Controller Permission Mode without an extra section border", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Codex permissions mode" })
			).toBeTruthy();
		});

		expect(
			screen.getByTestId("agent-controller-permission-mode-fields").className
		).not.toMatch(BORDER_CLASS_PATTERN);
	});

	it("renders Agent Controller Permission Mode after model selection", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));

		const modelSelect = await screen.findByRole("combobox", {
			name: "Model",
		});
		const permissionsModeSelect = screen.getByRole("combobox", {
			name: "Codex permissions mode",
		});

		expect(modelSelect.compareDocumentPosition(permissionsModeSelect)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("uses Cursor exact model choices without an independent reasoning selector", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "cursor",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.click(screen.getByRole("radio", { name: "Cursor" }));

		expect(await screen.findByRole("combobox", { name: "Model" })).toBeTruthy();
		expect(
			screen.getByRole("combobox", { name: "Cursor permissions mode" })
		).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: "Reasoning effort" })
		).toBeNull();
		expect(
			screen.getByText("Cursor includes reasoning in the exact model choice.")
		).toBeTruthy();
	});

	it("requires explicit confirmation before creating a dangerous Agent Controller Permission Mode binding", async () => {
		renderCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", { name: "Codex permissions mode" })
			).toBeTruthy();
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Full access" }));

		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(submitButton.disabled).toBe(true);
		fireEvent.click(
			screen.getByLabelText(
				"I understand this permissions mode can run with dangerous full access."
			)
		);
		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentControllerPermissionMode: "codex:fullAccess",
					agentControllerRef: "builtin:codex",
				})
			);
		});
	});
});
