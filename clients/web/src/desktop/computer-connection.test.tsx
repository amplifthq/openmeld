import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
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
	disconnectWithFeedback: vi.fn(),
	feedbackAvailable: false,
	localRuntimesRefetch: vi.fn().mockResolvedValue({ isError: false }),
	currentProgress: vi.fn().mockResolvedValue(null),
	currentOperation: vi.fn().mockResolvedValue(null),
	progressHandler: null as ((event: unknown) => void) | null,
	operationHandler: null as ((event: unknown) => void) | null,
	account: "account-a",
}));
vi.mock("./platform", () => ({
	getDesktopPlatform: () => ({
		connectComputer: state.connect,
		disconnectComputer: state.disconnect,
		disconnectComputerWithFeedback: state.feedbackAvailable
			? state.disconnectWithFeedback
			: undefined,
		computerOperationCurrent: state.feedbackAvailable
			? state.currentOperation
			: undefined,
		onComputerOperation: state.feedbackAvailable
			? (handler: (event: unknown) => void) => {
					state.operationHandler = handler;
					return () => {
						state.operationHandler = null;
					};
				}
			: undefined,
		connectionProgressCurrent: state.currentProgress,
		connectionOperationCurrent: state.currentOperation,
		localComputer: state.localComputer,
		onConnectionProgress: (handler: (event: unknown) => void) => {
			state.progressHandler = handler;
			return () => {
				state.progressHandler = null;
			};
		},
		onConnectionOperation: (handler: (event: unknown) => void) => {
			state.operationHandler = handler;
			return () => {
				state.operationHandler = null;
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
		localRuntimesQuery: { refetch: state.localRuntimesRefetch },
	}),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	state.account = "account-a";
	state.feedbackAvailable = false;
	state.disconnect.mockReset().mockResolvedValue(false);
	state.disconnectWithFeedback.mockReset();
	state.localRuntimesRefetch.mockReset().mockResolvedValue({ isError: false });
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: false,
	};
	state.currentProgress.mockResolvedValue(null);
	state.currentOperation.mockResolvedValue(null);
	state.progressHandler = null;
	state.operationHandler = null;
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
	const button = await screen.findByRole("button", {
		name: "Connect this Mac",
	});
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
	const connect = await screen.findByRole("button", {
		name: "Connect this Mac",
	});
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
	{
		label: "completion",
		result: {
			status: "reused",
			connection: { deviceId: "device-a", runtimeLane: "prod" },
		},
		expected: "Using the existing connection.",
	},
	{
		label: "failure",
		result: {
			status: "failed",
			message: "The account switch failed.",
			diagnosticId: "diagnostic-a",
		},
		expected: "The account switch failed.",
	},
	{
		label: "cancellation",
		result: { status: "cancelled" },
		expected: "Connection unchanged.",
	},
])("adopts $label from the existing main-process operation after remount", async ({
	result,
	expected,
}) => {
	const pending = desktopOperation({ status: "pending" });
	state.currentOperation.mockResolvedValue(pending);
	const first = renderConnection(<DesktopComputerConnection />);
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connecting…" })
				.hasAttribute("disabled")
		).toBe(true)
	);
	first.unmount();

	renderConnection(<DesktopComputerConnection />);
	await waitFor(() => expect(state.operationHandler).not.toBeNull());
	const settled = desktopOperation({ status: "settled", result });
	state.currentOperation.mockResolvedValue(settled);
	state.operationHandler?.(settled);

	expect(await screen.findByText(expected)).toBeTruthy();
	const buttonName =
		result.status === "failed" ? "Try again" : "Connect this Mac";
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: buttonName }).hasAttribute("disabled")
		).toBe(false)
	);
	expect(state.connect).not.toHaveBeenCalled();
});

it("does not let late active progress reopen a settled adopted operation", async () => {
	state.currentOperation.mockResolvedValue(
		desktopOperation({ status: "pending" })
	);
	renderConnection(<DesktopComputerConnection />);
	await waitFor(() => expect(state.operationHandler).not.toBeNull());
	const settled = desktopOperation({
		status: "settled",
		result: { status: "cancelled" },
	});
	state.currentOperation.mockResolvedValue(settled);
	state.operationHandler?.(settled);
	await screen.findByText("Connection unchanged.");

	state.progressHandler?.(connectionProgress(99));

	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connect this Mac" })
				.hasAttribute("disabled")
		).toBe(false)
	);
	expect(state.connect).not.toHaveBeenCalled();
});

