import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveSpaceReadingHeaderPosition,
	SpaceReadingHeaderProvider,
	useSpaceReadingHeader,
} from "./space-reading-header";
import type { SpaceView } from "./space-view";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});

function HeaderFixture(input: { scrollKey?: string }) {
	const context = useSpaceReadingHeader();
	return (
		<>
			<header>
				<div data-testid="header" ref={context?.setHeader}>
					<div data-slot="space-window-header-title">
						<h1>Design</h1>
						<span />
					</div>
					<div data-slot="space-window-header-navigation">Messages Files</div>
				</div>
			</header>
			<div
				data-testid="scroller"
				key={input.scrollKey}
				ref={context?.setScrollElement}
			/>
		</>
	);
}

function mockHeaderResize() {
	let resize: () => void = () => undefined;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				resize = callback;
			}
			observe() {
				/* Resize delivery is controlled by this fixture. */
			}
			disconnect() {
				/* No browser observer exists in this fixture. */
			}
		}
	);
	return () => resize();
}

function setConversationGeometry(
	scroller: HTMLElement,
	header: HTMLElement,
	scrollTop: number
) {
	Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
	Object.defineProperty(scroller, "clientHeight", {
		get: () => (header.dataset.compact === "true" ? 540 : 500),
	});
	scroller.scrollTop = scrollTop;
}

