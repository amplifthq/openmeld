import { getAgentProfilePrimaryBindingResponseSchema } from "@openmeld/schemas/schemas";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	GetAgentProfilePrimaryBindingResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { projectQueryKeys } from "#/query/organizations/projects";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { resolveAgentProfileEditState } from "./agent-profile-edit-state";
import {
	AgentProfileEditDialog,
	AgentProfileInlineEditor,
	AgentProfilesCard,
} from "./agents-page-agent-profiles-card";

const AGENT_PROFILE_ID = "agt-codex";
const CREATE_AN_AGENT_PROFILE_NAME = /Create an Agent/;
const PERMISSIONS_MODE_NAME_PATTERN = /permissions mode/i;
const REPAIR_OR_RECONNECT_ACTION_NAME_PATTERN = /repair|reconnect/i;
const TIME_WITH_MINUTES_PATTERN = /:\d{2}/u;
const WAKE_ACCESS_LABEL_PATTERN = /Wake access:/i;
const WAKEABILITY_LINK_ACTION_PATTERN =
	/Connect computer|Reconnect computer|Update/u;
const ORGANIZATION_WAKE_ACCESS_SWITCH_PATTERN = /organization.*Wake access/i;

const ensureRuntimeBindingMock = vi.hoisted(() => vi.fn());
const disablePrimaryBindingMock = vi.hoisted(() => vi.fn());
const readPrimaryBindingMock = vi.hoisted(() => vi.fn());
const readControllerChangeEligibilityMock = vi.hoisted(() => vi.fn());
const refreshReadinessFactsMock = vi.hoisted(() => vi.fn());
const refreshReadinessSharedCachesMock = vi.hoisted(() => vi.fn());
const renameOpenMeldProfileMock = vi.hoisted(() => vi.fn());
const deleteStartAgentProfileMock = vi.hoisted(() => vi.fn());
const updatePrimaryBindingAgentControllerPermissionModeMock = vi.hoisted(() =>
	vi.fn()
);
const updatePrimaryBindingAgentControllerCollaborationModeMock = vi.hoisted(
	() => vi.fn()
);
const updatePrimaryBindingModelSelectionMock = vi.hoisted(() => vi.fn());
const updatePrimaryBindingOpenCodePermissionMock = vi.hoisted(() => vi.fn());
const openCurrentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const executeAgentProfileWorkRecoveryMock = vi.hoisted(() => vi.fn());
const readCurrentAgentActivitySessionsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() =>
	Object.assign(vi.fn(), {
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	})
);

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock("#/lib/organizations/agent-activity", () => ({
	readCurrentAgentActivitySessions: (
		...args: Parameters<typeof readCurrentAgentActivitySessionsMock>
	) => readCurrentAgentActivitySessionsMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		"aria-label": ariaLabel,
		children,
		to,
	}: {
		"aria-label"?: string;
		children: ReactNode;
		to: string;
	}) => (
		<a aria-label={ariaLabel} href={to}>
			{children}
		</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock(
	"#/lib/profiles/agent-profile-primary-binding",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/profiles/agent-profile-primary-binding")
		>()),
		readAgentProfileControllerChangeEligibility: (
			...args: Parameters<typeof readControllerChangeEligibilityMock>
		) => readControllerChangeEligibilityMock(...args),
		disableAgentProfilePrimaryBinding: (
			...args: Parameters<typeof disablePrimaryBindingMock>
		) => disablePrimaryBindingMock(...args),
		readAgentProfilePrimaryBinding: (
			...args: Parameters<typeof readPrimaryBindingMock>
		) => readPrimaryBindingMock(...args),
		updateAgentProfilePrimaryBindingAgentControllerPermissionMode: (
			...args: Parameters<
				typeof updatePrimaryBindingAgentControllerPermissionModeMock
			>
		) => updatePrimaryBindingAgentControllerPermissionModeMock(...args),
		updateAgentProfilePrimaryBindingAgentControllerCollaborationMode: (
			...args: Parameters<
				typeof updatePrimaryBindingAgentControllerCollaborationModeMock
			>
		) => updatePrimaryBindingAgentControllerCollaborationModeMock(...args),
		updateAgentProfilePrimaryBindingModelSelection: (
			...args: Parameters<typeof updatePrimaryBindingModelSelectionMock>
		) => updatePrimaryBindingModelSelectionMock(...args),
		updateAgentProfilePrimaryBindingOpenCodePermission: (
			...args: Parameters<typeof updatePrimaryBindingOpenCodePermissionMock>
		) => updatePrimaryBindingOpenCodePermissionMock(...args),
	})
);

vi.mock("#/lib/profiles/agent-profile-runtime-binding", () => ({
	ensureWebAgentProfileRuntimeBinding: (
		...args: Parameters<typeof ensureRuntimeBindingMock>
	) => ensureRuntimeBindingMock(...args),
	formatWebAgentProfileRuntimeBindingFailure: () =>
		"OpenMeld could not save the local agent connection.",
}));

vi.mock("#/lib/profiles/rename-profile", () => ({
	renameOpenMeldProfile: (
		...args: Parameters<typeof renameOpenMeldProfileMock>
	) => renameOpenMeldProfileMock(...args),
}));

vi.mock("#/lib/profiles/delete-agent-profile", () => ({
	deleteStartAgentProfile: (
		...args: Parameters<typeof deleteStartAgentProfileMock>
	) => deleteStartAgentProfileMock(...args),
}));

// No remembered MemberAgent chat: Chat opens the Profile's Direct Message.
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({ defaultHumanProfile: null }),
}));

vi.mock("#/lib/profiles/agent-profile-work-recovery", () => ({
	executeAgentProfileWorkRecovery: (
		...args: Parameters<typeof executeAgentProfileWorkRecoveryMock>
	) => executeAgentProfileWorkRecoveryMock(...args),
}));

vi.mock("#/lib/spaces/direct-message", () => ({
	openCurrentDirectMessageSpace: (
		...args: Parameters<typeof openCurrentDirectMessageSpaceMock>
	) => openCurrentDirectMessageSpaceMock(...args),
	resolveDirectMessageOpenErrorMessage: () =>
		"OpenMeld could not open this Direct Message.",
}));

vi.mock("#/query/agents/execution-readiness", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/query/agents/execution-readiness")
	>()),
	refreshWebAgentReadinessFacts: (
		...args: Parameters<typeof refreshReadinessFactsMock>
	) => refreshReadinessFactsMock(...args),
	refreshWebAgentReadinessSharedCaches: (
		...args: Parameters<typeof refreshReadinessSharedCachesMock>
	) => refreshReadinessSharedCachesMock(...args),
}));

