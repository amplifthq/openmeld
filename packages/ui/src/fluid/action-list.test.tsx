import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluidActionList, FluidActionListItem } from "./action-list";

describe("FluidActionList", () => {
  it("suppresses pointer-driven focus rings and restores them for keyboard navigation", async () => {
    const { container } = render(
      <FluidActionList>
        <FluidActionListItem index={0}>Help</FluidActionListItem>
      </FluidActionList>
    );
    const item = screen.getByRole("button", { name: "Help" });
    const originalMatches = item.matches.bind(item);
    vi.spyOn(item, "matches").mockImplementation(
      (selector) => selector === ":focus-visible" || originalMatches(selector)
    );
    fireEvent.pointerMove(item);
    fireEvent.focus(item);
    expect(
      container.querySelector('[data-slot="fluid-action-list-focus-indicator"]')
    ).toBeNull();
    fireEvent.keyDown(item, { key: "ArrowDown" });
    expect(
      container.querySelector('[data-slot="fluid-action-list-focus-indicator"]')
    ).not.toBeNull();
    fireEvent.pointerDown(item);
    fireEvent.focus(item);
    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-slot="fluid-action-list-focus-indicator"]'
        )
      ).toBeNull()
    );
  });
  it("keeps nested menu focus from highlighting an unrelated outer action", () => {
    render(
      <FluidActionList>
        <FluidActionListItem index={0}>Outer action</FluidActionListItem>
        <FluidActionList>
          <FluidActionListItem index={0}>Inner action</FluidActionListItem>
        </FluidActionList>
      </FluidActionList>
    );
    fireEvent.focus(screen.getByRole("button", { name: "Inner action" }));
    expect(
      screen
        .getByRole("button", { name: "Inner action" })
        .getAttribute("data-hovered")
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Outer action" })
        .hasAttribute("data-hovered")
    ).toBe(false);
  });
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

  it.each([
    false,
    true,
  ])("shares hover feedback and routes gap activation only when opted in (%s)", (gapClick) => {
    const onSelect = vi.fn();
    render(
      <FluidActionList aria-label="Starting points" gapClick={gapClick}>
        <FluidActionListItem index={0}>Show me around</FluidActionListItem>
        <FluidActionListItem index={1} onClick={onSelect}>
          Start something new
        </FluidActionListItem>
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
      group.querySelectorAll('[data-slot="fluid-hover-highlight"]')
    ).toHaveLength(1);
    fireEvent.click(group);
    expect(onSelect).toHaveBeenCalledTimes(gapClick ? 1 : 0);
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
