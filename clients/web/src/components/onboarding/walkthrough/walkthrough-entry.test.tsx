import { OPENMELD_HEADER_PROFILE_ID } from "@openmeld/gateway-contract";
import {
	type FirstWorkResponse,
	firstWorkActionSchema,
} from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppOrganizationProvider } from "#/lib/organizations/organization-context";
import type { OrganizationScopeAuthorized } from "#/lib/organizations/organization-types";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { OnboardingEntryGate } from "../onboarding-entry-gate";
import { WalkthroughProvider } from "./walkthrough-context";
import { WalkthroughEntry } from "./walkthrough-entry";

const navigation = vi.hoisted(() => ({
	navigate: vi.fn(),
	search: {} as { workspace?: string },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigation.navigate,
	useSearch: () => navigation.search,
}));
// Select the browser adapter while retaining the real query, HTTP client,
// response schemas, profile resolver, Provider and entry UI.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-start")>()),
	createIsomorphicFn: () => ({
		client: (client: (...args: unknown[]) => unknown) => ({
			server: () => client,
		}),
	}),
}));
vi.mock("#/lib/organizations/auth-organizations", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("#/lib/organizations/auth-organizations")
	>()),
	listCurrentUserOrganizationInvitations: async () => [],
}));

const profile = {
	createdAt: "2026-08-18T00:00:00.000Z",
	createdByUserId: "user-1",
	creatorProfileId: null,
	isDefault: true,
	lastUsedAt: null,
	managedRole: null,
	openMeldProfileId: "22222222-2222-4222-8222-222222222222",
	ownerUserId: "user-1",
	profileHandle: "newcomer",
	profileKind: "human",
	profileName: "Newcomer",
	source: "manual",
	status: "active",
	updatedAt: "2026-08-18T00:00:00.000Z",
} satisfies AuthProfileView;
const organization = {
	id: "org-personal",
	name: "Personal",
	slug: "personal",
	isPersonal: true,
};
const scope = {
	access: "authorized",
	account: { email: "newcomer@example.com", name: "Newcomer" },
	activeOrganization: organization,
	currentOrganization: organization,
	currentUserId: "user-1",
	organizations: [organization],
	storageScope: "walkthrough-entry-newcomer",
} satisfies OrganizationScopeAuthorized;
const firstWork = {
	record: null,
	hasStartedTutorial: false,
} satisfies FirstWorkResponse;
const WORKSPACE_CHOICE = /Personal Workspace.*For you only/;

