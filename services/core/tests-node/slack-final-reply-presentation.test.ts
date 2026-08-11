import { buildOpenMeldNavigationAction } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { buildSlackFinalReplyPresentation } from "../src/remote-agent/application/slack-final-reply-presentation";

describe("Slack final reply presentation", () => {
  it("keeps one canonical Navigation Action clickable in the block and fallback", () => {
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/amplift",
      target: { kind: "organization_app", service: "github" },
    });
    const markdown = `GitHub is not ready. [${action.label}](${action.url}) and try again.`;

    expect(buildSlackFinalReplyPresentation(markdown)).toEqual({
      blocks: [{ text: markdown, type: "markdown" }],
      text: `GitHub is not ready. <${action.url}|${action.label}> and try again.`,
    });
  });

  it("renders a trusted Navigation Action as a native Slack button", () => {
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/amplift",
      target: { kind: "project", projectId: "project_123" },
    });

    expect(
      buildSlackFinalReplyPresentation("Project created.", action)
    ).toEqual({
      blocks: [
        { text: "Project created.", type: "markdown" },
        {
          elements: [
            {
              accessibility_label: "Open this Project",
              action_id: "open_openmeld_navigation_action",
              text: {
                emoji: true,
                text: "Open this Project",
                type: "plain_text",
              },
              type: "button",
              url: "https://openmeld.ai/o/amplift/projects/project_123",
            },
          ],
          type: "actions",
        },
      ],
      text: "Project created.\n\n<https://openmeld.ai/o/amplift/projects/project_123|Open this Project>",
    });
  });

  it("removes untrusted internal Navigation Action embeds from Slack replies", () => {
    const connectedComputerId = "019690bc-6f82-4ee0-9975-7360491fea69";
    const presentation = buildSlackFinalReplyPresentation(
      [
        "Your computer needs to reconnect.",
        `<openmeld_navigation_action_embed kind="computer_setup" mode="reconnect" connected_computer_id="${connectedComputerId}" />`,
      ].join("\n\n")
    );

    expect(presentation).toEqual({
      blocks: [
        {
          text: "Your computer needs to reconnect.",
          type: "markdown",
        },
      ],
      text: "Your computer needs to reconnect.",
    });
    expect(JSON.stringify(presentation)).not.toContain(connectedComputerId);
  });

  it("fails closed when an internal Navigation Action embed is the whole reply", () => {
    const presentation = buildSlackFinalReplyPresentation(
      "&lt;openmeld_navigation_action_embed kind=&quot;computer_setup&quot; /&gt;"
    );

    expect(presentation).toEqual({
      blocks: [
        {
          text: "I couldn't show that action here safely.",
          type: "markdown",
        },
      ],
      text: "I couldn't show that action here safely.",
    });
  });

  it("keeps the Navigation Action in a truncated Slack fallback", () => {
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/amplift",
      target: { kind: "project", projectId: "project_123" },
    });

    const presentation = buildSlackFinalReplyPresentation(
      "a".repeat(50_000),
      action
    );

    expect(Array.from(presentation.text)).toHaveLength(40_000);
    expect(
      presentation.text.endsWith(
        "<https://openmeld.ai/o/amplift/projects/project_123|Open this Project>"
      )
    ).toBe(true);
    expect(presentation.blocks?.[0]).toMatchObject({
      type: "markdown",
      text: expect.stringContaining("OpenMeld shortened this reply"),
    });
    expect(presentation.blocks?.[1]).toMatchObject({
      type: "actions",
    });
  });

  it("keeps a Unicode action reply within Slack's markdown block limit", () => {
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/amplift",
      target: { kind: "project", projectId: "project_123" },
    });

    const presentation = buildSlackFinalReplyPresentation(
      "😀".repeat(12_000),
      action
    );
    const bodyBlock = presentation.blocks?.[0];

    expect(bodyBlock?.type).toBe("markdown");
    if (bodyBlock?.type !== "markdown") {
      throw new Error("expected a markdown body block");
    }
    expect(bodyBlock.text.length).toBeLessThanOrEqual(12_000);
    expect(bodyBlock.text).not.toContain("�");
    expect(bodyBlock.text).toContain("OpenMeld shortened this reply");
  });

  it("leaves standard Markdown tables for Slack to render", () => {
    const markdown = `| Repository | Open issues |
| --- | --- |
| amplifthq/openmeld | 0 |`;

    expect(buildSlackFinalReplyPresentation(markdown)).toMatchObject({
      blocks: [{ text: markdown, type: "markdown" }],
    });
  });

  it("renders ordinary Markdown as a Slack markdown block with mrkdwn fallback", () => {
    const presentation = buildSlackFinalReplyPresentation(
      "**Ready**\n\nSee [OpenMeld](https://openmeld.ai)."
    );

    expect(presentation.blocks).toEqual([
      {
        text: "**Ready**\n\nSee [OpenMeld](https://openmeld.ai).",
        type: "markdown",
      },
    ]);
    expect(presentation.text).toContain("*Ready*");
    expect(presentation.text).toContain("See <https://openmeld.ai|OpenMeld>.");
  });

  it("repairs clickable Slack content that the agent accidentally wrapped as code", () => {
    const presentation = buildSlackFinalReplyPresentation(
      [
        "`<https://github.com/amplifthq/reply/pull/154|#154 fix P0 · 3 files · +5/-3>`",
        "```text",
        "<https://openmeld.ai/o/amplift/spaces/space_123|Open Space>",
        "```",
        "Notify `<@U123456>`.",
      ].join("\n")
    );

    expect(presentation.blocks).toEqual([
      {
        text: [
          "[#154 fix P0 · 3 files · +5/-3](https://github.com/amplifthq/reply/pull/154)",
          "[Open Space](https://openmeld.ai/o/amplift/spaces/space_123)",
          "Notify <@U123456>.",
        ].join("\n"),
        type: "markdown",
      },
    ]);
    expect(presentation.text).toBe(
      [
        "<https://github.com/amplifthq/reply/pull/154|#154 fix P0 · 3 files · +5/-3>",
        "<https://openmeld.ai/o/amplift/spaces/space_123|Open Space>",
        "Notify <@U123456>.",
      ].join("\n")
    );
  });

  it("uses a markdown block at Slack's documented 12,000-character limit", () => {
    const markdown = "a".repeat(12_000);

    expect(buildSlackFinalReplyPresentation(markdown)).toEqual({
      blocks: [{ text: markdown, type: "markdown" }],
      text: markdown,
    });
  });

  it("uses text-only presentation above Slack's markdown block limit", () => {
    const markdown = `**${"a".repeat(12_000)}**`;
    const presentation = buildSlackFinalReplyPresentation(markdown);

    expect(presentation).toEqual({
      text: expect.stringContaining("a".repeat(12_000)),
    });
  });

  it("falls back conservatively when Unicode needs multiple UTF-16 code units", () => {
    const markdown = `${"a".repeat(11_999)}😀`;

    expect(buildSlackFinalReplyPresentation(markdown)).toEqual({
      text: markdown,
    });
  });

  it("shortens over-limit Slack text explicitly instead of silently overflowing", () => {
    const presentation = buildSlackFinalReplyPresentation("a".repeat(40_100));

    expect(presentation.blocks).toBeUndefined();
    expect(Array.from(presentation.text)).toHaveLength(40_000);
    expect(presentation.text).toContain(
      "OpenMeld shortened this reply because Slack limits messages"
    );
  });
});