vi.mock("#/query/config/model-catalog", () => ({
	modelCatalogQueryOptions: () => ({
		queryKey: ["config", "model-catalog"],
		queryFn: async () => ({
			schemaVersion: 1,
			updatedAt: "2026-06-18T00:00:00.000Z",
			agentControllers: {
				"claude-code": {
					defaultModelId: "claude-sonnet-4-5",
					models: [
						{
							id: "claude-sonnet-4-5",
							displayName: "Claude Sonnet 4.5",
							unavailable: false,
							supportedReasoningLevels: ["low", "high"],
							minCliVersion: null,
						},
					],
				},
				codex: {
					defaultModelId: "gpt-5.5",
					models: [
						{
							id: "gpt-5.5",
							displayName: "GPT-5.5",
							unavailable: false,
							supportedReasoningLevels: ["low", "medium", "high"],
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
						{
							id: "opencode/fast-reset",
							displayName: "OpenCode Fast Reset",
							unavailable: false,
							supportedReasoningLevels: ["low"],
							minCliVersion: null,
						},
						{
							id: "opencode/retired",
							displayName: "OpenCode Retired",
							unavailable: true,
							supportedReasoningLevels: ["high"],
							minCliVersion: null,
						},
					],
				},
			},
		}),
		staleTime: Number.POSITIVE_INFINITY,
	}),
}));

type AgentProfilesCardProps = ComponentProps<typeof AgentProfilesCard>;
type RecoveryController = AgentProfilesCardProps["recovery"];

describe("AgentProfilesCard Agent Controller Permission Mode", () => {
	beforeEach(() => {
		executeAgentProfileWorkRecoveryMock.mockReset().mockResolvedValue({
			action: "continue_interrupted_work",
			status: "accepted",
		});
		ensureRuntimeBindingMock
			.mockReset()
			.mockResolvedValue({ status: "accepted" });
		disablePrimaryBindingMock.mockReset().mockResolvedValue({
			agentProfileId: AGENT_PROFILE_ID,
			disabled: true,
			reasonCodes: ["agent_profile_binding.primary_binding_disabled"],
			status: "disabled",
		});
		readPrimaryBindingMock
			.mockReset()
			.mockImplementation(async () =>
				createPrimaryBindingResponse("codex:approveForMe")
			);
		readControllerChangeEligibilityMock
			.mockReset()
			.mockImplementation(async ({ agentProfileId }) => ({
				agentProfileId,
				reasonCode: "agent_profile_binding.controller_change_allowed" as const,
				status: "allowed" as const,
			}));
		refreshReadinessFactsMock.mockReset().mockResolvedValue(undefined);
		refreshReadinessSharedCachesMock.mockReset().mockResolvedValue(undefined);
		renameOpenMeldProfileMock.mockReset().mockImplementation(async (input) =>
			createAgentProfile({
				profileName: input.profileName,
				updatedAt: "2026-06-18T00:01:00.000Z",
			})
		);
		deleteStartAgentProfileMock
			.mockReset()
			.mockResolvedValue(createAgentProfile());
		updatePrimaryBindingAgentControllerPermissionModeMock
			.mockReset()
			.mockImplementation(async (input) =>
				createEnsureBindingResponse(input.agentControllerPermissionMode)
			);
		updatePrimaryBindingAgentControllerCollaborationModeMock
			.mockReset()
			.mockImplementation(async (input) =>
				createEnsureBindingResponse(
					"codex:approveForMe",
					"builtin:codex",
					null,
					input.agentControllerCollaborationMode
				)
			);
		updatePrimaryBindingModelSelectionMock
			.mockReset()
			.mockImplementation(async (input) =>
				createEnsureBindingResponse(null, "builtin:opencode", {
					modelId: input.modelId,
					reasoningLevel: input.reasoningLevel,
				})
			);
		updatePrimaryBindingOpenCodePermissionMock
			.mockReset()
			.mockImplementation(async (input) =>
				createEnsureBindingResponse(
					null,
					"builtin:opencode",
					null,
					null,
					input.openCodePermission
				)
			);
		openCurrentDirectMessageSpaceMock.mockReset().mockResolvedValue({
			memberProfileId: "profile-felix",
			spaceId: "space-research-agent-dm",
			targetProfileId: AGENT_PROFILE_ID,
		});
		readCurrentAgentActivitySessionsMock.mockReset().mockResolvedValue({
			asOfMs: 1_787_220_000_000,
			coverage: [],
			nextCursor: null,
			organization: { id: "org-acme", name: "Acme" },
			sessions: [],
		});
		navigateMock.mockReset();
		toastMock.mockReset();
		toastMock.error.mockReset();
		toastMock.info.mockReset();
		toastMock.success.mockReset();
		toastMock.warning.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("shows Agent Controller Permission Mode on the card without repeating it in More details", async () => {
		renderAgentProfilesCard();

		await waitFor(() => {
			expect(
				screen.getByTestId("agent-controller-permission-mode-inline-display")
					.textContent
			).toBe("Codex permissions mode: Approve for me");
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "More details" }));

		const dialog = screen.getByRole("dialog", { name: "More details" });
		expect(
			within(dialog).queryByText("Agent Controller Permission Mode")
		).toBeNull();
		expect(within(dialog).queryByText("Permissions mode")).toBeNull();
	});

	it("renders one selected Agent as an inline detail workspace", async () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "detail" }
		);

		expect(
			await screen.findByTestId("agent-profile-workspace-detail")
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Research Agent" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Chat with Research Agent" })
				.textContent
		).toContain("Chat with Research Agent");
		expect(screen.getByRole("button", { name: "Edit Name" })).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Agent options for Research Agent" })
		);
		expect(screen.getByRole("menuitem", { name: "More details" })).toBeTruthy();
		expect(
			screen.getByTestId(`agent-profile-controller-avatar-${AGENT_PROFILE_ID}`)
		).toBeTruthy();
		expect(
			screen
				.getByTestId("agent-profile-workspace-detail")
				.querySelector('[data-profile-kind="center-agent"]')
		).toBeNull();
	});

	it("edits a detail workspace in place without a separate Edit Agent dialog", async () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "detail" }
		);
		await screen.findByTestId("agent-profile-workspace-detail");
		expect(screen.getByRole("button", { name: "Edit Name" })).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Agent options for Research Agent" })
		);
		expect(screen.queryByRole("menuitem", { name: "Edit Agent" })).toBeNull();
		// The Working folder card is the one entry to folders here.
		expect(
			screen.queryByRole("menuitem", { name: "Working folder" })
		).toBeNull();
	});

	it("shows current activity before configuration and keeps the details dialog concise", () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileActivityNavigationByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							current: {
								href: "/o/acme/spaces/space-launch",
								source: "space",
								title: "Launch planning",
							},
							queued: [
								{
									href: "/o/acme/chats/dm-customer",
									source: "direct_message",
									title: "Customer follow-up",
								},
								{
									href: "/o/acme/spaces/space-bug-triage",
									source: "space",
									title: "Bug triage",
								},
								{
									href: "/o/acme/computers/computer-sales",
									source: "computer",
									title: "Sales follow-up",
								},
								{
									href: "/o/acme/spaces/space-release",
									source: "space",
									title: "Release review",
								},
								{
									href: "/o/acme/chats/dm-design",
									source: "direct_message",
									title: "Design feedback",
								},
								{
									href: "/o/acme/computers/computer-research",
									source: "computer",
									title: "Research notes",
								},
								{
									href: "/o/acme/spaces/space-retro",
									source: "space",
									title: "Team retrospective",
								},
							],
						},
					],
				]),
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Launch planning",
							queuedWorkLocations: ["Customer follow-up"],
							recoveryAction: null,
							status: "working",
							waitingCount: 7,
						},
					],
				]),
				presentation: "detail",
			}
		);

		expect(screen.queryByText("Operational context")).toBeNull();
		expect(screen.queryByText("Technical details")).toBeNull();
		expect(screen.queryByText("Profile type")).toBeNull();
		const presence = screen.getByTestId("agent-profile-presence");
		expect(within(presence).getByText("Unavailable")).toBeTruthy();
		expect(within(presence).queryByText("Working")).toBeNull();
		expect(presence.getAttribute("data-agent-presence-status")).toBe(
			"unavailable"
		);
		expect(screen.getByText("Launch planning")).toBeTruthy();
		expect(screen.queryByText("7 queued")).toBeNull();
		expect(screen.queryByText("Next: Customer follow-up")).toBeNull();
		const spaceLinks = screen.getAllByRole("link", {
			name: "Open Space: Launch planning",
		});
		expect(spaceLinks).toHaveLength(1);
		expect(
			spaceLinks.every(
				(link) => link.getAttribute("href") === "/o/acme/spaces/space-launch"
			)
		).toBe(true);
		const directMessageLink = screen.getByRole("link", {
			name: "Open Direct Message: Customer follow-up",
		});
		expect(directMessageLink.getAttribute("href")).toBe(
			"/o/acme/chats/dm-customer"
		);
		const currentActivityHeading = screen.getByRole("heading", {
			name: "Current activity",
		});
		const currentActivity = currentActivityHeading.closest("section");
		const activityList = within(currentActivity as HTMLElement).getByRole(
			"list",
			{ name: "Current activity" }
		);
		expect(activityList.className).toContain("grid-cols-1");
		expect(activityList.className).toContain(
			"@[36rem]/agent-detail:grid-cols-2"
		);
		expect(activityList.className).toContain(
			"@[54rem]/agent-detail:grid-cols-3"
		);
		expect(
			within(currentActivity as HTMLElement).getAllByRole("listitem")
		).toHaveLength(8);
		expect(
			within(currentActivity as HTMLElement).queryByRole("list", {
				name: "Working in",
			})
		).toBeNull();
		expect(
			within(currentActivity as HTMLElement).queryByRole("list", {
				name: "Up next",
			})
		).toBeNull();
		const workingBadge = within(currentActivity as HTMLElement).getByText(
			"Active task",
			{ exact: true }
		);
		expect(workingBadge.closest('[data-slot="badge"]')).toBeTruthy();
		expect(workingBadge.closest('[data-slot="badge"]')?.className).toContain(
			"text-primary"
		);
		const upNextBadges = within(currentActivity as HTMLElement).getAllByText(
			"Up next",
			{ exact: true }
		);
		expect(upNextBadges).toHaveLength(7);
		expect(
			upNextBadges.every((badge) => badge.closest('[data-slot="badge"]'))
		).toBe(true);
		expect(
			upNextBadges.every((badge) =>
				badge
					.closest('[data-slot="badge"]')
					?.className.includes("text-muted-foreground")
			)
		).toBe(true);
		expect(
			within(currentActivity as HTMLElement).queryByText("Working", {
				exact: true,
				selector: ":not([data-slot='badge'])",
			})
		).toBeNull();
		const destinationItems = within(
			currentActivity as HTMLElement
		).getAllByRole("listitem");
		fireEvent.pointerEnter(destinationItems[0] as HTMLElement);
		expect(
			(currentActivity as HTMLElement).querySelector(
				'[data-slot="shared-layout-background"]'
			)
		).toBeTruthy();
		const configurationHeading = screen.getByRole("heading", {
			name: "How this Agent works",
		});
		expect(
			currentActivityHeading
				.closest("section")
				?.nextElementSibling?.contains(configurationHeading)
		).toBe(true);

		fireEvent.click(
			screen.getByRole("button", { name: "Agent options for Research Agent" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "More details" }));

		expect(screen.getByRole("heading", { name: "More details" })).toBeTruthy();
		const dialog = screen.getByRole("dialog", { name: "More details" });
		expect(within(dialog).getByText("Profile details")).toBeTruthy();
		const profileIdLabel = within(dialog).getByText("Profile ID");
		const createdFromLabel = within(dialog).getByText("Created from");
		expect(
			profileIdLabel
				.closest("button")
				?.nextElementSibling?.contains(createdFromLabel)
		).toBe(true);
		expect(within(dialog).queryByText("Profile history")).toBeNull();
		expect(within(dialog).queryByText("Status")).toBeNull();
		expect(within(dialog).queryByText("Activity")).toBeNull();
		expect(within(dialog).queryByText("Diagnostics")).toBeNull();
		expect(within(dialog).queryByText("Binding state")).toBeNull();
		expect(within(dialog).queryByText("Binding source")).toBeNull();
		expect(within(dialog).queryByText("Handle")).toBeNull();
		expect(within(dialog).queryByText("Owner")).toBeNull();
		expect(within(dialog).queryByText("Model")).toBeNull();
		expect(within(dialog).queryByText("Permissions mode")).toBeNull();
		expect(screen.getByText("Created").nextElementSibling?.textContent).toMatch(
			TIME_WITH_MINUTES_PATTERN
		);
	});

	it("keeps Activity checking out of the Wakeability header", () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: null,
							queuedWorkLocations: [],
							recoveryAction: null,
							status: "checking",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(within(presence).getByText("Unavailable")).toBeTruthy();
		expect(within(presence).queryByText("Checking activity")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Current activity" })
		).toBeNull();
		expect(screen.queryByTestId("agent-current-activity")).toBeNull();
	});

	it("hides Current activity when the Agent has no current work", () => {
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						createWakeAvailabilityReadiness("available_for_wake"),
					],
				]),
			},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: null,
							queuedWorkLocations: [],
							recoveryAction: null,
							status: "idle",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		expect(
			screen.queryByRole("heading", { name: "Current activity" })
		).toBeNull();
		expect(screen.queryByText("No current work")).toBeNull();
		expect(screen.queryByText("Not working right now")).toBeNull();
		const presence = screen.getByTestId("agent-profile-presence");
		expect(within(presence).getByText("Available")).toBeTruthy();
		expect(presence.getAttribute("data-agent-presence-status")).toBe(
			"available"
		);
		expect(
			screen.getByRole("heading", { name: "How this Agent works" })
		).toBeTruthy();
		expect(screen.queryByText("Runs on")).toBeNull();
		expect(
			screen.queryByText("The local tool and computer that run this Agent.")
		).toBeNull();
	});

	it("loads editable settings while a cold Wakeability check remains pending", async () => {
		readPrimaryBindingMock.mockResolvedValue(
			createPrimaryBindingResponse("codex:askForApproval")
		);
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map(),
				agentExecutionReadinessPendingProfileIds: new Set([AGENT_PROFILE_ID]),
			},
			null,
			{ presentation: "detail" }
		);

		const presence = screen.getByRole("status", {
			name: "Loading Agent availability",
		});
		const editPermissions = await screen.findByRole("button", {
			name: "Edit Permissions",
		});
		expect(
			screen.getByRole("status", { name: "Loading Agent availability" })
		).toBe(presence);
		expect(presence.querySelector('[data-slot="skeleton"]')).toBeTruthy();
		expect(within(presence).queryByText("Available")).toBeNull();
		expect(
			within(presence).queryByRole("link", {
				name: WAKEABILITY_LINK_ACTION_PATTERN,
			})
		).toBeNull();
		expect(
			within(presence).queryByRole("button", {
				name: "Connect local agent",
			})
		).toBeNull();
		fireEvent.click(editPermissions);
		expect(
			screen.getByRole("combobox", { name: PERMISSIONS_MODE_NAME_PATTERN })
		).toBeTruthy();
	});

	it("keeps cached Available Wakeability while Activity is Working and refreshes", () => {
		const readiness = {
			...createWakeAvailabilityReadiness("available_for_wake"),
			generatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
		};
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
			},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentExecutionReadinessIsRefreshing: true,
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: null,
							queuedWorkLocations: [],
							recoveryAction: null,
							status: "working",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(presence.textContent).toContain("Available");
		expect(presence.textContent).toContain("checked 3 minutes ago");
		expect(presence.textContent).toContain("Refreshing…");
		expect(presence.textContent).not.toContain("Working");
		const currentActivity = screen
			.getByRole("heading", { name: "Current activity" })
			.closest("section");
		expect(currentActivity?.textContent).toContain("Active task");
	});

	it("keeps cached Unavailable Wakeability while Activity is Working and refreshes", () => {
		const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
		const readiness = {
			...createReadinessResponseWithPrimaryBinding(binding),
			generatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
		} as unknown as GetAgentExecutionReadinessResponse;
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
			},
			binding,
			{
				agentExecutionReadinessIsRefreshing: true,
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: null,
							queuedWorkLocations: [],
							recoveryAction: null,
							status: "working",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(presence.textContent).toContain("Unavailable");
		expect(presence.textContent).toContain("checked 3 minutes ago");
		expect(presence.textContent).toContain("Refreshing…");
		expect(presence.textContent).not.toContain("Working");
		const currentActivity = screen
			.getByRole("heading", { name: "Current activity" })
			.closest("section");
		expect(currentActivity?.textContent).toContain("Active task");
	});

	it("keeps one local-agent connection action beside the unbound Wakeability blocker", async () => {
		const readiness = createUnboundAgentReadiness();
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
				selectedExecutionTarget: createSelectedExecutionTarget(),
			},
			null,
			{ presentation: "detail" }
		);

		const modelLabel = await screen.findByText("Model", { exact: true });
		const modelCard = modelLabel.closest("[data-fluid-card-item]");
		expect(modelCard).toBeTruthy();
		expect(
			within(modelCard as HTMLElement).queryByText("Connect to a local agent")
		).toBeNull();
		expect(
			within(modelCard as HTMLElement).queryByRole("combobox", {
				name: "Choose local agent",
			})
		).toBeNull();
		const presence = screen.getByTestId("agent-profile-presence");
		expect(
			within(presence).getByRole("button", {
				name: "Connect local agent",
			})
		).toBeTruthy();
		expect(
			screen.getAllByRole("combobox", { name: "Choose local agent" })
		).toHaveLength(1);
	});

	it("does not offer a local-agent connection while availability is loading", async () => {
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map(),
				agentExecutionReadinessPendingProfileIds: new Set([AGENT_PROFILE_ID]),
				selectedExecutionTarget: createSelectedExecutionTarget(),
			},
			null,
			{ presentation: "detail" }
		);

		const modelLabel = await screen.findByText("Model", { exact: true });
		const modelCard = modelLabel.closest("[data-fluid-card-item]");
		expect(modelCard).toBeTruthy();
		expect(
			within(modelCard as HTMLElement).queryByText("Connect to a local agent")
		).toBeNull();
		expect(
			within(modelCard as HTMLElement).queryByRole("combobox", {
				name: "Choose local agent",
			})
		).toBeNull();
		expect(
			within(modelCard as HTMLElement).queryByRole("button", {
				name: "Connect local agent",
			})
		).toBeNull();
	});

	it("shows the owner which computer and controller conversation run the Agent", () => {
		const baseBinding =
			createPrimaryBindingResponse("codex:approveForMe").binding;
		const primaryBinding = {
			...baseBinding,
			executionTarget: {
				...baseBinding.executionTarget,
				agentControllerConversationId: "conversation-123",
			},
		};
		const readiness = {
			...createReadinessResponseWithPrimaryBinding(primaryBinding),
			primaryBinding,
			routeDeviceId: "device-1",
			runtimeDeviceDisplayName: "Felix’s MacBook Pro",
		} as unknown as GetAgentExecutionReadinessResponse;

		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
			},
			primaryBinding,
			{ presentation: "detail" }
		);

		expect(screen.getByText("Runs on")).toBeTruthy();
		expect(screen.getByText("Felix’s MacBook Pro")).toBeTruthy();
		// The conversation ID is a tooltip, not body text.
		expect(screen.queryByText("Conversation ID: conversation-123")).toBeNull();
		expect(screen.getByText("Owned by")).toBeTruthy();
		const overview = screen.getByTestId("agent-configuration-overview");
		expect(within(overview).queryByText("Owner", { exact: true })).toBeNull();
		const cards = Array.from(
			overview.querySelectorAll("[data-fluid-card-item]")
		);
		const usageCard = within(overview)
			.getByRole("region", { name: "Usage limits" })
			.closest("[data-fluid-card-item]");
		const cardOrder = [
			"Model",
			"Working folder",
			"Usage limits",
			"Permissions",
			"Collaboration mode",
			"Runs on",
		].map((label) => {
			const card =
				label === "Usage limits"
					? usageCard
					: within(overview)
							.getByText(label, { exact: true })
							.closest("[data-fluid-card-item]");
			if (!card) {
				throw new Error(`Expected ${label} inside a configuration card.`);
			}
			return cards.indexOf(card);
		});
		expect(cardOrder).toEqual([0, 1, 2, 3, 4, 5]);
		expect(
			within(overview).getByRole("region", { name: "Usage limits" })
		).toBeTruthy();
		expect(
			screen.getAllByRole("region", { name: "Usage limits" })
		).toHaveLength(1);
	});

	it("shows the selected Project instead of assuming an OpenMeld-managed folder", async () => {
		const profile = {
			...createAgentProfile(),
			defaultProjectId: "project-1",
		};
		const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
		const overrides = { agentProfiles: [profile] };
		const view = renderAgentProfilesCard(overrides, binding, {
			presentation: "detail",
		});
		view.queryClient.setQueryData(projectQueryKeys.organization("org-acme"), {
			organizationId: "org-acme",
			projects: [{ id: "project-1", name: "OpenMeld" }],
		});
		view.rerenderAgentProfilesCard(overrides, binding);
		expect(await screen.findByText("Project: OpenMeld")).toBeTruthy();
		expect(screen.queryByText("OpenMeld managed")).toBeNull();
	});

	it("shows a missing working folder with one direct recovery action", () => {
		const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
		const baseReadiness = createReadinessResponseWithPrimaryBinding(binding);
		const readiness = {
			...baseReadiness,
			agentExecutionReadiness: {
				...baseReadiness.agentExecutionReadiness,
				facts: {
					...baseReadiness.agentExecutionReadiness.facts,
					runtime: {
						ready: false,
						reasonCodes: ["profile.workspace.missing", "profile.unbound"],
						source: "prepare_readiness",
					},
				},
				primaryAction: "run_prepare",
				reasonCodes: ["profile.workspace.missing", "profile.unbound"],
			},
			agentWakeAvailability: {
				...baseReadiness.agentWakeAvailability,
				action: "run_prepare",
				badgeLabel: "Working folder missing",
				label: "Working folder missing",
				phase: "unavailable",
				reasonCode: "profile.workspace.missing",
				summary: "Choose a working folder for this Agent.",
				tooltip: "Working folder missing",
			},
			primaryActionPlan: {
				action: "run_prepare",
				target: { kind: "current_computer" },
			},
		} as unknown as GetAgentExecutionReadinessResponse;

		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
			},
			binding,
			{ presentation: "detail" }
		);

		const overview = screen.getByTestId("agent-configuration-overview");
		expect(within(overview).getByText("Needs attention")).toBeTruthy();
		expect(
			within(overview).getByRole("button", { name: "Review working folder" })
		).toBeTruthy();
		expect(within(overview).getByText("Review working folder")).toBeTruthy();
		expect(within(overview).queryByText("OpenMeld managed")).toBeNull();
	});

	it("keeps a checking Wake projection as checking in Profile Details", () => {
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						createWakeAvailabilityReadiness("checking_connection"),
					],
				]),
			},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "detail" }
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(
			within(presence).getByText("Checking Wake availability")
		).toBeTruthy();
		expect(presence.getAttribute("data-agent-presence-status")).toBe(
			"checking"
		);
		expect(within(presence).queryByText("Unavailable for Wake")).toBeNull();
	});

	it("keeps current work out of the metadata dialog", () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Launch planning",
							queuedWorkLocations: ["Customer follow-up"],
							recoveryAction: null,
							status: "working",
							waitingCount: 1,
						},
					],
				]),
			}
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "More details" }));

		const dialog = screen.getByRole("dialog", { name: "More details" });
		expect(within(dialog).queryByText("Activity")).toBeNull();
		expect(within(dialog).queryByText("Launch planning")).toBeNull();
		expect(within(dialog).queryByText("Customer follow-up")).toBeNull();
	});

	it("renders owner recovery actions beside current activity", () => {
		const onRecoveryAction = vi.fn();
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileActivityNavigationByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							current: {
								href: "/o/acme/spaces/space-launch",
								source: "space",
								title: "Launch planning",
							},
							queued: [
								{
									href: "/o/acme/computers/computer-release",
									source: "computer",
									title: "Post-release checks",
								},
							],
						},
					],
				]),
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Launch planning",
							queuedWorkLocations: [],
							recoveryAction: {
								kind: "continue_interrupted_work",
							},
							status: "paused",
							waitingCount: 0,
						},
					],
				]),
				onRecoveryAction,
				presentation: "detail",
			}
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(presence.getAttribute("data-agent-presence-status")).toBe(
			"unavailable"
		);
		expect(within(presence).getByText("Unavailable")).toBeTruthy();
		const twoItemActivityList = screen.getByRole("list", {
			name: "Current activity",
		});
		expect(within(twoItemActivityList).getByText("Current")).toBeTruthy();
		expect(
			within(twoItemActivityList)
				.getByRole("link", { name: "Open Space: Launch planning" })
				.getAttribute("href")
		).toBe("/o/acme/spaces/space-launch");
		expect(twoItemActivityList.className).toContain(
			"@[36rem]/agent-detail:grid-cols-2"
		);
		expect(twoItemActivityList.className).not.toContain(
			"@[54rem]/agent-detail:grid-cols-3"
		);
		expect(onRecoveryAction).not.toHaveBeenCalled();
	});

	it("keeps waiting work in Current activity without replacing Wakeability", () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileActivityNavigationByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							current: {
								href: "/o/acme/computers/computer-felix",
								source: "computer",
								title: "Research",
							},
							queued: [],
						},
					],
				]),
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Research",
							queuedWorkLocations: [],
							recoveryAction: null,
							status: "paused",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(presence.getAttribute("data-agent-presence-status")).toBe(
			"unavailable"
		);
		expect(within(presence).queryByText("Waiting to continue")).toBeNull();
		const oneItemActivityList = screen.getByRole("list", {
			name: "Current activity",
		});
		expect(
			within(oneItemActivityList)
				.getByRole("link", { name: "Open Computer: Research" })
				.getAttribute("href")
		).toBe("/o/acme/computers/computer-felix");
		expect(oneItemActivityList.className).toContain("grid-cols-1");
		expect(oneItemActivityList.className).not.toContain(
			"@[36rem]/agent-detail:grid-cols-2"
		);
		const currentBadge = screen.getByText("Current", { exact: true });
		expect(currentBadge.closest('[data-slot="badge"]')?.className).toContain(
			"text-primary"
		);
		expect(screen.queryByText("Current work", { exact: true })).toBeNull();
	});

	it("renders owner recovery actions in the selected Agent detail", async () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: null,
							queuedWorkLocations: [],
							recoveryAction: {
								kind: "approve_queued_work",
							},
							status: "paused",
							waitingCount: 1,
						},
					],
				]),
				onRecoveryAction: vi.fn(),
				presentation: "detail",
			}
		);

		expect(
			await screen.findByRole("button", { name: "Start queued work" })
		).toBeTruthy();
	});

	it("executes the owner recovery action and keeps the button pending until Core accepts it", async () => {
		let resolveRecovery: (value: unknown) => void = () => undefined;
		const recoveryPromise = new Promise((resolve) => {
			resolveRecovery = resolve;
		});
		executeAgentProfileWorkRecoveryMock.mockReturnValue(recoveryPromise);
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Launch planning",
							queuedWorkLocations: [],
							recoveryAction: { kind: "continue_interrupted_work" },
							recoveryTargetWakeLifecycleId: "twl_interrupted",
							status: "paused",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Continue interrupted work" })
		);

		expect(executeAgentProfileWorkRecoveryMock).toHaveBeenCalledWith({
			action: "continue_interrupted_work",
			expectedInterruptedTargetWakeLifecycleId: "twl_interrupted",
			agentProfileId: AGENT_PROFILE_ID,
			organizationId: "org-acme",
		});
		const pendingButton = await screen.findByRole("button", {
			name: "Continuing interrupted work…",
		});
		expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

		resolveRecovery({
			action: "continue_interrupted_work",
			status: "accepted",
		});
		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Continuing Research Agent's interrupted work."
			);
		});
	});

	it.each([
		{
			upstreamCode: "agent_profile_work_recovery.awaiting_original_stop",
			message:
				"OpenMeld kept your choice for Research Agent and is checking whether the original request stopped on your computer. Nothing new has started yet.",
			refresh: false,
		},
		{
			upstreamCode: "agent_profile_work_recovery.not_pending",
			message:
				"This Agent’s paused work has changed. Review its current work before trying again.",
			refresh: true,
		},
	])("handles the Gateway recovery response $upstreamCode without replaying it", async ({
		upstreamCode,
		message,
		refresh,
	}) => {
		// Gateway puts Core's reason in upstreamCode, as captured in localhost smoke.
		executeAgentProfileWorkRecoveryMock.mockRejectedValueOnce({
			code: "upstream_error",
			upstreamCode,
			status: 409,
			requestId: "smoke-recovery",
			message: "This recovery action is no longer needed.",
		});
		const { queryClient } = renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Launch planning",
							queuedWorkLocations: [],
							recoveryAction: { kind: "continue_interrupted_work" },
							recoveryTargetWakeLifecycleId: "twl_interrupted",
							status: "paused",
							waitingCount: 0,
						},
					],
				]),
				presentation: "detail",
			}
		);

		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
		fireEvent.click(
			await screen.findByRole("button", { name: "Continue interrupted work" })
		);

		await waitFor(() => {
			expect(toastMock.info).toHaveBeenCalledWith(message);
		});
		expect(toastMock.error).not.toHaveBeenCalled();
		expect(executeAgentProfileWorkRecoveryMock).toHaveBeenCalledTimes(1);
		if (refresh) {
			expect(invalidateQueriesSpy).toHaveBeenCalledWith({
				queryKey: organizationQueryKeys.agentRuntimeOverview("org-acme"),
			});
		} else {
			expect(invalidateQueriesSpy).not.toHaveBeenCalled();
		}
	});

	it("lets the owner skip interrupted work before queued work can continue", async () => {
		executeAgentProfileWorkRecoveryMock.mockResolvedValueOnce({
			action: "skip_interrupted_work",
			status: "accepted",
		});
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileActivityNavigationByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							current: {
								href: "/o/acme/spaces/release-room",
								source: "space",
								title: "Release room",
							},
							queued: [],
						},
					],
				]),
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: "Release room",
							queuedWorkLocations: ["Customer follow-up"],
							recoveryAction: { kind: "skip_interrupted_work" },
							recoveryTargetWakeLifecycleId: "twl_interrupted",
							status: "paused",
							waitingCount: 1,
						},
					],
				]),
				presentation: "detail",
			}
		);

		const interruptedWork = await screen.findByTestId(
			"agent-current-interrupted-work"
		);
		expect(within(interruptedWork).getByText("Release room")).toBeTruthy();
		expect(within(interruptedWork).getByText("Needs attention")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Skip interrupted work" })
		).toBeNull();
		fireEvent.click(
			within(interruptedWork).getByRole("button", { name: "Skip" })
		);

		expect(executeAgentProfileWorkRecoveryMock).not.toHaveBeenCalled();
		const confirmation = screen.getByRole("alertdialog", {
			name: "Skip this work?",
		});
		expect(
			within(confirmation).getByText(
				"OpenMeld will not continue this work, and it asks your computer to stop the original attempt. Anything the work already changed stays as it is. Any queued work can start after you skip it."
			)
		).toBeTruthy();
		fireEvent.click(
			within(confirmation).getByRole("button", { name: "Cancel" })
		);
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

		fireEvent.click(
			within(interruptedWork).getByRole("button", { name: "Skip" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Skip work" }));
		expect(executeAgentProfileWorkRecoveryMock).toHaveBeenCalledWith({
			action: "skip_interrupted_work",
			agentProfileId: AGENT_PROFILE_ID,
			expectedInterruptedTargetWakeLifecycleId: "twl_interrupted",
			organizationId: "org-acme",
		});
		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Skipped Research Agent's interrupted work."
			);
		});
	});

	it("asks the owner to refresh instead of sending an unfenced Skip", async () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{
				agentProfileOperationalContextByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						{
							currentWorkLocation: null,
							queuedWorkLocations: ["Customer follow-up"],
							recoveryAction: { kind: "skip_interrupted_work" },
							status: "paused",
							waitingCount: 1,
						},
					],
				]),
				presentation: "detail",
			}
		);

		fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
		fireEvent.click(screen.getByRole("button", { name: "Skip work" }));

		expect(executeAgentProfileWorkRecoveryMock).not.toHaveBeenCalled();
		expect(toastMock.error).toHaveBeenCalledWith(
			"Refresh this page to review the Agent’s current paused work."
		);
	});

	it("shows team-safe Profile details for a teammate Agent", async () => {
		// Base UI mounts AvatarImage only after a browser image reports loaded.
		vi.stubGlobal(
			"Image",
			class {
				complete = true;
				naturalWidth = 1;
			}
		);
		const baseBinding = createPrimaryBindingResponse(
			"codex:approveForMe",
			"builtin:codex",
			{ modelId: "gpt-5.5", reasoningLevel: "high" }
		).binding;
		const primaryBinding = {
			...baseBinding,
			executionTarget: {
				...baseBinding.executionTarget,
				agentControllerConversationId: "private-native-session",
			},
		};
		const readiness = {
			...createReadinessResponseWithPrimaryBinding(primaryBinding),
			agentControllerRef: null,
			publicProfileConfiguration: {
				agentControllerCollaborationMode: "codex:default",
				agentControllerPermissionMode: "codex:approveForMe",
				agentControllerRef: "builtin:codex",
				modelSelection: {
					modelId: "gpt-5.5",
					reasoningLevel: "high",
				},
			},
			agentWakeAvailability: {
				action: "none",
				badgeLabel: "Unavailable",
				category: "unavailable",
				isRefreshing: false,
				label: "Unavailable for Wake",
				phase: "unavailable",
				reasonCode: "usage_exhausted",
				status: "unavailable_for_wake",
				summary: "This Agent is unavailable for Wake.",
				tooltip: "Unavailable for Wake",
			},
			ownerUserId: null,
			primaryActionPlan: { action: "none", target: null },
			primaryBinding: null,
			profileName: null,
			runtimeDeviceDisplayName: null,
		} as unknown as GetAgentExecutionReadinessResponse;
		renderAgentProfilesCard({}, null, {
			agentExecutionReadinessByProfileId: new Map([
				[AGENT_PROFILE_ID, readiness],
			]),
			ownerAvatarUrlByUserId: new Map([
				["user-1", "https://example.com/felix-avatar.png"],
			]),
			agentProfileOperationalContextByProfileId: new Map([
				[
					AGENT_PROFILE_ID,
					{
						currentWorkLocation: "Private Space",
						queuedWorkLocations: ["Private task"],
						recoveryAction: { kind: "skip_interrupted_work" },
						status: "working",
						waitingCount: 2,
					},
				],
			]),
			canManageProfile: () => false,
			presentation: "detail",
		});

		expect(
			await screen.findByTestId("agent-profile-workspace-detail")
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Chat with Research Agent" })
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit Name" })).toBeNull();
		expect(screen.queryByText("Operational context")).toBeNull();
		expect(
			screen.getByRole("heading", { name: "Current activity" })
		).toBeTruthy();
		expect(screen.getByText("Active task · 2 queued")).toBeTruthy();
		const presence = screen.getByTestId("agent-profile-presence");
		expect(within(presence).getByText("Unavailable")).toBeTruthy();
		expect(within(presence).queryByText("Working")).toBeNull();
		expect(screen.queryByText("Private Space")).toBeNull();
		expect(screen.queryByText("Private task")).toBeNull();
		expect(
			screen.getByRole("heading", { name: "How this Agent works" })
		).toBeTruthy();
		// The header names the controller; the Model card names the model a
		// colleague's Agent saved, with its effort.
		expect(screen.getAllByText("Codex · GPT-5.5 · high")).toHaveLength(1);
		expect(screen.getByText("GPT-5.5 · High")).toBeTruthy();
		expect(screen.getByText("Approve for me")).toBeTruthy();
		// A teammate sees no quota while the Agent has room to spare.
		expect(
			within(screen.getByTestId("agent-configuration-overview")).queryByRole(
				"region",
				{ name: "Usage limits" }
			)
		).toBeNull();
		expect(
			document.querySelector('img[src="https://example.com/felix-avatar.png"]')
		).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		expect(
			screen.queryByTestId(
				`agent-profile-controller-fallback-${AGENT_PROFILE_ID}`
			)
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Agent options for Research Agent" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "More details" }));
		const dialog = screen.getByRole("dialog", { name: "More details" });
		expect(within(dialog).getByText("Profile details")).toBeTruthy();
		expect(within(dialog).queryByText("Availability")).toBeNull();
		expect(screen.queryByText("Controller conversation ID")).toBeNull();
		expect(screen.queryByText("Computer")).toBeNull();
		expect(within(dialog).queryByText("Model")).toBeNull();
		expect(screen.queryByText("Binding state")).toBeNull();
		expect(within(dialog).queryByText("GPT-5.5 · High")).toBeNull();
		expect(screen.queryByText("No Controller connected")).toBeNull();
		await waitFor(() => {
			expect(readCurrentAgentActivitySessionsMock).not.toHaveBeenCalled();
		});
	});

	it("does not turn team-safe null Binding readiness into an owner setup or repair action", async () => {
		const privateBinding =
			createPrimaryBindingResponse("codex:approveForMe").binding;
		const ownerReadiness = createReadinessResponseWithPrimaryBinding(
			privateBinding
		) as unknown as GetAgentExecutionReadinessResponse;
		const teamSafeReadiness = {
			...ownerReadiness,
			agentControllerRef: null,
			agentExecutionReadiness: {
				...ownerReadiness.agentExecutionReadiness,
				primaryAction: "none",
				reasonCodes: [],
			},
			agentWakeAvailability: {
				...ownerReadiness.agentWakeAvailability,
				action: "none",
				phase: "unavailable",
				reasonCode: null,
			},
			ownerUserId: null,
			primaryActionPlan: { action: "none", target: null },
			primaryBinding: null,
			profileName: null,
		} as GetAgentExecutionReadinessResponse;

		const { container } = renderAgentProfilesCard({}, null, {
			agentExecutionReadinessByProfileId: new Map([
				[AGENT_PROFILE_ID, teamSafeReadiness],
			]),
			canManageProfile: () => false,
			presentation: "detail",
		});

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		expect(container.querySelector('a[href="/app/connect"]')).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: REPAIR_OR_RECONNECT_ACTION_NAME_PATTERN,
			})
		).toBeNull();
	});

	it("keeps a readiness failure and its diagnostic visible in detail", async () => {
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map(),
				agentExecutionReadinessErrorByProfileId: new Map([
					[AGENT_PROFILE_ID, "Core could not read Wake availability."],
				]),
			},
			null,
			{ presentation: "detail" }
		);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Core could not read Wake availability."
		);
		expect(screen.getByText("Couldn’t check availability.")).toBeTruthy();
		const presence = screen.getByTestId("agent-profile-presence");
		expect(
			within(presence).queryByRole("link", {
				name: WAKEABILITY_LINK_ACTION_PATTERN,
			})
		).toBeNull();
		expect(
			within(presence).queryByRole("button", {
				name: REPAIR_OR_RECONNECT_ACTION_NAME_PATTERN,
			})
		).toBeNull();
	});

	it("keeps cached Available on the card when its refresh fails", () => {
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						createWakeAvailabilityReadiness("available_for_wake"),
					],
				]),
				agentExecutionReadinessErrorByProfileId: new Map([
					[AGENT_PROFILE_ID, "Core could not refresh Wake availability."],
				]),
			},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "cards" }
		);

		const badge = screen.getByTestId("agent-profile-row-availability-badge");
		expect(badge.getAttribute("data-availability-phase")).toBe("available");
		expect(badge.textContent).toContain("Available");
		expect(badge.textContent).toContain("Couldn’t refresh availability.");
	});

	it("keeps cached Available when its refresh fails", async () => {
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						createWakeAvailabilityReadiness("available_for_wake"),
					],
				]),
				agentExecutionReadinessErrorByProfileId: new Map([
					[AGENT_PROFILE_ID, "Core could not refresh Wake availability."],
				]),
			},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "detail" }
		);

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Core could not refresh Wake availability."
		);
		const presence = screen.getByTestId("agent-profile-presence");
		expect(presence.textContent).toContain("Available");
		expect(presence.textContent).toContain("Couldn’t refresh availability.");
		expect(
			within(presence).queryByRole("link", {
				name: WAKEABILITY_LINK_ACTION_PATTERN,
			})
		).toBeNull();
	});

	it("keeps cached Unavailable when its refresh fails", async () => {
		const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						createReadinessResponseWithPrimaryBinding(
							binding
						) as unknown as GetAgentExecutionReadinessResponse,
					],
				]),
				agentExecutionReadinessErrorByProfileId: new Map([
					[AGENT_PROFILE_ID, "Core could not refresh Wake availability."],
				]),
			},
			binding,
			{ presentation: "detail" }
		);

		const presence = screen.getByTestId("agent-profile-presence");
		expect(presence.textContent).toContain("Unavailable");
		expect(presence.textContent).toContain("Couldn’t refresh availability.");
		expect((await within(presence).findByRole("alert")).textContent).toContain(
			"Core could not refresh Wake availability."
		);
	});

	it("keeps the Core recovery action in the selected Agent detail", async () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "detail" }
		);

		const presence = screen.getByTestId("agent-profile-presence");
		const headerActions = screen.getByTestId(
			"agent-profile-header-recovery-actions"
		);
		const reconnectLink = await within(headerActions).findByRole("link", {
			name: "Reconnect computer",
		});
		const reason = within(presence).getByText(
			"Connect your computer before this Agent can reply."
		);
		expect(reconnectLink.getAttribute("href")).toBe("/app/connect");
		expect(reason).toBeTruthy();
		expect(
			within(presence).getByRole("link", { name: "Reconnect computer" })
		).toBe(reconnectLink);
		expect(
			screen.queryByRole("link", { name: "Reconnect OpenMeld Service" })
		).toBeNull();
	});

	it("edits the name in place and Cancel restores it without saving", async () => {
		renderAgentProfilesCard({}, undefined, { presentation: "detail" });

		fireEvent.click(await screen.findByRole("button", { name: "Edit Name" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Unsaved Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		await waitFor(() =>
			expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull()
		);
		expect(screen.getByText("How this Agent works")).toBeTruthy();
		expect(renameOpenMeldProfileMock).not.toHaveBeenCalled();
	});

	it("keeps the inline draft and visible diagnostic when saving fails", async () => {
		renameOpenMeldProfileMock.mockRejectedValueOnce(
			new Error("The Agent name could not be saved.")
		);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		renderAgentProfilesCard({}, undefined, { presentation: "detail" });

		fireEvent.click(await screen.findByRole("button", { name: "Edit Name" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Still in the form" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect((await screen.findByRole("alert")).textContent).toContain(
			"The Agent name could not be saved."
		);
		expect(screen.getByRole("textbox", { name: "Name" })).toBeTruthy();
		expect(
			(screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value
		).toBe("Still in the form");
	});

	it("leaves inline edit after a rename without waiting for a full refresh", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		renderAgentProfilesCard({ refreshAll }, undefined, {
			presentation: "detail",
		});

		fireEvent.click(await screen.findByRole("button", { name: "Edit Name" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Field Research Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(renameOpenMeldProfileMock).toHaveBeenCalled();
			expect(refreshAll).not.toHaveBeenCalled();
			expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
		});
	});

	it("keeps a saved rename independent from an unrelated full refresh", async () => {
		const refreshAll = vi
			.fn()
			.mockRejectedValue(new Error("Directory refresh timed out."));
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		renderAgentProfilesCard({ refreshAll }, undefined, {
			presentation: "detail",
		});

		fireEvent.click(await screen.findByRole("button", { name: "Edit Name" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Field Research Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
			expect(refreshAll).not.toHaveBeenCalled();
			expect(toastMock.warning).not.toHaveBeenCalled();
			expect(consoleError).not.toHaveBeenCalled();
		});
	});

	it("does not treat an idle bound Session as current activity", () => {
		const baseBinding =
			createPrimaryBindingResponse("codex:approveForMe").binding;
		const primaryBinding = {
			...baseBinding,
			executionTarget: {
				...baseBinding.executionTarget,
				agentControllerConversationId: "native-session-1",
			},
		};
		readCurrentAgentActivitySessionsMock.mockResolvedValue({
			asOfMs: 1_787_220_000_000,
			coverage: [],
			nextCursor: null,
			organization: { id: "org-acme", name: "Acme" },
			sessions: [
				{
					bindingState: "bound",
					boundAgentProfileId: AGENT_PROFILE_ID,
					canFork: true,
					canResume: false,
					computer: {
						id: "computer-1",
						lastSeenAtMs: 1_787_220_000_000,
						name: "Mira's MacBook Pro",
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
					nativeSessionId: "native-session-1",
					nativeSessionTitle: "Ship the Agent Profile upgrade",
					organization: { id: "org-acme", name: "Acme" },
					origin: "openmeld",
					owner: { name: "Mira", userId: "user-1" },
					project: { id: "project-1", name: "OpenMeld", slug: "openmeld" },
					startedAtMs: 1_787_218_000_000,
					status: "idle",
				},
			],
		});
		renderAgentProfilesCard({}, primaryBinding, { presentation: "detail" });

		expect(readCurrentAgentActivitySessionsMock).not.toHaveBeenCalled();
		expect(
			screen.getByRole("status", { name: "Loading Agent activity" })
		).toBeTruthy();
		expect(screen.queryByTestId("agent-current-activity")).toBeNull();
		expect(screen.queryByText("Ship the Agent Profile upgrade")).toBeNull();
	});

	it("does not present a bound Session as the current Wake destination", () => {
		const baseBinding =
			createPrimaryBindingResponse("codex:approveForMe").binding;
		const primaryBinding = {
			...baseBinding,
			executionTarget: {
				...baseBinding.executionTarget,
				agentControllerConversationId: "native-session-1",
			},
		};
		readCurrentAgentActivitySessionsMock.mockResolvedValue({
			asOfMs: 1_787_220_000_000,
			coverage: [],
			nextCursor: null,
			organization: { id: "org-acme", name: "Acme" },
			sessions: [
				{
					bindingState: "bound",
					boundAgentProfileId: AGENT_PROFILE_ID,
					canFork: true,
					canResume: false,
					computer: {
						id: "computer-1",
						lastSeenAtMs: 1_787_220_000_000,
						name: "Mira's MacBook Pro",
						state: "online",
					},
					dataState: "current",
					inventoryUpdatedAtMs: 1_787_220_000_000,
					lastActiveAtMs: 1_787_220_000_000,
					localAgent: {
						agentControllerRef: "builtin:codex",
						name: "Codex",
						provider: "codex",
					},
					nativeSessionId: "native-session-1",
					nativeSessionTitle: "Ship the Agent Profile upgrade",
					organization: { id: "org-acme", name: "Acme" },
					origin: "openmeld",
					owner: { name: "Mira", userId: "user-1" },
					project: { id: "project-1", name: "OpenMeld", slug: "openmeld" },
					startedAtMs: 1_787_218_000_000,
					status: "working",
				},
			],
		});
		renderAgentProfilesCard({}, primaryBinding, {
			agentProfileOperationalContextByProfileId: new Map([
				[
					AGENT_PROFILE_ID,
					{
						currentWorkLocation: null,
						queuedWorkLocations: [],
						recoveryAction: null,
						status: "working",
						waitingCount: 0,
					},
				],
			]),
			presentation: "detail",
		});

		expect(readCurrentAgentActivitySessionsMock).not.toHaveBeenCalled();
		const activity = screen.getByTestId("agent-current-activity");
		expect(within(activity).getByText("Active task")).toBeTruthy();
		expect(within(activity).queryByRole("link")).toBeNull();
	});

	it("shows a large create card when there are no Agents", () => {
		const onCreateProfile = vi.fn();
		renderAgentProfilesCard({}, null, {
			agentProfiles: [],
			agentProfilesQueryState: {
				isError: false,
				isPending: false,
			},
			onCreateProfile,
		});

		expect(
			screen.queryByText("No Agents are connected to this account yet.")
		).toBeNull();
		const createCard = screen.getByRole("button", {
			name: CREATE_AN_AGENT_PROFILE_NAME,
		});
		expect(createCard.className).toContain("rounded-md");
		expect(createCard.querySelector(".rounded-md")).toBeTruthy();
		fireEvent.click(createCard);

		expect(onCreateProfile).toHaveBeenCalledTimes(1);
	});

	it("keeps quick icon actions and exposes Edit Agent in the options menu", async () => {
		renderAgentProfilesCard();

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		const directMessageButton = screen.getByRole("button", {
			name: "Direct Message",
		});
		const editButton = screen.getByRole("button", {
			name: "Edit Agent",
		});
		expect(directMessageButton.textContent).toBe("");
		expect(editButton.textContent).toBe("");

		fireEvent.mouseEnter(directMessageButton);

		fireEvent.mouseMove(directMessageButton);
		expect(await screen.findByText("Direct Message")).toBeTruthy();
		fireEvent.mouseLeave(directMessageButton);
		await waitFor(() => {
			expect(screen.queryByText("Direct Message")).toBeNull();
		});
		fireEvent.mouseEnter(editButton);
		fireEvent.mouseMove(editButton);
		expect(await screen.findByText("Edit Agent")).toBeTruthy();
		fireEvent.mouseLeave(editButton);
		await waitFor(() => {
			expect(screen.queryByText("Edit Agent")).toBeNull();
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		expect(screen.getByRole("menuitem", { name: "More details" })).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Working folder" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Unbind controller" })
		).toBeTruthy();
		expect(
			screen.getByRole("menuitem", { name: "Remove profile" })
		).toBeTruthy();
		expect(screen.queryByText("Direct Message")).toBeNull();
		expect(screen.getByRole("menuitem", { name: "Edit Agent" })).toBeTruthy();
	});

	it("closes the confirmation and removes the Agent from the list cache before deletion settles", async () => {
		let resolveDelete!: (profile: AuthProfileView) => void;
		deleteStartAgentProfileMock.mockImplementation(
			() =>
				new Promise<AuthProfileView>((resolve) => {
					resolveDelete = resolve;
				})
		);
		const profile = createAgentProfile();
		const { queryClient } = renderAgentProfilesCard();
		const profilesQueryKey =
			startQueryKeys.profilesForStorageScope("test-scope");
		queryClient.setQueryData(profilesQueryKey, [profile]);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove profile" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove profile" }));

		await waitFor(() => {
			expect(
				screen.queryByRole("heading", { name: "Remove Agent?" })
			).toBeNull();
			expect(screen.queryByText("Research Agent")).toBeNull();
			expect(queryClient.getQueryData(profilesQueryKey)).toEqual([]);
		});
		expect(deleteStartAgentProfileMock).toHaveBeenCalledWith({
			data: AGENT_PROFILE_ID,
		});
		resolveDelete(profile);
		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Research Agent was removed from Local Agents."
			);
			expect(queryClient.getQueryState(profilesQueryKey)?.isInvalidated).toBe(
				true
			);
			expect(refreshReadinessSharedCachesMock).toHaveBeenCalledWith({
				agentProfileIds: [AGENT_PROFILE_ID],
				organizationId: "org-acme",
				queryClient,
				storageScope: "test-scope",
			});
		});
	});

	it("does not substitute another Agent while the selected detail removal settles", async () => {
		let resolveDelete!: (profile: AuthProfileView) => void;
		deleteStartAgentProfileMock.mockImplementation(
			() =>
				new Promise<AuthProfileView>((resolve) => {
					resolveDelete = resolve;
				})
		);
		const selectedProfile = createAgentProfile();
		const otherProfile = createAgentProfile({
			openMeldProfileId: "agt-support",
			profileHandle: "support-agent",
			profileName: "Support Agent",
		});
		renderAgentProfilesCard(
			{ agentProfiles: [selectedProfile, otherProfile] },
			undefined,
			{
				focusProfileId: selectedProfile.openMeldProfileId,
				presentation: "detail",
			}
		);

		fireEvent.click(
			await screen.findByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove profile" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove profile" }));

		await waitFor(() => {
			expect(screen.getByText("Removing Research Agent…")).toBeTruthy();
			expect(
				screen.queryByRole("heading", { name: "Support Agent" })
			).toBeNull();
		});

		resolveDelete(selectedProfile);
		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Research Agent was removed from Local Agents."
			);
		});
	});

	it("restores the Agent list cache when deletion fails", async () => {
		const removeError = new Error("Failed to remove agent profile: 500");
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		deleteStartAgentProfileMock.mockRejectedValue(removeError);
		const profile = createAgentProfile();
		const { queryClient } = renderAgentProfilesCard();
		const profilesQueryKey =
			startQueryKeys.profilesForStorageScope("test-scope");
		queryClient.setQueryData(profilesQueryKey, [profile]);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Remove profile" }));
		fireEvent.click(screen.getByRole("button", { name: "Remove profile" }));

		await waitFor(() => {
			expect(queryClient.getQueryData(profilesQueryKey)).toEqual([profile]);
			expect(screen.getByText("Research Agent")).toBeTruthy();
			expect(toastMock.error).toHaveBeenCalledWith(
				"OpenMeld could not remove Research Agent. The Agent was restored to Local Agents."
			);
		});
		expect(screen.queryByRole("heading", { name: "Remove Agent?" })).toBeNull();
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"Failed to remove Agent Profile. The optimistic cache update was rolled back.",
			removeError
		);
		expect(refreshReadinessSharedCachesMock).not.toHaveBeenCalled();
	});

	it("opens an Agent conversation in the dedicated Direct Messages route", async () => {
		renderAgentProfilesCard();

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Direct Message",
			})
		);

		await waitFor(() => {
			expect(openCurrentDirectMessageSpaceMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				targetProfileId: AGENT_PROFILE_ID,
			});
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/chats/space-research-agent-dm?profileId=profile-felix",
			});
		});
	});

	it("does not show local Project settings for a managed Agent", async () => {
		renderAgentProfilesCard({}, undefined, {
			agentProfiles: [createAgentProfile({ managedRole: "center_agent" })],
		});

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		expect(
			screen.queryByRole("menuitem", { name: "Working folder" })
		).toBeNull();
	});

	it("only highlights the dangerous permission mode value", async () => {
		readPrimaryBindingMock.mockImplementation(async () =>
			createPrimaryBindingResponse(
				"claude-code:bypassPermissions",
				"builtin:claude-code"
			)
		);

		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse(
				"claude-code:bypassPermissions",
				"builtin:claude-code"
			).binding
		);

		await waitFor(() => {
			expect(
				screen.getByTestId("agent-controller-permission-mode-inline-display")
					.textContent
			).toBe("Claude Code permissions mode: Bypass permissions");
		});

		expect(
			screen.getByTestId("agent-controller-permission-mode-inline-label")
				.className
		).not.toContain("text-destructive");
		expect(
			screen.getByTestId("agent-controller-permission-mode-inline-value")
				.className
		).toContain("text-destructive");
	});

	it.each([
		"accepted",
		"rejected",
	] as const)("keeps Full access model edits responsive when the save is %s", async (outcome) => {
		const initial = createPrimaryBindingResponse(
			"codex:fullAccess",
			"builtin:codex",
			{ modelId: "gpt-5.5", reasoningLevel: "low" }
		);
		let finishSave: (value: unknown) => void = () => undefined;
		updatePrimaryBindingModelSelectionMock.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishSave = resolve;
				})
		);
		readPrimaryBindingMock.mockResolvedValue(initial);
		// A slow or failed refresh must not turn an acknowledged save into a failure.
		let finishRefresh: () => void = () => undefined;
		refreshReadinessFactsMock.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					finishRefresh = () => reject(new Error("Status refresh unavailable"));
				})
		);
		renderAgentProfilesCard({}, initial.binding, { presentation: "detail" });
		fireEvent.click(await screen.findByLabelText("Edit Model"));
		fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
		fireEvent.click(screen.getByRole("option", { name: "High" }));
		const save = screen.getByText("Save changes") as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		expect(screen.queryByRole("checkbox")).toBeNull();
		fireEvent.click(save);
		const modelCard = screen.getByLabelText("Edit Model");
		expect(modelCard.getAttribute("aria-expanded")).toBe("false");
		expect(modelCard.textContent).toContain("high");
		expect(modelCard.textContent).toContain("Saving…");
		expect(toastMock.success).not.toHaveBeenCalled();
		fireEvent.click(screen.getByLabelText("Edit Collaboration mode"));
		expect(
			screen.getByText("Another setting is saving. You can keep editing.")
		).toBeTruthy();
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: "Collaboration mode" })
			).getByText("Cancel")
		);
		const saved = createEnsureBindingResponse(
			"codex:fullAccess",
			"builtin:codex",
			{ modelId: "gpt-5.5", reasoningLevel: "high" }
		);
		readPrimaryBindingMock.mockResolvedValue({ ...saved, status: "found" });
		await act(() => {
			finishSave(outcome === "accepted" ? saved : { status: "rejected" });
		});
		await waitFor(() => expect(modelCard.textContent).not.toContain("Saving…"));
		if (outcome === "accepted") {
			expect(modelCard.textContent).toContain("High");
			expect(toastMock.success).toHaveBeenCalledWith("Agent settings saved.");
		} else {
			expect(modelCard.textContent).toContain("Low");
			expect(modelCard.textContent).toContain(
				"Changes weren’t saved. Open to retry."
			);
			expect(toastMock.success).not.toHaveBeenCalled();
			fireEvent.click(modelCard);
			expect(
				screen.getByRole("combobox", { name: "Reasoning effort" }).textContent
			).toContain("High");
			expect(screen.getByRole("alert").textContent).toContain("could not save");
		}
		expect(
			updatePrimaryBindingAgentControllerPermissionModeMock
		).not.toHaveBeenCalled();
		await act(() => {
			finishRefresh();
		});
		if (outcome === "accepted") {
			expect(toastMock.warning).toHaveBeenCalledWith(
				"Settings saved. Refresh the page to reload the latest status."
			);
			expect(toastMock.error).not.toHaveBeenCalled();
			expect(modelCard.textContent).toContain("High");
		}
	});

	it("updates the Agent Controller Permission Mode from the Agent edit menu", async () => {
		let currentPolicy = "codex:askForApproval";
		readPrimaryBindingMock.mockImplementation(async () =>
			createPrimaryBindingResponse(currentPolicy)
		);
		updatePrimaryBindingAgentControllerPermissionModeMock.mockImplementation(
			(input) => {
				currentPolicy = input.agentControllerPermissionMode;
				return Promise.resolve(
					createEnsureBindingResponse(input.agentControllerPermissionMode)
				);
			}
		);
		const refreshAll = vi.fn();
		const { queryClient } = renderAgentProfilesCard(
			{ refreshAll },
			createPrimaryBindingResponse(currentPolicy).binding
		);
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		await waitFor(() => {
			expect(
				screen.getByTestId("agent-controller-permission-mode-inline-display")
					.textContent
			).toBe("Codex permissions mode: Ask for approval");
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		const editDialog = screen.getByRole("dialog", { name: "Edit Agent" });
		expect(
			within(editDialog).getByRole("heading", { name: "Edit Agent" })
		).toBeTruthy();
		expect(within(editDialog).getByText("Codex permissions mode")).toBeTruthy();
		const outcome = within(editDialog).getByTestId(
			"agent-controller-permission-mode-outcome"
		);
		const permissionSelect = within(editDialog).getByRole("combobox", {
			name: "Codex permissions mode",
		});
		expect(permissionSelect.textContent).toBe("Ask for approval");
		expect(permissionSelect.getAttribute("aria-describedby")).toBe(
			`${outcome.id}-description`
		);
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
		);
		fireEvent.click(
			screen.getByRole("option", {
				name: "Full access",
			})
		);
		const technicalDetails = within(editDialog)
			.getByText("Technical details")
			.closest("details") as HTMLDetailsElement;
		expect(technicalDetails.open).toBe(false);
		expect(technicalDetails.textContent).toContain(
			"--dangerously-bypass-approvals-and-sandbox"
		);

		const saveButton = screen.getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(saveButton.disabled).toBe(true);
		fireEvent.click(
			screen.getByLabelText(
				"I understand this mode may run dangerous actions without asking."
			)
		);
		await waitFor(() => {
			expect(saveButton.disabled).toBe(false);
		});
		fireEvent.click(saveButton);

		await waitFor(() => {
			expect(
				updatePrimaryBindingAgentControllerPermissionModeMock
			).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentControllerPermissionMode: "codex:fullAccess",
				agentProfileId: AGENT_PROFILE_ID,
				organizationId: "org-acme",
			});
		});
		expect(refreshAll).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		await waitFor(() => {
			expect(
				screen.getByTestId("agent-controller-permission-mode-inline-display")
					.textContent
			).toBe("Codex permissions mode: Full access");
		});
	});

	it("does not report settings saved when the server returns the previous Permission Mode", async () => {
		updatePrimaryBindingAgentControllerPermissionModeMock.mockResolvedValue(
			createEnsureBindingResponse("codex:approveForMe")
		);
		renderAgentProfilesCard();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
		);
		fireEvent.click(
			screen.getByRole("option", {
				name: "Full access",
			})
		);
		fireEvent.click(
			screen.getByLabelText(
				"I understand this mode may run dangerous actions without asking."
			)
		);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"OpenMeld could not verify that the Agent Profile settings were saved. Please try again."
			);
		});
		expect(toastMock.success).not.toHaveBeenCalled();
		expect(screen.getByRole("heading", { name: "Edit Agent" })).toBeTruthy();
		expect(
			screen.getByTestId("agent-controller-permission-mode-inline-display")
				.textContent
		).toBe("Codex permissions mode: Approve for me");
	});

	it("reads saved collaboration mode from the readiness public configuration", async () => {
		const binding = createPrimaryBindingResponse("codex:fullAccess").binding;
		// Captured from the local runtime-overview HTTP response: readiness omits
		// collaboration mode from primaryBinding and exposes it in this projection.
		const readiness = {
			...createReadinessResponseWithPrimaryBinding(binding),
			primaryBinding: {
				...binding,
				agentControllerCollaborationMode: undefined,
			},
			wakeRouteEvidence: {
				observedAt: "2026-10-01T15:44:04.199Z",
				reasonCode: "route.not_registered",
				status: "offline",
			},
			publicProfileConfiguration: {
				agentControllerRef: "builtin:codex",
				agentControllerCollaborationMode: "codex:plan" as const,
				agentControllerPermissionMode: "codex:fullAccess" as const,
				modelSelection: null,
			},
		} as unknown as GetAgentExecutionReadinessResponse;
		renderAgentProfilesCard({}, binding, {
			presentation: "detail",
			agentExecutionReadinessByProfileId: new Map([
				[AGENT_PROFILE_ID, readiness],
			]),
		});
		const card = await screen.findByRole("button", {
			name: "Edit Collaboration mode",
		});
		expect(within(card).getByText("Plan")).toBeTruthy();
		fireEvent.click(card);
		expect(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
				.textContent
		).toBe("Plan");
		expect(
			screen
				.getByRole("button", { name: "Save changes" })
				.hasAttribute("disabled")
		).toBe(true);
	});

	it.each([
		"codex:askForApproval",
		"codex:fullAccess",
	])("updates Codex Collaboration Mode without changing %s Permission Mode", async (permissionMode) => {
		let currentCollaborationMode = "codex:default";
		readPrimaryBindingMock.mockImplementation(async () =>
			createPrimaryBindingResponse(
				permissionMode,
				"builtin:codex",
				null,
				currentCollaborationMode
			)
		);
		updatePrimaryBindingAgentControllerCollaborationModeMock.mockImplementation(
			(input) => {
				currentCollaborationMode = input.agentControllerCollaborationMode;
				return Promise.resolve(
					createEnsureBindingResponse(
						permissionMode,
						"builtin:codex",
						null,
						currentCollaborationMode
					)
				);
			}
		);
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse(
				permissionMode,
				"builtin:codex",
				null,
				currentCollaborationMode
			).binding
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		expect(screen.getByText("Codex collaboration mode")).toBeTruthy();
		expect(
			screen.getByText(
				"Work directly on tasks. Codex may ask for approval when an action needs it."
			)
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Plan" }));
		expect(
			screen.getByText(
				"Plan before implementation. Codex can ask structured questions in the Space and will not make changes until you switch back to Default."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(
				updatePrimaryBindingAgentControllerCollaborationModeMock
			).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentControllerCollaborationMode: "codex:plan",
				agentProfileId: AGENT_PROFILE_ID,
				organizationId: "org-acme",
			});
		});
		expect(
			updatePrimaryBindingAgentControllerPermissionModeMock
		).not.toHaveBeenCalled();
	});

	it("preserves unsaved Agent edits across equivalent readiness rerenders", () => {
		const primaryBinding = createPrimaryBindingResponse(
			"codex:askForApproval"
		).binding;
		const { rerenderAgentProfilesCard } = renderAgentProfilesCard(
			{},
			primaryBinding
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Unsaved Research Agent" },
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Plan" }));

		rerenderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:askForApproval").binding
		);

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
			"Unsaved Research Agent"
		);
		expect(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
				.textContent
		).toContain("Plan");
	});

	it("focuses approval recovery once without stealing focus from later profile edits", async () => {
		const primaryBinding = createPrimaryBindingResponse("codex:askForApproval")
			.binding as GetAgentProfilePrimaryBindingResponse["binding"];

		render(
			<AgentProfileEditDialog
				controllerChangeOptions={[
					{
						agentControllerRef: "builtin:claude-code",
						label: "Claude Code",
					},
				]}
				editState={resolveAgentProfileEditState({
					binding: primaryBinding,
					modelCatalog: null,
				})}
				initialSection="permissions"
				isPending={false}
				modelCatalog={null}
				onControllerChange={() => Promise.resolve()}
				onControllerCollaborationModeUpdate={() => Promise.resolve()}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenChange={() => undefined}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={() => Promise.resolve()}
				open={true}
				profileName="Research Agent"
			/>
		);

		const permissionsControl = screen.getByRole("combobox", {
			name: PERMISSIONS_MODE_NAME_PATTERN,
		});
		expect(
			permissionsControl.closest(
				'[data-slot="agent-profile-permission-mode-section"]'
			)
		).not.toBeNull();
		await waitFor(() => {
			expect(document.activeElement).toBe(permissionsControl);
		});

		fireEvent.click(
			screen.getByRole("combobox", { name: "Change controller" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Claude Code" }));
		await act(
			async () =>
				await new Promise<void>((resolve) => {
					window.requestAnimationFrame(() => resolve());
				})
		);
		const nameInput = screen.getByRole("textbox", { name: "Name" });
		nameInput.focus();
		fireEvent.change(nameInput, {
			target: { value: "Renamed Research Agent" },
		});
		await act(
			async () =>
				await new Promise<void>((resolve) => {
					window.requestAnimationFrame(() => resolve());
				})
		);

		expect(document.activeElement).toBe(nameInput);
	});

	it("keeps an Agent rename pending when another setting fails to save", async () => {
		const onControllerCollaborationModeUpdate = vi.fn(() =>
			Promise.reject(new Error("Collaboration Mode update failed"))
		);
		const onRenameProfile = vi.fn(() => Promise.resolve());
		const onSaveComplete = vi.fn(() => Promise.resolve());
		const onOpenChange = vi.fn();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const primaryBinding = createPrimaryBindingResponse("codex:askForApproval")
			.binding as GetAgentProfilePrimaryBindingResponse["binding"];

		render(
			<AgentProfileEditDialog
				controllerChangeOptions={[]}
				editState={resolveAgentProfileEditState({
					binding: primaryBinding,
					modelCatalog: null,
				})}
				isPending={false}
				modelCatalog={null}
				onControllerChange={() => Promise.resolve()}
				onControllerCollaborationModeUpdate={
					onControllerCollaborationModeUpdate
				}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenChange={onOpenChange}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={onRenameProfile}
				onSaveComplete={onSaveComplete}
				open={true}
				profileName="Research Agent"
			/>
		);

		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Renamed Research Agent" },
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Plan" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(onControllerCollaborationModeUpdate).toHaveBeenCalledWith(
				"codex:plan"
			);
		});
		expect(onRenameProfile).not.toHaveBeenCalled();
		expect(onSaveComplete).not.toHaveBeenCalled();
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to update Agent Profile.",
			expect.any(Error)
		);
	});

	it("keeps the inline draft and error after a partial save rerenders its source", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(<PartialSaveInlineEditorHarness />);

		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Renamed Research Agent" },
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Plan" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect((await screen.findByRole("alert")).textContent).toContain(
			"Collaboration Mode update failed"
		);
		expect(
			(screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value
		).toBe("Renamed Research Agent");
		expect(
			screen.getByRole("combobox", { name: "Codex collaboration mode" })
				.textContent
		).toContain("Plan");
	});

	it("shows the current runtime and links Agent settings back to its computer", () => {
		render(
			<AgentProfileEditDialog
				controllerChangeOptions={[]}
				editState={null}
				isPending={false}
				modelCatalog={null}
				onControllerChange={() => Promise.resolve()}
				onControllerCollaborationModeUpdate={() => Promise.resolve()}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenChange={() => undefined}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={() => Promise.resolve()}
				open={true}
				profileName="Research Agent"
				runtime={{
					computerName: "Fangyuan's MacBook Pro",
					controllerName: "Claude Code",
					managePath: "/o/amplift/computers/device-fangyuan",
				}}
			/>
		);

		expect(screen.getByText("Runtime")).toBeTruthy();
		expect(
			screen.getByText("Claude Code on Fangyuan's MacBook Pro")
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Manage on Computer" })
				.getAttribute("href")
		).toBe("/o/amplift/computers/device-fangyuan");
	});

	it("shows an in-place repair action for a saved model Codex no longer offers", () => {
		const primaryBinding = createPrimaryBindingResponse(
			"codex:askForApproval",
			"builtin:codex",
			{ modelId: "gpt-5.4", reasoningLevel: "medium" }
		).binding as GetAgentProfilePrimaryBindingResponse["binding"];
		const modelCatalog: ModelCatalog = {
			agentControllers: {
				codex: {
					defaultModelId: "gpt-5.5",
					models: [
						{
							displayName: "GPT-5.5",
							id: "gpt-5.5",
							minCliVersion: null,
							supportedReasoningLevels: ["low", "medium", "high"],
							unavailable: false,
						},
						{
							displayName: "GPT-5.4",
							id: "gpt-5.4",
							minCliVersion: null,
							supportedReasoningLevels: ["low", "medium", "high"],
							unavailable: false,
						},
					],
				},
			},
			schemaVersion: 1,
			updatedAt: "2026-06-18T00:00:00.000Z",
		};

		render(
			<AgentProfileEditDialog
				controllerChangeOptions={[]}
				editState={resolveAgentProfileEditState({
					binding: primaryBinding,
					modelCatalog,
				})}
				isPending={false}
				modelCatalog={modelCatalog}
				modelCompatibilityContext={{
					agentControllerId: "codex",
					controllerDisplayName: "Codex",
					installedVersion: "0.142.5",
					managePath: "/o/amplift/computers/device-monica",
					reportedModelIds: ["gpt-5.5"],
				}}
				onControllerChange={() => Promise.resolve()}
				onControllerCollaborationModeUpdate={() => Promise.resolve()}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenChange={() => undefined}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={() => Promise.resolve()}
				open={true}
				profileName="Research Agent"
			/>
		);

		expect(
			screen.getByText(
				"GPT-5.4 isn't available in Codex on this computer. Choose another model or update or change the installation."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Update or change Codex" })
				.getAttribute("href")
		).toBe("/o/amplift/computers/device-monica");
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		expect(
			screen
				.getByRole("option", {
					name: "GPT-5.4 (not available on this computer)",
				})
				.hasAttribute("data-disabled")
		).toBe(true);
	});

	it("locks only the controller while an Agent is working", () => {
		const primaryBinding = createPrimaryBindingResponse(
			"codex:askForApproval",
			"builtin:codex",
			{
				modelId: "gpt-5.5",
				reasoningLevel: "medium",
			}
		).binding as GetAgentProfilePrimaryBindingResponse["binding"];
		const modelCatalog: ModelCatalog = {
			agentControllers: {
				codex: {
					defaultModelId: "gpt-5.5",
					models: [
						{
							displayName: "GPT-5.5",
							id: "gpt-5.5",
							minCliVersion: null,
							supportedReasoningLevels: ["low", "medium", "high"],
							unavailable: false,
						},
					],
				},
			},
			schemaVersion: 1,
			updatedAt: "2026-06-18T00:00:00.000Z",
		};

		render(
			<AgentProfileEditDialog
				controllerChangeEligibilityStatus="blocked"
				controllerChangeOptions={[
					{
						agentControllerRef: "builtin:claude-code",
						label: "Claude Code",
					},
				]}
				editState={resolveAgentProfileEditState({
					binding: primaryBinding,
					modelCatalog,
				})}
				isPending={false}
				modelCatalog={modelCatalog}
				onControllerChange={() => Promise.resolve()}
				onControllerCollaborationModeUpdate={() => Promise.resolve()}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenChange={() => undefined}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={() => Promise.resolve()}
				open={true}
				profileName="Research Agent"
			/>
		);

		expect(
			(
				screen.getByRole("combobox", {
					name: "Change controller",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(
			(screen.getByRole("combobox", { name: "Model" }) as HTMLButtonElement)
				.disabled
		).toBe(false);
		expect(
			(
				screen.getByRole("combobox", {
					name: "Reasoning effort",
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		expect(
			(
				screen.getByRole("combobox", {
					name: PERMISSIONS_MODE_NAME_PATTERN,
				}) as HTMLButtonElement
			).disabled
		).toBe(false);
		expect(
			screen.getByText(
				"Controller changes are unavailable while this Agent is working because reconnecting would interrupt the current Wake."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"Model, reasoning effort, collaboration mode, and OpenCode permission changes apply to the next Wake."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"This controller can apply a saved Permission Mode to later tool requests in the current Wake. If the current session cannot accept it, the next Wake uses it."
			)
		).toBeTruthy();
	});

	it("does not submit a stale Controller draft after the Agent starts working", () => {
		const primaryBinding = createPrimaryBindingResponse(
			"codex:askForApproval",
			"builtin:codex"
		).binding as GetAgentProfilePrimaryBindingResponse["binding"];
		const editState = resolveAgentProfileEditState({
			binding: primaryBinding,
			modelCatalog: null,
		});
		const onControllerChange = vi.fn(() => Promise.resolve());
		const onRenameProfile = vi.fn(() => Promise.resolve());
		const renderDialog = (
			controllerChangeEligibilityStatus: "allowed" | "blocked"
		) => (
			<AgentProfileEditDialog
				controllerChangeEligibilityStatus={controllerChangeEligibilityStatus}
				controllerChangeOptions={[
					{
						agentControllerRef: "builtin:claude-code",
						label: "Claude Code",
					},
				]}
				editState={editState}
				isPending={false}
				modelCatalog={null}
				onControllerChange={onControllerChange}
				onControllerCollaborationModeUpdate={() => Promise.resolve()}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenChange={() => undefined}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={onRenameProfile}
				open={true}
				profileName="Research Agent"
			/>
		);
		const { rerender } = render(renderDialog("allowed"));

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Renamed Agent" },
		});
		fireEvent.click(
			screen.getByRole("combobox", { name: "Change controller" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Claude Code" }));
		rerender(renderDialog("blocked"));

		const saveButton = screen.getByRole("button", { name: "Save changes" });
		expect((saveButton as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(saveButton);
		expect(onControllerChange).not.toHaveBeenCalled();
		expect(onRenameProfile).not.toHaveBeenCalled();
	});

	it("uses account-wide RuntimeCoordinator truth to lock Controller changes from the Agents page", async () => {
		readControllerChangeEligibilityMock.mockImplementation(
			async ({ agentProfileId }) => ({
				agentProfileId,
				reasonCode:
					"agent_profile_binding.controller_change_blocked_active_execution" as const,
				status: "blocked" as const,
			})
		);
		renderAgentProfilesCard(
			{ selectedExecutionTarget: createSelectedExecutionTarget() },
			createPrimaryBindingResponse("codex:approveForMe").binding
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));

		await waitFor(() => {
			expect(
				(
					screen.getByRole("combobox", { name: "Change controller" }) as
						| HTMLButtonElement
						| HTMLInputElement
				).disabled
			).toBe(true);
		});
		expect(
			screen.getByText(
				"Controller changes are unavailable while this Agent is working because reconnecting would interrupt the current Wake."
			)
		).toBeTruthy();
		expect(
			(screen.getByRole("combobox", { name: "Model" }) as HTMLButtonElement)
				.disabled
		).toBe(false);
	});

	it("prevents unbinding a Controller from the Agents page while the Agent is working", async () => {
		readControllerChangeEligibilityMock.mockImplementation(
			async ({ agentProfileId }) => ({
				agentProfileId,
				reasonCode:
					"agent_profile_binding.controller_change_blocked_active_execution" as const,
				status: "blocked" as const,
			})
		);
		renderAgentProfilesCard(
			{ selectedExecutionTarget: createSelectedExecutionTarget() },
			createPrimaryBindingResponse("codex:approveForMe").binding
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);

		await waitFor(() =>
			expect(
				screen
					.getByRole("menuitem", { name: "Unbind controller" })
					.getAttribute("aria-disabled")
			).toBe("true")
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Unbind controller" })
		);
		expect(disablePrimaryBindingMock).not.toHaveBeenCalled();
		expect(screen.getByText("Agent is working")).toBeTruthy();
	});

	it("offers Agent editing for OpenCode model variants without a permissions mode", async () => {
		const openCodeBinding = createPrimaryBindingResponse(
			null,
			"builtin:opencode",
			{
				modelId: "opencode/north-mini-code-free",
			}
		).binding;
		readPrimaryBindingMock.mockImplementation(async () => ({
			binding: openCodeBinding,
			grantsClaimSuccess: false,
			status: "found",
		}));
		const { queryClient } = renderAgentProfilesCard({}, openCodeBinding);
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(await screen.findByRole("button", { name: "Edit Agent" }));
		expect(screen.getByRole("heading", { name: "Edit Agent" })).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "When Agent changes take effect",
			})
		).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
		expect(
			screen.queryByRole("combobox", { name: PERMISSIONS_MODE_NAME_PATTERN })
		).toBeNull();
		expect(
			screen.getByText(
				"Permission mode is not configurable for this controller."
			)
		).toBeTruthy();

		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(
			screen.getByRole("option", {
				name: "OpenCode DeepSeek V4 Flash Free",
			})
		);
		fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
		fireEvent.click(screen.getByRole("option", { name: "Max" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(updatePrimaryBindingModelSelectionMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentProfileId: AGENT_PROFILE_ID,
				modelId: "opencode/deepseek-v4-flash-free",
				organizationId: "org-acme",
				reasoningLevel: "max",
			});
		});
		expect(renameOpenMeldProfileMock).not.toHaveBeenCalled();
		expect(
			updatePrimaryBindingAgentControllerPermissionModeMock
		).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		expect(toastMock.success).toHaveBeenCalledWith("Agent settings saved.");
	});

	it("keeps saved OpenCode permissions after closing and reopening Agent settings", async () => {
		let currentOpenCodePermission: { edit: "allow" } | null = null;
		const createCurrentResponse = () =>
			createPrimaryBindingResponse(
				null,
				"builtin:opencode",
				{
					modelId: "opencode/north-mini-code-free",
				},
				null,
				currentOpenCodePermission
			);
		readPrimaryBindingMock.mockImplementation(async () =>
			createCurrentResponse()
		);
		updatePrimaryBindingOpenCodePermissionMock.mockImplementation((input) => {
			currentOpenCodePermission = input.openCodePermission;
			return Promise.resolve({
				...createCurrentResponse(),
				outcome: "reused",
				status: "accepted",
			});
		});
		renderAgentProfilesCard({}, createCurrentResponse().binding);

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		fireEvent.click(screen.getByRole("combobox", { name: "File changes" }));
		fireEvent.click(
			screen.getByRole("option", { name: "Allow without asking" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(updatePrimaryBindingOpenCodePermissionMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentProfileId: AGENT_PROFILE_ID,
				openCodePermission: { edit: "allow" },
				organizationId: "org-acme",
			});
			expect(screen.queryByRole("heading", { name: "Edit Agent" })).toBeNull();
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));

		expect(
			screen.getByRole("combobox", { name: "File changes" }).textContent
		).toContain("Allow without asking");
	});

	it("renames an Agent without sending unchanged binding fields", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		renderAgentProfilesCard({ refreshAll });

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Field Research Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(renameOpenMeldProfileMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				profileId: AGENT_PROFILE_ID,
				profileName: "Field Research Agent",
			});
		});
		expect(updatePrimaryBindingModelSelectionMock).not.toHaveBeenCalled();
		expect(
			updatePrimaryBindingAgentControllerPermissionModeMock
		).not.toHaveBeenCalled();
		expect(refreshAll).not.toHaveBeenCalled();
	});

	it("allows renaming an Agent that does not have a primary binding", async () => {
		renderAgentProfilesCard(
			{ agentExecutionReadinessByProfileId: new Map() },
			null
		);

		expect(
			await screen.findByText("Wake availability not checked yet")
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));

		expect(screen.getByText("Local agent binding")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect this Agent to a local tool before editing model, reasoning effort, permission mode, or controller."
			)
		).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Name"), {
			target: { value: "Unbound Research Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(renameOpenMeldProfileMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				profileId: AGENT_PROFILE_ID,
				profileName: "Unbound Research Agent",
			});
		});
		expect(updatePrimaryBindingModelSelectionMock).not.toHaveBeenCalled();
		expect(
			updatePrimaryBindingAgentControllerPermissionModeMock
		).not.toHaveBeenCalled();
	});

	it.each([
		"button",
		"context",
	])("confirms before unbinding a controller from the %s menu and shows the profile as unbound", async (entry) => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const { queryClient } = renderAgentProfilesCard({ refreshAll });
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		if (entry === "context") {
			fireEvent.contextMenu(screen.getByText("Research Agent"));
		} else {
			fireEvent.click(
				screen.getByRole("button", { name: "Agent options for Research Agent" })
			);
		}
		const unbindControllerButton = screen.getByRole("menuitem", {
			name: "Unbind controller",
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(unbindControllerButton.getAttribute("aria-disabled")).not.toBe(
				"true"
			);
		});
		fireEvent.click(unbindControllerButton);

		expect(
			await screen.findByRole("heading", { name: "Unbind controller?" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"Research Agent will not be able to run until you connect a local tool again. The Agent and its Space membership will stay in place."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Unbind controller" }));

		await waitFor(() => {
			expect(disablePrimaryBindingMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentProfileId: AGENT_PROFILE_ID,
				organizationId: "org-acme",
			});
		});
		expect(refreshReadinessFactsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: [AGENT_PROFILE_ID],
				storageScope: "test-scope",
			})
		);
		expect(refreshAll).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		await waitFor(() => {
			expect(screen.getByText("No local agent connected")).toBeTruthy();
		});
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();
		await waitFor(() => {
			expect(
				screen.queryByRole("heading", { name: "Unbind controller?" })
			).toBeNull();
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		expect(
			screen.queryByRole("menuitem", { name: "Unbind controller" })
		).toBeNull();
	});

	it("explains a server-rejected unbind when active work starts after the menu check", async () => {
		disablePrimaryBindingMock.mockResolvedValue({
			agentProfileId: AGENT_PROFILE_ID,
			disabled: false,
			reasonCodes: [
				"agent_profile_binding.controller_change_blocked_active_execution",
			],
			status: "unavailable",
		});
		renderAgentProfilesCard();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		const unbindControllerButton = screen.getByRole("menuitem", {
			name: "Unbind controller",
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(unbindControllerButton.disabled).toBe(false);
		});
		fireEvent.click(unbindControllerButton);
		fireEvent.click(screen.getByRole("button", { name: "Unbind controller" }));

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"This Agent is still working. Wait for the current Wake to finish before unbinding its Controller."
			);
		});
	});

	it("rebinds an Agent and switches the card icon", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		let currentBinding =
			createPrimaryBindingResponse("codex:approveForMe").binding;
		readPrimaryBindingMock.mockImplementation(async () => ({
			binding: currentBinding,
			grantsClaimSuccess: false,
			status: "found",
		}));
		ensureRuntimeBindingMock.mockImplementation((input) => {
			currentBinding = createPrimaryBindingResponse(
				input.agentControllerPermissionMode,
				input.agentControllerRef,
				input.modelId
					? {
							modelId: input.modelId,
							reasoningLevel: input.reasoningLevel,
						}
					: null
			).binding;
			return Promise.resolve({ status: "accepted" });
		});
		const { queryClient } = renderAgentProfilesCard(
			{
				refreshAll,
				selectedExecutionTarget: createSelectedExecutionTarget(),
			},
			currentBinding
		);
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		const controllerSelect = screen.getByRole("combobox", {
			name: "Change controller",
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(controllerSelect.disabled).toBe(false);
		});
		fireEvent.click(controllerSelect);
		fireEvent.click(screen.getByRole("option", { name: "Claude Code" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentControllerPermissionMode: "claude-code:default",
				agentControllerRef: "builtin:claude-code",
				agentProfileId: AGENT_PROFILE_ID,
				deviceId: "device-1",
				modelId: "claude-sonnet-4-5",
				openCodePermission: null,
				organizationId: "org-acme",
				reasoningLevel: null,
				runtimeLane: "dev-local",
				writeMode: "reconnect",
			});
		});
		expect(readPrimaryBindingMock).toHaveBeenCalled();
		expect(refreshReadinessFactsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: [AGENT_PROFILE_ID],
				storageScope: "test-scope",
			})
		);
		expect(refreshAll).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		await waitFor(() => {
			expect(screen.getByTestId("local-agent-logo-claude-code")).toBeTruthy();
		});
	});

	it("does not offer migration for old bindings in a selected Agent detail", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const codexProfile = createAgentProfile({
			openMeldProfileId: "agt-codex-old-runtime",
			profileName: "Codex Agent",
		});
		const claudeProfile = createAgentProfile({
			openMeldProfileId: "agt-claude-old-runtime",
			profileName: "Claude Agent",
		});
		const codexReadiness = createReconnectBindingReadiness(
			codexProfile.openMeldProfileId,
			"builtin:codex"
		);
		const claudeReadiness = createReconnectBindingReadiness(
			claudeProfile.openMeldProfileId,
			"builtin:claude-code"
		);
		readPrimaryBindingMock.mockImplementation(async (request) => ({
			binding:
				request.agentProfileId === claudeProfile.openMeldProfileId
					? claudeReadiness.primaryBinding
					: codexReadiness.primaryBinding,
			grantsClaimSuccess: false,
			status: "found",
		}));

		renderAgentProfilesCard(
			{
				currentLocalRuntimeReplyReadinessQuery: {
					data: { canReplyFromThisComputer: true },
					fetchStatus: "idle",
				} as RecoveryController["currentLocalRuntimeReplyReadinessQuery"],
				refreshAll,
				selectedExecutionTarget: createSelectedExecutionTarget(),
			},
			null,
			{
				agentExecutionReadinessByProfileId: new Map([
					[codexProfile.openMeldProfileId, codexReadiness],
					[claudeProfile.openMeldProfileId, claudeReadiness],
				]),
				agentProfiles: [codexProfile, claudeProfile],
				focusProfileId: codexProfile.openMeldProfileId,
				presentation: "detail",
			}
		);

		await screen.findByText("Codex Agent");
		expect(
			screen.queryByRole("region", { name: "Reconnect Agents" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Reconnect all" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Connect local agent" })
		).toBeNull();
		expect(ensureRuntimeBindingMock).not.toHaveBeenCalled();
	});

	it("keeps an accepted first connection saved when the follow-up status refresh fails", async () => {
		const profile = createAgentProfile({
			openMeldProfileId: AGENT_PROFILE_ID,
			profileName: "Codex Agent",
		});
		const readiness = createUnboundAgentReadiness();
		readPrimaryBindingMock.mockRejectedValueOnce(new Error("read unavailable"));

		renderAgentProfilesCard(
			{
				currentLocalRuntimeReplyReadinessQuery: {
					data: { canReplyFromThisComputer: true },
					fetchStatus: "idle",
				} as RecoveryController["currentLocalRuntimeReplyReadinessQuery"],
				refreshAll: vi.fn().mockResolvedValue(undefined),
				selectedExecutionTarget: createSelectedExecutionTarget(),
			},
			null,
			{
				agentExecutionReadinessByProfileId: new Map([
					[profile.openMeldProfileId, readiness],
				]),
				agentProfiles: [profile],
			}
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Connect local agent" })
		);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentProfileId: profile.openMeldProfileId,
					writeMode: "ensure",
				})
			);
			expect(toastMock.warning).toHaveBeenCalledWith(
				"Codex Agent was connected, but OpenMeld could not refresh its status. Refresh this page to check it again."
			);
			expect(toastMock.error).not.toHaveBeenCalled();
		});
	});

	it("resets reasoning effort when the selected model cannot keep the previous level", async () => {
		const openCodeBinding = createPrimaryBindingResponse(
			null,
			"builtin:opencode",
			{
				modelId: "opencode/north-mini-code-free",
				reasoningLevel: "high",
			}
		).binding;
		renderAgentProfilesCard({}, openCodeBinding);

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));
		fireEvent.click(screen.getByRole("combobox", { name: "Model" }));
		fireEvent.click(
			screen.getByRole("option", {
				name: "OpenCode Fast Reset",
			})
		);

		expect(
			screen.getByRole("combobox", { name: "Reasoning effort" }).textContent
		).toContain("Use model default");
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(updatePrimaryBindingModelSelectionMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentProfileId: AGENT_PROFILE_ID,
				modelId: "opencode/fast-reset",
				organizationId: "org-acme",
				reasoningLevel: null,
			});
		});
	});

	it("shows the current unavailable model without blocking other edits", async () => {
		const openCodeBinding = createPrimaryBindingResponse(
			null,
			"builtin:opencode",
			{
				modelId: "opencode/retired",
				reasoningLevel: "high",
			}
		).binding;
		renderAgentProfilesCard({}, openCodeBinding);

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit Agent" }));

		expect(
			screen.getAllByText("OpenCode Retired (unavailable)").length
		).toBeGreaterThan(0);
	});

	it("uses a neutral loading state before Wake availability is loaded", async () => {
		renderAgentProfilesCard({
			agentExecutionReadinessByProfileId: new Map(),
			agentExecutionReadinessPendingProfileIds: new Set([AGENT_PROFILE_ID]),
		});

		expect(
			(await screen.findAllByText("Loading Wake availability")).length
		).toBeGreaterThan(0);
		expect(screen.queryByText("Checking Wake availability")).toBeNull();
		expect(screen.queryByText("Checking")).toBeNull();
	});

	it("keeps the model hidden while the Agent configuration is still loading", () => {
		const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
		const readiness = {
			...createReadinessResponseWithPrimaryBinding(binding),
			primaryBinding: undefined,
			publicProfileConfiguration: undefined,
		} as unknown as GetAgentExecutionReadinessResponse;
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
				agentExecutionReadinessPendingProfileIds: new Set([AGENT_PROFILE_ID]),
			},
			null,
			{
				agentControllerRefByProfileId: new Map([
					[AGENT_PROFILE_ID, "builtin:codex"],
				]),
				presentation: "detail",
			}
		);
		expect(screen.getAllByLabelText("Loading model")).toHaveLength(2);
		expect(
			screen.queryByText("Codex · GPT-5.6 Sol · model default")
		).toBeNull();
	});

	it.each([
		"request_error",
		"unavailable",
		"missing",
	] as const)("handles %s settings reads with recovery only for failures", async (status) => {
		if (status === "request_error") {
			readPrimaryBindingMock.mockRejectedValue(
				new Error("Settings unavailable")
			);
		} else {
			// Core returns an unavailable projection when the Auth owner lookup fails.
			const reasonCodes = [
				status === "unavailable"
					? "agent_profile_binding.profile_owner_unavailable"
					: "agent_profile_binding.missing",
			];
			readPrimaryBindingMock.mockResolvedValue(
				getAgentProfilePrimaryBindingResponseSchema.parse({
					binding: {
						agentProfileId: AGENT_PROFILE_ID,
						authoritySource: "none",
						bindingState: "missing",
						dispatchEligibility: {
							reasonCodes,
							routable: false,
							status: "not_routable",
						},
						grantsClaimSuccess: false,
						reasonCodes,
						resolutionSource: "missing_projection",
						routable: false,
						executionTarget: null,
					},
					grantsClaimSuccess: false,
					status,
				})
			);
		}
		const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
		const readiness = {
			...createReadinessResponseWithPrimaryBinding(binding),
			primaryBinding: undefined,
			publicProfileConfiguration: undefined,
		} as unknown as GetAgentExecutionReadinessResponse;
		renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, readiness],
				]),
			},
			null,
			{
				agentControllerRefByProfileId: new Map([
					[AGENT_PROFILE_ID, "builtin:codex"],
				]),
				presentation: "detail",
			}
		);
		expect(
			(await screen.findAllByText("Model unavailable")).length
		).toBeGreaterThan(0);
		expect(screen.queryByText("GPT-5.6 Sol")).toBeNull();
		if (status === "missing") {
			expect(
				screen.queryByRole("button", { name: "Retry settings" })
			).toBeNull();
			expect(
				screen.queryByText("OpenMeld could not load this Agent’s settings.")
			).toBeNull();
			return;
		}
		expect(
			screen.getByText("OpenMeld could not load this Agent’s settings.")
		).toBeTruthy();
		readPrimaryBindingMock.mockResolvedValue(
			createPrimaryBindingResponse("codex:askForApproval")
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry settings" }));
		expect(
			await screen.findByRole("button", { name: "Edit Permissions" })
		).toBeTruthy();
		expect(
			screen.queryByText("OpenMeld could not load this Agent’s settings.")
		).toBeNull();
	});

	it("keeps self-healing readiness active without rendering controller UI", async () => {
		const { container, queryClient } = renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map(),
				currentLocalRuntimeReplyReadinessQuery: {
					data: { canReplyFromThisComputer: true },
					fetchStatus: "idle",
				} as RecoveryController["currentLocalRuntimeReplyReadinessQuery"],
			},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ presentation: "controller" }
		);

		expect(container.textContent).toBe("");
		await waitFor(() => {
			expect(refreshReadinessSharedCachesMock).toHaveBeenCalledWith({
				agentProfileIds: [AGENT_PROFILE_ID],
				includeLocalRuntimeCaches: false,
				organizationId: "org-acme",
				queryClient,
				storageScope: "test-scope",
			});
		});
	});

	it("shows a new Checking verdict instead of an older Available badge", () => {
		const availableReadiness =
			createWakeAvailabilityReadiness("available_for_wake");
		const { rerenderAgentProfilesCard } = renderAgentProfilesCard({
			agentExecutionReadinessByProfileId: new Map([
				[AGENT_PROFILE_ID, availableReadiness],
			]),
		});

		expect(
			document.querySelector('[data-availability-phase="available"]')
		).toBeTruthy();

		rerenderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[
						AGENT_PROFILE_ID,
						createWakeAvailabilityReadiness("checking_connection"),
					],
				]),
			},
			createPrimaryBindingResponse("codex:approveForMe").binding
		);
		expect(
			screen.getByTestId("agent-profile-execution-readiness").textContent
		).toContain("Checking ·");
		expect(
			document.querySelector('[data-availability-phase="available"]')
		).toBeNull();
	});

	it("hides owner labels by default for personal Agents", async () => {
		renderAgentProfilesCard();

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Felix" })).toBeNull();
	});

	it("shows owner labels only when grouped profile display is requested", async () => {
		renderAgentProfilesCard(
			{},
			createPrimaryBindingResponse("codex:approveForMe").binding,
			{ showOwnerGroups: true }
		);

		expect(await screen.findByRole("heading", { name: "Felix" })).toBeTruthy();
		expect(screen.getByText("1 Agent")).toBeTruthy();
	});

	it("lets an explicitly unbound Agent choose a local agent from the profile row", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		let resolveBinding!: (value: { status: "accepted" }) => void;
		ensureRuntimeBindingMock.mockReturnValueOnce(
			new Promise<{ status: "accepted" }>((resolve) => {
				resolveBinding = resolve;
			})
		);
		const { queryClient } = renderAgentProfilesCard(
			{
				agentExecutionReadinessByProfileId: new Map([
					[AGENT_PROFILE_ID, createUnboundAgentReadiness()],
				]),
				refreshAll,
				selectedExecutionTarget: createSelectedExecutionTarget(),
			},
			null
		);
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		expect(
			await screen.findByRole("combobox", { name: "Choose local agent" })
		).toBeTruthy();
		expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);

		fireEvent.click(
			screen.getByRole("button", { name: "Connect local agent" })
		);
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Connecting..." })
			).toBeTruthy();
		});
		expect(toastMock.success).not.toHaveBeenCalled();
		expect(toastMock.error).not.toHaveBeenCalled();

		resolveBinding({ status: "accepted" });

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith({
				actorProfileId: "human-1",
				agentControllerRef: "builtin:codex",
				agentProfileId: AGENT_PROFILE_ID,
				deviceId: "device-1",
				organizationId: "org-acme",
				runtimeLane: "dev-local",
				writeMode: "ensure",
			});
		});
		expect(readPrimaryBindingMock).toHaveBeenCalled();
		expect(refreshReadinessFactsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: [AGENT_PROFILE_ID],
				storageScope: "test-scope",
			})
		);
		expect(refreshAll).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			"Local agent connection saved for Research Agent. OpenMeld is checking whether it can reply from this computer."
		);
		expect(toastMock.error).not.toHaveBeenCalled();
	});

	it("does not expose cross-workspace Wake access controls or projections", async () => {
		renderAgentProfilesCard();

		await screen.findByText("Research Agent");
		expect(screen.queryByText(WAKE_ACCESS_LABEL_PATTERN)).toBeNull();
		expect(
			screen.queryByRole("switch", {
				name: ORGANIZATION_WAKE_ACCESS_SWITCH_PATTERN,
			})
		).toBeNull();
	});
});

