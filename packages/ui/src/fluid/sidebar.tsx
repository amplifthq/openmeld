"use client";

/** Adapted from Fluid Functionalism's Base UI Sidebar (2026-09-05).
 * https://www.fluidfunctionalism.com/r/base/sidebar.json
 * Keeps its offcanvas/peek composition, shared hover intent, pointer capture,
 * drag rescue, edge treatment, and header/content/footer slots. OpenMeld adds
 * the icon snap region, injected persistence, and keyboard resizing. The Web
 * shell owns responsive drawers; this primitive never mounts a second drawer.
 */
import { Tooltip } from "@base-ui/react/tooltip";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ScrollArea } from "#fluid/scroll-area";
import {
  resolveSidebarDrag,
  SIDEBAR_ICON_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarGeometry,
  useSidebar,
} from "#fluid/sidebar-state";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

export function Sidebar({
  children,
  className,
  ...props
}: ComponentProps<"aside">) {
  const {
    state,
    open,
    width,
    isResizing,
    isPeeking,
    setIsPeeking,
    schedulePeek,
    scheduleDismissPeek,
    cancelPeekTimer,
    static: staticPresentation,
  } = useSidebar();
  const shellRef = useRef<HTMLElement>(null);
  const focusWithin = useRef(false);
  const insideEvents = useRef(new WeakSet<Event>());
  const reduceMotion = useReducedMotion();
  const peekEnabled = !(staticPresentation || open || isResizing);

  // React capture reaches owned portals too. A workspace menu can extend past
  // the peek card without being mistaken for an outside press or hover exit.
  useEffect(() => {
    if (!(peekEnabled && isPeeking)) {
      return;
    }
    const outside = (event: PointerEvent) => {
      if (
        !(
          insideEvents.current.has(event) ||
          shellRef.current?.contains(event.target as Node)
        )
      ) {
        setIsPeeking(false);
      }
    };
    const move = (event: PointerEvent) => {
      const panel = shellRef.current?.querySelector('[data-sidebar="panel"]');
      const box = panel?.getBoundingClientRect();
      if (!box) {
        return;
      }
      if (
        insideEvents.current.has(event) ||
        (event.clientX >= box.left - 8 &&
          event.clientX <= box.right + 8 &&
          event.clientY >= box.top - 8 &&
          event.clientY <= box.bottom + 8)
      ) {
        cancelPeekTimer();
      } else if (!focusWithin.current) {
        scheduleDismissPeek();
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setIsPeeking(false);
        shellRef.current
          ?.querySelector<HTMLButtonElement>('[data-sidebar="reveal"]')
          ?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("pointermove", move);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [
    peekEnabled,
    isPeeking,
    cancelPeekTimer,
    scheduleDismissPeek,
    setIsPeeking,
  ]);

  const panelWidth = state === "icon" ? SIDEBAR_ICON_WIDTH : width;
  if (staticPresentation) {
    return (
      <aside
        {...props}
        className={cn(
          "flex h-full min-h-0 w-full flex-col [&_[data-sidebar=group-label]]:min-h-11 [&_[data-sidebar=menu-button]]:min-h-11",
          className
        )}
      >
        {children}
      </aside>
    );
  }
  return (
    <aside
      {...props}
      className={cn(
        "relative h-dvh shrink-0",
        peekEnabled ? "z-40" : "z-20",
        className
      )}
      data-slot="app-outer-rail"
      data-state={state}
      onBlurCapture={(event) => {
        focusWithin.current = false;
        if (peekEnabled && !event.currentTarget.contains(event.relatedTarget)) {
          scheduleDismissPeek();
        }
      }}
      onClickCapture={(event) => {
        props.onClickCapture?.(event);
        if (
          peekEnabled &&
          !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) &&
          (event.target as HTMLElement).closest("a[href]")
        ) {
          setIsPeeking(false);
        }
      }}
      onFocusCapture={(event) => {
        focusWithin.current =
          !!(event.target as HTMLElement).closest('[data-sidebar="panel"]') ||
          !event.currentTarget.contains(event.target);
        cancelPeekTimer();
      }}
      onPointerDownCapture={(event) =>
        insideEvents.current.add(event.nativeEvent)
      }
      onPointerEnter={peekEnabled ? cancelPeekTimer : undefined}
      onPointerLeave={
        peekEnabled
          ? () => {
              if (!isPeeking) {
                cancelPeekTimer();
              }
            }
          : undefined
      }
      onPointerMoveCapture={(event) =>
        insideEvents.current.add(event.nativeEvent)
      }
      ref={shellRef}
      style={{
        width: open ? panelWidth : 0,
        transition:
          reduceMotion || isResizing ? "none" : "width 180ms ease-out",
      }}
    >
      {peekEnabled && (
        <>
          <button
            aria-expanded={isPeeking}
            aria-label="Peek sidebar"
            className="group/peek-strip absolute inset-y-2 left-0 z-40 w-2 cursor-pointer outline-none"
            data-sidebar="reveal"
            onClick={() => setIsPeeking(true)}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") {
                schedulePeek();
              }
            }}
            type="button"
          >
            <span className="absolute inset-y-0 left-0 w-px bg-foreground/25 opacity-0 group-hover/peek-strip:opacity-100 group-focus-visible/peek-strip:opacity-100" />
          </button>
          <SidebarTrigger
            className="fixed bottom-[calc((var(--app-toolbar-height,2.25rem)-1.75rem)/2)] left-2 z-40 size-7 transition-[bottom] duration-180 ease-out motion-reduce:transition-none"
            data-sidebar="restore"
          />
        </>
      )}

      <motion.div
        animate={{
          transform: open || isPeeking ? "translateX(0%)" : "translateX(-100%)",
        }}
        aria-hidden={!(open || isPeeking)}
        className={cn(
          "absolute inset-y-0 left-0 flex min-h-0 flex-col",
          isPeeking &&
            "top-2 bottom-9 rounded-md bg-popover shadow-lg ring-1 ring-foreground/10"
        )}
        data-sidebar="panel"
        inert={open || isPeeking ? undefined : true}
        initial={false}
        key="panel"
        style={{ width: panelWidth }}
        transition={
          reduceMotion || isResizing ? { duration: 0 } : springs.moderate
        }
      >
        {open || isPeeking ? children : null}
      </motion.div>

      <SidebarRail hiddenEdge={!open} />
    </aside>
  );
}

