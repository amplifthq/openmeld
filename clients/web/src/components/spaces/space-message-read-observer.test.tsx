import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceMessageReadObserver } from "./space-message-read-observer";

const desktopPlatformMock = vi.hoisted(() => vi.fn());
vi.mock("#/desktop/platform", () => ({
	getDesktopPlatform: desktopPlatformMock,
}));

const messages = [
	{ id: "long-reply", createdAtMs: 10 },
	{ id: "next-reply", createdAtMs: 20 },
];
const targets: SpaceInboxUnreadTarget[] = messages.map((message) => ({
	signalId: message.id,
	occurredAtMs: message.createdAtMs,
	threadRootSignalId: "root",
}));

function Harness(input: {
	onRead?: (timestamp: number) => Promise<void> | void;
	unreadTargets?: readonly SpaceInboxUnreadTarget[];
	scope?: string;
}) {
	return (
		<div data-testid="viewport">
			<SpaceMessageReadObserver
				key={input.scope ?? "thread-a"}
				onViewedThroughTs={input.onRead}
				unreadTargets={input.unreadTargets ?? targets}
			/>
			<div data-message-row-id="long-reply">
				A reply longer than the viewport
			</div>
			<div data-message-row-id="next-reply">A later reply below the fold</div>
		</div>
	);
}

describe("Space message read visibility", () => {
	it("does not mark a visible Desktop conversation read until it regains focus", async () => {
		desktopPlatformMock.mockReturnValue({});
		const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
		const onRead = vi.fn();
		render(<Harness onRead={onRead} />);
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(onRead).not.toHaveBeenCalled();
		focus.mockReturnValue(true);
		fireEvent.focus(window);
		await act(() => vi.advanceTimersByTimeAsync(200));
		expect(onRead).toHaveBeenCalledWith(10);
	});
	let firstTop: number;
	let secondTop: number;
	let covered: boolean;
	beforeEach(() => {
		desktopPlatformMock.mockReturnValue(null);
		vi.useFakeTimers();
		firstTop = 150;
		secondTop = 1800;
		covered = false;
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: (_x: number, y: number) =>
				covered
					? document.body
					: ([
							...document.querySelectorAll<HTMLElement>(
								"[data-message-row-id]"
							),
						].find((element) => {
							const rect = element.getBoundingClientRect();
							return y >= rect.top && y < rect.bottom;
						}) ?? null),
		});
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				if (this.dataset.testid === "viewport") {
					return new DOMRect(0, 100, 500, 400);
				}
				return new DOMRect(
					0,
					this.dataset.messageRowId === "long-reply" ? firstTop : secondTop,
					500,
					1600
				);
			}
		);
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {
					/* Geometry is controlled by scroll events in these tests. */
				}
				unobserve() {
					/* No native layout observer in jsdom. */
				}
				disconnect() {
					/* No native layout observer in jsdom. */
				}
			}
		);
	});
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("reads a long reply from its beginning without reading the next reply below the viewport", async () => {
		const persist = vi.fn();
		const view = render(<Harness onRead={persist} />);
		await act(async () => vi.advanceTimersByTimeAsync(149));
		expect(persist).not.toHaveBeenCalled();
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(persist).toHaveBeenCalledExactlyOnceWith(10);
		firstTop = -1500;
		secondTop = 150;
		fireEvent.scroll(view.getByTestId("viewport"));
		await act(async () => vi.advanceTimersByTimeAsync(150));
		expect(persist).toHaveBeenLastCalledWith(20);
	});

	it.each([
		"hidden",
		"scrolled-away",
		"access-withdrawn",
		"closed",
		"covered",
	])("cancels the dwell when %s", async (reason) => {
		const persist = vi.fn();
		const view = render(<Harness onRead={persist} />);
		await act(async () => vi.advanceTimersByTimeAsync(75));
		if (reason === "hidden") {
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				value: "hidden",
			});
			fireEvent(document, new Event("visibilitychange"));
		} else if (reason === "scrolled-away") {
			firstTop = 480;
			fireEvent.scroll(view.getByTestId("viewport"));
		} else if (reason === "covered") {
			covered = true;
		} else if (reason === "access-withdrawn") {
			view.rerender(<Harness />);
		} else {
			view.unmount();
		}
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		expect(persist).not.toHaveBeenCalled();
	});

	it("does not acknowledge cached messages while the document is in the background", async () => {
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		const persist = vi.fn();
		render(<Harness onRead={persist} />);
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		expect(persist).not.toHaveBeenCalled();
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		fireEvent(document, new Event("visibilitychange"));
		await act(async () => vi.advanceTimersByTimeAsync(150));
		expect(persist).toHaveBeenCalledExactlyOnceWith(10);
	});

	it("does not let a later reaction on a visible message clear an unseen message", async () => {
		const persist = vi.fn();
		render(
			<Harness
				onRead={persist}
				unreadTargets={[{ ...targets[0], occurredAtMs: 100 }, targets[1]]}
			/>
		);
		await act(async () => vi.advanceTimersByTimeAsync(150));
		expect(persist).not.toHaveBeenCalled();
	});

	it("does not clear an unread message skipped by a deep link", async () => {
		firstTop = -1500;
		secondTop = 150;
		const persist = vi.fn();
		render(<Harness onRead={persist} />);
		await act(async () => vi.advanceTimersByTimeAsync(150));
		expect(persist).not.toHaveBeenCalled();
	});

	it("keeps the dwell across callback rerenders and resets it for a different conversation", async () => {
		const persist = vi.fn();
		const view = render(<Harness onRead={(ts) => persist(ts)} />);
		await act(async () => vi.advanceTimersByTimeAsync(75));
		view.rerender(<Harness onRead={(ts) => persist(ts)} />);
		await act(async () => vi.advanceTimersByTimeAsync(75));
		expect(persist).toHaveBeenCalledExactlyOnceWith(10);
		view.rerender(<Harness onRead={persist} scope="thread-b" />);
		await act(async () => vi.advanceTimersByTimeAsync(149));
		expect(persist).toHaveBeenCalledTimes(1);
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(persist).toHaveBeenCalledTimes(2);
	});

	it("retries a failed write without duplicating an in-flight read", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const persist = vi
			.fn()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const view = render(<Harness onRead={persist} />);
		await act(async () => vi.advanceTimersByTimeAsync(150));
		expect(persist).toHaveBeenCalledTimes(1);
		await act(async () => vi.advanceTimersByTimeAsync(350));
		expect(persist).toHaveBeenCalledTimes(2);
		fireEvent.scroll(view.getByTestId("viewport"));
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		expect(persist).toHaveBeenCalledTimes(2);
	});
});
