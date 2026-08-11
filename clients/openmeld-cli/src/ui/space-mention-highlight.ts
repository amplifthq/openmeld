import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  buildSpaceMentionProfileIndex,
  collectResolvedSpaceMentions,
  type SpaceMentionProfileIdentity,
  type SpaceMentionProfileIndex,
} from "@openmeld/space";

export type MentionHighlightProfileIdentity = SpaceMentionProfileIdentity;
export type SpaceMentionHighlightIndex = SpaceMentionProfileIndex;

export function buildSpaceMentionHighlightIndex(
  snapshot: SpaceMembersSnapshot
): SpaceMentionHighlightIndex {
  return buildSpaceMentionProfileIndex(snapshot);
}

export function highlightSpaceMentions(input: {
  text: string;
  index?: SpaceMentionHighlightIndex | null;
  render: (
    mentionText: string,
    profileIdentity: MentionHighlightProfileIdentity
  ) => string;
}): string {
  if (!(input.index && input.text.length > 0)) {
    return input.text;
  }
  const matches = collectResolvedSpaceMentions({
    text: input.text,
    index: input.index,
  });
  if (matches.length === 0) {
    return input.text;
  }

  let cursor = 0;
  let highlighted = "";
  for (const match of matches) {
    highlighted += input.text.slice(cursor, match.start);
    highlighted += input.render(match.mentionText, match.profileIdentity);
    cursor = match.end;
  }
  highlighted += input.text.slice(cursor);
  return highlighted;
}
