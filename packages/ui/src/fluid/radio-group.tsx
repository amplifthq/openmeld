"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useProximityHover } from "#hooks/use-proximity-hover";
import { fontWeights } from "#lib/font-weight";
import { useShape } from "#lib/shape-context";
import { springs } from "#lib/springs";
import { surfaceClasses } from "#lib/surface-classes";
import { cn } from "#lib/utils";
import { useSurface } from "../lib/surface-context";

// Fluid Functionalism "radio-group" primitive, adapted for OpenMeld. Two deliberate
// divergences from upstream:
//   1. Configurable corners — semantic radius classes resolve through the root
//      token, whose default square value is 0px.
//   2. Index-driven selection only (selectedIndex + per-item selected/onSelect).
//      The upstream Radix value-based mode is dropped: every OpenMeld caller drives
//      selection from controlled form state, and @radix-ui/react-radio-group is
//      not a dependency. Full radio semantics (role, aria-checked, roving
//      tabindex, arrow/Space/Enter keys) are implemented here directly.
// Mirrors the sibling tabs-subtle primitive's idioms (proximity hover, spring
// indicator, ghost-label width reservation).

type RadioGroupContextValue = {
  activeIndex: number | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
  selectedIndex: number;
};

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function useRadioGroup() {
  const context = use(RadioGroupContext);

  if (!context) {
    throw new Error("useRadioGroup must be used within a RadioGroup.");
  }

  return context;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// jsdom historically throws on `matches(":focus-visible")`; degrade to "not
// focus-visible" so keyboard interactions stay testable.
function matchesFocusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

type RadioGroupProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  children: ReactNode;
  orientation?: "horizontal" | "vertical";
  selectedIndex: number;
};

type RadioItemProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
  adornment?: ReactNode;
  cornerAdornment?: ReactNode;
  description?: ReactNode;
  index: number;
  label: string;
  labelClassName?: string;
  onSelect?: () => void;
  selected?: boolean;
};

const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  (
    { children, className, orientation = "vertical", selectedIndex, ...props },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const surface = useSurface() + 2;
    const reduceMotion = useReducedMotion();
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const {
      activeIndex,
      handlers,
      itemRects,
      measureItems,
      registerItem,
      sessionRef,
      setActiveIndex,
    } = useProximityHover(containerRef, {
      axis: orientation === "horizontal" ? "x" : "y",
    });

    useIsomorphicLayoutEffect(() => {
      measureItems();
    });

    const shape = useShape();
    const activeRect =
      activeIndex === null ? null : (itemRects[activeIndex] ?? null);
    const focusRect =
      focusedIndex === null ? null : (itemRects[focusedIndex] ?? null);
    const selectedRect =
      selectedIndex >= 0 ? (itemRects[selectedIndex] ?? null) : null;
    const isHoveringOther =
      activeIndex !== null && activeIndex !== selectedIndex;

    return (
      <RadioGroupContext.Provider
        value={{ activeIndex, registerItem, selectedIndex }}
      >
        <div
          {...props}
          aria-orientation={orientation}
          className={cn(
            "relative flex w-72 max-w-full select-none",
            orientation === "horizontal" ? "flex-row" : "flex-col",
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

            if (indexAttribute === null || indexAttribute === undefined) {
              return;
            }

            const index = Number(indexAttribute);
            setActiveIndex(index);
            setFocusedIndex(
              matchesFocusVisible(event.target as HTMLElement) ? index : null
            );
          }}
          onKeyDown={(event) => {
            const items = Array.from(
              containerRef.current?.querySelectorAll('[role="radio"]') ?? []
            ) as HTMLElement[];
            const currentIndex = items.indexOf(event.target as HTMLElement);

            if (currentIndex === -1) {
              return;
            }

            const navigationKeys =
              orientation === "horizontal"
                ? ["ArrowRight", "ArrowLeft"]
                : ["ArrowDown", "ArrowUp"];

            if (navigationKeys.includes(event.key)) {
              event.preventDefault();
              const shouldMoveForward =
                event.key === "ArrowDown" || event.key === "ArrowRight";
              const nextIndex = shouldMoveForward
                ? (currentIndex + 1) % items.length
                : (currentIndex - 1 + items.length) % items.length;
              items[nextIndex]?.focus();
              items[nextIndex]?.click();
              return;
            }

            if (event.key === "Home") {
              event.preventDefault();
              items[0]?.focus();
              items[0]?.click();
              return;
            }

            if (event.key === "End") {
              event.preventDefault();
              items.at(-1)?.focus();
              items.at(-1)?.click();
            }
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseLeave={handlers.onMouseLeave}
          onMouseMove={handlers.onMouseMove}
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
          role="radiogroup"
        >
          {selectedRect ? (
            <motion.div
              animate={{
                height: selectedRect.height,
                left: selectedRect.left,
                opacity: isHoveringOther ? 0.8 : 1,
                top: selectedRect.top,
                width: selectedRect.width,
              }}
              className={cn(
                "pointer-events-none absolute",
                surfaceClasses(surface),
                shape.bg
              )}
              data-slot="radio-group-selected-indicator"
              initial={false}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { ...springs.moderate, opacity: { duration: 0.08 } }
              }
            />
          ) : null}

          <AnimatePresence>
            {activeRect ? (
              <motion.div
                animate={{
                  height: activeRect.height,
                  left: activeRect.left,
                  opacity: 1,
                  top: activeRect.top,
                  width: activeRect.width,
                }}
                className={cn(
                  "pointer-events-none absolute bg-interaction-hover",
                  shape.bg
                )}
                data-slot="radio-group-hover-indicator"
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                initial={{
                  height: activeRect.height,
                  left: activeRect.left,
                  opacity: 0,
                  top: activeRect.top,
                  width: activeRect.width,
                }}
                key={sessionRef.current}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { ...springs.fast, opacity: { duration: 0.08 } }
                }
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
                className={cn(
                  "pointer-events-none absolute z-20 border border-ring",
                  shape.focusRing
                )}
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                initial={false}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { ...springs.fast, opacity: { duration: 0.08 } }
                }
              />
            ) : null}
          </AnimatePresence>

          {children}
        </div>
      </RadioGroupContext.Provider>
    );
  }
);

