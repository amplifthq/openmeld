import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceComposerFiles } from "#/components/spaces/use-space-composer-attachments";
import { readComposerDraft } from "#/lib/composer-draft-storage";
import {
	createPendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";
import type { CenterAgentDirectMessageRouteData } from "#/lib/organizations/center-agent-route-loader";
import { parseCenterAgentRouteSearch } from "#/lib/organizations/center-agent-route-search";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { removeComposerFileDraft } from "#/lib/spaces/composer-file-drafts";
import { Route as CenterAgentChatRoute } from "#/routes/o/$orgSlug/_center-agent/chats.center-agent";
import { CenterAgentPage } from "./center-agent-page";
import { CenterAgentPendingConversation } from "./center-agent-route-pending";

const navigateSpy = vi.hoisted(() => vi.fn());
const openCenterAgentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const readCenterAgentDirectMessageSpaceProjectionMock = vi.hoisted(() =>
	vi.fn()
);
const spaceLandingSpy = vi.hoisted(() => vi.fn());
let renderSpaceLandingLoadingFallback = false;
let currentOrganization: OrganizationSummary = {
	id: "org-acme",
	name: "Acme",
	slug: "acme",
};

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);
	return {
		...actual,
		useQuery: vi.fn(),
	};
});

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "felix@example.com",
		image: null,
		name: "Felix",
	}),
}));

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ storageScope: "user-1" }),
}));

vi.mock("#/components/spaces/space-landing", () => ({
	SpaceLanding: (props: {
		loadingFallback?: (controller: {
			composerFiles: ReturnType<typeof useSpaceComposerFiles>;
		}) => ReactNode;
	}) => {
		const composerFiles = useSpaceComposerFiles({
			profileId: "human-1",
			spaceId: "space-ca-dm",
			deferUpload: true,
		});
		spaceLandingSpy(props);
		return renderSpaceLandingLoadingFallback ? (
			props.loadingFallback?.({ composerFiles })
		) : (
			<div data-testid="space-landing" />
		);
	},
}));

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
		"@tanstack/react-router"
	);
	return {
		...actual,
		Link: ({ children, to }: { children: ReactNode; to: string }) => (
			<a href={to}>{children}</a>
		),
		useNavigate: () => navigateSpy,
		useLocation: (input?: {
			select?: (location: { state: Record<string, never> }) => unknown;
		}) => {
			const location = { state: {} };
			return input?.select ? input.select(location) : location;
		},
		useRouterState: ({
			select,
		}: {
			select: (state: { location: { searchStr: string } }) => unknown;
		}) => select({ location: { searchStr: "" } }),
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({ currentOrganization }),
	useAppOrganization: () => ({ currentOrganization }),
}));

vi.mock("#/lib/organizations/center-agent", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/organizations/center-agent")
	>("#/lib/organizations/center-agent");
	return {
		...actual,
		openCurrentCenterAgentDirectMessageSpace:
			openCenterAgentDirectMessageSpaceMock,
		readCurrentCenterAgentDirectMessageSpaceProjection:
			readCenterAgentDirectMessageSpaceProjectionMock,
	};
});

