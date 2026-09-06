const AVAILABLE_STATUS_NAME = /^Available/;

import type { AgentProfileOperationalContextInput } from "@openmeld/agent-profile";
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
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentProfileSidebarGroups } from "./agent-profile-sidebar-groups";
import { AgentProfilesWorkspace } from "./agent-profiles-workspace";

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentUserId: "user-current",
		currentOrganization: { id: "org-test", slug: "test" },
	}),
}));
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: null,
		disabled: true,
		save: vi.fn(),
	}),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const { appFullWidthLayoutSpy, appNavigationPresentationSpy } = vi.hoisted(
	() => ({
		appFullWidthLayoutSpy: vi.fn(),
		appNavigationPresentationSpy: vi.fn(() => ({ dismiss: vi.fn() })),
	})
);

vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainSidebarContent,
		...props
	}: {
		children: ReactNode;
		mainSidebarContent: ReactNode;
		[key: string]: unknown;
	}) => (
		<>
			{appFullWidthLayoutSpy(props)}
			<div data-testid="agents-workspace-layout">
				<aside data-testid="agents-main-sidebar">{mainSidebarContent}</aside>
				<main>{children}</main>
			</div>
		</>
	),
}));

vi.mock("#/components/app/app-contextual-layout", () => ({
	AppContextualSidebarNav: ({
		activeItemId,
		groups,
		leadingContent,
		title,
	}: {
		activeItemId: string | null;
		groups: readonly {
			ariaLabel: string;
			content: ReactNode;
			id: string;
			label: string;
		}[];
		leadingContent: ReactNode;
		title: string;
	}) => (
		<nav aria-label={title}>
			<h1>{title}</h1>
			{leadingContent}
			{groups.map((group) => (
				<section aria-label={group.ariaLabel} key={group.id}>
					<h2>{group.label}</h2>
					<div data-active-profile-id={activeItemId ?? undefined}>
						{group.content}
					</div>
				</section>
			))}
		</nav>
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
	appFullWidthLayoutSpy.mockReset();
	appNavigationPresentationSpy.mockClear();
});

describe("AgentProfilesWorkspace", () => {
	it("keeps the current user's owner group first, then orders owners by Agent activity", () => {
		const groups = resolveAgentProfileSidebarGroups({
			currentUserId: CURRENT_USER_ID,
			operationalContextByProfileId: new Map<
				string,
				AgentProfileOperationalContextInput
			>([
				[
					"agent-zed",
					{
						currentWorkLocation: "Release room",
						queuedWorkLocations: [],
						recoveryAction: null,
						status: "working",
						waitingCount: 0,
					},
				],
			]),
			profiles: [
				createProfile("agent-zed", "user-zed", "Zed", "Zed Agent"),
				createProfile("agent-amy", "user-amy", "Amy", "Amy Agent", {
					lastUsedAt: "2026-09-03T08:00:00.000Z",
				}),
				createProfile("agent-current", CURRENT_USER_ID, "Felix", "Felix Agent"),
			],
		});

		expect(groups.map((group) => group.label)).toEqual([
			"Felix (you)",
			"Zed",
			"Amy",
		]);
	});

	it("orders Agents within an owner by live work, waiting work, and recent use", () => {
		const groups = resolveAgentProfileSidebarGroups({
			currentUserId: CURRENT_USER_ID,
			operationalContextByProfileId: new Map<
				string,
				AgentProfileOperationalContextInput
			>([
				[
					"agent-working",
					{
						currentWorkLocation: "Launch",
						queuedWorkLocations: [],
						recoveryAction: null,
						status: "working",
						waitingCount: 0,
					},
				],
				[
					"agent-waiting",
					{
						currentWorkLocation: "Release",
						queuedWorkLocations: ["Checks"],
						recoveryAction: { kind: "continue_interrupted_work" },
						status: "paused",
						waitingCount: 1,
					},
				],
			]),
			profiles: [
				createProfile("agent-no-activity", CURRENT_USER_ID, "Felix", "Alpha"),
				createProfile("agent-recent", CURRENT_USER_ID, "Felix", "Recent", {
					lastUsedAt: "2026-09-03T09:00:00.000Z",
				}),
				createProfile("agent-working", CURRENT_USER_ID, "Felix", "Working"),
				createProfile("agent-older", CURRENT_USER_ID, "Felix", "Older", {
					lastUsedAt: "2026-09-02T09:00:00.000Z",
				}),
				createProfile("agent-waiting", CURRENT_USER_ID, "Felix", "Waiting"),
			],
		});

		expect(
			groups[0]?.profiles.map((profile) => profile.openMeldProfileId)
		).toEqual([
			"agent-working",
			"agent-waiting",
			"agent-recent",
			"agent-older",
			"agent-no-activity",
		]);
	});

	it("puts a newly created idle Agent ahead of older idle activity", () => {
		const groups = resolveAgentProfileSidebarGroups({
			currentUserId: CURRENT_USER_ID,
			profiles: [
				createProfile("agent-used", CURRENT_USER_ID, "Felix", "Used Agent", {
					createdAt: "2026-08-01T00:00:00.000Z",
					lastUsedAt: "2026-09-02T09:00:00.000Z",
				}),
				createProfile("agent-new", CURRENT_USER_ID, "Felix", "New Agent", {
					createdAt: "2026-09-03T09:00:00.000Z",
					lastUsedAt: null,
				}),
			],
		});

		expect(
			groups[0]?.profiles.map((profile) => profile.openMeldProfileId)
		).toEqual(["agent-new", "agent-used"]);
	});

	it("keeps only profile groups in the main sidebar", () => {
		renderWorkspace({ pendingRequestCount: 2 });
		const sidebar = screen.getByTestId("agents-main-sidebar");
		expect(
			within(sidebar).queryByRole("button", {
				name: "Create Agent",
			})
		).toBeNull();
	});

	it("places Agent search before the availability filter", () => {
		renderWorkspace({
			filterControl: <button type="button">Filter Agents</button>,
			searchControl: <input aria-label="Search Agents" type="search" />,
		});

		const search = screen.getByRole("searchbox", { name: "Search Agents" });
		const filter = screen.getByRole("button", { name: "Filter Agents" });
		expect(filter.parentElement?.firstElementChild?.contains(search)).toBe(
			true
		);
	});

	it("uses the shared collapsible sidebar and responsive drawer contract", () => {
		renderWorkspace();

		expect(appFullWidthLayoutSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				contentLayout: "flush",
				showMainHeader: true,
			})
		);
	});

	it("preserves a selected profile deep link and changes it when another Agent is chosen", () => {
		const onSelectProfile = vi.fn();
		renderWorkspace({
			onSelectProfile,
			selectedProfileId: "agent-other",
		});

		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Other Agent"
		);
		fireEvent.click(screen.getByRole("button", { name: "Open Felix Agent" }));
		expect(onSelectProfile).toHaveBeenCalledWith("agent-current");
	});

	it("retains the first default Agent when readiness ordering changes", () => {
		const onSelectProfile = vi.fn();
		const firstProfile = createProfile(
			"agent-current",
			CURRENT_USER_ID,
			"Felix",
			"Felix Agent"
		);
		const secondProfile = createProfile(
			"agent-current-two",
			CURRENT_USER_ID,
			"Felix",
			"Second Felix Agent"
		);
		const { rerenderWorkspace } = renderWorkspace({
			onSelectProfile,
			profiles: [firstProfile, secondProfile],
		});

		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Felix Agent"
		);
		expect(onSelectProfile).not.toHaveBeenCalled();

		rerenderWorkspace({ profiles: [secondProfile, firstProfile] });

		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Felix Agent"
		);
		expect(onSelectProfile).not.toHaveBeenCalled();
	});

	it("selects the first remaining Agent when a filter removes the implicit selection", () => {
		const firstProfile = createProfile(
			"agent-current",
			CURRENT_USER_ID,
			"Felix",
			"Felix Agent"
		);
		const secondProfile = createProfile(
			"agent-current-two",
			CURRENT_USER_ID,
			"Felix",
			"Second Felix Agent"
		);
		const { rerenderWorkspace } = renderWorkspace({
			profiles: [firstProfile, secondProfile],
		});

		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Felix Agent"
		);

		rerenderWorkspace({ profiles: [secondProfile] });

		expect(screen.getByTestId("selected-agent-detail").textContent).toBe(
			"Second Felix Agent"
		);
		expect(
			screen.queryByRole("heading", { name: "Agent not found" })
		).toBeNull();
	});

	it("does not substitute another Agent for a stale profile deep link", () => {
		renderWorkspace({ selectedProfileId: "agent-missing" });

		expect(
			screen.getByRole("heading", { name: "Agent not found" })
		).toBeTruthy();
		expect(screen.queryByTestId("selected-agent-detail")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Open Felix Agent" })
		).toBeTruthy();
		expect(screen.getByTestId("profiles-controller")).toBeTruthy();
	});

	it("keeps ready and idle as the quiet default", () => {
		renderWorkspace();

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(item.textContent).toContain("Codex · GPT-5.6 Sol · model default");
		expect(
			within(item).getByRole("img", { name: AVAILABLE_STATUS_NAME })
		).toBeTruthy();
		expect(item.textContent).not.toContain("Idle");
		expect(
			within(item).queryByTestId("agent-profile-operational-status")
		).toBeNull();
		expect(
			within(item).getByTestId("agent-profile-controller-avatar-agent-current")
		).toBeTruthy();
		const avatar = within(item).getByTestId(
			"agent-profile-controller-avatar-agent-current"
		);
		expect(avatar.style.height).toBe("24px");
		expect(avatar.style.width).toBe("24px");
		expect(avatar.className).toContain("rounded-lg");
		expect(avatar.className).toContain("overflow-hidden");
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
		expect(
			within(item).getByRole("img", { name: AVAILABLE_STATUS_NAME })
		).toBeTruthy();
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

	it("shows the Controller default model when no model is explicitly selected", () => {
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
		expect(item.textContent).toContain("Codex · GPT-5.6 Sol · model default");
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
		expect(
			within(item).getByRole("img", { name: AVAILABLE_STATUS_NAME })
		).toBeTruthy();
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
		expect(
			within(item).getByRole("img", { name: "Couldn’t check availability." })
		).toBeTruthy();
		expect(item.textContent).not.toContain("Unavailable");
	});

	it("keeps Offline and Unavailable rows static gray and less prominent for every viewer", () => {
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
		expect(
			within(item).getByRole("img", { name: "Unavailable" }).className
		).toContain("text-muted-foreground");
		expect(within(item).getByText("Felix Agent").className).toContain(
			"text-muted-foreground"
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
			"text-muted-foreground"
		);
		const observerAvatar = within(observerItem).getByTestId(
			"agent-profile-controller-avatar-agent-other"
		);
		expect(observerAvatar.className).toContain("grayscale");
		expect(observerAvatar.className).toContain("opacity-55");
		expect(observerItem.textContent).not.toContain("No Controller connected");
	});

	it("switches the main content to Agent requests without creating another request state", () => {
		const onViewChange = vi.fn();
		renderWorkspace({ activeView: "requests", onViewChange });

		expect(screen.getByTestId("agent-requests-panel")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Back to Agents" }));
		expect(onViewChange).toHaveBeenCalledWith("agents");
	});

	it("omits the Organization-only request entry in a personal workspace", () => {
		renderWorkspace({ showAgentRequests: false });

		expect(screen.queryByRole("button", { name: "Agent requests" })).toBeNull();
	});

	it("distinguishes a filtered empty list from a workspace with no Agents", () => {
		renderWorkspace({ hasAnyProfiles: true, profiles: [] });

		expect(
			screen.getByRole("heading", { name: "No Agents match this filter" })
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Create Agent" })).toBeNull();
		expect(
			screen.queryAllByRole("button", { name: "Create Agent" })
		).toHaveLength(0);
		expect(screen.getByTestId("profiles-controller")).toBeTruthy();
	});

	it("turns the ready empty workspace into one centered creation action", () => {
		const onCreateAgent = vi.fn();
		renderWorkspace({ onCreateAgent, profiles: [] });

		const createCard = screen.getByTestId("create-agent-empty-state");
		expect(createCard.tagName).toBe("BUTTON");
		expect(
			screen.getByRole("heading", { name: "Bring your AI into Spaces" })
		).toBeTruthy();
		expect(createCard.textContent).toContain("Create Agent");
		expect(
			screen.getByText(
				"Use your own computer or a teammate’s, with their permission."
			)
		).toBeTruthy();
		fireEvent.click(createCard);
		expect(onCreateAgent).toHaveBeenCalledOnce();
	});

	it("explains an empty Agent search without blaming the availability filter", () => {
		renderWorkspace({
			hasAnyProfiles: true,
			isSearchActive: true,
			profiles: [],
		});

		expect(
			screen.getByRole("heading", { name: "No Agents found" })
		).toBeTruthy();
		expect(
			screen.getByText("Try another name, owner, Controller, or model.")
		).toBeTruthy();
	});

	it("distinguishes loading, failure, and the ready empty state", () => {
		const { rerender } = renderWorkspace({
			profiles: [],
			profilesStatus: "loading",
		});
		expect(
			screen
				.getAllByRole("status")
				.some((element) => element.textContent?.includes("Loading Agents"))
		).toBe(true);

		rerender(
			<AgentProfilesWorkspace
				activeView="agents"
				currentUserId={CURRENT_USER_ID}
				onCreateAgent={vi.fn()}
				onSelectProfile={vi.fn()}
				onViewChange={vi.fn()}
				pendingRequestCount={0}
				profiles={[]}
				profilesErrorMessage="Directory unavailable"
				profilesStatus="error"
				readinessByProfileId={new Map()}
				renderProfileDetail={() => null}
				renderProfilesController={() => null}
				requestPanel={null}
				selectedProfileId={null}
			/>
		);
		expect(screen.getByRole("alert").textContent).toContain(
			"Directory unavailable"
		);

		rerender(
			<AgentProfilesWorkspace
				activeView="agents"
				currentUserId={CURRENT_USER_ID}
				onCreateAgent={vi.fn()}
				onSelectProfile={vi.fn()}
				onViewChange={vi.fn()}
				pendingRequestCount={0}
				profiles={[]}
				profilesStatus="ready"
				readinessByProfileId={new Map()}
				renderProfileDetail={() => null}
				renderProfilesController={() => null}
				requestPanel={null}
				selectedProfileId={null}
			/>
		);
		expect(screen.getByTestId("create-agent-empty-state")).toBeTruthy();
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
			currentUserId={CURRENT_USER_ID}
			initialSidebarStates={undefined}
			modelCatalog={TEST_MODEL_CATALOG}
			onCreateAgent={vi.fn()}
			onSelectProfile={vi.fn()}
			onViewChange={vi.fn()}
			pendingRequestCount={0}
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
