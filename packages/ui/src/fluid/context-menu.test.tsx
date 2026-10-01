import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  FluidContextMenu,
  FluidContextMenuContent,
  FluidContextMenuScope,
} from "./context-menu";
import { FluidDropdownMenuItem } from "./dropdown-menu";

if (typeof Element.prototype.getAnimations === "undefined") {
  Element.prototype.getAnimations = () => [];
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
});

describe("Fluid context menu scope", () => {
  it.each([
    "input",
    "selection",
    "disabled",
  ])("leaves the native %s context menu available", (kind) => {
    render(
      <FluidContextMenuScope
        disabled={kind === "disabled"}
        target={
          <article>
            <input aria-label="Name" />
            <p>Selectable message</p>
          </article>
        }
      >
        <FluidContextMenuContent>
          <FluidDropdownMenuItem index={0}>Copy link</FluidDropdownMenuItem>
        </FluidContextMenuContent>
      </FluidContextMenuScope>
    );
    const message = screen.getByText("Selectable message");
    if (kind === "selection") {
      const range = document.createRange();
      range.selectNodeContents(message);
      window.getSelection()?.addRange(range);
    }
    const target =
      kind === "input"
        ? screen.getByRole("textbox", { name: "Name" })
        : message;
    expect(fireEvent.contextMenu(target)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens only the nearest object menu inside a parent scope", async () => {
    render(
      <FluidContextMenu
        target={
          <div>
            <FluidContextMenu target={<button type="button">Space</button>}>
              <FluidDropdownMenuItem index={0}>Pin</FluidDropdownMenuItem>
            </FluidContextMenu>
          </div>
        }
      >
        <FluidDropdownMenuItem index={0}>Sidebar display</FluidDropdownMenuItem>
      </FluidContextMenu>
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Space" }));
    expect(await screen.findByRole("menuitem", { name: "Pin" })).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(
      screen.queryByRole("menuitem", { name: "Sidebar display" })
    ).toBeNull();
  });
});
