import type { SignalEnvelope } from "@openmeld/protocol";
import {
  signalTextEnvelopeSchema,
  spaceThreadPreviewSchema,
} from "@openmeld/schemas/schemas";
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
    expect(readThreadReplyPreviewLine("```\n---\n")).toBe("---");
    expect(readThreadReplyPreviewLine("---\n\n")).toBe("---\n\n");
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

  it("does not close a fence on a run followed by other whitespace", () => {
    expect(
      readThreadReplyPreviewLine("```\nfirst\n```\u00a0\nsecond\n```\nHello")
    ).toBe("Hello");
  });

  it("skips a line of only trailing whitespace before the shown line", () => {
    const text = `${" ".repeat(40_000)}\u00a0\nDone\n${"x".repeat(MAX + 100)}`;
    expect(boundThreadReplyPreviewText(text)).toBe("Done");
  });

  it("does not carry a large code block before the line it shows", () => {
    const text = `\`\`\`\n${"x\n".repeat(50_000)}\`\`\`\nDone`;
    expect(boundThreadReplyPreviewText(text)).toBe("Done");
  });

  it("keeps indented or marked-up fence runs inside a fence", () => {
    expect(
      readThreadReplyPreviewLine("```\n    ```\n# ```\ninside\n   ```\nHello")
    ).toBe("Hello");
  });

  it("skips a fence marker inside a quote as one line", () => {
    expect(readThreadReplyPreviewLine("> ```\n> code\n\nHello")).toBe("code");
  });

  it("shows the first code line of a reply that is only code", () => {
    expect(readThreadReplyPreviewLine("```ts\n\n  const x = 1\n```")).toBe(
      "const x = 1"
    );
    const unclosed = "```\nconst x = 1\n~~~\nHello";
    expect(readThreadReplyPreviewLine(unclosed)).toBe("const x = 1");
  });

  it("bounds a long code-only reply to its first code line", () => {
    for (const text of [
      `\`\`\`\n${"code\n".repeat(MAX)}`,
      `\`\`\`\n${"code\n".repeat(MAX)}\`\`\``,
    ]) {
      const bounded = boundThreadReplyPreviewText(text);
      expect(bounded).toBe("```\ncode");
      expect(readThreadReplyPreviewLine(bounded)).toBe("code");
    }
  });

  it("bounds long text after a fence to the line it shows", () => {
    const fenced = `\`\`\`ts\n${"const x = 1;\n".repeat(200)}\`\`\``;
    const text = `${fenced}\nHello\n${"tail ".repeat(400)}`;
    expect(text.length).toBeGreaterThan(MAX);
    const bounded = boundThreadReplyPreviewText(text);
    expect(bounded).toBe("Hello");
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
    expect(bounded).toBe(`${shown}\r`);
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

  it.each([
    false,
    true,
  ])("keeps bounded reply signals valid (message envelope: %s)", (withMessageEnvelope) => {
    const longText = `Done\n${"x".repeat(MAX * 3)}`;
    const messageEnvelope = {
      text: longText,
      activationTargets: ["agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      referenceTargets: ["agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      mentionTargets: ["11111111-1111-4111-8111-111111111111"],
      replyToSignalId: "root-signal",
    };
    const text = signalTextEnvelopeSchema.parse({
      v: 1,
      id: "s1",
      spaceId: "space-1",
      ts: 1,
      profile: {
        kind: "agent",
        profileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        profileName: "Morgan",
      },
      type: "signal.text",
      data: {
        text: longText,
        meta: { messageRevision: 2 },
        ...(withMessageEnvelope ? { messageEnvelope } : {}),
      },
    });
    const original = structuredClone(text);
    const bounded = boundThreadPreviewSignal(text);
    expect(
      spaceThreadPreviewSchema.safeParse({
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        replyCount: 1,
        signals: [bounded],
        placements: [],
      }).success
    ).toBe(true);
    expect(bounded).toEqual({
      ...original,
      data: {
        ...original.data,
        text: "Done",
        ...(withMessageEnvelope
          ? { messageEnvelope: { ...messageEnvelope, text: "Done" } }
          : {}),
      },
    });
    expect(text).toEqual(original);

    const short = signalTextEnvelopeSchema.parse({
      ...text,
      data: { text: "short" },
    });
    expect(boundThreadPreviewSignal(short)).toBe(short);
    const presence: SignalEnvelope = {
      ...text,
      id: "s2",
      type: "presence.join",
      data: {},
    };
    expect(boundThreadPreviewSignal(presence)).toBe(presence);
  });
});
