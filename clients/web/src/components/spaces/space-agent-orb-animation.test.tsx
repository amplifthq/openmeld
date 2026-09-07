import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaceAgentOrb } from "./space-agent-orb";

let notify: IntersectionObserverCallback;
let target: Element;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const disconnect = vi.fn();

beforeEach(() => {
	frames.clear();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++frameId, callback);
		return frameId;
	});
	vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: IntersectionObserverCallback) {
				notify = callback;
			}
			observe(element: Element) {
				target = element;
			}
			disconnect = disconnect;
		}
	);
	// Canvas operations consumed by the vendor's actual 2D renderer.
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
		setTransform: vi.fn(),
		clearRect: vi.fn(),
		beginPath: vi.fn(),
		arc: vi.fn(),
		fill: vi.fn(),
	} as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function visibility(...values: boolean[]) {
	// Native Chromium reproduction delivered this same ordered false/true shape.
	const entries = values.map((isIntersecting, time) => ({
		target,
		time,
		isIntersecting,
		intersectionRatio: Number(isIntersecting),
		boundingClientRect: target.getBoundingClientRect(),
		intersectionRect: target.getBoundingClientRect(),
		rootBounds: null,
	}));
	act(() => notify(entries, {} as IntersectionObserver));
}

it("keeps drawing when a batch ends visible, then pauses when it ends offscreen", () => {
	const { unmount } = render(<SpaceAgentOrb />);
	visibility(true);
	expect(frames.size).toBe(1);
	visibility(false, true, false, true);
	expect(frames.size).toBe(1);
	const next = frames.entries().next().value;
	expect(next).toBeDefined();
	if (next) {
		frames.delete(next[0]);
		act(() => next[1](100));
	}
	expect(frames.size).toBe(1);
	visibility(true, false);
	expect(frames.size).toBe(0);
	visibility(true);
	expect(frames.size).toBe(1);
	unmount();
	expect(frames.size).toBe(0);
	expect(disconnect).toHaveBeenCalled();
});
