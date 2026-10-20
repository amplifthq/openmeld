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
      readThreadReplyPreviewLine("\n---\n```ts\n## **Fixed** the build\nmore")
    ).toBe("Fixed the build");
    expect(readThreadReplyPreviewLine("```\n---\n")).toBe("```\n---\n");
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
    const text = `${fence}\r\n\n${shown}\r\nmore\n${"tail ".repeat(800)}`;
    const bounded = boundThreadReplyPreviewText(text);
    expect(bounded).toBe(`${fence}\r\n\n${shown}\r`);
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
