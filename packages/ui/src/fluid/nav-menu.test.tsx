import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluidNavMenu, FluidNavMenuItem } from "./nav-menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
  it("bounds ordering work when a long menu mounts and keeps new rows reachable", async () => {
    const compare = vi.spyOn(Node.prototype, "compareDocumentPosition");
    const ids = Array.from({ length: 100 }, (_, index) => String(index));
    const menu = (values: string[]) => (
      <FluidNavMenu activeValue={null} aria-label="Long navigation">
        {values.map((id, index) => (
          <FluidNavMenuItem index={index} key={id} value={id}>
            <a href={`#${id}`}>Row {id}</a>
          </FluidNavMenuItem>
        ))}
      </FluidNavMenu>
    );
    const view = render(menu(ids));
    await act(() => Promise.resolve());
    // A bulk mount must not sort every growing prefix of the same list.
    expect(compare.mock.calls.length).toBeLessThan(1400);
    view.rerender(menu(["new", ...ids.slice(1)]));
    await act(() => Promise.resolve());
    const link = screen.getByText("Row new");
    fireEvent.focus(link);
    expect(link.closest("li")?.hasAttribute("data-fluid-hover-active")).toBe(
      true
    );
    expect(screen.queryByText("Row 0")).toBeNull();
  });
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
