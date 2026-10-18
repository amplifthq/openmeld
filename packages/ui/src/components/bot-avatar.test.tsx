import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { BotAvatarPose } from "bot-avatars";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotAvatar } from "#components/bot-avatar";

vi.mock("bot-avatars", async (original) => ({
  ...(await original<typeof import("bot-avatars")>()),
  drawBotAvatarFrame: (
    ctx: CanvasRenderingContext2D,
    _size: number,
    pose: BotAvatarPose
  ) => {
    // Record the rendered pose at the canvas boundary; run the real simulation.
    ctx.canvas.dataset.pose = JSON.stringify(pose);
  },
}));

let now = 0;
let nextFrame = 0;
let reduced = false;
let intersect: ((visible: boolean) => void) | undefined;
const frames = new Map<number, FrameRequestCallback>();
const mediaListeners = new Set<() => void>();

function advance(milliseconds: number) {
  act(() => {
    const end = now + milliseconds;
    while (now < end) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) {
        callback(now);
      }
    }
  });
}

beforeEach(() => {
  now = 0;
  nextFrame = 0;
  reduced = false;
  intersect = undefined;
  frames.clear();
  mediaListeners.clear();
  vi.stubGlobal("devicePixelRatio", 1);
  vi.stubGlobal("Path2D", class {});
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("reduced-motion") ? reduced : true;
    },
    addEventListener: (_event: string, listener: () => void) =>
      mediaListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      mediaListeners.delete(listener),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return {
        canvas: this,
        setTransform: vi.fn(),
        clearRect: vi.fn(),
        drawImage: (source: CanvasImageSource) => {
          if (source instanceof HTMLCanvasElement) {
            this.dataset.pose = source.dataset.pose;
          }
        },
      } as unknown as CanvasRenderingContext2D;
    }
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        intersect = (visible) =>
          this.callback(
            [
              {
                target,
                time: now,
                isIntersecting: visible,
                intersectionRatio: visible ? 1 : 0,
                boundingClientRect: new DOMRect(),
                intersectionRect: new DOMRect(),
                rootBounds: null,
              },
            ],
            this as unknown as IntersectionObserver
          );
      }
      disconnect = () => {
        intersect = undefined;
      };
    }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Bot avatar interaction", () => {
  it("keeps navigation clicks still in pointer mode while following the mouse and showing work", () => {
    const open = vi.fn();
    const view = render(
      <button onClick={open} type="button">
        <BotAvatar interaction="pointer" size={32} type="flower" />
      </button>
    );
    const canvas = view.container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Missing avatar canvas");
    }
    const resting = canvas.dataset.pose;
    fireEvent.click(canvas);
    advance(160);
    expect(open).toHaveBeenCalledOnce();
    expect(canvas.dataset.pose).toBe(resting);
    expect(frames.size).toBe(0);
    fireEvent(
      canvas,
      Object.assign(new Event("pointermove", { bubbles: true }), {
        pointerType: "mouse",
        clientX: 40,
        clientY: 0,
      })
    );
    advance(240);
    expect(JSON.parse(canvas.dataset.pose ?? "{}").lookX).toBeGreaterThan(0);
    fireEvent.pointerLeave(canvas);
    advance(400);
    expect(frames.size).toBe(0);
    view.rerender(
      <button onClick={open} type="button">
        <BotAvatar interaction="pointer" size={32} type="flower" working />
      </button>
    );
    advance(240);
    expect(frames.size).toBe(1);
    expect(canvas.dataset.pose).not.toBe(resting);
    act(() => {
      reduced = true;
      for (const listener of mediaListeners) {
        listener();
      }
    });
    const still = canvas.dataset.pose;
    fireEvent.click(canvas);
    advance(240);
    expect(frames.size).toBe(0);
    expect(canvas.dataset.pose).toBe(still);
  });
  it("shows the ambient avatar's first frame before the canvas hydrates", () => {
    const markup = renderToStaticMarkup(
      <BotAvatar ambient palette="original" size={28} type="clover" />
    );
    const html = document.createElement("div");
    html.innerHTML = markup;
    const canvas = html.querySelector("canvas");
    expect(canvas?.style.backgroundImage).toContain("data:image/svg+xml");
    expect(canvas?.style.opacity).toBe("1");
    expect(frames.size).toBe(0);
  });

  it("uses natural idle and pointer motion with a full click spin, and suspends playful motion", () => {
    const view = render(
      <BotAvatar interaction="playful" size={48} type="clover" />
    );
    const canvas = view.container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Missing avatar canvas");
    }
    const resting = canvas.dataset.pose;
    advance(240);
    expect(canvas.dataset.pose).not.toBe(resting);
    const pointer = (x: number) => {
      fireEvent(
        canvas,
        Object.assign(new Event("pointermove", { bubbles: true }), {
          pointerType: "mouse",
          clientX: x,
          clientY: 0,
        })
      );
      advance(240);
      return JSON.parse(canvas.dataset.pose ?? "{}").lookX as number;
    };
    expect(pointer(48)).toBeGreaterThan(0);
    expect(pointer(-48)).toBeLessThan(0);
    fireEvent.pointerLeave(canvas);
    fireEvent.click(canvas);
    let largestTurn = 0;
    for (let step = 0; step < 100; step++) {
      advance(16);
      const pose = JSON.parse(canvas.dataset.pose ?? "{}") as BotAvatarPose;
      largestTurn = Math.max(largestTurn, Math.abs(pose.yaw));
    }
    // A full turn passes the back of the head, unlike the subtle hop.
    expect(largestTurn).toBeGreaterThan(Math.PI);
    expect(frames.size).toBe(1);
    act(() => intersect?.(false));
    expect(frames.size).toBe(0);
    act(() => intersect?.(true));
    expect(frames.size).toBe(1);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    act(() => {
      reduced = true;
      for (const listener of mediaListeners) {
        listener();
      }
    });
    const still = canvas.dataset.pose;
    fireEvent.click(canvas);
    advance(500);
    expect(canvas.dataset.pose).toBe(still);
    expect(frames.size).toBe(0);
    view.unmount();
    expect(frames.size).toBe(0);
  });

  it("disables working, click, and pointer motion together and can resume", () => {
    const open = vi.fn();
    const view = render(
      <BotAvatar followPointer onClick={open} size={24} type="star" working />
    );
    advance(120);
    expect(frames.size).toBe(1);
    view.rerender(
      <BotAvatar
        followPointer
        motionEnabled={false}
        onClick={open}
        size={24}
        type="star"
        working
      />
    );
    const canvas = view.container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Missing avatar canvas");
    }
    const still = canvas.dataset.pose;
    fireEvent.click(canvas);
    fireEvent.pointerMove(canvas, {
      pointerType: "mouse",
      clientX: 30,
      clientY: 15,
    });
    advance(500);
    expect(open).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(canvas.dataset.pose).toBe(still);
    view.rerender(<BotAvatar motionEnabled size={24} type="star" working />);
    advance(120);
    expect(frames.size).toBe(1);
    expect(canvas.dataset.pose).not.toBe(still);
  });
  it.each([
    "natural finish",
    "offscreen",
    "hidden document",
  ])("plays bounded hops, keeps the parent's click, and accepts a new click after %s", (reason) => {
    const open = vi.fn();
    const view = render(
      <button onClick={open} type="button">
        <BotAvatar size={24} type="star" />
      </button>
    );
    const canvas = view.container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Missing avatar canvas");
    }
    const resting = canvas.dataset.pose;
    expect(frames.size).toBe(0);
    fireEvent.click(canvas);
    expect(open).toHaveBeenCalledOnce();
    advance(120);
    expect(canvas.dataset.pose).not.toBe(resting);
    // Repeated clicks cannot restart or queue more motion.
    fireEvent.click(canvas);
    if (reason === "offscreen") {
      act(() => intersect?.(false));
    } else if (reason === "hidden document") {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      fireEvent(document, new Event("visibilitychange"));
    }
    advance(380);
    expect(canvas.dataset.pose).toBe(resting);
    expect(frames.size).toBe(0);
    if (reason === "hidden document") {
      vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    }
    // Idle avatars no longer observe visibility. A deliberate fresh click must
    // work when the user returns, without a callback from a disconnected observer.
    fireEvent.click(canvas);
    expect(open).toHaveBeenCalledTimes(3);
    advance(120);
    expect(canvas.dataset.pose).not.toBe(resting);
    advance(380);
    expect(canvas.dataset.pose).toBe(resting);
    expect(frames.size).toBe(0);
  });

  it.each([
    "work ends",
    "reduced motion",
    "offscreen",
    "hidden document",
  ])("stops and restores the pose when %s, then resumes only live work", (reason) => {
    const view = render(<BotAvatar size={24} type="star" />);
    const canvas = view.container.querySelector("canvas");
    const idlePose = canvas?.dataset.pose;
    view.rerender(<BotAvatar size={24} type="star" working />);
    const workingPose = canvas?.dataset.pose;
    advance(120);
    if (reason === "work ends") {
      view.rerender(<BotAvatar size={24} type="star" working={false} />);
    } else if (reason === "reduced motion") {
      act(() => {
        reduced = true;
        for (const listener of mediaListeners) {
          listener();
        }
      });
    } else if (reason === "offscreen") {
      act(() => intersect?.(false));
    } else {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      fireEvent(document, new Event("visibilitychange"));
    }
    expect(frames.size).toBe(0);
    const stopped = canvas?.dataset.pose;
    expect(stopped).toBe(reason === "work ends" ? idlePose : workingPose);
    advance(500);
    expect(canvas?.dataset.pose).toBe(stopped);
    if (reason === "offscreen") {
      act(() => intersect?.(true));
      expect(frames.size).toBe(1);
    } else if (reason === "hidden document") {
      vi.spyOn(document, "hidden", "get").mockReturnValue(false);
      fireEvent(document, new Event("visibilitychange"));
      expect(frames.size).toBe(1);
    } else if (reason === "reduced motion" && canvas) {
      fireEvent.click(canvas);
      expect(frames.size).toBe(0);
    }
    view.unmount();
    expect(frames.size).toBe(0);
  });
});
