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
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { WelcomeFirstRun } from "./welcome-first-run";

const { listAccountSpaceItemsMock, navigateMock } = vi.hoisted(() => ({
	navigateMock: vi.fn().mockResolvedValue(undefined),
	listAccountSpaceItemsMock: vi.fn(),
}));
const JOIN_CHOICE = /Join a Space/;

vi.mock("@openmeld/start", () => ({
	buildOnboardingPlan: () => ({}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigateMock,
}));

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
		focusManager.setFocused(false);
		listAccountSpaceItemsMock.mockReset();
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
