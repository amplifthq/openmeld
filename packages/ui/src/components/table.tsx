"use client";

import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "framer-motion";
import {
  type ComponentProps,
  createContext,
  type Ref,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { useProximityHover } from "#hooks/use-proximity-hover";
import { fontWeights } from "#lib/font-weight";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type TableContextValue = {
  activeIndex: number | null;
  registerItem: (index: number, element: HTMLElement | null) => void;
};

const TableContext = createContext<TableContextValue | null>(null);

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}

function Table({
  children,
  className,
  ref,
  ...props
}: ComponentProps<"table">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion() === true;
  const { activeIndex, handlers, itemRects, registerItem, sessionRef } =
    useProximityHover(containerRef);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => handlers.onMouseMove(event);
    container.addEventListener("mouseenter", handlers.onMouseEnter);
    container.addEventListener("mouseleave", handlers.onMouseLeave);
    container.addEventListener("mousemove", handleMouseMove);
    return () => {
      container.removeEventListener("mouseenter", handlers.onMouseEnter);
      container.removeEventListener("mouseleave", handlers.onMouseLeave);
      container.removeEventListener("mousemove", handleMouseMove);
    };
  }, [handlers.onMouseEnter, handlers.onMouseLeave, handlers.onMouseMove]);

  const activeRect = activeIndex === null ? null : itemRects[activeIndex];
  const contextValue = useMemo(
    () => ({ activeIndex, registerItem }),
    [activeIndex, registerItem]
  );

  return (
    <TableContext.Provider value={contextValue}>
      <div
        className="relative w-full overflow-x-auto"
        data-slot="table-container"
        ref={containerRef}
      >
        <LazyMotion features={domAnimation}>
          <AnimatePresence>
            {activeRect ? (
              <m.div
                animate={{
                  opacity: 1,
                  scaleX: activeRect.width,
                  scaleY: activeRect.height,
                  x: activeRect.left,
                  y: activeRect.top,
                }}
                aria-hidden="true"
                className="pointer-events-none absolute size-px origin-top-left bg-muted/50"
                exit={{ opacity: 0 }}
                initial={{
                  opacity: 0,
                  scaleX: activeRect.width,
                  scaleY: activeRect.height,
                  x: activeRect.left,
                  y: activeRect.top,
                }}
                key={sessionRef.current}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        ...springs.fast,
                        opacity: { duration: 0.08 },
                      }
                }
              />
            ) : null}
          </AnimatePresence>
        </LazyMotion>
        <table
          className={cn(
            "w-full caption-bottom border-collapse text-xs",
            className
          )}
          data-slot="table"
          ref={ref}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      className={cn("[&_tr]:border-b", className)}
      data-slot="table-header"
      {...props}
    />
  );
}

function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", className)}
      data-slot="table-body"
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      data-slot="table-footer"
      {...props}
    />
  );
}

type TableRowProps = ComponentProps<"tr"> & {
  /** Zero-based body-row position used by the proximity hover indicator. */
  index?: number;
};

function TableRow({ className, index, ref, style, ...props }: TableRowProps) {
  const internalRef = useRef<HTMLTableRowElement>(null);
  const context = useContext(TableContext);
  const registerItem = context?.registerItem;

  useEffect(() => {
    if (index === undefined || !registerItem) {
      return;
    }
    registerItem(index, internalRef.current);
    return () => registerItem(index, null);
  }, [index, registerItem]);

  const isProximityRow = index !== undefined;
  const isActive = isProximityRow && context?.activeIndex === index;
  const activeIndex = context?.activeIndex ?? null;
  const hideBorder =
    activeIndex !== null &&
    (isProximityRow
      ? index === activeIndex || index === activeIndex - 1
      : activeIndex === 0);

  return (
    <tr
      className={cn(
        "group/row relative z-10 border-b transition-[border-color,background-color] duration-80",
        hideBorder ? "border-transparent" : "border-border/70",
        isProximityRow
          ? isActive && "is-active"
          : "hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      data-proximity-active={isActive ? "true" : undefined}
      data-proximity-index={index}
      data-slot="table-row"
      ref={(node) => {
        internalRef.current = node;
        assignRef(ref, node);
      }}
      style={{
        ...(isProximityRow
          ? { fontVariationSettings: fontWeights.normal }
          : null),
        ...style,
      }}
      {...props}
    />
  );
}

function TableHead({ className, style, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-10 whitespace-nowrap px-3 text-left align-middle font-medium text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      data-slot="table-head"
      style={{ fontVariationSettings: fontWeights.semibold, ...style }}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "whitespace-nowrap p-3 align-middle transition-colors duration-80 group-[.is-active]/row:text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      data-slot="table-cell"
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return (
    <caption
      className={cn("mt-4 text-muted-foreground text-xs", className)}
      data-slot="table-caption"
      {...props}
    />
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
};
