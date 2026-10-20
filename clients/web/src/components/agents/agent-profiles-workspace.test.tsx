const AVAILABLE_STATUS_NAME = /^Available/;

import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfilesWorkspace } from "./agent-profiles-workspace";

vi.mock("#/components/directory/center-agent-item", () => ({
	CenterAgentItem: () => <div>Center Agent</div>,
}));

const organization = vi.hoisted(() => ({ id: "org-test", slug: "test" }));

vi.mock("#/lib/organizations/organization-context", () => {
	const value = {
		account: { name: "Current member" },
		currentUserId: "user-current",
		currentOrganization: organization,
	};
	return {
		useAppOrganization: () => value,
		useOptionalAppOrganization: () => value,
	};
});
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: null,
		disabled: true,
		save: vi.fn(),
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

const { appFullWidthLayoutSpy, appNavigationPresentationSpy } = vi.hoisted(
	() => ({
		appFullWidthLayoutSpy: vi.fn(),
		appNavigationPresentationSpy: vi.fn(() => ({ dismiss: vi.fn() })),
	})
);

vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainSidebar,
		...props
	}: {
		children: ReactNode;
		mainSidebar?: { content: ReactNode };
		[key: string]: unknown;
	}) => (
		<>
			{appFullWidthLayoutSpy(props)}
			<div data-testid="agents-workspace-layout">
				<aside data-testid="agents-main-sidebar">{mainSidebar?.content}</aside>
				<main>{children}</main>
			</div>
		</>
	),
}));

vi.mock("#/components/app/app-navigation-presentation", () => ({
	useAppNavigationPresentation: () => appNavigationPresentationSpy(),
}));

const CURRENT_USER_ID = "user-current";
const TEST_MODEL_CATALOG: ModelCatalog = {
	agentControllers: {
		codex: {
			defaultModelId: "gpt-5.6-sol",
			models: [
				{
					displayName: "GPT-5.6 Sol",
					id: "gpt-5.6-sol",
					minCliVersion: null,
					supportedReasoningLevels: ["low", "medium", "high"],
					unavailable: false,
				},
			],
		},
	},
	schemaVersion: 1,
	updatedAt: "2026-09-03T00:00:00.000Z",
};

afterEach(() => {
	cleanup();
	window.localStorage.clear();
	organization.id = "org-test";
	appFullWidthLayoutSpy.mockReset();
	appNavigationPresentationSpy.mockClear();
});

