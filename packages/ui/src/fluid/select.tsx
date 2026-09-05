"use client";

import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  type ButtonHTMLAttributes,
  type ComponentType,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useProximityHover } from "#hooks/use-proximity-hover";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type FluidSelectIcon = ComponentType<{
  className?: string;
  size?: number;
  strokeWidth?: number;
}>;

type SelectContextValue = {
  disabled: boolean;
  labelMap: MutableRefObject<Map<string, string>>;
  listboxId: string;
  onChange: (value: string) => void;
  restoreFocus: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  value: string;
};

type SelectContentContextValue = {
  activeIndex: number | null;
  checkedIndex?: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
};

type SelectProps = {
  children: ReactNode;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  onValueChange?: (value: string) => void;
  onCloseAutoFocus?: (event: Event) => void;
  required?: boolean;
  value?: string;
};

type SelectTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  displayValue?: ReactNode;
  error?: string;
  icon?: FluidSelectIcon;
  placeholder?: string;
  variant?: "bordered" | "borderless";
};

type SelectContentProps = {
  align?: SelectContentAlign;
  children: ReactNode;
  className?: string;
  matchTriggerWidth?: boolean;
  side?: SelectContentSide;
};

type SelectItemProps = HTMLAttributes<HTMLDivElement> & {
  disabled?: boolean;
  icon?: FluidSelectIcon;
  index: number;
  value: string;
};

type SelectGroupProps = HTMLAttributes<HTMLFieldSetElement>;
type SelectLabelProps = HTMLAttributes<HTMLDivElement>;
type SelectSeparatorProps = HTMLAttributes<HTMLHRElement>;
type SelectContentAlign = "end" | "start";
type SelectContentSide = "bottom" | "top";

const SELECT_CONTENT_GAP = 6;
const SELECT_CONTENT_MAX_HEIGHT = 300;
const SELECT_CONTENT_VIEWPORT_PADDING = 8;

const SelectContext = createContext<SelectContextValue | null>(null);
const SelectContentContext = createContext<SelectContentContextValue | null>(
  null
);

const selectArrowNavigationKeys = new Set<string>([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
]);

function useSelectContext() {
  const context = use(SelectContext);

  if (!context) {
    throw new Error(
      "Select compound components must be rendered inside Select."
    );
  }

  return context;
}

function focusOptionForArrowNavigation(input: {
  currentIndex: number;
  items: readonly HTMLElement[];
  key: string;
  value: string;
}) {
  if (input.items.length === 0) {
    return;
  }

  if (input.currentIndex === -1) {
    const checkedItem =
      input.value === ""
        ? null
        : input.items.find(
            (item) => item.getAttribute("data-value") === input.value
          );
    (checkedItem ?? input.items[0])?.focus();
    return;
  }

  const shouldMoveForward =
    input.key === "ArrowDown" || input.key === "ArrowRight";
  const nextIndex = shouldMoveForward
    ? (input.currentIndex + 1) % input.items.length
    : (input.currentIndex - 1 + input.items.length) % input.items.length;
  input.items[nextIndex]?.focus();
}

function Select({
  children,
  defaultValue,
  disabled = false,
  name,
  onValueChange,
  onCloseAutoFocus,
  required,
  value,
}: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const currentValue = value ?? internalValue;
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelMap = useRef(new Map<string, string>());
  const restoreFocus = useCallback(() => {
    const event = new Event("closeAutoFocus", { cancelable: true });
    onCloseAutoFocus?.(event);
    if (!event.defaultPrevented) {
      triggerRef.current?.focus();
    }
  }, [onCloseAutoFocus]);

  const handleChange = useCallback(
    (nextValue: string) => {
      if (value === undefined) {
        setInternalValue(nextValue);
      }

      onValueChange?.(nextValue);
      setOpen(false);
      requestAnimationFrame(restoreFocus);
    },
    [onValueChange, value, restoreFocus]
  );

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <SelectContext.Provider
      value={{
        disabled,
        labelMap,
        listboxId,
        onChange: handleChange,
        restoreFocus,
        open,
        setOpen,
        triggerRef,
        value: currentValue,
      }}
    >
      {children}
      {name ? (
        <input
          name={name}
          required={required}
          type="hidden"
          value={currentValue}
        />
      ) : null}
    </SelectContext.Provider>
  );
}

