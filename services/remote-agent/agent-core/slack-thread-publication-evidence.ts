import { parseSlackThreadPublicationPermalink } from "@openmeld/schemas";

const HTTPS_URL_CANDIDATE_PATTERN = /https:\/\/[^\s<>"'|]+/giu;
const TRAILING_URL_PUNCTUATION_PATTERN = /[),.!?;\]]+$/u;
const MAX_TRUSTED_SLACK_THREAD_TARGETS = 32;

export function buildSlackThreadPublicationTargetKey(input: {
  channelId: string;
  threadTs: string;
}): string {
  return `${input.channelId}:${input.threadTs}`;
}

export function parseSlackThreadPublicationTargetKey(
  permalink: string
): string | null {
  const target = parseSlackThreadPublicationPermalink(permalink);
  return target ? buildSlackThreadPublicationTargetKey(target) : null;
}

export function extractSlackThreadPublicationTargetKeys(
  contents: readonly string[]
): string[] {
  const targetKeys = new Set<string>();
  for (const content of contents) {
    for (const candidateMatch of content.matchAll(
      HTTPS_URL_CANDIDATE_PATTERN
    )) {
      const candidate = candidateMatch[0].replace(
        TRAILING_URL_PUNCTUATION_PATTERN,
        ""
      );
      const targetKey = parseSlackThreadPublicationTargetKey(candidate);
      if (targetKey) {
        targetKeys.add(targetKey);
      }
      if (targetKeys.size >= MAX_TRUSTED_SLACK_THREAD_TARGETS) {
        return [...targetKeys];
      }
    }
  }
  return [...targetKeys];
}

export function extractSlackSearchThreadPublicationTargetKeys(
  response: unknown
): string[] {
  if (!(response && typeof response === "object" && "messages" in response)) {
    return [];
  }
  const messages = Array.isArray(response.messages) ? response.messages : [];
  const permalinks: string[] = [];
  for (const message of messages) {
    if (!(message && typeof message === "object")) {
      continue;
    }
    if (typeof message.permalink === "string") {
      permalinks.push(message.permalink);
    }
    if (
      "contextMessages" in message &&
      Array.isArray(message.contextMessages)
    ) {
      for (const contextMessage of message.contextMessages) {
        if (
          contextMessage &&
          typeof contextMessage === "object" &&
          "permalink" in contextMessage &&
          typeof contextMessage.permalink === "string"
        ) {
          permalinks.push(contextMessage.permalink);
        }
      }
    }
  }
  return [...new Set(permalinks.flatMap(parseSlackThreadPublicationTargetKey))]
    .filter((targetKey): targetKey is string => targetKey !== null)
    .slice(0, MAX_TRUSTED_SLACK_THREAD_TARGETS);
}
