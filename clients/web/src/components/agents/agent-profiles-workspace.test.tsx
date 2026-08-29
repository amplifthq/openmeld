import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
} from "@openmeld/schemas/types";
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

const appFullWidthLayoutSpy = vi.hoisted(() => vi.fn());

vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		sidebar,
		...props
	}: {
		children: ReactNode;
		sidebar: ReactNode;
		[key: string]: unknown;
	}) => (
		<>
			{appFullWidthLayoutSpy(props)}
			<div data-testid="agents-workspace-layout">
				<aside data-testid="agents-secondary-sidebar">{sidebar}</aside>
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
	useAppNavigationPresentation: () => ({ dismiss: vi.fn() }),
}));

const CURRENT_USER_ID = "user-current";

afterEach(() => {
	cleanup();
	appFullWidthLayoutSpy.mockReset();
});

describe("AgentProfilesWorkspace", () => {
	it("puts the current user's owner group first and sorts remaining owners stably", () => {
		const groups = resolveAgentProfileSidebarGroups({
			currentUserId: CURRENT_USER_ID,
			profiles: [
				createProfile("agent-zed", "user-zed", "Zed", "Zed Agent"),
				createProfile("agent-amy", "user-amy", "Amy", "Amy Agent"),
				createProfile("agent-current", CURRENT_USER_ID, "Felix", "Felix Agent"),
			],
		});

		expect(groups.map((group) => group.label)).toEqual([
			"Felix (you)",
			"Amy",
			"Zed",
		]);
	});

	it("keeps Agent requests fixed above owner groups and uses the Core request count", () => {
		renderWorkspace({ pendingRequestCount: 2 });

		const sidebar = screen.getByTestId("agents-secondary-sidebar");
		const requests = within(sidebar).getByRole("button", {
			name: "Agent requests, 2 pending",
		});
		expect(requests.textContent).toContain("Agent requests");
		expect(requests.textContent).toContain("2");
		fireEvent.click(requests);
	});

	it("uses the shared collapsible sidebar and responsive drawer contract", () => {
		renderWorkspace();

		expect(appFullWidthLayoutSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				contentLayout: "flush",
				mobileSidebarTitle: "Agents",
				showMainHeader: true,
				sidebarPreferenceKey: "agents",
				sidebarSeparatorLabel: "Resize the Agents sidebar",
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

	it("shows Controller/model summary and the authoritative Wake availability", () => {
		renderWorkspace();

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(item.textContent).toContain("Codex · gpt-5.6-sol");
		expect(item.textContent).toContain("Available");
		expect(
			within(item).getByTestId("agent-profile-controller-avatar-agent-current")
		).toBeTruthy();
		expect(item.querySelector('[data-profile-kind="center-agent"]')).toBeNull();
		expect(within(item).getByText("Available").getAttribute("title")).toBe(
			"Available for Wake"
		);
	});

	it("shows a readiness refresh error before cached sidebar availability", () => {
		renderWorkspace({
			readinessErrorByProfileId: new Map([
				["agent-current", "Core could not refresh Wake availability."],
			]),
		});

		const item = screen.getByRole("button", { name: "Open Felix Agent" });
		expect(within(item).getByText("Unavailable").getAttribute("title")).toBe(
			"Core could not refresh Wake availability."
		);
		expect(within(item).queryByText("Available")).toBeNull();
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
		expect(screen.queryByRole("button", { name: "Create Agent" })).toBeTruthy();
		expect(
			screen.queryAllByRole("button", { name: "Create Agent" })
		).toHaveLength(1);
		expect(screen.getByTestId("profiles-controller")).toBeTruthy();
	});

	it("distinguishes loading, failure, and the ready empty state", () => {
		const { rerender } = renderWorkspace({
			profiles: [],
			profilesStatus: "loading",
		});
		expect(screen.getByRole("status").textContent).toContain("Loading Agents");

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
		expect(screen.getByRole("heading", { name: "No Agents yet" })).toBeTruthy();
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
	const rendered = render(createTree(overrides));
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
	profileName: string
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
