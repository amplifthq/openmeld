import { cleanup, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CurrentComputerToolbarLauncher } from "./current-computer-toolbar-launcher";

const useLocalRuntimeQueriesMock = vi.hoisted(() => vi.fn());
const useOptionalAppOrganizationMock = vi.hoisted(() => vi.fn());
const useStartFlowStateMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());

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
		useStartFlowStateMock
			.mockReset()
			.mockReturnValue({ storageScope: "user-current" });
		statusMock.mockReset().mockReturnValue(null);
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
			name: "Open Felix's MacBook Pro details, Status unavailable",
		});
		expect(launcher.getAttribute("href")).toBe(
			"/o/acme/computers/device-current"
		);
		expect(launcher.textContent).toContain("Computer");
	});

	it("shows current Computer attention on the toolbar instead of the main sidebar", () => {
		statusMock.mockReturnValue({
			label: "OpenMeld Service is not connected",
			reason: "service_not_connected",
			showLabel: true,
			tone: "danger",
		});

		render(<CurrentComputerToolbarLauncher />);

		expect(screen.getByTestId("current-computer-toolbar-status")).toBeTruthy();
		expect(
			screen.getByRole("link", {
				name: "Open Felix's MacBook Pro details, OpenMeld Service is not connected",
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

	it("does not offer setup when Computer inventory is unavailable", () => {
		useLocalRuntimeQueriesMock.mockReturnValue(
			buildRuntimeQueries({ inventoryState: "failed" })
		);

		render(<CurrentComputerToolbarLauncher />);

		expect(
			screen.queryByRole("link", { name: "Connect this Computer" })
		).toBeNull();
		expect(screen.getByLabelText("Computer status unavailable")).toBeTruthy();
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
			name: "Open Current MacBook Pro details, Status unavailable",
		});
		expect(launcher.getAttribute("href")).toBe(
			"/o/acme/computers/device-current"
		);
		expect(statusMock).toHaveBeenCalledWith({
			isReconcilingStatus: false,
			readiness: null,
		});
	});

	it("does not present cached ready status while current liveness is reconciling", () => {
		statusMock.mockImplementation((input: { isReconcilingStatus: boolean }) =>
			input.isReconcilingStatus
				? {
						label: "Checking OpenMeld Tools status",
						reason: "checking",
						showLabel: true,
						tone: "checking",
					}
				: {
						label: "OpenMeld Tools are ready",
						reason: "ready",
						showLabel: false,
						tone: "ready",
					}
		);
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
				name: "Open Felix's MacBook Pro details, Checking OpenMeld Tools status",
			})
		).toBeTruthy();
		expect(statusMock).toHaveBeenCalledWith({
			isReconcilingStatus: true,
			readiness: {
				deviceId: "device-current",
				service: { connected: true },
			},
		});
	});

	it("keeps an offline result honest while its refresh is in flight", () => {
		statusMock.mockReturnValue({
			label: "OpenMeld Service is not connected",
			reason: "service_not_connected",
			showLabel: true,
			tone: "danger",
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
				name: "Open Felix's MacBook Pro details, OpenMeld Service is not connected",
			})
		).toBeTruthy();
		expect(statusMock).toHaveBeenCalledWith({
			isReconcilingStatus: false,
			readiness: {
				deviceId: "device-current",
				service: { connected: false },
			},
		});
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
			isFetching: input.readinessIsFetching ?? false,
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
