"use client";

// Vendored from Fluid Functionalism Base UI Tabs (https://www.fluidfunctionalism.com/r/base/tabs.json).
// Adaptations: shared OpenMeld tokens, composed tab content, optional track, and reduced motion.

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ComponentType, ReactNode } from "react";
import {
  Children,
  type ComponentPropsWithoutRef,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type IconComponent = ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
}>;

import { fontWeights } from "#lib/font-weight";
import { springs as spring } from "#lib/springs";
import { cn } from "#lib/utils";
import { useShape } from "../lib/shape-context";

const sizeClasses = {
  segmentItem: "h-7",
  gap: "gap-2",
  text: "text-xs",
  icon: 16,
};

import { useProximityHover } from "#hooks/use-proximity-hover";
import { surfaceClasses } from "#lib/surface-classes";
import { SurfaceProvider, useSurface } from "../lib/surface-context";

/* ─────────────────────── Contexts ─────────────────────── */

type TabsValueOrderContextValue = {
  valueOrder: string[];
  setValueOrder: (order: string[]) => void;
  selectedValue: string | undefined;
};

const TabsValueOrderContext = createContext<TabsValueOrderContextValue | null>(
  null
);

type TabsListContextValue = {
  registerTab: (index: number, value: string, el: HTMLElement | null) => void;
  hoveredIndex: number | null;
  selectedValue: string | undefined;
  setOptimisticIdx: (index: number) => void;
};

const TabsListContext = createContext<TabsListContextValue | null>(null);

function useTabsList() {
  const ctx = useContext(TabsListContext);
  if (!ctx) {
    throw new Error("TabItem must be used within a TabsList");
  }
  return ctx;
}

/* ─────────────────────── Tabs (Root) ─────────────────────── */

interface TabsProps
  extends Omit<
    ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
    "onValueChange" | "value" | "defaultValue" | "onSelect"
  > {
  value?: string;
  onValueChange?: (value: string) => void;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  defaultValue?: string;
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
  (
    {
      value,
      onValueChange,
      selectedIndex,
      onSelect,
      defaultValue,
      children,
      ...props
    },
    ref
  ) => {
    const [valueOrder, setValueOrder] = useState<string[]>([]);
    const [uncontrolledValue, setUncontrolledValue] = useState<
      string | undefined
    >(defaultValue);
    const updateValueOrder = useCallback((order: string[]) => {
      setValueOrder((current) => {
        if (
          current.length === order.length &&
          current.every((v, i) => v === order[i])
        ) {
          return current;
        }
        return order;
      });
    }, []);

    // Resolve value: explicit value > selectedIndex lookup > uncontrolled state.
    // Uncontrolled with no defaultValue falls back to the first tab so the
    // FF layer's selectedValue matches what the primitive shows.
    const resolvedValue =
      value ??
      (selectedIndex != null
        ? valueOrder[selectedIndex]
        : (uncontrolledValue ?? valueOrder[0]));

    // Base UI passes (value, eventDetails); we only need value.
    const handleValueChange = useCallback(
      (newValue: unknown) => {
        const v = newValue as string;
        if (value === undefined && selectedIndex == null) {
          setUncontrolledValue(v);
        }
        onValueChange?.(v);
        if (onSelect) {
          const idx = valueOrder.indexOf(v);
          if (idx !== -1) {
            onSelect(idx);
          }
        }
      },
      [onValueChange, onSelect, valueOrder, value, selectedIndex]
    );

    const root = (
      <TabsValueOrderContext.Provider
        value={{
          valueOrder,
          setValueOrder: updateValueOrder,
          selectedValue: resolvedValue,
        }}
      >
        {/*
          Always controlled: Base UI's useControlled logs a dev warning when
          value flips undefined → defined. valueOrder is empty on the first
          commit, so fall back to an empty-string sentinel — TabsList's
          layout effect populates valueOrder pre-paint, so the corrected
          value lands before anything is visible.
        */}
        <TabsPrimitive.Root
          onValueChange={handleValueChange}
          ref={ref}
          value={resolvedValue ?? ""}
          {...props}
        >
          {children}
        </TabsPrimitive.Root>
      </TabsValueOrderContext.Provider>
    );

    return root;
  }
);

Tabs.displayName = "Tabs";

/* ─────────────────────── TabsList ─────────────────────── */

type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  background?: boolean;
};

