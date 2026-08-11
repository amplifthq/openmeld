import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Scroll-spy for a long flat-form leaf panel (Account, Service · Preferences) —
 * NOT for the entity list routes. See developing/clients/shell-and-settings.md §4.
 *
 * Purely presentational + injected: this hook owns NO storage and NO router. It
 * observes section anchors via a single-active-band IntersectionObserver, lets
 * the caller react to the active section through `onActiveChange`, and offers a
 * `scrollTo(id)` that updates the URL hash with `history.replaceState` (a
 * platform API, not a router) and respects `prefers-reduced-motion` by jumping
 * instantly. The boundary test forbids storage; the URL hash is the only side
 * effect and it is an anchor, not persistence.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Bounded fallback for environments (jsdom, older engines) that never fire a
// `scrollend` event: the programmatic-scroll lock must still release so the
// observer resumes tracking. Generous enough to outlast a real smooth scroll.
const SCROLL_LOCK_FALLBACK_MS = 700;

export type UseScrollSpyOptions = {
  /** The ordered section ids/anchors to observe (document order). */
  sectionIds: readonly string[];
  /** Fired when the single active band changes. The caller decides what to do
   * (e.g. highlight the matching nav item). The hook holds no router. */
  onActiveChange?: (sectionId: string) => void;
  /** The scrollable container; defaults to the viewport when omitted. */
  root?: Element | null;
  /** rootMargin for the observer — lets a sticky header offset the band. */
  rootMargin?: string;
  /** Resolve a section element by id. Defaults to `getElementById`. Injected so
   * tests (and shadow hosts) can supply their own lookup without a real DOM id. */
  getSectionElement?: (sectionId: string) => Element | null;
};

