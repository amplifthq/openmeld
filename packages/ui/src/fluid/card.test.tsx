import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FluidCardGroup, FluidCardItem } from "./card";

afterEach(cleanup);

describe("FluidCard", () => {
  it("shares one fluid background across card interactions", () => {
    render(
      <FluidCardGroup>
        <FluidCardItem itemId="first">
          <button type="button">First card</button>
        </FluidCardItem>
        <FluidCardItem itemId="second">
          <button type="button">Second card</button>
        </FluidCardItem>
      </FluidCardGroup>
    );

    const firstCard = screen
      .getByRole("button", { name: "First card" })
      .closest("[data-fluid-card-item]");
    expect(firstCard).not.toBeNull();
    if (!firstCard) {
      throw new Error("Expected the first Fluid Card item.");
    }
    expect(firstCard.className).toContain("min-w-0");
    expect(firstCard.closest("[data-fluid-card-group]")?.className).toContain(
      "min-w-0"
    );

    fireEvent.pointerEnter(firstCard);
    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);

    fireEvent.focus(screen.getByRole("button", { name: "Second card" }));
    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);
    const secondCard = screen
      .getByRole("button", { name: "Second card" })
      .closest("[data-fluid-card-item]");
    expect((secondCard as HTMLElement | null)?.dataset.active).toBe("true");
  });
});
