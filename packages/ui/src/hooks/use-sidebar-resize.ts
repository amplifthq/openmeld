import React from "react";

/**
 * Vendored + hardened copy of `lumpinif/shadcn-resizable-sidebar`'s
 * `useSidebarResize`. See developing/clients/shell-and-settings.md §6.
 *
 * Hardening applied on vendor-in (the bounded gaps the reviews flagged):
 *  - Pointer/touch events with `setPointerCapture` (replaces mouse-only
 *    `mousedown/move/up`; the legacy mouse handlers stay as a fallback for
 *    consumers that still wire `onMouseDown`).
 *  - The engine's internal cookie write is REMOVED. Persistence is PURELY
 *    external via `onResize` (`<SidebarProvider onWidthChange>`); the ui-boundary
 *    test forbids any direct browser-storage access in packages/ui so the width
 *    has a single source of truth (the consumer), not a double-write.
 *  - `currentWidth` lives in a ref (`currentWidthRef`) so the document-listener
 *    effect and the drag-start callback do not re-subscribe / re-create on every
 *    resize tick.
 *
 * Keyboard a11y (arrow-key resize, `role="separator"`, aria-value*) lives in
 * `SidebarRail`, not here — the hook stays the pointer drag engine.
 */

export type UseSidebarResizeProps = {
  /**
   * Direction of the resize handle
   * - 'left': Handle is on left side (for right-positioned panels)
   * - 'right': Handle is on right side (for left-positioned panels)
   */
  direction?: "left" | "right";

  /**
   * Current width of the panel
   */
  currentWidth: string;

  /**
   * Callback to update width when resizing
   */
  onResize: (width: string) => void;

  /**
   * Callback to toggle panel visibility
   */
  onToggle?: () => void;

  /**
   * Whether the panel is currently collapsed
   */
  isCollapsed?: boolean;

  /**
   * Fixed width of the optional third "compact" tier, sitting between
   * collapsed and the continuously-resizable range. Undefined disables the
   * tier entirely — the engine then runs the original two-zone behavior
   * verbatim (see the `compactWidthPx === null` branches below).
   */
  compactWidth?: string;

  /**
   * Whether the panel is currently in the compact tier. Only meaningful
   * when `compactWidth` is set.
   */
  isCompact?: boolean;

  /**
   * Callback fired with the next compact value when a drag or click crosses
   * into or out of the compact tier. Only consulted when `compactWidth` is
   * set.
   */
  onCompactChange?: (compact: boolean) => void;

  /**
   * Minimum resize width
   */
  minResizeWidth?: string;

  /**
   * Maximum resize width
   */
  maxResizeWidth?: string;

  /**
   * Whether to enable auto-collapse when dragged below threshold
   */
  enableAutoCollapse?: boolean;

  /**
   * Auto-collapse threshold as percentage of minResizeWidth
   * A value of 1.0 means the panel will collapse when dragged to minResizeWidth
   * A value of 0.5 means the panel will collapse when dragged to 50% of minResizeWidth
   * A value of 1.5 means the panel will collapse when dragged to 50% beyond minResizeWidth
   * Can be any positive number, not limited to the range 0.0-1.0
   */
  autoCollapseThreshold?: number;

  /**
   * Threshold to expand when dragging in opposite direction (0.0-1.0)
   * Percentage of distance needed to drag back to expand
   */
  expandThreshold?: number;

  /**
   * Whether to enable drag functionality
   */
  enableDrag?: boolean;

  /**
   * Callback to update dragging rail state
   */
  setIsDraggingRail?: (isDragging: boolean) => void;

  /**
   * Whether this is a nested sidebar (not at the edge of the screen)
   */
  isNested?: boolean;

  /**
   * Whether to enable toggle functionality
   */
  enableToggle?: boolean;

  /**
   * Root element that owns the --sidebar-width custom property.
   * During drag, the hook writes to this element directly and commits React state
   * only after pointerup.
   */
  resizeRootRef?: React.RefObject<HTMLElement | null>;
};

type WidthUnit = {
  value: number;
  unit: "rem" | "px";
};

const PX_PER_REM = 16;
const DRAG_THRESHOLD_PX = 5;
const TOGGLE_COOLDOWN_MS = 200;

/**
 * Parse width string into value and unit
 */
function parseWidth(width: string): WidthUnit {
  const unit = width.endsWith("rem") ? "rem" : "px";
  const value = Number.parseFloat(width);
  return { value, unit };
}