Select.displayName = "Select";

const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (
    {
      className,
      displayValue,
      error,
      icon: Icon,
      onKeyDown,
      placeholder = "Select...",
      variant = "bordered",
      ...props
    },
    ref
  ) => {
    const { disabled, labelMap, listboxId, open, setOpen, triggerRef, value } =
      useSelectContext();
    const label =
      displayValue ??
      (labelMap.current.has(value)
        ? labelMap.current.get(value)
        : value || undefined);

    return (
      <div className="flex min-w-0 flex-col gap-1">
        <button
          {...props}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={error ? true : undefined}
          className={cn(
            "group inline-flex h-8 min-w-40 max-w-full cursor-pointer touch-manipulation items-center justify-between gap-2 rounded-md px-2.5 py-1 text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 max-lg:h-11 max-lg:min-w-11",
            variant === "bordered"
              ? "border border-input bg-transparent text-foreground hover:bg-muted/40 dark:bg-input/30 dark:hover:bg-input/50"
              : "border border-transparent bg-transparent text-foreground hover:bg-muted/40",
            error
              ? "border-destructive focus-visible:ring-destructive/20"
              : null,
            className
          )}
          disabled={disabled}
          onClick={() => {
            setOpen(!open);
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event);

            if (event.defaultPrevented) {
              return;
            }

            if (
              !open &&
              (event.key === "ArrowDown" ||
                event.key === "ArrowUp" ||
                event.key === "Enter" ||
                event.key === " ")
            ) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          ref={(node) => {
            triggerRef.current = node;

            if (typeof ref === "function") {
              ref(node);
              return;
            }

            if (ref) {
              ref.current = node;
            }
          }}
          role="combobox"
          type="button"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {Icon ? (
              <Icon
                className="shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground"
                size={16}
                strokeWidth={1.5}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-left">
              {label ?? (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
          </span>
          <CaretDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-150 group-hover:text-foreground",
              open ? "rotate-180" : null
            )}
          />
        </button>
        {error ? (
          <span className="px-2.5 text-[11px] text-destructive">{error}</span>
        ) : null}
      </div>
    );
  }
);

SelectTrigger.displayName = "SelectTrigger";

const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(
  (
    { align = "start", children, className, matchTriggerWidth = false, side },
    ref
  ) => {
    const { listboxId, open, setOpen, triggerRef, value, restoreFocus } =
      useSelectContext();
    const containerRef = useRef<HTMLDivElement>(null);
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [checkedIndex, setCheckedIndex] = useState<number | undefined>();
    const {
      activeIndex,
      handlers,
      itemRects,
      measureItems,
      registerItem,
      sessionRef,
      setActiveIndex,
    } = useProximityHover(containerRef);

    useEffect(() => {
      if (open && triggerRef.current) {
        setTriggerRect(triggerRef.current.getBoundingClientRect());
      }
    }, [open, triggerRef]);

    useEffect(() => {
      if (!(open && triggerRect)) {
        return;
      }

      let outerFrame = 0;
      let innerFrame = 0;
      outerFrame = requestAnimationFrame(() => {
        innerFrame = requestAnimationFrame(() => {
          measureItems();
          const container = containerRef.current;

          if (!container) {
            return;
          }

          const items = Array.from(
            container.querySelectorAll("[data-proximity-index]")
          ) as HTMLElement[];
          const nextCheckedIndex = items.findIndex(
            (item) => item.getAttribute("data-value") === value
          );
          setCheckedIndex(
            nextCheckedIndex === -1 ? undefined : nextCheckedIndex
          );
          container.focus({ preventScroll: true });
        });
      });

      return () => {
        cancelAnimationFrame(outerFrame);
        cancelAnimationFrame(innerFrame);
      };
    }, [measureItems, open, triggerRect, value]);

    useEffect(() => {
      if (!open) {
        return;
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") {
          return;
        }

        setOpen(false);
        restoreFocus();
      };

      document.addEventListener("keydown", handleKeyDown);

      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [open, setOpen, restoreFocus]);

    useEffect(() => {
      if (!open) {
        return;
      }

      const handlePointerDown = (event: MouseEvent) => {
        if (
          containerRef.current?.contains(event.target as Node) ||
          triggerRef.current?.contains(event.target as Node)
        ) {
          return;
        }

        setOpen(false);
      };

      document.addEventListener("mousedown", handlePointerDown);

      return () => {
        document.removeEventListener("mousedown", handlePointerDown);
      };
    }, [open, setOpen, triggerRef]);

    useEffect(() => {
      if (!open) {
        return;
      }

      const handleScroll = () => {
        setOpen(false);
      };

      window.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        window.removeEventListener("scroll", handleScroll);
      };
    }, [open, setOpen]);

    const handleContentKeyDown = useCallback(
      (event: ReactKeyboardEvent) => {
        const items = Array.from(
          containerRef.current?.querySelectorAll(
            '[role="option"]:not([data-disabled])'
          ) ?? []
        ) as HTMLElement[];
        const currentIndex = items.indexOf(event.target as HTMLElement);

        if (selectArrowNavigationKeys.has(event.key)) {
          event.preventDefault();
          focusOptionForArrowNavigation({
            currentIndex,
            items,
            key: event.key,
            value,
          });
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
      },
      [value]
    );

    if (!open) {
      return (
        <div aria-hidden="true" hidden>
          {children}
        </div>
      );
    }

    if (!triggerRect) {
      return null;
    }

    const activeRect = activeIndex === null ? null : itemRects[activeIndex];
    const activeDescendantId =
      activeIndex === null ? undefined : `${listboxId}-option-${activeIndex}`;
    const checkedRect =
      checkedIndex === undefined ? null : itemRects[checkedIndex];
    const focusRect =
      focusedIndex === null ? null : (itemRects[focusedIndex] ?? null);
    const isHoveringOther =
      activeIndex !== null && activeIndex !== checkedIndex;
    const triggerElementId = triggerRef.current?.id || undefined;
    const contentPlacement = resolveSelectContentPlacement({
      align,
      allowCollisionFlip: side === undefined,
      matchTriggerWidth,
      preferredSide: side ?? "bottom",
      triggerRect,
    });
    const contentInitial = resolveSelectContentInitial(contentPlacement.side);
    const transformOrigin = resolveSelectContentTransformOrigin(
      contentPlacement.side
    );

    return createPortal(
      <SelectContentContext.Provider
        value={{ activeIndex, checkedIndex, registerItem }}
      >
        <div style={contentPlacement.positionStyle}>
          <motion.div
            animate={{ opacity: 1, scaleY: 1, y: 0 }}
            initial={contentInitial}
            style={{ transformOrigin }}
            transition={springs.fast}
          >
            <div
              aria-activedescendant={activeDescendantId}
              aria-labelledby={triggerElementId}
              className={cn(
                "relative flex max-h-[300px] select-none flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-card p-1 text-card-foreground shadow-[0_8px_32px_rgba(0,0,0,0.08)] outline-none dark:shadow-[0_8px_32px_rgba(0,0,0,0.18)]",
                className
              )}
              id={listboxId}
              onBlur={(event) => {
                if (
                  containerRef.current?.contains(event.relatedTarget as Node)
                ) {
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
                  (event.target as HTMLElement).matches(":focus-visible")
                    ? index
                    : null
                );
              }}
              onKeyDown={handleContentKeyDown}
              onMouseEnter={() => {
                handlers.onMouseEnter();
                setFocusedIndex(null);
              }}
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
              role="listbox"
              style={
                contentPlacement.maxHeight === undefined
                  ? undefined
                  : { maxHeight: contentPlacement.maxHeight }
              }
              tabIndex={-1}
            >
              <AnimatePresence>
                {checkedRect ? (
                  <motion.div
                    animate={{
                      height: checkedRect.height,
                      left: checkedRect.left,
                      opacity: isHoveringOther ? 0.82 : 1,
                      top: checkedRect.top,
                      width: checkedRect.width,
                    }}
                    className="pointer-events-none absolute rounded-md border border-border bg-muted"
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
                {activeRect ? (
                  <motion.div
                    animate={{
                      height: activeRect.height,
                      left: activeRect.left,
                      opacity: 1,
                      top: activeRect.top,
                      width: activeRect.width,
                    }}
                    className="pointer-events-none absolute rounded-md border border-border/80 bg-muted/70"
                    exit={{ opacity: 0, transition: { duration: 0.06 } }}
                    initial={{
                      height: checkedRect?.height ?? activeRect.height,
                      left: checkedRect?.left ?? activeRect.left,
                      opacity: 0,
                      top: checkedRect?.top ?? activeRect.top,
                      width: checkedRect?.width ?? activeRect.width,
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
                    className="pointer-events-none absolute z-20 rounded-md border border-ring"
                    exit={{ opacity: 0, transition: { duration: 0.06 } }}
                    initial={false}
                    transition={{
                      ...springs.fast,
                      opacity: { duration: 0.08 },
                    }}
                  />
                ) : null}
              </AnimatePresence>

              {children}
            </div>
          </motion.div>
        </div>
      </SelectContentContext.Provider>,
      document.body
    );
  }
);

SelectContent.displayName = "SelectContent";

function resolveSelectContentPlacement(input: {
  align: SelectContentAlign;
  allowCollisionFlip: boolean;
  matchTriggerWidth: boolean;
  preferredSide: SelectContentSide;
  triggerRect: DOMRect;
}) {
  const spaceAbove =
    input.triggerRect.top -
    SELECT_CONTENT_GAP -
    SELECT_CONTENT_VIEWPORT_PADDING;
  const spaceBelow =
    window.innerHeight -
    input.triggerRect.bottom -
    SELECT_CONTENT_GAP -
    SELECT_CONTENT_VIEWPORT_PADDING;
  const preferredSpace =
    input.preferredSide === "top" ? spaceAbove : spaceBelow;
  const oppositeSpace = input.preferredSide === "top" ? spaceBelow : spaceAbove;
  let side = input.preferredSide;
  if (
    input.allowCollisionFlip &&
    preferredSpace < SELECT_CONTENT_MAX_HEIGHT &&
    oppositeSpace > preferredSpace
  ) {
    side = input.preferredSide === "top" ? "bottom" : "top";
  }
  const horizontalStyle =
    input.align === "end"
      ? { right: window.innerWidth - input.triggerRect.right }
      : { left: input.triggerRect.left };
  const verticalStyle =
    side === "top"
      ? {
          bottom:
            window.innerHeight - input.triggerRect.top + SELECT_CONTENT_GAP,
        }
      : { top: input.triggerRect.bottom + SELECT_CONTENT_GAP };
  const availableHeight = side === "top" ? spaceAbove : spaceBelow;

  return {
    maxHeight: Math.max(
      0,
      Math.min(SELECT_CONTENT_MAX_HEIGHT, availableHeight)
    ),
    positionStyle: {
      ...horizontalStyle,
      ...verticalStyle,
      ...(input.matchTriggerWidth
        ? { width: input.triggerRect.width }
        : { minWidth: input.triggerRect.width }),
      position: "fixed" as const,
      zIndex: 50,
    },
    side,
  };
}

function resolveSelectContentInitial(side: SelectContentSide) {
  if (side === "top") {
    return {
      opacity: 0,
      scaleY: 0.96,
      y: 4,
    };
  }

  return {
    opacity: 0,
    scaleY: 0.96,
    y: -4,
  };
}

function resolveSelectContentTransformOrigin(side: SelectContentSide) {
  return side === "top" ? "bottom center" : "top center";
}

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  (
    {
      "aria-label": ariaLabel,
      children,
      className,
      disabled = false,
      icon: Icon,
      index,
      onClick,
      onKeyDown,
      value,
      ...props
    },
    ref
  ) => {
    const selectContext = useSelectContext();
    const contentContext = use(SelectContentContext);
    const internalRef = useRef<HTMLDivElement>(null);
    const hasMounted = useRef(false);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    useEffect(() => {
      if (typeof children === "string") {
        selectContext.labelMap.current.set(value, children);
      }
    }, [children, selectContext.labelMap, value]);

    useEffect(() => {
      contentContext?.registerItem(index, internalRef.current);

      return () => {
        contentContext?.registerItem(index, null);
      };
    }, [contentContext, index]);

    const isActive = contentContext?.activeIndex === index;
    const isChecked = selectContext.value === value;
    const isDisabled = disabled || selectContext.disabled;
    const skipAnimation = !hasMounted.current;

    return (
      <div
        {...props}
        aria-disabled={isDisabled || undefined}
        aria-label={
          ariaLabel ?? (typeof children === "string" ? children : undefined)
        }
        aria-selected={isChecked}
        className={cn(
          "relative z-10 flex cursor-pointer touch-manipulation select-none items-center gap-2 rounded-md px-2 py-2 text-xs outline-none transition-colors max-lg:min-h-11",
          isActive || isChecked ? "text-foreground" : "text-muted-foreground",
          isDisabled ? "pointer-events-none opacity-50" : null,
          className
        )}
        data-disabled={isDisabled || undefined}
        data-proximity-index={index}
        data-value={value}
        id={`${selectContext.listboxId}-option-${index}`}
        onClick={(event) => {
          onClick?.(event);

          if (!(event.defaultPrevented || isDisabled)) {
            selectContext.onChange(value);
          }
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);

          if (event.defaultPrevented || isDisabled) {
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectContext.onChange(value);
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
        role="option"
        tabIndex={
          isChecked || index === (contentContext?.checkedIndex ?? 0) ? 0 : -1
        }
      >
        {Icon ? (
          <Icon
            className="shrink-0 transition-colors duration-80"
            size={16}
            strokeWidth={isActive || isChecked ? 2 : 1.5}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <AnimatePresence>
          {isChecked ? (
            <motion.span
              animate={{ opacity: 1, scale: 1 }}
              className="shrink-0 text-foreground"
              exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.06 } }}
              initial={{
                opacity: skipAnimation ? 1 : 0,
                scale: skipAnimation ? 1 : 0.88,
              }}
              transition={{ duration: 0.08, ease: "easeOut" }}
            >
              <CheckIcon aria-hidden="true" className="size-4" weight="bold" />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }
);

SelectItem.displayName = "SelectItem";

function SelectGroup({ children, className, ...props }: SelectGroupProps) {
  return (
    <fieldset {...props} className={cn("m-0 border-0 p-0", className)}>
      {children}
    </fieldset>
  );
}

SelectGroup.displayName = "SelectGroup";

const SelectLabel = forwardRef<HTMLDivElement, SelectLabelProps>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      className={cn("px-2 py-1.5 text-[11px] text-muted-foreground", className)}
      ref={ref}
    />
  )
);

SelectLabel.displayName = "SelectLabel";

const SelectSeparator = forwardRef<HTMLHRElement, SelectSeparatorProps>(
  ({ className, ...props }, ref) => (
    <hr
      {...props}
      className={cn("-mx-1 my-1 border-border/60 border-t", className)}
      ref={ref}
    />
  )
);

SelectSeparator.displayName = "SelectSeparator";

export type {
  SelectContentProps,
  SelectItemProps,
  SelectProps,
  SelectTriggerProps,
};
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
};
