import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ConnectRouteIntent } from "#/lib/connect/connect-route";
import { DesktopComputerConnection } from "./computer-connection";

const state = vi.hoisted(() => ({
	routeIntent: {
		kind: "account_computer_setup",
		resetThisComputer: false,
	} as ConnectRouteIntent,
	connect: vi.fn(),
	openWeb: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./platform", () => ({
	getDesktopPlatform: () => ({ connectComputer: state.connect }),
	openDesktopWeb: state.openWeb,
}));
vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => ({ data: { user: { id: "account-a" } } }),
}));
vi.mock("#/components/connect/bring-agents-setup-context", () => ({
	useBringAgentsSetupContext: () => ({
		routeIntent: state.routeIntent,
		selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
		targetSpaceId: null,
	}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it.each([
	"update",
	"space",
	"source_action",
] as const)("does not replace %s recovery with ordinary native connection", async (kind) => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: false,
	};
	if (kind === "update") {
		state.routeIntent.serviceAction = "update_service";
	}
	if (kind === "space" || kind === "source_action") {
		state.routeIntent = {
			kind: "space_recovery",
			resetThisComputer: true,
			agentProfileIds: ["agent-b"],
			spaceId: "space-b",
		};
	}
	const onCompleted = vi.fn();
	render(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			orgSlug="org-a"
			sourceNavigationAction={
				kind === "source_action"
					? { spaceId: "space-b", signalId: "signal-b" }
					: undefined
			}
		/>
	);
	expect(
		screen.queryByRole("button", { name: "Connect this computer" })
	).toBeNull();
	fireEvent.click(
		screen.getByRole("button", {
			name:
				kind === "source_action" ? "Open request in Web" : "Continue in Web",
		})
	);
	await waitFor(() => expect(state.openWeb).toHaveBeenCalledOnce());
	const path = state.openWeb.mock.calls[0]?.[0];
	expect(path).toContain(
		{
			update: "serviceAction=update_service",
			space: "agentProfileIds=agent-b",
			source_action: "/spaces/space-b",
		}[kind]
	);
	expect(state.connect).not.toHaveBeenCalled();
	expect(onCompleted).not.toHaveBeenCalled();
});

it.each([
	undefined,
	"computer-b",
])("carries New Agent reconnect target %s and its source action into native Prepare", async (connectedComputerId) => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: true,
		returnTo: "agent_creation",
		connectedComputerId,
	};
	state.connect.mockResolvedValue({ status: "cancelled" });
	const sourceNavigationAction = { spaceId: "space-a", signalId: "signal-a" };
	render(
		<DesktopComputerConnection
			sourceNavigationAction={sourceNavigationAction}
		/>
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Connect this computer" })
	);
	await waitFor(() =>
		expect(state.connect).toHaveBeenCalledWith(
			expect.objectContaining({
				resetThisComputer: true,
				sourceNavigationAction,
				connectedComputerId,
			})
		)
	);
});
