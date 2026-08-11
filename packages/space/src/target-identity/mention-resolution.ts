import type {
  MessageMentionType,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { collectCanonicalMentionLabelMatches } from "./mention-text";
import { createSpaceTargetCatalog } from "./target-catalog";

export type SpaceMentionProfileIdentity = {
  ownerName?: string | null;
  ownerUserId?: string | null;
  openMeldProfileId: string;
  profileName: string;
  kind: "human" | "agent";
};

export type SpaceMentionProfileIndex = ReadonlyMap<
  string,
  SpaceMentionProfileIdentity
>;

export type ResolvedSpaceMention = {
  start: number;
  end: number;
  mentionText: string;
  profileIdentity: SpaceMentionProfileIdentity;
};

export function buildSpaceMentionProfileIndex(
  snapshot: SpaceMembersSnapshot
): SpaceMentionProfileIndex {
  const catalog = createSpaceTargetCatalog(snapshot);
  const profileIdentityByProfileId = new Map<
    string,
    SpaceMentionProfileIdentity
  >();
  const byLabelAndRelation = new Map<string, SpaceMentionProfileIdentity>();

  for (const [exactMentionLabel, entry] of catalog.byExactMentionLabel) {
    let profileIdentity = profileIdentityByProfileId.get(entry.profileId);
    if (!profileIdentity) {
      profileIdentity = {
        ownerName: entry.ownerName,
        ownerUserId: entry.ownerUserId,
        openMeldProfileId: entry.profileId,
        profileName: entry.profileName,
        kind: entry.profileKind,
      };
      profileIdentityByProfileId.set(entry.profileId, profileIdentity);
    }

    for (const relation of CANONICAL_MENTION_RELATIONS) {
      if (!entry.allowedRelations[relation]) {
        continue;
      }
      byLabelAndRelation.set(
        buildMentionRelationKey(exactMentionLabel, relation),
        profileIdentity
      );
    }
  }

  return byLabelAndRelation;
}

export function collectResolvedSpaceMentions(input: {
  text: string;
  index: SpaceMentionProfileIndex;
}): ResolvedSpaceMention[] {
  const matches: ResolvedSpaceMention[] = [];

  for (const match of collectCanonicalMentionLabelMatches(input.text)) {
    const profileIdentity = input.index.get(
      buildMentionRelationKey(match.mentionLabel, match.type)
    );
    if (!profileIdentity) {
      continue;
    }
    matches.push({
      start: match.start,
      end: match.end,
      mentionText: match.mentionText,
      profileIdentity,
    });
  }

  return matches;
}

export function listRecentMentionProfileIdsFromText(input: {
  text: string;
  index: SpaceMentionProfileIndex;
}): string[] {
  const matches = collectResolvedSpaceMentions(input);
  const recentProfileIds: string[] = [];
  const seenProfileIds = new Set<string>();

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const profileId = matches[index]?.profileIdentity.openMeldProfileId;
    if (!(profileId && !seenProfileIds.has(profileId))) {
      continue;
    }
    seenProfileIds.add(profileId);
    recentProfileIds.push(profileId);
  }

  return recentProfileIds;
}

const CANONICAL_MENTION_RELATIONS = ["wake", "reference"] as const;

function buildMentionRelationKey(
  mentionLabel: string,
  relation: MessageMentionType
): string {
  return `${relation}:${mentionLabel}`;
}