function renderAgentProfilesCard(
	overrides: Partial<RecoveryController> = {},
	primaryBinding:
		| ReturnType<typeof createPrimaryBindingResponse>["binding"]
		| null = createPrimaryBindingResponse("codex:approveForMe").binding,
	cardOverrides: Partial<AgentProfilesCardProps> = {},
	organizationScope: ReturnType<
		typeof createOrganizationScope
	> = createOrganizationScope()
) {
	const queryClient = createTestQueryClient();
	const createTree = (
		nextOverrides: Partial<RecoveryController>,
		nextPrimaryBinding:
			| ReturnType<typeof createPrimaryBindingResponse>["binding"]
			| null
	) => (
		<TestQueryClientProvider queryClient={queryClient}>
			<AppOrganizationProvider scope={organizationScope}>
				<TooltipProvider>
					<AgentProfilesCard
						availabilityFilter="all"
						focusProfileId={null}
						isCurrentComputer={true}
						queryClient={queryClient}
						recovery={createRecovery(nextOverrides, nextPrimaryBinding)}
						serviceUpdatePath="/app/connect"
						setupPath="/app/connect"
						wakeAvailabilityNowMs={Date.now()}
						{...cardOverrides}
					/>
				</TooltipProvider>
			</AppOrganizationProvider>
		</TestQueryClientProvider>
	);
	const rendered = render(createTree(overrides, primaryBinding));
	return {
		container: rendered.container,
		queryClient,
		rerenderAgentProfilesCard: (
			nextOverrides: Partial<RecoveryController>,
			nextPrimaryBinding:
				| ReturnType<typeof createPrimaryBindingResponse>["binding"]
				| null
		) => rendered.rerender(createTree(nextOverrides, nextPrimaryBinding)),
	};
}

