import type {
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  collectCanonicalMentionLabelMatches,
  createSpaceTargetCatalog,
} from "@openmeld/space";

type MentionableSpaceMember =
  | SpaceMemberHumanSnapshot
  | SpaceMemberAgentSnapshot;

export function extractMentionTokensFromText(text: string): string[] {
  return collectCanonicalMentionLabelMatches(text).map(
    (match) => match.mentionLabel
  );
}

export function resolvePreferredSpaceMemberMentionToken(input: {
  member: MentionableSpaceMember;
  snapshot: SpaceMembersSnapshot;
}): string {
  const catalog = createSpaceTargetCatalog(input.snapshot);
  const target = catalog.byProfileId.get(input.member.profileId);
  if (!target) {
    throw new Error(
      `Missing target catalog entry for profile ${input.member.profileId}.`
    );
  }

  return target.primaryMentionLabel;
}

export function listSpaceMemberMentionLookupTokens(input: {
  member: MentionableSpaceMember;
  snapshot: SpaceMembersSnapshot;
}): string[] {
  const catalog = createSpaceTargetCatalog(input.snapshot);
  const target = catalog.byProfileId.get(input.member.profileId);
  if (!target) {
    throw new Error(
      `Missing target catalog entry for profile ${input.member.profileId}.`
    );
  }

  return [...target.exactMentionLabels];
}
