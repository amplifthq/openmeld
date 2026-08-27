import { createWakeProgressItem } from "@openmeld/space";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AppDirectMessageShell,
	AppSpaceShell,
	SpaceWindowShell,
} from "./app-space-shell";
import {
	usePublishSpaceWakeProgressVisibleProjection,
	useSpaceWakeProgressVisibleProjection,
} from "./space-wake-progress-visible-projection";

const appOuterRailSpy = vi.hoisted(() => vi.fn());
const appInnerSidebarSpy = vi.hoisted(() => vi.fn());

vi.mock("#/components/app/app-inner-sidebar", () => ({
	AppInnerSidebar: (props: { children: ReactNode; preferenceKey?: string }) => {
		appInnerSidebarSpy(props);
		return <aside data-testid="inner-sidebar">{props.children}</aside>;
	},
}));

vi.mock("#/components/app/app-outer-rail", () => ({
	AppOuterRail: (props: unknown) => {
		appOuterRailSpy(props);
		return <aside data-testid="outer-rail" />;
	},
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "test-1@openmeld.invalid",
		image: null,
		name: "Test 1",
	}),
}));

vi.mock("#/components/app/current-computer-toolbar-launcher", () => ({
	CurrentComputerToolbarLauncher: () => null,
}));

vi.mock("#/components/spaces/app-spaces-sidebar", () => ({
	AppSpacesSidebar: () => <nav data-testid="spaces-sidebar">Spaces</nav>,
}));

vi.mock("#/components/spaces/app-direct-messages-sidebar", () => ({
	AppDirectMessagesSidebar: () => (
		<nav data-testid="direct-messages-sidebar">Direct Messages</nav>
	),
}));

const RUNNING_WAKE_PROGRESS_ITEMS = [
	createWakeProgressItem({
		clientMessageId: "client-message-1",
		dispatchId: "dispatch-1",
		phase: "running",
		sourceSignalId: "signal-1",
		targetLabel: "Runner",
		targetProfileId: "agent-1",
		updatedAtMs: 1,
	}),
];

function WakeProgressProjectionTestSurface() {
	usePublishSpaceWakeProgressVisibleProjection(RUNNING_WAKE_PROGRESS_ITEMS);
	const items = useSpaceWakeProgressVisibleProjection();
	return (
		<output data-testid="visible-wake-progress-count">
			{items?.length ?? 0}
		</output>
	);
}

afterEach(() => {
	cleanup();
});

describe("SpaceWindowShell", () => {
	beforeEach(() => {
		appInnerSidebarSpy.mockReset();
		appOuterRailSpy.mockReset();
	});

	it("keeps the main pane as a flex height container", () => {
		render(
			<SpaceWindowShell
				sidebar={<nav>Spaces</nav>}
				sidebarPreferenceKey="spaces"
			>
				<div>Main content</div>
			</SpaceWindowShell>
		);

		const mainContentPane = screen.getByText("Main content").parentElement;

		expect(mainContentPane?.tagName).toBe("SECTION");
		expect(mainContentPane?.className).toContain("flex");
		expect(mainContentPane?.className).toContain("min-h-0");
		expect(mainContentPane?.className).toContain("flex-1");
		expect(screen.getByTestId("space-window-frame")).toBeTruthy();
	});
});

describe("AppSpaceShell", () => {
	beforeEach(() => {
		appInnerSidebarSpy.mockReset();
		appOuterRailSpy.mockReset();
	});

	it("does not mount the inner Spaces sidebar when no Spaces should be shown", () => {
		render(
			<AppSpaceShell showSpacesSidebar={false}>
				<div>Main content</div>
			</AppSpaceShell>
		);

		expect(screen.queryByTestId("inner-sidebar")).toBeNull();
		expect(screen.queryByTestId("spaces-sidebar")).toBeNull();
		expect(screen.getByText("Main content")).toBeTruthy();
	});

	it("requires no placeholder profile or Space ids when the sidebar is hidden", () => {
		render(
			<AppSpaceShell showSpacesSidebar={false}>
				<div>Center Agent loading</div>
			</AppSpaceShell>
		);

		expect(screen.getByText("Center Agent loading")).toBeTruthy();
		expect(screen.queryByTestId("spaces-sidebar")).toBeNull();
		expect(screen.getByTestId("space-window-frame")).toBeTruthy();
	});

	it("owns the Spaces inner-sidebar width preference", () => {
		render(
			<AppSpaceShell currentProfileId="human-1" currentSpaceId="space-1">
				<div>Main content</div>
			</AppSpaceShell>
		);

		expect(appInnerSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({ preferenceKey: "spaces" })
		);
	});

	it("owns the visible Wake progress projection shared by the conversation and sidebar", () => {
		render(
			<AppSpaceShell currentProfileId="human-1" currentSpaceId="space-1">
				<WakeProgressProjectionTestSurface />
			</AppSpaceShell>
		);

		expect(screen.getByTestId("visible-wake-progress-count").textContent).toBe(
			"1"
		);
	});
});

describe("AppDirectMessageShell", () => {
	it("pairs the Direct Messages sidebar with the shared conversation content", () => {
		appInnerSidebarSpy.mockReset();
		render(
			<AppDirectMessageShell
				currentProfileId="human-1"
				currentSpaceId="space-dm"
			>
				<div>Messages</div>
			</AppDirectMessageShell>
		);

		expect(screen.getByTestId("direct-messages-sidebar")).toBeTruthy();
		expect(screen.queryByTestId("spaces-sidebar")).toBeNull();
		expect(screen.getByText("Messages")).toBeTruthy();
		expect(appInnerSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({ preferenceKey: "direct-messages" })
		);
	});
});