function PartialSaveInlineEditorHarness() {
	const [profileName, setProfileName] = useState("Research Agent");
	const primaryBinding = createPrimaryBindingResponse("codex:askForApproval")
		.binding as GetAgentProfilePrimaryBindingResponse["binding"];
	return (
		<TooltipProvider>
			<AgentProfileInlineEditor
				controllerChangeOptions={[]}
				editState={resolveAgentProfileEditState({
					binding: primaryBinding,
					modelCatalog: null,
				})}
				isPending={false}
				modelCatalog={null}
				onCancel={() => undefined}
				onControllerChange={() => Promise.resolve()}
				onControllerCollaborationModeUpdate={() =>
					Promise.reject(new Error("Collaboration Mode update failed"))
				}
				onControllerPermissionModeUpdate={() => Promise.resolve()}
				onModelSelectionUpdate={() => Promise.resolve()}
				onOpenCodePermissionUpdate={() => Promise.resolve()}
				onRenameProfile={(nextProfileName) => {
					setProfileName(nextProfileName);
					return Promise.resolve();
				}}
				profileName={profileName}
			/>
		</TooltipProvider>
	);
}

function createOrganizationScope(overrides: { isPersonal?: boolean } = {}) {
	const currentOrganization = {
		id: "org-acme",
		isPersonal: overrides.isPersonal ?? false,
		name: "Acme",
		slug: "acme",
	};
	return {
		access: "authorized" as const,
		account: {
			email: "mira@example.com",
			image: null,
			name: "Mira",
		},
		activeOrganization: currentOrganization,
		currentOrganization,
		currentUserId: "user-1",
		organizations: [currentOrganization],
		storageScope: "test-scope",
	};
}

