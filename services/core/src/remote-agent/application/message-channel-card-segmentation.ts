import { LARK_PLATFORM_STREAMING_CARD_MAX_CHARS } from "./lark-platform-openapi-client";
import { MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS } from "./message-channel-terminal-content";

const CODE_FENCE_PATTERN = /^```([^\s`]*)[^\n]*$/u;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s/u;
const MESSAGE_CHANNEL_CARD_MIN_PREFERRED_FILL_RATIO = 0.6;

export const MESSAGE_CHANNEL_CARD_MAX_SEGMENTS = Math.ceil(
  MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS /
    (LARK_PLATFORM_STREAMING_CARD_MAX_CHARS *
      MESSAGE_CHANNEL_CARD_MIN_PREFERRED_FILL_RATIO)
);
export { MESSAGE_CHANNEL_CARD_MAX_TOTAL_CHARS };

export type MessageChannelCardSegment = {
  head: string;
  sourceEnd: number;
  tail: string;
};

export function splitMessageChannelCardSegment(input: {
  sourceOffset: number;
  text: string;
}): MessageChannelCardSegment {
  assertValidSourceOffset(input);
  const activeText = renderMessageChannelCardText(input);
  if (activeText.length <= LARK_PLATFORM_STREAMING_CARD_MAX_CHARS) {
    return {
      head: activeText,
      sourceEnd: input.text.length,
      tail: "",
    };
  }

  const prefix = buildReopenedFencePrefix(input.text, input.sourceOffset);
  let sourceEnd = chooseSourceBoundary({
    availableChars: LARK_PLATFORM_STREAMING_CARD_MAX_CHARS - prefix.length - 4,
    sourceOffset: input.sourceOffset,
    text: input.text,
  });
  let head = renderMessageChannelCardText({
    sourceEnd,
    sourceOffset: input.sourceOffset,
    text: input.text,
  });
  while (
    head.length > LARK_PLATFORM_STREAMING_CARD_MAX_CHARS &&
    sourceEnd > input.sourceOffset
  ) {
    sourceEnd = previousUnicodeBoundary(input.text, sourceEnd);
    head = renderMessageChannelCardText({
      sourceEnd,
      sourceOffset: input.sourceOffset,
      text: input.text,
    });
  }
  if (
    sourceEnd <= input.sourceOffset ||
    head.length > LARK_PLATFORM_STREAMING_CARD_MAX_CHARS
  ) {
    throw new Error("Message Channel card text cannot be split safely");
  }
  return {
    head,
    sourceEnd,
    tail: renderMessageChannelCardText({
      sourceOffset: sourceEnd,
      text: input.text,
    }),
  };
}

export function renderMessageChannelCardText(input: {
  sourceEnd?: number;
  sourceOffset: number;
  text: string;
}): string {
  assertValidSourceOffset(input);
  const sourceEnd = input.sourceEnd ?? input.text.length;
  if (
    !Number.isSafeInteger(sourceEnd) ||
    sourceEnd < input.sourceOffset ||
    sourceEnd > input.text.length
  ) {
    throw new Error("Message Channel card source end is invalid");
  }
  const prefix = buildReopenedFencePrefix(input.text, input.sourceOffset);
  const source = input.text.slice(input.sourceOffset, sourceEnd);
  const openFence = readOpenFence(input.text, sourceEnd);
  const suffix =
    sourceEnd < input.text.length && openFence !== null
      ? `${source.endsWith("\n") ? "" : "\n"}\`\`\``
      : "";
  return `${prefix}${source}${suffix}`;
}

export async function hashMessageChannelCardText(
  text: string
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function assertValidSourceOffset(input: {
  sourceOffset: number;
  text: string;
}): void {
  if (
    !Number.isSafeInteger(input.sourceOffset) ||
    input.sourceOffset < 0 ||
    input.sourceOffset > input.text.length
  ) {
    throw new Error("Message Channel card source offset is invalid");
  }
}

function buildReopenedFencePrefix(text: string, sourceOffset: number): string {
  if (sourceOffset === 0) {
    return "";
  }
  const openFence = readOpenFence(text, sourceOffset);
  return openFence === null ? "" : `\`\`\`${openFence}\n`;
}

function chooseSourceBoundary(input: {
  availableChars: number;
  sourceOffset: number;
  text: string;
}): number {
  if (input.availableChars <= 0) {
    throw new Error("Message Channel card has no room for source text");
  }
  const maximumEnd = adjustUnicodeBoundary(
    input.text,
    Math.min(input.text.length, input.sourceOffset + input.availableChars)
  );
  const minimumPreferredLength = Math.floor(
    input.availableChars * MESSAGE_CHANNEL_CARD_MIN_PREFERRED_FILL_RATIO
  );
  const candidate = input.text.slice(input.sourceOffset, maximumEnd);
  const headingBoundary = findHeadingBoundary(
    candidate,
    minimumPreferredLength
  );
  if (headingBoundary !== null) {
    return adjustUnicodeBoundary(
      input.text,
      input.sourceOffset + headingBoundary
    );
  }
  const newlineIndex = candidate.lastIndexOf("\n");
  if (newlineIndex >= 0 && newlineIndex + 1 >= minimumPreferredLength) {
    return adjustUnicodeBoundary(
      input.text,
      input.sourceOffset + newlineIndex + 1
    );
  }
  return maximumEnd;
}

function findHeadingBoundary(
  candidate: string,
  minimumPreferredEnd: number
): number | null {
  const lines = candidate.split("\n");
  let offset = 0;
  for (const line of lines) {
    if (
      offset >= minimumPreferredEnd &&
      MARKDOWN_HEADING_PATTERN.test(line) &&
      offset > 0
    ) {
      return offset;
    }
    offset += line.length + 1;
  }
  return null;
}

function readOpenFence(text: string, sourceEnd: number): string | null {
  let openFence: string | null = null;
  const source = text.slice(0, sourceEnd);
  for (const line of source.split("\n")) {
    const match = CODE_FENCE_PATTERN.exec(line);
    if (!match) {
      continue;
    }
    openFence = openFence === null ? (match[1] ?? "") : null;
  }
  return openFence;
}

function adjustUnicodeBoundary(text: string, offset: number): number {
  if (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
  ) {
    return offset - 1;
  }
  return offset;
}

function previousUnicodeBoundary(text: string, offset: number): number {
  return adjustUnicodeBoundary(text, Math.max(0, offset - 1));
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd8_00 && codeUnit <= 0xdb_ff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc_00 && codeUnit <= 0xdf_ff;
}
