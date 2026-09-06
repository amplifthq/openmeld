import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProximityHover } from "./use-proximity-hover";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("uses the hit row without a synchronous layout read, while preserving proximity in gaps", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
    frames.push(frame)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  const row = document.createElement("button");
  const label = document.createElement("span");
  row.append(label);
  container.append(row);
  Object.defineProperties(row, {
    offsetTop: { value: 20 },
    offsetHeight: { value: 30 },
    offsetWidth: { value: 200 },
  });
  const measure = vi.spyOn(container, "getBoundingClientRect");
  const { result } = renderHook(() =>
    useProximityHover({ current: container })
  );
  act(() => {
    result.current.registerItem(0, row);
    result.current.measureItems();
  });
  frames.length = 0;
  act(() => {
    result.current.handlers.onMouseMove({
      clientX: 10,
      clientY: 35,
      target: label,
    });
    frames.pop()?.(0);
  });
  expect(result.current.activeIndex).toBe(0);
  expect(measure).not.toHaveBeenCalled();
  act(() => result.current.handlers.onMouseLeave());
  act(() => {
    result.current.handlers.onMouseMove({
      clientX: 10,
      clientY: 55,
      target: container,
    });
    frames.pop()?.(0);
  });
  expect(result.current.activeIndex).toBe(0);
  expect(measure).toHaveBeenCalledOnce();
});
