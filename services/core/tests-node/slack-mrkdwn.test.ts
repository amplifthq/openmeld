import { describe, expect, it } from "vitest";
import { toSlackMrkdwn } from "../src/remote-agent/application/slack-mrkdwn";

describe("Slack mrkdwn formatting", () => {
  it("normalizes Markdown hard breaks to Slack newlines", async () => {
    const markdown = ["First line\\", "Second line  ", "Third line"].join("\n");

    expect(await toSlackMrkdwn(markdown)).toBe(
      ["First line", "Second line", "Third line"].join("\n")
    );
  });

  it("converts common Markdown shapes to Slack mrkdwn", async () => {
    expect(
      await toSlackMrkdwn(`# Release notes

**Bold** and *italic* plus [OpenMeld](https://openmeld.ai).

Inline \`code\`.

\`\`\`ts
const ok = true;
\`\`\`

- One
- Two

1. First
2. Second`)
    ).toMatchInlineSnapshot(`
      "*Release notes*

      ​*Bold*​ and ​_italic_​ plus <https://openmeld.ai|OpenMeld>.

      Inline \`code\`.

      \`\`\`
      const ok = true;
      \`\`\`

      •   One
      •   Two

      1.  First
      2.  Second"
    `);
  });

  it("keeps Center Agent navigation actions clickable in Slack", async () => {
    expect(
      await toSlackMrkdwn(
        "[Open GitHub access](https://openmeld.ai/o/amplift/center-agent/plugins/github)"
      )
    ).toBe(
      "<https://openmeld.ai/o/amplift/center-agent/plugins/github|Open GitHub access>"
    );
  });

  it("unwraps Slack presentation tokens accidentally wrapped in inline code", async () => {
    expect(
      await toSlackMrkdwn(
        "`<https://github.com/amplifthq/reply/pull/154|#154 fix P0 · 3 files · +5/-3>`"
      )
    ).toBe(
      "<https://github.com/amplifthq/reply/pull/154|#154 fix P0 · 3 files · +5/-3>"
    );

    expect(
      await toSlackMrkdwn(
        "See `[Open Space](https://openmeld.ai/o/amplift/spaces/space_123)` and notify `<@U123456>`."
      )
    ).toBe(
      "See <https://openmeld.ai/o/amplift/spaces/space_123|Open Space> and notify <@U123456>."
    );

    expect(
      await toSlackMrkdwn(
        "Track `<https://openmeld.ai/o/amplift/spaces/space_123?tab=timeline&from=slack|Open Space>`."
      )
    ).toBe(
      "Track <https://openmeld.ai/o/amplift/spaces/space_123?tab=timeline&from=slack|Open Space>."
    );
  });

  it("unwraps presentation-only code fences without flattening real code", async () => {
    expect(
      await toSlackMrkdwn(
        [
          "```text",
          "PR ready:",
          "<https://github.com/amplifthq/reply/pull/154|#154 fix P0>",
          "[Open Space](https://openmeld.ai/o/amplift/spaces/space_123)",
          "Notify <@U123456>",
          "```",
        ].join("\n")
      )
    ).toBe(
      [
        "PR ready:",
        "<https://github.com/amplifthq/reply/pull/154|#154 fix P0>",
        "<https://openmeld.ai/o/amplift/spaces/space_123|Open Space>",
        "Notify <@U123456>",
      ].join("\n")
    );

    expect(
      await toSlackMrkdwn(
        [
          "```ts",
          'const pr = "<https://github.com/amplifthq/reply/pull/154|#154>";',
          "```",
        ].join("\n")
      )
    ).toBe(
      [
        "```",
        'const pr = "<https://github.com/amplifthq/reply/pull/154|#154>";',
        "```",
      ].join("\n")
    );
  });

  it("preserves table content through the library fallback", async () => {
    expect(
      await toSlackMrkdwn(`| Feature | Status |
| --- | --- |
| Bold | **works** |
| Link | [docs](https://example.com/docs) |`)
    ).toMatchInlineSnapshot(`
      "| Feature | Status                          |
      | ------- | ------------------------------- |
      | Bold    | ​*works*​                       |
      | Link    | <https://example.com/docs|docs> |"
    `);
  });

  it("converts block Markdown without leaking unsupported markers", async () => {
    const markdown = ["# Heading", "", "---", "", "> Quoted guidance"].join(
      "\n"
    );

    expect(await toSlackMrkdwn(markdown)).toBe(
      ["*Heading*", "", "──────────", "", "> Quoted guidance"].join("\n")
    );
  });

  it("preserves line-ending backslashes inside code blocks", async () => {
    const markdown = ["```text", "path\\", "```"].join("\n");

    expect(await toSlackMrkdwn(markdown)).toBe(
      ["```", "path\\", "```"].join("\n")
    );
  });

  it("preserves a trailing backslash without a following line", async () => {
    expect(await toSlackMrkdwn("Literal\\")).toBe("Literal\\");
  });
});