/**
 * Convert any width to pixels for calculations
 */
function toPx(width: string): number {
  const { value, unit } = parseWidth(width);
  return unit === "rem" ? value * PX_PER_REM : value;
}

function isPointerCaptureError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "InvalidStateError")
  );
}

function setPointerCaptureSafe(target: HTMLElement, pointerId: number) {
  // Guard for environments (e.g. jsdom) that lack the Pointer Capture API.
  if (typeof target.setPointerCapture !== "function") {
    return;
  }
  try {
    target.setPointerCapture(pointerId);
  } catch (error) {
    if (!isPointerCaptureError(error)) {
      throw error;
    }
  }
}

function releasePointerCaptureSafe(target: HTMLElement, pointerId: number) {
  if (typeof target.releasePointerCapture !== "function") {
    return;
  }
  try {
    target.releasePointerCapture(pointerId);
  } catch (error) {
    if (!isPointerCaptureError(error)) {
      throw error;
    }
  }
}

/**
 * Format width value with unit
 */
function formatWidth(value: number, unit: "rem" | "px"): string {
  return `${unit === "rem" ? value.toFixed(1) : Math.round(value)}${unit}`;
}

/** The width (px) an interaction starts from, per the zone it starts in.
 * Collapsed and compact are both fixed, CSS-variable-driven widths (0 is a
 * placeholder for "not applicable" on the collapsed side, matching how the
 * rest of this file already treats it); only the full zone has a real,
 * remembered continuous width to read from the live ref. */
function resolveInteractionStartWidthPx(input: {
  compactWidthPx: number | null;
  currentWidth: string;
  isCollapsed: boolean;
  isCompact: boolean;
}): number {
  if (input.isCollapsed) {
    return 0;
  }
  if (input.isCompact) {
    return input.compactWidthPx ?? 0;
  }
  return toPx(input.currentWidth);
}

/** Advances the collapsed/compact/full tier on a plain click (no drag),
 * cycling in that fixed order when a compact tier is configured, degenerating
 * to today's binary toggle when it isn't (compactWidthPx === null). Pulled out
 * of finishInteraction to keep that function's branching complexity down. */
function advanceTierOnClick(input: {
  compactWidthPx: number | null;
  isCollapsedRef: React.RefObject<boolean>;
  isCompactRef: React.RefObject<boolean>;
  onCompactChange?: (compact: boolean) => void;
  onToggle: () => void;
}): void {
  if (input.compactWidthPx === null) {
    input.isCollapsedRef.current = !input.isCollapsedRef.current;
    input.onToggle();
    return;
  }
  if (input.isCollapsedRef.current) {
    input.isCollapsedRef.current = false;
    input.isCompactRef.current = true;
    input.onCompactChange?.(true);
    input.onToggle();
    return;
  }
  if (input.isCompactRef.current) {
    input.isCompactRef.current = false;
    input.onCompactChange?.(false);
    return;
  }
  input.isCollapsedRef.current = true;
  input.onToggle();
}

/**
 * A versatile hook for handling resizable sidebar (or inset) panels
 * Works for both sidebar (left side) and artifacts (right side) panels
 * Supports VS Code-like continuous drag to collapse/expand
 */
