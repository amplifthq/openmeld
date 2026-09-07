import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.hoisted(() => vi.fn());
const useSelectedHumanProfileMock = vi.hoisted(() => vi.fn());
const bringAgentsSetupProviderMock = vi.hoisted(() => vi.fn());
const startBringAgentsSetupPageMock = vi.hoisted(() => vi.fn());
const appFullWidthLayoutMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			...props
		}: {
			children: ReactNode;
			to: string;
			[key: string]: unknown;
		}) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
		useNavigate: () => navigateMock,
	};
});

// useStartFlowGuard reads hasRestored from here; keep it restored so the guard
// is driven purely by canContinueWithSelectedHumanProfile in these tests.
vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({ hasRestored: true }),
}));

vi.mock("#/lib/profiles/use-selected-human-profile", () => ({
	useSelectedHumanProfile: useSelectedHumanProfileMock,
}));

vi.mock("#/components/connect/bring-agents-setup-context", () => ({
	BringAgentsSetupProvider: (props: { children: ReactNode }) => {
		bringAgentsSetupProviderMock(props);
		return props.children;
	},
}));

vi.mock("#/components/connect/start-bring-agents-setup-page", () => ({
	StartBringAgentsSetupPage: (props: Record<string, unknown>) => {
		startBringAgentsSetupPageMock(props);
		return <div data-testid="setup-page" />;
	},
}));

vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: (props: {
		children: ReactNode;
		initialOuterSidebarState?: unknown;
	}) => {
		appFullWidthLayoutMock(props);
		return <div data-testid="app-full-width-layout">{props.children}</div>;
	},
}));

import { AppConnectContent, Route } from "./connect";

function renderRoute(search: Record<string, unknown> = { reset: undefined }) {
	render(<AppConnectContent orgSlug="acme" search={search} />);
}