const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Preserve the vendored Fluid interaction flow for upstream comparison.
  ({ children, className, background = true, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const isMouseInside = useRef(false);
    const shape = useShape();
    const reduceMotion = useReducedMotion() === true;
    const substrate = useSurface();
    const indicatorLevel = Math.min(substrate + 2, 8);
    const valueOrderCtx = useContext(TabsValueOrderContext);
    const [optimisticIdx, setOptimisticIdx] = useState<number | null>(null);

    const values = useMemo(
      () =>
        Children.toArray(children)
          .filter(isValidElement)
          .map((child) => (child.props as { value?: string }).value)
          .filter((v): v is string => typeof v === "string"),
      [children]
    );
    const setValueOrder = valueOrderCtx?.setValueOrder;

    useLayoutEffect(() => {
      setValueOrder?.(values);
    }, [setValueOrder, values]);

    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef, { axis: "x" });

    const registerTab = useCallback(
      (index: number, _value: string, el: HTMLElement | null) => {
        registerItem(index, el);
      },
      [registerItem]
    );

    useLayoutEffect(() => {
      measureItems();
    });

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        isMouseInside.current = true;
        handlers.onMouseMove(e);
      },
      [handlers]
    );

    const handleMouseLeave = useCallback(() => {
      isMouseInside.current = false;
      handlers.onMouseLeave();
    }, [handlers]);

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const selectedValue = valueOrderCtx?.selectedValue;
    const selectedIdx =
      selectedValue !== undefined ? values.indexOf(selectedValue) : -1;

    useEffect(() => {
      setOptimisticIdx(selectedIdx >= 0 ? selectedIdx : null);
    }, [selectedIdx]);

    const activeSelectedIdx = optimisticIdx;
    const selectedRect =
      activeSelectedIdx !== null ? itemRects[activeSelectedIdx] : null;
    const hoverRect = hoveredIndex !== null ? itemRects[hoveredIndex] : null;
    const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
    const isHoveringSelected = hoveredIndex === activeSelectedIdx;
    const isHovering = hoveredIndex !== null && !isHoveringSelected;

    const indexedChildren = Children.map(children, (child, i) => {
      // Skip plain DOM elements — injecting _index into e.g. a <div>
      // triggers React's unknown-prop warning.
      if (isValidElement(child) && typeof child.type !== "string") {
        return cloneElement(child, { _index: i } as Record<string, unknown>);
      }
      return child;
    });

    return (
      <TabsListContext.Provider
        value={{
          registerTab,
          hoveredIndex,
          selectedValue,
          setOptimisticIdx,
        }}
      >
        <TabsPrimitive.List
          // Match Radix's `activationMode="automatic"` — arrow keys move + activate.
          activateOnFocus
          className={cn(
            "relative inline-flex select-none items-center gap-0.5",
            background ? "bg-muted p-0.5" : "bg-transparent p-0",
            shape.container,
            className
          )}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) {
              return;
            }
            setFocusedIndex(null);
            if (isMouseInside.current) {
              return;
            }
            setHoveredIndex(null);
          }}
          onFocus={(e) => {
            const trigger = (e.target as HTMLElement).closest('[role="tab"]');
            if (!trigger) {
              return;
            }
            const indexAttr = trigger.getAttribute("data-proximity-index");
            if (indexAttr != null) {
              const idx = Number(indexAttr);
              setHoveredIndex(idx);
              setFocusedIndex(
                (e.target as HTMLElement).matches(":focus-visible") ? idx : null
              );
            }
          }}
          onMouseLeave={handleMouseLeave}
          onMouseMove={handleMouseMove}
          ref={(node) => {
            (
              containerRef as React.MutableRefObject<HTMLDivElement | null>
            ).current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                node;
            }
          }}
          {...props}
        >
          {/* Active segment indicator */}
          {selectedRect && (
            <motion.div
              animate={{
                left: selectedRect.left,
                width: selectedRect.width,
                top: selectedRect.top,
                height: selectedRect.height,
                opacity: isHovering ? 0.85 : 1,
              }}
              className={cn(
                "pointer-events-none absolute",
                surfaceClasses(indicatorLevel),
                shape.bg
              )}
              initial={false}
              transition={{
                ...(reduceMotion ? { duration: 0 } : spring.moderate),
                opacity: { duration: reduceMotion ? 0 : 0.08 },
              }}
            />
          )}

          {/* Hover indicator */}
          <AnimatePresence>
            {hoverRect && !isHoveringSelected && selectedRect && (
              <motion.div
                animate={{
                  left: hoverRect.left,
                  width: hoverRect.width,
                  top: hoverRect.top,
                  height: hoverRect.height,
                  opacity: 1,
                }}
                className={cn(
                  "pointer-events-none absolute bg-interaction-hover",
                  shape.bg
                )}
                exit={
                  !isMouseInside.current && selectedRect
                    ? {
                        left: selectedRect.left,
                        width: selectedRect.width,
                        top: selectedRect.top,
                        height: selectedRect.height,
                        opacity: 0,
                        transition: {
                          ...(reduceMotion ? { duration: 0 } : spring.moderate),
                          opacity: { duration: reduceMotion ? 0 : 0.06 },
                        },
                      }
                    : {
                        opacity: 0,
                        transition: { duration: reduceMotion ? 0 : 0.06 },
                      }
                }
                initial={{
                  left: selectedRect.left,
                  width: selectedRect.width,
                  top: selectedRect.top,
                  height: selectedRect.height,
                  opacity: 0,
                }}
                transition={{
                  ...(reduceMotion ? { duration: 0 } : spring.fast),
                  opacity: { duration: reduceMotion ? 0 : 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {/* Focus ring */}
          <AnimatePresence>
            {focusRect && (
              <motion.div
                animate={{
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                  height: focusRect.height + 4,
                }}
                className={cn(
                  "pointer-events-none absolute z-20 border border-[color:var(--focus-ring,#6B97FF)]",
                  shape.focusRing
                )}
                exit={{
                  opacity: 0,
                  transition: { duration: reduceMotion ? 0 : 0.06 },
                }}
                initial={false}
                transition={{
                  ...(reduceMotion ? { duration: 0 } : spring.fast),
                  opacity: { duration: reduceMotion ? 0 : 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {indexedChildren}
        </TabsPrimitive.List>
      </TabsListContext.Provider>
    );
  }
);

TabsList.displayName = "TabsList";

/* ─────────────────────── TabItem ─────────────────────── */

interface TabItemProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.Tab> {
  value: string;
  icon?: IconComponent;
  label: string;
  /** @internal Auto-assigned by TabsList. */
  _index?: number;
  children?: ReactNode;
}

const TabItem = forwardRef<HTMLButtonElement, TabItemProps>(
  (
    {
      value,
      icon: Icon,
      label,
      children,
      _index = 0,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLButtonElement>(null);
    const substrate = useSurface();
    const { registerTab, hoveredIndex, selectedValue, setOptimisticIdx } =
      useTabsList();

    useEffect(() => {
      registerTab(_index, value, internalRef.current);
      return () => registerTab(_index, value, null);
    }, [_index, value, registerTab]);

    const isSelected = selectedValue === value;
    const isActive = hoveredIndex === _index || isSelected;

    return (
      <TabsPrimitive.Tab
        // Composed (not spread-overridable): a consumer onClick must not
        // replace the optimistic indicator jump.
        className={cn(
          // Fixed height (not py) so the text-box trim below doesn't shrink
          // the tab — browsers without text-box support render identically.
          "relative z-10 flex cursor-pointer touch-manipulation items-center border-none bg-transparent px-2.5 py-1 outline-none max-lg:min-h-11 max-lg:min-w-11",
          sizeClasses.segmentItem,
          sizeClasses.gap,
          className
        )}
        data-proximity-index={_index}
        onClick={(e) => {
          setOptimisticIdx(_index);
          onClick?.(e);
        }}
        ref={(node) => {
          (internalRef as React.MutableRefObject<HTMLElement | null>).current =
            node as HTMLButtonElement | null;
          if (typeof ref === "function") {
            ref(node as HTMLButtonElement);
          } else if (ref) {
            (ref as React.MutableRefObject<HTMLButtonElement | null>).current =
              node as HTMLButtonElement | null;
          }
        }}
        value={value}
        {...props}
      >
        <SurfaceProvider value={isSelected ? substrate + 2 : substrate}>
          {children ?? (
            <>
              {Icon && (
                <Icon
                  className={cn(
                    "transition-[color,stroke-width] duration-80",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                  size={sizeClasses.icon}
                  strokeWidth={isActive ? 2 : 1.5}
                />
              )}
              {/* Both stacked spans carry the text-box trim so the invisible bold
            sizer and the visible label keep identical boxes. */}
              <span
                className={cn(
                  "inline-grid whitespace-nowrap",
                  sizeClasses.text
                )}
              >
                <span
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 [text-box:trim-both_cap_alphabetic]"
                  style={{ fontVariationSettings: fontWeights.semibold }}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                  style={{
                    fontVariationSettings: isSelected
                      ? fontWeights.semibold
                      : fontWeights.normal,
                  }}
                >
                  {label}
                </span>
              </span>
            </>
          )}
        </SurfaceProvider>
      </TabsPrimitive.Tab>
    );
  }
);

TabItem.displayName = "TabItem";

/* ─────────────────────── TabPanel ─────────────────────── */

interface TabPanelProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.Panel> {
  value: string;
}

const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(
  ({ className, ...props }, ref) => {
    return (
      <TabsPrimitive.Panel
        className={cn("outline-none", className)}
        ref={ref}
        {...props}
      />
    );
  }
);

TabPanel.displayName = "TabPanel";

export { Tabs, TabsList, TabItem, TabPanel };
export type { TabsProps, TabsListProps, TabItemProps, TabPanelProps };
