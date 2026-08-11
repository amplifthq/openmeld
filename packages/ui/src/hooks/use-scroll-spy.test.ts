import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollSpy } from "#hooks/use-scroll-spy";

type ObserverInstance = {
  callback: IntersectionObserverCallback;
  observed: Element[];
  disconnected: boolean;
};

let observers: ObserverInstance[] = [];

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observers.push(this as unknown as ObserverInstance);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve(element: Element) {
    this.observed = this.observed.filter((e) => e !== element);
  }

  disconnect() {
    this.disconnected = true;
  }
}

function firstObserver(): ObserverInstance {
  const observer = observers[0];
  if (!observer) {
    throw new Error("expected an IntersectionObserver to be created");
  }
  return observer;
}

function emit(
  observer: ObserverInstance,
  records: Array<{ target: Element; isIntersecting: boolean; ratio?: number }>
) {
  act(() => {
    observer.callback(
      records.map((r) => ({
        target: r.target,
        isIntersecting: r.isIntersecting,
        intersectionRatio: r.ratio ?? (r.isIntersecting ? 1 : 0),
      })) as unknown as IntersectionObserverEntry[],
      observer as unknown as IntersectionObserver
    );
  });
}

const elements = new Map<string, HTMLElement>();

function fakeGetSectionElement(id: string): Element | null {
  return elements.get(id) ?? null;
}

beforeEach(() => {
  observers = [];
  elements.clear();
  for (const id of ["account", "sessions", "tokens"]) {
    const el = document.createElement("section");
    el.id = id;
    el.scrollIntoView = vi.fn();
    // SettingsSection renders an <h2 id={`${id}-heading`}> — mirror it so the
    // hook's focus-to-heading on jump has a real focus target.
    const heading = document.createElement("h2");
    heading.id = `${id}-heading`;
    heading.textContent = id;
    el.appendChild(heading);
    elements.set(id, el);
    document.body.appendChild(el);
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("useScrollSpy", () => {
  it("starts with the first section as the active band", () => {
    const { result } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions", "tokens"],
        getSectionElement: fakeGetSectionElement,
      })
    );
    expect(result.current.activeId).toBe("account");
  });

  it("observes every resolvable section element", () => {
    renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions", "tokens"],
        getSectionElement: fakeGetSectionElement,
      })
    );
    expect(observers).toHaveLength(1);
    expect(firstObserver().observed).toHaveLength(3);
  });

  it("activates the first intersecting section and notifies onActiveChange", () => {
    const onActiveChange = vi.fn();
    const { result } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions", "tokens"],
        getSectionElement: fakeGetSectionElement,
        onActiveChange,
      })
    );

    emit(firstObserver(), [
      { target: elements.get("account") as Element, isIntersecting: false },
      { target: elements.get("sessions") as Element, isIntersecting: true },
    ]);

    expect(result.current.activeId).toBe("sessions");
    expect(onActiveChange).toHaveBeenCalledWith("sessions");
  });

  it("prefers the top-most (document-order) intersecting section as the single band", () => {
    const { result } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions", "tokens"],
        getSectionElement: fakeGetSectionElement,
      })
    );

    emit(firstObserver(), [
      { target: elements.get("sessions") as Element, isIntersecting: true },
      { target: elements.get("tokens") as Element, isIntersecting: true },
    ]);

    expect(result.current.activeId).toBe("sessions");
  });

  it("scrollTo locks the band, scrolls the element, and sets the URL hash", () => {
    const onActiveChange = vi.fn();
    const { result } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions", "tokens"],
        getSectionElement: fakeGetSectionElement,
        onActiveChange,
      })
    );

    act(() => {
      result.current.scrollTo("tokens");
    });

    expect(result.current.activeId).toBe("tokens");
    expect(onActiveChange).toHaveBeenCalledWith("tokens");
    expect(elements.get("tokens")?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(window.location.hash).toBe("#tokens");

    // While locked, an observer cross-fire must NOT steal the active band.
    emit(firstObserver(), [
      { target: elements.get("account") as Element, isIntersecting: true },
    ]);
    expect(result.current.activeId).toBe("tokens");
  });

  it("moves focus to the target section heading on jump (a11y)", () => {
    const { result } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions", "tokens"],
        getSectionElement: fakeGetSectionElement,
      })
    );

    act(() => {
      result.current.scrollTo("sessions");
    });

    const heading = document.getElementById("sessions-heading");
    expect(heading).not.toBeNull();
    // The heading is made programmatically focusable (-1 keeps it out of tab order).
    expect(heading?.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading);
  });

  it("holds the lock against a late cross-fire until scrollend (not just 2 rAF)", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useScrollSpy({
          sectionIds: ["account", "sessions", "tokens"],
          getSectionElement: fakeGetSectionElement,
        })
      );

      act(() => {
        result.current.scrollTo("tokens");
      });
      expect(result.current.activeId).toBe("tokens");

      // Advance WELL past the old 2-rAF release window (~32ms) but BEFORE the
      // smooth scroll ends (fallback is 700ms; no scrollend fired yet).
      act(() => {
        vi.advanceTimersByTime(120);
      });

      // A real smooth scroll keeps firing IntersectionObserver for intermediate
      // sections after the old window — that must NOT steal the active band.
      emit(firstObserver(), [
        { target: elements.get("sessions") as Element, isIntersecting: true },
      ]);
      expect(result.current.activeId).toBe("tokens");

      // Once the scroll truly ends, the lock releases and tracking resumes.
      act(() => {
        window.dispatchEvent(new Event("scrollend"));
      });
      emit(firstObserver(), [
        { target: elements.get("account") as Element, isIntersecting: true },
      ]);
      expect(result.current.activeId).toBe("account");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the lock via the bounded fallback when scrollend never fires", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        useScrollSpy({
          sectionIds: ["account", "sessions", "tokens"],
          getSectionElement: fakeGetSectionElement,
        })
      );

      act(() => {
        result.current.scrollTo("tokens");
      });

      // No scrollend (jsdom never emits it) — the bounded fallback must still
      // release the lock so the observer is not frozen forever.
      act(() => {
        vi.advanceTimersByTime(800);
      });
      emit(firstObserver(), [
        { target: elements.get("account") as Element, isIntersecting: true },
      ]);
      expect(result.current.activeId).toBe("account");
    } finally {
      vi.useRealTimers();
    }
  });

  it("jumps instantly (behavior auto) when the user prefers reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions"],
        getSectionElement: fakeGetSectionElement,
      })
    );

    act(() => {
      result.current.scrollTo("sessions");
    });

    expect(elements.get("sessions")?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = renderHook(() =>
      useScrollSpy({
        sectionIds: ["account", "sessions"],
        getSectionElement: fakeGetSectionElement,
      })
    );
    const observer = firstObserver();
    expect(observer.disconnected).toBe(false);
    unmount();
    expect(observer.disconnected).toBe(true);
  });
});
