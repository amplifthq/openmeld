"use client";

// Fluid Functionalism Sidebar menu, Base UI registry, retrieved 2026-09-05.
// https://www.fluidfunctionalism.com/r/base/sidebar.json
// OpenMeld adapts tokens, icons, proximity measurement and reduced motion.

import type { Icon as IconComponent } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  Children,
  type CSSProperties,
  createContext,
  forwardRef,
  type HTMLAttributes,
  type LiHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FluidHoverHighlight } from "#fluid/fluid-hover-highlight";
import { resolveSlotTemplate, slotElement } from "#fluid/sidebar-group";
import { type ItemRect, useFluidHover } from "#hooks/use-fluid-hover";
import { createActiveItemStore } from "#lib/active-item-store";
import { fontWeights } from "#lib/font-weight";
import { useShape } from "#lib/shape-context";
import { springs as spring } from "#lib/springs";
import { cn } from "#lib/utils";

// SSR-safe layout effect (client components still server-render in Next).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// ─── Menu scope ──────────────────────────────────────────────────────────────
//
// One scope per SidebarMenu tree: a single proximity-hover system plus the
// traveling overlays — hover background, active background(s), focus ring —
// that glide between every visible row, sub-menu rows included, so the hover
// moves from a parent into its children as one continuous piece. Sub rows
// live inside positioned ancestors, so their rects are accumulated into the
// menu's own coordinate space by the proximity hook. The active background
// stays one per level (the root rows, and each sub-menu) so a current section
// and the current page inside it can both be lit, exactly as before.

type MenuAppearance = {
  /** Use both coordinates for compact grids of navigation targets. */
  hoverAxis?: "x" | "y" | "xy";
  hoverMaxDistance?: number;
  activeIndicatorClassName?: string;
  hoverIndicatorClassName?: string;
  focusIndicatorClassName?: string;
  /** Keep the full row interactive while drawing its indicators around a child. */
  indicatorTargetSelector?: string;
};

type MenuScopeValue = {
  activeIndicatorClassName?: string;
  activeLayoutId?: string;
  registerRow: (el: HTMLElement) => () => void;
  setRowButton: (row: HTMLElement, button: HTMLElement | null) => void;
  setRowActive: (row: HTMLElement, active: boolean) => void;
  hoverStore: ReturnType<typeof createRowHoverStore>;
  /** Every visible active row, in DOM order — a parent section marker and
   *  the current row inside its sub-tree can be active at once. */
  activeRows: HTMLElement[];
  firstRowEl: HTMLElement | null;
  hasActive: boolean;
  /** A sub-menu toggled: rows changed visibility in place, so hover targets
   *  and the visible active set must be recomputed. */
  refreshVisibility: () => void;
};

const MenuScopeContext = createContext<MenuScopeValue | null>(null);

const createRowHoverStore = createActiveItemStore<HTMLElement>;

const NO_HOVER_STORE = createRowHoverStore();
const getServerHover = () => false;

type MenuItemContextValue = {
  rowRef: RefObject<HTMLLIElement | null>;
  /** Ref callback for the row's <li> — also replays the row's active flag
   *  to the scope, covering the windows where the ref is detached. */
  attachRow: (node: HTMLLIElement | null) => void;
  isHovered: boolean;
  isActiveRow: boolean;
  /** True inside SidebarMenuSubItem — actions center on the shorter row. */
  isSubRow: boolean;
  setActive: (active: boolean) => void;
  setButtonEl: (el: HTMLElement | null) => void;
  /** Trailing controls on this row, registered by the action / badge parts.
   *  The button turns them into an exact padding-right reservation. */
  actionCount: number;
  actionsShowOnHover: boolean;
  hasBadge: boolean;
  setActions: (count: number, showOnHover: boolean) => void;
  setHasBadge: (hasBadge: boolean) => void;
};

const MenuItemContext = createContext<MenuItemContextValue | null>(null);

/** True while rendering inside a SidebarMenuActions cluster, where each
 *  action flows in the wrapper's row instead of positioning itself. */
const MenuActionsClusterContext = createContext(false);

/** True while the element sits inside a collapsed sub-tree — clipped away,
 *  so it must be invisible to hover, highlights, and keyboard order. Rows
 *  stay registered either way: unregistering on every toggle would churn the
 *  proximity measurements and blink the overlays. */
function rowHidden(el: HTMLElement) {
  return el.closest('[data-sidebar="menu-sub"][data-state="closed"]') !== null;
}

/** Stable keys for the per-level active overlays: one id per sub-menu <ul>
 *  (or the menu root), so the active background glides when the active row
 *  moves within its level instead of remounting. */
let overlayGroupSeq = 0;
const overlayGroupIds = new WeakMap<Element, number>();
function overlayGroupId(el: Element) {
  let id = overlayGroupIds.get(el);
  if (id === undefined) {
    id = ++overlayGroupSeq;
    overlayGroupIds.set(el, id);
  }
  return id;
}

