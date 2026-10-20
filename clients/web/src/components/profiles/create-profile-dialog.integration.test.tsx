import type {
	AgentProfileCreationRequest,
	CreateAgentProfileCreationRequestResponse,
} from "@openmeld/schemas/types";
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

// Keep dormant request-flow tests available for an isolated future reopening.
const launchPolicy = vi.hoisted(() => ({ enabled: true }));
vi.mock("@openmeld/schemas", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/schemas")>()),
	get TEAMMATE_AGENT_REQUESTS_ENABLED() {
		return launchPolicy.enabled;
	},
}));

import { StartFlowStateProvider } from "#/components/app/start-flow-state";
import {
	readAgentCreationIntent,
	rememberAgentCreationIntent,
} from "#/lib/profiles/agent-creation-intent";
import { readPendingAgentProfileCreationLocalSetup } from "#/lib/profiles/agent-profile-creation-local-setup";
import { agentExecutionReadinessQueryKeys } from "#/query/agents/execution-readiness";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import vendorModelCatalog from "../../../../../release/vendor-models.json";
import {
	LegacyCreateProfileDialog as CreateProfileDialog,
	CreateProfileDialog as CurrentCreateProfileDialog,
} from "./create-profile-dialog";

const FELIX_ID = "11111111-1111-4111-8111-111111111111";
const NEW_HUMAN_ID = "55555555-5555-4555-8555-555555555555";
const NEW_AGENT_ID = "agt_99999999-9999-4999-8999-999999999999";
const CREATE_PROFILE_BUTTON_PATTERN = /create profile/i;
const CREATING_PROFILE_BUTTON_PATTERN = /creating profile/i;
const CHOOSE_LATER_PATTERN = /Choose later/i;
const HUMAN_PROFILE_CARD_PATTERN = /Person/i;
const AGENT_PROFILE_CARD_PATTERN = /Agent profile/i;
const REMOTE_AGENT_CARD_PATTERN = /Remote Agent/;
const OPENCODE_AGENT_PATTERN = /opencode/i;
const BORDER_CLASS_PATTERN = /\bborder\b/;
const ASHLEY_RELEASE_SESSION_PATTERN = /Prepare the release · Codex · OpenMeld/;
const DEFAULT_GPT_55_MODEL_PATTERN = /GPT-5.5 \(default\)/;
const AUTHORIZE_PATTERN = /authorize/i;
const USE_CONTROLLER_DEFAULT_PATTERN = /use controller default/i;
const CURRENT_CODEX_RADIO_PATTERN = /^Codex$/i;
const CUSTOMIZE_AGENT_BUTTON_PATTERN = /Advanced Agent Settings/i;
const WAKE_ACCESS_PATTERN = /Wake access/i;
const SPACE_JOIN_REQUIRES_HUMAN_MESSAGE =
	"Add a personal profile to this account before bringing profiles into this Space.";
const FIRST_USE_SELECTION_BY_AGENT_CONTROLLER_REF: Readonly<
	Record<string, { modelId: string | null; reasoningLevel: string | null }>
> = {
	"builtin:claude-code": {
		modelId: "claude-opus-4-8",
		reasoningLevel: null,
	},
	"builtin:codex": {
		modelId: "gpt-5.5",
		reasoningLevel: "high",
	},
};
type WebCreateAgentProfileCreationRequestInput = Parameters<
	typeof import("#/lib/profiles/agent-profile-creation-requests").createAgentProfileCreationRequest
>[0];

const listStartProfilesMock = vi.hoisted(() => vi.fn());
const getProfileCapabilitiesMock = vi.hoisted(() => vi.fn());
const createStartHumanProfileMock = vi.hoisted(() => vi.fn());
const createStartAgentProfileMock = vi.hoisted(() => vi.fn());
const addMembersMock = vi.hoisted(() => vi.fn());
const recordProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const refreshAllMock = vi.hoisted(() => vi.fn());
const readPeopleComputerReplyReadinessMock = vi.hoisted(() => vi.fn());
const checkRuntimeReadinessMock = vi.hoisted(() => vi.fn());
const ensureRuntimeBindingMock = vi.hoisted(() => vi.fn());
const setCurrentAgentProfileWorkspaceMock = vi.hoisted(() => vi.fn());
const getAgentProfileCreationDefaultsMock = vi.hoisted(() => vi.fn());
const setAgentProfileCreationDefaultsMock = vi.hoisted(() => vi.fn());
const listProjectsMock = vi.hoisted(() => vi.fn());
const readOrganizationDirectoryMock = vi.hoisted(() => vi.fn());
const readOrganizationComputersMock = vi.hoisted(() => vi.fn());
const readCurrentAgentActivitySessionsMock = vi.hoisted(() => vi.fn());
const createAgentProfileCreationRequestMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

