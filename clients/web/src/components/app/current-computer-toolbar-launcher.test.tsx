import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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
	});

	it("offers Computer setup only when this account has no current device", () => {
		useLocalRuntimeQueriesMock.mockReturnValue(buildRuntimeQueries({}));

		render(<CurrentComputerToolbarLauncher />);

		const launcher = screen.getByRole("link", {
			name: "Connect this Computer",
		});
		expect(launcher.getAttribute("href")).toBe("/o/acme/connect?session=fresh");
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
			data: null,
			isFetchedAfterMount: true,
			isFetching: false,
		},
		localRuntimesQuery: {
			data: {
				currentDeviceId: input.currentDeviceId ?? null,
				localRuntimes,
			},
		},
	};
}