function byDomOrder(a: HTMLElement, b: HTMLElement) {
  // biome-ignore lint/suspicious/noBitwiseOperators: DOM position is a platform bitmask.
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

function sameElements(a: HTMLElement[], b: HTMLElement[]) {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

type MenuScope = {
  value: MenuScopeValue;
  containerProps: {
    onMouseEnter: (e: React.MouseEvent) => void;
    onMouseMove: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
    onFocus: (e: React.FocusEvent) => void;
    onBlur: (e: React.FocusEvent) => void;
    onPointerDown: () => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  };
  overlays: ReactNode;
};

function useMenuScope(
  containerRef: RefObject<HTMLElement | null>,
  activeLayoutId?: string,
  {
    activeIndicatorClassName,
    hoverIndicatorClassName,
    focusIndicatorClassName,
    indicatorTargetSelector,
    hoverAxis = "y",
    hoverMaxDistance,
  }: MenuAppearance = {}
): MenuScope {
  const reduceMotion = useReducedMotion();
  const {
    activeIndex,
    setActiveIndex,
    itemRects,
    sessionRef,
    handlers,
    registerItem,
    isMeasured,
  } = useFluidHover(containerRef, {
    axis: hoverAxis,
    maxDistance: hoverMaxDistance,
    gapClick: false,
    isItemDisabled: rowHidden,
  });
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const [hoverStore] = useState(createRowHoverStore);

  const rowsRef = useRef<Set<HTMLElement>>(new Set());
  const rowButtonsRef = useRef<Map<HTMLElement, HTMLElement>>(new Map());
  const activeMapRef = useRef<Map<HTMLElement, boolean>>(new Map());
  const [orderedRows, setOrderedRows] = useState<HTMLElement[]>([]);
  const orderedRowsRef = useRef(orderedRows);
  const registeredCountRef = useRef(0);
  const rowsDirtyRef = useRef(false);
  const [activeRows, setActiveRows] = useState<HTMLElement[]>([]);
  const [focusedRowEl, setFocusedRowEl] = useState<HTMLElement | null>(null);

  const recomputeActive = useCallback(() => {
    if (rowsDirtyRef.current) {
      return;
    }
    const next = orderedRowsRef.current.filter(
      (el) => activeMapRef.current.get(el) && !rowHidden(el)
    );
    setActiveRows((prev) => (sameElements(prev, next) ? prev : next));
  }, []);

  const rowButton = useCallback(
    (row: HTMLElement) =>
      rowButtonsRef.current.get(row) ??
      row.querySelector<HTMLElement>(
        ':scope > [data-sidebar="menu-button"], :scope > [data-sidebar="menu-sub-button"]'
      ),
    []
  );

  // Rows register by element; indexes are derived from DOM order so consumers
  // never pass an index prop and conditional rows just work. The proximity
  // system measures the row's BUTTON, not the <li>: a row hosting an expanded
  // sub-tree is a tall <li>, and hit-testing against that whole box would hand
  // the sub-tree's gaps and gutter to the parent — the button strip is the
  // only part that is really "the row".
  const flushRows = useCallback(() => {
    if (!rowsDirtyRef.current) {
      return;
    }
    rowsDirtyRef.current = false;
    const sorted = [...rowsRef.current].sort(byDomOrder);
    // Publish the complete order before resolving this commit's active rows.
    orderedRowsRef.current = sorted;
    setOrderedRows((prev) => (sameElements(prev, sorted) ? prev : sorted));
    sorted.forEach((el, i) => {
      registerItem(
        i,
        el.getAttribute("aria-disabled") === "true"
          ? null
          : (rowButton(el) ?? el)
      );
    });
    for (let i = sorted.length; i < registeredCountRef.current; i++) {
      registerItem(i, null);
    }
    registeredCountRef.current = sorted.length;
    recomputeActive();
  }, [registerItem, recomputeActive, rowButton]);

  // Ref and layout-effect registrations arrive together during a commit.
  // Sort that complete set once, before paint, instead of sorting every
  // growing prefix and re-registering every preceding row for each new row.
  const syncRows = useCallback(() => {
    if (rowsDirtyRef.current) {
      return;
    }
    rowsDirtyRef.current = true;
    queueMicrotask(() => {
      if (containerRef.current) {
        flushRows();
      }
    });
  }, [containerRef, flushRows]);

  // The usual mount/update can finish in this same layout phase. The
  // microtask also covers a row-only commit that did not render its scope.
  useIsoLayoutEffect(flushRows);

  const registerRow = useCallback(
    (el: HTMLElement) => {
      rowsRef.current.add(el);
      syncRows();
      return () => {
        rowsRef.current.delete(el);
        rowButtonsRef.current.delete(el);
        activeMapRef.current.delete(el);
        syncRows();
      };
    },
    [syncRows]
  );

  const setRowButton = useCallback(
    (row: HTMLElement, button: HTMLElement | null) => {
      if (button) {
        rowButtonsRef.current.set(row, button);
      } else {
        rowButtonsRef.current.delete(row);
      }
      // The button is the row's measured element, so a button arriving after
      // its row registered must re-sync what the proximity system observes.
      syncRows();
    },
    [syncRows]
  );

  const setRowActive = useCallback(
    (row: HTMLElement, active: boolean) => {
      activeMapRef.current.set(row, active);
      recomputeActive();
    },
    [recomputeActive]
  );

  const refreshVisibility = useCallback(() => {
    recomputeActive();
    // A hover riding a row that just collapsed away has nothing under it.
    const row =
      activeIndexRef.current !== null
        ? orderedRowsRef.current[activeIndexRef.current]
        : undefined;
    if (row && rowHidden(row)) {
      setActiveIndex(null);
    }
  }, [recomputeActive, setActiveIndex]);

  // A row's rect spans the whole <li> — which grows when it hosts an expanded
  // sub-menu — so overlay heights are clamped to the row's button box. The
  // 48px fallback (the tallest row, size="lg") guarantees the highlight can
  // never cover an expanded sub-tree even if the button lookup misses.
  const overlayRect = useCallback(
    (row: HTMLElement | null): ItemRect | null => {
      if (!row) {
        return null;
      }
      const idx = orderedRowsRef.current.indexOf(row);
      const rect = idx === -1 ? null : itemRects[idx];
      if (!rect) {
        return null;
      }
      if (indicatorTargetSelector) {
        const button = rowButton(row);
        const target = button?.querySelector<HTMLElement>(
          indicatorTargetSelector
        );
        if (button && target) {
          const buttonBounds = button.getBoundingClientRect();
          const targetBounds = target.getBoundingClientRect();
          return {
            left: rect.left + targetBounds.left - buttonBounds.left,
            top: rect.top + targetBounds.top - buttonBounds.top,
            width: targetBounds.width,
            height: targetBounds.height,
          };
        }
      }
      const height = row.hasAttribute("data-fluid-nav-value")
        ? rect.height
        : Math.min(rect.height, rowButton(row)?.offsetHeight ?? 48);
      return { ...rect, height };
    },
    [indicatorTargetSelector, itemRects, rowButton]
  );

  // While a popup anchored in the sidebar is open (a row action's or the
  // header/footer rows' dropdown), hover tracking freezes across every menu
  // scope — otherwise a non-modal popup lets rows underneath keep
  // highlighting. Popup triggers are detected by the primitives' open
  // attributes (Radix data-state, Base UI data-popup-open). Require a popup
  // trigger: tooltips also publish data-popup-open, but must not freeze the
  // traveling background. Context-menu areas have no aria-haspopup, so use
  // their explicit state when available: a composed tooltip can also put
  // data-popup-open on the same element while the context menu is closed.
  // Hover previews explicitly opt out: their appearance or exit fade must
  // not freeze navigation as the pointer continues across sibling entries.
  const popupOpen = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return false;
    }
    const root = container.closest('[data-sidebar="panel"]') ?? container;
    return !!root.querySelector(
      '[aria-haspopup]:not([aria-haspopup="false"]):not([data-sidebar-hover-preview]):is([data-popup-open], [data-state="open"], [aria-expanded="true"]), [data-context-menu-open="true"], [data-slot="context-menu-trigger"]:not([data-context-menu-open])[data-popup-open]'
    );
  }, [containerRef]);

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node) || popupOpen()) {
        return;
      }
      handlers.onMouseMove(e);
    },
    [containerRef, popupOpen, handlers]
  );

  const onFocus = useCallback(
    (e: React.FocusEvent) => {
      const target = e.target as HTMLElement;
      // Only the row's main button drives the traveling highlight and ring —
      // actions keep their own static focus rings.
      if (
        !target.closest(
          '[data-sidebar="menu-button"],[data-sidebar="menu-sub-button"],[data-fluid-nav-value]'
        )
      ) {
        return;
      }
      const row = target.closest(
        '[data-sidebar="menu-item"],[data-sidebar="menu-sub-item"]'
      ) as HTMLElement | null;
      if (!row) {
        return;
      }
      const idx = orderedRowsRef.current.indexOf(row);
      if (idx === -1) {
        return;
      }
      setActiveIndex(idx);
      setFocusedRowEl(target.matches(":focus-visible") ? row : null);
    },
    [setActiveIndex]
  );

  const onPointerDown = useCallback(() => {
    setFocusedRowEl(null);
  }, []);

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      if (containerRef.current?.contains(e.relatedTarget as Node)) {
        return;
      }
      setFocusedRowEl(null);
      setActiveIndex(null);
    },
    [containerRef, setActiveIndex]
  );

  // Arrow/Home/End over every button in DOM order, sub rows included — only
  // the root scope binds it so nested scopes don't double-handle.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (
        ![
          "ArrowDown",
          "ArrowUp",
          "ArrowRight",
          "ArrowLeft",
          "Home",
          "End",
        ].includes(e.key)
      ) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(
          '[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]'
        )
      ).filter(
        (el) => !el.closest('[data-sidebar="menu-sub"][data-state="closed"]')
      );
      const currentIdx = items.indexOf(e.target as HTMLElement);
      if (currentIdx === -1) {
        return;
      }
      e.preventDefault();
      // Keep handled arrows from also reaching window-level listeners (the
      // docs site's ←/→ page navigation) — same rule as AskUserQuestions.
      e.stopPropagation();
      if (e.key === "Home") {
        items[0]?.focus();
      } else if (e.key === "End") {
        items.at(-1)?.focus();
      } else {
        const next = ["ArrowDown", "ArrowRight"].includes(e.key)
          ? (currentIdx + 1) % items.length
          : (currentIdx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    },
    [containerRef]
  );

  const hoveredRowEl =
    activeIndex !== null ? (orderedRows[activeIndex] ?? null) : null;

  useIsoLayoutEffect(() => {
    hoverStore.set(hoveredRowEl);
  }, [hoverStore, hoveredRowEl]);

  const value = useMemo<MenuScopeValue>(
    () => ({
      activeLayoutId,
      activeIndicatorClassName,
      registerRow,
      setRowButton,
      setRowActive,
      hoverStore,
      activeRows,
      firstRowEl: orderedRows[0] ?? null,
      hasActive: activeRows.length > 0,
      refreshVisibility,
    }),
    [
      activeLayoutId,
      activeIndicatorClassName,
      registerRow,
      setRowButton,
      setRowActive,
      hoverStore,
      activeRows,
      orderedRows,
      refreshVisibility,
    ]
  );

  const shape = useShape();
  // Every active row gets its own background — the buttons' own text styling
  // already lights each active row, so the overlays must match. Keys are the
  // row's level (root, or its sub-menu) plus its occurrence within that
  // level: the usual case — one active per level, e.g. a current section
  // marker plus the current page inside its sub-tree — keeps a stable key,
  // so the background GLIDES when the selection moves instead of remounting.
  const rowLevel = useCallback(
    (row: HTMLElement) =>
      row.closest('[data-sidebar="menu-sub"]') ?? containerRef.current,
    [containerRef]
  );
  // A rect change has two causes with two right answers. The highlight moving
  // to a DIFFERENT row springs — that's the glide. The same row itself moving
  // — a sibling sub-tree collapsing above reflows every row below on every
  // frame of its own spring — must snap, or the overlay chases the row it is
  // sitting on with a trailing second spring. Targets are compared against
  // the previous COMMIT (the effect below), not the previous render, so
  // strict mode's double render can't eat a genuine row change.
  const prevTargetsRef = useRef<{
    hover: HTMLElement | null;
    hoverRect: ItemRect | null;
    focus: HTMLElement | null;
    actives: Map<string, HTMLElement>;
  }>({ hover: null, hoverRect: null, focus: null, actives: new Map() });

  const levelOccurrence = new Map<number, number>();
  const activeRects: {
    key: string;
    rect: ItemRect;
    row: HTMLElement;
    rowChanged: boolean;
  }[] = [];
  for (const row of activeRows) {
    const level = rowLevel(row);
    if (!level) {
      continue;
    }
    const levelId = overlayGroupId(level);
    const occurrence = levelOccurrence.get(levelId) ?? 0;
    levelOccurrence.set(levelId, occurrence + 1);
    const rect = overlayRect(row);
    if (rect) {
      activeRects.push({
        key: `${levelId}:${occurrence}`,
        rect,
        row,
        rowChanged:
          prevTargetsRef.current.actives.get(`${levelId}:${occurrence}`) !==
          row,
      });
    }
  }
  const hoverRect = overlayRect(hoveredRowEl);
  const focusRect = overlayRect(focusedRowEl);
  const hoverRowChanged = prevTargetsRef.current.hover !== hoveredRowEl;
  const previousHoverRect = prevTargetsRef.current.hoverRect;
  const hoverRowReflowed =
    !hoverRowChanged &&
    previousHoverRect &&
    hoverRect &&
    (previousHoverRect.top !== hoverRect.top ||
      previousHoverRect.left !== hoverRect.left ||
      previousHoverRect.width !== hoverRect.width ||
      previousHoverRect.height !== hoverRect.height);
  const focusRowChanged = prevTargetsRef.current.focus !== focusedRowEl;

  useIsoLayoutEffect(() => {
    prevTargetsRef.current = {
      hover: hoveredRowEl,
      hoverRect,
      focus: focusedRowEl,
      actives: new Map(activeRects.map(({ key, row }) => [key, row])),
    };
  });

  const overlays = isMeasured ? (
    <>
      {/* Active row backgrounds — one per active row (see activeRects above) */}
      <AnimatePresence>
        {!activeLayoutId &&
          activeRects.map(({ key, rect, rowChanged }) => (
            <motion.div
              animate={{
                y: rect.top,
                x: rect.left,
                opacity: 1,
              }}
              className={cn(
                `absolute top-0 left-0 ${shape.bg} pointer-events-none bg-interaction-active`,
                activeIndicatorClassName
              )}
              exit={{
                opacity: 0,
                transition: reduceMotion ? { duration: 0 } : spring.moderate,
              }}
              initial={false}
              key={key}
              style={{ width: rect.width, height: rect.height }}
              transition={
                !reduceMotion && rowChanged
                  ? { ...spring.moderate, opacity: { duration: 0.08 } }
                  : { duration: 0 }
              }
            />
          ))}
      </AnimatePresence>

      {/* Hover background */}
      <FluidHoverHighlight
        className={cn(shape.bg, hoverIndicatorClassName)}
        rect={hoverRect}
        session={sessionRef.current}
        transition={hoverRowReflowed ? false : undefined}
      />

      {/* Focus ring */}
      <AnimatePresence>
        {focusRect && (
          <motion.div
            animate={{
              x: focusRect.left - 2,
              y: focusRect.top - 2,
            }}
            className={cn(
              `absolute top-0 left-0 ${shape.focusRing} pointer-events-none z-20 border border-[color:var(--sidebar-ring)]`,
              focusIndicatorClassName
            )}
            exit={{
              opacity: 0,
              transition: reduceMotion ? { duration: 0 } : spring.fast,
            }}
            initial={false}
            style={{ width: focusRect.width + 4, height: focusRect.height + 4 }}
            transition={
              !reduceMotion && focusRowChanged
                ? { ...spring.fast, opacity: { duration: 0.08 } }
                : { duration: 0 }
            }
          />
        )}
      </AnimatePresence>
    </>
  ) : null;

  return {
    value,
    containerProps: {
      onMouseEnter: (event) => {
        if (containerRef.current?.contains(event.target as Node)) {
          handlers.onMouseEnter();
        }
      },
      onMouseMove,
      onMouseLeave: (event) => {
        if (containerRef.current?.contains(event.target as Node)) {
          handlers.onMouseLeave();
        }
      },
      onFocus,
      onBlur,
      // Pointer interaction switches modality back to pointer. Clicking the
      // already-focused row never re-fires focus, so without this the
      // keyboard ring would stick until focus left the menu.
      onPointerDown,
      onKeyDown,
    },
    overlays,
  };
}

