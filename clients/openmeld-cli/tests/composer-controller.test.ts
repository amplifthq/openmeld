import { describe, expect, it } from "vitest";
import { ComposerController } from "../src/space/composer/composer-controller";

describe("ComposerController", () => {
  it("converts continuation input into buffer updates for legacy lines", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeLegacyLine({
        line: "line-1\\",
        bufferText: "",
      })
    ).toEqual({
      kind: "buffer.updated",
      nextBufferText: "line-1",
    });
  });

  it("treats /cancel as plain text after command removal", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeLegacyLine({
        line: "/cancel",
        bufferText: "line-1",
      })
    ).toEqual({
      kind: "submit",
      nextBufferText: "",
      text: "line-1\n/cancel",
    });
  });

  it("returns sanitized submit intents from editor submissions", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeEditorSubmit({
        text: "  hello world  ",
      })
    ).toEqual({
      kind: "submit",
      nextBufferText: "",
      text: "hello world",
    });
  });

  it("treats trailing backslash as literal text for editor submissions", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeEditorSubmit({
        text: "hello\\",
      })
    ).toEqual({
      kind: "submit",
      nextBufferText: "",
      text: "hello\\",
    });
  });

  it("treats /cancel as plain text for editor submissions", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeEditorSubmit({
        text: "/cancel",
      })
    ).toEqual({
      kind: "submit",
      nextBufferText: "",
      text: "/cancel",
    });
  });

  it("surfaces empty editor submissions as rejected intents", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeEditorSubmit({
        text: "   ",
      })
    ).toEqual({
      kind: "submit.rejected",
      nextBufferText: "",
      reason: "empty",
    });
  });

  it("resolves local slash commands before submit sanitization", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeEditorSubmit({
        text: " /space ",
        nextBufferText: "",
      })
    ).toEqual({
      kind: "command.panel.open",
      nextBufferText: "",
      panelKind: "space",
    });
  });

  it("treats quit aliases as local quit commands in editor submissions", () => {
    const controller = new ComposerController();

    expect(
      controller.consumeEditorSubmit({
        text: "/exit",
      })
    ).toEqual({
      kind: "quit",
    });

    expect(
      controller.consumeEditorSubmit({
        text: " exit ",
      })
    ).toEqual({
      kind: "quit",
    });

    expect(
      controller.consumeEditorSubmit({
        text: ":q",
      })
    ).toEqual({
      kind: "quit",
    });
  });
});
