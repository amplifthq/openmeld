import { describe, expect, it } from "vitest";
import {
  clampNumber,
  resolveAnchoredVisibleWindow,
  resolveOffsetVisibleWindow,
} from "../src/ui/visible-window";

describe("visible window helpers", () => {
  it("clamps numbers into the requested range", () => {
    expect(clampNumber(Number.NaN, 0, 4)).toBe(0);
    expect(clampNumber(-2, 0, 4)).toBe(0);
    expect(clampNumber(7, 0, 4)).toBe(4);
    expect(clampNumber(3, 0, 4)).toBe(3);
  });

  it("resolves an anchored visible window for centered lists", () => {
    expect(
      resolveAnchoredVisibleWindow({
        anchorIndex: 0,
        itemCount: 10,
        maxVisible: 4,
      })
    ).toEqual({
      start: 0,
      end: 4,
    });
    expect(
      resolveAnchoredVisibleWindow({
        anchorIndex: 6,
        itemCount: 10,
        maxVisible: 4,
      })
    ).toEqual({
      start: 4,
      end: 8,
    });
    expect(
      resolveAnchoredVisibleWindow({
        anchorIndex: 9,
        itemCount: 10,
        maxVisible: 4,
      })
    ).toEqual({
      start: 6,
      end: 10,
    });
  });

  it("resolves an offset visible window for scroll viewports", () => {
    expect(
      resolveOffsetVisibleWindow({
        itemCount: 3,
        maxVisible: 5,
        offset: 2,
      })
    ).toEqual({
      start: 0,
      end: 3,
    });
    expect(
      resolveOffsetVisibleWindow({
        itemCount: 10,
        maxVisible: 4,
        offset: 3,
      })
    ).toEqual({
      start: 3,
      end: 7,
    });
    expect(
      resolveOffsetVisibleWindow({
        itemCount: 10,
        maxVisible: 4,
        offset: 99,
      })
    ).toEqual({
      start: 6,
      end: 10,
    });
  });
});