// ─── SidebarMenu ─────────────────────────────────────────────────────────────

export interface SidebarMenuProps
  extends HTMLAttributes<HTMLUListElement>,
    MenuAppearance {
  /** Shared selection identity for menus that remount across page navigation. */
  activeLayoutId?: string;
}

const SidebarMenu = forwardRef<HTMLUListElement, SidebarMenuProps>(
  (
    {
      className,
      children,
      activeLayoutId,
      activeIndicatorClassName,
      hoverIndicatorClassName,
      focusIndicatorClassName,
      indicatorTargetSelector,
      hoverAxis,
      hoverMaxDistance,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLUListElement>(null);
    const { value, containerProps, overlays } = useMenuScope(
      containerRef,
      activeLayoutId,
      {
        activeIndicatorClassName,
        hoverIndicatorClassName,
        focusIndicatorClassName,
        indicatorTargetSelector,
        hoverAxis,
        hoverMaxDistance,
      }
    );

    const content = (
      <MenuScopeContext.Provider value={value}>
        <ul
          className={cn(
            "relative flex w-full min-w-0 select-none flex-col",
            className
          )}
          data-sidebar="menu"
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLUListElement | null>).current =
                node;
            }
          }}
          {...containerProps}
          {...props}
        >
          {overlays}
          {children}
        </ul>
      </MenuScopeContext.Provider>
    );

    return content;
  }
);
SidebarMenu.displayName = "SidebarMenu";

