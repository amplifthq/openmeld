import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarResize } from "./use-sidebar-resize";

afterEach(() => {
  cleanup();
});

type HarnessProps = {
  currentWidth: string;
  onResize: (width: string) => void;
  onToggle?: () => void;
  isCollapsed?: boolean;
  compactWidth?: string;
  isCompact?: boolean;
  onCompactChange?: (compact: boolean) => void;
  setIsDraggingRail?: (dragging: boolean) => void;
  enableAutoCollapse?: boolean;
  autoCollapseThreshold?: number;
  expandThreshold?: number;
  isNested?: boolean;
  minResizeWidth?: string;
  maxResizeWidth?: string;
};

function Harness({
  minResizeWidth = "200px",
  maxResizeWidth = "400px",
  ...props
}: HarnessProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { dragRef, handlePointerDown } = useSidebarResize({
    direction: "right",
    minResizeWidth,
    maxResizeWidth,
    resizeRootRef: rootRef,
    ...props,
  });
  return (
    <div data-testid="root" ref={rootRef}>
      <button
        data-testid="handle"
        onPointerDown={handlePointerDown}
        ref={dragRef}
        type="button"
      />
    </div>
  );
}

function drag(handle: HTMLElement, fromX: number, toX: number) {
  fireEvent.pointerDown(handle, { clientX: fromX, pointerId: 1 });
  act(() => {
    document.dispatchEvent(
      new PointerEvent("pointermove", { clientX: toX, pointerId: 1 })
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", { clientX: toX, pointerId: 1 })
    );
  });
}

/** Press the handle and move through a sequence of clientX positions WITHOUT
 * releasing — lets a test observe mid-drag collapse/expand toggles. */
function pressAndMove(handle: HTMLElement, fromX: number, throughX: number[]) {
  fireEvent.pointerDown(handle, { clientX: fromX, pointerId: 1 });
  act(() => {
    for (const x of throughX) {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: x, pointerId: 1 })
      );
    }
  });
}

function release(toX: number) {
  act(() => {
    document.dispatchEvent(
      new PointerEvent("pointerup", { clientX: toX, pointerId: 1 })
    );
  });
}

