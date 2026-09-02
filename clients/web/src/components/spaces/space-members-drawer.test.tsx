import { getAgentProfilePrimaryBindingResponseSchema } from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	AuthProfileView,
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
import type { ComponentProps, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { agentProfilePrimaryBindingQueryKeys } from "#/query/profiles/primary-binding";
import { buildRemoteCenterAgentReadiness } from "#/test-support/center-agent-readiness";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";

const {
	navigateMock,
	openDirectMessageMock,
	readPrimaryBindingMock,
	toastMock,
	updatePrimaryBindingAgentControllerCollaborationModeMock,
} = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	openDirectMessageMock: vi.fn(),
	readPrimaryBindingMock: vi.fn(),
	toastMock: {
		error: vi.fn(),
		success: vi.fn(),
	},
	updatePrimaryBindingAgentControllerCollaborationModeMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

vi.mock("#/lib/spaces/direct-message", () => ({
	openCurrentDirectMessageSpace: (
		...args: Parameters<typeof openDirectMessageMock>
	) => openDirectMessageMock(...args),
	resolveDirectMessageOpenErrorMessage: () =>
		"OpenMeld could not open the Direct Message.",
}));

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock(
	"#/lib/profiles/agent-profile-primary-binding",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("#/lib/profiles/agent-profile-primary-binding")
			>();
		return {
			...actual,
			readAgentProfileControllerChangeEligibility: ({
				agentProfileId,
			}: {
				agentProfileId: string;
			}) =>
				Promise.resolve({
					agentProfileId,
					reasonCode:
						"agent_profile_binding.controller_change_allowed" as const,
					status: "allowed" as const,
				}),
			readAgentProfilePrimaryBinding: (
				...args: Parameters<typeof readPrimaryBindingMock>
			) => readPrimaryBindingMock(...args),
			updateAgentProfilePrimaryBindingAgentControllerCollaborationMode: (
				...args: Parameters<
					typeof updatePrimaryBindingAgentControllerCollaborationModeMock
				>
			) => updatePrimaryBindingAgentControllerCollaborationModeMock(...args),
		};
	}
);

import { SpaceAgentProfileEditProvider } from "./space-agent-profile-edit-context";
import {
	SpaceMembersSidePanel as ResizableSpaceMembersSidePanel,
	type SpaceAddProfilesResult,
	SpaceMembersDrawer,
	SpaceMembersToggleButton,
} from "./space-members-drawer";
import type { WakeDisplayOverrideByProfileId } from "./use-wake-display-debounce";

const EMPTY_SPACE_CTA_NAME = /It is just you here so far/;
const EXISTING_MESSAGES_AND_FILES_PATTERN = /existing messages and files/i;
const CANNOT_BE_UNDONE_PATTERN = /cannot be undone/i;
const DIRECT_MESSAGE_PATTERN = /Direct Message/;
const TEST_PANEL_WIDTH = "22rem";
const noopPanelWidthChange = () => undefined;

describe("SpaceMembersToggleButton", () => {
	it("shows the total member count in the header control", () => {
		const onOpenChange = vi.fn();
		render(
			<SpaceMembersToggleButton
				controlsId="space-members-panel"
				memberCount={5}
				onOpenChange={onOpenChange}
				open={false}
			/>
		);

		const button = screen.getByRole("button", {
			name: "Members, 5 total",
		});
		expect(button.textContent).toBe("5");
		const membersIcon = button.querySelector('[data-icon="users-three"]');
		expect(membersIcon).not.toBeNull();
		expect(membersIcon?.getAttribute("class")).toContain("size-4");

		fireEvent.click(button);
		expect(onOpenChange).toHaveBeenCalledWith(true);
	});
});

type TestSpaceMembersSidePanelProps = Omit<
	ComponentProps<typeof ResizableSpaceMembersSidePanel>,
	"onPanelWidthChange" | "panelWidth"
> &
	Partial<
		Pick<
			ComponentProps<typeof ResizableSpaceMembersSidePanel>,
			"onPanelWidthChange" | "panelWidth"
		>
	>;

function SpaceMembersSidePanel(input: TestSpaceMembersSidePanelProps) {
	const panel = (
		<ResizableSpaceMembersSidePanel
			{...input}
			onPanelWidthChange={input.onPanelWidthChange ?? noopPanelWidthChange}
			panelWidth={input.panelWidth ?? TEST_PANEL_WIDTH}
		/>
	);
	if (!input.agentProfileEditContext) {
		return panel;
	}
	return (
		<SpaceAgentProfileEditProvider
			accountProfiles={input.accountProfiles ?? []}
			context={input.agentProfileEditContext}
			currentOwnerUserId={input.currentOwnerUserId}
			modelCatalog={input.modelCatalog ?? null}
			organizationId={input.agentProfileEditContext.organizationId}
			orgSlug={input.orgSlug}
		>
			{panel}
		</SpaceAgentProfileEditProvider>
	);
}

function renderWithQueryClient(ui: ReactElement) {
	return render(<TestQueryClientProvider>{ui}</TestQueryClientProvider>);
}

import {
	SPACE_MEMBERS_LOAD_ERROR_MESSAGE,
	SPACE_MEMBERS_REFRESH_ERROR_MESSAGE,
} from "./space-members-error-copy";