// ─── SidebarMenuItem / SidebarMenuSubItem ────────────────────────────────────

export type SidebarMenuItemProps = LiHTMLAttributes<HTMLLIElement> & {
  /** Select a composite row whose content is supplied by the consumer. */
  isActive?: boolean;
};

function useMenuRow(rowRef: RefObject<HTMLLIElement | null>, isSubRow = false) {
  const scope = useContext(MenuScopeContext);
  const registerRow = scope?.registerRow;
  const setRowButton = scope?.setRowButton;
  const setRowActive = scope?.setRowActive;

  // The button's setActive effect can fire while this row's <li> ref is
  // detached: a child's layout effects run before its parent's ref attaches
  // — at mount, and on EVERY re-render whose inline ref identity changes
  // (React detaches the old callback, nulling the ref, before the layout
  // phase). The flag holds the truth through that window, and attachRow
  // re-syncs the scope whenever the <li> lands.
  const activeFlagRef = useRef(false);

  useIsoLayoutEffect(() => {
    const el = rowRef.current;
    if (!(el && registerRow)) {
      return;
    }
    return registerRow(el);
  }, [registerRow, rowRef]);

  /** The <li>'s ref callback: tracks the element and replays the active flag
   *  the scope may have missed while the ref was detached. */
  const attachRow = useCallback(
    (node: HTMLLIElement | null) => {
      rowRef.current = node;
      if (node && setRowActive) {
        setRowActive(node, activeFlagRef.current);
      }
    },
    [setRowActive, rowRef]
  );

  const setActive = useCallback(
    (active: boolean) => {
      activeFlagRef.current = active;
      if (rowRef.current && setRowActive) {
        setRowActive(rowRef.current, active);
      }
    },
    [setRowActive, rowRef]
  );

  const setButtonEl = useCallback(
    (el: HTMLElement | null) => {
      if (rowRef.current && setRowButton) {
        setRowButton(rowRef.current, el);
      }
    },
    [setRowButton, rowRef]
  );

  const hoverStore = scope?.hoverStore ?? NO_HOVER_STORE;
  const subscribeHover = useCallback(
    (notify: () => void) => hoverStore.subscribe(rowRef.current, notify),
    [hoverStore, rowRef]
  );
  const getHover = useCallback(
    () => hoverStore.isActive(rowRef.current),
    [hoverStore, rowRef]
  );
  const isHovered = useSyncExternalStore(
    subscribeHover,
    getHover,
    getServerHover
  );
  const isActiveRow =
    rowRef.current !== null &&
    (scope?.activeRows.includes(rowRef.current) ?? false);

  const [trailing, setTrailing] = useState({
    actionCount: 0,
    actionsShowOnHover: false,
    hasBadge: false,
  });
  const setActions = useCallback(
    (count: number, showOnHover: boolean) =>
      setTrailing((prev) =>
        prev.actionCount === count && prev.actionsShowOnHover === showOnHover
          ? prev
          : { ...prev, actionCount: count, actionsShowOnHover: showOnHover }
      ),
    []
  );
  const setHasBadge = useCallback(
    (hasBadge: boolean) =>
      setTrailing((prev) =>
        prev.hasBadge === hasBadge ? prev : { ...prev, hasBadge }
      ),
    []
  );

  return useMemo(
    () => ({
      rowRef,
      attachRow,
      isHovered,
      isActiveRow,
      isSubRow,
      setActive,
      setButtonEl,
      ...trailing,
      setActions,
      setHasBadge,
    }),
    [
      rowRef,
      attachRow,
      isHovered,
      isActiveRow,
      isSubRow,
      setActive,
      setButtonEl,
      trailing,
      setActions,
      setHasBadge,
    ]
  );
}

// ─── Trailing-gutter math ────────────────────────────────────────────────────
//
// The label reserves exactly the trailing run it has to clear, plus one gap
// — the same rule the section header's label follows, so a row's chevron and
// a section header's chevron each sit one 4px gap from their action run.
// A run is: the badge's 24px slot (rightmost when present), the action
// cluster (24px apiece, 4px between), and a gap where both appear.
const ROW_BASE_PAD = 8;
const ROW_SLOT = 24;
const ROW_GAP = 4;
/** Where the run's rightmost element sits, measured from the row's right
 *  edge: a badge at right-2, an action cluster at right-1.5 (its wider box
 *  puts both on the same centre line). */
const ROW_BADGE_INSET = 8;
const ROW_ACTION_INSET = 6;

function rowGutter(actionCount: number, hasBadge: boolean) {
  if (!(actionCount || hasBadge)) {
    return ROW_BASE_PAD;
  }
  const actionsWidth = actionCount
    ? actionCount * ROW_SLOT + (actionCount - 1) * ROW_GAP
    : 0;
  const runWidth =
    (hasBadge ? ROW_SLOT : 0) +
    actionsWidth +
    (hasBadge && actionCount ? ROW_GAP : 0);
  const inset = hasBadge ? ROW_BADGE_INSET : ROW_ACTION_INSET;
  return inset + runWidth + ROW_GAP;
}

function SidebarSelectionBackground({
  layoutId,
  className,
  slot,
}: {
  layoutId: string;
  className: string;
  slot?: string;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 bg-interaction-active",
        className
      )}
      data-slot={slot}
      layoutId={layoutId}
      transition={reduceMotion ? { duration: 0 } : spring.moderate}
    />
  );
}

const SidebarMenuItem = forwardRef<HTMLLIElement, SidebarMenuItemProps>(
  ({ className, children, isActive, ...props }, ref) => {
    const rowRef = useRef<HTMLLIElement>(null);
    const item = useMenuRow(rowRef);
    const scope = useContext(MenuScopeContext);
    const { setActive } = item;
    useIsoLayoutEffect(() => {
      if (isActive !== undefined) {
        setActive(isActive);
      }
    }, [isActive, setActive]);
    const { attachRow } = item;
    // Stable ref callback: an inline one is detached and re-attached around
    // every re-render, and child layout effects fire inside that null window.
    const refCb = useCallback(
      (node: HTMLLIElement | null) => {
        attachRow(node);
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLLIElement | null>).current = node;
        }
      },
      [attachRow, ref]
    );
    return (
      <MenuItemContext.Provider value={item}>
        <li
          className={cn(
            "group/menu-item relative",
            isActive !== undefined && "isolate",
            className
          )}
          data-sidebar="menu-item"
          ref={refCb}
          {...props}
        >
          {isActive && scope?.activeLayoutId && (
            <SidebarSelectionBackground
              className={cn("rounded-md", scope.activeIndicatorClassName)}
              layoutId={scope.activeLayoutId}
              slot="fluid-nav-menu-active-indicator"
            />
          )}
          {children}
        </li>
      </MenuItemContext.Provider>
    );
  }
);
SidebarMenuItem.displayName = "SidebarMenuItem";