function createRecovery(
	overrides: Partial<RecoveryController> = {},
	primaryBinding:
		| ReturnType<typeof createPrimaryBindingResponse>["binding"]
		| null = createPrimaryBindingResponse("codex:approveForMe").binding
): RecoveryController {
	return {
		agentExecutionReadinessByProfileId: primaryBinding
			? new Map([
					[
						AGENT_PROFILE_ID,
						createReadinessResponseWithPrimaryBinding(primaryBinding),
					],
				])
			: new Map(),
		agentExecutionReadinessErrorByProfileId: new Map(),
		agentExecutionReadinessPendingProfileIds: new Set<string>(),
		agentProfiles: [createAgentProfile()],
		agentProfilesQuery: { isError: false, isPending: false, isSuccess: true },
		currentDeviceTargetQuery: { data: null, fetchStatus: "idle" },
		currentLocalRuntimeReplyReadinessQuery: {
			data: null,
			fetchStatus: "idle",
		},
		deviceId: "device-1",
		localRuntimesQuery: { data: null, fetchStatus: "idle" },
		refreshAll: vi.fn(),
		runtimeLane: "dev-local",
		selectedExecutionTarget: null,
		selectedHumanProfileId: "human-1",
		storageScope: "test-scope",
		...overrides,
	} as unknown as RecoveryController;
}

