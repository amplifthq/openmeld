import { getAgentProfilePrimaryBindingResponseSchema } from "@openmeld/schemas";
import {
	createSpaceMemberAgentSnapshot,
	createSpaceMemberHumanSnapshot,
	createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type {
	AuthProfileView,
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
	within,
} from "@testing-library/react";
import type { ComponentProps, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import { readCurrentOrganizationProfileDirectory } from "#/lib/organizations/organization-directory";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { agentProfilePrimaryBindingQueryKeys } from "#/query/profiles/primary-binding";
import { spaceQueryKeys } from "#/query/spaces/status";
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
		loading: vi.fn(),
		dismiss: vi.fn(),
	},
	updatePrimaryBindingAgentControllerCollaborationModeMock: vi.fn(),
}));

// These cases cover direct adds; the MemberAgent request path has its own
// tests in agent-access.test.tsx.
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => false,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	Link: ({ to, ...props }: ComponentProps<"a"> & { to: string }) => (
		<a {...props} href={to} />
	),
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
	"#/lib/organizations/organization-directory",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/organizations/organization-directory")
		>()),
		readCurrentOrganizationProfileDirectory: vi.fn(),
	})
);

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
const CONNECTED_TO_PATTERN = /Connected to/;
const OWNED_BY_MIRA_PATTERN = /Owned by Mira/;
const TEST_PANEL_WIDTH = "22rem";
const noopPanelWidthChange = () => undefined;

describe("SpaceMembersToggleButton", () => {
	it("keeps the Members control available before the count is confirmed", () => {
		const onOpenChange = vi.fn();
		render(
			<SpaceMembersToggleButton
				controlsId="space-members-drawer"
				memberCount={null}
				onOpenChange={onOpenChange}
				open={false}
			/>
		);

		const button = screen.getByRole("button", { name: "Members" });
		expect(button.textContent).toBe("");
		fireEvent.click(button);
		expect(onOpenChange).toHaveBeenCalledWith(true);
	});

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
	const queryClient = createTestQueryClient();
	queryClient.setQueryData(
		spaceQueryKeys.status("space-1", "11111111-1111-4111-8111-111111111111"),
		{ ownerUserIds: ["user_felix"] }
	);
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			{ui}
		</TestQueryClientProvider>
	);
}

import { SpaceAddMembersLauncher } from "./space-members-drawer";
import {
	SPACE_MEMBERS_LOAD_ERROR_MESSAGE,
	SPACE_MEMBERS_REFRESH_ERROR_MESSAGE,
} from "./space-members-error-copy";

