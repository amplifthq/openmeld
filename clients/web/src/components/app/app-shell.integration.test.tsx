import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInitialStartFlowState,
	resolveStartFlowStorageKey,
	serializeStartFlowState,
} from "#/components/app/start-flow-state";
import {
	completeOnboardingProgress,
	createInitialOnboardingProgress,
	writeOnboardingProgress,
} from "#/lib/onboarding/onboarding-progress";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { AppShell } from "./app-shell";
import type { AppShellSection } from "./shell-layout";

const routerMatchesMock = vi.hoisted(() => vi.fn());
const useRouterStateMock = vi.hoisted(() => vi.fn());
const useNavigateMock = vi.hoisted(() => vi.fn());
const listStartProfilesMock = vi.hoisted(() => vi.fn());
const listAccountSpaceItemsMock = vi.hoisted(() => vi.fn());

const SPACES_TAB_NAME = /Spaces/;
const SPACE_OR_SPACES_TAB_NAME = /^Spaces?$/;
const PEOPLE_TAB_NAME = /People/;
const SETTINGS_TAB_NAME = /Settings/;
const TEST_ACCOUNT = {
	email: "felix@example.com",
	image: null,
	name: "Felix",
};
const TEST_ORGANIZATION_SCOPE = {
	access: "authorized",
	account: TEST_ACCOUNT,
	activeOrganization: {
		id: "org-123",
		name: "Acme",
		slug: "acme",
	},
	currentOrganization: {
		id: "org-123",
		name: "Acme",
		slug: "acme",
	},
	organizations: [
		{
			id: "org-123",
			name: "Acme",
			slug: "acme",
		},
	],
	currentUserId: "user-123",
	storageScope: "user-123",
} satisfies OrganizationScopeAuthorized;

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	Outlet: () => <div>outlet</div>,
	useLocation: () => ({ pathname: useRouterStateMock() }),
	useNavigate: () => useNavigateMock,
	useMatches: (input?: {
		select?: (
			matches: readonly { staticData: { appShellSection?: AppShellSection } }[]
		) => unknown;
	}) =>
		input?.select
			? input.select(
					routerMatchesMock().map(
						(match: { staticData: { appShellSection?: AppShellSection } }) => ({
							...match,
							params: {},
						})
					)
				)
			: routerMatchesMock(),
	useRouterState: (input: {
		select: (state: { location: { pathname: string } }) => string;
	}) => input.select({ location: { pathname: useRouterStateMock() } }),
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: () => listStartProfilesMock(),
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	hasAccountSpaceItems: (
		sections:
			| {
					pinnedItems: readonly unknown[];
					spaceItems: readonly unknown[];
			  }
			| null
			| undefined
	) =>
		(sections?.pinnedItems.length ?? 0) + (sections?.spaceItems.length ?? 0) >
		0,
	listAccountSpaceItems: () => listAccountSpaceItemsMock(),
}));

