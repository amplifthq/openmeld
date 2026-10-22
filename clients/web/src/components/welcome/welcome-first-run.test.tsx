import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { SpaceCreationSidebar } from "#/components/spaces/space-creation-sidebar";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { WelcomeFirstRun } from "./welcome-first-run";

const tutorial = vi.hoisted(() => ({
	record: null as import("@openmeld/schemas").FirstWorkRecord | null,
	create: vi.fn(),
}));

vi.mock(
	"#/components/onboarding/walkthrough/walkthrough-context",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/components/onboarding/walkthrough/walkthrough-context")
		>()),
		useWalkthrough: () => (tutorial.record ? tutorial : null),
	})
);

const { listAccountSpaceItemsMock, navigateMock, createSpaceMock, routerMock } =
	vi.hoisted(() => ({
		createSpaceMock: vi.fn(),
		routerMock: { state: { location: { pathname: "/o/acme/new-space" } } },
		navigateMock: vi.fn(async () => undefined),
		listAccountSpaceItemsMock: vi.fn(),
	}));
const JOIN_CHOICE = /Join a Space/;
const CREATE_CHOICE = /Create a Space/;

vi.mock("@openmeld/start", () => ({
	buildOnboardingPlan: () => ({}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
	useRouter: () => routerMock,
	useLocation: ({
		select,
	}: {
		select: (location: { pathname: string }) => unknown;
	}) => select(routerMock.state.location),
	Link: ({
		to,
		children,
		...props
	}: {
		to: string;
		children: import("react").ReactNode;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock(
	"#/lib/spaces/create-space-in-organization",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("#/lib/spaces/create-space-in-organization")
		>()),
		createSpaceInOrganization: (...args: unknown[]) => createSpaceMock(...args),
	})
);

vi.mock("#/components/agents/use-local-runtime-queries", () => ({
	useLocalRuntimeQueries: () => ({
		currentDeviceTargetQuery: { data: undefined, isSuccess: false },
		localRuntimesQuery: { data: undefined, isSuccess: false },
	}),
}));

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "account-1" }),
}));

vi.mock("#/hooks/account.hooks", () => ({
	useUpdateUserName: () => ({ isPending: false, mutate: vi.fn() }),
}));

vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => ({
		data: { user: { id: "user-1", name: "Mira" } },
		isPending: false,
	}),
}));

vi.mock("#/lib/onboarding/onboarding-facts", () => ({
	resolveOnboardingFacts: () => ({}),
}));

vi.mock("#/lib/onboarding/space-onboarding-plan", () => ({
	mapAccountProfiles: () => [],
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => null,
	useAppOrganization: () => ({
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
	}),
}));

vi.mock("#/lib/profiles/human-profiles", () => ({
	listActiveProfilesByKind: () => [],
}));

vi.mock("#/lib/profiles/use-selected-human-profile", () => ({
	useSelectedHumanProfile: () => ({
		profilesQuery: { data: [], isPending: false },
		selectedHumanProfile: {
			openMeldProfileId: "human-1",
			profileName: "Mira",
		},
	}),
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: (...args: unknown[]) =>
		listAccountSpaceItemsMock(...args),
}));

vi.mock("./select-welcome-screen", () => ({
	selectWelcomeScreen: () => "space",
}));

vi.mock("./welcome-computer-setup", () => ({
	shouldOfferWelcomeComputerSetup: () => false,
}));

beforeAll(() => {
	if (typeof window.matchMedia !== "function") {
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: (query: string) => ({
				addEventListener: () => undefined,
				addListener: () => undefined,
				dispatchEvent: () => false,
				matches: false,
				media: query,
				onchange: null,
				removeEventListener: () => undefined,
				removeListener: () => undefined,
			}),
			writable: true,
		});
	}

	if (typeof globalThis.ResizeObserver === "undefined") {
		globalThis.ResizeObserver = class {
			disconnect() {
				return undefined;
			}
			observe() {
				return undefined;
			}
			unobserve() {
				return undefined;
			}
		} as unknown as typeof ResizeObserver;
	}
});