// The shared setup workflow has its own completion integration suite. This
// boundary proves creation mounts that workflow without a second user action.
vi.mock("#/components/connect/start-bring-agents-setup-page", () => ({
	ComputerSetupFlow: () => (
		<section aria-label="Inline computer setup">Setup command</section>
	),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
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
				antigravity: vendorModelCatalog.agentControllers.antigravity,
				"center-agent": vendorModelCatalog.agentControllers["center-agent"],
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

vi.mock("#/lib/connect/local-runtimes", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/connect/local-runtimes")>()),
	readPeopleComputerReplyReadiness: (target: unknown) =>
		readPeopleComputerReplyReadinessMock(target),
}));

function buildFakeRecovery(
	catalogEntries: readonly unknown[] = [
		buildCatalogEntry({
			agentId: "codex",
			launchStatus: "ready",
			selectable: true,
		}),
	],
	input: {
		agentControllerInterface?: unknown;
		fetchStatus?: "fetching" | "idle" | "paused";
		setProfileWorkspaceSupported?: boolean;
	} = {}
): DialogRecovery {
	const fetchStatus = input.fetchStatus ?? "idle";
	const setProfileWorkspaceSupported =
		input.setProfileWorkspaceSupported ?? true;
	const recovery = {
		deviceId: "device-123",
		runtimeLane: "dev-local",
		runContext: { localAgentIds: [] },
		storageScope: "scope-test",
		refreshAll: refreshAllMock,
		// The fixture selects an explicit device/lane below. Historical reports
		// from an unselected computer must never supply the creation catalog.
		selectedExecutionTarget: null,
		currentComputer: null,
		currentDeviceTargetQuery: { data: undefined, fetchStatus, isPending: true },
		currentLocalRuntimeReplyReadinessQuery: {
			data: undefined,
			fetchStatus,
			isPending: true,
		},
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
											capabilities: input.agentControllerInterface
												? [
														{
															agentControllerInterface:
																input.agentControllerInterface,
															agentControllerRef: "builtin:codex",
															enabled: true,
															reasonCodes: [],
															status: "ready",
														},
													]
												: [],
											deviceId: "device-123",
											openMeldServiceRuntimeId: "runtime-device-123",
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
	const data = recovery.localRuntimesQuery.data;
	if (!data) {
		throw new Error("Expected the fixture Computer inventory.");
	}
	data.peopleComputers = {
		generatedAt: new Date().toISOString(),
		computers: data.localRuntimes.map((computer) => ({
			...computer,
			identityStatus: "unconfirmed",
			connection: { status: "connected", sessions: [], reasonCodes: [] },
		})) as typeof data.peopleComputers.computers,
	};
	recovery.currentComputer = data.localRuntimes[0] ?? null;
	recovery.selectedExecutionTarget =
		recovery.currentComputer?.executionTargets[0] ?? null;
	recovery.currentLocalRuntimeReplyReadinessQuery.data = {
		currentTarget: {
			availability: "resolved",
			deviceId: "device-123",
			runtimeLane: "dev-local",
		},
		status: "ready",
		nextAction: "none",
		service: { connected: true, matchingCurrentRuntime: true },
	} as NonNullable<typeof recovery.currentLocalRuntimeReplyReadinessQuery.data>;
	return recovery;
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

function buildAgentProfileCreationRequestResult(
	requestInput: WebCreateAgentProfileCreationRequestInput,
	overrides: Partial<AgentProfileCreationRequest> = {}
): CreateAgentProfileCreationRequestResponse {
	const isSelfOwned = requestInput.targetOwnerUserId === "user-123";
	const status = overrides.status ?? (isSelfOwned ? "completed" : "pending");
	const isCompleted = status === "completed";
	return {
		replayed: false,
		request: {
			actorProfileId: FELIX_ID,
			completedAt: isCompleted ? "2026-08-20T00:00:05.000Z" : null,
			configuration: requestInput.configuration,
			createdAgentProfileId: isCompleted ? NEW_AGENT_ID : null,
			createdAt: "2026-08-20T00:00:00.000Z",
			decidedAt: status === "pending" ? null : "2026-08-20T00:00:01.000Z",
			failureMessage: null,
			id: isSelfOwned ? "apcr-self" : "apcr-teammate",
			nativeSessionId: requestInput.nativeSessionId ?? null,
			organizationId: requestInput.organizationId,
			profileName: requestInput.profileName,
			requestedSpaceId: requestInput.requestedSpaceId ?? null,
			requesterUserId: "user-123",
			sessionStrategy: requestInput.sessionStrategy ?? "new",
			source: "web",
			status,
			statusReason: isCompleted ? "profile_created" : "approval_required",
			targetOwnerUserId: requestInput.targetOwnerUserId,
			updatedAt: isCompleted
				? "2026-08-20T00:00:05.000Z"
				: "2026-08-20T00:00:00.000Z",
			...overrides,
		},
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

function renderCurrentCreateProfileDialog(
	overrides: Partial<ComponentProps<typeof CurrentCreateProfileDialog>> = {}
) {
	const onOpenChange = vi.fn();
	const queryClient = createTestQueryClient();
	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<TooltipProvider>
				<StartFlowStateProvider>
					<CurrentCreateProfileDialog
						agentOnly={true}
						currentUserId="user-123"
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
	if (input.kind === AGENT_PROFILE_CARD_PATTERN) {
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));
	}
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
		launchPolicy.enabled = true;
		readPeopleComputerReplyReadinessMock.mockImplementation(async (target) => ({
			...buildFakeRecovery().currentLocalRuntimeReplyReadinessQuery.data,
			currentTarget: { availability: "resolved", ...target },
		}));
		window.localStorage.clear();
		window.sessionStorage.clear();
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
		createAgentProfileCreationRequestMock
			.mockReset()
			.mockImplementation(async (requestInput) =>
				buildAgentProfileCreationRequestResult(requestInput)
			);
		getAgentProfileCreationDefaultsMock
			.mockReset()
			.mockImplementation(({ agentControllerRef, organizationId }) => {
				const firstUseSelection = FIRST_USE_SELECTION_BY_AGENT_CONTROLLER_REF[
					agentControllerRef
				] ?? { modelId: null, reasoningLevel: null };
				return {
					agentControllerPermissionMode: null,
					agentControllerRef,
					defaultProjectId: null,
					...firstUseSelection,
					openCodePermission: null,
					organizationId,
					updatedAt: null,
					userId: "user-123",
				};
			});
		setAgentProfileCreationDefaultsMock
			.mockReset()
			.mockImplementation(async (defaults) => ({
				...defaults,
				updatedAt: "2026-08-18T12:00:00.000Z",
				userId: "user-123",
			}));
		toastErrorMock.mockReset();
		toastSuccessMock.mockReset();
		toastWarningMock.mockReset();
	});

	it.each([
		0, 1, 2, 3, 4, 5,
	])("selects connected computers and same-computer reconnects (scenario %i)", async (scenario) => {
		const connectedCount = scenario >= 3 ? 1 : scenario;
		const recovery = buildFakeRecovery();
		const inventory = recovery.localRuntimesQuery.data?.peopleComputers;
		const computer = inventory?.computers[0];
		if (!(inventory && computer)) {
			throw new Error("Expected the fixture Computer inventory.");
		}
		inventory.computers = [
			{
				...computer,
				deviceId: "online-device",
				deviceDisplayName: "Online laptop",
				executionTargets: [],
				connection: {
					status: "connected",
					reasonCodes: [],
					sessions: [
						{
							deviceId: "online-device",
							runtimeLane: "dev-local",
							lastHeartbeatMs: Date.now(),
							serviceVersion: "0.3.165",
							executionCompatibility: {
								status: "compatible",
								expectedEpoch:
									"runtime-transport-epoch-2026-07-default-project",
								observedEpoch:
									"runtime-transport-epoch-2026-07-default-project",
								reasonCode: "daemon.runtime_contract.compatible",
							},
							serviceUpdate: { wakeBlocked: false, reasonCodes: [] },
						},
					],
				},
			},
			{
				...computer,
				deviceDisplayName: "Offline laptop",
				connection: {
					status: "disconnected",
					sessions: [],
					reasonCodes: ["daemon.session.stale_lease"],
				},
			},
			{
				...computer,
				deviceId: "reconnect-device",
				deviceDisplayName: "Reconnect laptop",
				connection: {
					status: "unknown",
					sessions: [],
					reasonCodes: ["daemon.session.reject_conflict"],
				},
			},
			{
				...computer,
				deviceId: "unknown-device",
				deviceDisplayName: "Unknown laptop",
				connection: {
					status: "unknown",
					sessions: [],
					reasonCodes: ["computer.connection.lookup_failed"],
				},
			},
		];
		const onlineComputer = inventory.computers[0];
		if (!onlineComputer) {
			throw new Error("Expected the online Computer fixture.");
		}
		if (connectedCount === 0) {
			inventory.computers.shift();
		}
		if (connectedCount === 2) {
			inventory.computers.push({
				...onlineComputer,
				deviceId: "second-online-device",
				deviceDisplayName: "Online desktop",
				connection: {
					...onlineComputer.connection,
					sessions: onlineComputer.connection.sessions.map((session) => ({
						...session,
						deviceId: "second-online-device",
					})),
				},
			});
		}
		recovery.selectComputer = vi.fn((target) => {
			recovery.deviceId = target.deviceId;
			recovery.runtimeLane = target.runtimeLane;
		});
		if (scenario === 3) {
			inventory.computers = [
				{
					...onlineComputer,
					identityStatus: "enrolled",
					legacyDeviceIds: [recovery.deviceId ?? "device-123"],
				},
			];
		}
		if (scenario === 4) {
			const offlineComputer = inventory.computers[1];
			if (!offlineComputer) {
				throw new Error("Expected the selected offline Computer.");
			}
			offlineComputer.identityStatus = "enrolled";
		}
		if (scenario === 5) {
			// Inventory can arrive before the saved routing preference. Its
			// pending read is not permission to automatically choose a computer.
			recovery.deviceId = null;
		}
		renderCurrentCreateProfileDialog({ recovery });
		if (connectedCount === 0) {
			expect(screen.queryByRole("combobox", { name: "Computer" })).toBeNull();
			expect(screen.queryByText("Computer", { exact: true })).toBeNull();
			expect(screen.queryByText("Online laptop · Connected")).toBeNull();
			expect(screen.queryByText("Advanced connection selection")).toBeNull();
			expect(recovery.selectComputer).not.toHaveBeenCalled();
			return;
		}
		if (scenario === 1 || scenario === 3) {
			expect(recovery.selectComputer).toHaveBeenCalledWith({
				deviceId: "online-device",
				runtimeLane: "dev-local",
			});
			return;
		}
		fireEvent.click(await screen.findByRole("combobox", { name: "Computer" }));
		for (const name of [
			"Offline laptop · Offline",
			"Reconnect laptop · Reconnect required",
			"Unknown laptop · Status unavailable",
		]) {
			expect(screen.queryByRole("option", { name })).toBeNull();
		}
		expect(recovery.selectComputer).not.toHaveBeenCalled();
		const online = screen.getByRole("option", {
			name: "Online laptop · Connected",
		});
		expect(online.getAttribute("aria-disabled")).not.toBe("true");
		fireEvent.click(online);
		expect(recovery.selectComputer).toHaveBeenCalledWith({
			deviceId: "online-device",
			runtimeLane: "dev-local",
		});
	});

	it("does not offer teammate creation while held for launch", async () => {
		launchPolicy.enabled = false;
		renderCreateProfileDialog({ orgSlug: "acme", allowTeammateRequests: true });
		await selectAgentProfileKind();
		expect(screen.queryByRole("radio", { name: "A teammate" })).toBeNull();
	});

	it("keeps every local agent visible and opens connection recovery for the selected one", async () => {
		const recovery = buildFakeRecovery();
		const computer =
			recovery.localRuntimesQuery.data?.peopleComputers.computers[0];
		if (!computer) {
			throw new Error("Expected the fixture Computer inventory.");
		}
		computer.identityStatus = "enrolled";
		computer.connectedComputerId = "computer-office";
		computer.deviceDisplayName = "Office Mac";
		computer.connection = {
			status: "disconnected",
			sessions: [],
			reasonCodes: [],
		};
		const readiness = recovery.currentLocalRuntimeReplyReadinessQuery.data;
		if (!readiness) {
			throw new Error("Expected the fixture readiness projection.");
		}
		readiness.service.connected = false;
		readiness.service.matchingCurrentRuntime = false;
		renderCurrentCreateProfileDialog({ recovery });
		expect(await screen.findAllByRole("radio")).toHaveLength(6);
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		expect(
			await screen.findByRole("region", { name: "Inline computer setup" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Reconnect Computer" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Back to Agent setup" })
		).toBeNull();
		expect(screen.queryByText("Reconnect Office Mac")).toBeNull();
		expect(screen.getByDisplayValue("Connect a new computer")).toBeTruthy();
		fireEvent.change(
			screen.getByRole("combobox", { name: "Computer to reconnect" }),
			{ target: { value: computer.deviceId } }
		);
		expect(screen.getByText("Reconnect Office Mac")).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "Agent name" })).toBeNull();
		expect(
			(
				screen.getByRole("button", {
					name: "Create Agent",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
	});

	it("uses the new Agent-first flow and preserves a manually edited name", async () => {
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});

		expect(screen.queryByLabelText("Agent name")).toBeNull();
		fireEvent.click(
			await screen.findByRole("radio", {
				name: CURRENT_CODEX_RADIO_PATTERN,
			})
		);
		expect(
			(
				await screen.findByRole("button", {
					name: CUSTOMIZE_AGENT_BUTTON_PATTERN,
				})
			).getAttribute("aria-expanded")
		).toBe("true");
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Edit Model" }).textContent
			).toContain("GPT-5.5 (default) · High");
		});
		if (!screen.queryByRole("combobox", { name: "Model" })) {
			fireEvent.click(screen.getByRole("button", { name: "Edit Model" }));
		}
		expect(
			screen.getByRole("combobox", { name: "Model" }).textContent
		).toContain("GPT-5.5 (default)");
		expect(
			screen.getByRole("combobox", { name: "Reasoning effort" }).textContent
		).toContain("High");
		const modelSelect = screen.getByRole("combobox", { name: "Model" });
		fireEvent.click(modelSelect);
		const defaultModelOptions = await screen.findAllByRole("option", {
			name: "GPT-5.5 (default)",
		});
		expect(defaultModelOptions).toHaveLength(1);
		expect(
			screen.queryByRole("option", { name: USE_CONTROLLER_DEFAULT_PATTERN })
		).toBeNull();
		fireEvent.click(modelSelect);

		const nameInput = (await screen.findByLabelText(
			"Agent name"
		)) as HTMLInputElement;
		await waitFor(() => {
			expect(nameInput.value).toBe("Felix Codex GPT-5.5 High");
		});
		fireEvent.change(nameInput, { target: { value: "My persistent Agent" } });
		if (!screen.queryByRole("combobox", { name: "Model" })) {
			fireEvent.click(screen.getByRole("button", { name: "Edit Model" }));
		}
		const returnedModelSelect = await screen.findByRole("combobox", {
			name: "Model",
		});
		fireEvent.click(returnedModelSelect);
		fireEvent.click(
			await screen.findByRole("option", { name: "GPT-5.4 Mini" })
		);

		await waitFor(() => {
			expect(
				(screen.getByLabelText("Agent name") as HTMLInputElement).value
			).toBe("My persistent Agent");
		});
	});

	it("lets a user change the selected local agent more than once", async () => {
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					displayName: "Codex",
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

		const claudeCode = await screen.findByRole<HTMLInputElement>("radio", {
			name: "Claude Code",
		});
		expect(claudeCode.disabled).toBe(false);
		fireEvent.click(claudeCode);
		await waitFor(() => expect(claudeCode.checked).toBe(true));
		const codex = screen.getByRole<HTMLInputElement>("radio", {
			name: "Codex",
		});
		expect(codex.disabled).toBe(false);
		fireEvent.click(codex);
		await waitFor(() => expect(codex.checked).toBe(true));
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
			screen.getByRole("heading", { name: "Create an Agent" })
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
		readPeopleComputerReplyReadinessMock.mockClear();
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
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerRef: "builtin:codex",
						defaultProjectId: "project-1",
						targetComputerId: "device-session",
					}),
					nativeSessionId: "native-codex-thread-1",
					sessionStrategy: "resume",
					targetOwnerUserId: "user-123",
				})
			);
		});
		expect(readPeopleComputerReplyReadinessMock).toHaveBeenCalledWith({
			deviceId: "device-session",
			runtimeLane: "canary",
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("leaves Auth untouched when a Session Resume request is rejected", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		createAgentProfileCreationRequestMock.mockRejectedValue(
			new Error("This Session is no longer available on that computer.")
		);
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
			expect(
				screen.getByText(
					"This Session is no longer available on that computer."
				)
			).toBeTruthy();
		});
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
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
					agentControllerCollaborationMode: "codex:default",
					agentControllerPermissionMode: "codex:askForApproval",
					agentControllerRef: "builtin:codex",
					authorizeForOrganization: true,
					defaultProjectId: "project-1",
					modelId: "gpt-5.4-mini",
					openCodePermission: null,
					reasoningLevel: "high",
					targetComputerId: "device-ashley",
					localAgentConnectionCandidateId: null,
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

	it("refreshes the organization member directory after creating a Remote Agent", async () => {
		renderCurrentCreateProfileDialog();
		await waitFor(() => {
			expect(readOrganizationDirectoryMock).toHaveBeenCalled();
		});
		fireEvent.click(
			await screen.findByRole("tab", { name: REMOTE_AGENT_CARD_PATTERN })
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Agent name" }), {
			target: { value: "New Remote Partner" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Edit Model" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Provider" }));
		fireEvent.click(await screen.findByRole("option", { name: "OpenAI" }));
		expect(
			screen.getByRole("combobox", { name: "Model" }).textContent
		).toContain("Choose a model");
		expect(createAgentProfileCreationRequestMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(await screen.findByRole("option", { name: "GPT-6 Astra" }));
		fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
		const readsBeforeCreation = readOrganizationDirectoryMock.mock.calls.length;
		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						modelId: "openai/gpt-6-astra",
					}),
				})
			);
			expect(readOrganizationDirectoryMock.mock.calls.length).toBeGreaterThan(
				readsBeforeCreation
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
				statusReason: "profile_created",
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
					queryKey: agentExecutionReadinessQueryKeys.batchesForOrganization(
						"scope-test",
						"organization-123"
					),
				}),
				{ cancelRefetch: false }
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
			screen.queryByRole("radio", { name: CHOOSE_LATER_PATTERN })
		).toBeNull();
	});

	it("blocks a model the selected Codex installation does not offer", async () => {
		renderCreateProfileDialog({
			orgSlug: "acme",
			recovery: buildFakeRecovery(
				[
					buildCatalogEntry({
						agentId: "codex",
						launchStatus: "ready",
						selectable: true,
					}),
				],
				{
					agentControllerInterface: {
						agentControllerRef: "builtin:codex",
						models: [{ displayName: "GPT-5.4 Mini", id: "gpt-5.4-mini" }],
						version: "0.142.5",
					},
				}
			),
		});

		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));

		expect(
			await screen.findByText(
				"GPT-5.5 isn't available in Codex on this computer. Choose another model or update or change the installation."
			)
		).toBeTruthy();
		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(submitButton.disabled).toBe(true);
		expect(
			await screen.findByText(
				"Choose a model available in Codex on this computer."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Update or change Codex" })
				.getAttribute("data-to")
		).toBe("/o/acme/computers/device-123");

		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		expect(
			screen
				.getByRole("option", {
					name: DEFAULT_GPT_55_MODEL_PATTERN,
				})
				.hasAttribute("data-disabled")
		).toBe(true);
		fireEvent.click(screen.getByRole("option", { name: "GPT-5.4 Mini" }));

		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		expect(
			screen.queryByText("Choose a model available in Codex on this computer.")
		).toBeNull();
	});

	it("blocks a model the selected teammate Codex installation does not offer", async () => {
		readOrganizationComputersMock.mockResolvedValue({
			computers: [
				{
					computerId: "device-ashley",
					deviceDisplayName: "Ashley's Mac Studio",
					deviceType: "desktop",
					lastSeenAtMs: 1_775_952_000_000,
					localAgents: [
						{
							agentControllerRef: "builtin:codex",
							details: {
								capabilities: {
									approvals: true,
									cancel: true,
									interrupt: true,
									modelSelection: true,
									nativeEventStream: true,
									permissionModes: true,
									structuredUserInput: true,
								},
								checkedAt: "2026-08-20T00:00:00.000Z",
								launch: { installChoiceCount: 1, status: "ready" },
								models: [{ displayName: "GPT-5.4 Mini", id: "gpt-5.4-mini" }],
								nativeInterface: "codex-app-server",
								status: "ready",
								version: "0.142.5",
							},
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
		renderCreateProfileDialog({
			allowTeammateRequests: true,
			currentUserId: "user-123",
			orgSlug: "acme",
		});

		await selectAgentProfileKind();
		const teammateOwnerChoice = screen.getByRole("radio", {
			name: "A teammate",
		});
		await waitFor(() => {
			expect(teammateOwnerChoice.getAttribute("aria-disabled")).toBeNull();
		});
		fireEvent.click(teammateOwnerChoice);
		await screen.findByRole("combobox", { name: "Agent owner" });
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));

		expect(
			await screen.findByText(
				"GPT-5.5 isn't available in Codex on this computer. Choose another model or update or change the installation."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Update or change Codex" })
				.getAttribute("data-to")
		).toBe("/o/acme/computers/device-ashley");
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
		expect(screen.getByText("Choose a person or Agent Profile.")).toBeTruthy();

		await selectAgentProfileKind();
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));

		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		expect(screen.queryByText("Choose a person or Agent Profile.")).toBeNull();
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

	it("keeps managed-folder creation available while Projects load", async () => {
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
		await waitFor(() => expect(submitButton.disabled).toBe(false));
		expect(
			screen.getByText("Loading your Projects and saved working folder.")
		).toBeTruthy();
		await waitFor(() => expect(submitButton.disabled).toBe(false));
		fireEvent.click(submitButton);
		await waitFor(() =>
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({ defaultProjectId: null }),
				})
			)
		);
	});

	it("creates a self-owned Agent through the shared creation request", async () => {
		renderCreateProfileDialog();

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith({
				configuration: expect.objectContaining({
					agentControllerRef: "builtin:codex",
					defaultProjectId: null,
					targetComputerId: "device-123",
				}),
				idempotencyKey: expect.any(String),
				nativeSessionId: null,
				organizationId: "organization-123",
				profileName: "Research Agent",
				requestedSpaceId: null,
				sessionStrategy: "new",
				targetOwnerUserId: "user-123",
			});
		});
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(addMembersMock).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalledWith("Agent created.");
		});
	});

	it("turns two same-tick form submits into one Agent Profile creation", async () => {
		const defaultCreateRequest =
			createAgentProfileCreationRequestMock.getMockImplementation();
		let releaseCreateRequest: (() => void) | undefined;
		createAgentProfileCreationRequestMock.mockImplementation(
			async (...args) => {
				await new Promise<void>((resolve) => {
					releaseCreateRequest = resolve;
				});
				return await defaultCreateRequest?.(...args);
			}
		);
		renderCreateProfileDialog();

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));
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
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalled();
		});
		expect(createAgentProfileCreationRequestMock).toHaveBeenCalledTimes(1);
		const creatingButton = screen.getByRole("button", {
			name: CREATING_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(creatingButton.disabled).toBe(true);
		expect(creatingButton.getAttribute("aria-busy")).toBe("true");
		releaseCreateRequest?.();
		await waitFor(() => {
			expect(
				screen.queryByRole("button", {
					name: CREATING_PROFILE_BUTTON_PATTERN,
				})
			).toBeNull();
		});
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
	});

	it("reuses the creation idempotency key when the same Agent Profile intent is retried", async () => {
		const defaultCreateRequest =
			createAgentProfileCreationRequestMock.getMockImplementation();
		createAgentProfileCreationRequestMock
			.mockRejectedValueOnce(new Error("Core is temporarily unavailable."))
			.mockImplementationOnce(async (...args) =>
				defaultCreateRequest?.(...args)
			);
		renderCreateProfileDialog();

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await screen.findByText("Core is temporarily unavailable.");
		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledTimes(2);
		});
		const firstIdempotencyKey =
			createAgentProfileCreationRequestMock.mock.calls[0]?.[0].idempotencyKey;
		const secondIdempotencyKey =
			createAgentProfileCreationRequestMock.mock.calls[1]?.[0].idempotencyKey;
		expect(firstIdempotencyKey).toEqual(expect.any(String));
		expect({
			...createAgentProfileCreationRequestMock.mock.calls[1]?.[0],
			idempotencyKey: null,
		}).toEqual({
			...createAgentProfileCreationRequestMock.mock.calls[0]?.[0],
			idempotencyKey: null,
		});
		expect(secondIdempotencyKey).toBe(firstIdempotencyKey);
	});

	it("asks Core to create and join the Agent before refreshing the members panel", async () => {
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
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({ requestedSpaceId: "space-123" })
			);
		});
		await waitFor(() => {
			expect(onAfterJoin).toHaveBeenCalledWith(
				expect.objectContaining({
					openMeldProfileId: NEW_AGENT_ID,
					profileKind: "agent",
				})
			);
		});
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(addMembersMock).not.toHaveBeenCalled();
		expect(recordProfileSpaceHistoryMock).not.toHaveBeenCalled();
	});

	it("opens the committed Agent without waiting for background cache refreshes", async () => {
		const onAgentRequestCreated = vi.fn();
		const { queryClient, onOpenChange } = renderCreateProfileDialog({
			onAgentRequestCreated,
			organizationId: "organization-123",
		});
		let finishRefresh: () => void = () => undefined;
		const refreshGate = new Promise<void>((resolve) => {
			finishRefresh = resolve;
		});
		vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(refreshGate);

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledTimes(1);
		});
		try {
			await waitFor(() => {
				expect(onAgentRequestCreated).toHaveBeenCalledWith(
					expect.objectContaining({ createdAgentProfileId: NEW_AGENT_ID }),
					null
				);
				expect(onOpenChange).toHaveBeenCalledWith(false);
			});
		} finally {
			finishRefresh();
		}
	});

	it("reports Core's partial result without repeating local Binding or Space writes", async () => {
		createAgentProfileCreationRequestMock.mockImplementation(
			async (requestInput) =>
				buildAgentProfileCreationRequestResult(requestInput, {
					createdAgentProfileId: NEW_AGENT_ID,
					failureMessage:
						"The Agent was created, but its local connection needs attention.",
					status: "failed",
					statusReason: "profile_created",
				})
		);
		const onAgentRequestCreated = vi.fn();
		const recovery = buildFakeRecovery([
			buildCatalogEntry({
				agentId: "codex",
				launchStatus: "ready",
				selectable: true,
			}),
		]);
		const { onOpenChange } = renderCreateProfileDialog({
			onAgentRequestCreated,
			organizationId: "organization-123",
			recovery,
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
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
		fireEvent.focus(
			await screen.findByRole("option", { name: "On this computer" })
		);
		fireEvent.click(
			await screen.findByRole("option", {
				name: "On this computer",
			})
		);
		fireEvent.change(screen.getByLabelText("Custom working folder path"), {
			target: { value: "/Users/felix/Desktop/work/openmeld" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(onAgentRequestCreated).toHaveBeenCalledWith(
				expect.objectContaining({
					createdAgentProfileId: NEW_AGENT_ID,
					status: "failed",
					statusReason: "profile_created",
				}),
				null
			);
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
		expect(toastWarningMock).toHaveBeenCalledWith(
			"Your Agent was created, but setup needs attention. Open Creation history to review the issue and retry setup."
		);
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(setCurrentAgentProfileWorkspaceMock).not.toHaveBeenCalled();
		expect(addMembersMock).not.toHaveBeenCalled();
		expect(
			readPendingAgentProfileCreationLocalSetup({
				organizationId: "organization-123",
				requestId: "apcr-self",
				storageScope: recovery.storageScope,
			})
		).toEqual({
			agentProfileId: NEW_AGENT_ID,
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});
	});

	it("keeps a custom folder retryable when Core fails before committing the Profile", async () => {
		createAgentProfileCreationRequestMock.mockImplementation(
			async (requestInput) =>
				buildAgentProfileCreationRequestResult(requestInput, {
					createdAgentProfileId: null,
					failureMessage: "The selected Computer is no longer reachable.",
					status: "failed",
					statusReason: "profile_creation_failed",
				})
		);
		const recovery = buildFakeRecovery([
			buildCatalogEntry({
				agentId: "codex",
				launchStatus: "ready",
				selectable: true,
			}),
		]);
		renderCreateProfileDialog({
			organizationId: "organization-123",
			recovery,
		});

		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
		fireEvent.focus(
			await screen.findByRole("option", { name: "On this computer" })
		);
		fireEvent.click(
			await screen.findByRole("option", {
				name: "On this computer",
			})
		);
		fireEvent.change(screen.getByLabelText("Custom working folder path"), {
			target: { value: "/Users/felix/Desktop/work/openmeld" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(
				readPendingAgentProfileCreationLocalSetup({
					organizationId: "organization-123",
					requestId: "apcr-self",
					storageScope: recovery.storageScope,
				})
			).toEqual({
				agentProfileId: null,
				workspacePath: "/Users/felix/Desktop/work/openmeld",
			});
		});
		expect(setCurrentAgentProfileWorkspaceMock).not.toHaveBeenCalled();
	});

	it("reports Core's Space membership failure without retrying the write in Web", async () => {
		createAgentProfileCreationRequestMock.mockImplementation(
			async (requestInput) =>
				buildAgentProfileCreationRequestResult(requestInput, {
					createdAgentProfileId: NEW_AGENT_ID,
					failureMessage:
						"The Agent was created, but it could not be added to the Space.",
					status: "failed",
					statusReason: "profile_created",
				})
		);
		const onAgentRequestCreated = vi.fn();
		const { onOpenChange } = renderCreateProfileDialog({
			onAgentRequestCreated,
			organizationId: "organization-123",
			spaceContext: { spaceId: "space-123", spaceName: "Design Room" },
		});

		await fillProfileForm({
			kind: AGENT_PROFILE_CARD_PATTERN,
			name: "Research Agent",
		});

		await waitFor(() => {
			expect(onAgentRequestCreated).toHaveBeenCalledWith(
				expect.objectContaining({
					createdAgentProfileId: NEW_AGENT_ID,
					status: "failed",
					statusReason: "profile_created",
				}),
				null
			);
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
		expect(addMembersMock).not.toHaveBeenCalled();
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
	});

	it("does not create an Agent directly when Core rejects a missing acting profile", async () => {
		listStartProfilesMock.mockReset().mockResolvedValue([]);
		createAgentProfileCreationRequestMock.mockRejectedValue(
			new Error(SPACE_JOIN_REQUIRES_HUMAN_MESSAGE)
		);
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

	it("opens Antigravity model and permission controls with native choices", async () => {
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "antigravity",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});
		fireEvent.click(await screen.findByRole("radio", { name: "Antigravity" }));
		await screen.findByRole("button", {
			name: CUSTOMIZE_AGENT_BUTTON_PATTERN,
		});
		fireEvent.click(screen.getByRole("button", { name: "Edit Model" }));
		fireEvent.click(await screen.findByRole("combobox", { name: "Model" }));
		expect(
			await screen.findByRole("option", {
				name: "Claude Sonnet 4.6 (Thinking)",
			})
		).toBeTruthy();
		expect(
			screen.getByRole("option", { name: "GPT-OSS 120B (Medium)" })
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("option", { name: "Claude Sonnet 4.6 (Thinking)" })
		);
		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "Edit Permissions" }));
		fireEvent.click(
			await screen.findByRole("combobox", {
				name: "Antigravity permissions mode",
			})
		);
		expect(
			await screen.findByRole("option", { name: "Accept edits" })
		).toBeTruthy();
		expect(
			screen.getByRole("option", { name: "Bypass permissions" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("option", { name: "Accept edits" }));
		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerRef: "builtin:antigravity",
						modelId: "claude-sonnet-4-6",
						agentControllerPermissionMode: "antigravity:acceptEdits",
					}),
				})
			);
		});
	});

	it("links an uninstalled Antigravity selection to its exact guide", async () => {
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "antigravity",
					detected: false,
					enabled: false,
					launchStatus: "not_detected",
					selectable: false,
				}),
			]),
		});

		fireEvent.click(await screen.findByRole("radio", { name: "Antigravity" }));

		expect(
			await screen.findByText("Install Antigravity on this computer.")
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open install guide" })
				.getAttribute("href")
		).toBe("/guides/local-agents/antigravity");
		expect(
			(
				screen.getByRole("button", {
					name: "Create Agent",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});

	it("lets the user turn on the selected disabled local agent", async () => {
		const setLocalAgentEnabled = vi.fn().mockResolvedValue(undefined);
		const recovery = buildFakeRecovery([
			buildCatalogEntry({
				agentId: "antigravity",
				detected: true,
				enabled: false,
				launchStatus: "disabled",
				selectable: false,
			}),
		]);
		Object.assign(recovery, { setLocalAgentEnabled });
		renderCurrentCreateProfileDialog({ recovery });

		fireEvent.click(await screen.findByRole("radio", { name: "Antigravity" }));
		fireEvent.click(
			await screen.findByRole("switch", { name: "Enable Antigravity" })
		);

		await waitFor(() =>
			expect(setLocalAgentEnabled).toHaveBeenCalledWith({
				agentId: "antigravity",
				deviceId: "device-123",
				enabled: true,
				runtimeLane: "dev-local",
			})
		);
	});

	it("accepts an enabled local agent after a slow control report refresh", async () => {
		const setLocalAgentEnabled = vi.fn().mockRejectedValue({
			code: "local_agent_control.timeout",
			message: "Local agent control timed out.",
			status: 504,
		});
		const recovery = buildFakeRecovery([
			buildCatalogEntry({
				agentId: "antigravity",
				detected: true,
				enabled: false,
				launchStatus: "disabled",
				selectable: false,
			}),
		]);
		const currentData = recovery.localRuntimesQuery.data;
		if (!currentData) {
			throw new Error("Expected the fake Computer inventory.");
		}
		const confirmedData = {
			...currentData,
			localRuntimes: currentData.localRuntimes.map((computer) => ({
				...computer,
				executionTargets: computer.executionTargets.map((target) => ({
					...target,
					localAgentCatalog: {
						entries: target.localAgentCatalog.entries.map((entry) =>
							entry.agentId === "antigravity"
								? {
										...entry,
										enabled: true,
										launchStatus: "ready",
										selectable: true,
									}
								: entry
						),
					},
				})),
			})),
		};
		const refetch = vi
			.fn()
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: currentData })
			.mockResolvedValueOnce({ data: confirmedData });
		Object.assign(recovery, { setLocalAgentEnabled });
		Object.assign(recovery.localRuntimesQuery, { refetch });
		renderCurrentCreateProfileDialog({ recovery });

		fireEvent.click(await screen.findByRole("radio", { name: "Antigravity" }));
		const enableSwitch = await screen.findByRole("switch", {
			name: "Enable Antigravity",
		});
		vi.useFakeTimers();
		try {
			fireEvent.click(enableSwitch);
			await act(async () => {
				await Promise.resolve();
			});
			expect(refetch).toHaveBeenCalledOnce();

			await act(async () => {
				await vi.advanceTimersByTimeAsync(32_000);
			});
			expect(refetch).toHaveBeenCalledTimes(9);
			expect(enableSwitch.hasAttribute("data-unchecked")).toBe(true);
			expect(screen.queryByRole("alert")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports an explicit enable rejection without polling", async () => {
		const setLocalAgentEnabled = vi
			.fn()
			.mockRejectedValue(new Error("You don’t have permission to do that."));
		const recovery = buildFakeRecovery([
			buildCatalogEntry({
				agentId: "antigravity",
				detected: true,
				enabled: false,
				launchStatus: "disabled",
				selectable: false,
			}),
		]);
		const refetch = vi.fn();
		Object.assign(recovery, { setLocalAgentEnabled });
		Object.assign(recovery.localRuntimesQuery, { refetch });
		renderCurrentCreateProfileDialog({ recovery });

		fireEvent.click(await screen.findByRole("radio", { name: "Antigravity" }));
		fireEvent.click(
			await screen.findByRole("switch", { name: "Enable Antigravity" })
		);

		expect(
			(
				await screen.findByText("You don’t have permission to do that.")
			).getAttribute("role")
		).toBe("alert");
		expect(refetch).not.toHaveBeenCalled();
	});

	it("keeps a slow unconfirmed enable change as still applying", async () => {
		const controlTimeout = {
			code: "local_agent_control.timeout",
			message: "Local agent control timed out.",
			status: 504,
		};
		const setLocalAgentEnabled = vi.fn().mockRejectedValue(controlTimeout);
		const recovery = buildFakeRecovery([
			buildCatalogEntry({
				agentId: "antigravity",
				detected: true,
				enabled: false,
				launchStatus: "disabled",
				selectable: false,
			}),
		]);
		const refetch = vi
			.fn()
			.mockResolvedValue({ data: recovery.localRuntimesQuery.data });
		Object.assign(recovery, { setLocalAgentEnabled });
		Object.assign(recovery.localRuntimesQuery, { refetch });
		renderCurrentCreateProfileDialog({ recovery });

		fireEvent.click(await screen.findByRole("radio", { name: "Antigravity" }));
		const enableSwitch = await screen.findByRole("switch", {
			name: "Enable Antigravity",
		});
		vi.useFakeTimers();
		try {
			fireEvent.click(enableSwitch);
			await act(async () => {
				await vi.advanceTimersByTimeAsync(32_000);
			});

			expect(screen.queryByRole("alert")).toBeNull();
			expect(
				screen
					.getByText(
						"OpenMeld is still applying this change. Check again in a moment."
					)
					.tagName.toLowerCase()
			).toBe("output");
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows cached usage without blocking a signed-out local agent selection", async () => {
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery(
				[
					buildCatalogEntry({
						agentId: "codex",
						launchStatus: "ready",
						selectable: true,
					}),
				],
				{
					agentControllerInterface: {
						auth: { status: "unauthenticated" },
						models: [],
						status: "ready",
						usageLimits: [
							{
								key: "weekly",
								label: "Weekly usage",
								observedAt: "2026-09-21T08:00:00.000Z",
								resetsAt: "2026-09-22T08:00:00.000Z",
								status: "available",
								usedPercent: 25,
							},
						],
					},
				}
			),
		});

		fireEvent.click(await screen.findByRole("radio", { name: "Codex" }));

		expect(
			await screen.findByText("Sign in to Codex on this computer.")
		).toBeTruthy();
		expect(
			screen.getByLabelText("Codex usage limits, 75% left, Available")
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: CUSTOMIZE_AGENT_BUTTON_PATTERN })
		).toBeTruthy();
	});

	it("blocks an unbound Agent even when the form is submitted directly", async () => {
		const { onOpenChange } = renderCreateProfileDialog({
			recovery: buildFakeRecovery([]),
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Unconnected Agent" },
		});
		const submit = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		const form = submit.closest("form");
		expect(form).not.toBeNull();
		if (form) {
			fireEvent.submit(form);
		}
		await waitFor(() =>
			expect(
				screen.getByText(
					"Choose a local agent to continue. Connect a computer if none are available."
				)
			).toBeTruthy()
		);
		expect(createAgentProfileCreationRequestMock).not.toHaveBeenCalled();
		expect(createStartAgentProfileMock).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
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
		fireEvent.click(
			screen.getByRole("option", {
				name: "Approve for me",
			})
		);
		await waitFor(() => {
			expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
		});
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(screen.getByRole("option", { name: "GPT-5.4 Mini" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
		fireEvent.click(screen.getByRole("option", { name: "Medium" }));
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Plan" }));

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerCollaborationMode: "codex:plan",
						agentControllerPermissionMode: "codex:approveForMe",
						agentControllerRef: "builtin:codex",
						modelId: "gpt-5.4-mini",
						reasoningLevel: "medium",
					}),
				})
			);
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("creates the Agent in the selected workspace without cross-workspace authorization options", async () => {
		renderCreateProfileDialog({
			organizationId: "org-123",
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

		expect(screen.queryByText(AUTHORIZE_PATTERN)).toBeNull();
		expect(screen.queryByText(WAKE_ACCESS_PATTERN)).toBeNull();

		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", {
						name: CREATE_PROFILE_BUTTON_PATTERN,
					}) as HTMLButtonElement
				).disabled
			).toBe(false);
		});
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					organizationId: "org-123",
				})
			);
		});
		expect(
			createAgentProfileCreationRequestMock.mock.calls[0]?.[0].configuration
		).toMatchObject({ authorizeForOrganization: true });
	});

	it("creates with an OpenMeld-chosen folder when remembered Project connectivity is unconfirmed", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		getAgentProfileCreationDefaultsMock.mockResolvedValue({
			agentControllerCollaborationMode: null,
			agentControllerPermissionMode: null,
			agentControllerRef: "builtin:codex",
			defaultProjectId: "project-1",
			modelId: null,
			openCodePermission: null,
			organizationId: "organization-123",
			reasoningLevel: null,
			updatedAt: "2026-09-07T00:00:00.000Z",
		});
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
				screen.getByRole("combobox", { name: "Folder source" }).textContent
			).toContain("Let OpenMeld choose");
		});
		expect(screen.queryByLabelText("Custom working folder path")).toBeNull();

		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", {
						name: CREATE_PROFILE_BUTTON_PATTERN,
					}) as HTMLButtonElement
				).disabled
			).toBe(false);
		});
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({ defaultProjectId: null }),
				})
			);
		});
		expect(setCurrentAgentProfileWorkspaceMock).not.toHaveBeenCalled();
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
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
		fireEvent.focus(
			await screen.findByRole("option", { name: "On this computer" })
		);
		fireEvent.click(
			await screen.findByRole("option", {
				name: "On this computer",
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

	it("keeps the Local Agent's custom folder with its retry intent before Core responds", async () => {
		createAgentProfileCreationRequestMock.mockImplementation((requestInput) => {
			rememberAgentCreationIntent({
				fingerprint: "same-local-intent",
				idempotencyKey: requestInput.idempotencyKey,
				organizationId: requestInput.organizationId,
				profileName: requestInput.profileName,
				scope: "creation-reload-test",
			});
			requestInput.onStarted?.({
				configuration: requestInput.configuration,
				failureMessage: null,
				id: `optimistic:${requestInput.idempotencyKey}`,
				profileName: requestInput.profileName,
				requestFingerprint: "same-local-intent",
				status: "creating",
				targetOwnerUserId: requestInput.targetOwnerUserId,
			});
			return buildAgentProfileCreationRequestResult(requestInput);
		});
		renderCreateProfileDialog({
			clearIntentOnAcceptance: false,
			intentStorageScope: "creation-reload-test",
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
			waitForAgentRequestCompletion: false,
		});
		await waitFor(() => {
			expect(listStartProfilesMock).toHaveBeenCalled();
		});
		await selectAgentProfileKind();
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Research Agent" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
		fireEvent.focus(
			await screen.findByRole("option", { name: "On this computer" })
		);
		fireEvent.click(
			await screen.findByRole("option", { name: "On this computer" })
		);
		fireEvent.change(screen.getByLabelText("Custom working folder path"), {
			target: { value: "/tmp/recovered-agent-folder" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);
		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledOnce();
			expect(
				readAgentCreationIntent("creation-reload-test", "organization-123")
			).toEqual(
				expect.objectContaining({
					customWorkspacePath: "/tmp/recovered-agent-folder",
					profileName: "Research Agent",
				})
			);
		});
	});

	it("keeps the committed Agent visible when custom working folder setup fails", async () => {
		setCurrentAgentProfileWorkspaceMock.mockRejectedValue(
			new Error("The working folder is temporarily unavailable.")
		);
		const onAgentRequestCreated = vi.fn();
		const { onOpenChange } = renderCreateProfileDialog({
			onAgentRequestCreated,
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
		fireEvent.click(screen.getByRole("combobox", { name: "Folder source" }));
		fireEvent.focus(
			await screen.findByRole("option", { name: "On this computer" })
		);
		fireEvent.click(
			await screen.findByRole("option", {
				name: "On this computer",
			})
		);
		fireEvent.change(screen.getByLabelText("Custom working folder path"), {
			target: { value: "/Users/felix/Desktop/work/openmeld" },
		});

		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(onAgentRequestCreated).toHaveBeenCalledWith(
				expect.objectContaining({
					createdAgentProfileId: NEW_AGENT_ID,
					status: "completed",
				}),
				"The working folder is temporarily unavailable."
			);
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
		expect(createAgentProfileCreationRequestMock).toHaveBeenCalledTimes(1);
		expect(toastWarningMock).toHaveBeenCalledWith(
			"Research Agent was created, but working folder setup isn't complete. The working folder is temporarily unavailable. Open the Agent to finish setup."
		);
		expect(toastErrorMock).not.toHaveBeenCalled();
		expect(toastSuccessMock).not.toHaveBeenCalled();
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
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerRef: "builtin:opencode",
						modelId: "opencode/deepseek-v4-flash-free",
						openCodePermission: { bash: "deny", edit: "ask" },
						reasoningLevel: "max",
					}),
				})
			);
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
		expect(setAgentProfileCreationDefaultsMock).not.toHaveBeenCalled();
	});

	it("restores creation choices per Local Agent without leaking them when the Agent changes", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		getAgentProfileCreationDefaultsMock.mockImplementation(
			async ({ agentControllerRef, organizationId }) => ({
				agentControllerCollaborationMode:
					agentControllerRef === "builtin:codex" ? "codex:plan" : null,
				agentControllerPermissionMode:
					agentControllerRef === "builtin:codex" ? "codex:fullAccess" : null,
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
				screen.getByRole("combobox", {
					name: "Codex collaboration mode",
				}).textContent
			).toContain("Plan");
			expect(
				screen.getByRole("combobox", { name: "Codex permissions mode" })
					.textContent
			).toContain("Full access");
			expect(
				screen.getByRole("combobox", { name: "Model" }).textContent
			).toContain("GPT-5.4 Mini");
			expect(
				screen.getByRole("combobox", { name: "Reasoning effort" }).textContent
			).toContain("High");
			expect(
				screen.getByRole("combobox", { name: "Folder source" }).textContent
			).toContain("Let OpenMeld choose");
		});

		expect(
			(
				screen.getByRole("checkbox", {
					name: "I understand this mode may run dangerous actions without asking.",
				}) as HTMLInputElement
			).checked
		).toBe(true);
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Remembered Agent" },
		});
		await waitFor(() =>
			expect(
				(
					screen.getByRole("button", {
						name: CREATE_PROFILE_BUTTON_PATTERN,
					}) as HTMLButtonElement
				).disabled
			).toBe(false)
		);

		fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
		await waitFor(() => {
			expect(
				screen.getByRole("combobox", {
					name: "Claude Code permissions mode",
				}).textContent
			).toContain("Ask permissions");
			expect(
				screen.getByRole("combobox", { name: "Model" }).textContent
			).toContain("Claude Opus 4.8 (default)");
			expect(
				screen.getByRole("combobox", { name: "Folder source" }).textContent
			).toContain("Let OpenMeld choose");
		});
		expect(
			(screen.getByLabelText("Profile name") as HTMLInputElement).value
		).not.toBe("Remembered Agent");
		fireEvent.change(screen.getByLabelText("Profile name"), {
			target: { value: "Claude Writer" },
		});
		fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
		expect(
			(screen.getByLabelText("Profile name") as HTMLInputElement).value
		).toBe("Remembered Agent");
		fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
		expect(
			(screen.getByLabelText("Profile name") as HTMLInputElement).value
		).toBe("Claude Writer");
	});

	it.each([
		"codex:fullAccess",
		"codex:approveForMe",
	] as const)("restores draft consent only when it matches saved %s", async (savedMode) => {
		window.localStorage.setItem(
			"openmeld:agent-profile-creation-journey:organization-123:user-123",
			JSON.stringify({
				version: 1,
				agentId: "codex",
				agentControllerCollaborationMode: null,
				agentControllerPermissionMode: "codex:fullAccess",
				modelId: "",
				openCodePermission: null,
				reasoningLevel: "",
				selectedProjectId: "",
			})
		);
		getAgentProfileCreationDefaultsMock.mockImplementation(
			({ agentControllerRef, organizationId }) => ({
				agentControllerRef,
				organizationId,
				userId: "user-123",
				agentControllerPermissionMode: savedMode,
				agentControllerCollaborationMode: null,
				modelId: null,
				reasoningLevel: null,
				openCodePermission: null,
				defaultProjectId: null,
				updatedAt: "2026-09-07T00:00:00.000Z",
			})
		);
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});
		await waitFor(() =>
			expect(getAgentProfileCreationDefaultsMock).toHaveBeenCalled()
		);
		const primary = (await screen.findByRole("button", {
			name:
				savedMode === "codex:fullAccess"
					? "Create Agent"
					: "Review permissions",
		})) as HTMLButtonElement;
		expect(primary.disabled).toBe(false);
		if (savedMode !== "codex:fullAccess") {
			expect(screen.queryByRole("button", { name: "Create Agent" })).toBeNull();
			fireEvent.click(
				screen.getByRole("button", { name: "Review permissions" })
			);
			fireEvent.click(
				await screen.findByRole("checkbox", {
					name: "I understand this mode may run dangerous actions without asking.",
				})
			);
			fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
			await waitFor(() =>
				expect(
					(
						screen.getByRole("button", {
							name: "Create Agent",
						}) as HTMLButtonElement
					).disabled
				).toBe(false)
			);
		}
	});

	it("keeps restored settings editable and remembers changes without creating an Agent", async () => {
		listProjectsMock.mockResolvedValue({ projects: [buildProjectFixture()] });
		window.localStorage.setItem(
			"openmeld:agent-profile-creation-journey:organization-123:user-123",
			JSON.stringify({
				version: 1,
				agentId: "codex",
				agentControllerCollaborationMode: null,
				agentControllerPermissionMode: "codex:askForApproval",
				modelId: "",
				openCodePermission: null,
				reasoningLevel: "",
				selectedProjectId: "project-1",
			})
		);
		renderCurrentCreateProfileDialog({
			recovery: buildFakeRecovery([
				buildCatalogEntry({
					agentId: "codex",
					launchStatus: "ready",
					selectable: true,
				}),
			]),
		});
		await waitFor(() =>
			expect(getAgentProfileCreationDefaultsMock).toHaveBeenCalled()
		);
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Use OpenMeld managed folder" })
			).toBeNull()
		);
		const submitButton = screen.getByRole("button", {
			name: "Create Agent",
		}) as HTMLButtonElement;
		await waitFor(() => expect(submitButton.disabled).toBe(false));
		fireEvent.click(screen.getByRole("button", { name: "Edit Model" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(
			await screen.findByRole("option", { name: "GPT-5.4 Mini" })
		);
		expect(screen.getByRole("dialog", { name: "Model" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
		await waitFor(() => {
			expect(screen.getByLabelText("Agent name")).toBeTruthy();
			expect(
				screen
					.getByRole("button", { name: CUSTOMIZE_AGENT_BUTTON_PATTERN })
					.getAttribute("aria-expanded")
			).toBe("true");
			expect(
				JSON.parse(
					window.localStorage.getItem(
						"openmeld:agent-profile-creation-journey:organization-123:user-123"
					) ?? "null"
				)
			).toMatchObject({ agentId: "codex", modelId: "gpt-5.4-mini" });
		});
		expect(createAgentProfileCreationRequestMock).not.toHaveBeenCalled();
		fireEvent.click(submitButton);
		await waitFor(() =>
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerRef: "builtin:codex",
						defaultProjectId: null,
						agentControllerPermissionMode: "codex:askForApproval",
						modelId: "gpt-5.4-mini",
					}),
				})
			)
		);
		await waitFor(() => expect(toastSuccessMock).toHaveBeenCalled());
		expect(
			JSON.parse(
				window.localStorage.getItem(
					"openmeld:agent-profile-creation-journey:organization-123:user-123"
				) ?? "null"
			)
		).toMatchObject({ agentId: "codex", modelId: "gpt-5.4-mini" });
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
		fireEvent.click(screen.getByRole("radio", { name: "OpenClaw" }));

		await waitFor(() => {
			expect(
				screen.queryByRole("combobox", {
					name: "Agent Controller permissions mode",
				})
			).toBeNull();
		});

		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", {
						name: CREATE_PROFILE_BUTTON_PATTERN,
					}) as HTMLButtonElement
				).disabled
			).toBe(false);
		});
		fireEvent.click(
			screen.getByRole("button", { name: CREATE_PROFILE_BUTTON_PATTERN })
		);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerPermissionMode: null,
						agentControllerRef: "builtin:openclaw",
					}),
				})
			);
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
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
		fireEvent.click(
			screen.getByRole("option", {
				name: "Approve for me",
			})
		);
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
		fireEvent.click(
			screen.getByRole("option", {
				name: "Full access",
			})
		);

		const submitButton = screen.getByRole("button", {
			name: CREATE_PROFILE_BUTTON_PATTERN,
		}) as HTMLButtonElement;
		expect(submitButton.disabled).toBe(true);
		fireEvent.submit(screen.getByTestId("create-profile-panel"));
		expect(createAgentProfileCreationRequestMock).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByLabelText(
				"I understand this mode may run dangerous actions without asking."
			)
		);
		await waitFor(() => {
			expect(submitButton.disabled).toBe(false);
		});
		fireEvent.click(submitButton);

		await waitFor(() => {
			expect(createAgentProfileCreationRequestMock).toHaveBeenCalledWith(
				expect.objectContaining({
					configuration: expect.objectContaining({
						agentControllerPermissionMode: "codex:fullAccess",
						agentControllerRef: "builtin:codex",
					}),
				})
			);
		});
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
	});
});