it("consumes the same adopted settlement only once", async () => {
	let resolveCurrent: (value: unknown) => void = () => undefined;
	state.currentOperation.mockReturnValue(
		new Promise((resolve) => {
			resolveCurrent = resolve;
		})
	);
	const onCompleted = vi.fn();
	const onContinue = vi.fn();
	renderConnection(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			onContinue={onContinue}
		/>
	);
	await waitFor(() => expect(state.operationHandler).not.toBeNull());
	const settled = desktopOperation({
		status: "settled",
		result: {
			status: "reused",
			connection: { deviceId: "device-a", runtimeLane: "prod" },
		},
	});
	state.operationHandler?.(settled);
	resolveCurrent(settled);

	await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
	expect(onContinue).toHaveBeenCalledOnce();
});

it("does not replay an old success into a fresh reset or source-action request", async () => {
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: true,
	};
	state.currentOperation.mockResolvedValue(
		desktopOperation({
			status: "settled",
			result: {
				status: "reused",
				connection: { deviceId: "device-a", runtimeLane: "prod" },
			},
		})
	);
	const onCompleted = vi.fn();
	const onContinue = vi.fn();
	renderConnection(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			onContinue={onContinue}
			sourceNavigationAction={{ spaceId: "space-a", signalId: "signal-a" }}
		/>
	);

	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connect this Mac" })
				.hasAttribute("disabled")
		).toBe(false)
	);
	expect(onCompleted).not.toHaveBeenCalled();
	expect(onContinue).not.toHaveBeenCalled();
	expect(screen.queryByText("Using the existing connection.")).toBeNull();
});

it("does not let a delayed pending record reopen its settled operation", async () => {
	state.currentOperation.mockResolvedValue(
		desktopOperation({ status: "pending" })
	);
	renderConnection(<DesktopComputerConnection />);
	await waitFor(() => expect(state.operationHandler).not.toBeNull());
	const settled = desktopOperation({
		status: "settled",
		result: { status: "cancelled" },
	});
	state.operationHandler?.(settled);
	await screen.findByText("Connection unchanged.");

	state.operationHandler?.(desktopOperation({ status: "pending" }));

	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connect this Mac" })
				.hasAttribute("disabled")
		).toBe(false)
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
	const button = await screen.findByRole("button", {
		name: "Connect this Mac",
	});
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

it("explains the first unknown state before offering a connection action", async () => {
	const check = createDeferred<unknown>();
	state.localComputer.mockReturnValue(check.promise);
	renderConnection(<DesktopComputerConnection allowDisconnect />);
	expect(
		screen
			.getByRole("button", { name: "Checking this Mac…" })
			.hasAttribute("disabled")
	).toBe(true);
	expect(screen.getByText("Checking this Mac’s connection…")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Disconnect this Mac" })
	).toBeNull();
	await act(() => {
		check.resolve({ status: "unavailable", message: "No connection yet." });
	});
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connect this Mac" })
				.hasAttribute("disabled")
		).toBe(false)
	);
});

it.each([
	"ordinary",
	"embedded",
	"reconnect",
] as const)("shows the confirmed connection in the %s flow without offering first-time setup", async (flow) => {
	state.localComputer.mockResolvedValue(availableComputer());
	state.routeIntent.resetThisComputer = flow === "reconnect";
	const onCompleted = vi.fn();
	renderConnection(
		<DesktopComputerConnection
			allowDisconnect={flow !== "embedded"}
			onCompleted={onCompleted}
		/>
	);
	const label = {
		ordinary: "Disconnect this Mac",
		embedded: "Continue",
		reconnect: "Reconnect this Mac",
	}[flow];
	const button = await screen.findByRole("button", { name: label });
	expect(screen.getByText("Connected")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Connect this Mac" })).toBeNull();
	expect(state.connect).not.toHaveBeenCalled();
	if (flow === "embedded") {
		fireEvent.click(button);
		await waitFor(() =>
			expect(onCompleted).toHaveBeenCalledWith(availableComputer().target)
		);
		expect(state.connect).not.toHaveBeenCalled();
	}
});

it.each([
	"account-a",
	"account-b",
])("uses background display data only for its matching account: %s", async (accountId) => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(["desktop", "computer-connection", "account-a"], {
		...availableComputer(),
		accountId,
	});
	state.localComputer.mockReturnValue(new Promise(() => undefined));
	renderConnection(<DesktopComputerConnection allowDisconnect />, client);
	const button = screen.getByRole("button", {
		name:
			accountId === "account-a" ? "Disconnect this Mac" : "Connect this Mac",
	});
	expect(button.hasAttribute("disabled")).toBe(accountId !== "account-a");
	await waitFor(() => expect(state.localComputer).toHaveBeenCalledOnce());
	expect(client.isFetching()).toBe(1);
});

