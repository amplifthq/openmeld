import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	GetAgentProfilePrimaryBindingResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { resolveAgentProfileEditState } from "./agent-profile-edit-state";
import {
	AgentProfileEditDialog,
	AgentProfilesCard,
} from "./agents-page-agent-profiles-card";

const AGENT_PROFILE_ID = "agt-codex";
const CREATE_AN_AGENT_PROFILE_NAME = /Create an Agent/;
const PERMISSIONS_MODE_NAME_PATTERN = /permissions mode/i;

const ensureRuntimeBindingMock = vi.hoisted(() => vi.fn());
const disablePrimaryBindingMock = vi.hoisted(() => vi.fn());
const readPrimaryBindingMock = vi.hoisted(() => vi.fn());
const readControllerChangeEligibilityMock = vi.hoisted(() => vi.fn());
const refreshReadinessFactsMock = vi.hoisted(() => vi.fn());
const refreshReadinessSharedCachesMock = vi.hoisted(() => vi.fn());
const renameOpenMeldProfileMock = vi.hoisted(() => vi.fn());
const deleteStartAgentProfileMock = vi.hoisted(() => vi.fn());
const listOrganizationBindingAuthorizationProfilesMock = vi.hoisted(() =>
	vi.fn()
);
const authorizeAgentProfileBindingForCurrentOrganizationMock = vi.hoisted(() =>
	vi.fn()
);
const revokeAgentProfileBindingForCurrentOrganizationMock = vi.hoisted(() =>
	vi.fn()
);
const listCurrentUserAgentProfileOrganizationWakeAccessMock = vi.hoisted(() =>
	vi.fn()
);
const updatePrimaryBindingAgentControllerPermissionModeMock = vi.hoisted(() =>
	vi.fn()
);
const updatePrimaryBindingAgentControllerCollaborationModeMock = vi.hoisted(
	() => vi.fn()
);
const updatePrimaryBindingModelSelectionMock = vi.hoisted(() => vi.fn());
const updatePrimaryBindingOpenCodePermissionMock = vi.hoisted(() => vi.fn());
const openCurrentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const readCurrentAgentActivitySessionsMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() =>
	Object.assign(vi.fn(), {
		error: vi.fn(),
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
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/lib/profiles/agent-profile-primary-binding", () => ({
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
}));

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

vi.mock("#/lib/spaces/direct-message", () => ({
	openCurrentDirectMessageSpace: (
		...args: Parameters<typeof openCurrentDirectMessageSpaceMock>
	) => openCurrentDirectMessageSpaceMock(...args),
	resolveDirectMessageOpenErrorMessage: () =>
		"OpenMeld could not open this Direct Message.",
}));

vi.mock("#/lib/profiles/organization-binding-authorizations", () => ({
	authorizeAgentProfileBindingForCurrentOrganization: (
		...args: Parameters<
			typeof authorizeAgentProfileBindingForCurrentOrganizationMock
		>
	) => authorizeAgentProfileBindingForCurrentOrganizationMock(...args),
	listCurrentUserAgentProfileOrganizationWakeAccess: (
		...args: Parameters<
			typeof listCurrentUserAgentProfileOrganizationWakeAccessMock
		>
	) => listCurrentUserAgentProfileOrganizationWakeAccessMock(...args),
	listOrganizationBindingAuthorizationProfiles: (
		...args: Parameters<typeof listOrganizationBindingAuthorizationProfilesMock>
	) => listOrganizationBindingAuthorizationProfilesMock(...args),
	revokeAgentProfileBindingForCurrentOrganization: (
		...args: Parameters<
			typeof revokeAgentProfileBindingForCurrentOrganizationMock
		>
	) => revokeAgentProfileBindingForCurrentOrganizationMock(...args),
}));