export function SidebarTrigger({
  className,
  children,
  onClick,
  ...props
}: ComponentProps<"button">) {
  const { state, toggleSidebar, schedulePeek, cancelPeekTimer, isPeeking } =
    useSidebar();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            {...props}
            aria-expanded={state === "expanded"}
            aria-label={state === "expanded" ? "Hide sidebar" : "Show sidebar"}
            className={cn(
              "flex items-center justify-center rounded-md text-sidebar-foreground/60 outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring",
              className
            )}
            onClick={(event) => {
              onClick?.(event);
              if (!event.defaultPrevented) {
                toggleSidebar();
              }
            }}
            onPointerEnter={(event) => {
              if (state === "hidden" && event.pointerType === "mouse") {
                schedulePeek();
              }
            }}
            onPointerLeave={() => {
              if (!isPeeking) {
                cancelPeekTimer();
              }
            }}
            type="button"
          />
        }
      >
        {children ?? <SidebarSimpleIcon className="size-4" />}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner className="z-50" side="right" sideOffset={8}>
          <Tooltip.Popup className="rounded-md bg-foreground px-2 py-1 text-background text-xs">
            {state === "expanded" ? "Hide sidebar" : "Show sidebar"}{" "}
            <kbd className="ml-1">[</kbd>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function SidebarRail({ hiddenEdge }: { hiddenEdge: boolean }) {
  const {
    state,
    widthPx,
    setGeometry,
    toggleSidebar,
    isResizing,
    static: staticPresentation,
    setIsPeeking,
    cancelPeekTimer,
  } = useSidebar();
  const railRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    moved: boolean;
    geometry: SidebarGeometry;
  } | null>(null);
  const [cursorY, setCursorY] = useState<number | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return;
    }
    cancelPeekTimer();
    dragRef.current = {
      startX: event.clientX,
      startWidth: getSidebarLayoutWidth(state, widthPx),
      moved: false,
      geometry: { mode: state, width: widthPx },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    setCursorY(event.clientY);
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 4) {
      return;
    }
    drag.moved = true;
    setIsPeeking(false);
    const raw = drag.startWidth + dx;
    const mode = resolveSidebarDrag(raw, drag.geometry.mode);
    drag.geometry = {
      mode,
      width:
        mode === "expanded"
          ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, raw))
          : drag.geometry.width,
    };
    setGeometry(drag.geometry, false);
  };
  const finish = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false
  ) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag) {
      return;
    }
    if (drag.moved) {
      setGeometry(drag.geometry);
    } else if (!cancelled) {
      toggleSidebar();
    }
  };
  if (staticPresentation) {
    return null;
  }
  const appliedWidth = getSidebarLayoutWidth(state, widthPx);
  const modeLabel = state === "hidden" ? "Hidden" : "Icons only";
  const anchor = {
    getBoundingClientRect: () => {
      const box = railRef.current?.getBoundingClientRect();
      return new DOMRect(box?.right ?? 0, cursorY ?? box?.top ?? 0, 0, 0);
    },
  };
  return (
    <Tooltip.Root
      onOpenChange={setTooltipOpen}
      open={!(isResizing || hiddenEdge) && tooltipOpen}
    >
      <Tooltip.Trigger
        render={
          // biome-ignore lint/a11y/useSemanticElements: An adjustable splitter needs keyboard and pointer input; hr is not interactive.
          <button
            aria-label="Resize app sidebar"
            aria-orientation="vertical"
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            aria-valuemin={0}
            aria-valuenow={appliedWidth}
            aria-valuetext={
              state === "expanded" ? `${Math.round(widthPx)} pixels` : modeLabel
            }
            className={cn(
              "absolute top-4 -right-1 bottom-14 z-50 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent hover:after:bg-foreground/25 focus-visible:after:bg-sidebar-ring after:[mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%-24px),transparent)]",
              hiddenEdge && "right-auto left-0 w-1"
            )}
            data-sidebar="rail"
            onKeyDown={(event) => {
              const next = resolveSidebarKey(event.key, {
                mode: state,
                width: widthPx,
              });
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleSidebar();
              }
              if (next) {
                event.preventDefault();
                setGeometry(next);
              }
            }}
            onLostPointerCapture={(event) => finish(event, true)}
            onPointerCancel={(event) => finish(event, true)}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={(event) => finish(event)}
            ref={railRef}
            role="separator"
            type="button"
          />
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner
          anchor={anchor}
          className="pointer-events-none z-50"
          side="right"
          sideOffset={8}
        >
          <Tooltip.Popup className="flex flex-col gap-1 rounded-md bg-foreground px-3 py-2 text-background text-xs shadow-sm">
            <span>Drag to resize</span>
            <span>
              Click to {state === "expanded" ? "collapse" : "expand"}{" "}
              <kbd className="ml-1 rounded-sm border border-background/30 px-1">
                [
              </kbd>
            </span>
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("flex shrink-0 flex-col gap-2 p-2", className)}
      data-sidebar="header"
    />
  );
}