describe("SpaceMembersSidePanel", () => {
	it("shows cached identities without member actions until fresh members replace them, and hides them on failure", () => {
		const client = createTestQueryClient();
		const profileId = "11111111-1111-4111-8111-111111111111";
		client.setQueryData(
			spaceQueryKeys.memberDirectoryDisplay("space-1", profileId),
			{
				version: 1,
				members: [
					{
						profileId: "cached-agent",
						profileName: "Cached agent",
						profileKind: "agent",
						primaryMentionLabel: "Cached agent",
						avatarUrl: null,
						agentControllerRef: null,
					},
				],
			}
		);
		const props: TestSpaceMembersSidePanelProps = {
			activeWakeWaitingTargetProfileIds: new Set(),
			agentRecoveryPlansByProfileId: new Map(),
			autoRefreshExhaustedProfileIds: new Set(),
			currentOwnerUserId: "user_felix",
			currentProfileId: profileId,
			isAgentRecoveryPending: () => false,
			isLoading: true,
			membersError: null,
			onAgentRecoveryAction: async () => undefined,
			onRefresh: async () => undefined,
			onOpenChange: vi.fn(),
			open: true,
			orgSlug: "acme",
			snapshot: null,
			spaceId: "space-1",
		};
		const panel = (overrides: Partial<TestSpaceMembersSidePanelProps> = {}) => (
			<TestQueryClientProvider queryClient={client}>
				<SpaceMembersSidePanel {...props} {...overrides} />
			</TestQueryClientProvider>
		);
		const view = render(panel());
		expect(screen.getByText("Cached agent")).toBeTruthy();
		expect(screen.getByRole("status").textContent).toBe("Updating members…");
		expect(
			screen.queryByTestId("space-agent-availability-indicator")
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Check Cached agent Profile" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Add People or Agents" })
		).toBeNull();

		view.rerender(
			panel({
				isLoading: false,
				snapshot: createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							profileId,
							profileName: "Current member",
						}),
					],
				}),
			})
		);
		expect(screen.queryByText("Cached agent")).toBeNull();
		expect(screen.getByText("Current member")).toBeTruthy();

		view.rerender(panel({ membersError: SPACE_MEMBERS_LOAD_ERROR_MESSAGE }));
		expect(screen.queryByText("Cached agent")).toBeNull();
		expect(screen.getByText(SPACE_MEMBERS_LOAD_ERROR_MESSAGE)).toBeTruthy();
		view.rerender(panel({ currentProfileId: "different-profile" }));
		expect(screen.queryByText("Cached agent")).toBeNull();
	});

	it("reuses fresh candidates and preserves selection through a failed stale refresh and retry", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
		const directory = buildOrganizationDirectory({
			centerAgentProfileId: "agt_44444444-4444-4444-8444-444444444444",
			humanProfileId: "22222222-2222-4222-8222-222222222222",
		});
		let rejectRefresh: (reason: Error) => void = () => undefined;
		const profileDirectory = toProfileDirectory(directory);
		let resolveRetry: (value: OrganizationProfileDirectoryResponse) => void =
			() => undefined;
		const pending = new Promise<OrganizationProfileDirectoryResponse>(
			(_resolve, reject) => {
				rejectRefresh = reject;
			}
		);
		const retry = new Promise<OrganizationProfileDirectoryResponse>(
			(resolve) => {
				resolveRetry = resolve;
			}
		);
		const read = vi
			.mocked(readCurrentOrganizationProfileDirectory)
			.mockReturnValueOnce(pending)
			.mockReturnValueOnce(retry);
		const client = createTestQueryClient();
		client.setQueryData(
			organizationQueryKeys.profileDirectory("org-acme"),
			profileDirectory
		);
		const surface = (nonce: number) => (
			<TestQueryClientProvider queryClient={client}>
				<AppOrganizationProvider scope={createOrganizationScope()}>
					<SpaceAddMembersLauncher
						activeWakeWaitingTargetProfileIds={new Set()}
						agentRecoveryPlansByProfileId={new Map()}
						autoRefreshExhaustedProfileIds={new Set()}
						currentOwnerUserId="user_felix"
						currentProfileId="11111111-1111-4111-8111-111111111111"
						isAgentRecoveryPending={() => false}
						isLoading={false}
						membersError={null}
						onAddOrganizationDirectoryProfiles={vi.fn()}
						onAgentRecoveryAction={async () => undefined}
						onRefresh={async () => undefined}
						openAddMembersNonce={nonce}
						orgSlug="acme"
						snapshot={createSpaceMembersSnapshot()}
					/>
				</AppOrganizationProvider>
			</TestQueryClientProvider>
		);
		const view = render(surface(0));
		view.rerender(surface(1));
		await screen.findByRole("checkbox", { name: "Mira" });
		fireEvent.click(screen.getByText("Close"));
		view.rerender(surface(2));
		await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByText("Close"));
		view.rerender(surface(3));
		const choice = screen.getByRole("checkbox", { name: "Mira" });
		fireEvent.click(choice);
		expect(read).toHaveBeenCalledTimes(1);
		rejectRefresh(
			Object.assign(new Error("Invalid directory response"), {
				code: "gateway.invalid_response",
			})
		);
		const refreshMessage =
			"Couldn’t update the list. Showing the last available results.";
		await screen.findByText(refreshMessage);
		expect(choice.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(screen.getByText("Try again"));
		const retrying = await screen.findByRole("button", { name: "Retrying…" });
		expect(retrying.hasAttribute("disabled")).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Add 1 member" })
				.hasAttribute("disabled")
		).toBe(false);
		expect(choice.getAttribute("aria-checked")).toBe("true");
		fireEvent.click(retrying);
		expect(read).toHaveBeenCalledTimes(2);
		resolveRetry(profileDirectory);
		await waitFor(() => expect(screen.queryByText(refreshMessage)).toBeNull());
		expect(read).toHaveBeenCalledTimes(2);
		expect(choice.getAttribute("aria-checked")).toBe("true");
	});

	it.each([
		true,
		false,
	])("opens one add dialog with Members closed (desktop=%s)", async (desktop) => {
		const onOpenChange = vi.fn();
		const common = {
			activeWakeWaitingTargetProfileIds: new Set<string>(),
			agentRecoveryPlansByProfileId: new Map(),
			autoRefreshExhaustedProfileIds: new Set<string>(),
			currentOwnerUserId: "user_felix",
			currentProfileId: "11111111-1111-4111-8111-111111111111",
			isAgentRecoveryPending: () => false,
			isLoading: false,
			membersError: null,
			onAgentRecoveryAction: async () => undefined,
			onAddProfiles: vi.fn(),
			onOpenChange,
			onRefresh: async () => undefined,
			open: false,
			orgSlug: "acme",
			snapshot: createSpaceMembersSnapshot({
				humans: [
					createSpaceMemberHumanSnapshot({
						profileName: "Felix",
						profileId: "11111111-1111-4111-8111-111111111111",
					}),
				],
			}),
		};
		const surfaces = (nonce: number) => (
			<>
				{desktop ? (
					<SpaceMembersSidePanel {...common} />
				) : (
					<SpaceMembersDrawer {...common} />
				)}
				<SpaceAddMembersLauncher {...common} openAddMembersNonce={nonce} />
			</>
		);
		const view = renderWithQueryClient(surfaces(0));
		view.rerender(
			<TestQueryClientProvider>{surfaces(1)}</TestQueryClientProvider>
		);
		await screen.findByRole("dialog", { name: "Add People or Agents" });
		expect(screen.getAllByRole("dialog")).toHaveLength(1);
		expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
		expect(onOpenChange).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.restoreAllMocks();
		readPrimaryBindingMock.mockReset();
		vi.mocked(readCurrentOrganizationProfileDirectory).mockReset();
		toastMock.error.mockReset();
		toastMock.success.mockReset();
		toastMock.loading.mockReset();
		toastMock.dismiss.mockReset();
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
		const headingGroup = heading.parentElement;
		const headerMainRow = headingGroup?.parentElement;
		const header = headerMainRow?.parentElement;
		const countLabel = screen.getByText("1");
		const countDescription = screen.getByText("1 member in this space");
		expect(header?.tagName).toBe("HEADER");
		expect(headerMainRow?.className).toContain("justify-between");
		expect(countLabel.parentElement).toBe(headingGroup);
		expect(countDescription.className).toContain("sr-only");
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
							ownerUserId: "user_felix",
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

	it("hides owner removal until their ordinary Agent leaves the Space", () => {
		const onRemoveMember = vi.fn(async () => ({
			alreadyAbsentCount: 0,
			removedCount: 1,
		}));
		const commonProps = {
			activeWakeWaitingTargetProfileIds: new Set<string>(),
			agentRecoveryPlansByProfileId: new Map(),
			autoRefreshExhaustedProfileIds: new Set<string>(),
			currentOwnerUserId: "user_felix",
			currentProfileId: "11111111-1111-4111-8111-111111111111",
			isAgentRecoveryPending: () => false,
			isLoading: false,
			membersError: null,
			onAgentRecoveryAction: async () => undefined,
			onOpenChange: vi.fn(),
			onRefresh: async () => undefined,
			onRemoveMember,
			open: true,
			orgSlug: "acme",
		};
		const owner = createSpaceMemberHumanSnapshot({
			memberSource: "added_by_member",
			ownerUserId: "user_mira",
			profileId: "22222222-2222-4222-8222-222222222222",
			profileName: "Mira",
		});
		const creator = createSpaceMemberHumanSnapshot({
			memberSource: "space_creator",
			ownerUserId: "user_felix",
			profileId: "11111111-1111-4111-8111-111111111111",
			profileName: "Felix",
		});
		const { rerender } = renderWithQueryClient(
			<SpaceMembersSidePanel
				{...commonProps}
				snapshot={createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							memberSource: "added_by_member",
							ownerUserId: "user_mira",
							profileId: "agt_33333333-3333-4333-8333-333333333333",
							profileName: "Mira Runner",
						}),
					],
					humans: [creator, owner],
				})}
			/>
		);

		expect(
			screen.queryByRole("button", { name: "Member options for Mira" })
		).toBeNull();

		rerender(
			<TestQueryClientProvider>
				<SpaceMembersSidePanel
					{...commonProps}
					snapshot={createSpaceMembersSnapshot({
						humans: [creator, owner],
					})}
				/>
			</TestQueryClientProvider>
		);

		expect(
			screen.getByRole("button", { name: "Member options for Mira" })
		).toBeTruthy();
	});

	it("opens the canonical Agent Profile editor for an owned Agent member", async () => {
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
							{
								...createSpaceMemberHumanSnapshot({
									ownerUserId: "user_felix",
									profileId: "11111111-1111-4111-8111-111111111111",
									profileName: "Felix",
								}),
								avatarUrl: "https://images.example.test/felix.png",
							},
						],
					})}
				/>
			</TestQueryClientProvider>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Check Research Agent Profile" })
		);

		const dialog = within(
			await screen.findByRole("dialog", { name: "Research Agent Profile" })
		);
		expect(
			dialog
				.getByRole("link", { name: "Edit Research Agent" })
				.getAttribute("href")
		).toBe(`/o/acme/agents?profileId=${agentProfileId}`);
		expect(dialog.queryByText("How this Agent works")).toBeNull();
		expect(dialog.queryByText("Check this Agent")).toBeNull();
	});

	it("does not expose inline Agent settings in the Space profile popover", async () => {
		const agentProfileId = "agt_22222222-2222-4222-8222-222222222222";
		const actorProfileId = "11111111-1111-4111-8111-111111111111";
		const queryClient = createTestQueryClient();
		const primaryBindingResponse = createPrimaryBindingResponse(agentProfileId);
		const onSaved = vi.fn(() =>
			Promise.reject(new Error("Space refresh failed"))
		);
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
			screen.getByRole("button", { name: "Check Research Agent Profile" })
		);

		const dialog = within(
			await screen.findByRole("dialog", { name: "Research Agent Profile" })
		);
		expect(
			dialog.queryByRole("button", { name: "Edit Collaboration mode" })
		).toBeNull();
		expect(
			dialog.queryByRole("button", { name: "Edit Permissions" })
		).toBeNull();
		expect(dialog.queryByRole("button", { name: "Save changes" })).toBeNull();
		expect(
			updatePrimaryBindingAgentControllerCollaborationModeMock
		).not.toHaveBeenCalled();
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
			screen.getByRole("button", { name: "Check Research Agent Profile" })
		);
		fireEvent.click(
			await screen.findByRole("button", {
				name: "Chat with Research Agent",
			})
		);

		await waitFor(() => {
			expect(openDirectMessageMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				targetProfileId: agentProfileId,
			});
		});
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/chats/space-direct-message?profileId=agt_22222222-2222-4222-8222-222222222222",
		});
	});

	it("keeps configuration and owner-only connection facts out of the compact Agent popover", async () => {
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

		const dialog = within(
			await screen.findByRole("dialog", { name: "Codex Agent Profile" })
		);
		expect(dialog.queryByText("Permissions mode")).toBeNull();
		expect(dialog.queryByText("Approve for me")).toBeNull();
		expect(dialog.queryByText("Controller conversation ID")).toBeNull();
		expect(
			dialog.queryByText("019f07bc-cda8-75e0-94d9-96c82f1333d4")
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

	it("keeps retry available after a refresh error without a permanent refresh button", async () => {
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
				membersError="network unavailable"
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

		expect(
			screen.queryByRole("button", { name: "Refresh members" })
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => {
			expect(onRefresh).toHaveBeenCalledWith({ forceNetwork: true });
		});
		expect(toastMock.error).toHaveBeenCalledWith(
			SPACE_MEMBERS_REFRESH_ERROR_MESSAGE
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"Failed to retry member loading.",
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

		expect(screen.getByText("Loading")).toBeTruthy();
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
		expect(indicator.getAttribute("aria-description")).toBe(
			"Available for Wake"
		);
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
		expect(
			readTextOrder(getMembersSection("People & Agents"), expectedOrder)
		).toEqual(expectedOrder);
		expect(screen.getByText("Felix")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Collapse Felix" })).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Agents" })).toBeNull();
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
		expect(
			readTextOrder(getMembersSection("People & Agents"), expectedOrder)
		).toEqual(expectedOrder);
	});

	it("groups Space Agents under their people and keeps the Center Agent first", () => {
		const centerAgentProfileId = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
		renderWithQueryClient(
			<SpaceMembersSidePanel
				activeWakeWaitingTargetProfileIds={new Set()}
				agentRecoveryPlansByProfileId={new Map()}
				autoRefreshExhaustedProfileIds={new Set()}
				centerAgentProfileId={centerAgentProfileId}
				currentOwnerUserId="user_felix"
				currentProfileId="11111111-1111-4111-8111-111111111111"
				isAgentRecoveryPending={() => false}
				isLoading={false}
				membersError={null}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				onRemoveMember={vi.fn(async () => ({
					alreadyAbsentCount: 0,
					removedCount: 1,
				}))}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					humans: [
						createSpaceMemberHumanSnapshot({
							lastSeenLabel: "12 minutes ago",
							lastSeenAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
							ownerUserId: "user_mira",
							profileId: "22222222-2222-4222-8222-222222222222",
							profileName: "Mira",
						}),
					],
					agents: [
						createSpaceMemberAgentSnapshot({
							agentWakeAvailability: { status: "available_for_wake" },
							ownerName: "Mira",
							ownerUserId: "user_mira",
							profileId: "agt_22222222-2222-4222-8222-222222222222",
							profileName: "Mira Research",
						}),
						createSpaceMemberAgentSnapshot({
							agentControllerRef: "remote:center-agent",
							agentWakeAvailability: { status: "available_for_wake" },
							profileId: centerAgentProfileId,
							profileName: "Acme Center Agent",
						}),
					],
				})}
			/>
		);

		const organization = getMembersSection("Organization");
		const people = getMembersSection("People & Agents");
		expect(organization.compareDocumentPosition(people)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(within(organization).getByText("Acme Center Agent")).toBeTruthy();
		expect(within(people).getByText("Here 12m ago")).toBeTruthy();
		expect(within(people).getByText("Mira Research")).toBeTruthy();
		expect(
			within(people).getByRole("button", {
				name: "Member options for Mira Research",
			})
		).toBeTruthy();
		const agentStatus = within(people).getByTestId(
			"space-agent-availability-indicator"
		);
		expect(agentStatus.getAttribute("aria-label")).toBe("Available");
		expect(agentStatus.getAttribute("aria-description")).toBe(
			"Available for Wake"
		);
		expect(screen.queryByText(CONNECTED_TO_PATTERN)).toBeNull();
		expect(screen.queryByText(OWNED_BY_MIRA_PATTERN)).toBeNull();

		fireEvent.click(
			within(people).getByRole("button", { name: "Collapse Mira" })
		);
		expect(within(people).queryByText("Mira Research")).toBeNull();
		fireEvent.click(
			within(people).getByRole("button", { name: "Expand Mira" })
		);
		expect(within(people).getByText("Mira Research")).toBeTruthy();
	});

	it("adds selectable account Agent Profiles while keeping joined Agents visible", async () => {
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		const dialog = screen.getByRole("dialog", { name: "Add People or Agents" });

		expect(
			within(dialog).queryByRole("checkbox", { name: "Felix" })
		).toBeNull();
		expect(
			within(dialog).queryByRole("checkbox", { name: "Joined Agent" })
		).toBeNull();
		expect(within(dialog).getByText("Joined Agent")).toBeTruthy();
		expect(within(dialog).getByText("In this Space")).toBeTruthy();

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
					.getByRole("button", { name: "Add People or Agents" })
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);

		expect(
			screen.getByRole("heading", { name: "People & Agents" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "QA Human" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(() => {
			expect(onAddProfiles).toHaveBeenCalledWith([
				"22222222-2222-4222-8222-222222222222",
			]);
		});
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add People or Agents" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
	});

	it.each([
		false,
		true,
		"welcome",
	])("adds workspace directory members and Center Agent atomically (scenario=%s)", async (scenario) => {
		const isPersonal = scenario === true;
		const isWelcome = scenario === "welcome";
		if (isWelcome) {
			localStorage.setItem(
				"openmeld.welcome-space:user-felix:welcome-selection-test",
				`add:${Date.now()}`
			);
		}
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
				spaceId={isWelcome ? "welcome-selection-test" : undefined}
			/>,
			buildOrganizationDirectory({ centerAgentProfileId, humanProfileId }),
			isPersonal
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		const centerChoice = screen.getByRole("checkbox", { name: "Center Agent" });
		await waitFor(() =>
			expect(centerChoice.getAttribute("aria-checked")).toBe(
				isWelcome ? "true" : "false"
			)
		);
		expect(onAddOrganizationDirectoryProfiles).not.toHaveBeenCalled();
		if (isWelcome) {
			fireEvent.click(centerChoice);
			fireEvent.click(screen.getByRole("button", { name: "Close" }));
			fireEvent.click(
				screen.getByRole("button", { name: "Add People or Agents" })
			);
			expect(
				screen
					.getByRole("checkbox", { name: "Center Agent" })
					.getAttribute("aria-checked")
			).toBe("false");
		}
		expect(
			screen.getByText(
				"Select people or agents from Acme to add directly to this Space."
			)
		).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: "Felix" })).toBeNull();
		expect(
			screen.queryByRole("checkbox", { name: "Disabled Agent" })
		).toBeNull();
		expect(
			screen.queryByRole("checkbox", { name: "Personal Center Agent" })
		).toBeNull();

		const searchInput = screen.getByRole("searchbox", {
			name: "Search people and agents",
		});
		expect(searchInput.className).toContain("pl-9");
		expect(searchInput.parentElement?.querySelector("svg")).not.toBeNull();
		expect(
			screen.getByRole("dialog", { name: "Add People or Agents" }).className
		).toContain("sm:max-w-2xl");
		expect(screen.queryByText("mira@example.com")).toBeNull();
		fireEvent.change(searchInput, { target: { value: "mira@example.com" } });
		expect(screen.queryByRole("checkbox", { name: "Mira" })).toBeNull();
		fireEvent.change(searchInput, { target: { value: "mira" } });
		expect(screen.getByRole("checkbox", { name: "Mira" })).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: "Center Agent" })).toBeNull();
		fireEvent.change(searchInput, { target: { value: "" } });
		expect(
			screen.getByRole("heading", { name: "People & Agents" })
		).toBeTruthy();
		const organizationHeading = screen.getByRole("heading", {
			name: "Organization",
		});
		const peopleHeading = screen.getByRole("heading", {
			name: "People & Agents",
		});
		expect(organizationHeading.compareDocumentPosition(peopleHeading)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			within(screen.getByRole("checkbox", { name: "Center Agent" })).getByText(
				"Remote"
			)
		).toBeTruthy();
		expect(screen.getByText("2 hours ago")).toBeTruthy();
		expect(screen.queryByText("Available to add")).toBeNull();
		fireEvent.click(screen.getByRole("checkbox", { name: "Research Agent" }));
		expect(screen.getByText("Joins with selected Agent")).toBeTruthy();
		expect(
			screen
				.getByRole("checkbox", { name: "Mira" })
				.getAttribute("aria-checked")
		).toBe("true");
		expect(screen.getByRole("button", { name: "Add 2 members" })).toBeTruthy();
		fireEvent.click(screen.getByRole("checkbox", { name: "Research Agent" }));
		expect(
			screen
				.getByRole("checkbox", { name: "Mira" })
				.getAttribute("aria-checked")
		).toBe("false");
		fireEvent.click(screen.getByRole("checkbox", { name: "Research Agent" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Mira" }));
		expect(
			screen
				.getByRole("checkbox", { name: "Research Agent" })
				.getAttribute("aria-checked")
		).toBe("false");

		fireEvent.click(screen.getByRole("checkbox", { name: "Mira" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Center Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 2 members" }));

		await waitFor(() => {
			expect(onAddOrganizationDirectoryProfiles).toHaveBeenCalledWith({
				directoryProfileIds: [humanProfileId, centerAgentProfileId],
				expectedCenterAgentProfileId: centerAgentProfileId,
			});
		});
		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"Couldn't add members.",
				expect.objectContaining({
					description: "Directory changed. Try again.",
					action: { label: "Try again", onClick: expect.any(Function) },
				})
			);
		});
		expect(
			screen.queryByRole("dialog", { name: "Add People or Agents" })
		).toBeNull();
		act(() => {
			toastMock.error.mock.calls.at(-1)?.[1].action.onClick();
		});

		await waitFor(() => {
			expect(onAddOrganizationDirectoryProfiles).toHaveBeenCalledTimes(2);
			expect(onAddOrganizationDirectoryProfiles).toHaveBeenLastCalledWith({
				directoryProfileIds: [humanProfileId, centerAgentProfileId],
				expectedCenterAgentProfileId: centerAgentProfileId,
			});
		});
		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add People or Agents" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		await waitFor(() => {
			expect(screen.queryByText("Select members to add")).toBeNull();
		});
	});

	it("keeps joined people and agents visible with creation scoped to yourself", () => {
		const centerAgentProfileId = "agt_44444444-4444-4444-8444-444444444444";
		const humanProfileId = "22222222-2222-4222-8222-222222222222";
		const joinedAgentProfileId = "agt_88888888-8888-4888-8888-888888888888";
		const directory = buildOrganizationDirectory({
			centerAgentProfileId,
			humanProfileId,
		});
		const joinedAgent = directory.agentProfiles.find(
			(profile) => profile.profileId === joinedAgentProfileId
		);
		if (!joinedAgent) {
			throw new Error("Joined Agent fixture was not created.");
		}
		directory.agentProfiles = [
			{
				...joinedAgent,
				profileHandle: "available-agent",
				profileId: "agt_99999999-9999-4999-8999-999999999999",
				profileName: "Available Agent",
				readiness: buildRemoteCenterAgentReadiness("available", {
					agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
				}),
			},
			...directory.agentProfiles,
		];

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
				onAddOrganizationDirectoryProfiles={vi.fn(async () => ({
					addedCount: 0,
					alreadyMemberCount: 0,
				}))}
				onAgentRecoveryAction={async () => undefined}
				onOpenChange={vi.fn()}
				onRefresh={async () => undefined}
				open={true}
				orgSlug="acme"
				snapshot={createSpaceMembersSnapshot({
					agents: [
						createSpaceMemberAgentSnapshot({
							ownerUserId: "user_mira",
							profileId: joinedAgentProfileId,
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
				spaceId="space-1"
			/>,
			directory
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		const dialog = screen.getByRole("dialog", { name: "Add People or Agents" });
		expect(
			within(dialog).getAllByRole("button", { name: "New Agent" })
		).toHaveLength(1);
		expect(
			within(dialog).queryByRole("checkbox", { name: "Felix" })
		).toBeNull();
		expect(
			within(dialog).queryByRole("checkbox", { name: "Research Agent" })
		).toBeNull();
		expect(within(dialog).getByText("In this Space")).toBeTruthy();
		expect(
			readTextOrder(dialog, ["Research Agent", "Available Agent"])
		).toEqual(["Research Agent", "Available Agent"]);
		expect(within(dialog).getByText("Select members to add")).toBeTruthy();
	});

	it("closes Add People or Agents when the server confirms the selection is already present", async () => {
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Codex Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 member" }));

		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: "Add People or Agents" })
					.getAttribute("aria-expanded")
			).toBe("false");
		});
		await waitFor(() => {
			expect(
				screen.queryByText("That member is already in this Space.")
			).toBeNull();
		});
	});

	it("names an implicitly selected Agent owner in the Direct Message conversion warning", () => {
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
				onAddOrganizationDirectoryProfiles={vi.fn()}
				onAgentRecoveryAction={async () => undefined}
				onConvertDirectMessageToSpace={vi.fn()}
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
			buildOrganizationDirectory({
				centerAgentProfileId: "agt_44444444-4444-4444-8444-444444444444",
				humanProfileId: "22222222-2222-4222-8222-222222222222",
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Research Agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 2 members" }));
		const confirmation = screen.getByRole("dialog", {
			name: "Turn this Direct Message into a Space?",
		});
		expect(confirmation.textContent).toContain(
			"Adding Mira and Research Agent will move this conversation to Spaces."
		);
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
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
		await waitFor(() =>
			expect(
				screen.queryByRole("heading", {
					name: "Turn this Direct Message into a Space?",
				})
			).toBeNull()
		);

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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		const dialog = screen.getByRole("dialog", { name: "Add People or Agents" });
		expect(screen.queryByRole("checkbox", { name: "Joined Agent" })).toBeNull();
		expect(within(dialog).getByText("Joined Agent")).toBeTruthy();
		expect(within(dialog).getByText("In this Space")).toBeTruthy();
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

		fireEvent.click(
			screen.getByRole("button", { name: "Add People or Agents" })
		);
		expect(
			screen.getByText("No matching profiles are available to add.")
		).toBeTruthy();
	});

	it("groups Agents under expandable People", () => {
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

		const trigger = screen.getByRole("button", {
			name: "Add People or Agents",
		});
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");

		const dialog = screen.getByRole("dialog", { name: "Add People or Agents" });
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("aria-controls")).toBe(dialog.id);
		const scope = within(dialog);

		expect(
			scope.getByRole("heading", { name: "People & Agents" })
		).toBeTruthy();
		expect(scope.getByRole("checkbox", { name: "QA Human" })).toBeTruthy();
		const collapseButton = scope.getByRole("button", {
			name: "Collapse QA Human",
		});
		fireEvent.click(collapseButton);
		expect(scope.queryByRole("checkbox", { name: "Codex Agent" })).toBeNull();
		fireEvent.click(scope.getByRole("button", { name: "Expand QA Human" }));

		const codexCheckbox = scope.getByRole("checkbox", {
			name: "Codex Agent",
		});
		codexCheckbox.focus();
		fireEvent.keyDown(codexCheckbox, { key: " " });
		const selectedCheckbox = scope.getByRole("checkbox", {
			name: "Codex Agent",
		});
		expect(selectedCheckbox.getAttribute("aria-checked")).toBe("true");
		expect(document.activeElement).toBe(selectedCheckbox);
		expect(
			scope.queryByRole("heading", { name: "Selected Agents" })
		).toBeNull();
		const ownerAgents = document.getElementById(
			collapseButton.getAttribute("aria-controls") ?? ""
		);
		expect(ownerAgents?.contains(selectedCheckbox)).toBe(true);
		expect(screen.getByText("1 selected")).toBeTruthy();
	});

	it("offers an empty-space call to action that opens Add People or Agents", () => {
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
		expect(emptyCta.getAttribute("aria-haspopup")).toBe("dialog");
		fireEvent.click(emptyCta);

		expect(
			screen.getByRole("heading", { name: "Add People or Agents" })
		).toBeTruthy();
		const dialog = screen.getByRole("dialog", {
			name: "Add People or Agents",
		});
		expect(emptyCta.getAttribute("aria-controls")).toBe(dialog.id);
		expect(emptyCta.getAttribute("aria-expanded")).toBe("true");
		const dialogScope = within(dialog);
		expect(
			dialogScope.getByRole("heading", { name: "Add People or Agents" })
		).toBeTruthy();
		expect(
			dialogScope.getByText(
				"Choose people and their agents to add to this Space."
			)
		).toBeTruthy();
		const createProfileButton = dialogScope.getByRole("button", {
			name: "New Agent",
		});
		expect(createProfileButton).toBeTruthy();
		const footerLabel = dialogScope.getByText("Select members to add");
		const footer = footerLabel.parentElement;
		expect(footer?.className).toContain("flex-col");
		expect(footer?.className).toContain("@min-[20rem]:flex-row");
		expect(
			dialogScope.getByRole("button", { name: "Add selected" }).className
		).toContain("flex-1");
		expect(screen.getAllByRole("button", { name: "New Agent" })).toHaveLength(
			1
		);
		expect(
			screen.queryByRole("button", { name: EMPTY_SPACE_CTA_NAME })
		).toBeNull();
	});

	it("closes the Add People or Agents dialog with Escape and returns focus to the trigger", async () => {
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

		const trigger = screen.getByRole("button", {
			name: "Add People or Agents",
		});
		trigger.focus();
		fireEvent.click(trigger);
		const dialog = await screen.findByRole("dialog", {
			name: "Add People or Agents",
		});

		fireEvent.keyDown(dialog, { key: "Escape" });
		await waitFor(() => {
			expect(trigger.getAttribute("aria-expanded")).toBe("false");
			expect(document.activeElement).toBe(trigger);
		});
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
	directory: OrganizationDirectoryResponse,
	isPersonal = false
) {
	const queryClient = createTestQueryClient();
	vi.mocked(readCurrentOrganizationProfileDirectory).mockResolvedValue(
		toProfileDirectory(directory)
	);
	queryClient.setQueryData(
		organizationQueryKeys.profileDirectory("org-acme"),
		toProfileDirectory(directory)
	);
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<AppOrganizationProvider scope={createOrganizationScope(isPersonal)}>
				{ui}
			</AppOrganizationProvider>
		</TestQueryClientProvider>
	);
}

function createOrganizationScope(
	isPersonal = false
): OrganizationScopeAuthorized {
	const currentOrganization = {
		id: "org-acme",
		isPersonal,
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
				createdByUserId: "user_mira",
				creatorProfileId: null,
				isCenterAgent: false,
				isDefault: false,
				lastUsedAt: null,
				managedRole: null,
				organizationId: "org-acme",
				ownerName: "Mira",
				ownerUserId: "user_mira",
				profileHandle: "research-agent",
				profileId: "agt_88888888-8888-4888-8888-888888888888",
				profileKind: "agent",
				profileName: "Research Agent",
				readiness: buildRemoteCenterAgentReadiness("available", {
					agentProfileId: "agt_88888888-8888-4888-8888-888888888888",
				}),
				source: "user",
				status: "active",
				updatedAt: "2026-07-14T00:00:00.000Z",
			},
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
				lastActiveAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
				userId: "user_mira",
			},
		],
		organizationId: "org-acme",
	};
}

function toProfileDirectory(
	directory: OrganizationDirectoryResponse
): OrganizationProfileDirectoryResponse {
	return {
		...directory,
		agentProfiles: directory.agentProfiles.map(({ readiness, ...profile }) => ({
			...profile,
			agentControllerRef: readiness.agentControllerRef,
		})),
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
		expect(indicator.getAttribute("aria-description")).toBe(
			"Available for Wake"
		);
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
		expect(indicator.getAttribute("aria-description")).toBe(
			"Checking Wake availability"
		);
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
		expect(indicator.getAttribute("aria-description")).toBe("Wake in progress");
		expect(indicator.getAttribute("data-refreshing")).toBe("true");
		expect(screen.queryByText("Connect local agent")).toBeNull();
		expect(
			screen.queryByText("This agent is working on a Wake in this Space.")
		).toBeNull();
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
