import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "#components/tooltip";
import { AppOuterRail, type AppOuterRailDestination } from "./app-outer-rail";

const DESTINATIONS: readonly AppOuterRailDestination[] = [
  {
    id: "home",
    label: "Home",
    icon: <span aria-hidden="true">H</span>,
  },
  {
    id: "profiles",
    label: "Directory",
    icon: <span aria-hidden="true">P</span>,
  },
  {
    id: "settings",
    label: "Settings",
    icon: <span aria-hidden="true">S</span>,
  },
];

afterEach(cleanup);

describe("AppOuterRail", () => {
  it("renders the expanded Web-style rail with the shared hover surface token", () => {
    renderRail();

    const rail = screen.getByTestId("app-outer-rail");
    expect(rail.getAttribute("data-state")).toBe("expanded");
    expect(within(rail).getByRole("button", { name: "Home" })).toBeTruthy();
    expect(
      within(rail).getByRole("button", { name: "Toggle Sidebar" }).className
    ).toContain("bg-background");
    expect(
      within(rail).getByRole("button", { name: "Toggle Sidebar" }).className
    ).toContain("z-10");
    expect(
      rail.querySelector('[data-slot="sidebar-header"]')?.className
    ).toContain("h-[var(--space-conversation-header-height)]");
    const header = rail.querySelector('[data-slot="sidebar-header"]');
    expect(header).toBeTruthy();
    if (!(header instanceof HTMLElement)) {
      return;
    }
    expect(
      within(header).getByRole("button", { name: "Go Home" }).className
    ).toContain("overflow-hidden");

    const nav = within(rail).getByRole("navigation", {
      name: "App sections",
    });
    expect(nav.querySelector('[data-fluid-nav-value="home"]')).toBeTruthy();
    const home = within(rail).getByRole("button", { name: "Home" });
    expect(home.className).not.toContain("focus-visible:ring");
    expect(home.className).not.toContain("focus-visible:border");
  });

  it("collapses to icon-only destinations and keeps the toggle above navigation", () => {
    renderRail({ collapsed: true });

    const rail = screen.getByTestId("app-outer-rail");
    const header = rail.querySelector('[data-slot="sidebar-header"]');
    const content = rail.querySelector('[data-slot="sidebar-content"]');
    expect(header).toBeTruthy();
    expect(content).toBeTruthy();
    if (!(header instanceof HTMLElement && content instanceof HTMLElement)) {
      return;
    }

    expect(rail.getAttribute("data-state")).toBe("collapsed");
    expect(
      within(header).getByRole("button", { name: "Go Home" })
    ).toBeTruthy();
    expect(
      within(header).queryByRole("button", { name: "Toggle Sidebar" })
    ).toBeNull();
    expect(within(content).queryByText("Home")).toBeNull();

    const trigger = within(content).getByRole("button", {
      name: "Toggle Sidebar",
    });
    const home = within(content).getByRole("button", { name: "Home" });
    const actionOrder = Array.from(content.querySelectorAll("button, a"));
    expect(actionOrder.indexOf(trigger)).toBeLessThan(
      actionOrder.indexOf(home)
    );
    expect(home.className).toContain("size-9");
    expect(home.closest("[data-fluid-nav-value='home']")?.className).toContain(
      "mx-auto"
    );
  });

  it("lets the host control collapse state through the trigger and keyboard shortcut", () => {
    const view = render(<ControlledRail />);
    const rail = screen.getByTestId("app-outer-rail");

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(rail.getAttribute("data-state")).toBe("collapsed");

    fireEvent.keyDown(window, { key: "B", metaKey: true });
    expect(rail.getAttribute("data-state")).toBe("expanded");

    view.unmount();
  });

  it("does not render a resize rail unless the host enables it", () => {
    const { rerender } = renderRail({ resizeRail: false });
    expect(
      screen.queryByRole("separator", { name: "Resize app rail" })
    ).toBeNull();

    rerender(
      <TooltipProvider>
        <AppOuterRail
          account={{ label: "Felix" }}
          activeDestinationId="home"
          collapsed={false}
          destinations={DESTINATIONS}
          onCollapsedChange={() => undefined}
          onNavigate={() => undefined}
          resizeRail
        />
      </TooltipProvider>
    );
    expect(
      screen.getByRole("separator", { name: "Resize app rail" })
    ).toBeTruthy();
  });
});

function ControlledRail() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider>
      <AppOuterRail
        account={{ label: "Felix" }}
        activeDestinationId="home"
        collapsed={collapsed}
        destinations={DESTINATIONS}
        onCollapsedChange={setCollapsed}
        onNavigate={() => undefined}
      />
    </TooltipProvider>
  );
}

function renderRail(input: { collapsed?: boolean; resizeRail?: boolean } = {}) {
  return render(
    <TooltipProvider>
      <AppOuterRail
        account={{ label: "Felix" }}
        activeDestinationId="home"
        collapsed={input.collapsed ?? false}
        destinations={DESTINATIONS}
        onCollapsedChange={() => undefined}
        onNavigate={() => undefined}
        resizeRail={input.resizeRail}
      />
    </TooltipProvider>
  );
}
