import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluidNavMenu, FluidNavMenuItem } from "./nav-menu";

const layoutDescriptors = new Map<
  PropertyKey,
  PropertyDescriptor | undefined
>();
let navItemWidth = 200;
let originalResizeObserver: typeof ResizeObserver | undefined;
let resizeObserverCallbacks: ResizeObserverCallback[] = [];

describe("FluidNavMenu", () => {
  beforeEach(() => {
    navItemWidth = 200;
    mockResizeObserver();
    mockNavItemLayout();
  });

  afterEach(() => {
    restoreNavItemLayout();
    restoreResizeObserver();
    cleanup();
  });

  it("renders active and hover surfaces from the menu container", async () => {
    const view = render(
      <FluidNavMenu activeValue="alpha" aria-label="Test navigation">
        <FluidNavMenuItem index={0} value="alpha">
          <button type="button">Alpha</button>
        </FluidNavMenuItem>
        <FluidNavMenuItem index={1} value="beta">
          <button type="button">Beta</button>
        </FluidNavMenuItem>
      </FluidNavMenu>
    );

    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-slot="fluid-nav-menu-active-indicator"]'
        )
      ).toBeTruthy();
    });

    const nav = view.container.querySelector("nav");
    expect(nav).toBeTruthy();
    fireEvent.mouseEnter(nav as HTMLElement);
    fireEvent.mouseMove(nav as HTMLElement, { clientX: 8, clientY: 60 });

    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-slot="fluid-nav-menu-hover-indicator"]'
        )
      ).toBeTruthy();
    });
  });

  it("remeasures the active surface when item width changes without hover", async () => {
    const view = render(
      <FluidNavMenu activeValue="alpha" aria-label="Test navigation">
        <FluidNavMenuItem index={0} value="alpha">
          <button type="button">Alpha</button>
        </FluidNavMenuItem>
      </FluidNavMenu>
    );

    await waitFor(() => {
      expect(resolveActiveIndicatorWidth(view.container)).toBe("200px");
    });

    navItemWidth = 320;
    triggerResizeObserver();

    await waitFor(() => {
      expect(resolveActiveIndicatorWidth(view.container)).toBe("320px");
    });
  });

  it("moves the active surface when the active value changes", async () => {
    const view = render(
      <FluidNavMenu activeValue="alpha" aria-label="Test navigation">
        <FluidNavMenuItem index={0} value="alpha">
          <button type="button">Alpha</button>
        </FluidNavMenuItem>
        <FluidNavMenuItem index={1} value="beta">
          <button type="button">Beta</button>
        </FluidNavMenuItem>
      </FluidNavMenu>
    );

    await waitFor(() => {
      expect(resolveActiveIndicatorTop(view.container)).toBe("0px");
    });

    view.rerender(
      <FluidNavMenu activeValue="beta" aria-label="Test navigation">
        <FluidNavMenuItem index={0} value="alpha">
          <button type="button">Alpha</button>
        </FluidNavMenuItem>
        <FluidNavMenuItem index={1} value="beta">
          <button type="button">Beta</button>
        </FluidNavMenuItem>
      </FluidNavMenu>
    );

    await waitFor(() => {
      expect(resolveActiveIndicatorTop(view.container)).toBe("40px");
    });
  });
});

function resolveActiveIndicatorWidth(container: HTMLElement): string | null {
  return (
    container.querySelector<HTMLElement>(
      '[data-slot="fluid-nav-menu-active-indicator"]'
    )?.style.width ?? null
  );
}

function resolveActiveIndicatorTop(container: HTMLElement): string | null {
  return (
    container.querySelector<HTMLElement>(
      '[data-slot="fluid-nav-menu-active-indicator"]'
    )?.style.top ?? null
  );
}

function mockResizeObserver() {
  originalResizeObserver = globalThis.ResizeObserver;
  resizeObserverCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallbacks.push(callback);
    }

    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
  } as unknown as typeof ResizeObserver;
}

function restoreResizeObserver() {
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      undefined;
  }
  resizeObserverCallbacks = [];
}

function triggerResizeObserver() {
  act(() => {
    for (const callback of resizeObserverCallbacks) {
      callback([], {} as ResizeObserver);
    }
  });
}

function mockNavItemLayout() {
  const properties = {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-fluid-nav-index") ? 40 : 0;
      },
    },
    offsetLeft: {
      configurable: true,
      get() {
        return 0;
      },
    },
    offsetTop: {
      configurable: true,
      get(this: HTMLElement) {
        const index = Number(this.getAttribute("data-fluid-nav-index") ?? "0");
        return Number.isFinite(index) ? index * 40 : 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-fluid-nav-index") ? navItemWidth : 0;
      },
    },
  } satisfies Record<PropertyKey, PropertyDescriptor>;

  for (const [property, descriptor] of Object.entries(properties)) {
    layoutDescriptors.set(
      property,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, property)
    );
    Object.defineProperty(HTMLElement.prototype, property, descriptor);
  }
}

function restoreNavItemLayout() {
  for (const [property, descriptor] of layoutDescriptors) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
      continue;
    }

    delete HTMLElement.prototype[property as keyof HTMLElement];
  }
  layoutDescriptors.clear();
}
