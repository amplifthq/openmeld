import { describe, expect, it } from "vitest";
import { formatTerminalHyperlink } from "../src/ui/terminal-hyperlink";

describe("terminal hyperlink", () => {
  it("emits an OSC 8 hyperlink when explicitly enabled", () => {
    expect(
      formatTerminalHyperlink({
        enabled: true,
        label: "Open OpenMeld Welcoming Space",
        url: "https://openmeld.test/o/acme/spaces/space-1?profileId=human-1",
      })
    ).toBe(
      "\u001B]8;;https://openmeld.test/o/acme/spaces/space-1?profileId=human-1\u0007Open OpenMeld Welcoming Space\u001B]8;;\u0007"
    );
  });

  it("falls back to the visible label when disabled or invalid", () => {
    expect(
      formatTerminalHyperlink({
        enabled: false,
        label: "Open OpenMeld Welcoming Space",
        url: "https://openmeld.test/o/acme/spaces/space-1",
      })
    ).toBe("Open OpenMeld Welcoming Space");
    expect(
      formatTerminalHyperlink({
        enabled: true,
        label: "Open OpenMeld Welcoming Space",
        url: "javascript:alert(1)",
      })
    ).toBe("Open OpenMeld Welcoming Space");
  });
});