it("reports real Disconnect stages, refuses duplicate requests and keeps the outer operation identity", async () => {
	state.feedbackAvailable = true;
	state.localComputer.mockResolvedValue(availableComputer());
	const result = createDeferred<unknown>();
	state.disconnectWithFeedback.mockReturnValue(result.promise);
	renderConnection(<DesktopComputerConnection allowDisconnect />);
	const button = await screen.findByRole("button", {
		name: "Disconnect this Mac",
	});
	fireEvent.click(button);
	fireEvent.click(button);
	expect(state.disconnectWithFeedback).toHaveBeenCalledOnce();
	expect(state.disconnectWithFeedback).toHaveBeenCalledWith({
		expectedAccount: "account-a",
		expectedConnection: availableComputer().target,
	});
	expect(screen.getByText("Checking this Mac before Disconnect…")).toBeTruthy();
	await act(() => {
		state.operationHandler?.(disconnectOperation("waiting_for_confirmation"));
	});
	expect(
		screen
			.getByRole("button", { name: "Waiting for confirmation…" })
			.hasAttribute("disabled")
	).toBe(true);
	expect(
		screen.getByText(
			"Waiting for confirmation in Desktop. Choose Cancel or Disconnect this Mac in the native dialog."
		)
	).toBeTruthy();
	await act(() => {
		state.operationHandler?.({
			...disconnectOperation("disconnecting", { status: "disconnected" }),
			operationId: "another-operation",
		});
	});
	expect(
		screen.getByRole("button", { name: "Waiting for confirmation…" })
	).toBeTruthy();
	await act(() => {
		state.operationHandler?.(disconnectOperation("disconnecting"));
	});
	expect(
		screen.getByText(
			"Disconnect confirmed. Waiting for OpenMeld to report the final result…"
		)
	).toBeTruthy();
	await act(() => {
		state.operationHandler?.(disconnectOperation("checking"));
		state.operationHandler?.(
			disconnectOperation("disconnecting", { status: "cancelled" })
		);
		result.resolve({ status: "cancelled" });
	});
	expect(
		await screen.findByText(
			"Disconnect cancelled. The connection was not changed."
		)
	).toBeTruthy();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(state.localComputer).toHaveBeenCalledOnce();
	expect(state.disconnect).not.toHaveBeenCalled();
});

it.each([
	"connection_changed",
	"failed",
	"unconfirmed",
] as const)("shows a %s Disconnect result with diagnostics and requires a read before another mutation", async (status) => {
	state.feedbackAvailable = true;
	state.localComputer.mockResolvedValue(availableComputer());
	state.disconnectWithFeedback.mockResolvedValue({
		status,
		code: `desktop.disconnect.${status}`,
		message: "Check the connection before trying again.",
		diagnosticId: "operation-diagnostic-a",
		diagnosticsPath: "/test-owned/computer-operation/diagnostics.json",
	});
	renderConnection(<DesktopComputerConnection allowDisconnect />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Disconnect this Mac" })
	);
	expect(
		await screen.findByText("Check the connection before trying again.")
	).toBeTruthy();
	expect(screen.getByText("Connection unconfirmed")).toBeTruthy();
	expect(screen.getByText(`desktop.disconnect.${status}`)).toBeTruthy();
	expect(screen.getByText("operation-diagnostic-a")).toBeTruthy();
	expect(
		screen.getByText(
			"Diagnostic file: /test-owned/computer-operation/diagnostics.json"
		)
	).toBeTruthy();
	expect(
		screen
			.getByRole("button", { name: "Disconnect this Mac" })
			.hasAttribute("disabled")
	).toBe(true);
	expect(
		screen.queryByText(
			"Disconnected. This Mac remains in your Computers list. Desktop stays signed in."
		)
	).toBeNull();
	expect(state.localComputer).toHaveBeenCalledOnce();
	state.localComputer.mockResolvedValue({
		status: "unavailable",
		message: "No confirmed connection.",
	});
	fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Try again" }).hasAttribute("disabled")
		).toBe(false)
	);
	expect(state.disconnectWithFeedback).toHaveBeenCalledOnce();
	expect(state.connect).not.toHaveBeenCalled();
});

