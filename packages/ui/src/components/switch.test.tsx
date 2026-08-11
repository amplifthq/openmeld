import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

afterEach(() => {
  cleanup();
});

describe("Switch", () => {
  it("renders an accessible switch", () => {
    render(<Switch aria-label="Local agent" checked />);

    expect(
      screen
        .getByRole("switch", { name: "Local agent" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("reports checked changes", () => {
    const handleCheckedChange = vi.fn();
    render(
      <Switch
        aria-label="Local agent"
        checked={false}
        onCheckedChange={handleCheckedChange}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Local agent" }));

    expect(handleCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });
});
