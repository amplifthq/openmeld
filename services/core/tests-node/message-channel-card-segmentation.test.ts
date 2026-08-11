import { describe, expect, it } from "vitest";
import {
  hashMessageChannelCardText,
  MESSAGE_CHANNEL_CARD_MAX_SEGMENTS,
  MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS,
  renderMessageChannelCardText,
  splitMessageChannelCardSegment,
} from "../src/remote-agent/application/message-channel-card-segmentation";

const TYPESCRIPT_FENCE_PREFIX_PATTERN = /^```ts\n/u;
const FENCE_SUFFIX_PATTERN = /\n```$/u;
const ANY_FENCE_SUFFIX_PATTERN = /```$/u;

describe("Message Channel card segmentation", () => {
  it("keeps a short response on the current card", () => {
    expect(
      splitMessageChannelCardSegment({
        sourceOffset: 0,
        text: "A complete response",
      })
    ).toEqual({
      head: "A complete response",
      sourceEnd: 19,
      tail: "",
    });
  });

  it("splits a long response without losing source text", () => {
    const text = `${"A".repeat(29_500)}\n${"B".repeat(2000)}`;
    const segment = splitMessageChannelCardSegment({
      sourceOffset: 0,
      text,
    });

    expect(segment.head.length).toBeLessThanOrEqual(30_000);
    expect(segment.tail.length).toBeLessThanOrEqual(30_000);
    expect(text.slice(0, segment.sourceEnd)).toBe(segment.head);
    expect(text.slice(segment.sourceEnd)).toBe(segment.tail);
  });

  it("closes and reopens a code fence across cards", () => {
    const text = `\`\`\`ts\n${"const value = 1;\n".repeat(2000)}\`\`\``;
    const segment = splitMessageChannelCardSegment({
      sourceOffset: 0,
      text,
    });

    expect(segment.head).toMatch(TYPESCRIPT_FENCE_PREFIX_PATTERN);
    expect(segment.head).toMatch(FENCE_SUFFIX_PATTERN);
    expect(segment.tail).toMatch(TYPESCRIPT_FENCE_PREFIX_PATTERN);
    expect(segment.tail).toMatch(ANY_FENCE_SUFFIX_PATTERN);
    expect(
      renderMessageChannelCardText({
        sourceOffset: segment.sourceEnd,
        text,
      })
    ).toBe(segment.tail);
  });

  it("never splits a Unicode surrogate pair", () => {
    const text = `${"A".repeat(29_999)}😀tail`;
    const segment = splitMessageChannelCardSegment({
      sourceOffset: 0,
      text,
    });

    expect(segment.head.endsWith("\ud83d")).toBe(false);
    expect(segment.tail.startsWith("\ude00")).toBe(false);
    expect(
      text.slice(0, segment.sourceEnd) + text.slice(segment.sourceEnd)
    ).toBe(text);
  });

  it("hashes the exact rendered provider payload", async () => {
    await expect(hashMessageChannelCardText("same payload")).resolves.toBe(
      "e94045d2493922f0ce901226bf668cfe954f6b503bfab1fef09370af7e972812"
    );
  });

  it("defines an explicit finite total card budget", () => {
    expect(MESSAGE_CHANNEL_CARD_MAX_SEGMENTS).toBe(6);
    expect(MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS).toBe(100_086);
  });
});
