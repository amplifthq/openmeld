import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuTrigger } from "#components/dropdown-menu";
import {
  FluidDropdownMenuContent,
  FluidDropdownMenuItem,
} from "./dropdown-menu";

describe("FluidDropdownMenu", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      }
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: {
        configurable: true,
        get() {
          return this.hasAttribute("data-proximity-index") ? 40 : 0;
        },
      },
      offsetLeft: { configurable: true, get: () => 0 },
      offsetTop: {
        configurable: true,
        get() {
          return Number(this.getAttribute("data-proximity-index") ?? "0") * 40;
        },
      },
      offsetWidth: {
        configurable: true,
        get() {
          return this.hasAttribute("data-proximity-index") ? 192 : 0;
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps menu semantics while moving one Fluid background between items", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Profile options</DropdownMenuTrigger>
        <FluidDropdownMenuContent>
          <FluidDropdownMenuItem index={0}>View profile</FluidDropdownMenuItem>
          <FluidDropdownMenuItem index={1}>Edit profile</FluidDropdownMenuItem>
        </FluidDropdownMenuContent>
      </DropdownMenu>
    );

    const menu = await screen.findByRole("menu");
    const editItem = screen.getByRole("menuitem", { name: "Edit profile" });
    const fluidList = menu.querySelector('[data-slot="fluid-action-list"]');
    expect(fluidList).not.toBeNull();

    fireEvent.mouseEnter(fluidList as HTMLElement);
    fireEvent.mouseMove(fluidList as HTMLElement, { clientY: 50 });

    expect(editItem.getAttribute("data-hovered")).toBe("true");
    expect(
      menu.querySelectorAll('[data-slot="fluid-action-list-hover-indicator"]')
    ).toHaveLength(1);
  });

  it("preserves keyboard navigation and Escape focus restoration", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Profile options</DropdownMenuTrigger>
        <FluidDropdownMenuContent>
          <FluidDropdownMenuItem index={0}>View profile</FluidDropdownMenuItem>
          <FluidDropdownMenuItem index={1}>Edit profile</FluidDropdownMenuItem>
        </FluidDropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole("button", { name: "Profile options" });
    fireEvent.click(trigger);
    const viewItem = await screen.findByRole("menuitem", {
      name: "View profile",
    });

    fireEvent.keyDown(viewItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Edit profile" })
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
