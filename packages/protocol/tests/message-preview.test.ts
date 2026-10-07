import { describe, expect, it } from "vitest";
import { normalizeMessagePreview } from "../src/message-preview";

describe("message previews", () => {
  it.each([
    [
      "**每日更新** | *Ready* and `pnpm check`",
      "每日更新 | Ready and pnpm check",
    ],
    [
      "## Review\n- [x] **Done**\n- [Docs](https://example.com)",
      "Review Done Docs",
    ],
    ["Hello &amp; goodbye ![Diagram](image.png)", "Hello & goodbye Diagram"],
    [
      'Keep this\n```openmeld-space-action\n{"secret":true}\n```\n<script>hidden</script>',
      "Keep this",
    ],
    [
      "A * B = 6; snake_case; escaped \\*star\\*",
      "A * B = 6; snake_case; escaped *star*",
    ],
  ])("renders %s as readable text", (source, expected) => {
    expect(normalizeMessagePreview(source)).toBe(expected);
  });
});
