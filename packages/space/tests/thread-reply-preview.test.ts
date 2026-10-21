import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  boundThreadPreviewSignal,
  boundThreadReplyPreviewText,
  readThreadReplyPreviewLine,
  THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS,
} from "../src";

const MAX = THREAD_REPLY_PREVIEW_TEXT_MAX_CHARS;

describe("thread reply preview text", () => {
  it("shows the first line with content after Markdown cleanup", () => {
    expect(
      readThreadReplyPreviewLine("\n---\n## **Fixed** the build\nmore")
    ).toBe("Fixed the build");
    expect(readThreadReplyPreviewLine("```\n---\n")).toBe("```\n---\n");
  });

  it("skips the contents of a backtick fence", () => {
    expect(readThreadReplyPreviewLine("```\nconst x = 1\n```\nHello")).toBe(
      "Hello"
    );
  });

  it("skips the contents of a tilde fence", () => {
    expect(readThreadReplyPreviewLine("~~~\nconst x = 1\n~~~~\nHello")).toBe(
      "Hello"
    );
  });

  it("opens a fence on a line with an info string", () => {
    expect(
      readThreadReplyPreviewLine("```ts title=example\nconst x = 1\n```\nHello")
    ).toBe("Hello");
    expect(
      readThreadReplyPreviewLine("~~~ js `x`\nconst x = 1\n~~~\nHello")
    ).toBe("Hello");
  });

  it("does not open a fence on an inline code span", () => {
    expect(readThreadReplyPreviewLine("```inline``` code\nmore")).toBe(
      "```inline``` code"
    );
  });

  it("closes a fence only on the same character and at least its length", () => {
    const text = "````\n~~~~\n```\n```` info\ninside\n`````\nHello";
    expect(readThreadReplyPreviewLine(text)).toBe("Hello");
    expect(readThreadReplyPreviewLine("~~~\n```\ninside\n~~~\nHello")).toBe(
      "Hello"
    );
  });

  it("returns the whole text when a fence never closes", () => {
    const text = "```\nconst x = 1\n~~~\nHello";
    expect(readThreadReplyPreviewLine(text)).toBe(text);
    const long = `\`\`\`\n${"code\n".repeat(MAX)}`;
    expect(boundThreadReplyPreviewText(long)).toBe(long);
  });

  it("bounds long text after a fence to the line it shows", () => {
    const fenced = `\`\`\`ts\n${"const x = 1;\n".repeat(200)}\`\`\``;
    const text = `${fenced}\nHello\n${"tail ".repeat(400)}`;
    expect(text.length).toBeGreaterThan(MAX);
    const bounded = boundThreadReplyPreviewText(text);
    expect(bounded).toBe(`${fenced}\nHello`);
    expect(readThreadReplyPreviewLine(bounded)).toBe("Hello");
    expect(readThreadReplyPreviewLine(text)).toBe("Hello");
  });

  it("keeps short text whole", () => {
    const text = "Short reply\nwith a second line";
    expect(boundThreadReplyPreviewText(text)).toBe(text);
  });

  it("keeps long replies through the shown line only", () => {
    const text = `Summary of the change\n${"detail ".repeat(2000)}`;
    const bounded = boundThreadReplyPreviewText(text);
    expect(bounded).toBe("Summary of the change");
    expect(readThreadReplyPreviewLine(bounded)).toBe(
      readThreadReplyPreviewLine(text)
    );
  });

  it("keeps skipped lines and the whole shown line, links included", () => {
    const fence = `\`\`\`${"x".repeat(MAX + 50)}`;
    const url = `https://example.com/download?sig=${"a".repeat(MAX)}`;
    const shown = `**Result**: see ${url}`;
    const text = `${fence}\r\ncode\r\n\`\`\`\r\n\n${shown}\r\nmore\n${"tail ".repeat(800)}`;
    const bounded = boundThreadReplyPreviewText(text);
    expect(bounded).toBe(`${fence}\r\ncode\r\n\`\`\`\r\n\n${shown}\r`);
    expect(readThreadReplyPreviewLine(bounded)).toBe(
      readThreadReplyPreviewLine(text)
    );
    expect(readThreadReplyPreviewLine(bounded)).toContain(url);
  });

  it("returns the whole text when it has no selectable line", () => {
    const noPreviewLine = `${"---\n".repeat(400)}\`\`\``;
    expect(boundThreadReplyPreviewText(noPreviewLine)).toBe(noPreviewLine);
    const oneLongLine = "word ".repeat(MAX);
    expect(boundThreadReplyPreviewText(oneLongLine)).toBe(oneLongLine);
  });

  it("bounds only text reply signals and keeps every other field", () => {
    const longText = `Done\n${"x".repeat(MAX * 3)}`;
    const text = {
      id: "s1",
      type: "signal.text",
      data: { text: longText, meta: { messageRevision: 2 } },
    } as unknown as SignalEnvelope;
    const bounded = boundThreadPreviewSignal(text) as typeof text & {
      data: { text: string; meta: unknown };
    };
    expect(bounded.data.text).toBe("Done");
    expect(bounded.data.meta).toEqual({ messageRevision: 2 });
    expect(bounded.id).toBe("s1");

    const short = {
      ...text,
      data: { text: "short" },
    } as unknown as SignalEnvelope;
    expect(boundThreadPreviewSignal(short)).toBe(short);
    const notice = {
      id: "s2",
      type: "signal.system_notice",
      data: { text: longText },
    } as unknown as SignalEnvelope;
    expect(boundThreadPreviewSignal(notice)).toBe(notice);
  });
});
