import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactFlowInstance, Viewport } from "@xyflow/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDeskEntrance } from "./use-desk-entrance";

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
function entrance(
	savedViewport: Viewport | null = null,
	greetingHidden = false
) {
	const element = document.createElement("section");
	const setViewport = vi.fn().mockResolvedValue(undefined);
	const instance = { setViewport } as unknown as ReactFlowInstance;
	const saveViewport = vi.fn();
	const flow = { current: null as ReactFlowInstance | null };
	const region = { current: element };
	const hook = renderHook(() =>
		useDeskEntrance({
			region,
			flow,
			width: 1000,
			height: 640,
			savedViewport,
			greetingHidden,
			saveViewport,
		})
	);
	act(() => hook.result.current.initialize(instance));
	return { ...hook, element, setViewport, saveViewport };
}
it("frames the Space immediately when the greeting was dismissed", () => {
	const entry = entrance(null, true);
	expect(entry.element.dataset.deskEntrance).toBe("ready");
	expect(entry.saveViewport).toHaveBeenCalledWith({ x: 32, y: -168, zoom: 1 });
	expect(vi.getTimerCount()).toBe(0);
});
it("skips the entrance when reduced motion is requested", () => {
	vi.stubGlobal("matchMedia", () => ({ matches: true }));
	const entry = entrance();
	expect(entry.setViewport).toHaveBeenCalledWith(
		expect.objectContaining({ zoom: 1 })
	);
	expect(vi.getTimerCount()).toBe(0);
});
it("does not replay the entrance over a saved viewport", () => {
	const entry = entrance({ x: 32, y: -250, zoom: 1 });
	expect(entry.setViewport).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
});
it("allows immediate user interruption before the zoom begins", () => {
	const entry = entrance();
	expect(entry.setViewport).toHaveBeenCalledTimes(1);
	act(() => entry.result.current.interrupt());
	act(() => vi.advanceTimersByTime(2000));
	expect(entry.setViewport).toHaveBeenCalledTimes(1);
});
it("does not persist intermediate animation frames", () => {
	const entry = entrance();
	act(() => entry.result.current.onMoveEnd({ x: 50, y: 24, zoom: 0.7 }));
	expect(entry.saveViewport).not.toHaveBeenCalled();
	act(() => entry.result.current.interrupt());
	act(() => entry.result.current.onMoveEnd({ x: 50, y: 24, zoom: 0.8 }));
	expect(entry.saveViewport).toHaveBeenCalledTimes(1);
});

it("reveals the greeting, arrow, and Space in order before centering the complete window", () => {
	const entry = entrance();
	expect(entry.element.dataset.deskEntrance).toBe("pending");
	act(() => vi.advanceTimersByTime(300));
	expect(entry.element.dataset.deskEntrance).toBe("greeting");
	act(() => vi.advanceTimersByTime(450));
	expect(entry.element.dataset.deskEntrance).toBe("arrow");
	act(() => vi.advanceTimersByTime(350));
	expect(entry.element.dataset.deskEntrance).toBe("space");
	act(() => vi.advanceTimersByTime(1600));
	expect(entry.element.dataset.deskEntrance).toBe("ready");
	expect(entry.saveViewport).toHaveBeenLastCalledWith({
		x: 32,
		y: -168,
		zoom: 1,
	});
});
