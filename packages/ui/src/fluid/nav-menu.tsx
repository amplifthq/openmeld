"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  type ComponentProps,
  createContext,
  forwardRef,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useProximityHover } from "#hooks/use-proximity-hover";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type FluidNavMenuContextValue = {
  activeIndex: number | null;
  activeValue: string | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
  registerValue: (index: number, value: string | null) => void;
};

type FluidNavMenuProps = Omit<
  ComponentProps<"nav">,
  "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave" | "onMouseMove"
> & {
  activeIndicatorClassName?: string;
  activeValue: string | null;
  children: ReactNode;
  focusIndicatorClassName?: string;
  hoverIndicatorClassName?: string;
  indicatorClassName?: string;
};

type FluidNavMenuItemProps = ComponentProps<"li"> & {
  disabled?: boolean;
  index: number;
  value: string;
};

const FluidNavMenuContext = createContext<FluidNavMenuContextValue | null>(
  null
);

function useFluidNavMenu() {
  const context = use(FluidNavMenuContext);

  if (!context) {
    throw new Error("useFluidNavMenu must be used within FluidNavMenu.");
  }

  return context;
}

const FluidNavMenu = forwardRef<HTMLElement, FluidNavMenuProps>(
  (
    {
      activeIndicatorClassName,
      activeValue,
      children,
      className,
      focusIndicatorClassName,
      hoverIndicatorClassName,
      indicatorClassName,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLElement>(null);
    const valueToIndexRef = useRef(new Map<string, number>());
    const indexToValueRef = useRef(new Map<number, string>());
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const {
      activeIndex,
      handlers,
      itemRects,
      measureItems,
      registerItem,
      sessionRef,
      setActiveIndex,
    } = useProximityHover(containerRef);
    const {
      onMouseEnter: handleProximityMouseEnter,
      onMouseLeave: handleProximityMouseLeave,
      onMouseMove: handleProximityMouseMove,
    } = handlers;

    useEffect(() => {
      measureItems();
    });

    const registerValue = useCallback((index: number, value: string | null) => {
      const previousValue = indexToValueRef.current.get(index);
      if (previousValue) {
        valueToIndexRef.current.delete(previousValue);
        indexToValueRef.current.delete(index);
      }

      if (value !== null) {
        indexToValueRef.current.set(index, value);
        valueToIndexRef.current.set(value, index);
      }
    }, []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const handleMouseEnter = () => {
        handleProximityMouseEnter();
      };
      const handleMouseLeave = () => {
        handleProximityMouseLeave();
      };
      const handleMouseMove = (event: MouseEvent) => {
        handleProximityMouseMove(event);
      };
      const handleFocusIn = (event: FocusEvent) => {
        const indexAttribute = (event.target as HTMLElement)
          .closest("[data-fluid-nav-index]")
          ?.getAttribute("data-fluid-nav-index");

        if (indexAttribute === undefined || indexAttribute === null) {
          return;
        }

        const index = Number(indexAttribute);
        setActiveIndex(index);
        setFocusedIndex(
          (event.target as HTMLElement).matches(":focus-visible") ? index : null
        );
      };
      const handleFocusOut = (event: FocusEvent) => {
        if (container.contains(event.relatedTarget as Node)) {
          return;
        }

        setFocusedIndex(null);
        setActiveIndex(null);
      };

      container.addEventListener("mouseenter", handleMouseEnter);
      container.addEventListener("mouseleave", handleMouseLeave);
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("focusin", handleFocusIn);
      container.addEventListener("focusout", handleFocusOut);

      return () => {
        container.removeEventListener("mouseenter", handleMouseEnter);
        container.removeEventListener("mouseleave", handleMouseLeave);
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("focusin", handleFocusIn);
        container.removeEventListener("focusout", handleFocusOut);
      };
    }, [
      handleProximityMouseEnter,
      handleProximityMouseLeave,
      handleProximityMouseMove,
      setActiveIndex,
    ]);

    const activeValueIndex =
      activeValue === null
        ? null
        : (valueToIndexRef.current.get(activeValue) ?? null);
    const activeValueRect =
      activeValueIndex === null ? null : (itemRects[activeValueIndex] ?? null);
    const hoverRect =
      activeIndex === null ? null : (itemRects[activeIndex] ?? null);
    const focusRect =
      focusedIndex === null ? null : (itemRects[focusedIndex] ?? null);
    const isHoveringActiveValue =
      activeIndex !== null && activeIndex === activeValueIndex;
    const hoverInitialRect = activeValueRect ?? hoverRect;

    return (
      <FluidNavMenuContext.Provider
        value={{
          activeIndex,
          activeValue,
          registerItem,
          registerValue,
        }}
      >
        <nav
          {...props}
          className={cn("relative min-w-0 select-none", className)}
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
        >
          <AnimatePresence>
            {activeValueRect ? (
              <motion.div
                animate={{
                  height: activeValueRect.height,
                  left: activeValueRect.left,
                  opacity: 1,
                  top: activeValueRect.top,
                  width: activeValueRect.width,
                }}
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute rounded-md bg-muted",
                  indicatorClassName,
                  activeIndicatorClassName
                )}
                data-slot="fluid-nav-menu-active-indicator"
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                initial={false}
                transition={{
                  ...springs.moderate,
                  opacity: { duration: 0.08 },
                }}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {hoverRect && !isHoveringActiveValue && hoverInitialRect ? (
              <motion.div
                animate={{
                  height: hoverRect.height,
                  left: hoverRect.left,
                  opacity: 1,
                  top: hoverRect.top,
                  width: hoverRect.width,
                }}
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute rounded-md bg-muted/70",
                  indicatorClassName,
                  hoverIndicatorClassName
                )}
                data-slot="fluid-nav-menu-hover-indicator"
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                initial={{
                  height: hoverInitialRect.height,
                  left: hoverInitialRect.left,
                  opacity: 0,
                  top: hoverInitialRect.top,
                  width: hoverInitialRect.width,
                }}
                key={sessionRef.current}
                transition={{
                  ...springs.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {focusRect ? (
              <motion.div
                animate={{
                  height: focusRect.height + 4,
                  left: focusRect.left - 2,
                  top: focusRect.top - 2,
                  width: focusRect.width + 4,
                }}
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute z-20 rounded-md border border-ring",
                  focusIndicatorClassName
                )}
                data-slot="fluid-nav-menu-focus-indicator"
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                initial={false}
                transition={{
                  ...springs.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            ) : null}
          </AnimatePresence>

          <ul className="relative z-10 flex min-w-0 flex-col gap-1">
            {children}
          </ul>
        </nav>
      </FluidNavMenuContext.Provider>
    );
  }
);

FluidNavMenu.displayName = "FluidNavMenu";

const FluidNavMenuItem = forwardRef<HTMLLIElement, FluidNavMenuItemProps>(
  ({ className, disabled = false, index, value, ...props }, ref) => {
    const internalRef = useRef<HTMLLIElement>(null);
    const { activeIndex, activeValue, registerItem, registerValue } =
      useFluidNavMenu();
    const isActive = activeValue === value;
    const isHovered = activeIndex === index;

    useEffect(() => {
      const element = disabled ? null : internalRef.current;
      registerItem(index, element);
      registerValue(index, disabled ? null : value);

      return () => {
        registerItem(index, null);
        registerValue(index, null);
      };
    }, [disabled, index, registerItem, registerValue, value]);

    return (
      <li
        {...props}
        aria-disabled={disabled || undefined}
        className={cn("relative z-10 min-w-0", className)}
        data-active={isActive || undefined}
        data-fluid-nav-index={index}
        data-fluid-nav-value={value}
        data-hovered={isHovered || undefined}
        data-state={isActive ? "active" : "inactive"}
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
      />
    );
  }
);

FluidNavMenuItem.displayName = "FluidNavMenuItem";

export type { FluidNavMenuItemProps, FluidNavMenuProps };
export { FluidNavMenu, FluidNavMenuItem };