function createAgentProfile(
	overrides: Partial<ReturnType<typeof createAgentProfileBase>> = {}
) {
	return {
		...createAgentProfileBase(),
		...overrides,
	};
}

function createAgentProfileBase() {
	return {
		openMeldProfileId: AGENT_PROFILE_ID,
		createdAt: "2026-06-18T00:00:00.000Z",
		createdByUserId: "user-1",
		creatorProfileId: "human-1",
		isDefault: false,
		lastUsedAt: null,
		managedRole: null as AuthProfileView["managedRole"],
		ownerName: "Felix",
		ownerUserId: "user-1",
		profileHandle: "research-agent",
		profileKind: "agent" as const,
		profileName: "Research Agent",
		source: "manual" as const,
		status: "active" as const,
		updatedAt: "2026-06-18T00:00:00.000Z",
	};
}

function createPrimaryBindingResponse(
	agentControllerPermissionMode: string | null,
	agentControllerRef = "builtin:codex",
	modelSelection: {
		modelId: string;
		reasoningLevel?: string | null;
	} | null = null,
	agentControllerCollaborationMode: string | null = agentControllerRef ===
	"builtin:codex"
		? "codex:default"
		: null,
	openCodePermission: { edit: "allow" } | null = null
) {
	return {
		binding: {
			agentControllerCollaborationMode,
			agentControllerPermissionMode,
			agentProfileId: AGENT_PROFILE_ID,
			authoritySource: "binding_truth",
			bindingId: "binding-codex",
			bindingState: "enabled_primary",
			dispatchEligibility: {
				reasonCodes: ["agent_profile_binding.enabled_primary"],
				routable: true,
				status: "routable",
			},
			executionTarget: {
				agentControllerRef,
				openMeldServiceRuntimeId: {
					source: "runtime_registry_authority",
					value: resolveRuntimeIdForAgentControllerRef(agentControllerRef),
				},
			},
			grantsClaimSuccess: false,
			...(openCodePermission ? { openCodePermission } : {}),
			...(modelSelection
				? {
						modelSelection: {
							modelId: modelSelection.modelId,
							...(modelSelection.reasoningLevel
								? { reasoningLevel: modelSelection.reasoningLevel }
								: {}),
						},
					}
				: {}),
			reasonCodes: ["agent_profile_binding.enabled_primary"],
			resolutionSource: "binding_truth",
			routable: true,
		},
		grantsClaimSuccess: false,
		status: "found",
	};
}

