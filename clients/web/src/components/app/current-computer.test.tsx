import {
	cleanup,
	render as renderView,
	screen,
	waitFor,
} from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CurrentComputerProvider,
	CurrentComputerToolbarLauncher,
} from "./current-computer";

function render(ui: ReactElement) {
	return renderView(ui, { wrapper: CurrentComputerProvider });
}

const useLocalRuntimeQueriesMock = vi.hoisted(() => vi.fn());
const useOptionalAppOrganizationMock = vi.hoisted(() => vi.fn());
const useStartFlowStateMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
const displaySnapshotQueryMock = vi.hoisted(() => vi.fn());
const queryClientMock = vi.hoisted(() => ({ setQueryData: vi.fn() }));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: displaySnapshotQueryMock,
	useQueryClient: () => queryClientMock,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children?: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@openmeld/ui/components/tooltip", () => ({
	Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
	TooltipContent: ({
		align,
		children,
		className,
	}: {
		align?: string;
		children: ReactNode;
		className?: string;
	}) => (
		<span
			className={className}
			data-align={align}
			data-testid="toolbar-tooltip"
		>
			{children}
		</span>
	),
	TooltipTrigger: ({
		children,
		render,
	}: {
		children: ReactNode;
		render: ReactElement;
	}) => cloneElement(render, undefined, children),
}));

vi.mock("#/components/agents/use-local-runtime-queries", () => ({
	useLocalRuntimeQueries: useLocalRuntimeQueriesMock,
}));

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: useStartFlowStateMock,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: useOptionalAppOrganizationMock,
}));

vi.mock("#/lib/computer-summary-status", () => ({
	resolveCurrentLocalRuntimeComputerSummaryStatus: statusMock,
	resolveCurrentLocalRuntimeSubjectDeviceId: (readiness: unknown) =>
		(readiness as { deviceId?: string } | null)?.deviceId ?? null,
}));

