import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type SpaceCreationFocus,
	SpaceCreationRoute,
} from "./space-creation-conversation";

const { creationState, landingProps, readBootstrap, readProfiles } = vi.hoisted(
	() => ({
		creationState: {
			response: { spaceId: "space-1" } as { spaceId: string } | undefined,
			status: "success",
		},
		landingProps: [] as Record<string, unknown>[],
		readBootstrap: vi.fn(),
		readProfiles: vi.fn(),
	})
);

const ORGANIZATION = { id: "org-1", isPersonal: false, slug: "acme" };
const PROFILE_ID = "hum-owner";
const SPACE_ID = "space-1";
const OWNER_PROFILE = {
	openMeldProfileId: PROFILE_ID,
	profileKind: "human",
	status: "active",
};

vi.mock("@tanstack/react-router", () => ({
	Link: (input: { children: ReactNode }) => <a href="/">{input.children}</a>,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization: ORGANIZATION }),
}));
vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "account-1" }),
}));
vi.mock("#/query/spaces/space-creation", () => ({
	spaceCreationReceiptKey: (...parts: string[]) => [
		"space-creation-receipt",
		...parts,
	],
	useSpaceCreations: () => [
		{
			input: { creationId: "creating-1", name: "Launch", members: [] },
			organizationId: ORGANIZATION.id,
			profileId: PROFILE_ID,
			response: creationState.response,
			status: creationState.status,
		},
	],
}));
vi.mock("#/query/spaces/member-additions", () => ({
	addSpaceDirectoryMembers: vi.fn(),
	useSpaceMemberAddition: () => ({ mutate: vi.fn() }),
	useSpaceMemberAdditions: () => [],
}));
vi.mock("#/query/spaces/bootstrap", () => ({
	spaceBootstrapQueryOptions: (input: {
		spaceId: string;
		enabled: boolean;
	}) => ({
		enabled: input.enabled,
		queryFn: () => readBootstrap(input.spaceId),
		queryKey: ["bootstrap", input.spaceId],
	}),
}));
vi.mock("#/query/profiles/profiles", () => ({
	buildStartProfilesQueryOptions: (input: { storageScope: string }) => ({
		queryFn: readProfiles,
		queryKey: ["start", "profiles", input.storageScope],
		retry: false,
	}),
}));
vi.mock("#/hooks/use-composer-draft", () => ({
	useComposerDraft: () => ({ content: { text: "" } }),
}));
vi.mock("./use-space-composer-attachments", () => ({
	useSpaceComposerFiles: () => ({ readFileDrafts: () => Promise.resolve([]) }),
}));
vi.mock("./app-space-shell", () => ({
	AppSpaceShell: (input: { children: ReactNode }) => <>{input.children}</>,
}));
vi.mock("./space-landing", () => ({
	SpaceLanding: (props: Record<string, unknown>) => {
		landingProps.push(props);
		return <div data-testid="space-landing" />;
	},
}));
vi.mock("./space-composer", () => ({ SpaceComposer: () => null }));
vi.mock("./space-header", () => ({ SpaceWindowHeader: () => null }));
vi.mock("./space-view-tabs", () => ({ SpaceViewTabs: () => null }));

function renderRoute(spaceId = SPACE_ID, focus: SpaceCreationFocus = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={queryClient}>
			<SpaceCreationRoute
				focus={focus}
				profileId={PROFILE_ID}
				spaceId={spaceId}
			>
				<div>regular route</div>
			</SpaceCreationRoute>
		</QueryClientProvider>
	);
}

describe("SpaceCreationRoute", () => {
	beforeEach(() => {
		landingProps.length = 0;
		ORGANIZATION.isPersonal = false;
		creationState.response = { spaceId: SPACE_ID };
		creationState.status = "success";
		readProfiles.mockReset();
		readBootstrap.mockReset();
		readBootstrap.mockImplementation((spaceId: string) =>
			Promise.resolve({ spaceId })
		);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("opens the created Space with the account Profiles its member actions need", async () => {
		readProfiles.mockResolvedValue([OWNER_PROFILE]);
		renderRoute();

		await screen.findByTestId("space-landing");
		// Removing or adding members confirms the acting Human from this list;
		// without it the handoff tab reported "could not confirm your current
		// profile" while a fresh tab succeeded.
		expect(landingProps.at(-1)).toMatchObject({
			accountProfiles: [OWNER_PROFILE],
			profileId: PROFILE_ID,
			spaceId: SPACE_ID,
		});
	});

	it("waits for the account Profiles before opening the Space", async () => {
		readProfiles.mockReturnValue(new Promise(() => undefined));
		renderRoute();

		// The Space itself is ready; only the account Profiles are pending.
		await waitFor(() => expect(readBootstrap).toHaveBeenCalled());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(screen.queryByTestId("space-landing")).toBeNull();
		expect(landingProps).toHaveLength(0);
	});

	it("does not report an opening failure before creation is confirmed", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		creationState.response = undefined;
		creationState.status = "pending";
		readProfiles.mockRejectedValue(new Error("profiles unavailable"));
		renderRoute("creating-1");

		await waitFor(() => expect(readProfiles).toHaveBeenCalled());
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(
			screen.queryByText("couldn't be opened", { exact: false })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry opening" })).toBeNull();
	});

	it("offers to retry when the account Profiles cannot be read", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		readProfiles
			.mockRejectedValueOnce(new Error("profiles unavailable"))
			.mockResolvedValue([OWNER_PROFILE]);
		renderRoute();

		fireEvent.click(
			await screen.findByRole("button", { name: "Retry opening" })
		);

		await screen.findByTestId("space-landing");
		expect(readProfiles).toHaveBeenCalledTimes(2);
		expect(landingProps.at(-1)).toMatchObject({
			accountProfiles: [OWNER_PROFILE],
		});
	});

	it("opens the created Space at the route's message and thread targets", async () => {
		ORGANIZATION.isPersonal = true;
		readProfiles.mockResolvedValue([OWNER_PROFILE]);
		// A notification or deep link to this Space while the creation tab still
		// shows the handoff must land on its target, as the regular route does.
		renderRoute(SPACE_ID, {
			focusInteractionId: "interaction-1",
			focusRequestId: "request-1",
			focusSignalId: "signal-2",
			focusThreadRootSignalId: "signal-1",
		});

		await screen.findByTestId("space-landing");
		expect(landingProps.at(-1)).toMatchObject({
			initialFocusInteractionId: "interaction-1",
			initialFocusRequestId: "request-1",
			initialFocusSignalId: "signal-2",
			initialFocusThreadRootSignalId: "signal-1",
			isPersonalContext: true,
		});
	});

	it.each([
		["an inactive", { ...OWNER_PROFILE, status: "inactive" }],
		["an Agent", { ...OWNER_PROFILE, profileKind: "agent" }],
	])("hands %s acting Profile to the regular route", async (_, profile) => {
		readProfiles.mockResolvedValue([profile]);
		renderRoute();

		// The regular route redirects to the account's Human or asks the person
		// to choose one; the handoff must not open the Space as this Profile.
		await screen.findByText("regular route");
		expect(screen.queryByTestId("space-landing")).toBeNull();
		expect(landingProps).toHaveLength(0);
	});
});