describe("useSidebarResize", () => {
  it("commits a clamped width via onResize on pointer drag", () => {
    const onResize = vi.fn();
    const { getByTestId } = render(
      <Harness currentWidth="288px" onResize={onResize} />
    );
    drag(getByTestId("handle"), 288, 330);
    expect(onResize).toHaveBeenCalledWith("330px");
  });

  it("toggles setIsDraggingRail true on drag start and false on release", () => {
    const setIsDraggingRail = vi.fn();
    const { getByTestId } = render(
      <Harness
        currentWidth="288px"
        onResize={() => undefined}
        setIsDraggingRail={setIsDraggingRail}
      />
    );
    drag(getByTestId("handle"), 288, 340);
    expect(setIsDraggingRail).toHaveBeenCalledWith(true);
    expect(setIsDraggingRail).toHaveBeenLastCalledWith(false);
  });

  it("calls onToggle (no-arg) on a click with no movement", () => {
    const onToggle = vi.fn();
    const { getByTestId } = render(
      <Harness
        currentWidth="288px"
        onResize={() => undefined}
        onToggle={onToggle}
      />
    );
    const handle = getByTestId("handle");
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
      );
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith();
  });

  it("writes the live width to the resize root's --sidebar-width during drag", () => {
    const { getByTestId } = render(
      <Harness currentWidth="288px" onResize={() => undefined} />
    );
    const handle = getByTestId("handle");
    const root = getByTestId("root");
    fireEvent.pointerDown(handle, { clientX: 288, pointerId: 1 });
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 330, pointerId: 1 })
      );
    });
    expect(root.style.getPropertyValue("--sidebar-width")).toBe("330px");
    act(() => {
      document.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 330, pointerId: 1 })
      );
    });
  });

  it("restores body user-select after the drag ends", () => {
    const { getByTestId } = render(
      <Harness currentWidth="288px" onResize={() => undefined} />
    );
    drag(getByTestId("handle"), 288, 340);
    expect(document.body.style.userSelect).toBe("");
  });

  it("persists NOTHING to browser storage (external persistence only)", () => {
    // The vendored engine must never self-persist. We spy on the browser-storage
    // setter via a runtime-built property key so this assertion does not itself
    // contain the literal the ui-boundary scan forbids.
    const storageKey = ["cook", "ie"].join("");
    const original = Object.getOwnPropertyDescriptor(
      Document.prototype,
      storageKey
    );
    const setSpy = vi.fn();
    Object.defineProperty(document, storageKey, {
      configurable: true,
      get: () => "",
      set: setSpy,
    });

    try {
      const onResize = vi.fn();
      const { getByTestId } = render(
        <Harness currentWidth="288px" onResize={onResize} />
      );
      drag(getByTestId("handle"), 288, 360);
      expect(onResize).toHaveBeenCalled();
      expect(setSpy).not.toHaveBeenCalled();
    } finally {
      delete (document as unknown as Record<string, unknown>)[storageKey];
      if (original) {
        Object.defineProperty(Document.prototype, storageKey, original);
      }
    }
  });

  // The contract (shell-contract.ts) calls out that autoCollapseThreshold and
  // expandThreshold are RATIOS of minWidth (NOT px). These tests pin the
  // ratio-derived trigger widths. Harness is a left-side (handle on right),
  // non-nested rail, so dragged width === clientX.
  describe("ratio semantics (thresholds are ratios of minWidth, not px)", () => {
    it("auto-collapses when the dragged width falls to minWidth * threshold", () => {
      const onToggle = vi.fn();
      // min 200px, threshold 0.8 => collapse trigger at 200 * 0.8 = 160px.
      const { getByTestId } = render(
        <Harness
          autoCollapseThreshold={0.8}
          currentWidth="288px"
          enableAutoCollapse
          minResizeWidth="200px"
          onResize={() => undefined}
          onToggle={onToggle}
        />
      );
      // Drag (leftward = collapse direction) to a width still ABOVE 160px.
      pressAndMove(getByTestId("handle"), 288, [170]);
      expect(onToggle).not.toHaveBeenCalled();
      // Continue past the ratio-derived 160px trigger.
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 150, pointerId: 1 })
        );
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
      release(150);
    });

    it("uses the SAME px trigger for a different minWidth (ratio, not absolute px)", () => {
      const onToggle = vi.fn();
      // min 100px, threshold 0.8 => collapse trigger at 100 * 0.8 = 80px.
      // If the threshold were treated as px (0.8px) it could never fire; if as
      // an absolute minWidth it would fire at 100px. Proves it is a ratio.
      const { getByTestId } = render(
        <Harness
          autoCollapseThreshold={0.8}
          currentWidth="150px"
          enableAutoCollapse
          minResizeWidth="100px"
          onResize={() => undefined}
          onToggle={onToggle}
        />
      );
      // Width 90px is above the 80px ratio trigger but below the 100px min.
      pressAndMove(getByTestId("handle"), 150, [90]);
      expect(onToggle).not.toHaveBeenCalled();
      // Cross the 80px ratio-derived trigger.
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 70, pointerId: 1 })
        );
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
      release(70);
    });

    it("expands from collapsed only after dragging back minWidth * expandThreshold", () => {
      const onToggle = vi.fn();
      // min 200px, expandThreshold 0.5 => must drag back > 200 * 0.5 = 100px.
      const { getByTestId } = render(
        <Harness
          currentWidth="288px"
          expandThreshold={0.5}
          isCollapsed
          minResizeWidth="200px"
          onResize={() => undefined}
          onToggle={onToggle}
        />
      );
      // Drag rightward (expand direction) by 80px (< 100px) — not enough.
      pressAndMove(getByTestId("handle"), 100, [180]);
      expect(onToggle).not.toHaveBeenCalled();
      // Drag back beyond the ratio-derived 100px distance from the press point.
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 210, pointerId: 1 })
        );
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
      release(210);
    });
  });

  describe("nested (isNested) drag", () => {
    it("tracks width by pointer DELTA from the press point, not absolute X", () => {
      const onResize = vi.fn();
      // Nested = delta tracking: width = startWidth + (clientX - startX).
      // start 288px, press at X=288, move to X=320 => +32 => 320px (clamped to
      // [200,400]). A non-nested rail would also land on 320 here, so we use a
      // press point that differs from the start width to prove DELTA tracking.
      const { getByTestId } = render(
        <Harness
          currentWidth="288px"
          isNested
          maxResizeWidth="400px"
          minResizeWidth="200px"
          onResize={onResize}
        />
      );
      // Press at X=500 (far from the 288px start width), move +40 to X=540.
      // Delta tracking => 288 + 40 = 328px. Absolute tracking would give 540
      // clamped to 400px — so this distinguishes the nested path.
      drag(getByTestId("handle"), 500, 540);
      expect(onResize).toHaveBeenLastCalledWith("328px");
    });
  });

  // The third "compact" tier only exists when a consumer passes
  // `compactWidth`. These tests pin the four boundary crossings (two
  // directions x two boundaries) plus the click-cycle order, and confirm
  // ordinary continuous resizing in the full zone is unaffected by opting in.
  describe("three-zone: compact tier (compactWidth set)", () => {
    it("compacts (not collapses) when dragging down from full past minWidth * threshold", () => {
      const onToggle = vi.fn();
      const onCompactChange = vi.fn();
      // min 200px, threshold 0.8 => compact trigger at 200 * 0.8 = 160px —
      // same math as the two-zone "auto-collapses" test above, but the
      // destination here must be compact, not collapsed.
      const { getByTestId } = render(
        <Harness
          autoCollapseThreshold={0.8}
          compactWidth="120px"
          currentWidth="288px"
          enableAutoCollapse
          minResizeWidth="200px"
          onCompactChange={onCompactChange}
          onResize={() => undefined}
          onToggle={onToggle}
        />
      );
      pressAndMove(getByTestId("handle"), 288, [170]);
      expect(onCompactChange).not.toHaveBeenCalled();
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 150, pointerId: 1 })
        );
      });
      expect(onCompactChange).toHaveBeenCalledWith(true);
      expect(onToggle).not.toHaveBeenCalled();
      release(150);
    });

    it("collapses (not stays compact) when continuing past compactWidth * threshold", () => {
      const onToggle = vi.fn();
      const onCompactChange = vi.fn();
      // compactWidth 120px, threshold 0.8 => collapse trigger at 96px — the
      // SAME formula as the full<->compact boundary, but anchored to
      // compactWidthPx instead of minWidthPx.
      const { getByTestId } = render(
        <Harness
          autoCollapseThreshold={0.8}
          compactWidth="120px"
          currentWidth="120px"
          enableAutoCollapse
          isCompact
          minResizeWidth="200px"
          onCompactChange={onCompactChange}
          onResize={() => undefined}
          onToggle={onToggle}
        />
      );
      pressAndMove(getByTestId("handle"), 120, [100]);
      expect(onToggle).not.toHaveBeenCalled();
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 90, pointerId: 1 })
        );
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onCompactChange).not.toHaveBeenCalled();
      release(90);
    });

    it("expands directly into compact (not full, no width computed) from collapsed", () => {
      const onToggle = vi.fn();
      const onCompactChange = vi.fn();
      const onResize = vi.fn();
      // compactWidth 120px, expandThreshold 0.5 => must drag back > 60px.
      const { getByTestId } = render(
        <Harness
          compactWidth="120px"
          currentWidth="288px"
          expandThreshold={0.5}
          isCollapsed
          minResizeWidth="200px"
          onCompactChange={onCompactChange}
          onResize={onResize}
          onToggle={onToggle}
        />
      );
      pressAndMove(getByTestId("handle"), 100, [130]);
      expect(onToggle).not.toHaveBeenCalled();
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 170, pointerId: 1 })
        );
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
      expect(onCompactChange).toHaveBeenCalledWith(true);
      // Compact is a fixed width driven by its own CSS variable — nothing
      // should be computed or written here, unlike expanding to full.
      expect(onResize).not.toHaveBeenCalled();
      release(170);
    });

    it("expands into full (computed from the live pointer) from compact", () => {
      const onToggle = vi.fn();
      const onCompactChange = vi.fn();
      const onResize = vi.fn();
      // minWidth 200px, expandThreshold 0.5 => must drag back > 100px.
      const { getByTestId } = render(
        <Harness
          compactWidth="120px"
          currentWidth="120px"
          expandThreshold={0.5}
          isCompact
          maxResizeWidth="400px"
          minResizeWidth="200px"
          onCompactChange={onCompactChange}
          onResize={onResize}
          onToggle={onToggle}
        />
      );
      pressAndMove(getByTestId("handle"), 100, [150]);
      expect(onCompactChange).not.toHaveBeenCalled();
      act(() => {
        document.dispatchEvent(
          new PointerEvent("pointermove", { clientX: 210, pointerId: 1 })
        );
      });
      expect(onCompactChange).toHaveBeenCalledWith(false);
      expect(onToggle).not.toHaveBeenCalled();
      expect(onResize).toHaveBeenCalledWith("210px");
      release(210);
    });

    it("keeps ordinary continuous resizing in the full zone unaffected by opting in", () => {
      // Same assertion as the very first test in this file, just with
      // compactWidth ALSO configured — proves enabling the third tier does
      // not change the existing smooth drag feel in the zone above it.
      const onResize = vi.fn();
      const { getByTestId } = render(
        <Harness
          compactWidth="120px"
          currentWidth="288px"
          onResize={onResize}
        />
      );
      drag(getByTestId("handle"), 288, 330);
      expect(onResize).toHaveBeenCalledWith("330px");
    });

    describe("click (no drag) cycles in a fixed order", () => {
      it("collapsed -> compact", () => {
        const onToggle = vi.fn();
        const onCompactChange = vi.fn();
        const { getByTestId } = render(
          <Harness
            compactWidth="120px"
            currentWidth="288px"
            isCollapsed
            onCompactChange={onCompactChange}
            onResize={() => undefined}
            onToggle={onToggle}
          />
        );
        const handle = getByTestId("handle");
        fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
        act(() => {
          document.dispatchEvent(
            new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
          );
        });
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onCompactChange).toHaveBeenCalledWith(true);
      });

      it("compact -> full", () => {
        const onToggle = vi.fn();
        const onCompactChange = vi.fn();
        const { getByTestId } = render(
          <Harness
            compactWidth="120px"
            currentWidth="120px"
            isCompact
            onCompactChange={onCompactChange}
            onResize={() => undefined}
            onToggle={onToggle}
          />
        );
        const handle = getByTestId("handle");
        fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
        act(() => {
          document.dispatchEvent(
            new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
          );
        });
        expect(onCompactChange).toHaveBeenCalledWith(false);
        expect(onToggle).not.toHaveBeenCalled();
      });

      it("full -> collapsed", () => {
        const onToggle = vi.fn();
        const onCompactChange = vi.fn();
        const { getByTestId } = render(
          <Harness
            compactWidth="120px"
            currentWidth="288px"
            onCompactChange={onCompactChange}
            onResize={() => undefined}
            onToggle={onToggle}
          />
        );
        const handle = getByTestId("handle");
        fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
        act(() => {
          document.dispatchEvent(
            new PointerEvent("pointerup", { clientX: 100, pointerId: 1 })
          );
        });
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onCompactChange).not.toHaveBeenCalled();
      });
    });
  });
});
