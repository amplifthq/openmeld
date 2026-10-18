import { describe, expect, it } from "vitest";
import { type PickNearestInput, pickNearest } from "./use-fluid-hover";

// Four columns, six real tiles: the last two cells are empty.
const grid: Omit<PickNearestInput, "point"> = {
  axis: "xy",
  maxDistance: 4,
  rects: Array.from({ length: 6 }, (_, i) => ({
    left: (i % 4) * 84,
    top: Math.floor(i / 4) * 108,
    width: 80,
    height: 104,
  })),
  containerRect: { left: 0, top: 0, width: 332, height: 212 },
  layoutSize: { width: 332, height: 212 },
  scroll: { x: 0, y: 0 },
  border: { x: 0, y: 0 },
};
describe("bounded Fluid Hover", () => {
  it("keeps real tiles and their small horizontal, vertical and diagonal gaps active", () => {
    for (const point of [
      { x: 40, y: 50 },
      { x: 82, y: 50 },
      { x: 40, y: 106 },
      { x: 82, y: 106 },
    ]) {
      expect(pickNearest({ ...grid, point })).not.toBeNull();
    }
  });
  it("clears the empty last-row cells instead of attracting a top or left tile", () => {
    for (const point of [
      { x: 208, y: 160 },
      { x: 292, y: 160 },
      { x: 175, y: 205 },
    ]) {
      expect(pickNearest({ ...grid, point })).toBeNull();
    }
  });
  it("keeps the default upstream behavior for consumers without a distance bound", () => {
    expect(
      pickNearest({
        ...grid,
        maxDistance: undefined,
        point: { x: 208, y: 160 },
      })
    ).not.toBeNull();
  });
  it("does not highlight disabled neighbors", () => {
    expect(
      pickNearest({
        ...grid,
        point: { x: 82, y: 50 },
        isDisabled: (i) => i < 2,
      })
    ).toBeNull();
  });
  it("measures the limit in viewport pixels after scaling and scrolling", () => {
    const scaled = {
      ...grid,
      containerRect: { left: 10, top: 20, width: 664, height: 424 },
      scroll: { x: 0, y: 10 },
    };
    expect(pickNearest({ ...scaled, point: { x: 174, y: 50 } })).toBe(0);
    expect(pickNearest({ ...scaled, point: { x: 343, y: 320 } })).toBeNull();
  });
});
