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
function entrance(savedViewport: Viewport | null = null) {
	const element = document.createElement("section");
	const setViewport = vi.fn().mockResolvedValue(undefined);
	const instance = { setViewport } as unknown as ReactFlowInstance;
	const saveViewport = vi.fn();
	const flow = { current: null as ReactFlowInstance | null };
	const region = { current: element };
	const hook = renderHook(() =>
		useDeskEntrance({ region, flow, width: 1000, savedViewport, saveViewport })
	);
	act(() => hook.result.current.initialize(instance));
	return { ...hook, setViewport, saveViewport };
}
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
