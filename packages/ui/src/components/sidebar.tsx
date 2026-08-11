"use client";

import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type ElementRef,
  forwardRef,
  type Ref,
  type RefObject,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "#components/button";
import { useSidebarResize } from "#hooks/use-sidebar-resize";
import { cn } from "#lib/utils";

const DEFAULT_WIDTH = "18rem";
const DEFAULT_MIN_WIDTH = "14rem";
const DEFAULT_MAX_WIDTH = "24rem";
const DEFAULT_COLLAPSED_WIDTH = "3rem";
const DEFAULT_RESIZE_STEP = 16;
const PX_PER_REM = 16;

export type SidebarSide = "left" | "right";
type SidebarState = "expanded" | "compact" | "collapsed";

type SidebarContextValue = {
  state: SidebarState;
  open: boolean;
  setOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  // Orthogonal to `open`: whether the sidebar renders its optional third
  // "compact" tier instead of the full continuously-resizable width.
  // Always false unless a consumer opts in via `compactWidth` below.
  compact: boolean;
  setCompact: (compact: boolean | ((compact: boolean) => boolean)) => void;
  width: string;
  setWidth: (width: string) => void;
  minWidth: string;
  maxWidth: string;
  collapsedWidth: string;
  // Undefined = the compact tier is disabled entirely (this IS the opt-in gate).
  compactWidth?: string;
  side: SidebarSide;
  resizeRootRef: RefObject<HTMLDivElement | null>;
  isDraggingRail: boolean;
  setIsDraggingRail: (isDragging: boolean) => void;
};

type SidebarProviderProps = ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultCompact?: boolean;
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
  defaultWidth?: string;
  width?: string;
  onWidthChange?: (width: string) => void;
  minWidth?: string;
  maxWidth?: string;
  collapsedWidth?: string;
  compactWidth?: string;
  side?: SidebarSide;
  onResizingChange?: (resizing: boolean) => void;
};

type SidebarProps = ComponentProps<"aside"> & {
  side?: SidebarSide;
  collapsible?: "icon" | "none";
};

type SidebarRailProps = ComponentProps<"button"> & {
  enableDrag?: boolean;
  enableToggle?: boolean;
  autoCollapse?: boolean;
  autoCollapseThreshold?: number;
  expandThreshold?: number;
  nested?: boolean;
  resizeStep?: number;
  separatorLabel?: string;
  side?: SidebarSide;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  ref.current = value;
}

function directionForSide(side: SidebarSide): "left" | "right" {
  return side === "left" ? "right" : "left";
}

function toPx(width: string): number {
  const value = Number.parseFloat(width);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return width.trim().endsWith("rem") ? value * PX_PER_REM : value;
}

