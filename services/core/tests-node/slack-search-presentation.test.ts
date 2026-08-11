import { describe, expect, it } from "vitest";
import { buildSlackSearchPresentation } from "../src/remote-agent/application/slack-search-presentation";

describe("Slack search presentation", () => {
  it("renders untrusted search text without creating Slack control tokens", () => {
    const presentation = buildSlackSearchPresentation({
      messages: [
        {
          authorName: "Ava & Lee",
          authorUserId: "U_AVA",
          channelId: "C_RELEASE",
          channelName: "release",
          content: "Ask <@U_TARGET> about A & B > C.",
          isAuthorBot: false,
          messageTs: "1710000000.001",
          permalink:
            "https://example.slack.com/archives/C_RELEASE/p1710000000001",
        },
      ],
      moreResultsAvailable: false,
      query: "status from <@U_TARGET>",
    });

    expect(JSON.stringify(presentation.blocks)).not.toContain("<@U_TARGET>");
    expect(presentation.text).not.toContain("<@U_TARGET>");
    expect(presentation.text).toContain("&lt;@U_TARGET&gt;");
  });
});