describe("walkthrough entry recovery", () => {
	let queryClient: ReturnType<typeof createTestQueryClient>;
	let profileResult: "failed" | "empty" | "ready";
	let firstWorkFails: boolean;
	let requests: { path: string; headers: Headers; method: string }[];
	beforeEach(() => {
		queryClient = createTestQueryClient();
		profileResult = "ready";
		firstWorkFails = false;
		requests = [];
		navigation.search = {};
		navigation.navigate.mockReset();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = new URL(
					input instanceof Request ? input.url : String(input),
					window.location.origin
				);
				const headers = new Headers(init?.headers);
				const method = init?.method ?? "GET";
				requests.push({ path: url.pathname, headers, method });
				if (url.pathname === "/v1/profiles") {
					return profileResult === "failed"
						? Response.json(
								{ message: "Profiles unavailable" },
								{ status: 503 }
							)
						: Response.json({
								ok: true,
								profiles: profileResult === "empty" ? [] : [profile],
							});
				}
				if (url.pathname === "/v1/organizations/current/first-work") {
					if (firstWorkFails) {
						return Response.json(
							{ message: "Tutorial unavailable" },
							{ status: 503 }
						);
					}
					if (method === "POST") {
						const action = firstWorkActionSchema.parse(
							await new Response(init?.body).json()
						);
						return Response.json({
							hasStartedTutorial: true,
							record: {
								organizationId: organization.id,
								profileId: profile.openMeldProfileId,
								spaceId: "a".repeat(64),
								runId: action.runId,
								revision: 0,
								iteration: 1,
								step: "create-space",
								paused: false,
							},
						} satisfies FirstWorkResponse);
					}
					return Response.json(firstWork);
				}
				throw new Error(`Unexpected HTTP request: ${url.pathname}`);
			})
		);
	});
	afterEach(() => {
		cleanup();
		queryClient.clear();
		vi.unstubAllGlobals();
	});
	function renderEntry() {
		render(
			<TestQueryClientProvider queryClient={queryClient}>
				<AppOrganizationProvider scope={scope}>
					<WalkthroughProvider>
						<WalkthroughEntry />
					</WalkthroughProvider>
				</AppOrganizationProvider>
			</TestQueryClientProvider>
		);
	}

	it("keeps the actual entry gate usable after a cached profile read fails", async () => {
		const options = buildStartProfilesQueryOptions({
			enabled: true,
			storageScope: scope.storageScope,
		});
		queryClient.setQueryData(options.queryKey, [profile]);
		profileResult = "failed";
		await expect(
			queryClient.fetchQuery({ ...options, retry: false, staleTime: 0 })
		).rejects.toThrow("could not load your profiles");
		const ui = (currentSection: "home" | "onboarding") => (
			<TestQueryClientProvider queryClient={queryClient}>
				<AppOrganizationProvider scope={scope}>
					<WalkthroughProvider>
						<OnboardingEntryGate
							currentOrganization={organization}
							currentSection={currentSection}
							organizations={[organization]}
							storageScope={scope.storageScope}
						>
							{currentSection === "home" ? (
								<p>App available</p>
							) : (
								<WalkthroughEntry />
							)}
						</OnboardingEntryGate>
					</WalkthroughProvider>
				</AppOrganizationProvider>
			</TestQueryClientProvider>
		);
		const view = render(ui("home"));
		expect(await screen.findByText("App available")).toBeTruthy();
		expect(navigation.navigate).not.toHaveBeenCalled();
		expect(
			requests.some((request) => request.path.endsWith("/first-work"))
		).toBe(false);
		view.rerender(ui("onboarding"));
		await screen.findByRole("alert");
		profileResult = "ready";
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(
			await screen.findByRole("button", { name: WORKSPACE_CHOICE })
		).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it.each([
		"failed",
		"empty",
	] as const)("recovers the real workspace chooser after a %s profile read", async (initial) => {
		profileResult = initial;
		renderEntry();
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByRole("button", { name: WORKSPACE_CHOICE })).toBeNull();
		expect(
			requests.some((request) => request.path.endsWith("/first-work"))
		).toBe(false);
		profileResult = "ready";
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(
			await screen.findByRole("button", { name: WORKSPACE_CHOICE })
		).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
		const read = requests.find((request) =>
			request.path.endsWith("/first-work")
		);
		expect(read?.headers.get(OPENMELD_HEADER_PROFILE_ID)).toBe(
			profile.openMeldProfileId
		);
		expect(read?.headers.get("x-openmeld-requested-organization-id")).toBe(
			organization.id
		);
	});

	it("retries tutorial reads with the resolved Human Profile", async () => {
		firstWorkFails = true;
		renderEntry();
		await screen.findByRole("alert");
		const profileReads = requests.filter(
			(request) => request.path === "/v1/profiles"
		).length;
		firstWorkFails = false;
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await screen.findByRole("button", { name: WORKSPACE_CHOICE });
		expect(
			requests.filter((request) => request.path === "/v1/profiles")
		).toHaveLength(profileReads);
		expect(
			requests.filter((request) => request.path.endsWith("/first-work"))
		).toHaveLength(2);
	});

	it("opens the tutorial only after profile retry establishes the request identity", async () => {
		navigation.search = { workspace: "1" };
		profileResult = "failed";
		renderEntry();
		await screen.findByRole("alert");
		expect(navigation.navigate).not.toHaveBeenCalled();
		profileResult = "ready";
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		await waitFor(() =>
			expect(navigation.navigate).toHaveBeenCalledWith({
				replace: true,
				to: "/o/personal/new-space",
				search: { profileId: profile.openMeldProfileId },
			})
		);
		const tutorialRequests = requests.filter((request) =>
			request.path.endsWith("/first-work")
		);
		expect(tutorialRequests.map((request) => request.method)).toEqual([
			"GET",
			"POST",
		]);
		expect(
			tutorialRequests.every(
				(request) =>
					request.headers.get(OPENMELD_HEADER_PROFILE_ID) ===
					profile.openMeldProfileId
			)
		).toBe(true);
	});
});