function formatLikeWidth(reference: string, valuePx: number): string {
  if (reference.trim().endsWith("rem")) {
    return `${(valuePx / PX_PER_REM).toFixed(1)}rem`;
  }
  return `${Math.round(valuePx)}px`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSidebarState(open: boolean, compact: boolean): SidebarState {
  if (!open) {
    return "collapsed";
  }
  return compact ? "compact" : "expanded";
}

function resolveAppliedSidebarWidth(
  isCollapsed: boolean,
  isCompact: boolean
): string {
  if (isCollapsed) {
    return "var(--sidebar-width-icon)";
  }
  if (isCompact) {
    return "var(--sidebar-width-compact)";
  }
  return "var(--sidebar-width)";
}

function resolveKeyboardResizeTargetPx(input: {
  key: string;
  direction: "left" | "right";
  currentPx: number;
  stepPx: number;
  minPx: number;
  maxPx: number;
}): number | null {
  const growStep = input.direction === "right" ? input.stepPx : -input.stepPx;
  switch (input.key) {
    case "ArrowRight":
      return clamp(input.currentPx + growStep, input.minPx, input.maxPx);
    case "ArrowLeft":
      return clamp(input.currentPx - growStep, input.minPx, input.maxPx);
    case "Home":
      return input.minPx;
    case "End":
      return input.maxPx;
    default:
      return null;
  }
}

const SidebarProvider = forwardRef<HTMLDivElement, SidebarProviderProps>(
  (
    {
      children,
      className,
      collapsedWidth = DEFAULT_COLLAPSED_WIDTH,
      compact: compactProp,
      compactWidth,
      defaultCompact = false,
      defaultOpen = true,
      defaultWidth = DEFAULT_WIDTH,
      maxWidth = DEFAULT_MAX_WIDTH,
      minWidth = DEFAULT_MIN_WIDTH,
      onCompactChange,
      onOpenChange,
      onResizingChange,
      onWidthChange,
      open: openProp,
      side = "left",
      style,
      width: widthProp,
      ...props
    },
    ref
  ) => {
    const resizeRootRef = useRef<HTMLDivElement>(null);
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const [uncontrolledCompact, setUncontrolledCompact] =
      useState(defaultCompact);
    const [uncontrolledWidth, setUncontrolledWidth] = useState(defaultWidth);
    const [internalIsDraggingRail, setInternalIsDraggingRail] = useState(false);
    const open = openProp ?? uncontrolledOpen;
    const compact = compactProp ?? uncontrolledCompact;
    const width = widthProp ?? uncontrolledWidth;
    const state: SidebarState = resolveSidebarState(open, compact);
    const openRef = useRef(open);
    openRef.current = open;
    const compactRef = useRef(compact);
    compactRef.current = compact;

    const setOpen = useCallback(
      (nextOpen: boolean | ((open: boolean) => boolean)) => {
        const resolvedOpen =
          typeof nextOpen === "function" ? nextOpen(openRef.current) : nextOpen;
        openRef.current = resolvedOpen;
        if (openProp === undefined) {
          setUncontrolledOpen(resolvedOpen);
        }
        onOpenChange?.(resolvedOpen);
      },
      [onOpenChange, openProp]
    );

    const setCompact = useCallback(
      (nextCompact: boolean | ((compact: boolean) => boolean)) => {
        const resolvedCompact =
          typeof nextCompact === "function"
            ? nextCompact(compactRef.current)
            : nextCompact;
        compactRef.current = resolvedCompact;
        if (compactProp === undefined) {
          setUncontrolledCompact(resolvedCompact);
        }
        onCompactChange?.(resolvedCompact);
      },
      [onCompactChange, compactProp]
    );

    const setWidth = useCallback(
      (nextWidth: string) => {
        if (widthProp === undefined) {
          setUncontrolledWidth(nextWidth);
        }
        onWidthChange?.(nextWidth);
      },
      [onWidthChange, widthProp]
    );

    const setIsDraggingRail = useCallback(
      (isDragging: boolean) => {
        setInternalIsDraggingRail(isDragging);
        onResizingChange?.(isDragging);
      },
      [onResizingChange]
    );

    // The canonical click/keyboard toggle exposed via context (SidebarTrigger
    // uses this). Cycles collapsed -> compact -> full -> collapsed when a
    // compact tier is configured, matching SidebarRail's own cycle -- and
    // degenerates to today's plain flip when it isn't.
    const toggleSidebar = useCallback(() => {
      if (compactWidth === undefined) {
        setOpen((currentOpen) => !currentOpen);
        return;
      }
      if (state === "collapsed") {
        setCompact(true);
        setOpen(true);
      } else if (state === "compact") {
        setCompact(false);
      } else {
        setOpen(false);
      }
    }, [compactWidth, state, setOpen, setCompact]);

    const value = useMemo<SidebarContextValue>(
      () => ({
        collapsedWidth,
        compact,
        compactWidth,
        isDraggingRail: internalIsDraggingRail,
        maxWidth,
        minWidth,
        open,
        resizeRootRef,
        setCompact,
        setIsDraggingRail,
        setOpen,
        setWidth,
        side,
        state,
        toggleSidebar,
        width,
      }),
      [
        collapsedWidth,
        compact,
        compactWidth,
        internalIsDraggingRail,
        maxWidth,
        minWidth,
        open,
        setCompact,
        setIsDraggingRail,
        setOpen,
        setWidth,
        side,
        state,
        toggleSidebar,
        width,
      ]
    );

    return (
      <SidebarContext.Provider value={value}>
        <div
          className={cn(
            "group/sidebar-wrapper flex min-h-0 shrink-0",
            className
          )}
          data-slot="sidebar-wrapper"
          data-state={state}
          ref={(node) => {
            resizeRootRef.current = node;
            assignRef(ref, node);
          }}
          style={
            {
              "--sidebar-width": width,
              "--sidebar-width-icon": collapsedWidth,
              ...(compactWidth
                ? { "--sidebar-width-compact": compactWidth }
                : null),
              ...style,
            } as CSSProperties
          }
          {...props}
        >
          {children}
        </div>
      </SidebarContext.Provider>
    );
  }
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  (
    {
      children,
      className,
      collapsible = "icon",
      side: sideProp,
      style,
      ...props
    },
    ref
  ) => {
    const { isDraggingRail, side: contextSide, state } = useSidebar();
    const side = sideProp ?? contextSide;
    const isCollapsed = state === "collapsed" && collapsible === "icon";
    const isCompact = state === "compact" && collapsible === "icon";
    const appliedWidth = resolveAppliedSidebarWidth(isCollapsed, isCompact);

    return (
      <aside
        className={cn(
          "relative flex h-full shrink-0 flex-col border-border bg-sidebar text-sidebar-foreground transition-[width]",
          side === "left" ? "border-r" : "border-l",
          isDraggingRail && "duration-0",
          className
        )}
        data-collapsible={collapsible}
        data-resizing={isDraggingRail || undefined}
        data-side={side}
        data-slot="sidebar"
        data-state={state}
        ref={ref}
        style={
          {
            width: appliedWidth,
            ...style,
          } as CSSProperties
        }
        {...props}
      >
        {children}
      </aside>
    );
  }
);
Sidebar.displayName = "Sidebar";

const SidebarRail = forwardRef<HTMLButtonElement, SidebarRailProps>(
  (
    {
      autoCollapse = false,
      autoCollapseThreshold,
      className,
      enableDrag = true,
      enableToggle = true,
      expandThreshold,
      nested = false,
      onKeyDown,
      onPointerDown,
      resizeStep = DEFAULT_RESIZE_STEP,
      separatorLabel = "Resize sidebar",
      side: sideProp,
      ...props
    },
    ref
  ) => {
    const {
      compact,
      compactWidth,
      maxWidth,
      minWidth,
      resizeRootRef,
      setCompact,
      setIsDraggingRail,
      setOpen,
      setWidth,
      side: contextSide,
      state,
      toggleSidebar,
      width,
    } = useSidebar();
    const side = sideProp ?? contextSide;
    const direction = directionForSide(side);
    const isCollapsed = state === "collapsed";
    const isCompactState = state === "compact";
    const minPx = toPx(minWidth);
    const maxPx = toPx(maxWidth);
    const currentPx = toPx(width);
    // The drag engine's own onToggle must stay a plain open flip — it
    // orchestrates collapsed<->compact<->full transitions itself by calling
    // this and onCompactChange independently (see use-sidebar-resize.ts).
    // A click/keyboard press with no drag instead calls the context's
    // toggleSidebar, which already knows how to cycle through all three tiers.
    const toggle = useCallback(() => {
      setOpen((currentOpen) => !currentOpen);
    }, [setOpen]);
    const { dragRef, handlePointerDown } = useSidebarResize({
      autoCollapseThreshold,
      compactWidth,
      currentWidth: width,
      direction,
      enableAutoCollapse: autoCollapse,
      enableDrag,
      enableToggle,
      expandThreshold,
      isCollapsed,
      isCompact: compact,
      isNested: nested,
      maxResizeWidth: maxWidth,
      minResizeWidth: minWidth,
      onCompactChange: setCompact,
      onResize: setWidth,
      onToggle: enableToggle ? toggle : undefined,
      resizeRootRef,
      setIsDraggingRail,
    });

    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          if (enableToggle) {
            event.preventDefault();
            toggleSidebar();
          }
          return;
        }

        if (isCollapsed || isCompactState) {
          return;
        }

        const nextPx = resolveKeyboardResizeTargetPx({
          currentPx: toPx(width),
          direction,
          key: event.key,
          maxPx,
          minPx,
          stepPx: resizeStep,
        });
        if (nextPx === null) {
          return;
        }

        event.preventDefault();
        const nextWidth = formatLikeWidth(width, nextPx);
        if (nextWidth !== width) {
          setWidth(nextWidth);
        }
      },
      [
        direction,
        enableToggle,
        isCollapsed,
        isCompactState,
        maxPx,
        minPx,
        onKeyDown,
        resizeStep,
        setWidth,
        toggleSidebar,
        width,
      ]
    );

    return (
      // biome-ignore lint/a11y/useSemanticElements: this is the WAI-ARIA window-splitter pattern. The rail must be focusable and keyboard-resizable; a native hr cannot own pointer drag or keyboard resize semantics.
      <button
        aria-label={separatorLabel}
        aria-orientation="vertical"
        aria-valuemax={isCollapsed ? undefined : Math.round(maxPx)}
        aria-valuemin={isCollapsed ? undefined : Math.round(minPx)}
        aria-valuenow={isCollapsed ? undefined : Math.round(currentPx)}
        className={cn(
          "absolute inset-y-0 z-20 w-4 -translate-x-1/2 cursor-col-resize touch-none select-none border-0 bg-transparent p-0 outline-none transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent hover:after:bg-ring/40 focus-visible:after:bg-ring/60",
          side === "left" ? "-right-4" : "left-0",
          className
        )}
        data-resize-direction={direction}
        data-sidebar="rail"
        data-slot="sidebar-rail"
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          if (!event.defaultPrevented) {
            handlePointerDown(event);
          }
        }}
        ref={(node) => {
          dragRef.current = node;
          assignRef(ref, node);
        }}
        role="separator"
        tabIndex={0}
        type="button"
        {...props}
      />
    );
  }
);
SidebarRail.displayName = "SidebarRail";

