import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluidAvatar } from "#components/fluid-avatar";

const renderer = vi.hoisted(() => ({
  draw: vi.fn(),
  animate: vi.fn(),
}));
vi.mock("#lib/fluid-avatar-renderer", () => ({
  fluidAvatarColor: () => "#336699",
  drawFluidAvatar: renderer.draw,
  animateFluidAvatar: renderer.animate,
}));

let drawFrame: ((deltaSeconds: number) => void) | undefined;
let changeMotionPreference: (() => void) | undefined;
let reduced = false;
const stop = vi.fn();

beforeEach(() => {
  reduced = false;
  drawFrame = undefined;
  changeMotionPreference = undefined;
  stop.mockReset();
  renderer.draw.mockReset().mockImplementation((canvas, _color, time = 0) => {
    // Stand in for canvas pixels at the renderer boundary: frame zero is rest.
    canvas.dataset.frame = String(time);
    return true;
  });
  renderer.animate.mockReset().mockImplementation((draw) => {
    drawFrame = draw;
    return stop;
  });
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_event: string, listener: () => void) => {
      changeMotionPreference = listener;
    },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe() {
        this.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver
        );
      }
      disconnect = vi.fn();
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FluidAvatar", () => {
  it.each([
    "work ends",
    "reduced motion is enabled",
  ])("returns to its initial frame when %s", (reason) => {
    const view = render(<FluidAvatar animated seed="agent" size={24} />);
    const canvas = view.container.querySelector("canvas");
    expect(canvas?.dataset.frame).toBe("0");
    act(() => drawFrame?.(0.5));
    expect(canvas?.dataset.frame).toBe("0.5");

    if (reason === "work ends") {
      view.rerender(<FluidAvatar animated={false} seed="agent" size={24} />);
    } else {
      act(() => {
        reduced = true;
        changeMotionPreference?.();
      });
    }

    expect(canvas?.dataset.frame).toBe("0");
    expect(stop).toHaveBeenCalledOnce();
  });
});
