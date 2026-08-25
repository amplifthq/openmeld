const BLOCKQUOTE_PREFIX_PATTERN = /^((?: {0,3}>[ \t]?)+)(.*)$/;
const INDENTED_CODE_LINE_PATTERN = /^(?: {4}|\t)/;
const MARKDOWN_CLOSING_FENCE_PATTERN = /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/;
const MARKDOWN_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const MARKDOWN_LINK_PATTERN =
  /\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+(?:\s+["'][^"']*["'])?\)/i;
const MARKDOWN_LINK_GLOBAL_PATTERN =
  /\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+(?:\s+["'][^"']*["'])?\)/gi;
const SLACK_TEXT_DIVIDER = "──────────";
const SLACK_BARE_URL_LINK_PATTERN = /<((?:https?:\/\/|mailto:)[^|>\s]+)>/gi;
const SLACK_LABELED_URL_LINK_PATTERN =
  /<((?:https?:\/\/|mailto:)[^|>\s]+)\|([^>\n]+)>/gi;
const SLACK_PRESENTATION_TOKEN_PATTERN =
  /<(?:https?:\/\/|mailto:)[^>|\s]+(?:\|[^>\n]+)?>|<(?:@[A-Z0-9][A-Z0-9._-]*|#[A-Z0-9][A-Z0-9._-]*(?:\|[^>\n]+)?|![^>\n]+)>/i;
const SLACK_PRESENTATION_TOKEN_GLOBAL_PATTERN =
  /<(?:https?:\/\/|mailto:)[^>|\s]+(?:\|[^>\n]+)?>|<(?:@[A-Z0-9][A-Z0-9._-]*|#[A-Z0-9][A-Z0-9._-]*(?:\|[^>\n]+)?|![^>\n]+)>/gi;
const SOURCE_CODE_HINT_PATTERN =
  /(^|\s)(?:class|const|curl|export|for|function|git|if|import|interface|let|node|npm|pnpm|return|switch|type|var|while)\b|=>|[={};]|^\$ /;
const INLINE_CODE_SPAN_PATTERN = /(`+)([^`\n]+?)\1/g;
const THEMATIC_BREAK_PATTERN =
  /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const TRAILING_HARD_BREAK_SPACES_PATTERN = / {2,}$/;

type MarkdownFence = {
  length: number;
  marker: "`" | "~";
};

export async function toSlackMrkdwn(markdown: string): Promise<string> {
  const { slackifyMarkdown } = await import(
    "../../generated-runtime/slackify-markdown.mjs"
  );
  return slackifyMarkdown(
    normalizeMarkdownForSlack(normalizeSlackPresentationMarkdown(markdown))
  ).trimEnd();
}

export function normalizeSlackPresentationMarkdown(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const normalizedLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const openingFence = readMarkdownFence(line);
    if (!openingFence) {
      normalizedLines.push(normalizeSlackPresentationLine(line));
      continue;
    }

    const fencedLines: string[] = [];
    let closingFenceLine: string | null = null;
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      const candidateFence = readMarkdownFence(candidate);
      if (
        candidateFence &&
        isClosingFence(candidate, candidateFence, openingFence)
      ) {
        closingFenceLine = candidate;
        break;
      }
      fencedLines.push(candidate);
    }

    if (closingFenceLine && shouldUnwrapPresentationCodeFence(fencedLines)) {
      normalizedLines.push(
        ...fencedLines.map((fencedLine) =>
          normalizeSlackPresentationLine(fencedLine)
        )
      );
      index = cursor;
      continue;
    }

    normalizedLines.push(line, ...fencedLines);
    if (closingFenceLine) {
      normalizedLines.push(closingFenceLine);
      index = cursor;
    } else {
      index = lines.length;
    }
  }

  return normalizedLines.join("\n");
}

function normalizeMarkdownForSlack(markdown: string): string {
  let activeFence: MarkdownFence | null = null;
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");

  return lines
    .map((line, index) => {
      const { content, prefix } = splitBlockquotePrefix(line);
      const fence = readMarkdownFence(content);

      if (activeFence) {
        if (fence && isClosingFence(content, fence, activeFence)) {
          activeFence = null;
        }
        return line;
      }

      if (fence) {
        activeFence = fence;
        return line;
      }

      if (INDENTED_CODE_LINE_PATTERN.test(content)) {
        return line;
      }

      if (isThematicBreak(content)) {
        return `${prefix}${SLACK_TEXT_DIVIDER}`;
      }

      const normalizedContent =
        index < lines.length - 1 ? removeHardBreakMarker(content) : content;
      return `${prefix}${normalizedContent}`;
    })
    .join("\n");
}

