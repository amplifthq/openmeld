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
  it.each([
    2, 3, 4,
  ])("tracks each tile in a %i-column grid", async (columns) => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrame = () =>
      act(() => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) {
          callback(performance.now());
        }
      });
    const indexOf = (el: HTMLElement) =>
      Number(el.closest("li")?.getAttribute("data-fluid-nav-index") ?? 0);
    for (const [property, value] of Object.entries({
      offsetWidth: (el: HTMLElement) =>
        el.tagName === "UL" ? columns * 100 : 96,
      offsetHeight: (el: HTMLElement) => (el.tagName === "UL" ? 208 : 100),
      offsetLeft: (el: HTMLElement) => (indexOf(el) % columns) * 100,
      offsetTop: (el: HTMLElement) => Math.floor(indexOf(el) / columns) * 104,
    })) {
      vi.spyOn(
        HTMLElement.prototype,
        property as "offsetWidth",
        "get"
      ).mockImplementation(function (this: HTMLElement) {
        return value(this);
      });
    }
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: columns * 100,
      height: 208,
      right: columns * 100,
      bottom: 208,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    render(
      <FluidNavMenu activeValue={null} aria-label="Grid" hoverAxis="xy">
        {Array.from({ length: columns * 2 }, (_, index) => String(index)).map(
          (id, index) => (
            <FluidNavMenuItem index={index} key={id} value={id}>
              <a href={`#${id}`}>Tile {id}</a>
            </FluidNavMenuItem>
          )
        )}
      </FluidNavMenu>
    );
    await act(() => Promise.resolve());
    flushFrame();
    const list = screen.getByRole("list");
    fireEvent.mouseEnter(list);
    for (let index = 0; index < columns * 2; index++) {
      fireEvent.mouseMove(list, {
        clientX: (index % columns) * 100 + 48,
        clientY: Math.floor(index / columns) * 104 + 50,
      });
      flushFrame();
      expect(list.querySelector("[data-fluid-hover-active]")?.textContent).toBe(
        `Tile ${index}`
      );
    }
    fireEvent.mouseLeave(list);
    expect(list.querySelector("[data-fluid-hover-active]")).toBeNull();
  });
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