describe("SpaceMembersSidePanel", () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		readPrimaryBindingMock.mockReset();
		toastMock.error.mockReset();
		toastMock.success.mockReset();
		updatePrimaryBindingAgentControllerCollaborationModeMock.mockReset();
	});

	it("toggles member search from the header and keeps the input bordered", async () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileName: "Felix",
							profileId: "11111111-1111-4111-8111-111111111111",
						}),
					],
				})}
			/>
		);

		const searchTrigger = screen.getByRole("button", {
			name: "Search members",
		});
		const heading = screen.getByRole("heading", { name: "Members" });
		const headerMainRow = heading.parentElement;
		const header = headerMainRow?.parentElement;
		const countDescription = screen.getByText("1 member in this space");
		expect(header?.tagName).toBe("HEADER");
		expect(header?.className).toContain("flex-col");
		expect(headerMainRow?.className).toContain("justify-between");
		expect(countDescription.parentElement).toBe(header);
		expect(countDescription.className).toContain("w-full");
		expect(searchTrigger.getAttribute("aria-expanded")).toBe("false");
		expect(searchTrigger.getAttribute("aria-controls")).toBe(
			"space-members-search-region"
		);
		expect(
			screen.queryByRole("textbox", { name: "Search members" })
		).toBeNull();

		fireEvent.click(searchTrigger);

		const searchInput = screen.getByRole("textbox", { name: "Search members" });
		expect(searchTrigger.getAttribute("aria-expanded")).toBe("true");
		expect(searchInput.className).toContain("border-input");
		expect(searchInput.className).not.toContain("border-transparent");

		fireEvent.change(searchInput, { target: { value: "felix" } });
		fireEvent.click(searchTrigger);

		await waitFor(() => {
			expect(
				screen.queryByRole("textbox", { name: "Search members" })
			).toBeNull();
		});
		expect(searchTrigger.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(searchTrigger);
		expect(
			(
				screen.getByRole("textbox", {
					name: "Search members",
				}) as HTMLInputElement
			).value
		).toBe("");
	});

	it("keeps showing the last loaded members when a refresh response is invalid", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError="invalid space members response"
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileName: "Felix",
							profileId: "11111111-1111-4111-8111-111111111111",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							profileName: "Codex Agent",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
						}),
					],
				})}
			/>
		);

		expect(screen.getByText(SPACE_MEMBERS_REFRESH_ERROR_MESSAGE)).toBeTruthy();
		expect(screen.getByText("Codex Agent")).toBeTruthy();
		expect(screen.getByText("Felix")).toBeTruthy();
		expect(screen.queryByText("invalid space members response")).toBeNull();
	});

	it("shows remove member actions only for non-creator members outside self", () => {
		const onRemoveMember = vi.fn(async () => ({
			alreadyAbsentCount: 0,
			removedCount: 1,
		}));

		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				onRemoveMember={onRemoveMember}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							memberSource: "space_creator",
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
						createSpaceMemberHumanSnapshot({
							memberSource: "added_by_member",
							ownerUserId: "user_mira",
							profileId: "22222222-2222-4222-8222-222222222222",
							profileName: "Mira",
						}),
					],
				})}
			/>
		);

		expect(
			screen.getByRole("button", { name: "Member options for Mira" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Member options for Felix" })
		).toBeNull();
	});

	it("opens the shared Agent Profile editor for an owned Agent member", async () => {
		const agentProfileId = "agt_22222222-2222-4222-8222-222222222222";
		const queryClient = createTestQueryClient();
		const primaryBindingResponse = createPrimaryBindingResponse(agentProfileId);
		readPrimaryBindingMock.mockResolvedValue(primaryBindingResponse);
		queryClient.setQueryData(
			agentProfilePrimaryBindingQueryKeys.profile("test-scope", agentProfileId),
			primaryBindingResponse
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<SpaceMembersSidePanel
					accountProfiles={[
						createAccountProfile({
							openMeldProfileId: agentProfileId,
							profileKind: "agent",
							profileName: "Research Agent",
						}),
					]}
					activeWakeWaitingTargetProfileIds={new Set()}
					agentProfileEditContext={{
						actorProfileId: "11111111-1111-4111-8111-111111111111",
						deviceId: "device-1",
						executionTarget: null,
						onSaved: async () => undefined,
						organizationId: "org-acme",
						runtimeLane: "dev-local",
						storageScope: "test-scope",
					}}
					agentRecoveryPlansByProfileId={new Map()}
					autoRefreshExhaustedProfileIds={new Set()}
					currentOwnerUserId="user_felix"
					currentProfileId="11111111-1111-4111-8111-111111111111"
					isAgentRecoveryPending={() => false}
					isLoading={false}
					membersError={null}
					onAgentRecoveryAction={async () => undefined}
					onOpenChange={vi.fn()}
					onRefresh={async () => undefined}
					open={true}
					orgSlug="acme"
					snapshot={createSpaceMembersSnapshot({
						agents: [
							createSpaceMemberAgentSnapshot({
								memberSource: "added_by_member",
								ownerUserId: "user_felix",
								profileId: agentProfileId,
								profileName: "Research Agent",
							}),
						],
						humans: [
							createSpaceMemberHumanSnapshot({
								ownerUserId: "user_felix",
								profileId: "11111111-1111-4111-8111-111111111111",
								profileName: "Felix",
							}),
						],
					})}
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Member options for Research Agent",
			})
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Check this Profile" })
		);

		expect(
			await screen.findByRole("heading", { name: "Check this Profile" })
		).toBeTruthy();
		expect(
			await screen.findByRole("button", { name: "Edit Collaboration" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Edit Permissions" })
		).toBeTruthy();
	});

	it("keeps a completed Agent Profile save successful when the Space refresh fails", async () => {
		const agentProfileId = "agt_22222222-2222-4222-8222-222222222222";
		const actorProfileId = "11111111-1111-4111-8111-111111111111";
		const queryClient = createTestQueryClient();
		const primaryBindingResponse = createPrimaryBindingResponse(agentProfileId);
		const onSaved = vi.fn(() =>
			Promise.reject(new Error("Space refresh failed"))
		);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		readPrimaryBindingMock.mockResolvedValue(primaryBindingResponse);
		updatePrimaryBindingAgentControllerCollaborationModeMock.mockResolvedValue({
			...primaryBindingResponse,
			binding: {
				...primaryBindingResponse.binding,
				agentControllerCollaborationMode: "codex:plan",
			},
			status: "accepted",
		});
		queryClient.setQueryData(
			agentProfilePrimaryBindingQueryKeys.profile("test-scope", agentProfileId),
			primaryBindingResponse
		);

		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<SpaceMembersSidePanel
					accountProfiles={[
						createAccountProfile({
							openMeldProfileId: agentProfileId,
							profileKind: "agent",
							profileName: "Research Agent",
						}),
					]}
					activeWakeWaitingTargetProfileIds={new Set()}
					agentProfileEditContext={{
						actorProfileId,
						deviceId: "device-1",
						executionTarget: null,
						onSaved,
						organizationId: "org-acme",
						runtimeLane: "dev-local",
						storageScope: "test-scope",
					}}
					agentRecoveryPlansByProfileId={new Map()}
					autoRefreshExhaustedProfileIds={new Set()}
					currentOwnerUserId="user_felix"
					currentProfileId={actorProfileId}
					isAgentRecoveryPending={() => false}
					isLoading={false}
					membersError={null}
					onAgentRecoveryAction={async () => undefined}
					onOpenChange={vi.fn()}
					onRefresh={async () => undefined}
					open={true}
					orgSlug="acme"
					snapshot={createSpaceMembersSnapshot({
						agents: [
							createSpaceMemberAgentSnapshot({
								memberSource: "added_by_member",
								ownerUserId: "user_felix",
								profileId: agentProfileId,
								profileName: "Research Agent",
							}),
						],
						humans: [
							createSpaceMemberHumanSnapshot({
								ownerUserId: "user_felix",
								profileId: actorProfileId,
								profileName: "Felix",
							}),
						],
					})}
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Member options for Research Agent",
			})
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Check this Profile" })
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Edit Collaboration" })
		);
		fireEvent.click(
			await screen.findByRole("combobox", {
				name: "Codex collaboration mode",
			})
		);
		fireEvent.click(screen.getByRole("option", { name: "Plan" }));
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => {
			expect(
				updatePrimaryBindingAgentControllerCollaborationModeMock
			).toHaveBeenCalledWith({
				actorProfileId,
				agentControllerCollaborationMode: "codex:plan",
				agentProfileId,
				organizationId: "org-acme",
			});
		});
		expect(onSaved).toHaveBeenCalledWith(agentProfileId);
		await waitFor(() => {
			expect(
				screen.queryByRole("combobox", { name: "Codex collaboration mode" })
			).toBeNull();
		});
		expect(
			screen.getByRole("heading", { name: "Check this Profile" })
		).toBeTruthy();
		expect(toastMock.error).toHaveBeenCalledWith(
			"The Agent was saved, but OpenMeld could not refresh the latest settings. Refresh the page to see them."
		);
		expect(consoleError).toHaveBeenCalledWith(
			"Agent Profile was saved, but current views could not be refreshed.",
			expect.any(Error)
		);
	});

	it("opens a Direct Message from the shared Agent Profile surface", async () => {
		const agentProfileId = "agt_22222222-2222-4222-8222-222222222222";
		readPrimaryBindingMock.mockResolvedValue(
			createPrimaryBindingResponse(agentProfileId)
		);
		openDirectMessageMock.mockResolvedValue({
			memberProfileId: agentProfileId,
			spaceId: "space-direct-message",
		});

		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: agentProfileId,
						profileKind: "agent",
						profileName: "Research Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentProfileEditContext={{
					actorProfileId: "human-1",
					deviceId: "device-1",
					executionTarget: null,
					onSaved: async () => undefined,
					organizationId: "org-acme",
					runtimeLane: "dev-local",
					storageScope: "test-scope",
				}}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="human-1"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							ownerUserId: "user_felix",
							profileId: agentProfileId,
							profileName: "Research Agent",
						}),
					],
				})}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Member options for Research Agent",
			})
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Check this Profile" })
		);
		fireEvent.click(
			await screen.findByRole("button", { name: DIRECT_MESSAGE_PATTERN })
		);

		await waitFor(() => {
			expect(openDirectMessageMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				targetProfileId: agentProfileId,
			});
		});
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/direct-messages/space-direct-message?profileId=agt_22222222-2222-4222-8222-222222222222",
		});
	});

	it("shows agent permissions mode to every Space member without exposing owner-only connection facts", async () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_viewer"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_viewer",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Viewer",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							agentControllerConversationId:
								"019f07bc-cda8-75e0-94d9-96c82f1333d4",
							agentControllerPermissionMode: "codex:approveForMe",
							ownerUserId: "user_agent_owner",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							profileName: "Codex Agent",
						}),
					],
				})}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Check Codex Agent Profile" })
		);

		expect(await screen.findByText("Permissions mode")).toBeTruthy();
		expect(screen.getByText("Approve for me")).toBeTruthy();
		expect(screen.queryByText("Controller conversation ID")).toBeNull();
		expect(
			screen.queryByText("019f07bc-cda8-75e0-94d9-96c82f1333d4")
		).toBeNull();
	});

	it("shows a blocking members error with a forced retry when no member snapshot has loaded", async () => {
		const onRefresh = vi.fn().mockResolvedValue(undefined);
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError="invalid space members response"
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={onRefresh}
				open={true}
				orgSlug="acme"
				snapshot={null}
			/>
		);

		expect(screen.getByText(SPACE_MEMBERS_LOAD_ERROR_MESSAGE)).toBeTruthy();
		expect(screen.queryByText("invalid space members response")).toBeNull();
		expect(screen.queryByText(SPACE_MEMBERS_REFRESH_ERROR_MESSAGE)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => {
			expect(onRefresh).toHaveBeenCalledWith({ forceNetwork: true });
		});
	});

	it("shows a visible error when the manual members refresh fails", async () => {
		const refreshError = new Error("network unavailable");
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const onRefresh = vi.fn().mockRejectedValue(refreshError);
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={onRefresh}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileName: "Felix",
							profileId: "11111111-1111-4111-8111-111111111111",
						}),
					],
				})}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Refresh members" }));

		await waitFor(() => {
			expect(onRefresh).toHaveBeenCalledWith({ forceNetwork: true });
		});
		expect(toastMock.error).toHaveBeenCalledWith(
			SPACE_MEMBERS_REFRESH_ERROR_MESSAGE
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"Failed to refresh members.",
			refreshError
		);
	});

	it("does not present an unloaded members snapshot as zero members", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={true}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={null}
			/>
		);

		expect(screen.getByText("Loading members")).toBeTruthy();
		expect(screen.queryByText("0 members in this space")).toBeNull();
	});

	it("does not let owner wake diagnostics pending override resolved AgentWakeAvailability", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={(profileId) =>
					profileId === "agt_22222222-2222-4222-8222-222222222222"
				}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileName: "Felix",
							profileId: "11111111-1111-4111-8111-111111111111",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							profileName: "Felix's Codex",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							agentWakeAvailability: { status: "available_for_wake" },
						}),
					],
				})}
			/>
		);

		const indicator = screen.getByTestId("space-agent-availability-indicator");
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Available");
		expect(indicator.getAttribute("title")).toBe("Available for Wake");
		expect(indicator.getAttribute("data-refreshing")).toBeNull();
		expect(screen.queryByText("Checking")).toBeNull();
		expect(
			screen.queryByText("OpenMeld is checking this agent's local connection.")
		).toBeNull();
	});

	it("orders agent profiles by availability before problems and offline entries", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							profileName: "A Offline Agent",
							profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
							agentWakeAvailability: { status: "offline_for_wake" },
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "B Unavailable Agent",
							profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
							agentWakeAvailability: { status: "unavailable_for_wake" },
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "C Available Agent",
							profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
							agentWakeAvailability: { status: "available_for_wake" },
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "D Checking Agent",
							profileId: "agt_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
							agentWakeAvailability: { status: "checking_connection" },
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "E Available Agent",
							profileId: "agt_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
							agentWakeAvailability: { status: "available_for_wake" },
						}),
						createSpaceMemberAgentSnapshot({
							profileName: "F Offline Agent",
							profileId: "agt_ffffffff-ffff-4fff-8fff-ffffffffffff",
							agentWakeAvailability: { status: "offline_for_wake" },
						}),
					],
				})}
			/>
		);

		const expectedOrder = [
			"C Available Agent",
			"E Available Agent",
			"B Unavailable Agent",
			"D Checking Agent",
			"A Offline Agent",
			"F Offline Agent",
		];
		expect(readTextOrder(getMembersSection("Agents"), expectedOrder)).toEqual(
			expectedOrder
		);
	});

	it("keeps live human profiles before inactive human profiles", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							liveNow: false,
							profileName: "A Away Human",
							profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						}),
						createSpaceMemberHumanSnapshot({
							liveNow: true,
							profileName: "B Live Human",
							profileId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
						}),
						createSpaceMemberHumanSnapshot({
							liveNow: false,
							profileName: "C Away Human",
							profileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
						}),
						createSpaceMemberHumanSnapshot({
							liveNow: true,
							profileName: "D Live Human",
							profileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
						}),
					],
				})}
			/>
		);

		const expectedOrder = [
			"B Live Human",
			"D Live Human",
			"A Away Human",
			"C Away Human",
		];
		expect(readTextOrder(getMembersSection("Humans"), expectedOrder)).toEqual(
			expectedOrder
		);
	});

	it("adds selectable account Agent Profiles without offering current or joined profiles", async () => {
		const onAddProfiles = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));

		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
						profileKind: "agent",
						profileName: "Joined Agent",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={onAddProfiles}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							ownerUserId: "user_felix",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							profileName: "Joined Agent",
						}),
					],
				})}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));

		expect(screen.queryByRole("checkbox", { name: "Felix" })).toBeNull();
		expect(screen.queryByRole("checkbox", { name: "Joined Agent" })).toBeNull();

		fireEvent.click(screen.getByRole("checkbox", { name: "Codex Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(() => {
			expect(onAddProfiles).toHaveBeenCalledWith([
				"agt_33333333-3333-4333-8333-333333333333",
			]);
		});
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add members" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		await waitFor(() => {
			expect(
				screen.queryByText("Choose profiles to add to this Space.")
			).toBeNull();
		});
	});

	it("adds Human Profiles from the explicit Humans mode", async () => {
		const onAddProfiles = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));

		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "22222222-2222-4222-8222-222222222222",
						profileKind: "human",
						profileName: "QA Human",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={onAddProfiles}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
				})}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));

		const humansGroup = screen.getByRole("group", { name: "Humans" });
		expect(
			within(humansGroup).queryByRole("checkbox", { name: "Codex Agent" })
		).toBeNull();
		fireEvent.click(
			within(humansGroup).getByRole("checkbox", { name: "QA Human" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(() => {
			expect(onAddProfiles).toHaveBeenCalledWith([
				"22222222-2222-4222-8222-222222222222",
			]);
		});
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add members" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
	});

	it("adds Organization Directory members and agents in one atomic request", async () => {
		const centerAgentProfileId = "agt_44444444-4444-4444-8444-444444444444";
		const humanProfileId = "22222222-2222-4222-8222-222222222222";
		const onAddOrganizationDirectoryProfiles = vi
			.fn<
				(input: {
					directoryProfileIds: readonly string[];
					expectedCenterAgentProfileId?: string;
				}) => Promise<SpaceAddProfilesResult>
			>()
			.mockRejectedValueOnce(new Error("Directory changed. Try again."))
			.mockResolvedValueOnce({ addedCount: 2, alreadyMemberCount: 0 });

		renderWithOrganizationQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddOrganizationDirectoryProfiles={onAddOrganizationDirectoryProfiles}
				onAddProfiles={vi.fn()}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
				})}
			/>,
			buildOrganizationDirectory({ centerAgentProfileId, humanProfileId })
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		expect(
			screen.getByText("Choose people and agents from Acme.")
		).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: "Felix" })).toBeNull();
		expect(
			screen.queryByRole("checkbox", { name: "Disabled Agent" })
		).toBeNull();
		expect(
			screen.queryByRole("checkbox", { name: "Personal Center Agent" })
		).toBeNull();

		const searchInput = screen.getByRole("searchbox", {
			name: "Search members and agents",
		});
		expect(screen.queryByText("mira@example.com")).toBeNull();
		fireEvent.change(searchInput, { target: { value: "mira@example.com" } });
		expect(screen.queryByRole("checkbox", { name: "Mira" })).toBeNull();
		fireEvent.change(searchInput, { target: { value: "mira" } });
		expect(screen.getByRole("checkbox", { name: "Mira" })).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: "Center Agent" })).toBeNull();
		fireEvent.change(searchInput, { target: { value: "" } });

		const membersGroup = screen.getByRole("group", { name: "Members" });
		const agentsGroup = screen.getByRole("group", { name: "Agents" });
		fireEvent.click(
			within(membersGroup).getByRole("checkbox", { name: "Mira" })
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Center Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 2 members" }));

		await waitFor(() => {
			expect(onAddOrganizationDirectoryProfiles).toHaveBeenCalledWith({
				directoryProfileIds: [humanProfileId, centerAgentProfileId],
				expectedCenterAgentProfileId: centerAgentProfileId,
			});
		});
		expect(screen.getByText("Directory changed. Try again.")).toBeTruthy();
		expect(screen.getByText("2 selected")).toBeTruthy();
		expect(
			within(agentsGroup).getByRole("checkbox", { name: "Center Agent" })
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Add 2 members" }));

		await waitFor(() => {
			expect(onAddOrganizationDirectoryProfiles).toHaveBeenCalledTimes(2);
		});
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add members" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		await waitFor(() => {
			expect(screen.queryByText("Select members to add")).toBeNull();
		});
	});

	it("closes Add members when the server confirms the selection is already present", async () => {
		const onAddProfiles = vi.fn(async () => ({
			addedCount: 0,
			alreadyMemberCount: 1,
		}));

		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={onAddProfiles}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
				})}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Codex Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add members" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		await waitFor(() => {
			expect(
				screen.queryByText("That member is already in this Space.")
			).toBeNull();
		});
	});

	it("requires explicit confirmation before adding a third profile to a Direct Message", async () => {
		const onAddProfiles = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));
		const onConvertDirectMessageToSpace = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));
		const candidateProfileId = "agt_33333333-3333-4333-8333-333333333333";

		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "22222222-2222-4222-8222-222222222222",
						profileKind: "human",
						profileName: "Mira",
					}),
					createAccountProfile({
						openMeldProfileId: candidateProfileId,
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={onAddProfiles}
				onAgentRecoveryAction={async () => undefined}
				onConvertDirectMessageToSpace={onConvertDirectMessageToSpace}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_mira",
							profileId: "22222222-2222-4222-8222-222222222222",
							profileName: "Mira",
						}),
					],
				})}
				spaceName="Felix and Mira"
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Codex Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		expect(
			screen.getByRole("heading", {
				name: "Turn this Direct Message into a Space?",
			})
		).toBeTruthy();
		expect(screen.getByText(EXISTING_MESSAGES_AND_FILES_PATTERN)).toBeTruthy();
		expect(screen.getByText(CANNOT_BE_UNDONE_PATTERN)).toBeTruthy();
		expect(onAddProfiles).not.toHaveBeenCalled();
		expect(onConvertDirectMessageToSpace).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(
			screen.queryByRole("heading", {
				name: "Turn this Direct Message into a Space?",
			})
		).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));
		fireEvent.change(screen.getByRole("textbox", { name: "Space name" }), {
			target: { value: "Launch Team" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Turn into a Space" }));

		await waitFor(() => {
			expect(onConvertDirectMessageToSpace).toHaveBeenCalledWith({
				name: "Launch Team",
				profileIds: [candidateProfileId],
			});
		});
		expect(onAddProfiles).not.toHaveBeenCalled();
	});

	it("cancels a Direct Message conversion confirmation when the active Space changes", () => {
		const onConvertDirectMessageToSpace = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));
		const candidateProfileId = "agt_33333333-3333-4333-8333-333333333333";
		const commonProps = {
			accountProfiles: [
				createAccountProfile({
					openMeldProfileId: "11111111-1111-4111-8111-111111111111",
					profileKind: "human" as const,
					profileName: "Felix",
				}),
				createAccountProfile({
					openMeldProfileId: "22222222-2222-4222-8222-222222222222",
					profileKind: "human" as const,
					profileName: "Mira",
				}),
				createAccountProfile({
					openMeldProfileId: candidateProfileId,
					profileKind: "agent" as const,
					profileName: "Codex Agent",
				}),
			],
			activeWakeWaitingTargetProfileIds: new Set<string>(),
			agentRecoveryPlansByProfileId: new Map(),
			autoRefreshExhaustedProfileIds: new Set<string>(),
			currentOwnerUserId: "user_felix",
			currentProfileId: "11111111-1111-4111-8111-111111111111",
			isAgentRecoveryPending: () => false,
			isLoading: false,
			membersError: null,
			onAddProfiles: vi.fn(async () => ({
				addedCount: 1,
				alreadyMemberCount: 0,
			})),
			onAgentRecoveryAction: async () => undefined,
			onConvertDirectMessageToSpace,
			onOpenChange: vi.fn(),
			onRefresh: async () => undefined,
			open: true,
			orgSlug: "acme",
			snapshot: createSpaceMembersSnapshot({
				humans: [
					createSpaceMemberHumanSnapshot({
						ownerUserId: "user_felix",
						profileId: "11111111-1111-4111-8111-111111111111",
						profileName: "Felix",
					}),
					createSpaceMemberHumanSnapshot({
						ownerUserId: "user_mira",
						profileId: "22222222-2222-4222-8222-222222222222",
						profileName: "Mira",
					}),
				],
			}),
			spaceName: "Felix and Mira",
		};
		const { rerender } = render(
			<TestQueryClientProvider>
				<SpaceMembersSidePanel {...commonProps} spaceId="space_a" />
			</TestQueryClientProvider>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Codex Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));
		expect(
			screen.getByRole("heading", {
				name: "Turn this Direct Message into a Space?",
			})
		).toBeTruthy();

		rerender(
			<TestQueryClientProvider>
				<SpaceMembersSidePanel {...commonProps} spaceId="space_b" />
			</TestQueryClientProvider>
		);

		expect(
			screen.queryByRole("heading", {
				name: "Turn this Direct Message into a Space?",
			})
		).toBeNull();
		expect(onConvertDirectMessageToSpace).not.toHaveBeenCalled();
	});

	it("requires the same Direct Message conversion confirmation in the narrow-screen drawer", () => {
		const onAddProfiles = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));
		const onConvertDirectMessageToSpace = vi.fn(async () => ({
			addedCount: 1,
			alreadyMemberCount: 0,
		}));
		const candidateProfileId = "agt_33333333-3333-4333-8333-333333333333";

		renderWithQueryClient(
			<SpaceMembersDrawer
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "22222222-2222-4222-8222-222222222222",
						profileKind: "human",
						profileName: "Mira",
					}),
					createAccountProfile({
						openMeldProfileId: candidateProfileId,
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={onAddProfiles}
				onAgentRecoveryAction={async () => undefined}
				onConvertDirectMessageToSpace={onConvertDirectMessageToSpace}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_mira",
							profileId: "22222222-2222-4222-8222-222222222222",
							profileName: "Mira",
						}),
					],
				})}
				spaceName="Felix and Mira"
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Codex Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		expect(
			screen.getByRole("heading", {
				name: "Turn this Direct Message into a Space?",
			})
		).toBeTruthy();
		expect(onAddProfiles).not.toHaveBeenCalled();
		expect(onConvertDirectMessageToSpace).not.toHaveBeenCalled();
	});

	it("distinguishes all joined profiles from no matching profiles", () => {
		const commonProps = {
			activeWakeWaitingTargetProfileIds: new Set<string>(),
			agentRecoveryPlansByProfileId: new Map(),
			autoRefreshExhaustedProfileIds: new Set<string>(),
			currentOwnerUserId: "user_felix",
			currentProfileId: "11111111-1111-4111-8111-111111111111",
			isAgentRecoveryPending: () => false,
			isLoading: false,
			membersError: null,
			onAddProfiles: vi.fn(async () => ({
				addedCount: 0,
				alreadyMemberCount: 0,
			})),
			onAgentRecoveryAction: async () => undefined,
			onOpenChange: vi.fn(),
			onRefresh: async () => undefined,
			open: true,
		};

		const { unmount } = renderWithQueryClient(
			<SpaceMembersSidePanel
				orgSlug="acme"
				{...commonProps}
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
						profileKind: "agent",
						profileName: "Joined Agent",
					}),
				]}
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							ownerUserId: "user_felix",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							profileName: "Joined Agent",
						}),
					],
				})}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		expect(
			screen.getByText("All eligible profiles are already in this Space.")
		).toBeTruthy();
		unmount();

		renderWithQueryClient(
			<SpaceMembersSidePanel
				orgSlug="acme"
				{...commonProps}
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
				]}
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
					agents: [],
				})}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Add members" }));
		expect(
			screen.getByText("No matching profiles are available to add.")
		).toBeTruthy();
	});

	it("groups selectable candidates under Agents and Humans", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "22222222-2222-4222-8222-222222222222",
						profileKind: "human",
						profileName: "QA Human",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={vi.fn(async () => ({
					addedCount: 1,
					alreadyMemberCount: 0,
				}))}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
					agents: [],
				})}
			/>
		);

		const trigger = screen.getByRole("button", { name: "Add members" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");

		const region = document.getElementById("space-add-members-region");
		expect(region).toBeTruthy();
		expect(region?.className).toContain("rounded-lg");
		expect(region?.className).toContain("bg-card");
		expect(trigger.getAttribute("aria-controls")).toBe(
			"space-add-members-region"
		);
		const scope = within(region as HTMLElement);

		const agentsGroup = scope.getByRole("group", { name: "Agents" });
		const humansGroup = scope.getByRole("group", { name: "Humans" });
		expect(
			within(agentsGroup).getByRole("checkbox", { name: "Codex Agent" })
		).toBeTruthy();
		expect(
			within(humansGroup).getByRole("checkbox", { name: "QA Human" })
		).toBeTruthy();
		expect(
			within(agentsGroup).queryByRole("checkbox", { name: "QA Human" })
		).toBeNull();

		const codexCheckbox = within(agentsGroup).getByRole("checkbox", {
			name: "Codex Agent",
		});
		codexCheckbox.focus();
		fireEvent.keyDown(codexCheckbox, { key: " " });
		expect(codexCheckbox.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText("1 selected")).toBeTruthy();
	});

	it("offers an empty-space call to action that opens Add members", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={vi.fn(async () => ({
					addedCount: 1,
					alreadyMemberCount: 0,
				}))}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
					agents: [],
				})}
				spaceId="space-1"
				spaceName="Test Space"
			/>
		);

		const emptyCta = screen.getByRole("button", {
			name: EMPTY_SPACE_CTA_NAME,
		});
		fireEvent.click(emptyCta);

		expect(
			screen
				.getByRole("button", { name: "Add members" })
				.getAttribute("aria-expanded")
		).toBe("true");
		expect(screen.getByRole("heading", { name: "Add members" })).toBeTruthy();
		const addMembersHeading = screen.getByRole("heading", {
			name: "Add members",
		});
		const addMembersDescription = screen.getByText(
			"Choose profiles to add to this Space."
		);
		const createProfileButton = screen.getByRole("button", {
			name: "Create Agent",
		});
		expect(addMembersDescription.parentElement).toBe(
			addMembersHeading.parentElement?.parentElement
		);
		expect(createProfileButton.className).toContain("w-full");
		expect(createProfileButton.className).toContain("@min-[20rem]:w-auto");
		const footerLabel = screen.getByText("Select members to add");
		const footer = footerLabel.parentElement;
		expect(footer?.className).toContain("flex-col");
		expect(footer?.className).toContain("@min-[20rem]:flex-row");
		expect(
			screen.getByRole("button", { name: "Add selected" }).className
		).toContain("flex-1");
		expect(
			screen.getAllByRole("button", { name: "Create Agent" })
		).toHaveLength(1);
		expect(
			screen.queryByRole("button", { name: EMPTY_SPACE_CTA_NAME })
		).toBeNull();
	});

	it("closes the Add members panel with Escape and returns focus to the trigger", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				accountProfiles={[
					createAccountProfile({
						openMeldProfileId: "11111111-1111-4111-8111-111111111111",
						profileKind: "human",
						profileName: "Felix",
					}),
					createAccountProfile({
						openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
						profileKind: "agent",
						profileName: "Codex Agent",
					}),
				]}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAddProfiles={vi.fn(async () => ({
					addedCount: 1,
					alreadyMemberCount: 0,
				}))}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							ownerUserId: "user_felix",
							profileId: "11111111-1111-4111-8111-111111111111",
							profileName: "Felix",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							ownerUserId: "user_felix",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							profileName: "Joined Agent",
						}),
					],
				})}
			/>
		);

		const trigger = screen.getByRole("button", { name: "Add members" });
		fireEvent.click(trigger);
		const region = document.getElementById("space-add-members-region");
		expect(region).toBeTruthy();

		fireEvent.keyDown(region as HTMLElement, { key: "Escape" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(document.activeElement).toBe(trigger);
	});
});