function createReconnectBindingReadiness(
	agentProfileId: string,
	agentControllerRef: string
): GetAgentExecutionReadinessResponse {
	const binding = {
		...createPrimaryBindingResponse(
			agentControllerRef === "builtin:codex" ? "codex:approveForMe" : null,
			agentControllerRef
		).binding,
		agentProfileId,
		bindingId: `binding-${agentProfileId}`,
	} as NonNullable<GetAgentExecutionReadinessResponse["primaryBinding"]>;
	const readiness = createReadinessResponseWithPrimaryBinding(
		binding as Parameters<typeof createReadinessResponseWithPrimaryBinding>[0]
	) as unknown as GetAgentExecutionReadinessResponse;
	return {
		...readiness,
		agentControllerRef,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			agentProfileId,
			facts: {
				...readiness.agentExecutionReadiness.facts,
				binding: {
					reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
					routable: false,
					source: "binding_truth",
				},
				localService: {
					reachable: true,
					reasonCodes: [],
					refreshable: true,
					source: "runtime_transport",
				},
			},
			primaryAction: "reconnect_binding",
			reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
		},
		agentProfileId,
		agentWakeAvailability: {
			...readiness.agentWakeAvailability,
			action: "reconnect_binding",
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			label: "Unavailable for Wake",
			phase: "unavailable",
			reasonCode: "claim_eligibility.binding_runtime_mismatch",
			status: "unavailable_for_wake",
		},
		primaryActionPlan: {
			action: "reconnect_binding",
			target: {
				agentControllerRef,
				kind: "local_agent_connection",
			},
		},
		primaryBinding: binding,
		runtimeDeviceDisplayName: "Felix's MacBook Pro",
	};
}

