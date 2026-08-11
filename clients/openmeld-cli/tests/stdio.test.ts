import { describe, expect, it } from "vitest";
import { parseStdioLine } from "../src/protocol/stdio";

describe("stdio", () => {
  it("recognizes quit commands", () => {
    expect(parseStdioLine("/quit")).toEqual({ kind: "quit" });
    expect(parseStdioLine("  /quit  ")).toEqual({ kind: "quit" });
    expect(parseStdioLine("/exit")).toEqual({ kind: "quit" });
    expect(parseStdioLine(" exit ")).toEqual({ kind: "quit" });
    expect(parseStdioLine(":q")).toEqual({ kind: "quit" });
    expect(parseStdioLine(" :q ")).toEqual({ kind: "quit" });
  });

  it("rejects empty lines", () => {
    expect(parseStdioLine("   ")).toEqual({ kind: "reject", reason: "empty" });
  });

  it("returns sanitized text", () => {
    expect(parseStdioLine(" hello ")).toEqual({ kind: "text", text: "hello" });
  });
});