function getSidebarLayoutWidth(state: SidebarGeometry["mode"], width: number) {
  if (state === "hidden") {
    return 0;
  }
  return state === "icon" ? SIDEBAR_ICON_WIDTH : width;
}

export function resolveSidebarKey(
  key: string,
  geometry: SidebarGeometry
): SidebarGeometry | undefined {
  const { mode, width } = geometry;
  switch (key) {
    case "Home":
      return { mode: "hidden", width };
    case "End":
      return { mode: "expanded", width: SIDEBAR_MAX_WIDTH };
    case "ArrowLeft":
      if (mode === "expanded" && width > SIDEBAR_MIN_WIDTH) {
        return { mode, width: Math.max(SIDEBAR_MIN_WIDTH, width - 16) };
      }
      return { mode: mode === "expanded" ? "icon" : "hidden", width };
    case "ArrowRight":
      return {
        mode: mode === "hidden" ? "icon" : "expanded",
        width:
          mode === "expanded" ? Math.min(SIDEBAR_MAX_WIDTH, width + 16) : width,
      };
    default:
      return undefined;
  }
}
export function SidebarFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn("mt-auto flex shrink-0 flex-col gap-2 p-2", className)}
      data-sidebar="footer"
    />
  );
}
export function SidebarContent({
  className,
  contentClassName,
  ...props
}: ComponentProps<typeof ScrollArea>) {
  return (
    <ScrollArea
      {...props}
      className={cn("min-h-0 min-w-0 flex-1", className)}
      contentClassName={cn("flex min-h-full flex-col", contentClassName)}
      data-sidebar="content"
    />
  );
}