export type UseScrollSpy = {
  /** The currently active section id (the single active band). */
  activeId: string | null;
  /** Programmatically scroll to a section, lock the band to it, and set the URL
   * anchor. Instant when the user prefers reduced motion. */
  scrollTo: (sectionId: string) => void;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Move focus to the jumped-to section's heading (design doc §4: "focus-to-heading
 * on jump"). `SettingsSection` renders the section `<h2 id={`${id}-heading`}>`, so
 * a non-interactive heading is made focusable with `tabIndex=-1` and focused with
 * `preventScroll` (scrollIntoView already positioned it). No-op when the heading is
 * absent or the env has no DOM / focusable element.
 */
function focusSectionHeading(sectionId: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const heading = document.getElementById(`${sectionId}-heading`);
  if (!heading || typeof (heading as HTMLElement).focus !== "function") {
    return;
  }
  // Headings are not focusable by default; -1 keeps them out of the tab order
  // while allowing programmatic focus.
  heading.setAttribute("tabindex", "-1");
  (heading as HTMLElement).focus({ preventScroll: true });
}

/** Fold an observer batch into the per-section intersection-ratio map. */
function applyEntries(
  entries: IntersectionObserverEntry[],
  elementToId: Map<Element, string>,
  ratios: Map<string, number>
): void {
  for (const entry of entries) {
    const id = elementToId.get(entry.target);
    if (id) {
      ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
    }
  }
}

/** Single active band = the first section (document order) still intersecting. */
function pickActiveBand(
  ids: readonly string[],
  ratios: Map<string, number>
): string | null {
  for (const id of ids) {
    if ((ratios.get(id) ?? 0) > 0) {
      return id;
    }
  }
  return null;
}

export function useScrollSpy(options: UseScrollSpyOptions): UseScrollSpy {
  const {
    sectionIds,
    onActiveChange,
    root = null,
    rootMargin,
    getSectionElement,
  } = options;

  const [activeId, setActiveId] = useState<string | null>(
    sectionIds[0] ?? null
  );

  // Keep latest callbacks/inputs in refs so the observer effect re-subscribes
  // only when the observed set changes, not on every render tick.
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;
  const resolveElementRef = useRef(getSectionElement);
  resolveElementRef.current = getSectionElement;

  // Programmatic scroll briefly locks the active band to the target so the
  // observer's transient cross-fire does not yank the highlight away.
  const lockedIdRef = useRef<string | null>(null);
  // Teardown for the in-flight lock release (scrollend listener + fallback
  // timer). A new `scrollTo` (or unmount) cancels the previous one's pending
  // release so locks never overlap or leak.
  const releaseLockRef = useRef<(() => void) | null>(null);

  const setActive = useCallback((next: string | null) => {
    setActiveId((current) => {
      if (current === next) {
        return current;
      }
      if (next !== null) {
        onActiveChangeRef.current?.(next);
      }
      return next;
    });
  }, []);

  const resolveElement = useCallback((sectionId: string): Element | null => {
    const resolver = resolveElementRef.current;
    if (resolver) {
      return resolver(sectionId);
    }
    if (typeof document === "undefined") {
      return null;
    }
    return document.getElementById(sectionId);
  }, []);

  const sectionKey = sectionIds.join("\n");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const ids = sectionKey.length > 0 ? sectionKey.split("\n") : [];
    const elementToId = new Map<Element, string>();
    for (const id of ids) {
      const element = resolveElement(id);
      if (element) {
        elementToId.set(element, id);
      }
    }
    if (elementToId.size === 0) {
      return;
    }

    // Track each observed section's latest intersection ratio so we can pick a
    // single active band (the top-most intersecting section) deterministically.
    const ratios = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        applyEntries(entries, elementToId, ratios);
        if (lockedIdRef.current !== null) {
          return;
        }
        const next = pickActiveBand(ids, ratios);
        if (next !== null) {
          setActive(next);
        }
      },
      {
        root,
        rootMargin: rootMargin ?? "0px",
        threshold: [0, 0.25, 0.5, 1],
      }
    );

    for (const element of elementToId.keys()) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [sectionKey, root, rootMargin, resolveElement, setActive]);

  const scrollTo = useCallback(
    (sectionId: string) => {
      // Cancel any in-flight release so the new lock fully owns the window —
      // overlapping releases could drop the new lock mid-scroll.
      releaseLockRef.current?.();

      lockedIdRef.current = sectionId;
      setActive(sectionId);

      const element = resolveElement(sectionId);
      if (element && "scrollIntoView" in element) {
        const behavior = prefersReducedMotion() ? "auto" : "smooth";
        (element as HTMLElement).scrollIntoView({ behavior, block: "start" });
      }

      // Move focus to the section heading so keyboard/AT users land in the
      // jumped-to content (design doc §4: focus-to-heading on jump).
      focusSectionHeading(sectionId);

      // Anchor the URL without a router and without pushing history.
      if (
        typeof window !== "undefined" &&
        typeof window.history?.replaceState === "function"
      ) {
        const { pathname, search } = window.location;
        window.history.replaceState(
          null,
          "",
          `${pathname}${search}#${sectionId}`
        );
      }

      // Hold the lock until the smooth scroll TRULY ends. A bounded set of
      // requestAnimationFrames covers the cheap case (reduced-motion / instant
      // jump), but a real smooth scroll keeps emitting IntersectionObserver
      // cross-fires for intermediate sections long after a 2-rAF window — those
      // would steal the active band before the target arrives. So we release on
      // the `scrollend` event of the scroll root (falling back to window), with
      // a bounded fallback timeout for jsdom / engines lacking `scrollend`.
      let released = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
      const scrollTarget: Element | Window | null =
        root ?? (typeof window === "undefined" ? null : window);

      const finalize = () => {
        if (released) {
          return;
        }
        released = true;
        lockedIdRef.current = null;
        scrollTarget?.removeEventListener("scrollend", onScrollEnd);
        if (fallbackTimer !== undefined) {
          clearTimeout(fallbackTimer);
        }
        if (releaseLockRef.current === finalize) {
          releaseLockRef.current = null;
        }
      };
      function onScrollEnd() {
        finalize();
      }

      releaseLockRef.current = finalize;

      if (scrollTarget && typeof scrollTarget.addEventListener === "function") {
        scrollTarget.addEventListener("scrollend", onScrollEnd);
      }

      if (typeof setTimeout === "function") {
        fallbackTimer = setTimeout(finalize, SCROLL_LOCK_FALLBACK_MS);
      } else {
        // Truly minimal environment: release immediately rather than leak.
        finalize();
      }
    },
    [resolveElement, root, setActive]
  );

  // On unmount, drop any in-flight lock release (listener + timer).
  useEffect(
    () => () => {
      releaseLockRef.current?.();
    },
    []
  );

  return { activeId, scrollTo };
}
