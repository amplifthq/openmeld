import { MAX_TEXT_LENGTH } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { projectMessageChannelTerminalContent } from "../src/remote-agent/application/message-channel-terminal-content";

describe("Message Channel terminal publication", () => {
  it("keeps the complete product-limit reply when adding an attachment notice", () => {
    const text = "😀".repeat(MAX_TEXT_LENGTH / 2);

    const content = projectMessageChannelTerminalContent({
      attachments: [
        {
          id: "attachment_generated_1",
          mimeType: "image/png",
          sizeBytes: 2048,
        },
      ],
      text,
    });

    expect(content.attachments).toEqual([]);
    expect(content.text.startsWith(text)).toBe(true);
    expect(content.text.slice(0, text.length)).toBe(text);
    expect(hasUnpairedSurrogate(content.text)).toBe(false);
    expect(content.text).toContain(
      "this channel cannot deliver generated images yet"
    );
  });
});

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc_00 && next <= 0xdf_ff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff) {
      return true;
    }
  }
  return false;
}