RadioGroup.displayName = "RadioGroup";

const RadioItem = forwardRef<HTMLDivElement, RadioItemProps>(
  (
    {
      adornment,
      className,
      cornerAdornment,
      description,
      index,
      label,
      labelClassName,
      onSelect,
      selected,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const hasMounted = useRef(false);
    const { activeIndex, registerItem, selectedIndex } = useRadioGroup();
    const shape = useShape();

    useIsomorphicLayoutEffect(() => {
      registerItem(index, internalRef.current);

      return () => {
        registerItem(index, null);
      };
    }, [index, registerItem]);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    const isActive = activeIndex === index;
    const isSelected = selected ?? selectedIndex === index;
    const skipAnimation = !hasMounted.current;
    const hasDescription = description !== undefined && description !== null;

    let circleBorderClassName = "border-border";
    if (isSelected) {
      circleBorderClassName = "border-transparent";
    } else if (isActive) {
      circleBorderClassName = "border-neutral-400 dark:border-neutral-500";
    }

    return (
      // biome-ignore lint/a11y/useSemanticElements: rich radio row (icon + title + description) cannot be an <input>; role + aria-checked + keyboard handling provide the semantics.
      <div
        {...props}
        aria-checked={isSelected}
        aria-label={label}
        className={cn(
          "relative z-10 flex cursor-pointer gap-2.5 px-3 py-1.5 outline-none",
          hasDescription ? "items-start" : "items-center",
          shape.item,
          className
        )}
        data-proximity-index={index}
        onClick={() => {
          onSelect?.();
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onSelect?.();
          }
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
        role="radio"
        // Roving tabindex: the selected item is tabbable; when nothing is
        // selected the first item stays in the tab order so the group is
        // reachable (mirrors the sibling TabsSubtleItem).
        tabIndex={isSelected || (selectedIndex < 0 && index === 0) ? 0 : -1}
      >
        <RadioItemCornerAdornment>{cornerAdornment}</RadioItemCornerAdornment>

        <span
          aria-hidden="true"
          className={cn(
            "relative size-[15px] shrink-0",
            hasDescription && "mt-0.5"
          )}
        >
          <span
            className={cn(
              "absolute inset-0 rounded-full border-[1.5px] border-solid transition-colors duration-80",
              circleBorderClassName
            )}
          />
          <AnimatePresence>
            {isSelected ? (
              <motion.span
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center"
                exit={{
                  opacity: 0,
                  scale: 0.3,
                  transition: { duration: 0.04 },
                }}
                initial={{
                  opacity: skipAnimation ? 1 : 0,
                  scale: skipAnimation ? 1 : 0.3,
                }}
                transition={springs.fast}
              >
                <span className="size-2 rounded-full bg-foreground" />
              </motion.span>
            ) : null}
          </AnimatePresence>
        </span>

        {adornment ? (
          <span className={cn("flex shrink-0", hasDescription && "mt-0.5")}>
            {adornment}
          </span>
        ) : null}

        <span className="grid min-w-0 flex-1 gap-1">
          <span className="inline-grid text-sm">
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {label}
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 min-w-0 transition-[color,font-variation-settings] duration-80",
                isSelected || isActive
                  ? "text-foreground"
                  : "text-muted-foreground",
                labelClassName
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
          {hasDescription ? (
            <span className="text-muted-foreground text-xs leading-5">
              {description}
            </span>
          ) : null}
        </span>
      </div>
    );
  }
);

RadioItem.displayName = "RadioItem";

function RadioItemCornerAdornment({ children }: { children?: ReactNode }) {
  if (!children) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute top-2.5 right-2.5 flex">
      {children}
    </span>
  );
}

export { RadioGroup, RadioItem };