describe("WelcomeFirstRun", () => {
	beforeEach(() => {
		tutorial.record = null;
		tutorial.create.mockReset();
		focusManager.setFocused(false);
		listAccountSpaceItemsMock.mockReset();
		createSpaceMock.mockReset();
		navigateMock.mockClear();
		routerMock.state.location.pathname = "/o/acme/new-space";
	});

	it("creates the tutorial's reserved Space instead of an unrelated optimistic Space", async () => {
		const spaceId = "a".repeat(64);
		tutorial.record = {
			organizationId: "org-acme",
			profileId: "human-1",
			spaceId,
			runId: "c1d4aa28-5eee-4a99-9622-7b4e604ba0bb",
			revision: 0,
			iteration: 1,
			step: "create-space",
			paused: false,
		};
		tutorial.create.mockResolvedValue(spaceId);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		render(
			<QueryClientProvider client={client}>
				<WelcomeFirstRun />
			</QueryClientProvider>
		);
		fireEvent.click(await screen.findByRole("button", { name: CREATE_CHOICE }));
		expect(
			(screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value
		).toBe("Welcome to OpenMeld");
		fireEvent.click(
			screen.getByRole("button", { name: "Create", exact: true })
		);
		await waitFor(() =>
			expect(navigateMock).toHaveBeenCalledWith({
				to: `/o/acme/spaces/${spaceId}?profileId=human-1`,
				replace: true,
			})
		);
		expect(tutorial.create).toHaveBeenCalledTimes(1);
		expect(createSpaceMock).not.toHaveBeenCalled();
		client.clear();
	});

	it.each([
		"success",
		"failure",
		"left-page",
	])("keeps one creation visible and handles %s without waiting for list refresh", async (outcome) => {
		const response = Promise.withResolvers<{ spaceId: string }>();
		createSpaceMock.mockReturnValue(response.promise);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
		const client = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		});
		const renderCreation = (spaceIds: string[] = []) => (
			<QueryClientProvider client={client}>
				<SpaceCreationSidebar
					onNavigate={() => undefined}
					organizationId="org-acme"
					orgSlug="acme"
					profileId="human-1"
					spaceIds={spaceIds}
				/>
				<WelcomeFirstRun />
			</QueryClientProvider>
		);
		const view = render(renderCreation());
		fireEvent.click(await screen.findByRole("button", { name: CREATE_CHOICE }));
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Design review" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Create", exact: true })
		);
		expect(
			await screen.findByRole("button", { name: "Creating…" })
		).toBeTruthy();
		const creationPath =
			screen
				.getByRole("link", { name: "Design review, Creating…" })
				.getAttribute("href") ?? "";
		expect(creationPath.startsWith("/o/acme/spaces/creating-")).toBe(true);
		expect(navigateMock).toHaveBeenCalledWith({ to: creationPath });
		routerMock.state.location.pathname = creationPath.split("?")[0] ?? "";
		navigateMock.mockClear();
		fireEvent.click(screen.getByRole("button", { name: "Creating…" }));
		expect(createSpaceMock).toHaveBeenCalledTimes(1);
		if (outcome === "failure") {
			// Returning while pending must retain the draft and block another create.
			view.unmount();
			render(renderCreation());
			await screen.findByRole("button", { name: "Creating…" });
			await act(async () => response.reject(new Error("Connection lost")));
			expect(
				await screen.findByText(
					"Couldn't confirm that the Space was created. Check Spaces before trying again."
				)
			).toBeTruthy();
			expect(
				(screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement)
					.value
			).toBe("Design review");
			expect(
				screen.queryByRole("link", { name: "Design review, Creating…" })
			).toBeNull();
			expect(navigateMock).not.toHaveBeenCalled();
		} else {
			listAccountSpaceItemsMock.mockReturnValue(new Promise(() => undefined));
			if (outcome === "left-page") {
				routerMock.state.location.pathname = "/o/acme/spaces/other";
			}
			await act(async () => response.resolve({ spaceId: "space-created" }));
			expect(
				await screen.findByRole("link", { name: "Design review", exact: true })
			).toBeTruthy();
			if (outcome === "success") {
				expect(navigateMock).toHaveBeenCalledWith({
					to: "/o/acme/spaces/space-created?profileId=human-1",
					replace: true,
				});
			} else {
				expect(navigateMock).not.toHaveBeenCalled();
			}
			// Retire the receipt once the real list catches up. It must not return
			// later if the Space disappears from that list.
			view.rerender(renderCreation(["space-created"]));
			await waitFor(() => {
				expect(client.getMutationCache().getAll()).toHaveLength(0);
			});
			view.rerender(renderCreation());
			expect(
				screen.queryByRole("link", { name: "Design review", exact: true })
			).toBeNull();
		}
		client.clear();
	});

	afterEach(() => {
		cleanup();
		focusManager.setFocused(undefined);
	});

	it("opens Discover instead of existing memberships when the account list refresh fails", async () => {
		listAccountSpaceItemsMock
			.mockResolvedValueOnce({
				pinnedItems: [],
				spaceItems: [{ spaceId: "space-existing", spaceName: "Existing room" }],
			})
			.mockRejectedValueOnce(
				Object.assign(new Error("temporary refresh failure"), {
					code: "gateway.invalid_response",
				})
			);
		const queryClient = new QueryClient({
			defaultOptions: {
				mutations: { retry: false },
				queries: { retry: false },
			},
		});

		render(
			<QueryClientProvider client={queryClient}>
				<WelcomeFirstRun />
			</QueryClientProvider>
		);
		await screen.findByRole("button", { name: JOIN_CHOICE });

		act(() => focusManager.setFocused(true));
		await waitFor(() => {
			expect(
				queryClient.getQueryState(
					accountSpaceQueryKeys.items("human-1", "account")
				)?.status
			).toBe("error");
		});

		expect(
			screen.queryByText("Couldn't load your spaces — try again")
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: JOIN_CHOICE }));
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/spaces?view=discover",
		});
		expect(screen.queryByRole("button", { name: "Existing room" })).toBeNull();
	});
});
