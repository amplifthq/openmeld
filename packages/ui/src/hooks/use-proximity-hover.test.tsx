import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProximityHover } from "./use-proximity-hover";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps grid padding and gaps with the nearest card in both dimensions", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
    frames.push(frame)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  const { result } = renderHook(() =>
    useProximityHover({ current: container }, { axis: "both" })
  );
  act(() => {
    for (let index = 0; index < 10; index++) {
      const row = document.createElement("button");
      container.append(row);
      Object.defineProperties(row, {
        offsetTop: { value: Math.floor(index / 2) * 100 + 8 },
        offsetLeft: { value: (index % 2) * 220 + 8 },
        offsetHeight: { value: 64 },
        offsetWidth: { value: 200 },
      });
      result.current.registerItem(index, row);
    }
    result.current.measureItems();
  });
  for (const [clientX, clientY, expected] of [
    [4, 330, 6],
    [224, 330, 7],
    [210, 330, 6],
    [226, 303, 7],
    [100, 204, 4],
  ] as const) {
    act(() => {
      result.current.handlers.onMouseMove({
        clientX,
        clientY,
        target: container,
      });
      frames.pop()?.(0);
    });
    expect(result.current.activeIndex).toBe(expected);
  }
});

it("remeasures moved rows without requiring a resize or new registration", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
    frames.push(frame)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const container = document.createElement("div");
  const rows = [
    document.createElement("button"),
    document.createElement("button"),
  ] as const;
  container.append(...rows);
  for (const row of rows) {
    Object.defineProperties(row, {
      offsetTop: {
        get: () => Array.from(container.children).indexOf(row) * 40,
      },
      offsetHeight: { value: 40 },
      offsetWidth: { value: 200 },
    });
  }
  const ref = { current: container };
  const { result } = renderHook(() => useProximityHover(ref));
  act(() => {
    for (const [index, row] of rows.entries()) {
      result.current.registerItem(index, row);
    }
    result.current.measureItems();
  });
  expect(result.current.itemRects[0]?.top).toBe(0);
  await act(async () => {
    container.append(rows[0]);
    await Promise.resolve();
  });
  act(() => {
    for (const frame of frames.splice(0)) {
      frame(0);
    }
  });
  expect(result.current.itemRects[0]?.top).toBe(40);
  expect(result.current.itemRects[1]?.top).toBe(0);
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
