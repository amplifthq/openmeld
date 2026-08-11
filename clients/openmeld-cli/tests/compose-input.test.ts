import { describe, expect, it } from "vitest";
import {
  consumeComposeInputLine,
  emptyComposeDraft,
} from "../src/space/compose-input";

describe("compose input", () => {
  it("recognizes quit commands", () => {
    const directQuit = consumeComposeInputLine({
      line: "/quit",
      draft: emptyComposeDraft(),
    });
    expect(directQuit).toEqual({ kind: "quit" });

    const slashAliasQuit = consumeComposeInputLine({
      line: " /exit ",
      draft: emptyComposeDraft(),
    });
    expect(slashAliasQuit).toEqual({ kind: "quit" });

    const bareAliasQuit = consumeComposeInputLine({
      line: " exit ",
      draft: emptyComposeDraft(),
    });
    expect(bareAliasQuit).toEqual({ kind: "quit" });

    const aliasQuit = consumeComposeInputLine({
      line: " :q ",
      draft: emptyComposeDraft(),
    });
    expect(aliasQuit).toEqual({ kind: "quit" });
  });

  it("builds multiline drafts with trailing single backslash", () => {
    const continued = consumeComposeInputLine({
      line: "first\\   ",
      draft: emptyComposeDraft(),
    });
    expect(continued.kind).toBe("continue");
    if (continued.kind !== "continue") {
      throw new Error("expected continue action");
    }
    expect(continued.nextDraft.lines).toEqual(["first"]);

    const sent = consumeComposeInputLine({
      line: "second",
      draft: continued.nextDraft,
    });
    expect(sent.kind).toBe("send");
    if (sent.kind !== "send") {
      throw new Error("expected send action");
    }
    expect(sent.text).toBe("first\nsecond");
    expect(sent.nextDraft.lines).toEqual([]);
  });

  it("treats double trailing backslash as literal text", () => {
    const action = consumeComposeInputLine({
      line: "path\\\\",
      draft: emptyComposeDraft(),
    });
    expect(action.kind).toBe("send");
    if (action.kind !== "send") {
      throw new Error("expected send action");
    }
    expect(action.text).toBe("path\\\\");
  });

  it("treats /cancel as literal text when a draft exists", () => {
    const continued = consumeComposeInputLine({
      line: "line-1\\",
      draft: emptyComposeDraft(),
    });
    if (continued.kind !== "continue") {
      throw new Error("expected continue action");
    }

    const sent = consumeComposeInputLine({
      line: " /cancel ",
      draft: continued.nextDraft,
    });
    expect(sent.kind).toBe("send");
    if (sent.kind !== "send") {
      throw new Error("expected send action");
    }
    expect(sent.text).toBe("line-1\n /cancel ");
    expect(sent.nextDraft.lines).toEqual([]);
  });

  it("treats /cancel as literal text when no draft exists", () => {
    const sent = consumeComposeInputLine({
      line: "/cancel",
      draft: emptyComposeDraft(),
    });
    expect(sent.kind).toBe("send");
    if (sent.kind !== "send") {
      throw new Error("expected send action");
    }
    expect(sent.text).toBe("/cancel");
    expect(sent.nextDraft.lines).toEqual([]);
  });
});