describe("Space reading header", () => {
	it("ignores small scrolls and stays compact until returning near the latest messages", () => {
		let compact = false;
		for (const [distance, expected] of [
			[0, false],
			[3, false],
			[5, false],
			[32, false],
			[63.5, false],
			[64, true],
			[63.5, true],
			[32, true],
			[16.5, true],
			[16, false],
			[17, false],
			[63.5, false],
			[64, true],
			[-0.5, false],
		] as const) {
			compact = resolveSpaceReadingHeaderPosition(distance, compact);
			expect(compact).toBe(expected);
		}
	});

	it("retains the reading anchor across views and embedded window resizes", () => {
		const resize = mockHeaderResize();
		const renderHeader = (view: SpaceView) => (
			<SpaceReadingHeaderProvider
				isDirectMessage={false}
				organizationSlug="workspace"
				profileId="reader"
				spaceId="design"
				view={view}
			>
				<HeaderFixture />
			</SpaceReadingHeaderProvider>
		);
		const view = render(renderHeader("messages"));
		const header = screen.getByTestId("header");
		const scroller = screen.getByTestId("scroller");
		let width = 800;
		header.style.paddingLeft = "24px";
		Object.defineProperty(header, "clientWidth", { get: () => width });
		setConversationGeometry(scroller, header, 1500);
		act(() => resize());
		fireEvent.wheel(scroller, { deltaY: -5 });
		scroller.scrollTop = 1495;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).not.toBe("true");
		expect(scroller.scrollTop).toBe(1495);
		scroller.scrollTop = 1436;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("true");
		expect(scroller.scrollTop).toBe(1396);
		// Viewport resize notifications do not expand it or offset the anchor twice.
		act(() => resize());
		fireEvent.scroll(scroller);
		expect(scroller.scrollTop).toBe(1396);
		// View changes must not briefly expand the header or compensate the
		// transcript a second time, even when its scroller stays mounted.
		const layoutChanges = new MutationObserver(() => undefined);
		layoutChanges.observe(header, {
			attributes: true,
			attributeFilter: ["data-compact"],
		});
		const frame = header.closest("header");
		if (!frame) {
			throw new Error("Expected the header frame");
		}
		layoutChanges.observe(frame, {
			attributes: true,
			attributeFilter: ["style"],
		});
		const compactHeight = frame.style.height;
		for (const nextView of ["tasks", "files", "messages"] as const) {
			view.rerender(renderHeader(nextView));
			expect(layoutChanges.takeRecords()).toHaveLength(0);
			expect(header.dataset.compact).toBe("true");
			expect(frame.style.height).toBe(compactHeight);
			expect(scroller.scrollTop).toBe(1396);
			if (nextView !== "messages") {
				fireEvent.wheel(scroller, { deltaY: 100 });
				scroller.scrollTop = 1460;
				fireEvent.scroll(scroller);
				expect(header.dataset.compact).toBe("true");
				scroller.scrollTop = 1396;
			}
		}
		layoutChanges.disconnect();
		// Programmatic restoration after returning to Messages is not a user scroll.
		scroller.scrollTop = 1460;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("true");
		scroller.scrollTop = 1396;
		width = 200;
		act(() => resize());
		expect(header.dataset.compact).toBe("false");
		expect(scroller.scrollTop).toBe(1436);
		width = 800;
		act(() => resize());
		expect(header.dataset.compact).toBe("true");
		fireEvent.wheel(scroller, { deltaY: 48 });
		scroller.scrollTop = 1443;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("true");
		scroller.scrollTop = 1444;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("false");
		expect(scroller.scrollTop).toBe(1484);
	});

	it("rebinds replacement scrollers without resetting layout and cleans up on exit", () => {
		const resize = mockHeaderResize();
		const renderHeader = (
			scrollKey: string,
			spaceId = "design",
			isDirectMessage = false
		) => (
			<StrictMode>
				<SpaceReadingHeaderProvider
					isDirectMessage={isDirectMessage}
					organizationSlug="workspace"
					profileId="reader"
					spaceId={spaceId}
					view="messages"
				>
					<HeaderFixture scrollKey={scrollKey} />
				</SpaceReadingHeaderProvider>
			</StrictMode>
		);
		const view = render(renderHeader("first"));
		const header = screen.getByTestId("header");
		const firstScroller = screen.getByTestId("scroller");
		header.style.paddingLeft = "24px";
		Object.defineProperty(header, "clientWidth", { value: 800 });
		setConversationGeometry(firstScroller, header, 1500);
		act(() => resize());
		fireEvent.touchMove(firstScroller);
		firstScroller.scrollTop = 1436;
		fireEvent.scroll(firstScroller);
		expect(header.dataset.compact).toBe("true");
		const frame = header.closest("header");
		const compactHeight = frame?.style.height;
		view.rerender(renderHeader("replacement"));
		const scroller = screen.getByTestId("scroller");
		expect(scroller).not.toBe(firstScroller);
		expect(screen.getByTestId("header")).toBe(header);
		expect(frame?.style.height).toBe(compactHeight);
		setConversationGeometry(scroller, header, 1396);
		// The detached scroller must no longer control the header.
		firstScroller.scrollTop = 1460;
		fireEvent.scroll(firstScroller);
		expect(header.dataset.compact).toBe("true");
		// A replacement starts with fresh user intent; restoration is not a gesture.
		scroller.scrollTop = 1460;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("true");
		fireEvent.keyDown(scroller, { key: "End" });
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("false");
		expect(scroller.scrollTop).toBe(1500);
		fireEvent.keyDown(scroller, { key: "PageUp" });
		scroller.scrollTop = 1436;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("true");
		// Space preferences remain isolated and restore without a new gesture.
		view.rerender(renderHeader("replacement", "other-space"));
		expect(header.dataset.compact).toBe("false");
		view.rerender(renderHeader("replacement"));
		expect(header.dataset.compact).toBe("true");
		view.rerender(renderHeader("replacement", "design", true));
		expect(header.dataset.compact).toBeUndefined();
		expect(frame?.style.height).toBe("");
		fireEvent.wheel(scroller, { deltaY: -100 });
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBeUndefined();
		view.rerender(renderHeader("replacement"));
		expect(header.dataset.compact).toBe("true");
		view.unmount();
		expect(header.dataset.compact).toBeUndefined();
		expect(frame?.style.height).toBe("");
	});
});
