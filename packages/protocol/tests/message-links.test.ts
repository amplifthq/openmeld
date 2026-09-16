import { describe, expect, it } from "vitest";
import {
  collectMessageLinks,
  collectMessagePreviewUrls,
  normalizeMessageLink,
} from "../src/message-links";

describe("message links", () => {
  it("keeps Chinese punctuation outside the destination", () => {
    const text = "请看 https://example.com/guide。";
    const link = collectMessageLinks(text)[0];
    expect(link?.url).toBe("https://example.com/guide");
    expect(text.slice(link?.end)).toBe("。");
  });
  it("recognizes bare URLs and labeled links, preserving punctuation and offsets", () => {
    const text =
      "See https://example.com/a_(b). Then [the guide](https://example.org/guide).";
    const links = collectMessageLinks(text);
    expect(links.map(({ url, label }) => ({ url, label }))).toEqual([
      { url: "https://example.com/a_(b)", label: "https://example.com/a_(b)" },
      { url: "https://example.org/guide", label: "the guide" },
    ]);
    expect(text.slice(links[1]?.start, links[1]?.end)).toBe(
      "[the guide](https://example.org/guide)"
    );
  });
  it("does not unfurl code, images, raw HTML, or email; deduplicates destinations", () => {
    const text =
      "https://example.com [again](https://example.com) `https://code.example.com`\n\n```\nhttps://block.example.com\n```\n\n![image](https://image.example.com) <img src='https://html.example.com'> a@example.com";
    expect(collectMessagePreviewUrls(text)).toEqual(["https://example.com/"]);
  });
  it("rejects executable schemes and embedded credentials", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "https://user:secret@example.com",
    ]) {
      expect(normalizeMessageLink(url)).toBeNull();
    }
    expect(normalizeMessageLink("http://example.com")).toBe(
      "http://example.com/"
    );
  });
});