describe("CenterAgentPage", () => {
	beforeEach(() => {
		window.localStorage.clear();
		navigateSpy.mockReset().mockResolvedValue(undefined);
		renderSpaceLandingLoadingFallback = false;
		spaceLandingSpy.mockReset();
		vi.mocked(useQuery)
			.mockReset()
			.mockReturnValue({
				data: undefined,
				isError: false,
				isPending: true,
			} as ReturnType<typeof useQuery>);
		openCenterAgentDirectMessageSpaceMock
			.mockReset()
			.mockResolvedValue(readyRouteData().directMessage);
		readCenterAgentDirectMessageSpaceProjectionMock
			.mockReset()
			.mockResolvedValue({
				organizationId: "org-acme",
				projection: null,
			});
		currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it("keeps the selected chat when changing views or retrying an unavailable chat", async () => {
		const rendered = renderWithQueryClient(
			<CenterAgentPage
				directMessageRouteData={readyRouteData({ spaceId: "session-2" })}
				sessionId="session-2"
			/>
		);
		spaceLandingSpy.mock.lastCall?.[0].onSpaceViewCommitted("files");
		expect(navigateSpy).toHaveBeenLastCalledWith({
			replace: true,
			to: "/o/acme/chats/center-agent?session=session-2&view=files",
		});
		rendered.rerender(
			<CenterAgentPage
				directMessageRouteData={errorRouteData()}
				sessionId="session-2"
			/>
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await waitFor(() =>
			expect(
				readCenterAgentDirectMessageSpaceProjectionMock
			).toHaveBeenCalledWith(expect.objectContaining({ spaceId: "session-2" }))
		);
		expect(openCenterAgentDirectMessageSpaceMock).not.toHaveBeenCalled();
	});

	it("pins the resolved chat when navigating from an unselected home entry", () => {
		renderWithQueryClient(
			<CenterAgentPage
				directMessageRouteData={readyRouteData({ spaceId: "resolved-chat" })}
			/>
		);
		spaceLandingSpy.mock.lastCall?.[0].onSpaceViewCommitted("files");
		expect(navigateSpy).toHaveBeenLastCalledWith({
			replace: true,
			to: "/o/acme/chats/center-agent?session=resolved-chat&view=files",
		});
	});

	it.each([
		true,
		false,
	])("passes personal workspace identity to the conversation: %s", (isPersonal) => {
		currentOrganization = { ...currentOrganization, isPersonal };
		renderCenterAgentPage(readyRouteData());
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ isPersonalContext: isPersonal })
		);
	});

	it("keeps one interactive conversation skeleton inside the ready shell while Space bootstrap loads", () => {
		renderSpaceLandingLoadingFallback = true;

		renderCenterAgentPage(readyRouteData());

		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		expect((composer as HTMLTextAreaElement).disabled).toBe(false);
		fireEvent.change(composer, { target: { value: "Help me get started" } });
		expect((composer as HTMLTextAreaElement).value).toBe("Help me get started");
		expect(
			screen.getAllByTestId("center-agent-conversation-skeleton")
		).toHaveLength(1);
		expect(screen.queryByRole("navigation", { name: "Spaces" })).toBeNull();
		expect(openCenterAgentDirectMessageSpaceMock).not.toHaveBeenCalled();
	});

	it("restores an unsent draft while the Center Agent Space is still loading", () => {
		renderSpaceLandingLoadingFallback = true;
		const firstComposer = renderCenterAgentPage(readyRouteData());

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message Center Agent" }),
			{ target: { value: "Keep this loading-state draft" } }
		);
		firstComposer.unmount();

		renderCenterAgentPage(readyRouteData());

		expect(
			(
				screen.getByRole("textbox", {
					name: "Message Center Agent",
				}) as HTMLTextAreaElement
			).value
		).toBe("Keep this loading-state draft");
	});

	it("queues the first message locally while Space bootstrap is pending", async () => {
		renderSpaceLandingLoadingFallback = true;
		renderCenterAgentPage(readyRouteData());

		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		fireEvent.change(composer, { target: { value: "Draft the first plan" } });
		await act(async () => undefined);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(screen.getByText("Draft the first plan")).toBeTruthy();
		expect(screen.queryByText("Sending…")).toBeNull();
		expect(
			await screen.findByRole("button", { name: "Sending…" })
		).toBeTruthy();
		expect((composer as HTMLTextAreaElement).value).toBe("");
		expect((composer as HTMLTextAreaElement).disabled).toBe(true);
	});

	it("hands the pending message to the real conversation without waiting for the profile list", async () => {
		renderSpaceLandingLoadingFallback = true;
		renderCenterAgentPage(readyRouteData());

		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		fireEvent.change(composer, {
			target: { value: "Ship the onboarding plan" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		await waitFor(() =>
			expect(spaceLandingSpy).toHaveBeenLastCalledWith(
				expect.objectContaining({
					accountProfiles: [],
					initialPendingMessage: expect.objectContaining({
						text: "Ship the onboarding plan",
					}),
					orgSlug: "acme",
					profileId: "human-1",
					spaceId: "space-ca-dm",
				})
			)
		);
		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it.each([
		"bootstrap",
		"route",
	])("claims a %s submission immediately while file persistence is delayed", async (loadingPhase) => {
		const storage = await import("#/lib/spaces/composer-file-drafts");
		renderSpaceLandingLoadingFallback = true;
		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		const file = new File(["first"], "first.txt", { type: "text/plain" });
		let releaseSave: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			releaseSave = resolve;
		});
		const save = storage.saveComposerFileDraft;
		const saveSpy = vi
			.spyOn(storage, "saveComposerFileDraft")
			.mockImplementation(async (draft) => {
				await gate;
				await save(draft);
			});
		const { queryClient } =
			loadingPhase === "bootstrap"
				? renderCenterAgentPage(readyRouteData())
				: renderWithQueryClient(
						<CenterAgentPendingConversation
							organizationId="org-acme"
							organizationSlug="acme"
							ownerAccountId="user-1"
						/>
					);
		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		fireEvent.change(composer, { target: { value: "First message" } });
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: { files: [file] },
		});
		await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		const readPending = () =>
			readCenterAgentPendingMessage(queryClient, { organizationSlug: "acme" });
		await waitFor(() => expect(readPending()).not.toBeNull());
		const pending = readPending();
		expect(pending).toMatchObject({
			text: "First message",
			createdAtMs: 1000,
			files: [file],
			fileDrafts: [{ id: saveSpy.mock.calls[0][0].id }],
		});
		expect(composer).toHaveProperty("disabled", true);
		expect(
			readComposerDraft({
				kind: "center_agent_pending",
				ownerAccountId: "user-1",
				organizationId: "org-acme",
			})?.text
		).toBe("First message");
		expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
		clock.mockReturnValue(3000);
		await act(async () => {
			releaseSave();
			await gate;
		});
		await Promise.all(saveSpy.mock.results.map((result) => result.value));
		expect(readPending()).toBe(pending);
		await Promise.all(
			saveSpy.mock.calls.map(async ([draft]) =>
				removeComposerFileDraft(draft.id)
			)
		);
	});

	it.each([
		"bootstrap",
		"route",
	])("admits one %s pending message while attachment discovery settles", async (loadingPhase) => {
		const storage = await import("#/lib/spaces/composer-file-drafts");
		renderSpaceLandingLoadingFallback = true;
		let releaseDiscovery: (drafts: []) => void = () => undefined;
		const discovery = new Promise<[]>((resolve) => {
			releaseDiscovery = resolve;
		});
		vi.spyOn(storage, "readComposerFileDrafts").mockReturnValueOnce(discovery);
		const saveSpy = vi.spyOn(storage, "saveComposerFileDraft");
		const { queryClient } =
			loadingPhase === "bootstrap"
				? renderCenterAgentPage(readyRouteData())
				: renderWithQueryClient(
						<CenterAgentPendingConversation
							organizationId="org-acme"
							organizationSlug="acme"
							ownerAccountId="user-1"
						/>
					);
		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		const file = new File(["one"], "one.txt", { type: "text/plain" });
		fireEvent.change(composer, { target: { value: "Keep the attachment" } });
		fireEvent.change(screen.getByLabelText("Choose files to send"), {
			target: { files: [file] },
		});
		await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		fireEvent.keyDown(composer, { key: "Enter" });
		releaseDiscovery([]);
		await waitFor(() =>
			expect(
				readCenterAgentPendingMessage(queryClient, {
					organizationSlug: "acme",
				})
			).toMatchObject({
				text: "Keep the attachment",
				files: [file],
				fileDrafts: [expect.objectContaining({ file })],
			})
		);
		await Promise.all(saveSpy.mock.results.map((result) => result.value));
		await Promise.all(
			saveSpy.mock.calls.map(async ([draft]) =>
				removeComposerFileDraft(draft.id)
			)
		);
	});

	it("hands an Inbox reply target to the Center Agent conversation", () => {
		renderCenterAgentPage(
			readyRouteData(),
			"signal-from-inbox",
			"focus-request-1"
		);

		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				initialFocusRequestId: "focus-request-1",
				initialFocusSignalId: "signal-from-inbox",
			})
		);
	});

	it("forwards an activity Thread root through the actual Center Agent route and page", () => {
		const search = parseCenterAgentRouteSearch({
			session: "saved-chat",
			focusSignalId: "root-1",
			focusThreadRootSignalId: "root-1",
		});
		vi.spyOn(CenterAgentChatRoute, "useSearch").mockReturnValue(search);
		vi.spyOn(CenterAgentChatRoute, "useLoaderData").mockReturnValue(
			readyRouteData({ spaceId: "saved-chat" })
		);
		const ChatRoute = CenterAgentChatRoute.options.component;
		if (!ChatRoute) {
			throw new Error("Chat route component is missing");
		}
		renderWithQueryClient(<ChatRoute />);
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				spaceId: "saved-chat",
				initialFocusSignalId: "root-1",
				initialFocusThreadRootSignalId: "root-1",
			})
		);
	});

	it("sends a revoked designation to Center Agent settings", () => {
		renderCenterAgentPage({ status: "connect_required" });

		expect(screen.getByText("Connect a Center Agent")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect your Center Agent in Center Agent settings before starting this conversation."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open Center Agent settings" })
				.getAttribute("href")
		).toBe("/o/acme/settings/center-agent");
	});

	it("clears connect-required state after switching away and back", () => {
		const rendered = renderCenterAgentPage({ status: "connect_required" });
		expect(screen.getByText("Connect a Center Agent")).toBeTruthy();

		currentOrganization = {
			id: "org-beta",
			name: "Beta",
			slug: "beta",
		};
		rendered.rerender(
			<CenterAgentPage
				directMessageRouteData={readyRouteData({
					organizationId: "org-beta",
					spaceId: "space-beta-ca-dm",
				})}
			/>
		);
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				orgSlug: "beta",
				spaceId: "space-beta-ca-dm",
			})
		);

		currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		rendered.rerender(
			<CenterAgentPage directMessageRouteData={readyRouteData()} />
		);
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				orgSlug: "acme",
				spaceId: "space-ca-dm",
			})
		);
		expect(screen.queryByText("Connect a Center Agent")).toBeNull();
	});

	it("shows a real initialization failure instead of the connect page", () => {
		renderCenterAgentPage(
			errorRouteData({
				code: "center_agent.dm_open_failed",
				message: "initialization failed",
				requestId: "req-center-agent-bootstrap",
				status: 503,
				upstreamCode: "center_agent.profile_bootstrap_unavailable",
			})
		);

		expect(screen.getByText("Center Agent is unavailable")).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld could not open the Center Agent conversation. Error code: center_agent.dm_open_failed / center_agent.profile_bootstrap_unavailable. Request ID: req-center-agent-bootstrap."
			)
		).toBeTruthy();
	});

	it("restarts the DM entry for a new organization without keeping the old error", () => {
		const rendered = renderCenterAgentPage(
			errorRouteData({
				message: "Acme initialization failed",
				requestId: "req-acme-bootstrap",
				status: 502,
				upstreamCode: "center_agent.profile_bootstrap_failed",
			})
		);
		expect(screen.getByText("Center Agent is unavailable")).toBeTruthy();

		currentOrganization = {
			id: "org-beta",
			name: "Beta",
			slug: "beta",
		};
		rendered.rerender(
			<CenterAgentPage
				directMessageRouteData={readyRouteData({
					organizationId: "org-beta",
					spaceId: "space-beta-ca-dm",
				})}
			/>
		);

		expect(screen.queryByText("Center Agent is unavailable")).toBeNull();
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				orgSlug: "beta",
				spaceId: "space-beta-ca-dm",
			})
		);
	});

	it("uses refreshed loader data for the same organization", () => {
		const rendered = renderCenterAgentPage(
			errorRouteData({ message: "Initial loader failure", status: 503 })
		);
		expect(screen.getByText("Center Agent is unavailable")).toBeTruthy();

		rendered.rerender(
			<CenterAgentPage directMessageRouteData={readyRouteData()} />
		);

		expect(screen.queryByText("Center Agent is unavailable")).toBeNull();
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ spaceId: "space-ca-dm" })
		);
	});

	it("renders only the loader-provided conversation without reopening it on the client", () => {
		renderCenterAgentPage(readyRouteData());

		expect(spaceLandingSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				orgSlug: "acme",
				profileId: "human-1",
				spaceId: "space-ca-dm",
			})
		);
		expect(openCenterAgentDirectMessageSpaceMock).not.toHaveBeenCalled();
		expect(spaceLandingSpy.mock.calls.at(-1)?.[0]).not.toHaveProperty(
			"centerAgentAboutControl"
		);
	});

	it("discards a queued message when the organization changes", () => {
		renderSpaceLandingLoadingFallback = true;
		const rendered = renderCenterAgentPage(readyRouteData());

		fireEvent.change(
			screen.getByRole("textbox", { name: "Message Center Agent" }),
			{ target: { value: "Acme-only draft" } }
		);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		expect(screen.getByText("Acme-only draft")).toBeTruthy();

		currentOrganization = {
			id: "org-beta",
			name: "Beta",
			slug: "beta",
		};
		rendered.rerender(
			<CenterAgentPage
				directMessageRouteData={readyRouteData({
					organizationId: "org-beta",
					spaceId: "space-beta-ca-dm",
				})}
			/>
		);

		expect(screen.queryByText("Acme-only draft")).toBeNull();
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				initialPendingMessage: null,
				orgSlug: "beta",
			})
		);
	});

	it("adopts a message whose attachments finish saving after the ready route mounts", () => {
		const { queryClient } = renderCenterAgentPage(readyRouteData());
		const message = createPendingCenterAgentMessage(
			"Saved during route handoff"
		);
		message.files = [new File(["image"], "handoff.png", { type: "image/png" })];
		act(() => {
			// The pending route only knew the slug; the ready route knows the ID.
			writeCenterAgentPendingMessage(
				queryClient,
				{ organizationSlug: "acme" },
				message
			);
		});
		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ initialPendingMessage: message })
		);
	});

	it("retries a loader-reported error and opens the resolved conversation", async () => {
		openCenterAgentDirectMessageSpaceMock.mockResolvedValueOnce(
			readyRouteData().directMessage
		);
		renderCenterAgentPage(
			errorRouteData({ message: "temporary failure", status: 503 })
		);

		fireEvent.click(screen.getByRole("button", { name: "Retry" }));

		await waitFor(() => {
			expect(screen.getByTestId("space-landing")).toBeTruthy();
		});
		expect(
			readCenterAgentDirectMessageSpaceProjectionMock
		).toHaveBeenCalledTimes(1);
		expect(openCenterAgentDirectMessageSpaceMock).toHaveBeenCalledTimes(1);
	});
});

