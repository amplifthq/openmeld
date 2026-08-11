import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import {
  createTextEntryState,
  handleTextEntryKeypress,
  measureRenderedTextEntryPromptHeight,
  renderTextEntryPromptLines,
} from "../src/ui/text-entry";

describe("text entry prompt", () => {
  it("measures wrapped terminal height instead of only logical line count", () => {
    const state = createTextEntryState({
      message: "Enter a space ID manually",
      description: "Paste a 64-character hex space ID to join it.",
      allowBack: true,
      value: "c2b088baa3a5f4ee86c2efe94bedf9f43ec3029a2b3ce3b3db1604a03a3e4c2",
    });

    const lines = renderTextEntryPromptLines(state, "active");
    const renderedHeight = measureRenderedTextEntryPromptHeight(lines, 40);

    expect(renderedHeight).toBeGreaterThan(lines.length);
  });

  it("renders the back row in the submitted summary after escape", () => {
    const state = createTextEntryState({
      message: "Enter a space ID manually",
      description: "Paste a 64-character hex space ID to join it.",
      allowBack: true,
    });

    const result = handleTextEntryKeypress({
      state,
      str: "",
      key: { name: "escape" },
    });

    expect(result).toMatchObject({
      type: "result",
      result: { status: "back" },
      status: "submitted",
      state: {
        focus: "back",
      },
    });

    if (result.type !== "result" || !result.state) {
      throw new Error("expected result state after escape");
    }

    const lines = stripAnsiLines(
      renderTextEntryPromptLines(result.state, result.status)
    );

    expect(lines).toContain("│  Back");
  });

  it("allows empty submission when allowEmpty is enabled", () => {
    const state = createTextEntryState({
      message: "Optional value",
      allowBack: true,
      allowEmpty: true,
    });

    const result = handleTextEntryKeypress({
      state,
      str: "",
      key: { name: "return" },
    });

    expect(result).toMatchObject({
      type: "result",
      result: {
        status: "submitted",
        value: "",
      },
      status: "submitted",
    });
  });

  it("accepts enter key names emitted by alternate terminal runtimes", () => {
    const state = createTextEntryState({
      message: "Optional value",
      allowBack: true,
      allowEmpty: true,
    });

    const result = handleTextEntryKeypress({
      state,
      str: "\r",
      key: { name: "enter" },
    });

    expect(result).toMatchObject({
      type: "result",
      result: {
        status: "submitted",
        value: "",
      },
      status: "submitted",
    });
  });

  it("accepts raw carriage return enter events emitted without key names", () => {
    const state = createTextEntryState({
      message: "Optional value",
      allowBack: true,
      allowEmpty: true,
    });

    const result = handleTextEntryKeypress({
      state,
      str: "\r",
      key: { name: undefined, sequence: "\r" },
    });

    expect(result).toMatchObject({
      type: "result",
      result: {
        status: "submitted",
        value: "",
      },
      status: "submitted",
    });
  });
});

function stripAnsiLines(lines: string[]): string[] {
  return lines.map((line) => stripVTControlCharacters(line));
}