describe("/o/$orgSlug/connect route", () => {
	beforeEach(() => {
		navigateMock.mockReset().mockResolvedValue(undefined);
		useSelectedHumanProfileMock
			.mockReset()
			.mockReturnValue({ canContinueWithSelectedHumanProfile: true });
		bringAgentsSetupProviderMock.mockReset();
		startBringAgentsSetupPageMock.mockReset();
		appFullWidthLayoutMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders inside the connect app-shell section", () => {
		expect(Route.options.staticData).toEqual({ appShellSection: "connect" });
	});

	it("parses reset and the space-recovery search params, ignoring corridor-only keys", () => {
		const validateSearch = Route.options.validateSearch as (
			search: Record<string, unknown>
		) => {
			agentProfileIds?: string;
			profileId?: string;
			reset?: "this-computer";
			returnTo?: "space";
			serviceAction?: "update_service";
			session?: "fresh";
			spaceId?: string;
		};

		// setup=this-computer is a corridor-only key; the Connect route ignores it.
		expect(
			validateSearch({ session: "fresh", setup: "this-computer" })
		).toEqual({
			agentProfileIds: undefined,
			profileId: undefined,
			reset: undefined,
			returnTo: undefined,
			serviceAction: undefined,
			session: "fresh",
			spaceId: undefined,
		});
		expect(validateSearch({ reset: "this-computer" }).reset).toBe(
			"this-computer"
		);
		expect(validateSearch({ reset: "nonsense", session: "stale" })).toEqual({
			agentProfileIds: undefined,
			profileId: undefined,
			reset: undefined,
			returnTo: undefined,
			serviceAction: undefined,
			session: undefined,
			spaceId: undefined,
		});
		expect(validateSearch({})).toEqual({
			agentProfileIds: undefined,
			profileId: undefined,
			reset: undefined,
			returnTo: undefined,
			serviceAction: undefined,
			session: undefined,
			spaceId: undefined,
		});
		expect(
			validateSearch({
				agentProfileIds: "agt_1,agt_2",
				profileId: "human-1",
				returnTo: "space",
				serviceAction: "update_service",
				session: "fresh",
				spaceId: "space-123",
			})
		).toEqual({
			agentProfileIds: "agt_1,agt_2",
			profileId: "human-1",
			reset: undefined,
			returnTo: "space",
			serviceAction: "update_service",
			session: "fresh",
			spaceId: "space-123",
		});
		// Unsupported return destinations are dropped.
		expect(validateSearch({ returnTo: "agents" }).returnTo).toBeUndefined();
	});

	it("keeps Agent creation as the visible return destination and resumes after verified setup", () => {
		renderRoute({ returnTo: "agent_creation", session: "fresh" });
		expect(
			screen
				.getByRole("link", { name: "Back to creating Agent" })
				.getAttribute("href")
		).toBe("/o/acme/new-agent");
		expect(startBringAgentsSetupPageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				autoReturnOnCompletion: false,
				selfRouteSearch: expect.objectContaining({
					returnTo: "agent_creation",
					session: undefined,
				}),
			})
		);
	});

	it("mounts the setup page without the choose-local-agents step and stays on the org Connect route", () => {
		renderRoute();

		expect(screen.getByTestId("app-full-width-layout")).toBeTruthy();
		expect(bringAgentsSetupProviderMock).toHaveBeenCalledTimes(1);
		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent).toEqual({
			kind: "account_computer_setup",
			resetThisComputer: false,
			serviceAction: undefined,
		});

		expect(startBringAgentsSetupPageMock).toHaveBeenCalledTimes(1);
		const pageProps = startBringAgentsSetupPageMock.mock.calls[0][0];
		expect(pageProps.autoReturnOnCompletion).toBe(false);
		expect(pageProps.orgSlug).toBe("acme");
		expect(pageProps.showBackControl).toBe(false);
		expect(pageProps.selfRoute).toBe("/o/acme/connect");

		// The provider renders its child, so the page actually mounts (no hang).
		expect(isValidElement(providerProps.children)).toBe(true);
		expect(screen.getByTestId("setup-page")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("forces a fresh session when session=fresh is requested", () => {
		renderRoute({ session: "fresh" });

		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent.resetThisComputer).toBe(true);
		expect(providerProps.routeIntent.kind).toBe("account_computer_setup");
	});

	it("returns a selected Human Profile's Add a Computer flow to People", () => {
		renderRoute({ profileId: "human-1", session: "fresh" });

		expect(
			screen.getByRole("link", { name: "Back" }).getAttribute("href")
		).toBe("/o/acme/people/human-1");
		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent).toMatchObject({
			kind: "account_computer_setup",
			profileId: "human-1",
		});
	});

	it("keeps legacy reset=this-computer links compatible", () => {
		renderRoute({ reset: "this-computer" });

		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent.resetThisComputer).toBe(true);
		expect(providerProps.routeIntent.kind).toBe("account_computer_setup");
	});

	it("preserves the OpenMeld Service update intent when fresh session is consumed", () => {
		renderRoute({
			serviceAction: "update_service",
			session: "fresh",
		});

		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent).toEqual({
			kind: "account_computer_setup",
			resetThisComputer: true,
			serviceAction: "update_service",
		});

		const pageProps = startBringAgentsSetupPageMock.mock.calls[0][0];
		expect(pageProps.autoReturnOnCompletion).toBe(false);
		expect(pageProps.selfRouteSearch).toEqual({
			serviceAction: "update_service",
			session: undefined,
		});
	});

	it("redirects to Human Profiles instead of stranding the page when no human profile can continue", async () => {
		useSelectedHumanProfileMock.mockReturnValue({
			canContinueWithSelectedHumanProfile: false,
		});
		renderRoute();

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/people",
				replace: true,
			});
		});
		// The setup provider/page never mount while the profile is unresolved.
		expect(bringAgentsSetupProviderMock).not.toHaveBeenCalled();
		expect(startBringAgentsSetupPageMock).not.toHaveBeenCalled();
	});

	it("reuses the space_recovery intent and keeps space params on reset consumption when arriving from a Space", () => {
		renderRoute({
			agentProfileIds: "agt_1,agt_2",
			profileId: "human-1",
			returnTo: "space",
			session: "fresh",
			spaceId: "space-123",
		});

		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent).toEqual({
			agentProfileIds: ["agt_1", "agt_2"],
			kind: "space_recovery",
			profileId: "human-1",
			resetThisComputer: true,
			serviceAction: undefined,
			spaceId: "space-123",
		});

		const pageProps = startBringAgentsSetupPageMock.mock.calls[0][0];
		expect(pageProps.selfRoute).toBe("/o/acme/connect");
		expect(pageProps.orgSlug).toBe("acme");
		// Reset is consumed, but the space params must survive so the remount
		// re-resolves the space_recovery intent (and lands back on the Space).
		expect(pageProps.selfRouteSearch).toEqual({
			agentProfileIds: "agt_1,agt_2",
			profileId: "human-1",
			returnTo: "space",
			serviceAction: undefined,
			session: undefined,
			spaceId: "space-123",
		});
	});

	it("resolves the space_recovery intent from a short URL without profileId", () => {
		renderRoute({
			returnTo: "space",
			session: "fresh",
			spaceId: "space-123",
		});

		const providerProps = bringAgentsSetupProviderMock.mock.calls[0][0];
		expect(providerProps.routeIntent).toEqual({
			agentProfileIds: [],
			kind: "space_recovery",
			profileId: undefined,
			resetThisComputer: true,
			serviceAction: undefined,
			spaceId: "space-123",
		});

		const pageProps = startBringAgentsSetupPageMock.mock.calls[0][0];
		// Reset is consumed; the short space params survive (no profileId is added).
		expect(pageProps.selfRouteSearch).toEqual({
			agentProfileIds: undefined,
			profileId: undefined,
			returnTo: "space",
			serviceAction: undefined,
			session: undefined,
			spaceId: "space-123",
		});
	});

	it("redirects to the bare Space (viewer resolved on arrival) when no human profile can continue during profileId-less space recovery", async () => {
		useSelectedHumanProfileMock.mockReturnValue({
			canContinueWithSelectedHumanProfile: false,
		});
		renderRoute({
			returnTo: "space",
			session: "fresh",
			spaceId: "space-123",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces/space-123",
				replace: true,
			});
		});
		expect(bringAgentsSetupProviderMock).not.toHaveBeenCalled();
		expect(startBringAgentsSetupPageMock).not.toHaveBeenCalled();
	});

	it("redirects to the originating Space (not Agents) when no human profile can continue during space recovery", async () => {
		useSelectedHumanProfileMock.mockReturnValue({
			canContinueWithSelectedHumanProfile: false,
		});
		renderRoute({
			agentProfileIds: undefined,
			profileId: "human-1",
			returnTo: "space",
			session: "fresh",
			spaceId: "space-123",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces/space-123?profileId=human-1",
				replace: true,
			});
		});
		expect(bringAgentsSetupProviderMock).not.toHaveBeenCalled();
		expect(startBringAgentsSetupPageMock).not.toHaveBeenCalled();
	});
});
