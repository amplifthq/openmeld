import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSpaceMessage } from "#/lib/spaces/pending-message";
import {
	type SpaceCreationHandoff,
	SpaceCreationRoute,
} from "./space-creation-conversation";

const { creationState, readBootstrap, routeLifecycle } = vi.hoisted(() => ({
	creationState: {
		listed: true,
		response: { spaceId: "space-1" } as { spaceId: string } | undefined,
		status: "success",
	},
	readBootstrap: vi.fn(),
	routeLifecycle: { mounts: 0, unmounts: 0 },
}));

const ORGANIZATION = { id: "org-1", slug: "acme" };
const PROFILE_ID = "hum-owner";
const SPACE_ID = "space-1";
const CREATION_ID = "creating-1";
const PENDING_KEY = [
	"space-creation-message",
	ORGANIZATION.id,
	PROFILE_ID,
	CREATION_ID,
];
const FOCUS_KEY = [
	"space-creation-focus",
	ORGANIZATION.id,
	PROFILE_ID,
	CREATION_ID,
];

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
	useSpaceCreations: () =>
		creationState.listed
			? [
					{
						input: { creationId: CREATION_ID, name: "Launch", members: [] },
						organizationId: ORGANIZATION.id,
						profileId: PROFILE_ID,
						response: creationState.response,
						status: creationState.status,
					},
				]
			: [],
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
vi.mock("#/hooks/use-composer-draft", () => ({
	useComposerDraft: () => ({ content: { text: "" } }),
}));
vi.mock("./use-space-composer-attachments", () => ({
	useSpaceComposerFiles: () => ({ readFileDrafts: () => Promise.resolve([]) }),
}));
vi.mock("./app-space-shell", () => ({
	AppSpaceShell: (input: { children: ReactNode }) => <>{input.children}</>,
}));
vi.mock("./space-composer", () => ({ SpaceComposer: () => null }));
vi.mock("./space-header", () => ({ SpaceWindowHeader: () => null }));
vi.mock("./space-view-tabs", () => ({ SpaceViewTabs: () => null }));

// Stands in for the regular Space route, which validates the acting Profile
// and assembles the Space view.
function RegularRoute() {
	useEffect(() => {
		routeLifecycle.mounts += 1;
		return () => {
			routeLifecycle.unmounts += 1;
		};
	}, []);
	return <div data-testid="regular-route" />;
}

function renderRoute(spaceId = SPACE_ID) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const handoffs: (SpaceCreationHandoff | undefined)[] = [];
	const tree = () => (
		<QueryClientProvider client={queryClient}>
			<SpaceCreationRoute profileId={PROFILE_ID} spaceId={spaceId}>
				{(handoff) => {
					handoffs.push(handoff);
					return <RegularRoute />;
				}}
			</SpaceCreationRoute>
		</QueryClientProvider>
	);
	const view = render(tree());
	return {
		handoffs,
		queryClient,
		rerender: () => view.rerender(tree()),
	};
}

describe("SpaceCreationRoute", () => {
	beforeEach(() => {
		creationState.listed = true;
		creationState.response = { spaceId: SPACE_ID };
		creationState.status = "success";
		routeLifecycle.mounts = 0;
		routeLifecycle.unmounts = 0;
		readBootstrap.mockReset();
		readBootstrap.mockImplementation((spaceId: string) =>
			Promise.resolve({ spaceId })
		);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("opens the created Space through the regular route with only the handoff inputs", async () => {
		const { handoffs } = renderRoute();

		await screen.findByTestId("regular-route");
		const handoff = handoffs.at(-1);
		// Profile validation, account Profiles, focus targets, and Organization
		// context belong to the regular route, so the handoff adds none of them.
		expect(Object.keys(handoff ?? {}).sort()).toEqual([
			"composerDraftMigrationScopes",
			"initialPendingMessage",
			"initialSpaceView",
			"onComposerReady",
			"onInitialPendingMessageConsumed",
		]);
		expect(handoff).toMatchObject({
			composerDraftMigrationScopes: [
				{
					kind: "space",
					ownerAccountId: "account-1",
					profileId: PROFILE_ID,
					spaceId: CREATION_ID,
				},
			],
			initialSpaceView: "messages",
		});
	});

	it("carries the staged message and composer selection into the regular route", async () => {
		const message: PendingSpaceMessage = {
			clientMessageId: "message-1",
			createdAtMs: 1,
			fileDrafts: [],
			files: [],
			text: "Kickoff notes",
		};
		const selection = { start: 3, end: 3 };
		const { handoffs, queryClient } = renderRoute();
		queryClient.setQueryData(PENDING_KEY, message);
		queryClient.setQueryData(FOCUS_KEY, selection);

		await screen.findByTestId("regular-route");
		await waitFor(() =>
			expect(handoffs.at(-1)?.initialPendingMessage).toEqual(message)
		);

		const composer = { selectTextRange: vi.fn() };
		act(() => {
			handoffs.at(-1)?.onComposerReady?.(composer as never);
		});
		await waitFor(() =>
			expect(composer.selectTextRange).toHaveBeenCalledWith(selection)
		);
		expect(queryClient.getQueryData(FOCUS_KEY)).toBeNull();

		act(() => {
			handoffs.at(-1)?.onInitialPendingMessageConsumed?.();
		});
		expect(queryClient.getQueryData(PENDING_KEY)).toBeNull();
	});

	it("keeps the regular route mounted after the handoff", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { queryClient, rerender } = renderRoute();
		await screen.findByTestId("regular-route");

		// The sidebar retires the receipt and a later bootstrap read fails; the
		// opened conversation must not fall back to preparation and remount.
		creationState.listed = false;
		readBootstrap.mockRejectedValue(new Error("bootstrap unavailable"));
		await act(async () => {
			await queryClient
				.refetchQueries({ queryKey: ["bootstrap", SPACE_ID] })
				.catch(() => undefined);
		});
		rerender();

		expect(screen.getByTestId("regular-route")).toBeTruthy();
		expect(routeLifecycle).toEqual({ mounts: 1, unmounts: 0 });
	});

	it("keeps the preparation conversation until the created Space is ready", async () => {
		creationState.response = undefined;
		creationState.status = "pending";
		const { handoffs } = renderRoute(CREATION_ID);

		await screen.findByText("Preparing…");
		expect(screen.queryByTestId("regular-route")).toBeNull();
		expect(handoffs).toHaveLength(0);
		expect(readBootstrap).not.toHaveBeenCalled();
	});

	it("renders the regular route without a handoff for another Space", async () => {
		const { handoffs } = renderRoute("space-2");

		await screen.findByTestId("regular-route");
		expect(handoffs).toEqual([undefined]);
	});
});
