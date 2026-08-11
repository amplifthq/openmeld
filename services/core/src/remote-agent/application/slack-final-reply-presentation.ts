import type { NavigationAction } from "@openmeld/schemas";
import {
  normalizeSlackPresentationMarkdown,
  toSlackMrkdwn,
} from "./slack-mrkdwn";

const SLACK_MARKDOWN_BLOCK_MAX_CHARS = 12_000;
const SLACK_TEXT_MAX_CHARS = 40_000;
const SLACK_MARKDOWN_BLOCK_TRUNCATION_NOTICE =
  "\n\n_OpenMeld shortened this reply in the Slack message view. The complete reply remains in Slack's message fallback._";
const SLACK_TEXT_TRUNCATION_NOTICE =
  "\n\n_OpenMeld shortened this reply because Slack limits messages to 40,000 characters. Ask for the remaining details or an OpenMeld document._";
const INTERNAL_NAVIGATION_ACTION_EMBED_PATTERN =
  /<\/?openmeld_navigation_action_embed\b[^>]*>/giu;
const ENCODED_INTERNAL_NAVIGATION_ACTION_EMBED_PATTERN =
  /&lt;\/?openmeld_navigation_action_embed\b[\s\S]*?&gt;/giu;
const UNSAFE_NAVIGATION_ACTION_FALLBACK =
  "I couldn't show that action here safely.";

export type SlackFinalReplyMarkdownBlock = Readonly<{
  text: string;
  type: "markdown";
}>;

export type SlackFinalReplyActionBlock = Readonly<{
  elements: readonly [
    Readonly<{
      accessibility_label: string;
      action_id: "open_openmeld_navigation_action";
      text: Readonly<{
        emoji: true;
        text: string;
        type: "plain_text";
      }>;
      type: "button";
      url: string;
    }>,
  ];
  type: "actions";
}>;

type SlackFinalReplyPresentation = Readonly<{
  blocks?: readonly (
    | SlackFinalReplyActionBlock
    | SlackFinalReplyMarkdownBlock
  )[];
  text: string;
}>;

export function buildSlackFinalReplyPresentation(
  markdown: string,
  navigationAction?: NavigationAction
): SlackFinalReplyPresentation {
  const presentationMarkdown = normalizeSlackPresentationMarkdown(
    removeInternalNavigationActionEmbeds(markdown)
  );
  const slackMrkdwn = toSlackMrkdwn(presentationMarkdown);
  const shortenedBodyText = shortenSlackText(slackMrkdwn);
  const text = navigationAction
    ? buildSlackNavigationFallbackText(slackMrkdwn, navigationAction)
    : shortenedBodyText;
  const canRenderMarkdownBlock =
    presentationMarkdown.length <= SLACK_MARKDOWN_BLOCK_MAX_CHARS &&
    shortenedBodyText === slackMrkdwn;
  if (!(canRenderMarkdownBlock || navigationAction)) {
    return { text };
  }
  return {
    blocks: [
      ...(canRenderMarkdownBlock || navigationAction
        ? [
            {
              text: canRenderMarkdownBlock
                ? presentationMarkdown
                : shortenSlackMarkdownBlock(presentationMarkdown),
              type: "markdown",
            } as const,
          ]
        : []),
      ...(navigationAction
        ? [buildSlackNavigationActionBlock(navigationAction)]
        : []),
    ],
    text,
  };
}

function removeInternalNavigationActionEmbeds(markdown: string): string {
  const withoutInternalEmbeds = markdown
    .replace(INTERNAL_NAVIGATION_ACTION_EMBED_PATTERN, "")
    .replace(ENCODED_INTERNAL_NAVIGATION_ACTION_EMBED_PATTERN, "");
  if (withoutInternalEmbeds === markdown) {
    return markdown;
  }
  return withoutInternalEmbeds.trim() || UNSAFE_NAVIGATION_ACTION_FALLBACK;
}

function shortenSlackMarkdownBlock(markdown: string): string {
  const retainedCharacters =
    SLACK_MARKDOWN_BLOCK_MAX_CHARS -
    SLACK_MARKDOWN_BLOCK_TRUNCATION_NOTICE.length;
  let sliceEnd = retainedCharacters;
  const lastRetainedCodeUnit = markdown.charCodeAt(sliceEnd - 1);
  const firstRemovedCodeUnit = markdown.charCodeAt(sliceEnd);
  if (
    lastRetainedCodeUnit >= 0xd8_00 &&
    lastRetainedCodeUnit <= 0xdb_ff &&
    firstRemovedCodeUnit >= 0xdc_00 &&
    firstRemovedCodeUnit <= 0xdf_ff
  ) {
    sliceEnd -= 1;
  }
  return `${markdown.slice(0, sliceEnd)}${SLACK_MARKDOWN_BLOCK_TRUNCATION_NOTICE}`;
}

function buildSlackNavigationFallbackText(
  text: string,
  action: NavigationAction
): string {
  const actionSuffix = `\n\n<${action.url}|${action.label}>`;
  const actionSuffixLength = Array.from(actionSuffix).length;
  return `${shortenSlackText(text, SLACK_TEXT_MAX_CHARS - actionSuffixLength)}${actionSuffix}`;
}

function buildSlackNavigationActionBlock(
  action: NavigationAction
): SlackFinalReplyActionBlock {
  return {
    elements: [
      {
        accessibility_label: action.label,
        action_id: "open_openmeld_navigation_action",
        text: {
          emoji: true,
          text: action.label,
          type: "plain_text",
        },
        type: "button",
        url: action.url,
      },
    ],
    type: "actions",
  };
}

function shortenSlackText(
  text: string,
  maxCharacters = SLACK_TEXT_MAX_CHARS
): string {
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) {
    return text;
  }
  const noticeCharacters = Array.from(SLACK_TEXT_TRUNCATION_NOTICE);
  const retainedCharacters = maxCharacters - noticeCharacters.length;
  return `${characters.slice(0, retainedCharacters).join("")}${SLACK_TEXT_TRUNCATION_NOTICE}`;
}
