import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
	localComputer: vi.fn().mockResolvedValue({
		status: "unavailable",
		message: "Connect this computer.",
	}),
	disconnect: vi.fn().mockResolvedValue(false),
	currentProgress: vi.fn().mockResolvedValue(null),
	progressHandler: null as ((event: unknown) => void) | null,
	account: "account-a",
}));
vi.mock("./platform", () => ({
	getDesktopPlatform: () => ({
		connectComputer: state.connect,
		disconnectComputer: state.disconnect,
		connectionProgressCurrent: state.currentProgress,
		localComputer: state.localComputer,
		onConnectionProgress: (handler: (event: unknown) => void) => {
			state.progressHandler = handler;
			return () => {
				state.progressHandler = null;
			};
		},
	}),
	openDesktopWeb: state.openWeb,
}));
vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => ({ data: { user: { id: state.account } } }),
}));
vi.mock("#/components/connect/bring-agents-setup-context", () => ({
	useBringAgentsSetupContext: () => ({
		routeIntent: state.routeIntent,
		selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
		targetSpaceId: null,
		localRuntimesQuery: { refetch: vi.fn() },
	}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.account = "account-a";
	state.currentProgress.mockResolvedValue(null);
	state.progressHandler = null;
	state.localComputer.mockResolvedValue({
		status: "unavailable",
		message: "Connect this computer.",
	});
});

it("shows measured download progress without inventing an overall percentage", async () => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: false,
	};
	state.connect.mockReturnValue(new Promise(() => undefined));
	renderConnection(<DesktopComputerConnection />);
	const button = screen.getByRole("button", { name: "Connect this Mac" });
	await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
	fireEvent.click(button);
	await waitFor(() => expect(state.progressHandler).not.toBeNull());
	state.progressHandler?.({
		schemaVersion: 1,
		expectedAccount: "account-a",
		operationId: "operation-a",
		attemptId: "attempt-a",
		prepareSessionId: null,
		sequence: 1,
		startedAt: "2026-09-17T00:00:00.000Z",
		observedAt: "2026-09-17T00:00:00.000Z",
		phase: "downloading",
		state: "active",
		code: "desktop.tools.download",
		measurement: {
			unit: "bytes",
			value: 25,
			total: 100,
			transferAttempt: 1,
		},
	});
	expect(await screen.findByText("Downloading OpenMeld Tools")).toBeTruthy();
	expect(screen.getByText("25%")).toBeTruthy();
	expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
		"25"
	);
});

it("opens Web on the exact Desktop-created Prepare Session", async () => {
	state.connect.mockReturnValue(new Promise(() => undefined));
	renderConnection(<DesktopComputerConnection orgSlug="org-a" />);
	const connect = screen.getByRole("button", { name: "Connect this Mac" });
	await waitFor(() => expect(connect.hasAttribute("disabled")).toBe(false));
	fireEvent.click(connect);
	await waitFor(() => expect(state.progressHandler).not.toBeNull());
	state.progressHandler?.({
		schemaVersion: 1,
		expectedAccount: "account-a",
		operationId: "operation-a",
		attemptId: "attempt-a",
		prepareSessionId: "prepare-desktop-1",
		sequence: 1,
		startedAt: "2026-09-17T00:00:00.000Z",
		observedAt: "2026-09-17T00:00:00.000Z",
		phase: "connecting_service",
		state: "active",
		code: "desktop.connection.connecting_service",
	});
	const observe = await screen.findByRole("button", {
		name: "View connection progress in Web",
	});
	fireEvent.click(observe);
	await waitFor(() =>
		expect(state.openWeb).toHaveBeenCalledWith(
			"/o/org-a/connect?observePrepareSessionId=prepare-desktop-1"
		)
	);
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
	renderConnection(
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
	expect(screen.queryByRole("button", { name: "Connect this Mac" })).toBeNull();
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
	renderConnection(
		<DesktopComputerConnection
			sourceNavigationAction={sourceNavigationAction}
		/>
	);
	const button = screen.getByRole("button", { name: "Connect this Mac" });
	await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
	fireEvent.click(button);
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

function renderConnection(
	ui: React.ReactNode,
	client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
) {
	return render(ui, {
		wrapper: ({ children }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		),
	});
}

it.each([
	false,
	true,
])("shows an unconfirmed read with explicit retry and preserves cached connection: %s", async (cached) => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: false,
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	if (cached) {
		client.setQueryData(["desktop", "computer-connection", "account-a"], {
			status: "available",
			accountId: "account-a",
			target: { deviceId: "this-mac", runtimeLane: "prod" },
		});
	}
	state.localComputer.mockRejectedValue(
		new Error("Couldn’t check this Mac’s connection.")
	);
	renderConnection(<DesktopComputerConnection allowDisconnect />, client);
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Couldn’t check this Mac’s connection."
	);
	expect(
		screen.getByRole("button", {
			name: cached ? "Disconnect this Mac" : "Connect this Mac",
		})
	).toBeTruthy();
	state.localComputer.mockResolvedValue({
		status: "unavailable",
		message: "No confirmed connection.",
	});
	fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(screen.getByRole("button", { name: "Connect this Mac" })).toBeTruthy();
});

it("offers Disconnect only for this account's native connection and keeps it on cancellation", async () => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: false,
	};
	state.localComputer.mockResolvedValue({
		status: "available",
		accountId: "account-a",
		target: { deviceId: "this-mac", runtimeLane: "prod" },
	});
	renderConnection(<DesktopComputerConnection allowDisconnect />);
	const button = await screen.findByRole("button", {
		name: "Disconnect this Mac",
	});
	fireEvent.click(button);
	await waitFor(() =>
		expect(state.disconnect).toHaveBeenCalledWith({
			expectedAccount: "account-a",
		})
	);
	expect(
		screen.getByRole("button", { name: "Disconnect this Mac" })
	).toBeTruthy();
	expect(state.connect).not.toHaveBeenCalled();
});

it("does not continue a previous account's completed connection after Desktop changes account", async () => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: false,
	};
	let complete: (value: unknown) => void = () => undefined;
	state.connect.mockReturnValue(
		new Promise((resolve) => {
			complete = resolve;
		})
	);
	const onCompleted = vi.fn();
	const view = renderConnection(
		<DesktopComputerConnection onCompleted={onCompleted} />
	);
	const button = screen.getByRole("button", { name: "Connect this Mac" });
	await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
	fireEvent.click(button);
	state.account = "account-b";
	view.rerender(<DesktopComputerConnection onCompleted={onCompleted} />);
	complete({
		status: "reused",
		connection: { deviceId: "account-a-mac", runtimeLane: "prod" },
	});
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connect this Mac" })
				.hasAttribute("disabled")
		).toBe(false)
	);
	expect(onCompleted).not.toHaveBeenCalled();
	expect(
		screen.queryByText("Using this computer's existing connection.")
	).toBeNull();
});
