import type { AccountSession, FirstWorkResponse } from "@openmeld/schemas";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInitialStartFlowState,
	resolveStartFlowStorageKey,
	serializeStartFlowState,
} from "#/components/app/start-flow-state";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { userQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { AppShell } from "./app-shell";
import type { AppShellSection } from "./shell-layout";

const routerMatchesMock = vi.hoisted(() => vi.fn());
const useRouterStateMock = vi.hoisted(() => vi.fn());
const useNavigateMock = vi.hoisted(() => vi.fn());
const listStartProfilesMock = vi.hoisted(() => vi.fn());
const listAccountSpaceItemsMock = vi.hoisted(() => vi.fn());
const readFirstWorkMock = vi.hoisted(() => vi.fn());
const readSessionResponse = vi.hoisted(() => vi.fn<() => Promise<Response>>());
vi.mock("@tanstack/react-start", () => ({
	createIsomorphicFn: () => ({
		client: (client: (...args: unknown[]) => unknown) => ({
			server: () => client,
		}),
	}),
}));
vi.mock("@openmeld/api-client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/api-client")>()),
	createFirstWorkApi: () => ({ read: readFirstWorkMock }),
}));
vi.mock("#/components/inbox/inbox-browser-notification-prompt", () => ({
	InboxBrowserNotificationPrompt: () => (
		<div data-testid="notification-introduction" />
	),
}));
vi.mock("#/components/inbox/inbox-notification-listener", async () => {
	const { useCurrentComputer } = await import("./current-computer");
	return {
		InboxNotificationListener: () => (
			<div data-testid="native-menu-computer-context">
				{useCurrentComputer() ? "provided" : "missing"}
			</div>
		),
	};
});
vi.mock("#/components/settings/app-settings-dialog", async () => {
	const { useCurrentComputer } = await import("./current-computer");
	return {
		default: () => (
			<div data-testid="settings-computer-context">
				{useCurrentComputer() ? "provided" : "missing"}
			</div>
		),
	};
});

