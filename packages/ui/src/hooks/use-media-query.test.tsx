import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./use-media-query";

const listeners = new Set<() => void>();
let matches = false;

beforeEach(() => {
  matches = false;
  listeners.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      dispatchEvent: vi.fn(),
      get matches() {
        return matches;
      },
      media: query,
      onchange: null,
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
    })),
  });
});

afterEach(cleanup);

describe("useMediaQuery", () => {
  it("tracks the current media query result", () => {
    const { result } = renderHook(() => useMediaQuery("(max-width: 639px)"));
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      for (const listener of listeners) {
        listener();
      }
    });

    expect(result.current).toBe(true);
  });
});