export type SidebarMenuSubItemProps = LiHTMLAttributes<HTMLLIElement>;

const SidebarMenuSubItem = forwardRef<HTMLLIElement, SidebarMenuSubItemProps>(
  ({ className, children, ...props }, ref) => {
    const rowRef = useRef<HTMLLIElement>(null);
    const item = useMenuRow(rowRef, true);
    const { attachRow } = item;
    // Stable ref callback — same reason as SidebarMenuItem's.
    const refCb = useCallback(
      (node: HTMLLIElement | null) => {
        attachRow(node);
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLLIElement | null>).current = node;
        }
      },
      [attachRow, ref]
    );
    return (
      <MenuItemContext.Provider value={item}>
        <li
          className={cn("group/menu-sub-item relative", className)}
          data-sidebar="menu-sub-item"
          ref={refCb}
          {...props}
        >
          {children}
        </li>
      </MenuItemContext.Provider>
    );
  }
);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

// ─── Row label (ghost-span weight animation) ─────────────────────────────────

/** Splits leading string children out as the label so it can get the
 *  ghost-span weight treatment; remaining element children (dots, trailing
 *  icons) render as flex siblings after it — outside the text-box-trimmed
 *  span, which would clip an inline SVG, and where `ml-auto` can push a
 *  trailing control to the row's end. */