describe("AppShell", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		writeOnboardingProgress({
			progress: completeOnboardingProgress({
				current: createInitialOnboardingProgress({ nowMs: 1 }),
				nowMs: 2,
			}),
			storage: window.localStorage,
			storageScope: "user-123",
		});
		useNavigateMock.mockReset();
		useRouterStateMock.mockReset().mockReturnValue("/o/acme/connect");
		routerMatchesMock.mockReset();
		setRenderedAppSection("start");
		listStartProfilesMock.mockReset().mockResolvedValue([
			{
				openMeldProfileId: "11111111-1111-4111-8111-111111111111",
				profileName: "Felix",
				profileHandle: "felix",
				profileKind: "human",
				isDefault: true,
				status: "active",
				ownerUserId: "user-123",
				source: "auth_bootstrap",
				bindingState: "unbound",
				createdByUserId: "user-123",
				creatorProfileId: null,
				lastUsedAt: null,
				createdAt: "2026-04-19T00:00:00.000Z",
				updatedAt: "2026-04-19T00:00:00.000Z",
			},
		]);
		listAccountSpaceItemsMock.mockReset().mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
	});

	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		window.sessionStorage.clear();
	});

	it("does not show profile or computer context in the header on start routes", () => {
		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				entryActor: "human",
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				localAgentSetupChoice: "setup_this_computer",
			})
		);

		renderAppShell();

		expect(screen.queryByText("Current Profile: Felix")).toBeNull();
		expect(screen.queryByText("Computer: Office Mac mini")).toBeNull();
		expect(screen.queryByTestId("cross-page-header-context")).toBeNull();

		const headerRight = screen.getByTestId("cross-page-header-right");
		expect(headerRight.className).toContain("ml-auto");
		expect(
			headerRight.textContent?.includes("Current Profile: Felix")
		).toBeFalsy();
		expect(
			headerRight.textContent?.includes("Computer: Office Mac mini")
		).toBeFalsy();
	});

	it("uses a full-screen shell without the cross-page header on settings routes", () => {
		useRouterStateMock.mockReturnValue("/o/acme/settings/account");
		setRenderedAppSection("settings");

		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				entryActor: "human",
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				localAgentSetupChoice: "setup_this_computer",
			})
		);

		renderAppShell();

		expect(screen.queryByText("Current Profile: Felix")).toBeNull();
		expect(screen.queryByText("Computer: Office Mac mini")).toBeNull();
		expect(screen.queryByTestId("cross-page-header-context")).toBeNull();
		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("tab", { name: "New Space" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it("uses a full-screen shell without the cross-page header on People routes", () => {
		useRouterStateMock.mockReturnValue("/o/acme/people");
		setRenderedAppSection("people");

		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				entryActor: "human",
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				localAgentSetupChoice: "setup_this_computer",
			})
		);

		renderAppShell();

		expect(screen.queryByText("Current Profile: Felix")).toBeNull();
		expect(screen.queryByText("Computer: Office Mac mini")).toBeNull();
		expect(screen.queryByTestId("cross-page-header-context")).toBeNull();
		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it.each([
		"/o/acme/projects",
		"/o/acme/projects/project-123",
	])("uses a full-screen shell without the cross-page header on %s", (pathname) => {
		useRouterStateMock.mockReturnValue(pathname);
		setRenderedAppSection("projects");

		renderAppShell();

		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it("hides the Spaces tab on start routes when the selected profile has no joined spaces", async () => {
		useRouterStateMock.mockReturnValue("/o/acme");
		setRenderedAppSection("start");

		renderAppShell();

		expect(
			await screen.findByRole("tab", { name: PEOPLE_TAB_NAME })
		).toBeTruthy();
		expect(
			screen.queryByRole("tab", { name: SPACE_OR_SPACES_TAB_NAME })
		).toBeNull();
		expect(screen.getByRole("tab", { name: PEOPLE_TAB_NAME })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: SETTINGS_TAB_NAME })).toBeNull();
	});

	it("navigates through the subtle header tabs on start routes when spaces exist", async () => {
		useRouterStateMock.mockReturnValue("/o/acme");
		setRenderedAppSection("start");
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				{
					joinedProfiles: [],
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					openProfileId: "11111111-1111-4111-8111-111111111111",
					openProfileName: "Felix",
					pinnedAt: null,
					pinnedProfileIds: [],
					spaceId: "space-alpha",
					spaceName: "Alpha",
				},
			],
		});

		renderAppShell();

		const spacesTab = await screen.findByRole("tab", { name: SPACES_TAB_NAME });
		const peopleTab = screen.getByRole("tab", { name: PEOPLE_TAB_NAME });
		expect(spacesTab.compareDocumentPosition(peopleTab)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);

		fireEvent.click(spacesTab);
		expect(useNavigateMock).toHaveBeenCalledWith({ to: "/o/acme/spaces" });

		fireEvent.click(peopleTab);
		expect(useNavigateMock).toHaveBeenCalledWith({
			to: "/o/acme/people",
		});
	});

	it("uses the full-screen shell without the legacy cross-page header on connect routes", () => {
		useRouterStateMock.mockReturnValue("/o/acme/connect");
		setRenderedAppSection("connect");

		renderAppShell();

		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("link", { name: "Back to Spaces" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it.each([
		"/o/acme/spaces",
		"/o/acme/spaces/space-123",
	])("uses a full-screen shell without the cross-page header on %s", (pathname) => {
		useRouterStateMock.mockReturnValue(pathname);
		setRenderedAppSection("space");

		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				entryActor: "human",
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				localAgentSetupChoice: "setup_this_computer",
			})
		);

		renderAppShell();

		expect(screen.queryByText("Current Profile: Felix")).toBeNull();
		expect(screen.queryByText("Computer: Office Mac mini")).toBeNull();
		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("tab", { name: "Space" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "New Space" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it("keeps the rendered Space shell while the live URL is already Agents", () => {
		useRouterStateMock.mockReturnValue("/o/acme/agents");
		setRenderedAppSection("space");

		renderAppShell();

		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it("renders the URL organization immediately when the Session default differs", () => {
		useRouterStateMock.mockReturnValue("/o/beta/settings/account");
		setRenderedAppSection("settings");

		renderAppShell({
			...TEST_ORGANIZATION_SCOPE,
			activeOrganization: {
				id: "org-123",
				name: "Acme",
				slug: "acme",
			},
			currentOrganization: {
				id: "org-456",
				name: "Beta",
				slug: "beta",
			},
		});

		expect(screen.getByText("outlet")).toBeTruthy();
		expect(screen.queryByText("Opening Beta…")).toBeNull();
	});
});

function setRenderedAppSection(section: AppShellSection) {
	routerMatchesMock.mockReturnValue([
		{ staticData: {} },
		{ staticData: { appShellSection: "start" } },
		{ staticData: { appShellSection: section } },
	]);
}

function renderAppShell(
	organizationScope: OrganizationScopeAuthorized = TEST_ORGANIZATION_SCOPE
) {
	return renderWithProviders(
		<AppShell
			account={TEST_ACCOUNT}
			organizationScope={organizationScope}
			storageScope="user-123"
		/>
	);
}

function renderWithProviders(input: ReactNode) {
	return render(<TestQueryClientProvider>{input}</TestQueryClientProvider>);
}
