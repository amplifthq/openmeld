import { describe, expect, it } from "vitest";
import {
  handleConfirmPromptKeypress,
  renderConfirmPromptLines,
} from "../src/ui/confirm";

const initialState = {
  activeLabel: "Switch account",
  inactiveLabel: "Keep current account",
  message: "Switch this computer?",
  value: false,
};

describe("confirm prompt", () => {
  it("moves between choices with arrow keys and submits the selected choice", () => {
    const moved = handleConfirmPromptKeypress({
      key: { name: "down" },
      state: initialState,
      str: undefined,
    });
    expect(moved).toMatchObject({
      type: "state",
      state: { value: true },
    });
    if (moved.type !== "state") {
      throw new Error("expected the arrow key to move the selection");
    }

    expect(
      handleConfirmPromptKeypress({
        key: { name: "return" },
        state: moved.state,
        str: "\r",
      })
    ).toMatchObject({
      type: "result",
      result: "confirmed",
      status: "submitted",
    });
  });

  it("cancels immediately when Escape is pressed", () => {
    expect(
      handleConfirmPromptKeypress({
        key: { name: "escape" },
        state: initialState,
        str: undefined,
      })
    ).toMatchObject({
      type: "result",
      result: "cancelled",
      status: "cancelled",
    });
  });

  it("renders action-specific labels with the safe choice selected", () => {
    expect(
      renderConfirmPromptLines(initialState, "active").join("\n")
    ).toContain("○ Switch account / ● Keep current account");
  });
});
