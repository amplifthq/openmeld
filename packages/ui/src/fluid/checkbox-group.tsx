"use client";

import {
  Indicator as CheckboxIndicator,
  Root as CheckboxRoot,
} from "@radix-ui/react-checkbox";
import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SelectionBackgrounds,
  useMergeSplitBlocks,
} from "#hooks/use-merge-split";
import { useProximityHover } from "#hooks/use-proximity-hover";
import { fontWeights } from "#lib/font-weight";
import { useShape } from "#lib/shape-context";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type CheckboxGroupContextValue = {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
};

const CheckboxGroupContext = createContext<CheckboxGroupContextValue | null>(
  null
);

function useCheckboxGroup() {
  const ctx = useContext(CheckboxGroupContext);
  if (!ctx) {
    throw new Error("useCheckboxGroup must be used within a CheckboxGroup");
  }
  return ctx;
}

interface CheckboxGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  checkedIndices: Set<number>;
}

const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(
  ({ children, checkedIndices, className, ...props }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const groupIdCounter = useRef(0);
    const prevGroupMap = useRef(new Map<number, number>());

    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      sessionRef,
      handlers,
      registerItem,
      measureItems,
    } = useProximityHover(containerRef);

    // biome-ignore lint/correctness/useExhaustiveDependencies: remeasure when children change so option-list geometry stays current without measuring every render.
    useEffect(() => {
      measureItems();
    }, [measureItems, children]);

    // Group contiguous checked indices into runs with stable IDs
    const runs: { start: number; end: number }[] = [];
    const sortedChecked = [...checkedIndices].sort((a, b) => a - b);
    for (const idx of sortedChecked) {
      const last = runs.at(-1);
      if (last && idx === last.end + 1) {
        last.end = idx;
      } else {
        runs.push({ start: idx, end: idx });
      }
    }

    // Assign stable IDs: reuse previous ID if any member overlaps
    const usedIds = new Set<number>();
    const newGroupMap = new Map<number, number>();
    const checkedGroups = runs.map((run) => {
      let stableId: number | null = null;
      for (let i = run.start; i <= run.end; i++) {
        const prevId = prevGroupMap.current.get(i);
        if (prevId !== undefined && !usedIds.has(prevId)) {
          stableId = prevId;
          break;
        }
      }
      const id = stableId ?? ++groupIdCounter.current;
      usedIds.add(id);
      for (let i = run.start; i <= run.end; i++) {
        newGroupMap.set(i, id);
      }
      return { ...run, id };
    });
    prevGroupMap.current = newGroupMap;

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

    const activeRect = activeIndex === null ? null : itemRects[activeIndex];
    const focusRect = focusedIndex === null ? null : itemRects[focusedIndex];
    const isHoveringOther =
      activeIndex !== null && !checkedIndices.has(activeIndex);
    const shape = useShape();

    // Selected backgrounds, with the merge/split boundary animation when one
    // unchecked row bridges or splits two checked runs.
    const blocks = useMergeSplitBlocks(
      checkedGroups,
      itemRects,
      shape.mergedRadius
    );

    return (
      <CheckboxGroupContext.Provider value={{ registerItem, activeIndex }}>
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the group owns roving focus and hover geometry for its child checkbox rows. */}
        {/* biome-ignore lint/a11y/useSemanticElements: the row-based checkbox group keeps the existing div API while exposing group semantics. */}
        <div
          className={cn(
            "relative flex w-72 max-w-full select-none flex-col",
            className
          )}
          onBlur={(e) => {
            // Don't clear hover when focus moves to another item within the group
            if (containerRef.current?.contains(e.relatedTarget as Node)) {
              return;
            }
            setFocusedIndex(null);
            setActiveIndex(null);
          }}
          onFocus={(e) => {
            const indexAttr = (e.target as HTMLElement)
              .closest("[data-proximity-index]")
              ?.getAttribute("data-proximity-index");
            if (indexAttr != null) {
              const idx = Number(indexAttr);
              setActiveIndex(idx);
              setFocusedIndex(
                (e.target as HTMLElement).matches(":focus-visible") ? idx : null
              );
            }
          }}
          onKeyDown={(e) => {
            // Scope to row wrappers only. The inner checkbox primitive also
            // carries role="checkbox", so a bare [role="checkbox"] selector
            // matches twice per row and arrows skip onto the hidden control.
            const items = Array.from(
              containerRef.current?.querySelectorAll(
                "[data-proximity-index]"
              ) ?? []
            ) as HTMLElement[];
            const currentIdx = items.indexOf(e.target as HTMLElement);
            if (currentIdx === -1) {
              return;
            }

            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              const next =
                e.key === "ArrowDown"
                  ? (currentIdx + 1) % items.length
                  : (currentIdx - 1 + items.length) % items.length;
              items[next]?.focus();
            } else if (e.key === "Home") {
              e.preventDefault();
              items[0]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              items.at(-1)?.focus();
            }
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseLeave={handlers.onMouseLeave}
          onMouseMove={handlers.onMouseMove}
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
          role="group"
        >
          {/* Selected backgrounds (merged for contiguous checked items).
              A run is normally one block; mid merge/split it is drawn as two
              abutting halves — see useMergeSplitBlocks. */}
          <SelectionBackgrounds blocks={blocks} dimmed={isHoveringOther} />

          {/* Hover background */}
          <AnimatePresence>
            {activeRect && (
              <motion.div
                animate={{
                  opacity: 1,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                className={`absolute ${shape.bg} pointer-events-none bg-muted`}
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                initial={{
                  opacity: 0,
                  top: activeRect.top,
                  left: activeRect.left,
                  width: activeRect.width,
                  height: activeRect.height,
                }}
                key={sessionRef.current}
                transition={{
                  ...springs.fast,
                  opacity: { duration: 0.08 },
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
                className={`absolute ${shape.focusRing} pointer-events-none z-20 border border-ring`}
                exit={{ opacity: 0, transition: { duration: 0.06 } }}
                initial={false}
                transition={{
                  ...springs.fast,
                  opacity: { duration: 0.08 },
                }}
              />
            )}
          </AnimatePresence>

          {children}
        </div>
      </CheckboxGroupContext.Provider>
    );
  }
);

CheckboxGroup.displayName = "CheckboxGroup";

interface CheckboxItemProps extends HTMLAttributes<HTMLDivElement> {
  adornment?: ReactNode;
  checked: boolean;
  cornerAdornment?: ReactNode;
  description?: ReactNode;
  index: number;
  label: string;
  labelAdornment?: ReactNode;
  labelClassName?: string;
  onToggle: () => void;
}

const CheckboxItem = forwardRef<HTMLDivElement, CheckboxItemProps>(
  (
    {
      adornment,
      checked,
      className,
      cornerAdornment,
      description,
      index,
      label,
      labelAdornment,
      labelClassName,
      onToggle,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const hasMounted = useRef(false);
    const { registerItem, activeIndex } = useCheckboxGroup();

    useEffect(() => {
      registerItem(index, internalRef.current);
      return () => registerItem(index, null);
    }, [index, registerItem]);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    const isActive = activeIndex === index;
    const skipAnimation = !hasMounted.current;
    const shape = useShape();
    const hasDescription = description !== undefined && description !== null;
    let checkboxBorderClassName = "border-[1.5px] border-border";
    if (checked) {
      checkboxBorderClassName = "border-[1.5px] border-transparent";
    } else if (isActive) {
      checkboxBorderClassName =
        "border-[1.5px] border-neutral-400 dark:border-neutral-500";
    }

    return (
      // biome-ignore lint/a11y/useSemanticElements: rich checkbox row uses role plus keyboard handling so the whole row is the target.
      <div
        aria-checked={checked}
        aria-label={label}
        className={cn(
          `relative z-10 flex gap-2.5 ${shape.item} cursor-pointer px-3 py-1.5 outline-none`,
          hasDescription ? "items-start" : "items-center",
          className
        )}
        data-proximity-index={index}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggle();
          }
        }}
        ref={(node) => {
          (
            internalRef as React.MutableRefObject<HTMLDivElement | null>
          ).current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            (ref as React.MutableRefObject<HTMLDivElement | null>).current =
              node;
          }
        }}
        role="checkbox"
        tabIndex={0}
        {...props}
      >
        <CheckboxItemCornerAdornment>
          {cornerAdornment}
        </CheckboxItemCornerAdornment>

        {/* Checkbox — Radix primitive for accessibility */}
        <CheckboxRoot
          aria-hidden
          checked={checked}
          className={cn(
            "relative h-[15px] w-[15px] shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-0 outline-none",
            hasDescription && "mt-0.5"
          )}
          onCheckedChange={() => onToggle()}
          onClick={(e) => e.stopPropagation()}
          tabIndex={-1}
        >
          {/* Border */}
          <div
            className={cn(
              "absolute inset-0 rounded-md border-solid transition-all duration-[80ms]",
              checkboxBorderClassName
            )}
          />
          {/* Check mark */}
          <AnimatePresence>
            {checked && (
              <CheckboxIndicator asChild forceMount>
                <motion.svg
                  animate={{ opacity: 1 }}
                  aria-hidden="true"
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground"
                  exit={{ opacity: 1 }}
                  fill="none"
                  height={18}
                  initial={{ opacity: 1 }}
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  width={18}
                >
                  <motion.path
                    animate={{
                      pathLength: 1,
                      transition: { duration: 0.08, ease: "easeOut" },
                    }}
                    d="M6 12L10 16L18 8"
                    exit={{
                      pathLength: 0,
                      transition: { duration: 0.04, ease: "easeIn" },
                    }}
                    initial={{ pathLength: skipAnimation ? 1 : 0 }}
                  />
                </motion.svg>
              </CheckboxIndicator>
            )}
          </AnimatePresence>
        </CheckboxRoot>

        {adornment ? (
          <span className={cn("flex shrink-0", hasDescription && "mt-0.5")}>
            {adornment}
          </span>
        ) : null}

        {/* Label */}
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="inline-grid text-[13px]">
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {label}
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 transition-[color,font-variation-settings] duration-[80ms]",
                checked || isActive
                  ? "text-foreground"
                  : "text-muted-foreground",
                labelClassName
              )}
              style={{
                fontVariationSettings: checked
                  ? fontWeights.semibold
                  : fontWeights.normal,
              }}
            >
              <span className="min-w-0 truncate">{label}</span>
              {labelAdornment}
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

CheckboxItem.displayName = "CheckboxItem";

function CheckboxItemCornerAdornment({ children }: { children?: ReactNode }) {
  if (!children) {
    return null;
  }

  return (
    <span className="pointer-events-none absolute top-2.5 right-2.5 flex">
      {children}
    </span>
  );
}

export { CheckboxGroup, CheckboxItem };
export default CheckboxGroup;
