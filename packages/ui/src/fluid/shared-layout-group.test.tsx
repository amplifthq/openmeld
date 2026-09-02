import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { SharedLayoutGroup, SharedLayoutItem } from "./shared-layout-group";

afterEach(cleanup);

describe("SharedLayoutGroup", () => {
  it("follows a controlled active item without drawing duplicate backgrounds", () => {
    const { rerender } = render(
      <SharedLayoutGroup activeItemId="first">
        <SharedLayoutItem itemId="first">First</SharedLayoutItem>
        <SharedLayoutItem itemId="second">Second</SharedLayoutItem>
      </SharedLayoutGroup>
    );

    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);
    expect(
      screen
        .getByText("First")
        .closest("[data-slot=shared-layout-item]")
        ?.getAttribute("data-active")
    ).toBe("true");

    rerender(
      <SharedLayoutGroup activeItemId="second">
        <SharedLayoutItem itemId="first">First</SharedLayoutItem>
        <SharedLayoutItem itemId="second">Second</SharedLayoutItem>
      </SharedLayoutGroup>
    );

    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);
    expect(
      screen
        .getByText("Second")
        .closest("[data-slot=shared-layout-item]")
        ?.getAttribute("data-active")
    ).toBe("true");
  });

  it("lets pointer movement update a controlled active item", () => {
    function ControlledGroup() {
      const [activeItemId, setActiveItemId] = useState<string | null>("first");

      return (
        <SharedLayoutGroup
          activeItemId={activeItemId}
          onActiveItemIdChange={setActiveItemId}
        >
          <SharedLayoutItem itemId="first">First</SharedLayoutItem>
          <SharedLayoutItem itemId="second">Second</SharedLayoutItem>
        </SharedLayoutGroup>
      );
    }

    render(<ControlledGroup />);

    const secondItem = screen
      .getByText("Second")
      .closest("[data-slot=shared-layout-item]");
    expect(secondItem).not.toBeNull();
    if (!secondItem) {
      throw new Error("Expected the second shared layout item.");
    }

    fireEvent.pointerEnter(secondItem);

    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);
    expect((secondItem as HTMLElement).dataset.active).toBe("true");
  });

  it("moves one shared background between pointer and keyboard targets", () => {
    render(
      <SharedLayoutGroup>
        <SharedLayoutItem itemId="first">
          <button type="button">First</button>
        </SharedLayoutItem>
        <SharedLayoutItem itemId="second">
          <button type="button">Second</button>
        </SharedLayoutItem>
      </SharedLayoutGroup>
    );

    const firstItem = screen
      .getByText("First")
      .closest("[data-slot=shared-layout-item]");
    expect(firstItem).not.toBeNull();
    if (!firstItem) {
      throw new Error("Expected the first shared layout item.");
    }
    fireEvent.pointerEnter(firstItem);
    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);
    expect((firstItem as HTMLElement).dataset.active).toBe("true");

    fireEvent.focus(screen.getByRole("button", { name: "Second" }));
    expect(
      document.querySelectorAll('[data-slot="shared-layout-background"]')
    ).toHaveLength(1);
    expect(
      (
        screen
          .getByText("Second")
          .closest("[data-slot=shared-layout-item]") as HTMLElement
      ).dataset.active
    ).toBe("true");
  });

  it("clears the shared background when the pointer leaves the group", () => {
    const { container } = render(
      <SharedLayoutGroup>
        <SharedLayoutItem itemId="first">First</SharedLayoutItem>
      </SharedLayoutGroup>
    );

    fireEvent.pointerEnter(screen.getByText("First"));
    expect(
      document.querySelector('[data-slot="shared-layout-background"]')
    ).not.toBeNull();

    const group = container.firstElementChild;
    expect(group).not.toBeNull();
    if (!group) {
      throw new Error("Expected the shared layout group.");
    }
    fireEvent.pointerLeave(group);
    expect(
      document.querySelector('[data-slot="shared-layout-background"]')
    ).toBeNull();
  });
});