describe("CurrentComputerToolbarLauncher", () => {
	beforeEach(() => {
		useOptionalAppOrganizationMock.mockReset().mockReturnValue({
			currentOrganization: { slug: "acme" },
		});
		useStartFlowStateMock.mockReset().mockReturnValue({
			state: { selectedHumanProfileId: "human-current" },
			storageScope: "user-current",
		});
		statusMock.mockReset().mockReturnValue(null);
		displaySnapshotQueryMock.mockReset().mockReturnValue({ data: undefined });
		queryClientMock.setQueryData.mockReset();
		useLocalRuntimeQueriesMock.mockReset().mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
			})
		);
	});

	afterEach(cleanup);

	it("opens the current Computer detail directly from the far-left toolbar entry", () => {
		render(<CurrentComputerToolbarLauncher />);

		const launcher = screen.getByRole("link", {
			name: "Open Felix's MacBook Pro details, Connection status delayed",
		});
		expect(launcher.getAttribute("href")).toBe(
			"/o/acme/computers/device-current"
		);
		expect(launcher.textContent).toContain("Computer");
	});

	it("shows ordinary disconnection with a muted toolbar dot", () => {
		statusMock.mockReturnValue({
			label: "Disconnected",
			reason: "service_not_connected",
			showLabel: true,
			tone: "muted",
		});

		render(<CurrentComputerToolbarLauncher />);

		expect(
			screen.getByTestId("current-computer-toolbar-status").className
		).toContain("bg-muted-foreground");
		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, Disconnected",
			})
		).toBeTruthy();
		const tooltip = screen.getByTestId("toolbar-tooltip");
		expect(tooltip.getAttribute("data-align")).toBe("start");
		expect(tooltip.classList.contains("text-left")).toBe(true);
	});

	it("offers Computer setup only when this account has no current device", () => {
		useLocalRuntimeQueriesMock.mockReturnValue(buildRuntimeQueries({}));

		render(<CurrentComputerToolbarLauncher />);

		const launcher = screen.getByRole("link", {
			name: "Connect this Computer",
		});
		expect(launcher.getAttribute("href")).toBe("/o/acme/connect?session=fresh");
	});

	it("does not offer setup before Computer inventory finishes loading", () => {
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({ inventoryState: "pending" })
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(
			screen.queryByRole("link", { name: "Connect this Computer" })
		).toBeNull();
		expect(screen.getByLabelText("Checking this Computer")).toBeTruthy();
	});

	it("restores Computer attention while inventory reloads after a refresh", () => {
		displaySnapshotQueryMock.mockReturnValue({
			data: {
				currentComputer: {
					attention: {
						reason: "agent_check_failed",
						tone: "warning",
					},
					deviceId: "device-current",
				},
				version: 1,
			},
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({ inventoryState: "pending" })
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.getByTestId("current-computer-toolbar-status")).toBeTruthy();
		expect(screen.getByLabelText("Computer, Check delayed")).toBeTruthy();
	});

	it("opens Computers when Computer inventory cannot be loaded", () => {
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({ inventoryState: "failed" })
		);

		render(<CurrentComputerToolbarLauncher />);

		const launcher = screen.getByRole("link", {
			name: "Open Computers; couldn’t load Computer status",
		});
		expect(launcher.getAttribute("href")).toBe("/o/acme/computers");
		expect(screen.getByTestId("toolbar-tooltip").textContent).toContain(
			"Couldn’t load Computer status"
		);
	});

	it("ignores cached readiness for a Computer that is no longer in inventory", () => {
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				readinessDeviceId: "device-forgotten",
				staleCurrentDeviceId: "device-forgotten",
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		const launcher = screen.getByRole("link", {
			name: "Connect this Computer",
		});
		expect(launcher.getAttribute("href")).toBe("/o/acme/connect?session=fresh");
	});

	it("does not apply another Computer's cached readiness to the selected Computer", () => {
		statusMock.mockImplementation(
			(input: { readiness: { deviceId?: string } | null }) =>
				input.readiness
					? {
							label: "OpenMeld Tools are ready",
							reason: "ready",
							showLabel: false,
							tone: "ready",
						}
					: null
		);
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Current MacBook Pro",
				readinessDeviceId: "device-forgotten",
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		const launcher = screen.getByRole("link", {
			name: "Open Current MacBook Pro details, Connection status delayed",
		});
		expect(launcher.getAttribute("href")).toBe(
			"/o/acme/computers/device-current"
		);
		expect(statusMock).toHaveBeenCalledWith({
			executionTarget: null,
			isReconcilingStatus: false,
			readiness: null,
		});
	});

	it("keeps cached ready status while liveness refreshes in the background", () => {
		statusMock.mockReturnValue({
			label: "OpenMeld Tools are ready",
			reason: "ready",
			showLabel: false,
			tone: "ready",
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				readinessDeviceId: "device-current",
				readinessIsFetching: true,
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, OpenMeld Tools are ready",
			})
		).toBeTruthy();
		expect(screen.queryByTestId("current-computer-toolbar-status")).toBeNull();
		expect(statusMock).toHaveBeenCalledWith({
			executionTarget: null,
			isReconcilingStatus: true,
			readiness: {
				deviceId: "device-current",
				service: { connected: true },
			},
		});
	});

	it("uses the selected Computer execution target for status guidance", () => {
		const executionTarget = {
			isCurrent: true,
			runtimeLane: "dev-local",
		};
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				executionTargets: [executionTarget],
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(statusMock).toHaveBeenCalledWith({
			executionTarget,
			isReconcilingStatus: false,
			readiness: null,
		});
	});

	it("keeps warning attention visible while status refreshes in the background", () => {
		statusMock.mockReturnValue({
			label: "Check delayed",
			reason: "agent_check_failed",
			showLabel: true,
			tone: "warning",
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				readinessDeviceId: "device-current",
				readinessIsFetching: true,
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.getByTestId("current-computer-toolbar-status")).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, Check delayed",
			})
		).toBeTruthy();
		expect(statusMock).toHaveBeenCalledWith({
			executionTarget: null,
			isReconcilingStatus: true,
			readiness: {
				deviceId: "device-current",
				service: { connected: true },
			},
		});
	});

	it("uses restored attention until the current Computer readiness arrives", () => {
		displaySnapshotQueryMock.mockReturnValue({
			data: {
				currentComputer: {
					attention: {
						reason: "agent_check_failed",
						tone: "warning",
					},
					deviceId: "device-current",
				},
				version: 1,
			},
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				readinessIsFetching: true,
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.getByTestId("current-computer-toolbar-status")).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, Check delayed",
			})
		).toBeTruthy();
	});

	it("does not apply restored attention to a different current Computer", () => {
		displaySnapshotQueryMock.mockReturnValue({
			data: {
				currentComputer: {
					attention: {
						reason: "agent_check_failed",
						tone: "warning",
					},
					deviceId: "device-previous",
				},
				version: 1,
			},
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Current MacBook Pro",
				readinessIsFetching: true,
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.queryByTestId("current-computer-toolbar-status")).toBeNull();
		expect(
			screen.getByRole("link", {
				name: "Open Current MacBook Pro details, Connection status delayed",
			})
		).toBeTruthy();
	});

	it("stores only the coarse attention snapshot after live readiness resolves", async () => {
		statusMock.mockReturnValue({
			label: "Check delayed",
			reason: "agent_check_failed",
			showLabel: true,
			tone: "warning",
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				readinessDeviceId: "device-current",
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		await waitFor(() =>
			expect(queryClientMock.setQueryData).toHaveBeenCalled()
		);
		const updater = queryClientMock.setQueryData.mock.calls[0]?.[1] as (
			current: undefined
		) => unknown;
		expect(updater(undefined)).toEqual({
			currentComputer: {
				attention: {
					reason: "agent_check_failed",
					tone: "warning",
				},
				deviceId: "device-current",
			},
			version: 1,
		});
	});

	it("clears restored attention after live readiness becomes healthy", async () => {
		displaySnapshotQueryMock.mockReturnValue({
			data: {
				currentComputer: {
					attention: {
						reason: "agent_check_failed",
						tone: "warning",
					},
					deviceId: "device-current",
				},
				version: 1,
			},
		});
		statusMock.mockReturnValue({
			label: "OpenMeld Tools are ready",
			reason: "ready",
			showLabel: false,
			tone: "ready",
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				readinessDeviceId: "device-current",
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.queryByTestId("current-computer-toolbar-status")).toBeNull();
		await waitFor(() =>
			expect(queryClientMock.setQueryData).toHaveBeenCalled()
		);
		const updater = queryClientMock.setQueryData.mock.calls[0]?.[1] as (
			current: undefined
		) => unknown;
		expect(updater(undefined)).toEqual({
			currentComputer: {
				attention: null,
				deviceId: "device-current",
			},
			version: 1,
		});
	});

	it("keeps a disconnected result honest while its refresh is in flight", () => {
		statusMock.mockReturnValue({
			label: "Disconnected",
			reason: "service_not_connected",
			showLabel: true,
			tone: "muted",
		});
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({
				currentDeviceId: "device-current",
				deviceDisplayName: "Felix's MacBook Pro",
				readinessDeviceId: "device-current",
				readinessIsFetching: true,
				readinessServiceConnected: false,
			})
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, Disconnected",
			})
		).toBeTruthy();
		expect(statusMock).toHaveBeenCalledWith({
			executionTarget: null,
			isReconcilingStatus: false,
			readiness: {
				deviceId: "device-current",
				service: { connected: false },
			},
		});
	});

	it("pairs an exact local-agent status with its icon and accessible text", () => {
		statusMock.mockReturnValue({
			label: "Sign in to Claude Code",
			localAgent: { agentId: "claude-code", displayName: "Claude Code" },
			reason: "agent_sign_in_needed",
			showLabel: true,
			tone: "muted",
		});

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.getByTestId("local-agent-logo-claude-code")).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, Sign in to Claude Code",
			})
		).toBeTruthy();
	});

	it("stays hidden before the app shell has an Organization context", () => {
		useOptionalAppOrganizationMock.mockReturnValue(null);

		const view = render(<CurrentComputerToolbarLauncher />);

		expect(view.container.childElementCount).toBe(0);
		expect(useStartFlowStateMock).not.toHaveBeenCalled();
		expect(useLocalRuntimeQueriesMock).not.toHaveBeenCalled();
	});
});

