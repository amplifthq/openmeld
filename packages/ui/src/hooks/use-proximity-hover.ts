"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type ItemRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type UseProximityHoverOptions = {
  axis?: "x" | "y" | "both";
  isItemDisabled?: (element: HTMLElement) => boolean;
  measureOnRegister?: "raf" | "sync";
};

type UseProximityHoverReturn = {
  activeIndex: number | null;
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onMouseMove: (event: PointerPositionEvent) => void;
  };
  itemRects: ItemRect[];
  measureItems: () => void;
  registerItem: (index: number, element: HTMLElement | null) => void;
  sessionRef: RefObject<number>;
  setActiveIndex: (index: number | null) => void;
};

type PointerPositionEvent = {
  clientX: number;
  clientY: number;
  target?: EventTarget | null;
};

type ResolvedAxisMetrics = {
  borderOffset: number;
  containerEdge: number;
  scrollOffset: number;
};

type ResolvedItemBounds = {
  center: number;
  end: number;
  start: number;
};

function resolveAxisMetrics(input: {
  axis: "x" | "y";
  container: HTMLElement;
}): ResolvedAxisMetrics {
  const containerRect = input.container.getBoundingClientRect();

  return {
    borderOffset:
      input.axis === "x"
        ? input.container.clientLeft
        : input.container.clientTop,
    containerEdge: input.axis === "x" ? containerRect.left : containerRect.top,
    scrollOffset:
      input.axis === "x"
        ? input.container.scrollLeft
        : input.container.scrollTop,
  };
}

function resolveItemBounds(input: {
  axis: "x" | "y";
  metrics: ResolvedAxisMetrics;
  rect: ItemRect;
}): ResolvedItemBounds {
  const contentPosition = input.axis === "x" ? input.rect.left : input.rect.top;
  const size = input.axis === "x" ? input.rect.width : input.rect.height;
  const start =
    input.metrics.containerEdge +
    input.metrics.borderOffset +
    contentPosition -
    input.metrics.scrollOffset;

  return {
    center: start + size / 2,
    end: start + size,
    start,
  };
}

function resolveClosestIndex(input: {
  axis: "x" | "y";
  container: HTMLElement;
  mousePosition: number;
  rects: readonly ItemRect[];
}): number | null {
  const metrics = resolveAxisMetrics({
    axis: input.axis,
    container: input.container,
  });
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestIndex: number | null = null;
  let containingIndex: number | null = null;

  for (let index = 0; index < input.rects.length; index++) {
    const rect = input.rects[index];
    if (!rect) {
      continue;
    }

    const bounds = resolveItemBounds({
      axis: input.axis,
      metrics,
      rect,
    });

    if (
      input.mousePosition >= bounds.start &&
      input.mousePosition <= bounds.end
    ) {
      containingIndex = index;
    }

    const distance = Math.abs(input.mousePosition - bounds.center);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return containingIndex ?? closestIndex;
}

function resolveClosestGridIndex(
  container: HTMLElement,
  pointer: PointerPositionEvent,
  rects: readonly ItemRect[]
): number | null {
  const bounds = container.getBoundingClientRect();
  const x =
    pointer.clientX - bounds.left - container.clientLeft + container.scrollLeft;
  const y =
    pointer.clientY - bounds.top - container.clientTop + container.scrollTop;
  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index];
    if (!rect) {
      continue;
    }
    // Distance to the button box, so a card's padding stays with its own
    // button even when neighboring cards share the same vertical position.
    const dx = Math.max(rect.left - x, 0, x - rect.left - rect.width);
    const dy = Math.max(rect.top - y, 0, y - rect.top - rect.height);
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  return closestIndex;
}

function areItemRectsEqual(
  current: readonly ItemRect[],
  next: readonly ItemRect[]
): boolean {
  if (current.length !== next.length) {
    return false;
  }

  for (let index = 0; index < current.length; index++) {
    const currentRect = current[index];
    const nextRect = next[index];

    if (!(currentRect || nextRect)) {
      continue;
    }

    if (!(currentRect && nextRect)) {
      return false;
    }

    if (
      currentRect.height !== nextRect.height ||
      currentRect.left !== nextRect.left ||
      currentRect.top !== nextRect.top ||
      currentRect.width !== nextRect.width
    ) {
      return false;
    }
  }

  return true;
}

