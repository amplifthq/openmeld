import type { SlackBlockKitBlock, SlackSearchMessage } from "./slack-client";

const SLACK_SEARCH_PRESENTATION_RESULT_LIMIT = 5;
const SLACK_SEARCH_SNIPPET_MAX_CHARS = 700;

export function buildSlackSearchPresentation(input: {
  messages: SlackSearchMessage[];
  moreResultsAvailable: boolean;
  query: string;
}): {
  blocks: SlackBlockKitBlock[];
  text: string;
} {
  const messages = input.messages.slice(
    0,
    SLACK_SEARCH_PRESENTATION_RESULT_LIMIT
  );
  if (messages.length === 0) {
    return {
      blocks: [
        buildHeaderBlock(),
        {
          text: {
            text: `No public Slack messages matched \`${escapeSlackMrkdwn(input.query)}\`.`,
            type: "mrkdwn",
          },
          type: "section",
        },
      ],
      text: `No public Slack messages matched "${escapeSlackMrkdwn(input.query)}".`,
    };
  }
  const blocks: SlackBlockKitBlock[] = [
    buildHeaderBlock(),
    {
      elements: [
        {
          text: `Public messages matching \`${escapeSlackMrkdwn(input.query)}\``,
          type: "mrkdwn",
        },
      ],
      type: "context",
    },
    ...messages.map((message) => ({
      text: {
        text: `*${escapeSlackMrkdwn(message.authorName)} in #${escapeSlackMrkdwn(message.channelName)}*\n${escapeSlackMrkdwn(truncateSearchSnippet(message.content))}\n<${message.permalink}|Open source>`,
        type: "mrkdwn",
      },
      type: "section",
    })),
  ];
  if (input.moreResultsAvailable) {
    blocks.push({
      elements: [
        {
          text: "More matching messages may be available. Refine the query to narrow the results.",
          type: "mrkdwn",
        },
      ],
      type: "context",
    });
  }
  return {
    blocks,
    text: [
      `Slack search results for "${escapeSlackMrkdwn(input.query)}":`,
      ...messages.map(
        (message) =>
          `${escapeSlackMrkdwn(message.authorName)} in #${escapeSlackMrkdwn(message.channelName)}\n${escapeSlackMrkdwn(truncateSearchSnippet(message.content))}\n${message.permalink}`
      ),
      ...(input.moreResultsAvailable
        ? ["More matching messages may be available."]
        : []),
    ].join("\n\n"),
  };
}

function buildHeaderBlock(): SlackBlockKitBlock {
  return {
    text: {
      text: "Slack search results",
      type: "plain_text",
    },
    type: "header",
  };
}

function escapeSlackMrkdwn(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function truncateSearchSnippet(value: string): string {
  if (value.length <= SLACK_SEARCH_SNIPPET_MAX_CHARS) {
    return value;
  }
  return `${value.slice(0, SLACK_SEARCH_SNIPPET_MAX_CHARS - 1).trimEnd()}…`;
}
