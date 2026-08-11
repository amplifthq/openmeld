import { describe, expect, it } from "vitest";
import { sanitizeTerminalDisplayText } from "../src/ui/terminal-safe-text";

const RED_BACKGROUND_ESCAPE = "\u001B[41m";
const RESET_ESCAPE = "\u001B[0m";
const OSC_LINK = "\u001B]8;;https://openmeld.ai\u0007openmeld\u001B]8;;\u0007";
const OSC_CLIPBOARD =
  "\u001B]52;c;Y29weS10aGlzLXNob3VsZC1ub3QtcnVu\u0007clipboard";

describe("terminal-safe text", () => {
  it("strips terminal control sequences while preserving visible text", () => {
    const sanitized = sanitizeTerminalDisplayText(
      `${RED_BACKGROUND_ESCAPE}alert${RESET_ESCAPE} ${OSC_LINK} ${OSC_CLIPBOARD}`,
      "single-line"
    );

    expect(sanitized).toBe("alert openmeld clipboard");
    expect(sanitized.includes("\u001B")).toBe(false);
  });

  it("preserves tabs and intentional newlines in multi-line mode", () => {
    const sanitized = sanitizeTerminalDisplayText(
      "one\tline\r\ntwo\rthree\u0007",
      "multi-line"
    );

    expect(sanitized).toBe("one\tline\ntwo\nthree");
  });

  it("removes rewrite characters in single-line mode", () => {
    const sanitized = sanitizeTerminalDisplayText(
      "alpha\r\nbeta\b!\u0000",
      "single-line"
    );

    expect(sanitized).toBe("alpha beta!");
  });
});
