import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Tip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger>{label}</TooltipTrigger>
      <TooltipContent>{label} details</TooltipContent>
    </Tooltip>
  );
}

describe("Fluid tooltip delay", () => {
  it.each([
    false,
    true,
  ])("waits 500ms with an app provider: %s", async (grouped) => {
    const tip = <Tip label="Settings" />;
    render(
      grouped ? (
        <TooltipProvider>
          {tip}
          <Tip label="Account" />
        </TooltipProvider>
      ) : (
        tip
      )
    );
    const trigger = screen.getByRole("button", { name: "Settings" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("tooltip").textContent).toBe("Settings details");
    expect(trigger.getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").id
    );
    fireEvent.mouseLeave(trigger);
    if (grouped) {
      const adjacent = screen.getByRole("button", { name: "Account" });
      fireEvent.mouseEnter(adjacent);
      fireEvent.mouseMove(adjacent);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(499);
      });
      expect(screen.queryByText("Account details")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText("Account details")).toBeTruthy();
      fireEvent.mouseLeave(adjacent);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
