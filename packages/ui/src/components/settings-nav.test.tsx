import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsNav } from "#components/settings-nav";
import type { SettingsNavItem } from "#lib/settings-contract";

const ITEMS: readonly SettingsNavItem[] = [
  { id: "account", title: "Account", to: "/app/settings/account" },
  { id: "computers", title: "Computers", to: "/app/settings/computers" },
  { id: "agents", title: "Agents", to: "/app/settings/agents" },
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

describe("SettingsNav", () => {
  it("renders one nav item per section", () => {
    render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Computers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agents" })).toBeTruthy();
  });

  it("marks the active section with aria-current and fires onNavigate by id", () => {
    const onNavigate = vi.fn();
    render(
      <SettingsNav
        activeSectionId="computers"
        items={ITEMS}
        onNavigate={onNavigate}
      />
    );

    const computers = screen.getByRole("button", { name: "Computers" });
    const account = screen.getByRole("button", { name: "Account" });
    expect(computers.getAttribute("aria-current")).toBe("page");
    expect(account.getAttribute("aria-current")).toBeNull();

    fireEvent.click(account);
    expect(onNavigate).toHaveBeenCalledWith("account");
  });

  it("drives the FluidNavMenu animated active indicator from activeSectionId", async () => {
    const view = render(
      <SettingsNav
        activeSectionId="agents"
        items={ITEMS}
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

    const agentsItem = view.container.querySelector(
      '[data-fluid-nav-value="agents"]'
    );
    expect(agentsItem?.getAttribute("data-state")).toBe("active");
  });

  it("uses the AppFrame rail surface tokens for active and hover indicators", async () => {
    const view = render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={vi.fn()}
      />
    );

    const activeIndicator = await waitFor(() => {
      const indicator = view.container.querySelector(
        '[data-slot="fluid-nav-menu-active-indicator"]'
      );
      expect(indicator).toBeTruthy();
      return indicator;
    });
    expect(activeIndicator?.className).toContain("bg-interaction-active");
    expect(activeIndicator?.className).not.toContain("bg-sidebar-accent");

    const nav = view.container.querySelector(
      '[data-slot="settings-nav"]'
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
    expect(hoverIndicator?.className).not.toContain("bg-sidebar-accent");
  });

  it("uses centered Web-aligned row geometry for the default Desktop renderer", () => {
    render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={vi.fn()}
      />
    );

    const account = screen.getByRole("button", { name: "Account" });
    expect(account.className).toContain("min-h-10");
    expect(account.className).toContain("items-center");
    expect(account.className).toContain("text-sm");
  });

  it("aligns default item text states with the AppFrame rail foreground token", () => {
    render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={vi.fn()}
      />
    );

    const account = screen.getByRole("button", { name: "Account" });
    const computers = screen.getByRole("button", { name: "Computers" });
    expect(account.className).toContain("text-foreground");
    expect(computers.className).toContain("hover:text-foreground");
    expect(account.className).not.toContain("sidebar-accent-foreground");
    expect(computers.className).not.toContain("sidebar-accent-foreground");
  });

  it("does not inset the animated Settings row indicator inside another padding box", () => {
    const view = render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={vi.fn()}
      />
    );

    const nav = view.container.querySelector('[data-slot="settings-nav"]');
    expect(nav?.className).toContain("w-full");
    expect(nav?.className).not.toContain("p-2");
  });

  it("uses an injected renderLink yet still fires onNavigate on activation", () => {
    const onNavigate = vi.fn();
    const view = render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={onNavigate}
        renderLink={(item, children) => (
          <a
            data-testid={`link-${item.id}`}
            data-to={item.to}
            href={`#${item.id}`}
          >
            {children}
          </a>
        )}
      />
    );

    const link = screen.getByTestId("link-computers");
    expect(link.getAttribute("data-to")).toBe("/app/settings/computers");
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("computers");

    // The default button renderer must NOT be used when renderLink is injected.
    expect(view.container.querySelector("button[aria-current]")).toBeNull();
  });

  it("does NOT fire the onNavigate fallback for a modified or handled click on an injected link", () => {
    const onNavigate = vi.fn();
    render(
      <SettingsNav
        activeSectionId="account"
        items={ITEMS}
        onNavigate={onNavigate}
        renderLink={(item, children) => (
          <a
            data-testid={`link-${item.id}`}
            href={`#${item.id}`}
            onClick={(event) => {
              // A router Link calls preventDefault for in-app navigation.
              if (item.id === "agents") {
                event.preventDefault();
              }
            }}
          >
            {children}
          </a>
        )}
      />
    );

    const computers = screen.getByTestId("link-computers");
    fireEvent.click(computers, { metaKey: true });
    fireEvent.click(computers, { ctrlKey: true });
    fireEvent.click(computers, { shiftKey: true });
    fireEvent.click(computers, { button: 1 });
    expect(onNavigate).not.toHaveBeenCalled();

    // A click the link already handled (preventDefault) is skipped.
    fireEvent.click(screen.getByTestId("link-agents"));
    expect(onNavigate).not.toHaveBeenCalled();

    // A plain primary click the link did not handle still fires the fallback.
    fireEvent.click(computers);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("computers");
  });

  it("marks the active injected nav item with aria-current=page", () => {
    const view = render(
      <SettingsNav
        activeSectionId="agents"
        items={ITEMS}
        onNavigate={vi.fn()}
        renderLink={(item, children) => (
          <a data-testid={`link-${item.id}`} href={`#${item.id}`}>
            {children}
          </a>
        )}
      />
    );

    const activeWrapper = view.container
      .querySelector('[data-testid="link-agents"]')
      ?.closest("span[aria-current]");
    expect(activeWrapper?.getAttribute("aria-current")).toBe("page");
    expect(activeWrapper?.className).toContain("[&>*]:text-foreground");
    expect(activeWrapper?.className).not.toContain("sidebar-accent-foreground");

    const inactiveWrapper = view.container.querySelector(
      '[data-testid="link-account"]'
    )?.parentElement;
    expect(inactiveWrapper?.getAttribute("aria-current")).toBeNull();
    expect(inactiveWrapper?.className).toContain("hover:[&>*]:text-foreground");
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
        return this.hasAttribute("data-fluid-nav-index") ? 200 : 0;
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