vi.mock("#/query/agents/execution-readiness", () => ({
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
		listOrganizationBindingAuthorizationProfilesMock
			.mockReset()
			.mockResolvedValue({ organizationId: "org-acme", profiles: [] });
		authorizeAgentProfileBindingForCurrentOrganizationMock.mockReset();
		revokeAgentProfileBindingForCurrentOrganizationMock.mockReset();
		listCurrentUserAgentProfileOrganizationWakeAccessMock
			.mockReset()
			.mockResolvedValue({ profiles: [] });
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
		toastMock.success.mockReset();
		toastMock.warning.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it("shows Agent Controller Permission Mode on the card and profile details", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "About profile" }));

		expect(screen.getByText("Agent Controller Permission Mode")).toBeTruthy();
		expect(screen.getByText("Permissions mode")).toBeTruthy();
		expect(screen.getAllByText("Approve for me").length).toBeGreaterThan(0);
	});

	it("shows the current native Session title and links back to Agent Activity", async () => {
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
		renderAgentProfilesCard({}, primaryBinding);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		fireEvent.click(screen.getByRole("button", { name: "About profile" }));

		expect(
			await screen.findByText("Ship the Agent Profile upgrade")
		).toBeTruthy();
		const sessionLink = screen.getByRole("link", { name: "View Session" });
		expect(sessionLink.getAttribute("href")).toBe(
			"/o/acme/agent-activity/sessions?query=native-session-1"
		);
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

	it("places Direct Message and Edit Agent as icon actions outside the dropdown menu", async () => {
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
		expect(await screen.findByText("Direct Message")).toBeTruthy();
		fireEvent.mouseLeave(directMessageButton);
		await waitFor(() => {
			expect(screen.queryByText("Direct Message")).toBeNull();
		});
		fireEvent.mouseEnter(editButton);
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
		expect(screen.getByRole("button", { name: "About profile" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Default Project and folder" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Unbind controller" })
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Remove profile" })).toBeTruthy();
		expect(screen.queryByText("Direct Message")).toBeNull();
		expect(screen.queryByText("Edit Agent")).toBeNull();
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
		fireEvent.click(screen.getByRole("button", { name: "Remove profile" }));
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
				queryClient,
				storageScope: "test-scope",
			});
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
		fireEvent.click(screen.getByRole("button", { name: "Remove profile" }));
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
				to: "/o/acme/direct-messages/space-research-agent-dm?profileId=profile-felix",
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
			screen.queryByRole("button", { name: "Default Project and folder" })
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
		expect(screen.getByRole("heading", { name: "Edit Agent" })).toBeTruthy();
		expect(screen.getByText("Codex permissions mode")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex permissions mode" })
		);
		fireEvent.click(screen.getByRole("option", { name: "Full access" }));

		const saveButton = screen.getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(saveButton.disabled).toBe(true);
		fireEvent.click(
			screen.getByLabelText(
				"I understand this permissions mode can run with dangerous full access."
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
			});
		});
		expect(refreshAll).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
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
		fireEvent.click(screen.getByRole("option", { name: "Full access" }));
		fireEvent.click(
			screen.getByLabelText(
				"I understand this permissions mode can run with dangerous full access."
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

	it("updates Codex Collaboration Mode without changing Permission Mode", async () => {
		let currentCollaborationMode = "codex:default";
		readPrimaryBindingMock.mockImplementation(async () =>
			createPrimaryBindingResponse(
				"codex:askForApproval",
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
						"codex:askForApproval",
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
				"codex:askForApproval",
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

	it("refreshes completed Agent changes when a later field fails to save", async () => {
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
			expect(onRenameProfile).toHaveBeenCalledWith("Renamed Research Agent");
			expect(onControllerCollaborationModeUpdate).toHaveBeenCalledWith(
				"codex:plan"
			);
			expect(onSaveComplete).toHaveBeenCalledTimes(1);
		});
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to update Agent Profile.",
			expect.any(Error)
		);
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

		await waitFor(() => {
			expect(
				(
					screen.getByRole("button", { name: "Unbind controller" }) as
						| HTMLButtonElement
						| HTMLInputElement
				).disabled
			).toBe(true);
		});
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
				reasoningLevel: "max",
			});
		});
		expect(renameOpenMeldProfileMock).not.toHaveBeenCalled();
		expect(
			updatePrimaryBindingAgentControllerPermissionModeMock
		).not.toHaveBeenCalled();
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			"Settings saved for Research Agent. This computer must sync the changes before new work starts. Work already running keeps its current settings."
		);
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
		expect(refreshAll).toHaveBeenCalled();
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

	it("confirms before unbinding a controller and shows the profile as unbound", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const { queryClient } = renderAgentProfilesCard({ refreshAll });
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		expect(await screen.findByText("Research Agent")).toBeTruthy();
		expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		const unbindControllerButton = screen.getByRole("button", {
			name: "Unbind controller",
		}) as HTMLButtonElement;
		await waitFor(() => {
			expect(unbindControllerButton.disabled).toBe(false);
		});
		fireEvent.click(unbindControllerButton);

		expect(
			screen.getByRole("heading", { name: "Unbind controller?" })
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
			});
		});
		expect(refreshReadinessFactsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentProfileIds: [AGENT_PROFILE_ID],
				storageScope: "test-scope",
			})
		);
		expect(refreshAll).toHaveBeenCalled();
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		await waitFor(() => {
			expect(screen.getByText("No local agent connected")).toBeTruthy();
		});
		expect(screen.queryByTestId("local-agent-logo-codex")).toBeNull();

		fireEvent.click(
			screen.getByRole("button", {
				name: "Agent options for Research Agent",
			})
		);
		expect(
			screen.queryByRole("button", { name: "Unbind controller" })
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
		const unbindControllerButton = screen.getByRole("button", {
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
		expect(refreshAll).toHaveBeenCalled();
		expect(invalidateQueriesSpy).toHaveBeenCalledWith({
			queryKey: organizationQueryKeys.all,
		});
		await waitFor(() => {
			expect(screen.getByTestId("local-agent-logo-claude-code")).toBeTruthy();
		});
	});

	it("reconnects all eligible Agents after one explicit confirmation", async () => {
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
			}
		);

		expect(
			(
				await screen.findByRole("region", {
					name: "Reconnect Agents",
				})
			).textContent
		).toContain("Reconnect 2 Agents");
		fireEvent.click(screen.getByRole("button", { name: "Reconnect all" }));
		expect(
			screen.getByRole("heading", { name: "Reconnect 2 Agents?" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reconnect Agents" }));

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledTimes(2);
		});
		expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentControllerRef: "builtin:codex",
				agentProfileId: codexProfile.openMeldProfileId,
				writeMode: "reconnect",
			})
		);
		expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentControllerRef: "builtin:claude-code",
				agentProfileId: claudeProfile.openMeldProfileId,
				writeMode: "reconnect",
			})
		);
		await waitFor(() => {
			expect(refreshReadinessFactsMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentProfileIds: expect.arrayContaining([
						codexProfile.openMeldProfileId,
						claudeProfile.openMeldProfileId,
					]),
				})
			);
			expect(refreshAll).toHaveBeenCalledTimes(1);
			expect(toastMock.success).toHaveBeenCalledWith(
				"Reconnected 2 Agents to this computer. OpenMeld is checking whether they can reply."
			);
		});
	});

	it("keeps an accepted reconnect saved when the follow-up status refresh fails", async () => {
		const profile = createAgentProfile({
			openMeldProfileId: "agt-codex-old-runtime",
			profileName: "Codex Agent",
		});
		const readiness = createReconnectBindingReadiness(
			profile.openMeldProfileId,
			"builtin:codex"
		);
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
			await screen.findByRole("button", { name: "Reconnect to Codex CLI" })
		);

		await waitFor(() => {
			expect(ensureRuntimeBindingMock).toHaveBeenCalledWith(
				expect.objectContaining({
					agentProfileId: profile.openMeldProfileId,
					writeMode: "reconnect",
				})
			);
			expect(toastMock.warning).toHaveBeenCalledWith(
				"Codex Agent was reconnected, but OpenMeld could not refresh its status. Refresh this page to check it again."
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

	it("keeps a recently Available Agent visually stable during a brief connection check", async () => {
		const availableReadiness =
			createWakeAvailabilityReadiness("available_for_wake");
		const { rerenderAgentProfilesCard } = renderAgentProfilesCard({
			agentExecutionReadinessByProfileId: new Map([
				[AGENT_PROFILE_ID, availableReadiness],
			]),
		});

		expect((await screen.findAllByText("Available")).length).toBeGreaterThan(0);

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

		expect(screen.queryByText("Checking")).toBeNull();
		expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
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

	it("lets an unchecked Agent choose a local agent from the profile row", async () => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		let resolveBinding!: (value: { status: "accepted" }) => void;
		ensureRuntimeBindingMock.mockReturnValueOnce(
			new Promise<{ status: "accepted" }>((resolve) => {
				resolveBinding = resolve;
			})
		);
		const { queryClient } = renderAgentProfilesCard({
			agentExecutionReadinessByProfileId: new Map(),
			refreshAll,
			selectedExecutionTarget: createSelectedExecutionTarget(),
		});
		const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

		expect(
			await screen.findByText("Wake availability not checked yet")
		).toBeTruthy();
		expect(
			screen.getByRole("combobox", { name: "Choose local agent" })
		).toBeTruthy();
		expect(screen.getAllByText("Codex CLI").length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "Connect" }));
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
		expect(refreshAll).toHaveBeenCalled();
		await waitFor(() => {
			expect(invalidateQueriesSpy).toHaveBeenCalledWith({
				queryKey: organizationQueryKeys.all,
			});
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			"Local agent connection saved for Research Agent. OpenMeld is checking whether it can reply from this computer."
		);
		expect(toastMock.error).not.toHaveBeenCalled();
	});

	it("shows and toggles the Organization Wake Access switch for a caller-owned bound Agent", async () => {
		listOrganizationBindingAuthorizationProfilesMock.mockResolvedValue({
			organizationId: "org-acme",
			profiles: [
				{
					agentProfileId: AGENT_PROFILE_ID,
					authorized: false,
					authorizedAt: null,
					authorizedBy: null,
					bindingId: "binding-1",
					ownerUserId: "user-1",
					profileHandle: "research-agent",
					profileName: "Research Agent",
					profileOrganizationId: "org-acme",
					status: "not_authorized",
				},
			],
		});
		authorizeAgentProfileBindingForCurrentOrganizationMock.mockResolvedValue({
			agentProfileId: AGENT_PROFILE_ID,
			authorized: true,
			bindingId: "binding-1",
		});
		renderAgentProfilesCard();

		const toggle = await screen.findByRole("switch", {
			name: "Authorize Research Agent for this organization's Wake access",
		});
		expect(toggle.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(toggle);

		await waitFor(() => {
			expect(
				authorizeAgentProfileBindingForCurrentOrganizationMock
			).toHaveBeenCalledWith({
				agentProfileId: AGENT_PROFILE_ID,
				organizationId: "org-acme",
			});
		});
	});

	it("hides the Organization Wake Access switch for an Agent the caller cannot manage", async () => {
		listOrganizationBindingAuthorizationProfilesMock.mockResolvedValue({
			organizationId: "org-acme",
			profiles: [
				{
					agentProfileId: AGENT_PROFILE_ID,
					authorized: false,
					authorizedAt: null,
					authorizedBy: null,
					bindingId: "binding-1",
					ownerUserId: "user-2",
					profileHandle: "research-agent",
					profileName: "Research Agent",
					profileOrganizationId: "org-acme",
					status: "not_authorized",
				},
			],
		});
		renderAgentProfilesCard({}, undefined, {
			canManageProfile: () => false,
		});

		await screen.findByText("Research Agent");
		expect(
			screen.queryByRole("switch", {
				name: "Authorize Research Agent for this organization's Wake access",
			})
		).toBeNull();
	});

	it("shows which Organizations a personal-view Agent's Binding is shared with", async () => {
		listCurrentUserAgentProfileOrganizationWakeAccessMock.mockResolvedValue({
			profiles: [
				{
					agentProfileId: AGENT_PROFILE_ID,
					organizations: [
						{ organizationId: "org-widgets", organizationName: "Widgets Inc" },
					],
				},
			],
		});
		renderAgentProfilesCard(
			{},
			undefined,
			{},
			createOrganizationScope({ isPersonal: true })
		);

		expect(await screen.findByText("Wake access: Widgets Inc")).toBeTruthy();
		expect(
			listOrganizationBindingAuthorizationProfilesMock
		).not.toHaveBeenCalled();
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
						{...cardOverrides}
					/>
				</TooltipProvider>
			</AppOrganizationProvider>
		</TestQueryClientProvider>
	);
	const rendered = render(createTree(overrides, primaryBinding));
	return {
		queryClient,
		rerenderAgentProfilesCard: (
			nextOverrides: Partial<RecoveryController>,
			nextPrimaryBinding:
				| ReturnType<typeof createPrimaryBindingResponse>["binding"]
				| null
		) => rendered.rerender(createTree(nextOverrides, nextPrimaryBinding)),
	};
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
			summary: "This agent cannot reply from this computer right now.",
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
