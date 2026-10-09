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
import { matchesSidebarShortcut } from "../lib/application-shortcuts";

export type SidebarMode = "hidden" | "icon" | "expanded";
export type SidebarGeometry = { mode: SidebarMode; width: number };
export const SIDEBAR_ICON_WIDTH = 52;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 384;
export type SidebarResizeOptions = {
  allowIconMode?: boolean;
  minWidth?: number;
  maxWidth?: number;
};

/** Resolve allowed snap regions with hysteresis at their boundaries. */
export function resolveSidebarDrag(
  raw: number,
  previous: SidebarMode,
  {
    allowIconMode = true,
    minWidth = SIDEBAR_MIN_WIDTH,
  }: SidebarResizeOptions = {}
): SidebarMode {
  if (!allowIconMode) {
    // Keep expanded content readable; a small return deadband prevents chatter.
    return raw < minWidth + (previous === "hidden" ? 8 : 0)
      ? "hidden"
      : "expanded";
  }
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
  peekOnHover: boolean;
  allowIconMode: boolean;
  minWidth: number;
  maxWidth: number;
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
  peekOnHover = true,
  keyboardShortcuts = true,
  allowIconMode = true,
  minWidth = SIDEBAR_MIN_WIDTH,
  maxWidth = SIDEBAR_MAX_WIDTH,
  ...props
}: Omit<ComponentProps<"div">, "onChange"> & {
  children: ReactNode;
  geometry: SidebarGeometry;
  onGeometryChange: (geometry: SidebarGeometry) => void;
  static?: boolean;
  peekOnHover?: boolean;
  keyboardShortcuts?: boolean;
} & SidebarResizeOptions) {
  const [dragGeometry, setDragGeometry] = useState<SidebarGeometry | null>(
    null
  );
  const normalizeGeometry = useCallback(
    (next: SidebarGeometry): SidebarGeometry => ({
      mode: !allowIconMode && next.mode === "icon" ? "hidden" : next.mode,
      width: Math.max(minWidth, Math.min(maxWidth, next.width)),
    }),
    [allowIconMode, minWidth, maxWidth]
  );
  const current = useMemo(
    () => normalizeGeometry(dragGeometry ?? geometry),
    [dragGeometry, geometry, normalizeGeometry]
  );
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
    if (!peekOnHover) {
      return;
    }
    if (timerIntent.current === "open") {
      return;
    }
    cancelPeekTimer();
    timerIntent.current = "open";
    timer.current = setTimeout(() => setPeeking(true), 150);
  }, [cancelPeekTimer, peekOnHover]);
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
      const normalized = normalizeGeometry(next);
      currentRef.current = normalized;
      if (commit) {
        setDragGeometry(null);
        onGeometryChange(normalized);
      } else {
        setDragGeometry(normalized);
      }
    },
    [onGeometryChange, normalizeGeometry]
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
    if (staticPresentation || props.inert || !keyboardShortcuts) {
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
      if (matchesSidebarShortcut(event)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [staticPresentation, props.inert, toggleSidebar, keyboardShortcuts]);

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
      isPeeking: peekOnHover && current.mode === "hidden" && isPeeking,
      setIsPeeking,
      schedulePeek,
      scheduleDismissPeek,
      cancelPeekTimer,
      static: staticPresentation,
      peekOnHover,
      allowIconMode,
      minWidth,
      maxWidth,
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
      peekOnHover,
      allowIconMode,
      minWidth,
      maxWidth,
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
