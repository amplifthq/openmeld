import { fromMarkdown } from "mdast-util-from-markdown";
import remend, { type RemendOptions } from "remend";

/**
 * Provider adapters must deliver tool activity through typed stream events.
 * These reserved tags are never executable protocol on the publication path;
 * finding one only proves that provider protocol leaked into assistant prose.
 */
const RESERVED_PROVIDER_PROTOCOL_TAGS = [
  "function_call",
  "function_result",
  "tool_call",
  "tool_result",
] as const;
const MARKDOWN_BLOCK_CONTAINER_TYPES = new Set([
  "blockquote",
  "list",
  "listItem",
  "root",
]);
// Streamdown repairs an unfinished inline-code span while tokens are arriving.
// Match that one visibility-changing rule only for streaming snapshots. Final
// publication also reaches Slack and other non-Web surfaces, where an unmatched
// backtick is ordinary visible prose and must still fail closed.
const STREAMING_INLINE_CODE_NORMALIZATION = {
  bold: false,
  boldItalic: false,
  comparisonOperators: false,
  htmlTags: false,
  images: false,
  inlineCode: true,
  inlineKatex: false,
  italic: false,
  katex: false,
  links: false,
  setextHeadings: false,
  singleTilde: false,
  strikethrough: false,
} satisfies RemendOptions;

type PublicationMarkdownNode = {
  alt?: unknown;
  children?: readonly PublicationMarkdownNode[];
  type: string;
  value?: unknown;
};

export const CENTER_AGENT_ASSISTANT_PROTOCOL_CONTAMINATION_REASON_CODE =
  "remote_agent.assistant_protocol_contamination";

export type AssistantPublicationProtocolInspection =
  | { status: "publishable" }
  | {
      marker: (typeof RESERVED_PROVIDER_PROTOCOL_TAGS)[number];
      status: "contaminated" | "incomplete";
    };

export function inspectAssistantPublicationProtocol(
  text: string
): AssistantPublicationProtocolInspection {
  return inspectRenderedAssistantPublicationProtocol(text);
}

export function inspectStreamingAssistantPublicationProtocol(
  text: string
): AssistantPublicationProtocolInspection {
  return inspectRenderedAssistantPublicationProtocol(
    remend(text, STREAMING_INLINE_CODE_NORMALIZATION)
  );
}

function inspectRenderedAssistantPublicationProtocol(
  text: string
): AssistantPublicationProtocolInspection {
  const lowerText = extractVisibleMarkdownProse(text).toLowerCase();

  for (let index = 0; index < lowerText.length; index += 1) {
    if (lowerText[index] !== "<") {
      continue;
    }
    const parsed = readProtocolTagCandidate(lowerText, index);
    if (parsed) {
      return parsed;
    }
  }

  return { status: "publishable" };
}

function extractVisibleMarkdownProse(text: string): string {
  const root = fromMarkdown(text) as unknown as PublicationMarkdownNode;
  return renderVisibleMarkdownProse(root);
}

function renderVisibleMarkdownProse(node: PublicationMarkdownNode): string {
  if (node.type === "code" || node.type === "inlineCode") {
    return "";
  }
  if (node.type === "text" && typeof node.value === "string") {
    return node.value;
  }
  if (
    (node.type === "image" || node.type === "imageReference") &&
    typeof node.alt === "string"
  ) {
    return node.alt;
  }
  if (node.type === "break") {
    return "\n";
  }
  if (!node.children) {
    return "";
  }
  const separator = MARKDOWN_BLOCK_CONTAINER_TYPES.has(node.type) ? "\n" : "";
  return node.children.map(renderVisibleMarkdownProse).join(separator);
}

function readProtocolTagCandidate(
  text: string,
  startIndex: number
): Exclude<
  AssistantPublicationProtocolInspection,
  { status: "publishable" }
> | null {
  let nameStart = startIndex + 1;
  if (text[nameStart] === "/") {
    nameStart += 1;
  }
  const candidate = text.slice(nameStart);

  for (const marker of RESERVED_PROVIDER_PROTOCOL_TAGS) {
    if (candidate.startsWith(marker)) {
      const boundary = candidate[marker.length];
      if (
        boundary === undefined ||
        boundary === ">" ||
        boundary === "/" ||
        isProtocolBoundaryWhitespace(boundary)
      ) {
        return {
          marker,
          status: boundary === undefined ? "incomplete" : "contaminated",
        };
      }
    }
    if (marker.startsWith(candidate) && candidate.length >= 2) {
      return { marker, status: "incomplete" };
    }
  }

  return null;
}

function isProtocolBoundaryWhitespace(value: string): boolean {
  return value.length === 1 && value.trim().length === 0;
}
