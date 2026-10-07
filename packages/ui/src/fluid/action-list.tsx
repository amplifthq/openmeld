"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  use,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type UseFluidHoverOptions,
  useFluidHover,
  useRegisterFluidHoverItem,
} from "#hooks/use-fluid-hover";
import { useShape } from "#lib/shape-context";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";
import { FluidHoverHighlight } from "./fluid-hover-highlight";

type FluidActionListContextValue = {
  activeIndex: number | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
};

type FluidActionListProps = HTMLAttributes<HTMLDivElement> & {
  axis?: UseFluidHoverOptions["axis"];
  children?: ReactNode;
  focusIndicatorClassName?: string;
  hoverIndicatorClassName?: string;
  gapClick?: UseFluidHoverOptions["gapClick"];
};

type FluidActionListItemProps = useRender.ComponentProps<"button"> & {
  index: number;
};

const FluidActionListContext =
  createContext<FluidActionListContextValue | null>(null);

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
  axis = "y",
  children,
  className,
  focusIndicatorClassName,
  hoverIndicatorClassName,
  gapClick = false,
  ...props
}: FluidActionListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const hover = useFluidHover(containerRef, {
    axis,
    gapClick,
    isItemDisabled: isDisabledItem,
  });
  const { activeIndex, handlers, itemRects, registerItem, setActiveIndex } =
    hover;
  const shape = useShape();
  const reduceMotion = useReducedMotion() === true;

  const focusRect =
    !hover.isMeasured || focusedIndex === null
      ? null
      : (itemRects[focusedIndex] ?? null);
  const contextValue = useMemo(
    () => ({ activeIndex, registerItem }),
    [activeIndex, registerItem]
  );

  return (
    <FluidActionListContext.Provider value={contextValue}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the group owns shared hover and focus geometry for its child action buttons. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the group delegates all activation semantics to native child buttons. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: only pointer gaps delegate activation; native buttons and Base UI retain keyboard activation. */}
      <div
        {...props}
        className={cn(
          "relative flex max-w-full select-none flex-col",
          className
        )}
        data-slot="fluid-action-list"
        onBlur={(event) => {
          if (containerRef.current?.contains(event.relatedTarget as Node)) {
            return;
          }
          setFocusedIndex(null);
          setActiveIndex(null);
        }}
        onClick={(event) => {
          props.onClick?.(event);
          if (!event.defaultPrevented) {
            handlers.onClick(event);
          }
        }}
        onFocus={(event) => {
          if (
            (event.target as HTMLElement).closest(
              '[data-slot="fluid-action-list"]'
            ) !== event.currentTarget
          ) {
            setFocusedIndex(null);
            setActiveIndex(null);
            return;
          }
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
        onMouseMove={(event) => {
          if (
            (event.target as HTMLElement).closest(
              '[data-slot="fluid-action-list"]'
            ) !== event.currentTarget
          ) {
            setActiveIndex(null);
            return;
          }
          handlers.onMouseMove(event);
        }}
        ref={containerRef}
        role={props.role ?? "group"}
      >
        <FluidHoverHighlight
          className={cn(shape.bg, hoverIndicatorClassName)}
          hover={hover}
        />

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
  className,
  disabled = false,
  index,
  ref,
  render,
  type = "button",
  ...props
}: FluidActionListItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);
  const { activeIndex, registerItem } = useFluidActionList();

  useRegisterFluidHoverItem(
    disabled ? undefined : registerItem,
    index,
    itemRef
  );

  const renderedItem = useRender({
    defaultTagName: "button",
    props: {
      ...mergeProps<"button">(
        {
          className: cn(
            "relative z-10 min-w-0 appearance-none bg-transparent outline-none disabled:cursor-not-allowed disabled:opacity-50",
            className
          ),
          disabled,
          type,
        },
        props
      ),
      "data-hovered": activeIndex === index || undefined,
      "data-proximity-index": index,
    },
    ref: ref ? [itemRef, ref] : itemRef,
    render,
  });

  return <>{renderedItem}</>;
}

export type { FluidActionListItemProps, FluidActionListProps };

function isDisabledItem(element: HTMLElement) {
  return (
    element.hasAttribute("disabled") ||
    element.hasAttribute("data-disabled") ||
    element.getAttribute("aria-disabled") === "true"
  );
}
