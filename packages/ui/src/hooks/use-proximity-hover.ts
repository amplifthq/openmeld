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
  axis?: "x" | "y";
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
  const { axis = "y", measureOnRegister = "raf" } = options;
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
      // Use offset* instead of getBoundingClientRect so measurements are
      // unaffected by CSS transforms (e.g. scaleY animation on the parent
      // motion.div). offsetTop/offsetLeft are layout values relative to the
      // offsetParent (the scroll container), matching the coordinate space
      // used by `position: absolute` children.
      rects[index] = {
        top: element.offsetTop,
        height: element.offsetHeight,
        left: element.offsetLeft,
        width: element.offsetWidth,
      };
    });
    if (areItemRectsEqual(itemRectsRef.current, rects)) {
      return;
    }

    itemRectsRef.current = rects;
    setItemRects(rects);
  }, [containerRef]);

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

  const handleMouseMove = useCallback(
    (event: PointerPositionEvent) => {
      const mousePosition = axis === "x" ? event.clientX : event.clientY;

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
          resolveClosestIndex({
            axis,
            container,
            mousePosition,
            rects: itemRectsRef.current,
          })
        );
      });
    },
    [axis, containerRef]
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