function createUnboundAgentReadiness(): GetAgentExecutionReadinessResponse {
	const readiness = createReconnectBindingReadiness(
		AGENT_PROFILE_ID,
		"builtin:codex"
	);
	return {
		...readiness,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			facts: {
				...readiness.agentExecutionReadiness.facts,
				binding: {
					reasonCodes: ["agent_profile_binding.missing"],
					routable: false,
					source: "missing",
				},
			},
			reasonCodes: ["agent_profile_binding.missing"],
		},
		agentWakeAvailability: {
			...readiness.agentWakeAvailability,
			reasonCode: "agent_profile_binding.missing",
		},
		primaryActionPlan: {
			action: "reconnect_binding",
			target: { kind: "choose_local_agent" },
		},
		primaryBinding: null,
		runtimeDeviceDisplayName: null,
	};
}

function createSelectedExecutionTarget() {
	return {
		localAgentCatalog: {
			entries: [
				{
					detected: true,
					agentId: "codex",
					displayName: "Codex CLI",
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					targetKind: "builtin",
				},
				{
					detected: true,
					agentId: "claude-code",
					displayName: "Claude Code",
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					targetKind: "builtin",
				},
			],
		},
		deviceId: "device-1",
		runtimeLane: "dev-local",
	} as unknown as NonNullable<RecoveryController["selectedExecutionTarget"]>;
}

function resolveRuntimeIdForAgentControllerRef(
	agentControllerRef: string
): string {
	if (agentControllerRef === "builtin:claude-code") {
		return "runtime-claude-code";
	}
	if (agentControllerRef === "builtin:opencode") {
		return "runtime-opencode";
	}
	return "runtime-codex";
}

function createEnsureBindingResponse(
	agentControllerPermissionMode: string | null,
	agentControllerRef = "builtin:codex",
	modelSelection: {
		modelId: string;
		reasoningLevel?: string | null;
	} | null = null,
	agentControllerCollaborationMode: string | null = agentControllerRef ===
	"builtin:codex"
		? "codex:default"
		: null,
	openCodePermission: { edit: "allow" } | null = null
) {
	return {
		binding: createPrimaryBindingResponse(
			agentControllerPermissionMode,
			agentControllerRef,
			modelSelection,
			agentControllerCollaborationMode,
			openCodePermission
		).binding,
		grantsClaimSuccess: false,
		outcome: "reused",
		reasonCodes: ["agent_profile_binding.enabled_primary"],
		routable: true,
		status: "accepted",
	};
}

function createReadinessResponseWithPrimaryBinding(
	primaryBinding: ReturnType<typeof createPrimaryBindingResponse>["binding"]
) {
	const agentExecutionReadiness = {
		agentProfileId: AGENT_PROFILE_ID,
		displayState: "not_ready",
		facts: {
			binding: {
				reasonCodes: ["agent_profile_binding.enabled_primary"],
				routable: true,
				source: "binding_truth",
			},
			claim: {
				executionBlocked: false,
				grantsClaimSuccess: false,
				reasonCodes: [],
				source: "claim_diagnostics",
			},
			localService: {
				reachable: false,
				reasonCodes: ["local_service.not_connected_for_account"],
				refreshable: false,
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
				provider: "codex",
				reasonCodes: [],
				source: "not_required",
			},
			providerConversation: {
				agentControllerConversationId: null,
				errorCode: null,
				errorMessage: null,
				errorType: null,
				expiresAtMs: null,
				method: null,
				observedAtMs: null,
				provider: "codex",
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
				source: "none",
			},
			route: {
				deviceId: null,
				lane: null,
				online: false,
				reasonCodes: ["agent_execution.route_offline"],
				source: "runtime_transport",
			},
			runtime: {
				ready: false,
				reasonCodes: [],
				source: "missing",
			},
			service: {
				executionCompatible: true,
				expectedEpoch: "",
				observedEpoch: null,
				reasonCodes: [],
				source: "not_checked",
			},
		},
		primaryAction: "connect_service",
		reasonCodes: ["local_service.not_connected_for_account"],
	};

	return {
		agentControllerRef:
			primaryBinding.executionTarget?.agentControllerRef ?? "builtin:codex",
		agentExecutionReadiness,
		agentProfileId: AGENT_PROFILE_ID,
		agentWakeAvailability: {
			action: "connect_service",
			badgeLabel: "Unavailable",
			category: "unavailable",
			isRefreshing: false,
			label: "Unavailable for Wake",
			phase: "service_not_connected",
			reasonCode: "local_service.not_connected_for_account",
			status: "unavailable_for_wake",
			summary: "Connect your computer before this Agent can reply.",
			tooltip: "Unavailable for Wake",
		},
		agentWakeRouteRegistration: {
			daemonSessionId: null,
			deviceId: null,
			lane: null,
			reasonCode: null,
			reportedAtMs: null,
			serviceVersion: null,
			status: "unavailable",
		},
		generatedAt: "2026-06-18T00:00:00.000Z",
		ownerUserId: "user-1",
		primaryActionPlan: { action: "connect_service", target: "service" },
		primaryBinding,
		profileName: "Research Agent",
		routeDeviceId: null,
		routeLane: null,
		runtimeDeviceDisplayName: null,
		wakeRouteStatus: {
			status: "offline",
		},
	};
}

function createWakeAvailabilityReadiness(
	status: "available_for_wake" | "checking_connection"
): GetAgentExecutionReadinessResponse {
	const binding = createPrimaryBindingResponse("codex:approveForMe").binding;
	const readiness = createReadinessResponseWithPrimaryBinding(
		binding
	) as unknown as GetAgentExecutionReadinessResponse;
	const available = status === "available_for_wake";
	return {
		...readiness,
		agentExecutionReadiness: {
			...readiness.agentExecutionReadiness,
			displayState: available ? "ready" : "not_ready",
			primaryAction: "none",
			reasonCodes: available ? [] : ["wake_route.registration_refreshing"],
		},
		agentWakeAvailability: {
			action: "none",
			badgeLabel: available ? "Available" : "Checking",
			category: available ? "available" : "checking",
			isRefreshing: !available,
			label: available ? "Available for Wake" : "Checking Wake availability",
			phase: available ? "available" : "checking_status",
			reasonCode: available
				? "agent_execution.ready"
				: "wake_route.registration_refreshing",
			status,
			summary: available
				? "This agent is ready to reply."
				: "OpenMeld is checking this Agent's connection.",
			tooltip: available ? "Available for Wake" : "Checking Wake availability",
		},
	};
}