const BROWSE_SPACES_TAB_NAME = "Browse spaces";
const TEAM_TAB_NAME = /Team/;
const SETTINGS_TAB_NAME = /Settings/;
const TEST_ACCOUNT = {
	email: "felix@example.com",
	image: null,
	name: "Felix",
};
const TEST_SESSION: AccountSession = {
	user: {
		...TEST_ACCOUNT,
		id: "user-123",
		emailVerified: true,
		createdAt: "2026-04-19T00:00:00.000Z",
	},
	session: { id: "session-123" },
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
	useLocation: (input?: {
		select?: (location: { pathname: string }) => unknown;
	}) => {
		const location = { pathname: useRouterStateMock() };
		return input?.select ? input.select(location) : location;
	},
	useSearch: () => ({}),
	useNavigate: () => useNavigateMock,
	useRouter: () => ({ subscribe: () => () => undefined }),
	useMatches: (input?: {
		select?: (
			matches: readonly { staticData: { appShellSection?: AppShellSection } }[]
		) => unknown;
	}) =>
		input?.select
			? input.select(
					routerMatchesMock().map(
						(match: {
							staticData: { appShellSection?: AppShellSection };
							params?: { spaceId?: string };
						}) => ({
							...match,
							params: match.params ?? {},
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
		readSessionResponse
			.mockReset()
			.mockImplementation(async () => Response.json(TEST_SESSION));
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (resource) => {
				const url = new URL(
					resource instanceof Request ? resource.url : String(resource),
					window.location.origin
				);
				return url.pathname === "/v1/account/session"
					? await readSessionResponse()
					: new Response(null, { status: 503 });
			})
		);
		window.localStorage.clear();
		window.sessionStorage.clear();
		readFirstWorkMock.mockReset().mockResolvedValue({
			record: null,
			hasStartedTutorial: true,
		} satisfies FirstWorkResponse);
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
		vi.unstubAllGlobals();
		window.localStorage.clear();
		window.sessionStorage.clear();
	});

	it("keeps the authorized page visible while background session renewal is pending or unavailable", async () => {
		let resolveSession!: (response: Response) => void;
		const pending = new Promise<Response>((resolve) => {
			resolveSession = resolve;
		});
		readSessionResponse
			.mockReturnValueOnce(pending)
			.mockResolvedValue(new Response(null, { status: 503 }));
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(userQueryKeys.session, TEST_SESSION, {
			updatedAt: 1,
		});
		setRenderedAppSection("space");
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<AppShell
					account={TEST_ACCOUNT}
					organizationScope={TEST_ORGANIZATION_SCOPE}
					storageScope="user-123"
				/>
			</TestQueryClientProvider>
		);

		await screen.findByText("outlet");
		await waitFor(() => expect(readSessionResponse).toHaveBeenCalledTimes(1));
		expect(queryClient.getQueryState(userQueryKeys.session)?.fetchStatus).toBe(
			"fetching"
		);
		expect(screen.getByText("outlet")).toBeTruthy();

		resolveSession(new Response(null, { status: 503 }));
		await waitFor(() =>
			expect(queryClient.getQueryState(userQueryKeys.session)?.status).toBe(
				"error"
			)
		);
		expect(screen.getByText("outlet")).toBeTruthy();
		expect(queryClient.getQueryData(userQueryKeys.session)).toEqual(
			TEST_SESSION
		);
		expect(useNavigateMock).not.toHaveBeenCalled();
		queryClient.clear();
	});

	it.each([
		"home",
		"spaces",
		"directMessages",
		"space",
	] as const)("introduces notifications only inside a Space, not on %s landing", async (section) => {
		routerMatchesMock.mockReturnValue([
			{ staticData: { appShellSection: section }, params: {} },
		]);
		await renderAppShell();
		expect(screen.queryByTestId("notification-introduction")).toBeNull();
	});
	it("shares the real Computer context with the native menu and Settings consumers", async () => {
		await renderAppShell();

		expect(screen.getByTestId("native-menu-computer-context").textContent).toBe(
			"provided"
		);
		expect(screen.getByTestId("settings-computer-context").textContent).toBe(
			"provided"
		);
	});
	it("introduces notifications on the first actual Space entry after onboarding", async () => {
		routerMatchesMock.mockReturnValue([
			{
				staticData: { appShellSection: "space" },
				params: { spaceId: "space-123" },
			},
		]);
		await renderAppShell();
		expect(screen.getByTestId("notification-introduction")).toBeTruthy();
	});

	it("does not show profile or computer context in the header on start routes", async () => {
		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				entryActor: "human",
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				localAgentSetupChoice: "setup_this_computer",
			})
		);

		await renderAppShell();

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

	it("uses a full-screen shell without the cross-page header on settings routes", async () => {
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

		await renderAppShell();

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

	it("uses a full-screen shell without the cross-page header on People routes", async () => {
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

		await renderAppShell();

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
	])("uses a full-screen shell without the cross-page header on %s", async (pathname) => {
		useRouterStateMock.mockReturnValue(pathname);
		setRenderedAppSection("projects");

		await renderAppShell();

		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it("hides Browse spaces while keeping conversations available when no spaces are joined", async () => {
		useRouterStateMock.mockReturnValue("/o/acme");
		setRenderedAppSection("start");

		await renderAppShell();

		expect(
			await screen.findByRole("tab", { name: TEAM_TAB_NAME })
		).toBeTruthy();
		expect(
			screen.queryByRole("tab", { name: BROWSE_SPACES_TAB_NAME })
		).toBeNull();
		expect(screen.getByRole("tab", { name: "Spaces" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: TEAM_TAB_NAME })).toBeTruthy();
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

		await renderAppShell();

		const spacesTab = await screen.findByRole("tab", {
			name: BROWSE_SPACES_TAB_NAME,
		});
		const peopleTab = screen.getByRole("tab", { name: TEAM_TAB_NAME });
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

	it("uses the full-screen shell without the legacy cross-page header on connect routes", async () => {
		useRouterStateMock.mockReturnValue("/o/acme/connect");
		setRenderedAppSection("connect");

		await renderAppShell();

		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("link", { name: "Back to Spaces" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it.each([
		"/o/acme/spaces",
		"/o/acme/spaces/space-123",
	])("uses a full-screen shell without the cross-page header on %s", async (pathname) => {
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

		await renderAppShell();

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

	it("keeps the rendered Space shell while the live URL is already Agents", async () => {
		useRouterStateMock.mockReturnValue("/o/acme/agents");
		setRenderedAppSection("space");

		await renderAppShell();

		expect(screen.queryByTestId("cross-page-header-right")).toBeNull();
		expect(screen.queryByRole("tab", { name: "People" })).toBeNull();
		expect(screen.getByText("outlet").closest("main")?.className).toContain(
			"h-dvh"
		);
	});

	it("renders the URL organization immediately when the Session default differs", async () => {
		useRouterStateMock.mockReturnValue("/o/beta/settings/account");
		setRenderedAppSection("settings");

		await renderAppShell({
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

async function renderAppShell(
	organizationScope: OrganizationScopeAuthorized = TEST_ORGANIZATION_SCOPE
) {
	const view = renderWithProviders(
		<AppShell
			account={TEST_ACCOUNT}
			organizationScope={organizationScope}
			storageScope="user-123"
		/>
	);
	await screen.findByText("outlet");
	return view;
}

function renderWithProviders(input: ReactNode) {
	return render(<TestQueryClientProvider>{input}</TestQueryClientProvider>);
}