export function useProximityHover<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: UseProximityHoverOptions = {}
): UseProximityHoverReturn {
  const { axis = "y", measureOnRegister = "raf", isItemDisabled } = options;
  const itemsRef = useRef(new Map<number, HTMLElement>());
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [itemRects, setItemRects] = useState<ItemRect[]>([]);
  const itemRectsRef = useRef<ItemRect[]>([]);
  const sessionRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const remeasureRafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeRafIdRef = useRef<number | null>(null);

  const measureItems = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const rects: ItemRect[] = [];
    itemsRef.current.forEach((element, index) => {
      if (isItemDisabled?.(element)) {
        return;
      }
      // Layout offsets stay stable while a containing panel transforms.
      // A menu button may be inside positioned list items; sum that chain
      // instead of treating every button's local offsetTop (often 0) as its
      // position in the overlay container.
      let top = element.offsetTop;
      let left = element.offsetLeft;
      let parent = element.offsetParent as HTMLElement | null;
      while (parent && parent !== container) {
        top += parent.offsetTop + parent.clientTop;
        left += parent.offsetLeft + parent.clientLeft;
        parent = parent.offsetParent as HTMLElement | null;
      }
      rects[index] = {
        top,
        left,
        height: element.offsetHeight,
        width: element.offsetWidth,
      };
    });
    if (areItemRectsEqual(itemRectsRef.current, rects)) {
      return;
    }

    itemRectsRef.current = rects;
    setItemRects(rects);
  }, [containerRef, isItemDisabled]);

  const scheduleMeasureItems = useCallback(() => {
    if (resizeRafIdRef.current !== null) {
      return;
    }

    resizeRafIdRef.current = requestAnimationFrame(() => {
      resizeRafIdRef.current = null;
      measureItems();
    });
  }, [measureItems]);

  const registerItem = useCallback(
    (index: number, element: HTMLElement | null) => {
      const previousElement = itemsRef.current.get(index);
      if (previousElement && previousElement !== element) {
        resizeObserverRef.current?.unobserve(previousElement);
      }

      if (element) {
        itemsRef.current.set(index, element);
        resizeObserverRef.current?.observe(element);
      } else {
        itemsRef.current.delete(index);
      }

      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
        remeasureRafIdRef.current = null;
      }

      if (measureOnRegister === "sync") {
        measureItems();
        return;
      }
      remeasureRafIdRef.current = requestAnimationFrame(() => {
        remeasureRafIdRef.current = null;
        measureItems();
      });
    },
    [measureItems, measureOnRegister]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(scheduleMeasureItems);
    resizeObserverRef.current = resizeObserver;
    resizeObserver.observe(container);
    for (const element of itemsRef.current.values()) {
      resizeObserver.observe(element);
    }

    return () => {
      resizeObserver.disconnect();
      if (resizeObserverRef.current === resizeObserver) {
        resizeObserverRef.current = null;
      }
      if (resizeRafIdRef.current !== null) {
        cancelAnimationFrame(resizeRafIdRef.current);
        resizeRafIdRef.current = null;
      }
    };
  }, [containerRef, scheduleMeasureItems]);

  // Moving keyed rows does not resize them or reattach their refs. Refresh
  // cached offsets after structural changes so hit testing and the overlay
  // continue to refer to the same element after a drag reorder.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(scheduleMeasureItems);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef, scheduleMeasureItems]);

  const handleMouseMove = useCallback(
    (event: PointerPositionEvent) => {
      const mousePosition = axis === "x" ? event.clientX : event.clientY;
      // The browser has already hit-tested the pointer. Reuse that result
      // inside a row instead of forcing layout immediately after :hover
      // invalidated its styles. Gaps still use proximity geometry.
      const target = event.target instanceof Node ? event.target : null;
      let hitIndex: number | null = null;
      if (target) {
        for (const [index, element] of itemsRef.current) {
          if (element.contains(target) && !isItemDisabled?.(element)) {
            hitIndex = index;
          }
        }
      }

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        const container = containerRef.current;
        if (!container) {
          return;
        }
        setActiveIndex(
          hitIndex ??
            (axis === "both"
              ? resolveClosestGridIndex(container, event, itemRectsRef.current)
              : resolveClosestIndex({
                  axis,
                  container,
                  mousePosition,
                  rects: itemRectsRef.current,
                }))
        );
      });
    },
    [axis, containerRef, isItemDisabled]
  );

  const handleMouseEnter = useCallback(() => {
    sessionRef.current += 1;
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setActiveIndex(null);
  }, []);

  // Clean up rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (remeasureRafIdRef.current !== null) {
        cancelAnimationFrame(remeasureRafIdRef.current);
      }
      if (resizeRafIdRef.current !== null) {
        cancelAnimationFrame(resizeRafIdRef.current);
      }
    };
  }, []);

  return {
    activeIndex,
    setActiveIndex,
    itemRects,
    sessionRef,
    handlers: {
      onMouseMove: handleMouseMove,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
    registerItem,
    measureItems,
  };
}

/**
 * Hook for child items to register themselves with the proximity hover system.
 * Call in useEffect with the item's ref and index.
 */
export function useRegisterProximityItem(
  registerItem: (index: number, element: HTMLElement | null) => void,
  index: number,
  ref: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    registerItem(index, ref.current);
    return () => registerItem(index, null);
  }, [index, registerItem, ref]);
}
