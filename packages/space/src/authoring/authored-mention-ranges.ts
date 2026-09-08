import type { SpaceComposerAuthoredMentionInTextOrder } from "./composer-submission";

/** Preserve selected identities across edits; typed text never creates one. */
export function updateAuthoredMentionRanges(input: {
  previousText: string;
  text: string;
  mentions: readonly SpaceComposerAuthoredMentionInTextOrder[];
}): SpaceComposerAuthoredMentionInTextOrder[] {
  if (input.previousText === input.text) {
    return [...input.mentions];
  }
  let start = 0;
  while (
    start < input.previousText.length &&
    start < input.text.length &&
    input.previousText[start] === input.text[start]
  ) {
    start++;
  }
  let oldEnd = input.previousText.length;
  let newEnd = input.text.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    input.previousText[oldEnd - 1] === input.text[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  return input.mentions.flatMap((mention) => {
    if (mention.start === undefined) {
      return [];
    }
    const end = mention.start + mention.text.length;
    if (end <= start) {
      return [mention];
    }
    if (mention.start >= oldEnd) {
      return [{ ...mention, start: mention.start + delta }];
    }
    return [];
  });
}