function normalizeSlackPresentationLine(line: string): string {
  let normalized = "";
  let lastIndex = 0;
  for (const match of line.matchAll(INLINE_CODE_SPAN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    normalized += rewriteSlackLinksForMarkdownBlock(
      line.slice(lastIndex, matchIndex)
    );

    const fullMatch = match[0] ?? "";
    const codeContent = match[2] ?? "";
    normalized += shouldUnwrapPresentationCodeContent(codeContent)
      ? rewriteSlackLinksForMarkdownBlock(codeContent)
      : fullMatch;
    lastIndex = matchIndex + fullMatch.length;
  }

  return `${normalized}${rewriteSlackLinksForMarkdownBlock(
    line.slice(lastIndex)
  )}`;
}

function shouldUnwrapPresentationCodeFence(lines: string[]): boolean {
  const contentLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const hasPresentationLine = contentLines.some(hasSlackPresentationToken);
  return (
    contentLines.length > 0 &&
    hasPresentationLine &&
    contentLines.every(
      (line) =>
        shouldUnwrapPresentationCodeContent(line) ||
        !looksLikeSourceCodeLine(line)
    )
  );
}

function shouldUnwrapPresentationCodeContent(content: string): boolean {
  const trimmed = content.trim();
  if (!hasSlackPresentationToken(trimmed)) {
    return false;
  }
  return !looksLikeSourceCodeLine(trimmed);
}

function hasSlackPresentationToken(text: string): boolean {
  return (
    SLACK_PRESENTATION_TOKEN_PATTERN.test(text) ||
    MARKDOWN_LINK_PATTERN.test(text)
  );
}

function looksLikeSourceCodeLine(line: string): boolean {
  const presentationStrippedLine = line
    .replace(SLACK_PRESENTATION_TOKEN_GLOBAL_PATTERN, "")
    .replace(MARKDOWN_LINK_GLOBAL_PATTERN, "");
  return SOURCE_CODE_HINT_PATTERN.test(presentationStrippedLine);
}

function rewriteSlackLinksForMarkdownBlock(text: string): string {
  return text
    .replace(
      SLACK_LABELED_URL_LINK_PATTERN,
      (_match, url: string, label: string) =>
        `[${escapeMarkdownLinkLabel(label)}](${escapeMarkdownLinkUrl(url)})`
    )
    .replace(SLACK_BARE_URL_LINK_PATTERN, "<$1>");
}

function escapeMarkdownLinkLabel(label: string): string {
  return label
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function escapeMarkdownLinkUrl(url: string): string {
  return url.replaceAll(")", "%29");
}

function splitBlockquotePrefix(line: string): {
  content: string;
  prefix: string;
} {
  const match = BLOCKQUOTE_PREFIX_PATTERN.exec(line);
  return match
    ? { content: match[2] ?? "", prefix: match[1] ?? "" }
    : { content: line, prefix: "" };
}

function readMarkdownFence(line: string): MarkdownFence | null {
  const match = MARKDOWN_FENCE_PATTERN.exec(line);
  const markerRun = match?.[1];
  if (!markerRun) {
    return null;
  }
  return {
    length: markerRun.length,
    marker: markerRun[0] as MarkdownFence["marker"],
  };
}

function isClosingFence(
  line: string,
  candidate: MarkdownFence,
  activeFence: MarkdownFence
): boolean {
  if (
    candidate.marker !== activeFence.marker ||
    candidate.length < activeFence.length
  ) {
    return false;
  }
  return MARKDOWN_CLOSING_FENCE_PATTERN.test(line);
}

function isThematicBreak(line: string): boolean {
  return THEMATIC_BREAK_PATTERN.test(line.trim());
}

function removeHardBreakMarker(line: string): string {
  const withoutBackslash =
    line.endsWith("\\") && !line.endsWith("\\\\") ? line.slice(0, -1) : line;
  return withoutBackslash.replace(TRAILING_HARD_BREAK_SPACES_PATTERN, "");
}