function getMembersSection(title: string): HTMLElement {
	const panel = document.getElementById("space-members-panel");
	if (!panel) {
		throw new Error("Members panel was not rendered.");
	}
	const heading = within(panel as HTMLElement).getByRole("heading", {
		name: title,
	});
	const section = heading.closest("section");
	if (!section) {
		throw new Error(`Members section was not rendered: ${title}`);
	}
	return section as HTMLElement;
}

function readTextOrder(
	scope: HTMLElement,
	expectedTexts: readonly string[]
): readonly string[] {
	const textContent = scope.textContent ?? "";
	return expectedTexts
		.map((expectedText) => {
			const index = textContent.indexOf(expectedText);
			if (index === -1) {
				throw new Error(`Expected text was not rendered: ${expectedText}`);
			}
			return { expectedText, index };
		})
		.sort((left, right) => left.index - right.index)
		.map(({ expectedText }) => expectedText);
}

function createPrimaryBindingResponse(agentProfileId: string) {
	return getAgentProfilePrimaryBindingResponseSchema.parse({
		binding: {
			agentControllerCollaborationMode: "codex:default",
			agentControllerPermissionMode: "codex:approveForMe",
			agentProfileId,
			authoritySource: "binding_truth",
			bindingId: "binding-codex",
			bindingState: "enabled_primary",
			dispatchEligibility: {
				reasonCodes: ["agent_profile_binding.enabled_primary"],
				routable: true,
				status: "routable",
			},
			executionTarget: {
				agentControllerRef: "builtin:codex",
				openMeldServiceRuntimeId: {
					source: "runtime_registry_authority",
					value: "runtime-codex",
				},
			},
			grantsClaimSuccess: false,
			reasonCodes: ["agent_profile_binding.enabled_primary"],
			resolutionSource: "binding_truth",
			routable: true,
		},
		grantsClaimSuccess: false,
		status: "found",
	});
}

