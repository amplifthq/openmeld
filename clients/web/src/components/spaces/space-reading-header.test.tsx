import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveSpaceReadingHeaderPosition,
	SpaceReadingHeaderProvider,
	useSpaceReadingHeader,
} from "./space-reading-header";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});

function HeaderFixture() {
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
			<div data-testid="scroller" ref={context?.setScrollElement} />
		</>
	);
}

describe("Space reading header", () => {
	it("snaps on a small scroll and stays compact until returning to the latest messages", () => {
		let compact = false;
		for (const [distance, expected] of [
			[0, false],
			[5, true],
			[3, true],
			[2, true],
			[1, false],
			[3, false],
			[5, true],
		] as const) {
			compact = resolveSpaceReadingHeaderPosition(distance, compact);
			expect(compact).toBe(expected);
		}
	});

	it("uses endpoint geometry in embedded windows and retains the reading anchor", () => {
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
		render(
			<SpaceReadingHeaderProvider
				isDirectMessage={false}
				organizationSlug="workspace"
				profileId="reader"
				spaceId="design"
				view="messages"
			>
				<HeaderFixture />
			</SpaceReadingHeaderProvider>
		);
		const header = screen.getByTestId("header");
		const scroller = screen.getByTestId("scroller");
		let width = 800;
		header.style.paddingLeft = "24px";
		Object.defineProperty(header, "clientWidth", { get: () => width });
		Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
		Object.defineProperty(scroller, "clientHeight", {
			get: () => (header.dataset.compact === "true" ? 540 : 500),
		});
		scroller.scrollTop = 1500;
		act(() => resize());
		fireEvent.wheel(scroller, { deltaY: -5 });
		scroller.scrollTop = 1495;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("true");
		expect(scroller.scrollTop).toBe(1455);
		// Viewport resize notifications do not expand it or offset the anchor twice.
		act(() => resize());
		fireEvent.scroll(scroller);
		expect(scroller.scrollTop).toBe(1455);
		width = 200;
		act(() => resize());
		expect(header.dataset.compact).toBe("false");
		expect(scroller.scrollTop).toBe(1495);
		width = 800;
		act(() => resize());
		expect(header.dataset.compact).toBe("true");
		scroller.scrollTop = 1460;
		fireEvent.scroll(scroller);
		expect(header.dataset.compact).toBe("false");
		expect(scroller.scrollTop).toBe(1500);
	});
});