function MenuRowLabel({
  content,
  lit,
  emphasized,
  textClass,
}: {
  content: ReactNode;
  lit: boolean;
  emphasized: boolean;
  textClass: string;
}) {
  const nodes = Children.toArray(content);
  const textParts: string[] = [];
  let i = 0;
  while (
    i < nodes.length &&
    (typeof nodes[i] === "string" || typeof nodes[i] === "number")
  ) {
    textParts.push(String(nodes[i]));
    i++;
  }
  const label = textParts.join("");
  const rest = nodes.slice(i);

  // Composed content owns its layout and text tokens (including icon-only
  // items). Only plain labels need the upstream weight-animation wrapper.
  if (!label) {
    return <>{content}</>;
  }

  return (
    <>
      <span className={cn("inline-grid min-w-0 text-left", textClass)}>
        {/* Ghost: reserves width at the heaviest weight, hidden from AT.
            Both cells truncate so a long label clips with an ellipsis
            instead of wrapping the row. The trim box spans cap height to
            baseline, so the overflow clip would shave ascenders and
            descenders — symmetric padding extends the clip box past both
            and the negative margins cancel it out of the row's height. */}
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 -mt-[0.25em] -mb-[0.25em] truncate pt-[0.25em] pb-[0.25em] [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {label}
        </span>
        {/* Visible: animates between weights in the same cell */}
        <span
          className={cn(
            "col-start-1 row-start-1 -mt-[0.25em] -mb-[0.25em] truncate pt-[0.25em] pb-[0.25em] transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic] motion-reduce:transition-none",
            lit ? "text-foreground" : "text-muted-foreground"
          )}
          style={{
            fontVariationSettings: emphasized
              ? fontWeights.semibold
              : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </span>
      {rest}
    </>
  );
}

// ─── SidebarMenuButton ───────────────────────────────────────────────────────

export const sidebarMenuButtonVariants = cva(
  // The trailing gutter is an exact reservation published by the row (see
  // rowGutter): --row-gutter at rest, --row-gutter-hover once hover-revealed
  // actions are showing. One rule per state instead of a class per
  // count/badge/reveal combination. Only apply reveal rules when the gutter
  // changes, so consumer padding stays stable on rows without hidden actions.
  "peer/menu-button relative z-10 flex w-full cursor-pointer select-none items-center gap-2 pr-[var(--row-gutter)] pl-2 text-left outline-none transition-[padding] duration-80 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "",
        outline: "border border-border bg-background",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface SidebarMenuButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof sidebarMenuButtonVariants> {
  /** Multiline rows reserve action space only on their marked heading. */
  actionLayout?: "row" | "heading";
  isActive?: boolean;
  size?: "default" | "sm" | "lg";
  icon?: IconComponent;
  /** Semantic thread state for status-dot navigation. Drives the dot
   *  visuals (`active`/`unread` → filled, `idle` → ring), stamps
   *  `data-status` on the button, appends visually-hidden "unread" text for
   *  screen readers, and `"active"` implies `isActive`. */
  status?: "active" | "unread" | "idle";
  /** Visual-only dot in the icon column — the escape hatch when the
   *  semantic `status` vocabulary doesn't fit. Overrides the dot derived
   *  from `status`. Ignored when `icon` is set. */
  dot?: "filled" | "ring";
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarMenuButton = forwardRef<HTMLButtonElement, SidebarMenuButtonProps>(
  (
    {
      isActive = false,
      actionLayout = "row",
      size = "default",
      variant,
      icon: Icon,
      status,
      dot,
      render,
      asChild,
      className,
      children,
      ...props
    },
    ref
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Preserve upstream polymorphic composition for registry updates.
  ) => {
    const scope = useContext(MenuScopeContext);
    const item = useContext(MenuItemContext);
    const shape = useShape();
    const sizeClasses = {
      variant: "compact" as string,
      icon: 16,
      text: "text-[13px]",
    };
    const buttonRef = useRef<HTMLElement | null>(null);

    // status="active" implies the row-active treatment; an explicit dot
    // overrides the status-derived one.
    const effectiveActive = isActive || status === "active";

    const setActive = item?.setActive;
    useIsoLayoutEffect(() => {
      setActive?.(effectiveActive);
      return () => setActive?.(false);
    }, [effectiveActive, setActive]);

    const setButtonEl = item?.setButtonEl;
    useIsoLayoutEffect(() => {
      setButtonEl?.(buttonRef.current);
      return () => setButtonEl?.(null);
    }, [setButtonEl]);
    const statusDot = status === "idle" ? "ring" : "filled";
    const resolvedDot = dot ?? (status ? statusDot : undefined);
    const lit = effectiveActive || (item?.isHovered ?? false);
    const heightClass = size === "lg" ? "h-12" : "h-7";
    const textClass = size === "sm" ? "text-[12px]" : sizeClasses.text;

    // Roving tabindex: the active rows' buttons are the menu's tab stops; with
    // no active row, the menu's first row keeps it keyboard-reachable.
    const row = item?.rowRef.current ?? null;
    const isFirstStop =
      !scope?.hasActive && row !== null && row === scope?.firstRowEl;
    const tabIdx = effectiveActive || isFirstStop ? 0 : -1;

    // Exact trailing reservation: at rest, hover-revealed actions claim no
    // width (the label owns the row); once revealed the row widens to
    // --row-gutter-hover. Reveal tracks the row's own button and actions,
    // not its <li>, which also wraps any nested sub-menu.
    const gutterHover = rowGutter(
      item?.actionCount ?? 0,
      item?.hasBadge ?? false
    );
    const gutterRest = item?.actionsShowOnHover
      ? rowGutter(0, item?.hasBadge ?? false)
      : gutterHover;
    const gutterVars = {
      "--row-gutter": `${gutterRest}px`,
      "--row-gutter-hover": `${gutterHover}px`,
    } as CSSProperties;

    const { template, content } = resolveSlotTemplate(
      render,
      asChild,
      children
    );

    const inner = (
      <>
        {effectiveActive &&
          scope?.activeLayoutId &&
          !row?.hasAttribute("data-fluid-nav-value") && (
            <SidebarSelectionBackground
              className={cn(shape.bg, scope.activeIndicatorClassName)}
              layoutId={scope.activeLayoutId}
            />
          )}
        {Icon && (
          <Icon
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80 motion-reduce:transition-none",
              lit ? "text-foreground" : "text-muted-foreground"
            )}
            size={sizeClasses.icon}
            strokeWidth={lit ? 2 : 1.5}
          />
        )}
        {!Icon && resolvedDot && (
          <span
            className="flex shrink-0 items-center justify-center"
            style={{ width: sizeClasses.icon, height: sizeClasses.icon }}
          >
            <span
              className={cn(
                "size-2 rounded-full transition-colors duration-80 motion-reduce:transition-none",
                resolvedDot === "filled" &&
                  (lit ? "bg-foreground/60" : "bg-muted-foreground/50"),
                resolvedDot === "ring" &&
                  (lit
                    ? "border border-foreground/60"
                    : "border border-muted-foreground/50")
              )}
            />
          </span>
        )}
        <MenuRowLabel
          content={content}
          emphasized={effectiveActive}
          lit={lit}
          textClass={textClass}
        />
        {status === "unread" && <span className="sr-only">, unread</span>}
      </>
    );

    return slotElement(
      template,
      "button",
      {
        ref: (node: HTMLElement | null) => {
          buttonRef.current = node;
          if (typeof ref === "function") {
            ref(node as HTMLButtonElement | null);
          } else if (ref) {
            (ref as React.MutableRefObject<HTMLElement | null>).current = node;
          }
        },
        type: template ? undefined : "button",
        "data-sidebar": "menu-button",
        "data-action-layout": actionLayout,
        "data-size": size,
        "data-active": effectiveActive ? "true" : undefined,
        "data-status": status,
        "aria-current": effectiveActive ? "page" : undefined,
        tabIndex: tabIdx,
        className: cn(
          sidebarMenuButtonVariants({ variant }),
          scope?.activeLayoutId && "isolate",
          actionLayout === "row" &&
            gutterRest !== gutterHover &&
            "hover:pr-[var(--row-gutter-hover)] group-focus-within/menu-sub-item:pr-[var(--row-gutter-hover)] group-hover/menu-sub-item:pr-[var(--row-gutter-hover)] group-has-[>[data-sidebar=menu-action]:hover]/menu-item:pr-[var(--row-gutter-hover)] group-has-[>[data-sidebar=menu-actions]:hover]/menu-item:pr-[var(--row-gutter-hover)] group-has-[>[data-sidebar=menu-button]:focus-visible,>[data-sidebar=menu-actions]:focus-within,>[data-sidebar=menu-action]:focus-visible]/menu-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-sub-item:pr-[var(--row-gutter-hover)] [@media(hover:none)]:pr-[var(--row-gutter-hover)]",
          heightClass,
          actionLayout === "heading" &&
            "pr-2 [&_[data-sidebar=menu-heading]]:pr-[calc(var(--row-gutter)-8px)] [&_[data-sidebar=menu-heading]]:transition-[padding] [&_[data-sidebar=menu-heading]]:duration-80 hover:[&_[data-sidebar=menu-heading]]:pr-[calc(var(--row-gutter-hover)-8px)] group-has-[>[data-sidebar=menu-actions]:hover]/menu-item:[&_[data-sidebar=menu-heading]]:pr-[calc(var(--row-gutter-hover)-8px)] group-has-[>[data-sidebar=menu-button]:focus-visible,>[data-sidebar=menu-actions]:focus-within,>[data-sidebar=menu-action]:focus-visible]/menu-item:[&_[data-sidebar=menu-heading]]:pr-[calc(var(--row-gutter-hover)-8px)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-item:[&_[data-sidebar=menu-heading]]:pr-[calc(var(--row-gutter-hover)-8px)] motion-reduce:[&_[data-sidebar=menu-heading]]:transition-none [@media(hover:none)]:[&_[data-sidebar=menu-heading]]:pr-[calc(var(--row-gutter-hover)-8px)]",
          shape.item,
          className
        ),
        ...props,
        style: { ...gutterVars, ...(props.style ?? {}) },
      },
      inner
    );
  }
);
SidebarMenuButton.displayName = "SidebarMenuButton";

// ─── SidebarMenuAction ───────────────────────────────────────────────────────

export interface SidebarMenuActionProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  showOnHover?: boolean;
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarMenuAction = forwardRef<HTMLButtonElement, SidebarMenuActionProps>(
  (
    {
      className,
      showOnHover = false,
      render,
      asChild,
      children,
      onClick,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    const sizeClasses = {
      variant: "compact" as string,
      icon: 16,
      text: "text-[13px]",
    };
    const item = useContext(MenuItemContext);
    const inCluster = useContext(MenuActionsClusterContext);
    const { template, content } = resolveSlotTemplate(
      render,
      asChild,
      children
    );

    // A lone action registers its own slot; inside a cluster the wrapper
    // registers the whole count and each action flows in its row.
    const setActions = item?.setActions;
    useIsoLayoutEffect(() => {
      if (inCluster || !setActions) {
        return;
      }
      setActions(1, showOnHover);
      return () => setActions(0, false);
    }, [inCluster, setActions, showOnHover]);
    return slotElement(
      template,
      "button",
      {
        ref: ref as Ref<HTMLElement>,
        type: template ? undefined : "button",
        "data-sidebar": "menu-action",
        "data-show-on-hover": showOnHover ? "" : undefined,
        className: cn(
          // right-1.5 centers the 24px hit-box on the same axis as the badge
          // (right-2 + min-w-5): both land 18px from the row's right edge.
          // With a badge on the same row the badge keeps that rightmost spot
          // and the action slides left of it. Inside a cluster the wrapper
          // owns the positioning and actions simply flow.
          inCluster
            ? "relative flex size-6 shrink-0 items-center justify-center text-muted-foreground outline-none"
            : "absolute right-1.5 z-10 flex size-6 items-center justify-center text-muted-foreground outline-none",
          !inCluster &&
            (item?.isSubRow
              ? "group-has-[>[data-sidebar=menu-badge]]/menu-sub-item:right-8.5"
              : "group-has-[>[data-sidebar=menu-badge]]/menu-item:right-8.5"),
          !inCluster &&
            (item?.isSubRow || sizeClasses.variant === "compact"
              ? "top-0.5"
              : "top-1"),
          "transition-[color,background-color,opacity] duration-80 hover:bg-sidebar-accent hover:text-foreground motion-reduce:transition-none",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--sidebar-ring)]",
          // One icon size across the sidebar: row actions match the leading
          // icons and the section header's actions, all on the size ladder.
          // Normalize bare icons to the site's 1.5 stroke (library defaults
          // vary), thickening to 2 on hover — Button's icon-only treatment.
          "motion-reduce:transition-none [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 hover:[&_svg]:stroke-[2]",
          shape.item,
          // Reveal on the OWN row only. A sub action must not use the
          // menu-item group — its nearest one is the parent li, which would
          // light every sibling sub action on any hover inside the sub-tree.
          !inCluster &&
            showOnHover &&
            (item?.isSubRow
              ? "opacity-0 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 aria-expanded:opacity-100 data-[state=open]:opacity-100"
              : // Tracks the row's own button (its peer), not the <li> — a row
                // that hosts a sub-menu wraps its children too, and hovering a
                // child should not light the parent's action.
                "opacity-0 hover:opacity-100 focus-visible:opacity-100 peer-hover/menu-button:opacity-100 peer-focus-visible/menu-button:opacity-100 aria-expanded:opacity-100 data-[state=open]:opacity-100"),
          className
        ),
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          // The action often sits on a row composed via `render` — keep its
          // click from also triggering the row.
          event.stopPropagation();
          onClick?.(event);
        },
        ...props,
        style: {
          ...({ "--icon-size": `${sizeClasses.icon}px` } as CSSProperties),
          ...(props.style ?? {}),
        },
      },
      content
    );
  }
);
SidebarMenuAction.displayName = "SidebarMenuAction";

// ─── SidebarMenuActions ──────────────────────────────────────────────────────

export interface SidebarMenuActionsProps
  extends HTMLAttributes<HTMLDivElement> {
  /** Hide the cluster until the row is hovered or focused. */
  showOnHover?: boolean;
}

/** Row-level cluster for more than one SidebarMenuAction. It owns the
 *  positioning and publishes the whole count to the row, so the button
 *  reserves the exact gutter the cluster occupies. */
const SidebarMenuActions = forwardRef<HTMLDivElement, SidebarMenuActionsProps>(
  ({ className, showOnHover = false, children, ...props }, ref) => {
    const item = useContext(MenuItemContext);
    const sizeClasses = {
      variant: "compact" as string,
      icon: 16,
      text: "text-[13px]",
    };
    const count = Children.toArray(children).length;

    const setActions = item?.setActions;
    useIsoLayoutEffect(() => {
      setActions?.(count, showOnHover);
      return () => setActions?.(0, false);
    }, [setActions, count, showOnHover]);

    return (
      <div
        className={cn(
          "absolute right-1.5 z-10 flex items-center gap-1",
          showOnHover && "[@media(hover:none)]:opacity-100",
          // The badge keeps the rightmost slot; the cluster sits left of it.
          item?.isSubRow
            ? "group-has-[>[data-sidebar=menu-badge]]/menu-sub-item:right-8.5"
            : "group-has-[>[data-sidebar=menu-badge]]/menu-item:right-8.5",
          item?.isSubRow || sizeClasses.variant === "compact"
            ? "top-0.5"
            : "top-1",
          showOnHover &&
            (item?.isSubRow
              ? "opacity-0 transition-opacity duration-80 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 has-[[data-popup-open]]:opacity-100 has-[[data-state=open]]:opacity-100 motion-reduce:transition-none"
              : // Peer-scoped for the same reason as a lone action: the row's
                // <li> also wraps its sub-menu.
                "opacity-0 transition-opacity duration-80 focus-within:opacity-100 hover:opacity-100 peer-hover/menu-button:opacity-100 peer-focus-visible/menu-button:opacity-100 has-[[data-popup-open]]:opacity-100 has-[[data-state=open]]:opacity-100 motion-reduce:transition-none"),
          className
        )}
        data-sidebar="menu-actions"
        ref={ref}
        {...props}
      >
        <MenuActionsClusterContext.Provider value={true}>
          {children}
        </MenuActionsClusterContext.Provider>
      </div>
    );
  }
);
SidebarMenuActions.displayName = "SidebarMenuActions";

// ─── SidebarMenuBadge ────────────────────────────────────────────────────────

export type SidebarMenuBadgeProps = HTMLAttributes<HTMLDivElement>;

const SidebarMenuBadge = forwardRef<HTMLDivElement, SidebarMenuBadgeProps>(
  ({ className, ...props }, ref) => {
    const item = useContext(MenuItemContext);
    const sizeClasses = {
      variant: "compact" as string,
      icon: 16,
      text: "text-[13px]",
    };
    const lit = item?.isActiveRow ?? false;

    const setHasBadge = item?.setHasBadge;
    useIsoLayoutEffect(() => {
      setHasBadge?.(true);
      return () => setHasBadge?.(false);
    }, [setHasBadge]);
    return (
      <div
        className={cn(
          "pointer-events-none absolute right-2 z-10 flex h-5 min-w-5 items-center justify-center px-1 tabular-nums",
          sizeClasses.variant === "compact"
            ? "top-1 text-[10px]"
            : "top-1.5 text-[11px]",
          "transition-[color,font-variation-settings] duration-80 motion-reduce:transition-none",
          lit ? "text-foreground" : "text-muted-foreground",
          className
        )}
        data-sidebar="menu-badge"
        ref={ref}
        style={{
          fontVariationSettings: lit
            ? fontWeights.semibold
            : fontWeights.normal,
        }}
        {...props}
      />
    );
  }
);
SidebarMenuBadge.displayName = "SidebarMenuBadge";

// ─── SidebarMenuSkeleton ─────────────────────────────────────────────────────

export interface SidebarMenuSkeletonProps
  extends HTMLAttributes<HTMLDivElement> {
  showIcon?: boolean;
}

// Deterministic width cycle (not Math.random) so server and client render the
// same markup — a random width per render is a hydration mismatch.
const SKELETON_WIDTHS = ["62%", "74%", "55%", "82%", "68%"];

const SidebarMenuSkeleton = forwardRef<
  HTMLDivElement,
  SidebarMenuSkeletonProps
>(({ className, showIcon = false, ...props }, ref) => {
  const sizeClasses = {
    variant: "compact" as string,
    icon: 16,
    text: "text-[13px]",
  };
  const id = useId();
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum += id.charCodeAt(i);
  }
  const width = SKELETON_WIDTHS[sum % SKELETON_WIDTHS.length];
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2",
        sizeClasses.variant === "compact" ? "h-7" : "h-8",
        className
      )}
      data-sidebar="menu-skeleton"
      ref={ref}
      {...props}
    >
      {showIcon && (
        <div
          className="size-4 shrink-0 animate-pulse rounded-md bg-sidebar-accent motion-reduce:animate-none"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <div
        className="h-4 flex-1 animate-pulse rounded-md bg-sidebar-accent motion-reduce:animate-none"
        data-sidebar="menu-skeleton-text"
        style={{ maxWidth: width }}
      />
    </div>
  );
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

// ─── SidebarMenuSub ──────────────────────────────────────────────────────────

export interface SidebarMenuSubProps extends HTMLAttributes<HTMLUListElement> {
  /** Built-in measured-height collapse. Omitted, the sub-menu is always
   *  visible; wire it to state (with a toggling SidebarMenuButton) for a
   *  collapsible tree. */
  open?: boolean;
}

const SidebarMenuSub = forwardRef<HTMLUListElement, SidebarMenuSubProps>(
  ({ className, open = true, children, ...props }, ref) => {
    const containerRef = useRef<HTMLUListElement>(null);
    const reduceMotion = useReducedMotion();
    // The sub-menu is NOT its own highlight scope: its rows register with the
    // surrounding SidebarMenu, so one hover background glides from a parent
    // row into its children. Toggling flips the rows' visibility in place
    // (they stay registered), so the scope re-reads what is visible.
    const scope = useContext(MenuScopeContext);
    const refreshVisibility = scope?.refreshVisibility;
    useIsoLayoutEffect(() => {
      refreshVisibility?.();
    }, [open, refreshVisibility]);

    // Measured-height collapse: animate between 0 and the content's real
    // offsetHeight — never to "auto", which framer measures wrong under a
    // scaled ancestor.
    const [contentHeight, setContentHeight] = useState<number | null>(null);
    useIsoLayoutEffect(() => {
      const el = containerRef.current;
      if (!el || typeof ResizeObserver === "undefined") {
        return;
      }
      const measure = () => setContentHeight(el.offsetHeight);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const measured = contentHeight !== null;

    // Same rule as SidebarGroup: spring only when this sub-tree itself
    // toggles. A height change coming from a nested sub collapsing inside it
    // snaps, so the wrapper tracks its content instead of chasing it with a
    // second spring and moving everything below late.
    const prevOpenRef = useRef(open);
    const togglingRef = useRef(false);
    const shouldAnimate = prevOpenRef.current !== open || togglingRef.current;
    useIsoLayoutEffect(() => {
      if (prevOpenRef.current !== open) {
        prevOpenRef.current = open;
        togglingRef.current = true;
      }
    }, [open]);

    return (
      <motion.div
        animate={
          measured
            ? { height: open ? contentHeight : 0, opacity: open ? 1 : 0 }
            : { opacity: open ? 1 : 0 }
        }
        // `animate` stays defined from the first render — framer ignores an
        // animate prop that appears later in the element's life. Until the
        // content is measured, a closed sub collapses via the h-0 class and
        // an open one keeps its natural height.
        className={cn("overflow-hidden", !(measured || open) && "h-0")}
        data-slot="sidebar-menu-sub-wrapper"
        initial={false}
        // Do NOT simplify this to `open ? spring.moderate : …` — see the
        // togglingRef note above. Springing on a re-measure stacks a second
        // spring on a nested sub's own collapse.
        onAnimationComplete={() => {
          togglingRef.current = false;
        }}
        transition={
          !reduceMotion && shouldAnimate ? spring.moderate : { duration: 0 }
        }
      >
        <ul
          aria-hidden={open ? undefined : true}
          className={cn(
            // ml-[15px] (a margin, not a translate, so the rows' measured
            // rects include it) + 1px border + pl-2 lands the sub-row label
            // (+ the row's own pl-2 = 32px) exactly on the parent label's x
            // (px-2 + 16px icon + gap-2 = 32px).
            "relative ml-[15px] flex min-w-0 select-none flex-col gap-0.5 border-border border-l pl-2",
            className
          )}
          data-sidebar="menu-sub"
          data-state={open ? "open" : "closed"}
          inert={!open || undefined}
          ref={(node) => {
            containerRef.current = node;
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLUListElement | null>).current =
                node;
            }
          }}
          {...props}
        >
          {children}
        </ul>
      </motion.div>
    );
  }
);
SidebarMenuSub.displayName = "SidebarMenuSub";

// ─── SidebarMenuSubButton ────────────────────────────────────────────────────

export interface SidebarMenuSubButtonProps
  extends AnchorHTMLAttributes<HTMLAnchorElement> {
  isActive?: boolean;
  size?: "sm" | "md";
  icon?: IconComponent;
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarMenuSubButton = forwardRef<
  HTMLAnchorElement,
  SidebarMenuSubButtonProps
>(
  (
    {
      isActive = false,
      size = "md",
      icon: Icon,
      render,
      asChild,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const item = useContext(MenuItemContext);
    const scope = useContext(MenuScopeContext);
    const shape = useShape();
    const sizeClasses = {
      variant: "compact" as string,
      icon: 16,
      text: "text-[13px]",
    };
    const buttonRef = useRef<HTMLElement | null>(null);

    const setActive = item?.setActive;
    useIsoLayoutEffect(() => {
      setActive?.(isActive);
      return () => setActive?.(false);
    }, [isActive, setActive]);

    const setButtonEl = item?.setButtonEl;
    useIsoLayoutEffect(() => {
      setButtonEl?.(buttonRef.current);
      return () => setButtonEl?.(null);
    }, [setButtonEl]);

    const lit = isActive || (item?.isHovered ?? false);
    const tabIdx = isActive ? 0 : -1;

    const gutterHover = rowGutter(
      item?.actionCount ?? 0,
      item?.hasBadge ?? false
    );
    const gutterRest = item?.actionsShowOnHover
      ? rowGutter(0, item?.hasBadge ?? false)
      : gutterHover;
    const gutterVars = {
      "--row-gutter": `${gutterRest}px`,
      "--row-gutter-hover": `${gutterHover}px`,
    } as CSSProperties;

    const { template, content } = resolveSlotTemplate(
      render,
      asChild,
      children
    );

    return slotElement(
      template,
      "a",
      {
        ref: (node: HTMLElement | null) => {
          buttonRef.current = node;
          if (typeof ref === "function") {
            ref(node as HTMLAnchorElement | null);
          } else if (ref) {
            (ref as React.MutableRefObject<HTMLElement | null>).current = node;
          }
        },
        "data-sidebar": "menu-sub-button",
        "data-size": size,
        "data-active": isActive ? "true" : undefined,
        "aria-current": isActive ? "page" : undefined,
        tabIndex: tabIdx,
        className: cn(
          "relative z-10 flex w-full cursor-pointer select-none items-center gap-2 pl-2 text-left outline-none",
          "pr-[var(--row-gutter)] transition-[padding] duration-80 motion-reduce:transition-none",
          gutterRest !== gutterHover &&
            "group-focus-within/menu-sub-item:pr-[var(--row-gutter-hover)] group-hover/menu-sub-item:pr-[var(--row-gutter-hover)] group-has-[[data-sidebar=menu-action]:is([data-state=open],[data-popup-open],[aria-expanded=true])]/menu-sub-item:pr-[var(--row-gutter-hover)]",
          "h-6",
          shape.item,
          // A layoutId menu draws selection inside the row (see
          // SidebarMenuButton), so sub-rows need their own background too.
          scope?.activeLayoutId && "isolate",
          className
        ),
        ...props,
        style: { ...gutterVars, ...(props.style ?? {}) },
      },
      <>
        {isActive && scope?.activeLayoutId && (
          <SidebarSelectionBackground
            className={cn(shape.bg, scope.activeIndicatorClassName)}
            layoutId={scope.activeLayoutId}
          />
        )}
        {Icon && (
          <Icon
            className={cn(
              "shrink-0 transition-[color,stroke-width] duration-80 motion-reduce:transition-none",
              lit ? "text-foreground" : "text-muted-foreground"
            )}
            size={sizeClasses.icon}
            strokeWidth={lit ? 2 : 1.5}
          />
        )}
        {/* Sub-rows keep the parent rows' type size — only the row height
            steps down. */}
        <MenuRowLabel
          content={content}
          emphasized={isActive}
          lit={lit}
          textClass={size === "sm" ? "text-[12px]" : sizeClasses.text}
        />
      </>
    );
  }
);
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuActions,
  SidebarMenuBadge,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
};