function createAccountProfile(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		openMeldProfileId:
			overrides.openMeldProfileId ?? "11111111-1111-4111-8111-111111111111",
		createdAt: overrides.createdAt ?? "2026-05-07T00:00:00.000Z",
		createdByUserId: overrides.createdByUserId ?? "user_felix",
		creatorProfileId: overrides.creatorProfileId ?? null,
		isDefault: overrides.isDefault ?? false,
		lastUsedAt: overrides.lastUsedAt ?? null,
		managedRole: overrides.managedRole ?? null,
		ownerName: overrides.ownerName ?? "Felix",
		ownerUserId: overrides.ownerUserId ?? "user_felix",
		profileHandle: overrides.profileHandle ?? "felix",
		profileKind: overrides.profileKind ?? "human",
		profileName: overrides.profileName ?? "Felix",
		source: overrides.source ?? "user",
		status: overrides.status ?? "active",
		updatedAt: overrides.updatedAt ?? "2026-05-07T00:00:00.000Z",
	};
}

function renderWithOrganizationQueryClient(
	ui: ReactElement,
	directory: OrganizationDirectoryResponse
) {
	const queryClient = createTestQueryClient();
	queryClient.setQueryData(
		organizationQueryKeys.directory("org-acme"),
		directory
	);
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AppOrganizationProvider scope={createOrganizationScope()}>
				{ui}
			</AppOrganizationProvider>
		</TestQueryClientProvider>
	);
}