const SidebarTrigger = forwardRef<
  ElementRef<typeof Button>,
  ComponentProps<typeof Button>
>(({ children, onClick, ...props }, ref) => {
  const { state, toggleSidebar } = useSidebar();

  return (
    <Button
      aria-expanded={state !== "collapsed"}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          toggleSidebar();
        }
      }}
      ref={ref}
      type="button"
      {...props}
    >
      {children ?? <span className="sr-only">Toggle Sidebar</span>}
    </Button>
  );
});
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarInset = forwardRef<HTMLDivElement, ComponentProps<"main">>(
  ({ className, ...props }, ref) => (
    <main
      className={cn(
        "relative flex min-w-0 flex-1 flex-col bg-background",
        className
      )}
      data-slot="sidebar-inset"
      ref={ref}
      {...props}
    />
  )
);
SidebarInset.displayName = "SidebarInset";

const SidebarHeader = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-3 border-border border-b p-3",
        className
      )}
      data-sidebar="header"
      data-slot="sidebar-header"
      ref={ref}
      {...props}
    />
  )
);
SidebarHeader.displayName = "SidebarHeader";

const SidebarContent = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      data-sidebar="content"
      data-slot="sidebar-content"
      ref={ref}
      {...props}
    />
  )
);
SidebarContent.displayName = "SidebarContent";

