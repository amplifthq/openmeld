"use client";

import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type SidebarMode = "hidden" | "icon" | "expanded";
export type SidebarGeometry = { mode: SidebarMode; width: number };
export const SIDEBAR_ICON_WIDTH = 52;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 384;

/** Three snap regions with hysteresis: reversing at a seam must not chatter. */
export function resolveSidebarDrag(
  raw: number,
  previous: SidebarMode
): SidebarMode {
  if (raw < (previous === "hidden" ? 38 : 26)) {
    return "hidden";
  }
  if (raw < (previous === "expanded" ? 112 : 132)) {
    return "icon";
  }
  return "expanded";
}

type SidebarContextValue = {
  state: SidebarMode;
  open: boolean;
  width: string;
  widthPx: number;
  setGeometry: (geometry: SidebarGeometry, commit?: boolean) => void;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  isResizing: boolean;
  isPeeking: boolean;
  setIsPeeking: (peeking: boolean) => void;
  schedulePeek: () => void;
  scheduleDismissPeek: () => void;
  cancelPeekTimer: () => void;
  static: boolean;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error("useSidebar must be used within SidebarProvider.");
  }
  return value;
}

export function SidebarProvider({
  children,
  geometry,
  onGeometryChange,
  static: staticPresentation = false,
  ...props
}: Omit<ComponentProps<"div">, "onChange"> & {
  children: ReactNode;
  geometry: SidebarGeometry;
  onGeometryChange: (geometry: SidebarGeometry) => void;
  static?: boolean;
}) {
  const [dragGeometry, setDragGeometry] = useState<SidebarGeometry | null>(
    null
  );
  const current = dragGeometry ?? geometry;
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const [isPeeking, setPeeking] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerIntent = useRef<"open" | "close" | null>(null);
  const cancelPeekTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = null;
    timerIntent.current = null;
  }, []);
  const setIsPeeking = useCallback(
    (next: boolean) => {
      cancelPeekTimer();
      setPeeking(next);
    },
    [cancelPeekTimer]
  );
  const schedulePeek = useCallback(() => {
    if (timerIntent.current === "open") {
      return;
    }
    cancelPeekTimer();
    timerIntent.current = "open";
    timer.current = setTimeout(() => setPeeking(true), 150);
  }, [cancelPeekTimer]);
  const scheduleDismissPeek = useCallback(() => {
    if (timerIntent.current === "close") {
      return;
    }
    cancelPeekTimer();
    timerIntent.current = "close";
    timer.current = setTimeout(() => setPeeking(false), 250);
  }, [cancelPeekTimer]);
  useEffect(() => cancelPeekTimer, [cancelPeekTimer]);
  const setGeometry = useCallback(
    (next: SidebarGeometry, commit = true) => {
      currentRef.current = next;
      if (commit) {
        setDragGeometry(null);
        onGeometryChange(next);
      } else {
        setDragGeometry(next);
      }
    },
    [onGeometryChange]
  );
  const setOpen = useCallback(
    (open: boolean) => {
      setIsPeeking(false);
      setGeometry({
        ...currentRef.current,
        mode: open ? "expanded" : "hidden",
      });
    },
    [setGeometry, setIsPeeking]
  );
  const toggleSidebar = useCallback(
    () => setOpen(currentRef.current.mode !== "expanded"),
    [setOpen]
  );

  useEffect(() => {
    if (staticPresentation || props.inert) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !window.matchMedia("(min-width: 64rem)").matches
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          "input,textarea,select,[contenteditable=true],[role=textbox]"
        )
      ) {
        return;
      }
      if (
        (event.key === "[" &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey) ||
        (event.key.toLowerCase() === "b" &&
          (event.metaKey || event.ctrlKey) &&
          !event.altKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [staticPresentation, props.inert, toggleSidebar]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      state: current.mode,
      open: current.mode !== "hidden",
      width: `${current.width}px`,
      widthPx: current.width,
      setGeometry,
      setOpen,
      toggleSidebar,
      isResizing: dragGeometry !== null,
      isPeeking: current.mode === "hidden" && isPeeking,
      setIsPeeking,
      schedulePeek,
      scheduleDismissPeek,
      cancelPeekTimer,
      static: staticPresentation,
    }),
    [
      current,
      setGeometry,
      setOpen,
      toggleSidebar,
      dragGeometry,
      isPeeking,
      setIsPeeking,
      schedulePeek,
      scheduleDismissPeek,
      cancelPeekTimer,
      staticPresentation,
    ]
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        {...props}
        className={
          staticPresentation
            ? "contents"
            : "group/main-sidebar relative shrink-0"
        }
        data-main-sidebar-mode={current.mode}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}
