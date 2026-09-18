import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComputerConnection } from "../../../desktop/src/main/computer-connection";
import { createLocalComputerReader } from "../../../desktop/src/main/local-computer";
import { DesktopComputerConnection } from "./computer-connection";

const boundary = vi.hoisted(() => ({
	exec: vi.fn(),
	install: vi.fn(),
	session: vi.fn(),
	localComputer: vi.fn(),
	connect: vi.fn(),
	refetchDirectory: vi.fn(),
}));

// Keep the native reader, query/schema and click-to-bootstrap path real. Only
// subprocess execution and the verified installer boundary are simulated.
vi.mock("node:child_process", async () => {
	const { promisify } = await import("node:util");
	const childProcess = {
		execFile: Object.assign(vi.fn(), { [promisify.custom]: boundary.exec }),
		spawn: vi.fn(() => {
			throw new Error("No real setup process in this test");
		}),
	};
	return { ...childProcess, default: childProcess };
});
vi.mock("../../../desktop/src/main/cli/computer-tools", () => ({
	installComputerTools: boundary.install,
}));
vi.mock("./platform", () => ({
	getDesktopPlatform: () => ({
		localComputer: boundary.localComputer,
		connectComputer: boundary.connect,
		connectionOperationCurrent: async () => null,
		onConnectionOperation: () => () => undefined,
		onConnectionProgress: () => () => undefined,
	}),
	openDesktopWeb: vi.fn(),
}));
vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => ({ data: { user: { id: "account-a" } } }),
}));
vi.mock("#/components/connect/bring-agents-setup-context", () => ({
	useBringAgentsSetupContext: () => ({
		routeIntent: { kind: "account_computer_setup", resetThisComputer: false },
		selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
		targetSpaceId: null,
		localRuntimesQuery: { refetch: boundary.refetchDirectory },
	}),
}));

const user = { id: "account-a", email: "a@example.com", name: "A" };
const target = { deviceId: "this-mac", runtimeLane: "dev-local" };
const deps = {
	openMeldBin: "/test-owned/bootstrap/openmeld",
	// Explicit dummy values satisfy Web's generated environment types without
	// inheriting host credentials. Subprocess and network effects remain mocked.
	env: {
		OPENMELD_HOME: "/test-owned/bootstrap",
		OPENMELD_AUTH_URL: "http://localhost:8788",
		OPENMELD_GATEWAY_URL: "http://localhost:8080",
		OPENMELD_WORKER_ENVIRONMENT: "local",
		WEB_APP_URL: "http://localhost:3000",
		AUTH_DESKTOP_DEVELOPMENT_TARGET: "",
		BETTER_AUTH_URL: "http://localhost:8788",
		VITE_BETTER_AUTH_URL: "http://localhost:8788",
		VITE_APP_TITLE: "OpenMeld Web",
		WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET: "test-only-unused",
	} satisfies NodeJS.ProcessEnv,
};
const missingCli = () =>
	Object.assign(new Error("Executable missing"), { code: "ENOENT" });
// Captured from the CLI's Commander parser for missing root/subcommands.
const unsupportedCli = (command: string) =>
	Object.assign(new Error("Command unavailable"), {
		code: 1,
		stderr: `error: unknown command '${command}'\n`,
	});
let client: QueryClient;

beforeEach(() => {
	vi.resetAllMocks();
	client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
});
afterEach(() => {
	cleanup();
	client.clear();
});

function mountConnection(failure: Error, configure?: () => void) {
	let installed = false;
	let finishInstall: () => void = () => undefined;
	const installation = new Promise<void>((resolve) => {
		finishInstall = resolve;
	});
	boundary.exec.mockImplementation(() => {
		if (!installed) {
			return Promise.reject(failure);
		}
		return Promise.resolve({
			stdout: JSON.stringify({
				protocol: "computer-connection-v1",
				previousSessionIdentity: "reviewed-after-install",
				account: { id: user.id, email: user.email },
				existingConnection: target,
			}),
			stderr: "",
		});
	});
	boundary.install.mockImplementation(async () => {
		await installation;
		installed = true;
		return "/test-owned/installed-tools/openmeld.js";
	});
	boundary.session.mockResolvedValue({ user });
	boundary.refetchDirectory.mockResolvedValue({ isError: false });
	configure?.();
	const auth = { session: boundary.session, cloudRequest: vi.fn() };
	boundary.localComputer.mockImplementation(
		createLocalComputerReader(auth, deps)
	);
	boundary.connect.mockImplementation(
		createComputerConnection({
			auth,
			commandDeps: deps,
			webOrigin: "http://lane.localhost:3434",
			webBuild: "test",
			installed: false,
			ensureCompatible: async () => undefined,
			confirmSwitch: async () => false,
		})
	);
	const onCompleted = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<DesktopComputerConnection allowDisconnect onCompleted={onCompleted} />
		</QueryClientProvider>
	);
	return { finishInstall, onCompleted };
}

