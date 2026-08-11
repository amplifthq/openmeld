const MENTION_START_PATTERN = /[\w\\]/u;
const MENTION_LEADING_WHITESPACE_PATTERN = /^@\s/u;

export function extractMentionAuthoringPrefix(
  textBeforeCursor: string
): string | null {
  if (!textBeforeCursor) {
    return null;
  }

  for (
    let currentIndex = textBeforeCursor.length - 1;
    currentIndex >= 0;
    currentIndex -= 1
  ) {
    if (textBeforeCursor[currentIndex] !== "@") {
      continue;
    }

    const previousCharacter = textBeforeCursor[currentIndex - 1] ?? "";
    if (
      previousCharacter.length > 0 &&
      MENTION_START_PATTERN.test(previousCharacter)
    ) {
      continue;
    }

    const prefix = textBeforeCursor.slice(currentIndex);
    if (prefix.includes("(") || prefix.includes(")")) {
      return null;
    }

    // "@" immediately followed by whitespace is a literal "@", not a mention:
    // typing "@" then a space dismisses the picker and lets the user write a
    // bare "@". A space later in the query stays valid, so multi-word names
    // like "@Budget Anal" keep matching "Budget Analyst".
    if (MENTION_LEADING_WHITESPACE_PATTERN.test(prefix)) {
      return null;
    }

    return prefix;
  }

  return null;
}