function buildRuntimeQueries(input: {
	currentDeviceId?: string;
	deviceDisplayName?: string;
	executionTargets?: Array<{ isCurrent: boolean; runtimeLane: string }>;
	inventoryState?: "failed" | "pending" | "ready";
	readinessDeviceId?: string;
	readinessIsFetching?: boolean;
	readinessServiceConnected?: boolean;
	staleCurrentDeviceId?: string;
}) {
	const localRuntimes = input.currentDeviceId
		? [
				{
					deviceDisplayName: input.deviceDisplayName,
					deviceId: input.currentDeviceId,
					executionTargets: input.executionTargets ?? [],
					isCurrent: true,
				},
			]
		: [];
	return {
		currentLocalRuntimeReplyReadinessQuery: {
			data: input.readinessDeviceId
				? {
						deviceId: input.readinessDeviceId,
						service: {
							connected: input.readinessServiceConnected ?? true,
						},
					}
				: null,
			isFetchedAfterMount: true,
			isError: false,
			isFetching: input.readinessIsFetching ?? false,
			isPending:
				(input.readinessIsFetching ?? false) && !input.readinessDeviceId,
		},
		localRuntimesQuery: {
			data:
				input.inventoryState === "failed" || input.inventoryState === "pending"
					? undefined
					: {
							currentDeviceId:
								input.staleCurrentDeviceId ?? input.currentDeviceId ?? null,
							localRuntimes,
						},
			isError: input.inventoryState === "failed",
			isPending: input.inventoryState === "pending",
			isSuccess:
				input.inventoryState === undefined || input.inventoryState === "ready",
		},
	};
}
