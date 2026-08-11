import {
  getSpaceMessageAddressingRelationSupportForTargetKind,
  resolveSpaceMentionLabels,
} from "@openmeld/schemas";
import type {
  SpaceIdentityDirectory,
  SpaceIdentityDirectoryEntry,
  SpaceMemberDirectory,
  SpaceMemberDirectoryEntry,
} from "@openmeld/schemas/types";
import { normalizeReadableMentionLookupToken } from "../target-identity/target-catalog";

export function buildSpaceMemberDirectoryFromIdentityDirectory(
  identityDirectory: SpaceIdentityDirectory
): SpaceMemberDirectory {
  const labelByProfileId = resolveSpaceMentionLabels(
    identityDirectory.entries.map((entry) => ({
      mentionAlias: entry.mentionAlias,
      profileId: entry.profileId,
      profileName: entry.profileName,
    }))
  );
  const lookupTokenCounts = buildLookupTokenCounts(identityDirectory.entries, {
    labelByProfileId,
  });
  const members = identityDirectory.entries
    .map((entry) => {
      const labels = labelByProfileId.get(entry.profileId);
      if (!labels) {
        throw new Error(
          `Missing shared mention labels for profile ${entry.profileId}.`
        );
      }
      return buildMemberDirectoryEntry({
        entry,
        labels,
        lookupTokenCounts,
      });
    })
    .sort(compareMemberDirectoryEntries);

  return {
    spaceId: identityDirectory.spaceId,
    generatedAt: identityDirectory.generatedAt,
    members,
  };
}

function buildMemberDirectoryEntry(input: {
  entry: SpaceIdentityDirectoryEntry;
  labels: {
    exactMentionLabels: readonly string[];
    labelSource: SpaceMemberDirectoryEntry["labelSource"];
    primaryMentionLabel: string;
  };
  lookupTokenCounts: ReadonlyMap<string, number>;
}): SpaceMemberDirectoryEntry {
  return {
    profileId: input.entry.profileId,
    profileKind: input.entry.profileKind,
    displayName: input.entry.profileName,
    primaryMentionLabel: input.labels.primaryMentionLabel,
    mentionLabels: [...input.labels.exactMentionLabels],
    mentionAlias: input.entry.mentionAlias,
    labelSource: input.labels.labelSource,
    lookupTokens: buildLookupTokens({
      exactMentionLabels: input.labels.exactMentionLabels,
      mentionAlias: input.entry.mentionAlias,
      profileId: input.entry.profileId,
      profileName: input.entry.profileName,
    }),
    preferredLookupToken: resolvePreferredLookupToken({
      exactMentionLabels: input.labels.exactMentionLabels,
      lookupTokenCounts: input.lookupTokenCounts,
      profileId: input.entry.profileId,
      profileName: input.entry.profileName,
    }),
    profileIdShort: buildProfileIdShort(input.entry.profileId),
    allowedRelations: getSpaceMessageAddressingRelationSupportForTargetKind(
      input.entry.profileKind === "agent" ? "agent_profile" : "human_profile"
    ),
    ownerUserId: input.entry.ownerUserId,
    ownerName: input.entry.ownerName,
    agentCard: null,
    spaceRole: null,
  };
}

function compareMemberDirectoryEntries(
  left: SpaceMemberDirectoryEntry,
  right: SpaceMemberDirectoryEntry
): number {
  const labelComparison = left.primaryMentionLabel.localeCompare(
    right.primaryMentionLabel,
    "en",
    { sensitivity: "base" }
  );
  if (labelComparison !== 0) {
    return labelComparison;
  }
  return left.profileId.localeCompare(right.profileId);
}

function buildLookupTokens(input: {
  exactMentionLabels: readonly string[];
  mentionAlias: string | null;
  profileId: string;
  profileName: string;
}): string[] {
  const tokens = new Set<string>();

  addLookupToken(tokens, input.profileId);
  addLookupToken(tokens, input.profileName);
  addLookupToken(tokens, input.mentionAlias);
  for (const exactMentionLabel of input.exactMentionLabels) {
    addLookupToken(tokens, exactMentionLabel);
  }

  return [...tokens];
}

function buildLookupTokenCounts(
  entries: readonly SpaceIdentityDirectoryEntry[],
  input: {
    labelByProfileId: ReadonlyMap<
      string,
      {
        exactMentionLabels: readonly string[];
        primaryMentionLabel: string;
      }
    >;
  }
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    const mentionLabels = input.labelByProfileId.get(entry.profileId);
    if (!mentionLabels) {
      continue;
    }

    const uniqueLookupTokens = new Set<string>();
    addLookupToken(uniqueLookupTokens, entry.profileId);
    addLookupToken(uniqueLookupTokens, entry.profileName);
    addLookupToken(uniqueLookupTokens, entry.mentionAlias);
    addLookupToken(uniqueLookupTokens, mentionLabels.primaryMentionLabel);
    for (const exactMentionLabel of mentionLabels.exactMentionLabels) {
      addLookupToken(uniqueLookupTokens, exactMentionLabel);
    }

    for (const lookupToken of uniqueLookupTokens) {
      counts.set(lookupToken, (counts.get(lookupToken) ?? 0) + 1);
    }
  }

  return counts;
}

function resolvePreferredLookupToken(input: {
  exactMentionLabels: readonly string[];
  lookupTokenCounts: ReadonlyMap<string, number>;
  profileId: string;
  profileName: string;
}): string {
  for (const candidate of [input.exactMentionLabels[0], input.profileName]) {
    const normalizedCandidate = normalizeLookupToken(candidate);
    if (
      normalizedCandidate &&
      input.lookupTokenCounts.get(normalizedCandidate) === 1
    ) {
      return normalizedCandidate;
    }
  }

  return input.profileId;
}

function addLookupToken(tokens: Set<string>, value: string | null | undefined) {
  const normalizedToken = normalizeLookupToken(value);
  if (normalizedToken) {
    tokens.add(normalizedToken);
  }
}

function normalizeLookupToken(value: string | null | undefined): string | null {
  return normalizeReadableMentionLookupToken(value);
}

function buildProfileIdShort(profileId: string): string {
  if (profileId.startsWith("agt_")) {
    return `agt_${profileId.slice("agt_".length, "agt_".length + 5)}`;
  }

  return profileId.slice(0, 5);
}
