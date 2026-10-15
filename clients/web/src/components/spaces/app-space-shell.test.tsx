import { createWakeProgressItem } from "@openmeld/space";
import { cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	OUTER_SIDEBAR_DEFAULT_STATE,
	rememberClientSidebarState,
} from "#/lib/sidebar-width-cookie";
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
	AppOuterRail: (props: { messengerNavigation?: ReactNode }) => {
		appOuterRailSpy(props);
		return <aside data-testid="outer-rail">{props.messengerNavigation}</aside>;
	},
}));

vi.mock("#/components/app/app-shell-account", () => ({
	useAppShellAccount: () => ({
		email: "test-1@openmeld.invalid",
		image: null,
		name: "Test 1",
	}),
}));

vi.mock("#/components/app/current-computer", () => ({
	CurrentComputerToolbarLauncher: () => null,
	useCurrentComputer: () => null,
}));

vi.mock("#/components/spaces/conversations-sidebar", () => ({
	ConversationsSidebar: () => (
		<nav data-testid="conversations-sidebar">Conversations</nav>
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
	const scope = { profileId: "human-1", spaceId: "space-1" };
	usePublishSpaceWakeProgressVisibleProjection(
		RUNNING_WAKE_PROGRESS_ITEMS,
		scope
	);
	const items = useSpaceWakeProgressVisibleProjection(scope);
	return (
		<output data-testid="visible-wake-progress-count">
			{items?.length ?? 0}
		</output>
	);
}

function ScopedWakeProjection(input: { profileId: string; spaceId: string }) {
	const items = useSpaceWakeProgressVisibleProjection(input);
	return (
		<output data-testid="scoped-projection">
			{items === null ? "unpublished" : items.length}
		</output>
	);
}

const NO_VISIBLE_WAKE_ITEMS: typeof RUNNING_WAKE_PROGRESS_ITEMS = [];

function MovingWakeProjection(input: {
	profileId: string;
	spaceId: string;
	items: typeof RUNNING_WAKE_PROGRESS_ITEMS;
}) {
	usePublishSpaceWakeProgressVisibleProjection(input.items, input);
	return null;
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
	it.each([
		["", "hidden"],
		["space-1", "expanded"],
	])("uses the untouched sidebar default for Space %s", (spaceId, state) => {
		rememberClientSidebarState("outer", OUTER_SIDEBAR_DEFAULT_STATE);
		render(
			<AppSpaceShell currentProfileId="human-1" currentSpaceId={spaceId}>
				<div>Space</div>
			</AppSpaceShell>
		);
		expect(
			screen.getByTestId("app-module-sidebar").getAttribute("data-state")
		).toBe(state);
	});
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
		expect(screen.queryByTestId("conversations-sidebar")).toBeNull();
		expect(screen.getByText("Main content")).toBeTruthy();
	});

	it("requires no placeholder profile or Space ids when the sidebar is hidden", () => {
		render(
			<AppSpaceShell showSpacesSidebar={false}>
				<div>Center Agent loading</div>
			</AppSpaceShell>
		);

		expect(screen.getByText("Center Agent loading")).toBeTruthy();
		expect(screen.queryByTestId("conversations-sidebar")).toBeNull();
		expect(screen.getByTestId("space-window-frame")).toBeTruthy();
	});

	it("places Spaces navigation in the middle column with one fixed application rail", () => {
		render(
			<AppSpaceShell currentProfileId="human-1" currentSpaceId="space-1">
				<div>Main content</div>
			</AppSpaceShell>
		);

		expect(appInnerSidebarSpy).not.toHaveBeenCalled();
		expect(
			screen
				.getByTestId("app-module-sidebar")
				.contains(screen.getByTestId("conversations-sidebar"))
		).toBe(true);
		expect(
			screen
				.getByTestId("outer-rail")
				.contains(screen.getByTestId("conversations-sidebar"))
		).toBe(false);
	});

	it("owns the visible Wake progress projection shared by the conversation and sidebar", () => {
		const view = render(
			<AppSpaceShell currentProfileId="human-1" currentSpaceId="space-1">
				<WakeProgressProjectionTestSurface />
			</AppSpaceShell>
		);

		expect(screen.getByTestId("visible-wake-progress-count").textContent).toBe(
			"1"
		);
		const rail = screen.getByTestId("outer-rail");
		const sidebar = screen.getByTestId("conversations-sidebar");
		view.rerender(
			<AppSpaceShell currentProfileId="human-1" currentSpaceId="space-2">
				<div>Next conversation</div>
			</AppSpaceShell>
		);
		expect(screen.getByTestId("outer-rail")).toBe(rail);
		expect(screen.getByTestId("conversations-sidebar")).toBe(sidebar);
	});

	it.each([
		{ profileId: "human-1", spaceId: "space-2" },
		{ profileId: "human-2", spaceId: "space-1" },
	])("does not carry a visible Wake into another scope or a later visit: %j", (next) => {
		const first = { profileId: "human-1", spaceId: "space-1" };
		const frame = (scope: typeof first, publish: boolean) => (
			<AppSpaceShell
				currentProfileId={scope.profileId}
				currentSpaceId={scope.spaceId}
			>
				{publish ? <WakeProgressProjectionTestSurface /> : null}
				<ScopedWakeProjection {...scope} />
			</AppSpaceShell>
		);
		const view = render(frame(first, true));
		expect(screen.getByTestId("scoped-projection").textContent).toBe("1");
		// A mounted producer for the previous scope cannot publish into the new one.
		view.rerender(frame(next, true));
		expect(screen.getByTestId("scoped-projection").textContent).toBe(
			"unpublished"
		);
		view.rerender(frame(first, false));
		expect(screen.getByTestId("scoped-projection").textContent).toBe(
			"unpublished"
		);
		view.rerender(frame(first, true));
		expect(screen.getByTestId("scoped-projection").textContent).toBe("1");
		view.rerender(frame(first, false));
		expect(screen.getByTestId("scoped-projection").textContent).toBe(
			"unpublished"
		);
	});

	it("keeps the current publication through StrictMode and repeated conversation visits", () => {
		const frame = (
			spaceId: string,
			items: typeof RUNNING_WAKE_PROGRESS_ITEMS | null
		) => (
			<StrictMode>
				<AppSpaceShell currentProfileId="human-1" currentSpaceId={spaceId}>
					{items === null ? null : (
						<MovingWakeProjection
							items={items}
							profileId="human-1"
							spaceId={spaceId}
						/>
					)}
					<ScopedWakeProjection profileId="human-1" spaceId={spaceId} />
				</AppSpaceShell>
			</StrictMode>
		);
		const view = render(frame("space-1", RUNNING_WAKE_PROGRESS_ITEMS));
		expect(screen.getByTestId("scoped-projection").textContent).toBe("1");
		view.rerender(frame("space-2", NO_VISIBLE_WAKE_ITEMS));
		expect(screen.getByTestId("scoped-projection").textContent).toBe("0");
		view.rerender(frame("space-1", null));
		expect(screen.getByTestId("scoped-projection").textContent).toBe(
			"unpublished"
		);
		view.rerender(frame("space-1", RUNNING_WAKE_PROGRESS_ITEMS));
		expect(screen.getByTestId("scoped-projection").textContent).toBe("1");
		view.rerender(frame("space-2", null));
		expect(screen.getByTestId("scoped-projection").textContent).toBe(
			"unpublished"
		);
	});
});

describe("AppDirectMessageShell", () => {
	it("pairs the conversations sidebar with the shared conversation content", () => {
		appInnerSidebarSpy.mockReset();
		render(
			<AppDirectMessageShell
				currentProfileId="human-1"
				currentSpaceId="space-dm"
			>
				<div>Messages</div>
			</AppDirectMessageShell>
		);

		expect(screen.getByTestId("conversations-sidebar")).toBeTruthy();
		expect(screen.getByText("Messages")).toBeTruthy();
		expect(appInnerSidebarSpy).not.toHaveBeenCalled();
	});
});
