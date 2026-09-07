import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FluidNavMenu, FluidNavMenuItem } from "./nav-menu";

afterEach(cleanup);
function Navigation({ active }: { active: string | null }) {
  return (
    <FluidNavMenu
      activeLayoutId="test-navigation"
      activeValue={active}
      aria-label="Test navigation"
    >
      <FluidNavMenuItem index={0} value="alpha">
        <a href="/alpha">Alpha</a>
      </FluidNavMenuItem>
      <FluidNavMenuItem index={1} value="beta">
        <a href="/beta">Beta</a>
      </FluidNavMenuItem>
    </FluidNavMenu>
  );
}
describe("FluidNavMenu", () => {
  it("shares the sidebar primitive and transfers one selection between real navigation links", () => {
    const view = render(<Navigation active="alpha" />);
    const alpha = screen.getByRole("link", { name: "Alpha" });
    expect(alpha.getAttribute("href")).toBe("/alpha");
    expect(
      alpha.closest('[data-sidebar="menu-item"]')?.getAttribute("data-active")
    ).toBe("true");
    view.rerender(<Navigation active="beta" />);
    expect(
      alpha.closest('[data-sidebar="menu-item"]')?.getAttribute("data-active")
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Beta" })
        .closest('[data-sidebar="menu-item"]')
        ?.getAttribute("data-active")
    ).toBe("true");
    expect(
      view.container.querySelectorAll(
        '[data-slot="fluid-nav-menu-active-indicator"]'
      )
    ).toHaveLength(1);
    view.rerender(<Navigation active={null} />);
    expect(
      view.container.querySelector(
        '[data-slot="fluid-nav-menu-active-indicator"]'
      )
    ).toBeNull();
  });
  it("does not select disabled rows", () => {
    const view = render(
      <FluidNavMenu activeValue="alpha" aria-label="Test navigation">
        <FluidNavMenuItem disabled index={0} value="alpha">
          <button disabled type="button">
            Alpha
          </button>
        </FluidNavMenuItem>
      </FluidNavMenu>
    );
    expect(
      view.container.querySelector(
        '[data-slot="fluid-nav-menu-active-indicator"]'
      )
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Alpha" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