describe("AgentProfilesWorkspace", () => {
	it.each([
		"account",
		"workspace",
	])("isolates saved Agent views by %s", (scope) => {
		const { rerenderWorkspace } = renderWorkspace({ person: undefined });
		fireEvent.click(screen.getByRole("tab", { name: "My Agents" }));
		fireEvent.click(screen.getByRole("button", { name: "Search Agents" }));
		fireEvent.change(screen.getByRole("searchbox"), {
			target: { value: "Felix" },
		});
		if (scope === "workspace") {
			organization.id = "org-other";
		}
		rerenderWorkspace({
			currentUserId: scope === "account" ? "user-other" : CURRENT_USER_ID,
		});
		expect(
			screen
				.getByRole("tab", { name: "All Agents" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect(screen.queryByRole("searchbox")).toBeNull();
		organization.id = "org-test";
		rerenderWorkspace({ currentUserId: CURRENT_USER_ID });
		expect(
			screen
				.getByRole("tab", { name: "My Agents" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
			"Felix"
		);
	});
	it("switches the directory to owned Agents and restores search and filters after detail navigation", () => {
		const { rerenderWorkspace } = renderWorkspace({ person: undefined });
		fireEvent.click(screen.getByRole("tab", { name: "My Agents" }));
		expect(
			screen.getByRole("button", { name: "Open Felix Agent" })
		).toBeTruthy();
		expect(screen.queryByText("Center Agent")).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Open Other Agent" })
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Search Agents" }));
		fireEvent.change(screen.getByRole("searchbox"), {
			target: { value: "Felix" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Agent view settings" })
		);
		fireEvent.click(
			screen.getByRole("menuitemcheckbox", { name: AVAILABLE_STATUS_NAME })
		);
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		rerenderWorkspace({ selectedProfileId: "agent-current" });
		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Felix Agent"
		);
		rerenderWorkspace({ selectedProfileId: null });
		expect(
			screen
				.getByRole("tab", { name: "My Agents" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe(
			"Felix"
		);
		expect(
			screen.getByRole("button", { name: "Remove Available filter" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open Felix Agent" })
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Close search" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Remove Available filter" })
		);
		fireEvent.click(screen.getByRole("tab", { name: "All Agents" }));
		expect(screen.getByText("Center Agent")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open Other Agent" })
		).toBeTruthy();
	});
	it("navigates Agent details through the current Agent list instead of people", () => {
		const onSelectProfile = vi.fn();
		renderWorkspace({ selectedProfileId: "agent-current", onSelectProfile });
		const sidebar = screen.getByTestId("agents-main-sidebar");
		expect(
			within(sidebar).getByRole("navigation", { name: "Agents" })
		).toBeTruthy();
		expect(
			within(sidebar).queryByRole("navigation", { name: "People" })
		).toBeNull();
		expect(
			within(sidebar)
				.getByRole("button", { name: "Felix Agent" })
				.getAttribute("aria-current")
		).toBe("page");
		fireEvent.click(
			within(sidebar).getByRole("button", { name: "Other Agent" })
		);
		expect(onSelectProfile).toHaveBeenCalledWith("agent-other");
		expect(
			within(sidebar).queryByRole("button", {
				name: "Create Agent",
			})
		).toBeNull();
	});

	it("provides shared search and filter controls", () => {
		renderWorkspace();
		expect(screen.queryByRole("searchbox")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Search Agents" }));
		expect(
			screen.getByRole("searchbox", { name: "Search Agents" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Agent view settings" })
		).toBeTruthy();
	});

	it("uses the shared full-width layout without an Agents sidebar", () => {
		renderWorkspace();
		expect(appFullWidthLayoutSpy).toHaveBeenCalledWith(
			expect.objectContaining({ contentLayout: "flush" })
		);
		expect(screen.getByTestId("agents-main-sidebar").textContent).toBe("");
	});
	it.each([
		false,
		true,
	])("opens details after selecting a card (My Agents: %s)", (myAgents) => {
		const onSelectProfile = vi.fn();
		renderWorkspace({
			onSelectProfile,
			...(myAgents ? { person: undefined } : {}),
		});
		if (myAgents) {
			fireEvent.click(screen.getByRole("tab", { name: "My Agents" }));
		}
		expect(screen.queryByTestId("selected-agent-detail")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Open Felix Agent" }));
		expect(onSelectProfile).toHaveBeenCalledWith("agent-current");
	});
	it("preserves the explicit detail selection without a parallel Agent list", () => {
		renderWorkspace({ selectedProfileId: "agent-other" });
		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Other Agent"
		);
		expect(
			screen.queryByRole("button", { name: "Open Felix Agent" })
		).toBeNull();
	});
	it("does not substitute another Agent for a stale profile deep link", () => {
		renderWorkspace({ selectedProfileId: "agent-missing" });
		expect(
			screen.getByRole("heading", { name: "Agent not found" })
		).toBeTruthy();
		expect(screen.queryByTestId("selected-agent-detail")).toBeNull();
	});

	it("keeps ready and idle as the quiet default", () => {
		renderWorkspace();

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(item.textContent).toContain("Codex · GPT-5.6 Sol · model default");
		expect(within(item).getByText(AVAILABLE_STATUS_NAME)).toBeTruthy();
		expect(item.textContent).not.toContain("Idle");
		expect(
			within(item).queryByTestId("agent-profile-operational-status")
		).toBeNull();
		expect(
			within(item).getByTestId("agent-profile-controller-avatar-agent-current")
		).toBeTruthy();
		expect(item.querySelector('[data-profile-kind="center-agent"]')).toBeNull();
	});

	it("keeps only the stable Available verdict visible during background refresh", () => {
		renderWorkspace({
			readinessByProfileId: new Map([
				[
					"agent-current",
					{
						...createReadiness(),
						agentWakeAvailability: {
							...createReadiness().agentWakeAvailability,
							isRefreshing: true,
						},
						generatedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
					},
				],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(within(item).getByText(AVAILABLE_STATUS_NAME)).toBeTruthy();
		expect(item.textContent).not.toContain("checked 3 minutes ago");
		expect(item.textContent).not.toContain("Refreshing…");
	});

	it("does not rerender an unrelated Agent row after targeted readiness changes", () => {
		const onSelectProfile = vi.fn();
		const initialReadiness = createReadiness();
		const { rerenderWorkspace } = renderWorkspace({
			onSelectProfile,
			readinessByProfileId: new Map([["agent-current", initialReadiness]]),
		});
		appNavigationPresentationSpy.mockClear();
		// List containers also read the presentation to scope shared selection.
		rerenderWorkspace({
			readinessByProfileId: new Map([["agent-current", initialReadiness]]),
		});
		appNavigationPresentationSpy.mockClear();

		rerenderWorkspace({
			readinessByProfileId: new Map([
				[
					"agent-current",
					{
						...initialReadiness,
						generatedAt: "2026-09-04T10:01:00.000Z",
					},
				],
			]),
		});

		expect(appNavigationPresentationSpy).toHaveBeenCalledTimes(1);
	});

	it("shows another owner's public harness, model, and reasoning without a private Binding", () => {
		renderWorkspace({
			readinessByProfileId: new Map([
				[
					"agent-other",
					{
						...createReadiness(),
						agentProfileId: "agent-other",
						agentControllerRef: null,
						primaryBinding: null,
						publicProfileConfiguration: {
							agentControllerRef: "builtin:codex",
							agentControllerCollaborationMode: null,
							agentControllerPermissionMode: null,
							modelSelection: {
								modelId: "gpt-5.6-sol",
								reasoningLevel: "high",
							},
						},
					},
				],
			]),
		});
		const item = screen.getByRole("button", { name: "Open Other Agent" });
		expect(item.textContent).toContain("Codex");
		expect(item.textContent).toContain("GPT-5.6 Sol");
		expect(item.textContent).toContain("high");
	});

	it("names only the controller for an unselected model without guessing the active conversation model", () => {
		const readiness = createReadiness();
		if (!readiness.primaryBinding) {
			throw new Error("Expected a primary Binding fixture");
		}
		const {
			modelSelection: _modelSelection,
			...primaryBindingWithoutModelSelection
		} = readiness.primaryBinding;
		renderWorkspace({
			readinessByProfileId: new Map([
				[
					"agent-current",
					{
						...readiness,
						primaryBinding: primaryBindingWithoutModelSelection,
					},
				],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(item.textContent).toContain("Codex");
		expect(item.textContent).not.toContain("Controller default");
	});

	it("keeps Controller branding without repeating an initial runtime check", () => {
		renderWorkspace({
			agentControllerRefByProfileId: new Map([
				["agent-current", "builtin:codex"],
			]),
			readinessByProfileId: new Map(),
			readinessPendingProfileIds: new Set(),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(within(item).getByTestId("local-agent-logo-codex")).toBeTruthy();
		expect(item.textContent).toContain("Codex");
		expect(item.textContent).not.toContain("Checking");
	});

	it("keeps the Agent identity static while activity is checking", () => {
		renderWorkspace({
			operationalContextByProfileId: new Map([
				[
					"agent-current",
					{
						currentWorkLocation: null,
						queuedWorkLocations: [],
						recoveryAction: null,
						status: "checking",
						waitingCount: 0,
					},
				],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		const name = within(item).getByText("Felix Agent");
		expect(name.className).not.toContain("bg-clip-text");
		expect(name.style.backgroundImage).toBe("");
	});

	it("shows owner and team-safe workload on their rows", () => {
		renderWorkspace({
			operationalContextByProfileId: new Map([
				[
					"agent-current",
					{
						currentWorkLocation: "Launch planning",
						queuedWorkLocations: ["Customer follow-up"],
						recoveryAction: null,
						status: "working",
						waitingCount: 1,
					},
				],
				[
					"agent-other",
					{
						currentWorkLocation: null,
						queuedWorkLocations: [],
						recoveryAction: null,
						status: "paused",
						waitingCount: 2,
					},
				],
			]),
		});

		const ownerItem = screen.getByRole("button", { name: "Open Felix Agent" });
		const ownerStatus = within(ownerItem).getByTestId(
			"agent-profile-operational-status"
		);
		expect(ownerStatus.getAttribute("data-agent-work-status")).toBe("working");
		expect(
			within(ownerStatus).getByTestId("agent-profile-working-orb")
		).toBeTruthy();
		expect(ownerStatus.textContent).toContain("+1");
		expect(ownerStatus.textContent).toContain(
			"Agent is working in Launch planning"
		);

		const observerItem = screen.getByRole("button", {
			name: "Open Other Agent",
		});
		const observerStatus = within(observerItem).getByTestId(
			"agent-profile-operational-status"
		);
		expect(observerStatus.getAttribute("data-agent-work-status")).toBe(
			"waiting"
		);
		expect(observerStatus.textContent).toContain("+2");
		expect(observerStatus.textContent).toContain("Waiting to continue");
		expect(observerItem.textContent).not.toContain("Needs attention");
	});

	it("uses a small static amber indicator for owner work that needs attention", () => {
		renderWorkspace({
			operationalContextByProfileId: new Map([
				[
					"agent-current",
					{
						currentWorkLocation: null,
						queuedWorkLocations: [],
						recoveryAction: { kind: "skip_interrupted_work" },
						status: "paused",
						waitingCount: 0,
					},
				],
			]),
		});

		const ownerItem = screen.getByRole("button", { name: "Open Felix Agent" });
		const ownerStatus = within(ownerItem).getByTestId(
			"agent-profile-operational-status"
		);
		expect(ownerStatus.textContent).toContain("Needs your attention");
		const indicator = ownerStatus.querySelector(
			'[data-agent-needs-attention-indicator="true"]'
		);
		expect(indicator).toBeTruthy();
		expect(ownerStatus.className).toContain("text-amber-700");
		expect(ownerStatus.className).toContain("dark:text-amber-400");
	});

	it("keeps cached sidebar availability without exposing refresh detail", () => {
		renderWorkspace({
			readinessByProfileId: new Map([
				[
					"agent-current",
					{
						...createReadiness(),
						generatedAt: new Date().toISOString(),
					},
				],
			]),
			readinessErrorByProfileId: new Map([
				["agent-current", "Core could not refresh Wake availability."],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(within(item).getByText(AVAILABLE_STATUS_NAME)).toBeTruthy();
		expect(item.textContent).not.toContain("checked just now");
		expect(item.textContent).not.toContain("Couldn’t refresh availability.");
		expect(within(item).queryByRole("alert")).toBeNull();
	});

	it("shows a neutral sidebar result when the first availability check fails", () => {
		renderWorkspace({
			readinessByProfileId: new Map(),
			readinessErrorByProfileId: new Map([
				["agent-current", "Core could not read Wake availability."],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(within(item).getByText("Couldn’t check")).toBeTruthy();
		expect(item.textContent).not.toContain("Unavailable");
	});

	it("keeps unavailable indicators muted while card names stay readable", () => {
		const readiness = createReadiness();
		renderWorkspace({
			operationalContextByProfileId: new Map([
				[
					"agent-current",
					{
						currentWorkLocation: null,
						queuedWorkLocations: [],
						recoveryAction: null,
						status: "idle",
						waitingCount: 0,
					},
				],
			]),
			readinessByProfileId: new Map([
				[
					"agent-current",
					{
						...readiness,
						agentWakeAvailability: {
							...readiness.agentWakeAvailability,
							badgeLabel: "Unavailable",
							category: "unavailable",
							status: "unavailable_for_wake",
							tooltip: "Provider account unavailable",
						},
					},
				],
				[
					"agent-other",
					{
						...readiness,
						agentControllerRef: null,
						agentProfileId: "agent-other",
						agentWakeAvailability: {
							...readiness.agentWakeAvailability,
							badgeLabel: "Offline",
							category: "offline",
							status: "unavailable_for_wake",
							tooltip: "Offline for Wake",
						},
						ownerUserId: null,
						primaryBinding: null,
						profileName: null,
					},
				],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		// The same quiet outline pill as a MemberAgent row, never alarm red.
		expect(within(item).getByText("Unavailable").className).toContain(
			"border-border"
		);
		expect(within(item).getByText("Felix Agent").className).toContain(
			"text-foreground"
		);
		const avatar = within(item).getByTestId(
			"agent-profile-controller-avatar-agent-current"
		);
		expect(avatar.className).toContain("grayscale");
		expect(avatar.className).toContain("opacity-55");

		const observerItem = screen.getByRole("button", {
			name: "Open Other Agent",
		});
		expect(within(observerItem).getByText("Other Agent").className).toContain(
			"text-foreground"
		);
		const observerAvatar = within(observerItem).getByTestId(
			"agent-profile-controller-avatar-agent-other"
		);
		expect(observerAvatar.className).toContain("grayscale");
		expect(observerAvatar.className).toContain("opacity-55");
		expect(observerItem.textContent).toContain("No Controller connected");
	});

	it("switches the main content to Agent requests without creating another request state", () => {
		const onViewChange = vi.fn();
		renderWorkspace({ activeView: "requests", onViewChange });

		expect(screen.getByTestId("agent-requests-panel")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Back to Agents" }));
		expect(onViewChange).toHaveBeenCalledWith("agents");
	});
	it("confirms only visible selected Agents, cancels without deleting, and retains a failed selection", async () => {
		let finishDeletion!: (
			failures: { profileId: string; message: string }[]
		) => void;
		const onDeleteProfiles = vi.fn(
			(_profiles: readonly AuthProfileView[]) =>
				new Promise<{ profileId: string; message: string }[]>((resolve) => {
					finishDeletion = resolve;
				})
		);
		const onSelectProfile = vi.fn();
		renderWorkspace({ onDeleteProfiles, onSelectProfile });
		fireEvent.click(screen.getByRole("button", { name: "Select Agents" }));
		fireEvent.click(screen.getByLabelText("Select Felix Agent"));
		expect(onSelectProfile).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Search Agents" }));
		fireEvent.change(screen.getByRole("searchbox", { name: "Search Agents" }), {
			target: { value: "Felix Agent" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
		fireEvent.click(screen.getByRole("button", { name: "Delete (1)" }));
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("Felix Agent")).toBeTruthy();
		expect(within(dialog).queryByText("Other Agent")).toBeNull();
		expect(onDeleteProfiles).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(onDeleteProfiles).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Delete (1)" }));
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "Delete 1 Agent",
			})
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(screen.getByText("Deleting 1 Agent…")).toBeTruthy();
		expect(screen.queryByLabelText("Select Felix Agent")).toBeNull();
		await waitFor(() => expect(onDeleteProfiles).toHaveBeenCalledTimes(1));
		expect(
			onDeleteProfiles.mock.calls[0]?.[0].map(
				(profile: AuthProfileView) => profile.openMeldProfileId
			)
		).toEqual(["agent-current"]);
		finishDeletion([
			{ profileId: "agent-current", message: "Permission changed." },
		]);
		expect(
			await screen.findByText("Felix Agent: Permission changed.")
		).toBeTruthy();
		expect(
			(screen.getByLabelText("Select Felix Agent") as HTMLInputElement).checked
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Review failed Agents" })
		);
		expect(
			within(screen.getByRole("dialog")).getByText("Felix Agent")
		).toBeTruthy();
	});

	it("omits the Organization-only request entry in a personal workspace", () => {
		renderWorkspace({ showAgentRequests: false });

		expect(screen.queryByRole("button", { name: "Agent requests" })).toBeNull();
	});

	it("filters the existing cards and allows clearing a failed search", () => {
		renderWorkspace();
		fireEvent.click(screen.getByRole("button", { name: "Search Agents" }));
		const search = screen.getByRole("searchbox", { name: "Search Agents" });
		fireEvent.change(search, { target: { value: "not-a-person" } });
		expect(
			screen.getByText("No Agents match. Try another search or clear filters.")
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Open Felix Agent" })
		).toBeNull();
		fireEvent.change(search, { target: { value: "" } });
		expect(
			screen.getByRole("button", { name: "Open Felix Agent" })
		).toBeTruthy();
	});
	it.each([
		false,
		true,
	])("offers creation when an owned Agent list is empty (My Agents: %s)", (myAgents) => {
		const onCreateAgent = vi.fn();
		const { rerenderWorkspace } = renderWorkspace({
			profiles: [],
			...(myAgents ? { person: undefined } : {}),
			onCreateAgent,
		});
		if (myAgents) {
			fireEvent.click(screen.getByRole("tab", { name: "My Agents" }));
		}
		expect(screen.getByText("No Agents yet.")).toBeTruthy();
		expect(
			screen.getByText("Create your first Agent to start working together.")
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		expect(onCreateAgent).toHaveBeenCalledOnce();
		rerenderWorkspace({ canCreateAgent: false });
		expect(
			screen.queryByText("Create your first Agent to start working together.")
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Create Agent" })).toBeNull();
		expect(screen.getByText("No Agents yet.")).toBeTruthy();
	});
	it.each([
		false,
		true,
	])("keeps the return destination while loading details (directory: %s)", (fromDirectory) => {
		const { rerenderWorkspace } = renderWorkspace({
			profiles: [],
			profilesStatus: "loading",
			selectedProfileId: "agent-other",
			agentListReturn: fromDirectory
				? { to: "/o/test/agents", label: "Back to Agents" }
				: undefined,
		});
		expect(screen.getByRole("navigation", { name: "Agents" })).toBeTruthy();
		expect(
			screen
				.getByRole("link", {
					name: fromDirectory ? "Back to Agents" : "Felix’s Agents",
				})
				.getAttribute("href")
		).toBe(fromDirectory ? "/o/test/agents" : "/people/person/agents");
		expect(
			screen.getByRole("status", { name: "Loading Agent details" })
		).toBeTruthy();
		expect(screen.getByText("Usage limits")).toBeTruthy();
		expect(screen.queryByText("Agent not found")).toBeNull();
		rerenderWorkspace({
			profiles: [
				createProfile("agent-other", "user-other", "Mira", "Other Agent"),
			],
			profilesStatus: "ready",
		});
		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Other Agent"
		);
		expect(
			screen.queryByRole("status", { name: "Loading Agent details" })
		).toBeNull();
	});

	it("distinguishes loading, failure, and the ready empty state", () => {
		const { rerenderWorkspace } = renderWorkspace({
			profiles: [],
			profilesStatus: "loading",
		});
		expect(screen.getByRole("status").textContent).toContain("Loading Agents");
		rerenderWorkspace({
			profilesStatus: "error",
			profilesErrorMessage: "Directory unavailable",
		});
		expect(screen.getByText("Directory unavailable")).toBeTruthy();
		rerenderWorkspace({ profilesStatus: "ready" });
		expect(screen.getByText("No Agents yet.")).toBeTruthy();
	});
});

function renderWorkspace(
	overrides: Partial<Parameters<typeof AgentProfilesWorkspace>[0]> = {}
) {
	const profiles = [
		createProfile("agent-current", CURRENT_USER_ID, "Felix", "Felix Agent"),
		createProfile("agent-other", "user-other", "Mira", "Other Agent"),
	];
	const createTree = (
		nextOverrides: Partial<Parameters<typeof AgentProfilesWorkspace>[0]>
	) => (
		<AgentProfilesWorkspace
			activeView="agents"
			creationAttentionCount={0}
			currentUserId={CURRENT_USER_ID}
			initialSidebarStates={undefined}
			members={[
				[CURRENT_USER_ID, "Felix"],
				["user-other", "Mira"],
			].map(([userId = "", name = ""]) => ({
				humanProfile: null,
				joinedAt: "2026-08-01T00:00:00.000Z",
				memberId: userId,
				organizationId: "org-test",
				role: "member",
				userId,
				user: { id: userId, name, image: null, email: `${userId}@example.com` },
			}))}
			modelCatalog={TEST_MODEL_CATALOG}
			onCreateAgent={vi.fn()}
			onSelectProfile={vi.fn()}
			onViewChange={vi.fn()}
			person={{
				id: "person",
				name: "Felix",
				path: "/people/person",
				agentsPath: "/people/person/agents",
			}}
			profiles={profiles}
			profilesStatus="ready"
			readinessByProfileId={new Map([["agent-current", createReadiness()]])}
			renderProfileDetail={(profile) => (
				<div data-testid="selected-agent-detail">{profile.profileName}</div>
			)}
			renderProfilesController={() => <div data-testid="profiles-controller" />}
			requestPanel={<div data-testid="agent-requests-panel">Requests</div>}
			selectedProfileId={null}
			{...nextOverrides}
		/>
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const rendered = render(createTree(overrides), {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
	// These cases inspect individual cards. The directory now starts with
	// collapsed controller folders; select the public flat view first.
	const viewSettings = screen.queryByRole("button", {
		name: "Agent view settings",
	});
	if (viewSettings) {
		fireEvent.click(viewSettings);
		fireEvent.click(screen.getByRole("menuitemradio", { name: "None" }));
	}
	return {
		...rendered,
		rerenderWorkspace: (
			nextOverrides: Partial<Parameters<typeof AgentProfilesWorkspace>[0]>
		) => rendered.rerender(createTree({ ...overrides, ...nextOverrides })),
	};
}

function createProfile(
	profileId: string,
	ownerUserId: string,
	ownerName: string,
	profileName: string,
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		avatarUrl: undefined,
		createdAt: "2026-08-01T00:00:00.000Z",
		createdByUserId: ownerUserId,
		creatorProfileId: null,
		isDefault: false,
		lastUsedAt: null,
		managedRole: null,
		openMeldProfileId: profileId,
		ownerName,
		ownerUserId,
		profileHandle: profileId,
		profileKind: "agent",
		profileName,
		source: "web_create",
		status: "active",
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function createReadiness(): GetAgentExecutionReadinessResponse {
	return {
		agentControllerRef: "builtin:codex",
		agentExecutionReadiness: {
			agentProfileId: "agent-current",
			displayState: "ready",
			facts: {
				binding: {
					reasonCodes: [],
					routable: true,
					source: "binding_truth",
				},
				claim: {
					executionBlocked: false,
					grantsClaimSuccess: true,
					reasonCodes: [],
					source: "claim_truth",
				},
				localService: {
					ready: true,
					reasonCodes: [],
					source: "service_truth",
				},
				provider: {
					ready: true,
					reasonCodes: [],
					source: "provider_truth",
				},
				serviceVersion: {
					compatible: true,
					reasonCodes: [],
					source: "service_truth",
				},
			},
			primaryAction: "none",
			reasonCodes: [],
		},
		agentWakeAvailability: {
			action: "none",
			badgeLabel: "Available",
			category: "available",
			phase: "ready",
			reasonCode: "agent.available_for_wake",
			status: "available_for_wake",
			tooltip: "Available for Wake",
		},
		checkedAtMs: 1_788_000_000_000,
		freshUntilMs: 1_788_000_030_000,
		organizationAuthorization: null,
		primaryActionPlan: { action: "none", reasonCodes: [] },
		primaryBinding: {
			agentProfileId: "agent-current",
			authoritySource: "profile_primary_binding",
			bindingState: "enabled_primary",
			dispatchEligibility: {
				reasonCodes: [],
				routable: true,
				status: "routable",
			},
			executionTarget: {
				agentControllerConversationId: null,
				agentControllerRef: "builtin:codex",
				deviceId: "computer-1",
				runtimeLane: "published",
			},
			grantsClaimSuccess: true,
			modelSelection: {
				modelId: "gpt-5.6-sol",
				reasoningLevel: null,
			},
			reasonCodes: [],
			resolutionSource: "profile_primary_binding",
			routable: true,
		},
		routeDeviceId: "computer-1",
		routeLane: "published",
		routeSource: "profile_primary_binding",
		runtimeDeviceDisplayName: "Felix’s MacBook Pro",
	} as unknown as GetAgentExecutionReadinessResponse;
}
