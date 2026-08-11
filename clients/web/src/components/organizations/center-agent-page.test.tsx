import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CenterAgentDirectMessageRouteData } from "#/lib/organizations/center-agent-route-loader";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { CenterAgentPage } from "./center-agent-page";

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
	SpaceLanding: (props: { loadingFallback?: ReactNode }) => {
		spaceLandingSpy(props);
		return renderSpaceLandingLoadingFallback ? (
			props.loadingFallback
		) : (
			<div data-testid="space-landing" />
		);
	},
}));

vi.mock("./center-agent-about-control", () => ({
	CenterAgentAboutControl: () => <div data-testid="center-agent-about" />,
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
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
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
		vi.clearAllMocks();
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

	it("queues the first message locally while Space bootstrap is pending", () => {
		renderSpaceLandingLoadingFallback = true;
		renderCenterAgentPage(readyRouteData());

		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		fireEvent.change(composer, { target: { value: "Draft the first plan" } });
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

		expect(screen.getByText("Draft the first plan")).toBeTruthy();
		expect(screen.queryByText("Sending…")).toBeNull();
		expect(screen.getByRole("button", { name: "Sending…" })).toBeTruthy();
		expect((composer as HTMLTextAreaElement).value).toBe("");
		expect((composer as HTMLTextAreaElement).disabled).toBe(true);
	});

	it("hands the pending message to the real conversation without waiting for the profile list", () => {
		renderSpaceLandingLoadingFallback = true;
		renderCenterAgentPage(readyRouteData());

		const composer = screen.getByRole("textbox", {
			name: "Message Center Agent",
		});
		fireEvent.change(composer, {
			target: { value: "Ship the onboarding plan" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));

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
		);
		expect(navigateSpy).not.toHaveBeenCalled();
	});

	it("hands an Inbox reply target to the Center Agent conversation", () => {
		renderCenterAgentPage(readyRouteData(), "signal-from-inbox");

		expect(spaceLandingSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				initialFocusSignalId: "signal-from-inbox",
			})
		);
	});

	it("sends a revoked designation to Center Agent settings", () => {
		renderCenterAgentPage({ status: "connect_required" });

		expect(screen.getByText("Connect a Center Agent")).toBeTruthy();
		expect(
			screen.getByText(
				"Choose a Remote Agent in Center Agent settings before starting this conversation."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Open Center Agent settings" })
				.getAttribute("href")
		).toBe("/o/acme/center-agent/settings");
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
		expect(spaceLandingSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				centerAgentAboutControl: expect.objectContaining({
					props: {
						organizationId: "org-acme",
						organizationSlug: "acme",
					},
				}),
			})
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
	initialFocusSignalId?: string
) {
	return renderWithQueryClient(
		<CenterAgentPage
			directMessageRouteData={directMessageRouteData}
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