describe("native read to user-initiated Computer bootstrap", () => {
	it.each([
		["missing CLI", missingCli],
		["old CLI without computer", () => unsupportedCli("computer")],
		[
			"old CLI without connection-review",
			() => unsupportedCli("connection-review"),
		],
	] as const)("keeps Connect reachable for %s without installing on a read", async (_label, failure) => {
		const { finishInstall, onCompleted } = mountConnection(failure());
		await waitFor(() => expect(client.isFetching()).toBe(0));
		expect(boundary.exec).toHaveBeenCalledOnce();
		expect(boundary.exec).toHaveBeenCalledWith(
			deps.openMeldBin,
			["computer", "connection-review", "--json"],
			expect.objectContaining({ env: deps.env })
		);
		expect(boundary.install).not.toHaveBeenCalled();
		expect(boundary.connect).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: "Disconnect this Mac" })
		).toBeNull();
		const button = screen.getByRole("button", { name: "Connect this Mac" });
		expect(button.hasAttribute("disabled")).toBe(false);
		// A refetch sees the same still-missing/old CLI; it cannot repair it.
		await act(async () => {
			await client.refetchQueries();
		});
		expect(boundary.install).not.toHaveBeenCalled();
		fireEvent.click(button);
		await waitFor(() => expect(boundary.install).toHaveBeenCalledOnce());
		expect(boundary.connect).toHaveBeenCalledOnce();
		expect(boundary.install).toHaveBeenCalledWith(
			"http://lane.localhost:3434",
			deps,
			expect.any(Object)
		);
		expect(onCompleted).not.toHaveBeenCalled();
		await act(() => {
			finishInstall();
		});
		await waitFor(() =>
			expect(onCompleted).toHaveBeenCalledExactlyOnceWith(target)
		);
		expect(
			await screen.findByText("Using the existing connection.")
		).toBeTruthy();
		expect(boundary.install).toHaveBeenCalledOnce();
	});

	it.each([
		"identity read failure",
		"permission denied",
		"malformed review",
		"unrelated command",
		"authentication ENOENT",
		"account changed during read",
	])("does not turn %s into bootstrap permission", async (scenario) => {
		mountConnection(new Error("Connection identity unavailable"), () => {
			if (scenario === "permission denied") {
				boundary.exec.mockRejectedValue(
					Object.assign(new Error("Permission denied"), { code: "EACCES" })
				);
			} else if (scenario === "malformed review") {
				boundary.exec.mockResolvedValue({
					stdout: JSON.stringify({ protocol: "invalid" }),
				});
			} else if (scenario === "unrelated command") {
				boundary.exec.mockRejectedValue(unsupportedCli("setup"));
			} else if (scenario === "authentication ENOENT") {
				boundary.session.mockRejectedValue(missingCli());
			} else if (scenario === "account changed during read") {
				let reads = 0;
				boundary.session.mockImplementation(async () => ({
					user: { ...user, id: ++reads % 2 === 1 ? "account-a" : "account-b" },
				}));
				boundary.exec.mockRejectedValue(missingCli());
			}
		});
		await screen.findByRole("alert");
		const button = screen.getByRole("button", { name: "Connect this Mac" });
		expect(button.hasAttribute("disabled")).toBe(true);
		fireEvent.click(button);
		fireEvent.click(screen.getByRole("button", { name: "Check connection" }));
		await waitFor(() =>
			expect(boundary.localComputer).toHaveBeenCalledTimes(2)
		);
		await waitFor(() => expect(client.isFetching()).toBe(0));
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(boundary.connect).not.toHaveBeenCalled();
		expect(boundary.install).not.toHaveBeenCalled();
	});

	it("rechecks the native account before installing from a previously recoverable display", async () => {
		mountConnection(missingCli());
		await waitFor(() => expect(client.isFetching()).toBe(0));
		boundary.session.mockResolvedValue({ user: { ...user, id: "account-b" } });
		fireEvent.click(screen.getByRole("button", { name: "Connect this Mac" }));
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Desktop sign-in changed"
		);
		expect(boundary.connect).toHaveBeenCalledOnce();
		expect(boundary.install).not.toHaveBeenCalled();
	});
});