it("does not mistake an IPC rejection for a known Disconnect failure", async () => {
	state.feedbackAvailable = true;
	state.localComputer.mockResolvedValue(availableComputer());
	state.disconnectWithFeedback.mockRejectedValue(
		new Error("Raw private failure detail")
	);
	renderConnection(<DesktopComputerConnection allowDisconnect />);
	fireEvent.click(
		await screen.findByRole("button", { name: "Disconnect this Mac" })
	);
	expect(
		await screen.findByText(
			"The Disconnect result could not be confirmed. Check the connection before trying again."
		)
	).toBeTruthy();
	expect(screen.queryByText("Raw private failure detail")).toBeNull();
	expect(screen.getByRole("button", { name: "Check connection" })).toBeTruthy();
});

it("reopens a pending native Disconnect and never replays retained connect success or late pending", async () => {
	state.feedbackAvailable = true;
	state.localComputer.mockResolvedValue(availableComputer());
	state.currentOperation.mockResolvedValue(
		disconnectOperation("waiting_for_confirmation")
	);
	const onCompleted = vi.fn();
	const onContinue = vi.fn();
	const page = (
		<DesktopComputerConnection
			allowDisconnect
			onCompleted={onCompleted}
			onContinue={onContinue}
		/>
	);
	const first = renderConnection(page);
	await screen.findByRole("button", { name: "Waiting for confirmation…" });
	first.unmount();
	renderConnection(page);
	await screen.findByRole("button", { name: "Waiting for confirmation…" });
	state.localComputer.mockResolvedValue({
		status: "unavailable",
		message: "No connection.",
	});
	state.localRuntimesRefetch.mockReturnValue(new Promise(() => undefined));
	await act(() => {
		state.operationHandler?.(
			disconnectOperation("disconnecting", { status: "disconnected" })
		);
	});
	expect(
		await screen.findByText(
			"Disconnected. This Mac remains in your Computers list. Desktop stays signed in."
		)
	).toBeTruthy();
	await waitFor(() =>
		expect(
			screen
				.getByRole("button", { name: "Connect this Mac" })
				.hasAttribute("disabled")
		).toBe(false)
	);
	await act(() => {
		state.operationHandler?.(
			desktopOperation({
				status: "settled",
				result: { status: "reused", connection: availableComputer().target },
			})
		);
		state.operationHandler?.(disconnectOperation("checking"));
	});
	expect(screen.queryByText("Using the existing connection.")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Checking connection…" })
	).toBeNull();
	expect(onCompleted).not.toHaveBeenCalled();
	expect(onContinue).not.toHaveBeenCalled();
	expect(state.disconnectWithFeedback).not.toHaveBeenCalled();
	expect(state.connect).not.toHaveBeenCalled();
});