function createOrganizationScope(): OrganizationScopeAuthorized {
	const currentOrganization = {
		id: "org-acme",
		isPersonal: false,
		name: "Acme",
		slug: "acme",
	};
	return {
		access: "authorized",
		account: {
			email: "felix@example.com",
			image: null,
			name: "Felix",
		},
		activeOrganization: currentOrganization,
		currentOrganization,
		currentUserId: "user-felix",
		organizations: [currentOrganization],
		storageScope: "user-felix",
	};
}

function buildOrganizationDirectory(input: {
	centerAgentProfileId: string;
	humanProfileId: string;
}): OrganizationDirectoryResponse {
	return {
		agentProfiles: [
			{
				createdAt: "2026-07-14T00:00:00.000Z",
				createdByUserId: "user_felix",
				creatorProfileId: null,
				isCenterAgent: true,
				isDefault: false,
				lastUsedAt: null,
				managedRole: "center_agent",
				organizationId: "org-acme",
				ownerName: "Felix",
				ownerUserId: "user_felix",
				profileHandle: "center-agent",
				profileId: input.centerAgentProfileId,
				profileKind: "agent",
				profileName: "Center Agent",
				readiness: buildRemoteCenterAgentReadiness("available", {
					agentProfileId: input.centerAgentProfileId,
				}),
				source: "managed",
				status: "active",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
			{
				createdAt: "2026-07-14T00:00:00.000Z",
				createdByUserId: "user_mira",
				creatorProfileId: null,
				isDefault: false,
				lastUsedAt: null,
				managedRole: null,
				organizationId: "org-acme",
				ownerName: "Mira",
				ownerUserId: "user_mira",
				profileHandle: "disabled-agent",
				profileId: "agt_55555555-5555-4555-8555-555555555555",
				profileKind: "agent",
				profileName: "Disabled Agent",
				readiness: buildRemoteCenterAgentReadiness("available", {
					agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
				}),
				source: "user",
				status: "disabled",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
			{
				createdAt: "2026-07-14T00:00:00.000Z",
				createdByUserId: "user_felix",
				creatorProfileId: null,
				isCenterAgent: false,
				isDefault: false,
				lastUsedAt: null,
				managedRole: "center_agent",
				organizationId: "org-personal",
				ownerName: "Felix",
				ownerUserId: "user_felix",
				profileHandle: "personal-center-agent",
				profileId: "agt_66666666-6666-4666-8666-666666666666",
				profileKind: "agent",
				profileName: "Personal Center Agent",
				readiness: buildRemoteCenterAgentReadiness("available", {
					agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
				}),
				source: "managed",
				status: "active",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
		],
		generatedAt: "2026-07-14T00:00:00.000Z",
		members: [
			{
				humanProfile: {
					lastUsedAt: "2026-07-14T00:00:00.000Z",
					profileHandle: "felix",
					profileId: "11111111-1111-4111-8111-111111111111",
					profileName: "Felix",
					status: "active",
				},
				joinedAt: "2026-07-14T00:00:00.000Z",
				memberId: "member-felix",
				organizationId: "org-acme",
				role: "owner",
				user: {
					email: "felix@example.com",
					id: "user_felix",
					image: null,
					name: "Felix",
				},
				userId: "user_felix",
			},
			{
				humanProfile: {
					lastUsedAt: "2026-07-14T00:00:00.000Z",
					profileHandle: "mira",
					profileId: input.humanProfileId,
					profileName: "Mira",
					status: "active",
				},
				joinedAt: "2026-07-14T00:00:00.000Z",
				memberId: "member-mira",
				organizationId: "org-acme",
				role: "member",
				user: {
					email: "mira@example.com",
					id: "user_mira",
					image: null,
					name: "Mira",
				},
				userId: "user_mira",
			},
		],
		organizationId: "org-acme",
	};
}

describe("SpaceMembersSidePanel Wake display-debounce override", () => {
	afterEach(() => {
		cleanup();
	});

	const AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
	const availableSnapshot = createSpaceMemberAgentSnapshot({
		agentWakeAvailability: { status: "available_for_wake" },
	}).agentWakeAvailability;

	function renderCheckingAgent(
		displayWakeOverrideByProfileId?: WakeDisplayOverrideByProfileId
	) {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				displayWakeOverrideByProfileId={displayWakeOverrideByProfileId}
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							agentWakeAvailability: { status: "checking_connection" },
							ownerUserId: "user_felix",
							profileId: AGENT_PROFILE_ID,
							profileName: "Felix's Codex",
						}),
					],
				})}
			/>
		);
	}

	it("smooths a Checking row to Available when an override snapshot is present", () => {
		if (!availableSnapshot) {
			throw new Error("fixture setup failed");
		}
		renderCheckingAgent(new Map([[AGENT_PROFILE_ID, availableSnapshot]]));

		const indicator = screen.getByTestId("space-agent-availability-indicator");
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Available");
		expect(indicator.getAttribute("title")).toBe("Available for Wake");
		expect(indicator.getAttribute("data-refreshing")).toBeNull();
		expect(
			screen.queryByText("OpenMeld is checking this agent's local connection.")
		).toBeNull();
	});

	it("shows the real Checking state when no override is present", () => {
		renderCheckingAgent(undefined);

		const indicator = screen.getByTestId("space-agent-availability-indicator");
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Checking");
		expect(indicator.getAttribute("title")).toBe("Checking Wake availability");
	});

	it("shows active Wake progress over a hard unavailable availability row", () => {
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeDisplayTargetProfileIds={new Set([AGENT_PROFILE_ID])}
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							agentWakeAvailability: { status: "unavailable_for_wake" },
							ownerUserId: "user_felix",
							profileId: AGENT_PROFILE_ID,
							profileName: "Felix's Codex",
						}),
					],
				})}
			/>
		);

		const indicator = screen.getByTestId("space-agent-availability-indicator");
		expect(indicator.textContent).toBe("");
		expect(indicator.getAttribute("aria-label")).toBe("Working");
		expect(indicator.getAttribute("title")).toBe("Wake in progress");
		expect(indicator.getAttribute("data-refreshing")).toBe("true");
		expect(screen.queryByText("Connect local agent")).toBeNull();
		expect(
			screen.getByText("This agent is working on a Wake in this Space.")
		).toBeTruthy();
	});

	it("keeps Profile Details on the raw Checking snapshot while the indicator is smoothed to Available (M1)", async () => {
		if (!availableSnapshot) {
			throw new Error("fixture setup failed");
		}
		renderCheckingAgent(new Map([[AGENT_PROFILE_ID, availableSnapshot]]));

		// Indicator is smoothed to Available (display-only).
		expect(
			screen
				.getByTestId("space-agent-availability-indicator")
				.getAttribute("aria-label")
		).toBe("Available");

		// Opening Profile Details must surface the RAW Checking Wake availability,
		// never the replayed Available snapshot (Codex M1 leak guard).
		fireEvent.click(
			screen.getByRole("button", { name: "Check Felix's Codex Profile" })
		);
		expect(await screen.findByText("Checking")).toBeTruthy();
		expect(screen.queryByText("Available for Wake")).toBeNull();
	});
});