const SidebarFooter = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-border border-t p-3",
        className
      )}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      ref={ref}
      {...props}
    />
  )
);
SidebarFooter.displayName = "SidebarFooter";

const SidebarGroup = forwardRef<HTMLElement, ComponentProps<"section">>(
  ({ className, ...props }, ref) => (
    <section
      className={cn("flex min-w-0 flex-col gap-2 p-3", className)}
      data-sidebar="group"
      data-slot="sidebar-group"
      ref={ref}
      {...props}
    />
  )
);
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = forwardRef<HTMLHeadingElement, ComponentProps<"h2">>(
  ({ className, ...props }, ref) => (
    <h2
      className={cn("font-medium text-muted-foreground text-xs", className)}
      data-sidebar="group-label"
      data-slot="sidebar-group-label"
      ref={ref}
      {...props}
    />
  )
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarGroupContent = forwardRef<HTMLDivElement, ComponentProps<"div">>(
  ({ className, ...props }, ref) => (
    <div
      className={cn("min-w-0", className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      ref={ref}
      {...props}
    />
  )
);
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = forwardRef<HTMLUListElement, ComponentProps<"ul">>(
  ({ className, ...props }, ref) => (
    <ul
      className={cn("flex min-w-0 flex-col gap-1", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      ref={ref}
      {...props}
    />
  )
);
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = forwardRef<HTMLLIElement, ComponentProps<"li">>(
  ({ className, ...props }, ref) => (
    <li
      className={cn("min-w-0", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      ref={ref}
      {...props}
    />
  )
);
SidebarMenuItem.displayName = "SidebarMenuItem";

const SidebarMenuButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<"button"> & { isActive?: boolean }
>(({ className, isActive = false, ...props }, ref) => (
  <button
    className={cn(
      "flex h-8 w-full min-w-0 items-center gap-2 px-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50",
      isActive && "bg-sidebar-accent text-sidebar-accent-foreground",
      className
    )}
    data-active={isActive || undefined}
    data-sidebar="menu-button"
    data-slot="sidebar-menu-button"
    ref={ref}
    type="button"
    {...props}
  />
));
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuBadge = forwardRef<HTMLSpanElement, ComponentProps<"span">>(
  ({ className, ...props }, ref) => (
    <span
      className={cn(
        "ml-auto shrink-0 text-muted-foreground text-xs",
        className
      )}
      data-sidebar="menu-badge"
      data-slot="sidebar-menu-badge"
      ref={ref}
      {...props}
    />
  )
);
SidebarMenuBadge.displayName = "SidebarMenuBadge";

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
};
