import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "#components/app-frame";
import type { RailDestination } from "#lib/shell-contract";

const DESTINATIONS: readonly RailDestination[] = [
  { id: "spaces", label: "Spaces", to: "/app/spaces" },
  { id: "settings", label: "Settings", to: "/app/settings" },
];

const layoutDescriptors = new Map<
  PropertyKey,
  PropertyDescriptor | undefined
>();

beforeEach(() => {
  mockNavItemLayout();
});

afterEach(() => {
  restoreNavItemLayout();
  cleanup();
});

describe("AppFrame", () => {
  it("renders brand, destinations, account, and the required content", () => {
    render(
      <AppFrame
        account={<span>Account</span>}
        activeDestinationId="spaces"
        brand={<span>OpenMeld</span>}
        content={<div>Conversation</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText("OpenMeld")).toBeTruthy();
    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.getByText("Conversation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spaces" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("marks the active destination with aria-current and calls onNavigate by id", () => {
    const onNavigate = vi.fn();
    render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={onNavigate}
      />
    );

    const spaces = screen.getByRole("button", { name: "Spaces" });
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(spaces.getAttribute("aria-current")).toBe("page");
    expect(settings.getAttribute("aria-current")).toBeNull();

    fireEvent.click(settings);
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("drives the shared active rail indicator from activeDestinationId", async () => {
    const view = render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
      />
    );

    const spaces = screen.getByRole("button", { name: "Spaces" });
    const settings = screen.getByRole("button", { name: "Settings" });
    const activeItem = view.container.querySelector(
      '[data-fluid-nav-value="spaces"]'
    );

    const activeIndicator = await waitFor(() => {
      const indicator = view.container.querySelector(
        '[data-slot="fluid-nav-menu-active-indicator"]'
      );
      expect(indicator).toBeTruthy();
      return indicator;
    });
    expect(activeIndicator?.className).toContain("bg-interaction-active");
    expect(activeItem?.getAttribute("data-state")).toBe("active");

    expect(settings.className).not.toContain("hover:bg-interaction-hover");
    expect(settings.className).not.toContain("bg-interaction-active");
    expect(spaces.className).not.toContain("hover:bg-interaction-hover");
    expect(spaces.className).not.toContain("bg-interaction-active");
    expect(spaces.className).toContain("text-foreground");
  });

  it("uses the shared hover rail indicator with the aligned surface token", async () => {
    const view = render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(
        view.container.querySelector(
          '[data-slot="fluid-nav-menu-active-indicator"]'
        )
      ).toBeTruthy();
    });

    const nav = view.container.querySelector(
      '[data-slot="app-frame-destinations"]'
    ) as HTMLElement;
    fireEvent.mouseEnter(nav.querySelector("ul") as HTMLElement);
    fireEvent.mouseMove(nav.querySelector("ul") as HTMLElement, {
      clientX: 0,
      clientY: 45,
    });

    const hoverIndicator = await waitFor(() => {
      const indicator = view.container.querySelector(
        '[data-slot="sidebar-menu-hover-indicator"]'
      );
      expect(indicator).toBeTruthy();
      return indicator;
    });
    expect(hoverIndicator?.className).toContain("bg-interaction-hover");
  });

  it("uses an injected renderRailLink yet still fires onNavigate as a fallback", () => {
    const onNavigate = vi.fn();
    render(
      <AppFrame
        activeDestinationId="settings"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={onNavigate}
        renderRailLink={(destination, children) => (
          <a
            data-testid={`link-${destination.id}`}
            data-to={destination.to}
            href={`#${destination.id}`}
          >
            {children}
          </a>
        )}
      />
    );

    const link = screen.getByTestId("link-spaces");
    expect(link.getAttribute("data-to")).toBe("/app/spaces");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("spaces");
  });

  it("does NOT fire the onNavigate fallback for a modified or handled click on an injected link", () => {
    const onNavigate = vi.fn();
    render(
      <AppFrame
        activeDestinationId="settings"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={onNavigate}
        renderRailLink={(destination, children) => (
          <a
            data-testid={`link-${destination.id}`}
            href={`#${destination.id}`}
            onClick={(event) => {
              // A router Link calls preventDefault for in-app navigation.
              if (destination.id === "settings") {
                event.preventDefault();
              }
            }}
          >
            {children}
          </a>
        )}
      />
    );

    const spaces = screen.getByTestId("link-spaces");
    // Cmd/Ctrl/Shift-click (open-in-new-tab) must be owned by the link, not us.
    fireEvent.click(spaces, { metaKey: true });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(spaces, { ctrlKey: true });
    fireEvent.click(spaces, { shiftKey: true });
    fireEvent.click(spaces, { button: 1 });
    expect(onNavigate).not.toHaveBeenCalled();

    // A click the injected link already handled (preventDefault) is skipped too.
    const settings = screen.getByTestId("link-settings");
    fireEvent.click(settings);
    expect(onNavigate).not.toHaveBeenCalled();

    // A plain primary click the link did not handle still fires the fallback.
    fireEvent.click(spaces);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("spaces");
  });

  it("marks the active injected rail item with aria-current=page", () => {
    render(
      <AppFrame
        activeDestinationId="settings"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
        renderRailLink={(destination, children) => (
          <a data-testid={`link-${destination.id}`} href={`#${destination.id}`}>
            {children}
          </a>
        )}
      />
    );

    const items = document.querySelectorAll(
      '[data-slot="app-frame-rail-item"] > span'
    );
    const active = Array.from(items).find(
      (item) => item.getAttribute("aria-current") === "page"
    );
    expect(active).toBeTruthy();
    expect(active?.querySelector('[data-testid="link-settings"]')).toBeTruthy();
    // The inactive item exposes no aria-current.
    const inactive = Array.from(items).find((item) =>
      item.querySelector('[data-testid="link-spaces"]')
    );
    expect(inactive?.getAttribute("aria-current")).toBeNull();
  });

  it("uses the shared active rail indicator for injected rail links", async () => {
    const view = render(
      <AppFrame
        activeDestinationId="settings"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
        renderRailLink={(destination, children) => (
          <a data-testid={`link-${destination.id}`} href={`#${destination.id}`}>
            {children}
          </a>
        )}
      />
    );

    const active = document.querySelector(
      '[data-slot="app-frame-rail-item"] > span[aria-current="page"]'
    );
    const inactive = document.querySelector(
      '[data-testid="link-spaces"]'
    )?.parentElement;
    const activeItem = view.container.querySelector(
      '[data-fluid-nav-value="settings"]'
    );

    const activeIndicator = await waitFor(() => {
      const indicator = view.container.querySelector(
        '[data-slot="fluid-nav-menu-active-indicator"]'
      );
      expect(indicator).toBeTruthy();
      return indicator;
    });
    expect(activeIndicator?.className).toContain("bg-interaction-active");
    expect(activeItem?.getAttribute("data-state")).toBe("active");

    expect(inactive?.className).not.toContain(
      "hover:[&>*]:bg-interaction-hover"
    );
    expect(inactive?.className).not.toContain("[&>*]:bg-interaction-active");
    expect(active?.className).not.toContain("hover:[&>*]:bg-interaction-hover");
    expect(active?.className).not.toContain("[&>*]:bg-interaction-active");
    expect(active?.className).toContain("[&>*]:text-foreground");
  });

  it("renders the optional railList, header, and aside slots only when provided", () => {
    const { rerender } = render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
      />
    );

    expect(
      document.querySelector('[data-slot="app-frame-rail-list"]')
    ).toBeNull();
    expect(document.querySelector('[data-slot="app-frame-header"]')).toBeNull();
    expect(document.querySelector('[data-slot="app-frame-aside"]')).toBeNull();

    rerender(
      <AppFrame
        activeDestinationId="spaces"
        aside={<div>Members</div>}
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        header={<div>Space header</div>}
        onNavigate={vi.fn()}
        railList={<div>Spaces list</div>}
      />
    );

    expect(screen.getByText("Spaces list")).toBeTruthy();
    expect(screen.getByText("Space header")).toBeTruthy();
    expect(screen.getByText("Members")).toBeTruthy();
    expect(
      document.querySelector('[data-slot="app-frame-rail-list"]')
    ).toBeTruthy();
  });

  it("keeps the shell panels on one background surface", () => {
    render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        onNavigate={vi.fn()}
        railList={<div>List</div>}
      />
    );

    const rail = document.querySelector('[data-slot="app-frame-rail"]');
    const railList = document.querySelector(
      '[data-slot="app-frame-rail-list"]'
    );
    const main = document.querySelector('[data-slot="app-frame-main"]');

    expect(rail?.className).toContain("bg-background");
    expect(railList?.className).toContain("bg-background");
    expect(main?.className).toContain("bg-background");
  });

  it("keeps the content header height aligned with sidebar headers", () => {
    render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={DESTINATIONS}
        header={<div>Header</div>}
        onNavigate={vi.fn()}
      />
    );

    const header = document.querySelector('[data-slot="app-frame-header"]');
    expect(header?.className).toContain(
      "h-[var(--space-conversation-header-height)]"
    );
    expect(header?.className).toContain("border-b");
  });

  it("supports a fixed expanded rail with a full rail header", () => {
    render(
      <AppFrame
        activeDestinationId="spaces"
        content={<div>Content</div>}
        destinations={[
          { id: "spaces", icon: <span aria-hidden>◇</span>, label: "Spaces" },
          {
            id: "settings",
            icon: <span aria-hidden>□</span>,
            label: "Settings",
          },
        ]}
        onNavigate={vi.fn()}
        railHeader={<div>Rail brand</div>}
        railMode="expanded"
      />
    );

    const rail = document.querySelector('[data-slot="app-frame-rail"]');
    expect(rail?.className).toContain("w-44");
    expect(screen.getByText("Rail brand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spaces" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });
});

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
        return this.hasAttribute("data-fluid-nav-index") ? 40 : 0;
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
