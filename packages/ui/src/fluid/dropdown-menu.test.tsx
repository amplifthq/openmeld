import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, ContextMenuTrigger } from "#components/context-menu";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "#components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import { FluidContextMenu } from "./context-menu";
import {
  FluidDropdownMenuContent,
  FluidDropdownMenuItem,
  FluidDropdownMenuRadioItem,
} from "./dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./sidebar-menu";

// jsdom has no active Web Animations for Base UI to wait for.
if (typeof Element.prototype.getAnimations === "undefined") {
  Element.prototype.getAnimations = () => [];
}

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

    await waitFor(() => {
      expect(editItem.getAttribute("data-hovered")).toBe("true");
    });
    expect(
      menu.querySelectorAll('[data-slot="fluid-hover-highlight"]')
    ).toHaveLength(1);
  });

  it.each([
    "dropdown",
    "context",
  ])("preserves keyboard navigation and Escape focus restoration for %s menus", async (kind) => {
    const Root = kind === "context" ? ContextMenu : DropdownMenu;
    const Trigger =
      kind === "context" ? ContextMenuTrigger : DropdownMenuTrigger;
    render(
      <Root>
        <Trigger render={<button type="button" />}>Profile options</Trigger>
        <FluidDropdownMenuContent>
          <FluidDropdownMenuItem index={0}>View profile</FluidDropdownMenuItem>
          <FluidDropdownMenuItem index={1}>Edit profile</FluidDropdownMenuItem>
        </FluidDropdownMenuContent>
      </Root>
    );

    const trigger = screen.getByRole("button", { name: "Profile options" });
    trigger.focus();
    if (kind === "context") {
      fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    } else {
      fireEvent.click(trigger);
    }
    const viewItem = await screen.findByRole("menuitem", {
      name: "View profile",
    });
    act(() => viewItem.focus());
    fireEvent.keyDown(viewItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Edit profile" })
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("shares hover feedback across radio choices without losing selection or keyboard semantics", async () => {
    const onValueChange = vi.fn();
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Notifications</DropdownMenuTrigger>
        <FluidDropdownMenuContent>
          <DropdownMenuRadioGroup
            defaultValue="all"
            onValueChange={onValueChange}
          >
            <FluidDropdownMenuRadioItem index={0} value="all">
              All messages
            </FluidDropdownMenuRadioItem>
            <FluidDropdownMenuRadioItem index={1} value="muted">
              Mute
            </FluidDropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </FluidDropdownMenuContent>
      </DropdownMenu>
    );
    const menu = await screen.findByRole("menu");
    const all = screen.getByRole("menuitemradio", { name: "All messages" });
    const mute = screen.getByRole("menuitemradio", { name: "Mute" });
    expect(all.getAttribute("aria-checked")).toBe("true");
    const list = menu.querySelector(
      '[data-slot="fluid-action-list"]'
    ) as HTMLElement;
    fireEvent.mouseEnter(list);
    fireEvent.mouseMove(list, { clientY: 50 });
    await waitFor(() => expect(mute.getAttribute("data-hovered")).toBe("true"));
    expect(
      menu.querySelectorAll('[data-slot="fluid-hover-highlight"]')
    ).toHaveLength(1);
    act(() => all.focus());
    fireEvent.keyDown(all, { key: "ArrowDown" });
    expect(document.activeElement).toBe(mute);
    fireEvent.click(mute);
    expect(onValueChange.mock.calls[0]?.[0]).toBe("muted");
    expect(mute.getAttribute("aria-checked")).toBe("true");
  });

  it("suspends sidebar hover while its context menu is open and resumes after dismissal", async () => {
    Object.defineProperties(HTMLElement.prototype, {
      offsetHeight: { configurable: true, get: () => 40 },
      offsetWidth: { configurable: true, get: () => 200 },
    });
    const { container } = render(
      <SidebarMenu>
        <SidebarMenuItem>
          <Tooltip defaultOpen>
            <FluidContextMenu
              target={
                <TooltipTrigger
                  render={
                    <SidebarMenuButton>Release planning</SidebarMenuButton>
                  }
                />
              }
            >
              <FluidDropdownMenuItem index={0}>Open</FluidDropdownMenuItem>
              <FluidDropdownMenuItem index={1}>Copy link</FluidDropdownMenuItem>
            </FluidContextMenu>
            <TooltipContent>Release planning tooltip</TooltipContent>
          </Tooltip>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton>Product design</SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
    const trigger = screen.getByRole("button", { name: "Release planning" });
    await screen.findByRole("tooltip");
    fireEvent.mouseMove(trigger, { clientX: 10, clientY: 10 });
    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="sidebar-menu-hover-indicator"]')
      ).not.toBeNull()
    );
    fireEvent.contextMenu(trigger, { clientX: 10, clientY: 10 });
    fireEvent.mouseLeave(screen.getByRole("list", { hidden: true }));
    const menu = await screen.findByRole("menu");
    const copy = screen.getByRole("menuitem", { name: "Copy link" });
    fireEvent.mouseMove(copy, { clientX: 20, clientY: 50 });
    await waitFor(() => expect(copy.getAttribute("data-hovered")).toBe("true"));
    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="sidebar-menu-hover-indicator"]')
      ).toBeNull()
    );
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.mouseMove(
      screen.getByRole("button", { name: "Product design" }),
      { clientX: 20, clientY: 50 }
    );
    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="sidebar-menu-hover-indicator"]')
      ).not.toBeNull()
    );
  });
});
