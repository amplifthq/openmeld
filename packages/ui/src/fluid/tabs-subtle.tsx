"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  type ButtonHTMLAttributes,
  type ComponentType,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useProximityHover } from "#hooks/use-proximity-hover";
import { fontWeights } from "#lib/font-weight";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";
import { FluidHoverHighlight } from "./hover-highlight";

type TabsSubtleIcon = ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
  size?: number;
  strokeWidth?: number;
}>;

type TabsSubtleVariant = "ghost" | "solid" | "subtle" | "underline";

type TabsSubtleContextValue = {
  hoveredIndex: number | null;
  idPrefix: string;
  indicatorLayoutId: string;
  onSelect: (index: number) => void;
  registerTab: (index: number, element: HTMLElement | null) => void;
  selectedIndex: number;
  variant: TabsSubtleVariant;
};

type TabsSubtleProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  children: ReactNode;
  idPrefix?: string;
  indicatorLayoutId?: string;
  onSelect: (index: number) => void;
  selectedIndex: number;
  // "ghost" removes the surrounding surface while retaining the shared
  // selected and hover backgrounds for compact header navigation.
  // "solid" fills the active/hovered tab with a primary (white) pill and
  // flips its label/icon to the dark foreground — used for prominent CTAs.
  // "subtle" (default) keeps the muted container used by tab navigation.
  // "underline" keeps tabs flat and marks selection at the container edge.
  variant?: TabsSubtleVariant;
};

type TabsSubtleItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: TabsSubtleIcon;
  iconClassName?: string;
  iconSize?: number;
  index: number;
  label: string;
  labelClassName?: string;
};

type TabsSubtlePanelProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  idPrefix: string;
  index: number;
  selectedIndex: number;
};

const tabsSubtleShapeClassName = "rounded-md";
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const TabsSubtleContext = createContext<TabsSubtleContextValue | null>(null);

function hoverBounds(
  rect: { height: number; left: number; top: number; width: number },
  variant: TabsSubtleVariant
) {
  return variant === "underline"
    ? {
        height: Math.max(0, rect.height - 4),
        left: rect.left - 8,
        top: rect.top + 2,
        width: rect.width + 16,
      }
    : rect;
}

function resolveTabsSubtleContainerClassName(variant: TabsSubtleVariant) {
  return variant === "ghost" || variant === "underline"
    ? "bg-transparent p-0"
    : "bg-background/40 p-0.5";
}

function resolveTabsSubtleSelectedIndicatorClassName(
  variant: TabsSubtleVariant
) {
  if (variant === "solid") {
    return "border-primary bg-primary";
  }
  if (variant === "ghost") {
    return "border-transparent bg-interaction-active";
  }
  return "border-transparent bg-interaction-active";
}

function resolveTabsSubtleHoverIndicatorClassName(variant: TabsSubtleVariant) {
  if (variant === "solid") {
    return "border-primary/70 bg-primary/80";
  }
  if (variant === "ghost" || variant === "underline") {
    return "border-transparent bg-interaction-hover";
  }
  return "border-transparent bg-interaction-hover";
}

