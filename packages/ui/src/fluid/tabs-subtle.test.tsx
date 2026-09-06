import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabsSubtle, TabsSubtleItem } from "./tabs-subtle";

const layoutDescriptors = new Map<
  PropertyKey,
  PropertyDescriptor | undefined
>();

describe("TabsSubtle", () => {
  beforeEach(() => {
    mockTabLayout();
  });

  afterEach(() => {
    restoreTabLayout();
    cleanup();
  });

  it("renders the selected surface and reports tab selection", async () => {
    const handleSelect = vi.fn();

    const view = render(
      <TabsSubtle onSelect={handleSelect} selectedIndex={0}>
        <TabsSubtleItem index={0} label="Alpha" />
        <TabsSubtleItem index={1} label="Beta" />
      </TabsSubtle>
    );

    const alphaTab = screen.getByRole("tab", { name: "Alpha" });
    expect(alphaTab.className).toContain("h-7");
    expect(alphaTab.className).toContain("max-lg:min-h-11");
    expect(alphaTab.className).toContain("max-lg:min-w-11");
    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-slot="tabs-subtle-selected-indicator"]'
        )
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));

    expect(handleSelect).toHaveBeenCalledWith(1);
  });

  it("moves focus with arrow keys", () => {
    render(
      <TabsSubtle onSelect={vi.fn()} selectedIndex={0}>
        <TabsSubtleItem index={0} label="Alpha" />
        <TabsSubtleItem index={1} label="Beta" />
      </TabsSubtle>
    );

    const alphaTab = screen.getByRole("tab", { name: "Alpha" });
    const betaTab = screen.getByRole("tab", { name: "Beta" });

    alphaTab.focus();
    fireEvent.keyDown(alphaTab, { key: "ArrowRight" });

    expect(document.activeElement).toBe(betaTab);
  });

  it("renders the ghost variant without a surrounding segmented surface", async () => {
    const view = render(
      <TabsSubtle onSelect={vi.fn()} selectedIndex={0} variant="ghost">
        <TabsSubtleItem index={0} label="Messages" />
        <TabsSubtleItem index={1} label="Graph" />
      </TabsSubtle>
    );

    const tabList = screen.getByRole("tablist");
    expect(tabList.className).toContain("bg-transparent");
    expect(tabList.className).not.toContain("bg-background/40");

    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-slot="tabs-subtle-selected-indicator"]'
        )?.className
      ).toContain("border-transparent");
    });
  });

  it("renders the underline variant without rounded selection surfaces", () => {
    const view = render(
      <TabsSubtle onSelect={vi.fn()} selectedIndex={0} variant="underline">
        <TabsSubtleItem index={0} label="Messages" />
        <TabsSubtleItem index={1} label="Graph" />
      </TabsSubtle>
    );

    const tabList = screen.getByRole("tablist");
    const selectedTab = screen.getByRole("tab", { name: "Messages" });

    expect(tabList.getAttribute("data-variant")).toBe("underline");
    fireEvent.focus(selectedTab);
    expect(
      view.container.querySelector('[data-slot="tabs-subtle-hover-indicator"]')
    ).toBeNull();
    expect(tabList.className).toContain("bg-transparent");
    expect(tabList.className).toContain("overflow-visible");
    expect(selectedTab.className).not.toContain("rounded-md");
    expect(
      selectedTab.querySelector('[data-slot="tabs-subtle-underline"]')
    ).not.toBeNull();
    view.rerender(
      <TabsSubtle onSelect={vi.fn()} selectedIndex={1} variant="underline">
        <TabsSubtleItem index={0} label="Messages" />
        <TabsSubtleItem index={1} label="Graph" />
      </TabsSubtle>
    );
    expect(
      selectedTab.querySelector('[data-slot="tabs-subtle-underline"]')
    ).toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "Graph" })
        .querySelector('[data-slot="tabs-subtle-underline"]')
    ).not.toBeNull();
    expect(
      view.container.querySelector(
        '[data-slot="tabs-subtle-selected-indicator"]'
      )
    ).toBeNull();
    expect(
      view.container.querySelector('[data-slot="tabs-subtle-hover-indicator"]')
    ).toBeNull();
  });
});

function mockTabLayout() {
  const properties = {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-proximity-index") ? 28 : 0;
      },
    },
    offsetLeft: {
      configurable: true,
      get(this: HTMLElement) {
        const index = Number(this.getAttribute("data-proximity-index") ?? "0");
        return Number.isFinite(index) ? index * 80 : 0;
      },
    },
    offsetTop: {
      configurable: true,
      get() {
        return 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-proximity-index") ? 80 : 0;
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

function restoreTabLayout() {
  for (const [property, descriptor] of layoutDescriptors) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
      continue;
    }

    delete HTMLElement.prototype[property as keyof HTMLElement];
  }
  layoutDescriptors.clear();
}
