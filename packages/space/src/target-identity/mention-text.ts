import { collectCanonicalMentionTextFragments } from "@openmeld/schemas";
import type { MessageMentionType } from "@openmeld/schemas/types";

export type MentionTextLabelMatch = {
  end: number;
  mentionLabel: string;
  mentionText: string;
  start: number;
  type: MessageMentionType;
};

export function collectCanonicalMentionLabelMatches(
  text: string
): MentionTextLabelMatch[] {
  return collectCanonicalMentionTextFragments(text).flatMap((fragment) => {
    if (!fragment.parsedLiteral) {
      return [];
    }

    return [
      {
        end: fragment.end,
        mentionLabel: fragment.parsedLiteral.name,
        mentionText: fragment.text,
        start: fragment.start,
        type: fragment.parsedLiteral.type,
      },
    ];
  });
}