function useTabsSubtle() {
  const context = use(TabsSubtleContext);

  if (!context) {
    throw new Error("useTabsSubtle must be used within a TabsSubtle.");
  }

  return context;
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  (
    {
      children,
      className,
      idPrefix: idPrefixProp,
      indicatorLayoutId,
      onSelect,
      selectedIndex,
      variant = "subtle",
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const generatedId = useId();
    const idPrefix = idPrefixProp ?? generatedId;
    const isMouseInside = useRef(false);
    const reduceMotion = useReducedMotion() === true;
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const {
      activeIndex: hoveredIndex,
      handlers,
      itemRects: tabRects,
      measureItems,
      registerItem: registerTab,
      sessionRef,
      setActiveIndex: setHoveredIndex,
    } = useProximityHover(containerRef, {
      axis: "x",
      measureOnRegister: "sync",
    });

    useIsomorphicLayoutEffect(() => {
      measureItems();
    });

    const handleMouseMove = useCallback(
      (event: React.MouseEvent) => {
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          return;
        }
        isMouseInside.current = true;
        handlers.onMouseMove(event);
      },
      [handlers]
    );

    const handleMouseLeave = useCallback(() => {
      isMouseInside.current = false;
      handlers.onMouseLeave();
    }, [handlers]);

    const selectedRect = tabRects[selectedIndex];
    const hoverRect =
      hoveredIndex === null ? null : (tabRects[hoveredIndex] ?? null);
    const focusRect =
      focusedIndex === null ? null : (tabRects[focusedIndex] ?? null);
    const isHoveringSelected = hoveredIndex === selectedIndex;
    const hoverInitialRect = selectedRect ?? hoverRect;

    return (
      <TabsSubtleContext.Provider
        value={{
          hoveredIndex,
          idPrefix,
          indicatorLayoutId: indicatorLayoutId ?? `${idPrefix}-underline`,
          onSelect,
          registerTab,
          selectedIndex,
          variant,
        }}
      >
        <div
          {...props}
          className={cn(
            "relative flex max-w-full select-none items-center gap-0.5",
            variant === "underline" ? "overflow-visible" : "overflow-x-auto",
            resolveTabsSubtleContainerClassName(variant),
            className
          )}
          data-variant={variant}
          onBlur={(event) => {
            if (containerRef.current?.contains(event.relatedTarget as Node)) {
              return;
            }

            setFocusedIndex(null);
            if (!isMouseInside.current) {
              setHoveredIndex(null);
            }
          }}
          onFocus={(event) => {
            const indexAttribute = (event.target as HTMLElement)
              .closest("[data-proximity-index]")
              ?.getAttribute("data-proximity-index");

            if (indexAttribute === undefined || indexAttribute === null) {
              return;
            }

            const index = Number(indexAttribute);
            if (variant !== "underline") {
              setHoveredIndex(
                isMouseInside.current ||
                  (event.target as HTMLElement).matches(":focus-visible")
                  ? index
                  : null
              );
            }
            setFocusedIndex(
              (event.target as HTMLElement).matches(":focus-visible")
                ? index
                : null
            );
          }}
          onKeyDown={(event) => {
            const items = Array.from(
              containerRef.current?.querySelectorAll(
                '[role="tab"]:not(:disabled)'
              ) ?? []
            ) as HTMLElement[];
            const currentIndex = items.indexOf(event.target as HTMLElement);

            if (currentIndex === -1) {
              return;
            }

            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key
              )
            ) {
              event.preventDefault();
              const nextIndex = ["ArrowRight", "ArrowDown"].includes(event.key)
                ? (currentIndex + 1) % items.length
                : (currentIndex - 1 + items.length) % items.length;
              items[nextIndex]?.focus();
              return;
            }

            if (event.key === "Home") {
              event.preventDefault();
              items[0]?.focus();
              return;
            }

            if (event.key === "End") {
              event.preventDefault();
              items.at(-1)?.focus();
            }
          }}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") {
              ref(node);
              return;
            }

            if (ref) {
              ref.current = node;
            }
          }}
          role="tablist"
        >
          {selectedRect && variant !== "underline" ? (
            <motion.div
              animate={{
                height: selectedRect.height,
                left: selectedRect.left,
                opacity: 1,
                top: selectedRect.top,
                width: selectedRect.width,
              }}
              className={cn(
                "pointer-events-none absolute border",
                resolveTabsSubtleSelectedIndicatorClassName(variant),
                tabsSubtleShapeClassName
              )}
              data-slot="tabs-subtle-selected-indicator"
              initial={false}
              transition={resolveTabsSubtleModerateTransition(reduceMotion)}
            />
          ) : null}

          <AnimatePresence>
            {variant === "underline" && hoverRect ? (
              <FluidHoverHighlight
                className="rounded-sm"
                key={sessionRef.current}
                rect={hoverBounds(hoverRect, variant)}
                slot="tabs-subtle-hover-indicator"
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {variant !== "underline" &&
            hoverRect &&
            (variant !== "solid" || !isHoveringSelected) &&
            hoverInitialRect ? (
              <motion.div
                animate={{
                  ...hoverBounds(hoverRect, variant),
                  opacity: variant === "solid" ? 0.55 : 1,
                }}
                className={cn(
                  "pointer-events-none absolute border",
                  resolveTabsSubtleHoverIndicatorClassName(variant),
                  tabsSubtleShapeClassName
                )}
                data-slot="tabs-subtle-hover-indicator"
                exit={resolveTabsSubtleHoverExit({
                  isMouseInside: isMouseInside.current,
                  reduceMotion,
                  selectedRect,
                })}
                initial={{
                  ...hoverBounds(hoverInitialRect, variant),
                  opacity: 0,
                }}
                transition={resolveTabsSubtleFastTransition(reduceMotion)}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {focusRect && variant !== "underline" ? (
              <motion.div
                animate={{
                  height: focusRect.height + 4,
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                }}
                className={cn(
                  "pointer-events-none absolute z-20 border border-ring",
                  tabsSubtleShapeClassName
                )}
                exit={resolveTabsSubtleFocusExit(reduceMotion)}
                initial={false}
                transition={resolveTabsSubtleFastTransition(reduceMotion)}
              />
            ) : null}
          </AnimatePresence>

          {children}
        </div>
      </TabsSubtleContext.Provider>
    );
  }
);

TabsSubtle.displayName = "TabsSubtle";

function resolveTabsSubtleModerateTransition(reduceMotion: boolean) {
  if (reduceMotion) {
    return { duration: 0 };
  }
  return {
    ...springs.moderate,
    opacity: { duration: 0.08 },
  };
}

function resolveTabsSubtleFastTransition(reduceMotion: boolean) {
  if (reduceMotion) {
    return { duration: 0 };
  }
  return {
    ...springs.fast,
    opacity: { duration: 0.08 },
  };
}

function resolveTabsSubtleHoverExit(input: {
  isMouseInside: boolean;
  reduceMotion: boolean;
  selectedRect:
    | { height: number; left: number; top: number; width: number }
    | null
    | undefined;
}) {
  if (input.reduceMotion || input.isMouseInside || !input.selectedRect) {
    return {
      opacity: 0,
      transition: { duration: input.reduceMotion ? 0 : 0.06 },
    };
  }
  return {
    height: input.selectedRect.height,
    left: input.selectedRect.left,
    opacity: 0,
    top: input.selectedRect.top,
    transition: {
      ...springs.moderate,
      opacity: { duration: 0.06 },
    },
    width: input.selectedRect.width,
  };
}

function resolveTabsSubtleFocusExit(reduceMotion: boolean) {
  return {
    opacity: 0,
    transition: { duration: reduceMotion ? 0 : 0.06 },
  };
}

const TabsSubtleItem = forwardRef<HTMLButtonElement, TabsSubtleItemProps>(
  (
    {
      children,
      className,
      icon: Icon,
      iconClassName,
      iconSize = 16,
      index,
      label,
      labelClassName,
      type = "button",
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const reduceMotion = useReducedMotion() === true;
    const {
      hoveredIndex,
      idPrefix,
      indicatorLayoutId,
      onSelect,
      registerTab,
      selectedIndex,
      variant,
    } = useTabsSubtle();
    const isActive = hoveredIndex === index || selectedIndex === index;
    // In the solid variant the active tab sits on a primary (white) pill, so
    // its label/icon must flip to the dark foreground to stay readable.
    const activeTextClassName =
      variant === "solid" ? "text-primary-foreground" : "text-foreground";

    useIsomorphicLayoutEffect(() => {
      registerTab(index, internalRef.current);

      return () => {
        registerTab(index, null);
      };
    }, [index, registerTab]);

    return (
      <button
        {...props}
        aria-controls={`${idPrefix}-panel-${index}`}
        aria-selected={selectedIndex === index}
        className={cn(
          "group relative z-10 flex h-7 cursor-pointer touch-manipulation items-center gap-2 border-none bg-transparent px-2.5 py-1 outline-none max-lg:min-h-11 max-lg:min-w-11",
          variant === "underline"
            ? "h-full px-0 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
            : tabsSubtleShapeClassName,
          className
        )}
        data-proximity-index={index}
        data-state={selectedIndex === index ? "active" : "inactive"}
        id={`${idPrefix}-tab-${index}`}
        onClick={() => {
          onSelect(index);
        }}
        ref={(node) => {
          internalRef.current = node;
          if (typeof ref === "function") {
            ref(node);
            return;
          }

          if (ref) {
            ref.current = node;
          }
        }}
        role="tab"
        tabIndex={
          selectedIndex === index || (selectedIndex < 0 && index === 0) ? 0 : -1
        }
        type={type}
      >
        {variant === "underline" && selectedIndex === index ? (
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-foreground"
            data-slot="tabs-subtle-underline"
            initial={false}
            layoutId={indicatorLayoutId}
            transition={resolveTabsSubtleModerateTransition(reduceMotion)}
          />
        ) : null}
        {children ?? (
          <>
            {Icon ? (
              <Icon
                aria-hidden={true}
                className={cn(
                  "transition-[color,stroke-width] duration-80",
                  isActive ? activeTextClassName : "text-muted-foreground",
                  iconClassName
                )}
                size={iconSize}
                strokeWidth={isActive ? 2 : 1.5}
              />
            ) : null}

            <span
              className={cn(
                "inline-grid whitespace-nowrap text-xs",
                labelClassName
              )}
            >
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1"
                style={{ fontVariationSettings: fontWeights.semibold }}
              >
                {label}
              </span>
              <span
                className={cn(
                  "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80",
                  isActive ? activeTextClassName : "text-muted-foreground"
                )}
                style={{
                  fontVariationSettings:
                    selectedIndex === index
                      ? fontWeights.semibold
                      : fontWeights.normal,
                }}
              >
                {label}
              </span>
            </span>
          </>
        )}
      </button>
    );
  }
);

TabsSubtleItem.displayName = "TabsSubtleItem";

const TabsSubtlePanel = forwardRef<HTMLDivElement, TabsSubtlePanelProps>(
  ({ children, className, idPrefix, index, selectedIndex, ...props }, ref) => {
    const isSelected = selectedIndex === index;

    return (
      <div
        {...props}
        aria-labelledby={`${idPrefix}-tab-${index}`}
        className={cn("outline-none", className)}
        hidden={!isSelected}
        id={`${idPrefix}-panel-${index}`}
        ref={ref}
        role="tabpanel"
        tabIndex={-1}
      >
        {isSelected ? children : null}
      </div>
    );
  }
);

TabsSubtlePanel.displayName = "TabsSubtlePanel";

export { TabsSubtle, TabsSubtleItem, TabsSubtlePanel };
