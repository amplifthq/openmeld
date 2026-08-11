"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  type ButtonHTMLAttributes,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProximityHover } from "#hooks/use-proximity-hover";
import { useShape } from "#lib/shape-context";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type FluidActionListContextValue = {
  activeIndex: number | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
};

type FluidActionListProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  focusIndicatorClassName?: string;
  hoverIndicatorClassName?: string;
};

type FluidActionListItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  index: number;
};

const FluidActionListContext =
  createContext<FluidActionListContextValue | null>(null);

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function useFluidActionList() {
  const context = use(FluidActionListContext);
  if (!context) {
    throw new Error(
      "useFluidActionList must be used within a FluidActionList."
    );
  }
  return context;
}

function matchesFocusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function FluidActionList({
  children,
  className,
  focusIndicatorClassName,
  hoverIndicatorClassName,
  ...props
}: FluidActionListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const {
    activeIndex,
    handlers,
    itemRects,
    measureItems,
    registerItem,
    sessionRef,
    setActiveIndex,
  } = useProximityHover(containerRef, { axis: "y" });
  const shape = useShape();
  const reduceMotion = useReducedMotion() === true;

  useIsomorphicLayoutEffect(() => {
    measureItems();
  });

  const activeRect =
    activeIndex === null ? null : (itemRects[activeIndex] ?? null);
  const focusRect =
    focusedIndex === null ? null : (itemRects[focusedIndex] ?? null);
  const contextValue = useMemo(
    () => ({ activeIndex, registerItem }),
    [activeIndex, registerItem]
  );

  return (
    <FluidActionListContext.Provider value={contextValue}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the group owns shared hover and focus geometry for its child action buttons. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the group delegates all activation semantics to native child buttons. */}
      <div
        {...props}
        className={cn(
          "relative flex max-w-full select-none flex-col",
          className
        )}
        onBlur={(event) => {
          if (containerRef.current?.contains(event.relatedTarget as Node)) {
            return;
          }
          setFocusedIndex(null);
          setActiveIndex(null);
        }}
        onFocus={(event) => {
          const indexAttribute = (event.target as HTMLElement)
            .closest("[data-proximity-index]")
            ?.getAttribute("data-proximity-index");
          if (indexAttribute === undefined || indexAttribute === null) {
            return;
          }
          const index = Number(indexAttribute);
          setActiveIndex(index);
          setFocusedIndex(
            matchesFocusVisible(event.target as HTMLElement) ? index : null
          );
        }}
        onMouseEnter={handlers.onMouseEnter}
        onMouseLeave={handlers.onMouseLeave}
        onMouseMove={handlers.onMouseMove}
        ref={containerRef}
        role={props.role ?? "group"}
      >
        <AnimatePresence>
          {activeRect ? (
            <motion.div
              animate={{ opacity: 1 }}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute bg-muted/70",
                shape.bg,
                hoverIndicatorClassName
              )}
              data-slot="fluid-action-list-hover-indicator"
              exit={{ opacity: 0, transition: { duration: 0.06 } }}
              initial={{ opacity: 0 }}
              key={sessionRef.current}
              layout={!reduceMotion}
              style={{
                height: activeRect.height,
                left: activeRect.left,
                top: activeRect.top,
                width: activeRect.width,
              }}
              transition={
                reduceMotion
                  ? { opacity: { duration: 0.08 } }
                  : { ...springs.fast, opacity: { duration: 0.08 } }
              }
            />
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {focusRect ? (
            <motion.div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute z-20 border border-ring",
                shape.focusRing,
                focusIndicatorClassName
              )}
              data-slot="fluid-action-list-focus-indicator"
              exit={{ opacity: 0, transition: { duration: 0.06 } }}
              initial={false}
              layout={!reduceMotion}
              style={{
                height: focusRect.height + 4,
                left: focusRect.left - 2,
                top: focusRect.top - 2,
                width: focusRect.width + 4,
              }}
              transition={
                reduceMotion
                  ? { opacity: { duration: 0.08 } }
                  : { ...springs.fast, opacity: { duration: 0.08 } }
              }
            />
          ) : null}
        </AnimatePresence>

        {children}
      </div>
    </FluidActionListContext.Provider>
  );
}

export function FluidActionListItem({
  children,
  className,
  disabled = false,
  index,
  type = "button",
  ...props
}: FluidActionListItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);
  const { activeIndex, registerItem } = useFluidActionList();

  useIsomorphicLayoutEffect(() => {
    registerItem(index, disabled ? null : itemRef.current);
    return () => {
      registerItem(index, null);
    };
  }, [disabled, index, registerItem]);

  return (
    <button
      {...props}
      className={cn(
        "relative z-10 min-w-0 appearance-none bg-transparent outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      data-hovered={activeIndex === index || undefined}
      data-proximity-index={index}
      disabled={disabled}
      ref={itemRef}
      type={type}
    >
      {children}
    </button>
  );
}

export type { FluidActionListItemProps, FluidActionListProps };