function renderCenterAgentPage(
	directMessageRouteData: CenterAgentDirectMessageRouteData,
	initialFocusSignalId?: string,
	initialFocusRequestId?: string
) {
	return renderWithQueryClient(
		<CenterAgentPage
			directMessageRouteData={directMessageRouteData}
			initialFocusRequestId={initialFocusRequestId}
			initialFocusSignalId={initialFocusSignalId}
		/>
	);
}

function renderWithQueryClient(element: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	const result = render(
		<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
	);
	return {
		...result,
		queryClient,
		rerender: (nextElement: ReactElement) =>
			result.rerender(
				<QueryClientProvider client={queryClient}>
					{nextElement}
				</QueryClientProvider>
			),
	};
}

function readyRouteData(
	overrides: Partial<
		Extract<
			CenterAgentDirectMessageRouteData,
			{ status: "ready" }
		>["directMessage"]
	> = {}
): Extract<CenterAgentDirectMessageRouteData, { status: "ready" }> {
	return {
		directMessage: {
			centerAgentProfileId: "agt-center-agent",
			created: false,
			memberProfileId: "human-1",
			organizationId: "org-acme",
			spaceId: "space-ca-dm",
			...overrides,
		},
		status: "ready",
	};
}

function errorRouteData(
	overrides: Partial<
		Extract<CenterAgentDirectMessageRouteData, { status: "error" }>["error"]
	> = {}
): Extract<CenterAgentDirectMessageRouteData, { status: "error" }> {
	return {
		error: {
			code: "center_agent.dm_open_failed",
			message: "Center Agent DM failed",
			requestId: null,
			status: 503,
			upstreamCode: null,
			...overrides,
		},
		status: "error",
	};
}