export function useSidebarResize({
  direction = "right",
  currentWidth,
  onResize,
  onToggle,
  isCollapsed = false,
  compactWidth,
  isCompact = false,
  onCompactChange,
  minResizeWidth = "14rem",
  maxResizeWidth = "24rem",
  enableToggle = true,
  enableAutoCollapse = true,
  autoCollapseThreshold = 1.5, // Default to collapsing at minWidth + 50%
  expandThreshold = 0.2,
  enableDrag = true,
  setIsDraggingRail = () => {
    // no-op default
  },
  isNested = false,
  resizeRootRef,
}: UseSidebarResizeProps) {
  // Refs for tracking drag state
  const dragRef = React.useRef<HTMLButtonElement>(null);
  const startWidth = React.useRef(0);
  const startX = React.useRef(0);
  const isDragging = React.useRef(false);
  const isInteractingWithRail = React.useRef(false);
  const activePointerId = React.useRef<number | null>(null);
  const pendingWidth = React.useRef<string | null>(null);
  const lastDragDirection = React.useRef<"expand" | "collapse" | null>(null);
  const lastTogglePoint = React.useRef(0);
  const toggleCooldown = React.useRef(false);
  const lastToggleTime = React.useRef(0);
  const dragDistanceFromToggle = React.useRef(0);
  const railRect = React.useRef<DOMRect | null>(null);
  const previousBodyUserSelect = React.useRef<string | null>(null);

  // HARDEN #4: keep the live `currentWidth` in a ref so the drag-start callback
  // and the document-listener effect never re-create / re-subscribe on a resize
  // tick. They read `currentWidthRef.current` instead of closing over the prop.
  const currentWidthRef = React.useRef(currentWidth);
  React.useEffect(() => {
    currentWidthRef.current = currentWidth;
  }, [currentWidth]);

  const isCollapsedRef = React.useRef(isCollapsed);
  React.useEffect(() => {
    isCollapsedRef.current = isCollapsed;
  }, [isCollapsed]);

  const isCompactRef = React.useRef(isCompact);
  React.useEffect(() => {
    isCompactRef.current = isCompact;
  }, [isCompact]);

  // Memoize min/max width calculations for performance
  const minWidthPx = React.useMemo(
    () => toPx(minResizeWidth),
    [minResizeWidth]
  );
  const maxWidthPx = React.useMemo(
    () => toPx(maxResizeWidth),
    [maxResizeWidth]
  );
  // null = the compact tier is disabled; the drag engine then runs the
  // original two-zone (collapsed <-> continuous) behavior unmodified.
  const compactWidthPx = React.useMemo(
    () => (compactWidth ? toPx(compactWidth) : null),
    [compactWidth]
  );

  // Helper function to determine if width is increasing based on direction and pointer movement
  const isIncreasingWidth = React.useCallback(
    (currentX: number, referenceX: number): boolean =>
      direction === "left"
        ? currentX < referenceX // For left-positioned handle, moving left increases width
        : currentX > referenceX, // For right-positioned handle, moving right increases width
    [direction]
  );

  // Helper function to calculate width based on pointer position and direction
  const calculateWidth = React.useCallback(
    (
      currentX: number,
      initialX: number,
      initialWidth: number,
      currentRailRect: DOMRect | null
    ): number => {
      if (isNested && currentRailRect) {
        // For nested sidebars, use the delta from start position for precise tracking
        const deltaX = currentX - initialX;

        if (direction === "left") {
          // For left-positioned handle (right panel)
          // Width increases as pointer moves left (negative deltaX)
          return initialWidth - deltaX;
        }
        // For right-positioned handle (left panel)
        // Width increases as pointer moves right (positive deltaX)
        return initialWidth + deltaX;
      }
      // For standard sidebars at window edges
      if (direction === "left") {
        // For left-positioned handle (right panel)
        return window.innerWidth - currentX;
      }
      // For right-positioned handle (left panel)
      return currentX;
    },
    [direction, isNested]
  );

  const writeResizeRootWidth = React.useCallback(
    (width: string): boolean => {
      const resizeRoot = resizeRootRef?.current;

      if (!resizeRoot) {
        return false;
      }

      resizeRoot.style.setProperty("--sidebar-width", width);
      return true;
    },
    [resizeRootRef]
  );

  const restoreBodyUserSelect = React.useCallback(() => {
    if (previousBodyUserSelect.current === null) {
      return;
    }

    document.body.style.userSelect = previousBodyUserSelect.current;
    previousBodyUserSelect.current = null;
  }, []);

  const beginInteraction = React.useCallback(
    (clientX: number, pointerId: number | null, target: HTMLButtonElement) => {
      isInteractingWithRail.current = true;
      activePointerId.current = pointerId;

      if (pointerId !== null) {
        setPointerCaptureSafe(target, pointerId);
      }

      if (!enableDrag) {
        return;
      }

      // Store initial state (read live width/collapsed from refs — HARDEN #4)
      startWidth.current = resolveInteractionStartWidthPx({
        compactWidthPx,
        currentWidth: currentWidthRef.current,
        isCollapsed: isCollapsedRef.current,
        isCompact: isCompactRef.current,
      });
      startX.current = clientX;
      lastTogglePoint.current = clientX;
      lastDragDirection.current = null;
      toggleCooldown.current = false;
      lastToggleTime.current = 0;
      dragDistanceFromToggle.current = 0;
      pendingWidth.current = null;

      previousBodyUserSelect.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      // Store the rail element's position for nested sidebars
      if (isNested && dragRef.current) {
        railRect.current = dragRef.current.getBoundingClientRect();
      } else {
        railRect.current = null;
      }
    },
    [compactWidthPx, enableDrag, isNested]
  );

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      beginInteraction(e.clientX, e.pointerId, e.currentTarget);
      e.preventDefault();
    },
    [beginInteraction]
  );

  // Backward-compatible handler for consumers still wiring the hook to onMouseDown.
  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      beginInteraction(e.clientX, null, e.currentTarget);
      e.preventDefault();
    },
    [beginInteraction]
  );

  const handleDragMove = React.useEffectEvent(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Vendored VS-Code-style drag engine — the pointer-math, direction tracking, toggle-cooldown, and auto-collapse/expand thresholds are intentionally kept in one flow and preserved verbatim from the fork to avoid behavior drift.
    (clientX: number, pointerId: number | null) => {
      if (!(isInteractingWithRail.current && enableDrag)) {
        return;
      }

      if (activePointerId.current !== pointerId) {
        return;
      }

      const deltaX = Math.abs(clientX - startX.current);
      let startedDragging = false;

      if (!isDragging.current && deltaX > DRAG_THRESHOLD_PX) {
        isDragging.current = true;
        startedDragging = true;
        setIsDraggingRail(true);
      }

      if (!isDragging.current) {
        return;
      }

      // Get unit for width calculations (live width from ref — HARDEN #4)
      const { unit } = parseWidth(currentWidthRef.current);

      // Get current rail position for ultra-precise tracking
      let currentRailRect = railRect.current;
      if (isNested && dragRef.current) {
        currentRailRect = dragRef.current.getBoundingClientRect();
      }

      // Determine current drag direction
      const currentDragDirection = isIncreasingWidth(
        clientX,
        lastTogglePoint.current
      )
        ? "expand"
        : "collapse";

      // Update direction tracking
      if (lastDragDirection.current !== currentDragDirection) {
        lastDragDirection.current = currentDragDirection;
      }

      // Calculate distance from last toggle point
      dragDistanceFromToggle.current = Math.abs(
        clientX - lastTogglePoint.current
      );

      // Check for toggle cooldown (prevent rapid toggling)
      const now = Date.now();
      if (
        toggleCooldown.current &&
        now - lastToggleTime.current > TOGGLE_COOLDOWN_MS
      ) {
        toggleCooldown.current = false;
      }

      const collapsedNow = isCollapsedRef.current;
      const compactNow = compactWidthPx !== null && isCompactRef.current;

      // Handle toggling between collapsed and expanded states
      if (!toggleCooldown.current) {
        if (compactWidthPx === null) {
          // EXISTING TWO-ZONE BEHAVIOR, VERBATIM. Any consumer that never
          // sets `compactWidth` hits this branch and only this branch —
          // nothing below it in the `else` runs, so its drag feel cannot
          // regress from adding the compact tier elsewhere.
          // Handle collapsing when expanded
          if (enableAutoCollapse && onToggle && !collapsedNow) {
            // Calculate precise width based on pointer position
            const currentDragWidth = calculateWidth(
              clientX,
              startX.current,
              startWidth.current,
              currentRailRect
            );

            // Determine if we should collapse based on threshold
            let shouldCollapse = false;

            if (autoCollapseThreshold <= 1.0) {
              // For thresholds <= 1.0, collapse when width is below minWidth * threshold
              shouldCollapse =
                currentDragWidth <= minWidthPx * autoCollapseThreshold;
            } else if (currentDragWidth <= minWidthPx) {
              // For thresholds > 1.0, we need to drag beyond minWidth by a certain amount
              // Calculate how much beyond minWidth we need to drag
              const extraDragNeeded =
                minWidthPx * (autoCollapseThreshold - 1.0);

              // Only collapse if we've dragged far enough beyond minWidth
              const distanceBeyondMin = minWidthPx - currentDragWidth;

              shouldCollapse = distanceBeyondMin >= extraDragNeeded;
            }

            if (currentDragDirection === "collapse" && shouldCollapse) {
              isCollapsedRef.current = true;
              onToggle(); // Collapse
              lastTogglePoint.current = clientX;
              toggleCooldown.current = true;
              lastToggleTime.current = now;
              return;
            }
          }

          // Handle expanding when collapsed
          if (
            onToggle &&
            collapsedNow &&
            currentDragDirection === "expand" &&
            dragDistanceFromToggle.current > minWidthPx * expandThreshold
          ) {
            isCollapsedRef.current = false;
            onToggle(); // Expand

            // Calculate initial width based on exact pointer position
            const initialWidth = calculateWidth(
              clientX,
              startX.current,
              startWidth.current,
              currentRailRect
            );

            // Clamp to min/max
            const clampedWidth = Math.max(
              minWidthPx,
              Math.min(maxWidthPx, initialWidth)
            );

            // Set initial width when expanding
            const formattedWidth = formatWidth(
              unit === "rem" ? clampedWidth / PX_PER_REM : clampedWidth,
              unit
            );
            pendingWidth.current = formattedWidth;
            writeResizeRootWidth(formattedWidth);
            onResize(formattedWidth);

            lastTogglePoint.current = clientX;
            toggleCooldown.current = true;
            lastToggleTime.current = now;
            return;
          }
        } else {
          // THREE-ZONE BEHAVIOR: collapsed <-> compact <-> full. Each
          // boundary reuses the exact ratio formulas above, just applied
          // against whichever floor width is relevant to that boundary —
          // compact<->full reuses minWidthPx exactly as the two-zone branch
          // does; collapsed<->compact uses compactWidthPx as its own floor.
          // Handle compacting when full
          if (enableAutoCollapse && onToggle && !collapsedNow && !compactNow) {
            const currentDragWidth = calculateWidth(
              clientX,
              startX.current,
              startWidth.current,
              currentRailRect
            );

            let shouldCompact = false;

            if (autoCollapseThreshold <= 1.0) {
              shouldCompact =
                currentDragWidth <= minWidthPx * autoCollapseThreshold;
            } else if (currentDragWidth <= minWidthPx) {
              const extraDragNeeded =
                minWidthPx * (autoCollapseThreshold - 1.0);
              const distanceBeyondMin = minWidthPx - currentDragWidth;
              shouldCompact = distanceBeyondMin >= extraDragNeeded;
            }

            if (currentDragDirection === "collapse" && shouldCompact) {
              isCompactRef.current = true;
              onCompactChange?.(true);
              lastTogglePoint.current = clientX;
              toggleCooldown.current = true;
              lastToggleTime.current = now;
              return;
            }
          }

          // Handle collapsing when compact
          if (enableAutoCollapse && onToggle && !collapsedNow && compactNow) {
            const currentDragWidth = calculateWidth(
              clientX,
              startX.current,
              startWidth.current,
              currentRailRect
            );

            let shouldCollapse = false;

            if (autoCollapseThreshold <= 1.0) {
              shouldCollapse =
                currentDragWidth <= compactWidthPx * autoCollapseThreshold;
            } else if (currentDragWidth <= compactWidthPx) {
              const extraDragNeeded =
                compactWidthPx * (autoCollapseThreshold - 1.0);
              const distanceBeyondMin = compactWidthPx - currentDragWidth;
              shouldCollapse = distanceBeyondMin >= extraDragNeeded;
            }

            if (currentDragDirection === "collapse" && shouldCollapse) {
              isCollapsedRef.current = true;
              onToggle(); // Collapse
              lastTogglePoint.current = clientX;
              toggleCooldown.current = true;
              lastToggleTime.current = now;
              return;
            }
          }

          // Handle expanding from collapsed straight to compact — compact is
          // a fixed width owned entirely by its own CSS variable, so there's
          // no width to compute or write here.
          if (
            onToggle &&
            collapsedNow &&
            currentDragDirection === "expand" &&
            dragDistanceFromToggle.current > compactWidthPx * expandThreshold
          ) {
            isCollapsedRef.current = false;
            isCompactRef.current = true;
            onCompactChange?.(true);
            onToggle();

            lastTogglePoint.current = clientX;
            toggleCooldown.current = true;
            lastToggleTime.current = now;
            return;
          }

          // Handle expanding from compact to full — mirrors the
          // collapsed-to-expand branch above: compute the live width from
          // the pointer so the drag continues to feel continuous rather
          // than snapping to a remembered width.
          if (
            onToggle &&
            compactNow &&
            currentDragDirection === "expand" &&
            dragDistanceFromToggle.current > minWidthPx * expandThreshold
          ) {
            isCompactRef.current = false;
            onCompactChange?.(false);

            const initialWidth = calculateWidth(
              clientX,
              startX.current,
              startWidth.current,
              currentRailRect
            );

            const clampedWidth = Math.max(
              minWidthPx,
              Math.min(maxWidthPx, initialWidth)
            );

            const formattedWidth = formatWidth(
              unit === "rem" ? clampedWidth / PX_PER_REM : clampedWidth,
              unit
            );
            pendingWidth.current = formattedWidth;
            writeResizeRootWidth(formattedWidth);
            onResize(formattedWidth);

            lastTogglePoint.current = clientX;
            toggleCooldown.current = true;
            lastToggleTime.current = now;
            return;
          }
        }
      }

      // Skip width calculations if the panel is collapsed or sitting in the
      // fixed-width compact tier — only the "full" zone is continuous.
      if (collapsedNow || compactNow) {
        return;
      }

      // Calculate new width based on pointer position and drag direction
      const newWidthPx = calculateWidth(
        clientX,
        startX.current,
        startWidth.current,
        currentRailRect
      );

      // Clamp width between min and max
      const clampedWidthPx = Math.max(
        minWidthPx,
        Math.min(maxWidthPx, newWidthPx)
      );

      // Convert to the target unit
      const newWidth =
        unit === "rem" ? clampedWidthPx / PX_PER_REM : clampedWidthPx;

      // Format and update the live DOM width. React state commits on pointerup.
      const formattedWidth = formatWidth(newWidth, unit);
      pendingWidth.current = formattedWidth;
      writeResizeRootWidth(formattedWidth);

      if (startedDragging || !resizeRootRef?.current) {
        onResize(formattedWidth);
      }
    }
  );

  const finishInteraction = React.useEffectEvent(
    (pointerId: number | null, shouldToggleClick = true) => {
      if (!isInteractingWithRail.current) {
        return;
      }

      if (activePointerId.current !== pointerId) {
        return;
      }

      const rail = dragRef.current;

      if (
        pointerId !== null &&
        rail &&
        typeof rail.hasPointerCapture === "function" &&
        rail.hasPointerCapture(pointerId)
      ) {
        releasePointerCaptureSafe(rail, pointerId);
      }

      // Handle click (not drag) behavior
      if (
        shouldToggleClick &&
        !isDragging.current &&
        onToggle &&
        enableToggle
      ) {
        advanceTierOnClick({
          compactWidthPx,
          isCollapsedRef,
          isCompactRef,
          onCompactChange,
          onToggle,
        });
      }

      if (isDragging.current && pendingWidth.current) {
        onResize(pendingWidth.current);
      }

      // Reset all state
      isDragging.current = false;
      isInteractingWithRail.current = false;
      activePointerId.current = null;
      pendingWidth.current = null;
      lastDragDirection.current = null;
      lastTogglePoint.current = 0;
      toggleCooldown.current = false;
      lastToggleTime.current = 0;
      dragDistanceFromToggle.current = 0;
      railRect.current = null;
      restoreBodyUserSelect();
      setIsDraggingRail(false);
    }
  );

  React.useEffect(() => {
    const handleDocumentPointerMove = (event: PointerEvent) => {
      handleDragMove(event.clientX, event.pointerId);
    };
    const handleDocumentPointerUp = (event: PointerEvent) => {
      finishInteraction(event.pointerId);
    };
    const handleDocumentPointerCancel = (event: PointerEvent) => {
      finishInteraction(event.pointerId, false);
    };
    const handleDocumentMouseMove = (event: MouseEvent) => {
      handleDragMove(event.clientX, null);
    };
    const handleDocumentMouseUp = () => {
      finishInteraction(null);
    };

    document.addEventListener("pointermove", handleDocumentPointerMove);
    document.addEventListener("pointerup", handleDocumentPointerUp);
    document.addEventListener("pointercancel", handleDocumentPointerCancel);
    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp);

    return () => {
      document.removeEventListener("pointermove", handleDocumentPointerMove);
      document.removeEventListener("pointerup", handleDocumentPointerUp);
      document.removeEventListener(
        "pointercancel",
        handleDocumentPointerCancel
      );
      document.removeEventListener("mousemove", handleDocumentMouseMove);
      document.removeEventListener("mouseup", handleDocumentMouseUp);
      restoreBodyUserSelect();
    };
  }, [restoreBodyUserSelect]);

  return {
    dragRef,
    isDragging,
    handlePointerDown,
    handleMouseDown,
  };
}