it.each([
	"slow_directory",
	"failed_directory",
	"failed_native_read",
])("does not turn confirmed connection into failure or wait for ancillary refresh: %s", async (refresh) => {
	state.connect.mockResolvedValue({
		status: "reused",
		connection: availableComputer().target,
	});
	const onCompleted = vi.fn();
	const onContinue = vi.fn();
	renderConnection(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			onContinue={onContinue}
		/>
	);
	const button = await screen.findByRole("button", {
		name: "Connect this Mac",
	});
	if (refresh === "slow_directory") {
		state.localRuntimesRefetch.mockReturnValue(new Promise(() => undefined));
	} else if (refresh === "failed_directory") {
		state.localRuntimesRefetch.mockResolvedValue({ isError: true });
	} else {
		state.localComputer.mockRejectedValue(
			new Error("Couldn’t check this Mac’s connection.")
		);
	}
	fireEvent.click(button);
	await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
	expect(onContinue).toHaveBeenCalledOnce();
	expect(screen.getByText("Using the existing connection.")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	expect(state.localRuntimesRefetch).toHaveBeenCalledOnce();
	expect(state.localComputer).toHaveBeenCalledTimes(2);
	if (refresh !== "slow_directory") {
		expect(
			await screen.findByText(
				"The operation completed, but the connection display could not refresh. Check the connection again."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Check connection" })
		).toBeTruthy();
	}
});

it.each([
	"native_result",
	"native_refresh",
])("ignores an old result when the same account changes request during %s", async (stage) => {
	const completion = createDeferred<unknown>();
	const refresh = createDeferred<unknown>();
	state.connect.mockReturnValue(completion.promise);
	const onCompleted = vi.fn();
	const onContinue = vi.fn();
	const view = renderConnection(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			onContinue={onContinue}
		/>
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Connect this Mac" })
	);
	if (stage === "native_refresh") {
		state.localComputer.mockReturnValue(refresh.promise);
		await act(() => {
			completion.resolve({
				status: "reused",
				connection: availableComputer().target,
			});
		});
		await waitFor(() => expect(state.localComputer).toHaveBeenCalledTimes(2));
	}
	state.routeIntent = {
		kind: "account_computer_setup",
		resetThisComputer: true,
		connectedComputerId: "another-computer",
	};
	view.rerender(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			onContinue={onContinue}
		/>
	);
	await act(() => {
		completion.resolve({
			status: "reused",
			connection: availableComputer().target,
		});
		refresh.resolve({ status: "unavailable", message: "No connection." });
	});
	await screen.findByRole("button", { name: "Connect this Mac" });
	expect(onCompleted).not.toHaveBeenCalled();
	expect(onContinue).not.toHaveBeenCalled();
	expect(screen.queryByText("Using the existing connection.")).toBeNull();
});

it("ignores a stale current read and processes an owned event plus IPC result only once", async () => {
	const current = createDeferred<unknown>();
	const native = createDeferred<unknown>();
	state.currentOperation.mockReturnValue(current.promise);
	state.connect.mockReturnValue(native.promise);
	const onCompleted = vi.fn();
	const onContinue = vi.fn();
	renderConnection(
		<DesktopComputerConnection
			onCompleted={onCompleted}
			onContinue={onContinue}
		/>
	);
	fireEvent.click(
		await screen.findByRole("button", { name: "Connect this Mac" })
	);
	await act(() => {
		current.resolve(
			desktopOperation({
				status: "settled",
				operationId: "old-operation",
				result: { status: "reused", connection: availableComputer().target },
			})
		);
	});
	expect(onCompleted).not.toHaveBeenCalled();
	expect(
		screen.getByRole("button", { name: "Connecting…" }).hasAttribute("disabled")
	).toBe(true);
	const result = { status: "reused", connection: availableComputer().target };
	await act(() => {
		state.operationHandler?.(desktopOperation({ status: "pending" }));
		state.operationHandler?.(desktopOperation({ status: "settled", result }));
		native.resolve(result);
	});
	await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
	expect(onContinue).toHaveBeenCalledOnce();
	await act(() => {
		state.operationHandler?.(desktopOperation({ status: "settled", result }));
		state.operationHandler?.(desktopOperation({ status: "pending" }));
	});
	expect(onCompleted).toHaveBeenCalledOnce();
	expect(onContinue).toHaveBeenCalledOnce();
	expect(
		screen
			.getByRole("button", { name: "Connect this Mac" })
			.hasAttribute("disabled")
	).toBe(false);
});

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function availableComputer() {
	return {
		status: "available" as const,
		accountId: "account-a",
		target: { deviceId: "this-mac", runtimeLane: "prod" as const },
	};
}

function disconnectOperation(
	phase: "checking" | "waiting_for_confirmation" | "disconnecting",
	result?: { status: "cancelled" | "disconnected" }
) {
	return {
		kind: "disconnect",
		operationId: "desktop-disconnect-a",
		request: {
			expectedAccount: "account-a",
			expectedConnection: availableComputer().target,
		},
		status: result ? "settled" : "pending",
		phase,
		result: result ?? null,
	};
}

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

function connectionProgress(sequence = 1) {
	return {
		schemaVersion: 1 as const,
		expectedAccount: "account-a",
		operationId: "operation-adopted",
		attemptId: "attempt-adopted",
		prepareSessionId: "prepare-adopted",
		sequence,
		startedAt: "2026-09-17T00:00:00.000Z",
		observedAt: "2026-09-17T00:00:01.000Z",
		phase: "connecting_service" as const,
		state: "active" as const,
		code: "desktop.connection.connecting_service",
	};
}

function desktopOperation(input: {
	operationId?: string;
	request?: Record<string, unknown>;
	status: "pending" | "settled";
	result?: unknown;
}) {
	return {
		operationId: input.operationId ?? "desktop-operation-adopted",
		request: input.request ?? {
			expectedAccount: "account-a",
			humanProfileId: "11111111-1111-4111-8111-111111111111",
			targetSpaceId: null,
			resetThisComputer: false,
		},
		status: input.status,
		progress: connectionProgress(),
		result: input.result ?? null,
		errorMessage: null,
	};
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
	const button = await screen.findByRole("button", {
		name: "Connect this Mac",
	});
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
	expect(screen.queryByText("Using the existing connection.")).toBeNull();
});
