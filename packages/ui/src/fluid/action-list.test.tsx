import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluidActionList, FluidActionListItem } from "./action-list";

describe("FluidActionList", () => {
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
          return this.hasAttribute("data-proximity-index") ? 56 : 0;
        },
      },
      offsetLeft: { configurable: true, get: () => 0 },
      offsetTop: {
        configurable: true,
        get() {
          return Number(this.getAttribute("data-proximity-index") ?? "0") * 56;
        },
      },
      offsetWidth: {
        configurable: true,
        get() {
          return this.hasAttribute("data-proximity-index") ? 320 : 0;
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves one shared hover background between semantic action buttons", () => {
    render(
      <FluidActionList aria-label="Starting points">
        <FluidActionListItem index={0}>Show me around</FluidActionListItem>
        <FluidActionListItem index={1}>Start something new</FluidActionListItem>
      </FluidActionList>
    );

    const group = screen.getByRole("group", { name: "Starting points" });
    const secondAction = screen.getByRole("button", {
      name: "Start something new",
    });

    fireEvent.mouseEnter(group);
    fireEvent.mouseMove(group, { clientY: 70 });

    expect(secondAction.getAttribute("data-hovered")).toBe("true");
    expect(
      group.querySelectorAll('[data-slot="fluid-action-list-hover-indicator"]')
    ).toHaveLength(1);
  });

  it("keeps disabled actions out of the proximity interaction", () => {
    render(
      <FluidActionList aria-label="Starting points">
        <FluidActionListItem disabled index={0}>
          Show me around
        </FluidActionListItem>
        <FluidActionListItem index={1}>Start something new</FluidActionListItem>
      </FluidActionList>
    );

    const disabledAction = screen.getByRole("button", {
      name: "Show me around",
    });
    fireEvent.mouseEnter(
      screen.getByRole("group", { name: "Starting points" })
    );
    fireEvent.mouseMove(
      screen.getByRole("group", { name: "Starting points" }),
      { clientY: 10 }
    );

    expect(disabledAction).toHaveProperty("disabled", true);
    expect(disabledAction.hasAttribute("data-hovered")).toBe(false);
  });
});
