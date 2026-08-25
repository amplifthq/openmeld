import * as z from "zod/v4";
import { trimmedStringFromUnknown } from "../protocol/shared";

const MULTI_SPACE_PATTERN = /\s+/g;
export const SPACE_MENTION_LABEL_MAX_LENGTH = 128;

export const SPACE_MENTION_LABEL_SOURCE_VALUES = [
  "profile_name",
  "mention_alias",
  "profile_name_with_short_id",
  "profile_id",
] as const;

export const spaceMentionLabelSourceSchema = z.enum(
  SPACE_MENTION_LABEL_SOURCE_VALUES
);

export type SpaceMentionLabelSource = z.infer<
  typeof spaceMentionLabelSourceSchema
>;

export type SpaceMentionLabelIdentity = {
  mentionAlias?: string | null;
  profileId: string;
  profileName?: string | null;
};

export type ResolvedSpaceMentionLabels = {
  exactMentionLabels: readonly string[];
  labelSource: SpaceMentionLabelSource;
  primaryMentionLabel: string;
};

type ProjectableSpaceMentionLabelIdentity = {
  mentionAlias: string | null;
  normalizedMentionAlias: string | null;
  normalizedProfileName: string | null;
  profileId: string;
  profileNameWithShortId: string | null;
};

export const spaceMentionLabelSchema = z.preprocess(
  normalizeRawMentionLabelCandidate,
  z
    .string()
    .min(1)
    .max(SPACE_MENTION_LABEL_MAX_LENGTH)
    .refine(
      (value) =>
        !(value.includes("@") || value.includes("(") || value.includes(")")),
      "Space mention labels must not contain @ or parentheses"
    )
);

export function resolveSpaceMentionLabels(
  identities: Iterable<SpaceMentionLabelIdentity>
): ReadonlyMap<string, ResolvedSpaceMentionLabels> {
  const projected = [...identities].map(projectSpaceMentionLabelIdentity);
  const exactLabelCounts = buildExactLabelCounts(projected);

  return new Map(
    projected.map((identity) => {
      const uniqueProfileName = resolveUniqueExactLabel(
        identity.normalizedProfileName,
        exactLabelCounts
      );
      const uniqueMentionAlias = resolveUniqueExactLabel(
        identity.normalizedMentionAlias,
        exactLabelCounts
      );
      const uniqueProfileNameWithShortId = resolveUniqueExactLabel(
        identity.profileNameWithShortId,
        exactLabelCounts
      );
      const primaryLabelState = resolvePrimaryMentionLabel({
        mentionAlias: uniqueMentionAlias,
        profileId: identity.profileId,
        profileName: uniqueProfileName,
        profileNameWithShortId: uniqueProfileNameWithShortId,
      });

      return [
        identity.profileId,
        {
          exactMentionLabels: buildExactMentionLabels({
            mentionAlias: uniqueMentionAlias,
            profileId: identity.profileId,
            profileName: uniqueProfileName,
            profileNameWithShortId: uniqueProfileNameWithShortId,
          }),
          labelSource: primaryLabelState.labelSource,
          primaryMentionLabel: primaryLabelState.primaryMentionLabel,
        },
      ] as const;
    })
  );
}

export function resolveSingleSpaceMentionLabels(
  identity: SpaceMentionLabelIdentity
): ResolvedSpaceMentionLabels {
  const profileId = normalizeRequiredProfileId(identity.profileId);
  const resolved = resolveSpaceMentionLabels([identity]).get(profileId);
  if (!resolved) {
    throw new Error(
      `Missing resolved space mention labels for profile ${profileId}.`
    );
  }
  return resolved;
}

function projectSpaceMentionLabelIdentity(
  identity: SpaceMentionLabelIdentity
): ProjectableSpaceMentionLabelIdentity {
  const profileId = normalizeRequiredProfileId(identity.profileId);
  const normalizedProfileName = normalizeProjectableMentionLabel(
    identity.profileName
  );
  const normalizedMentionAlias = normalizeProjectableMentionLabel(
    identity.mentionAlias
  );
  const profileNameWithShortId = normalizedProfileName
    ? `${normalizedProfileName}-${buildProfileIdShort(profileId)}`
    : null;

  return {
    mentionAlias: normalizeOptionalText(identity.mentionAlias),
    normalizedMentionAlias,
    normalizedProfileName,
    profileId,
    profileNameWithShortId,
  };
}

function normalizeRawMentionLabelCandidate(value: unknown): string | undefined {
  const normalized = trimmedStringFromUnknown(value)
    .replace(MULTI_SPACE_PATTERN, " ")
    .trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

function normalizeProjectableMentionLabel(value: unknown): string | null {
  const parsed = spaceMentionLabelSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function buildExactLabelCounts(
  identities: readonly ProjectableSpaceMentionLabelIdentity[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const identity of identities) {
    addExactLabelCount(counts, identity.profileId);
    addExactLabelCount(counts, identity.normalizedProfileName);
    addExactLabelCount(counts, identity.normalizedMentionAlias);
    addExactLabelCount(counts, identity.profileNameWithShortId);
  }

  return counts;
}

function addExactLabelCount(
  counts: Map<string, number>,
  value: string | null
): void {
  if (!value) {
    return;
  }
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function resolveUniqueExactLabel(
  value: string | null,
  counts: ReadonlyMap<string, number>
): string | null {
  if (!value) {
    return null;
  }
  return counts.get(value) === 1 ? value : null;
}

function resolvePrimaryMentionLabel(input: {
  mentionAlias: string | null;
  profileId: string;
  profileName: string | null;
  profileNameWithShortId: string | null;
}): {
  labelSource: SpaceMentionLabelSource;
  primaryMentionLabel: string;
} {
  if (input.profileName) {
    return {
      labelSource: "profile_name",
      primaryMentionLabel: input.profileName,
    };
  }

  if (input.mentionAlias) {
    return {
      labelSource: "mention_alias",
      primaryMentionLabel: input.mentionAlias,
    };
  }

  if (input.profileNameWithShortId) {
    return {
      labelSource: "profile_name_with_short_id",
      primaryMentionLabel: input.profileNameWithShortId,
    };
  }

  return {
    labelSource: "profile_id",
    primaryMentionLabel: input.profileId,
  };
}

function buildExactMentionLabels(input: {
  mentionAlias: string | null;
  profileId: string;
  profileName: string | null;
  profileNameWithShortId: string | null;
}): readonly string[] {
  const orderedCandidates = [
    input.profileName,
    input.mentionAlias,
    input.profileNameWithShortId,
    input.profileId,
  ];
  const seen = new Set<string>();
  const exactMentionLabels: string[] = [];

  for (const candidate of orderedCandidates) {
    if (!(candidate && !seen.has(candidate))) {
      continue;
    }
    seen.add(candidate);
    exactMentionLabels.push(candidate);
  }

  return exactMentionLabels;
}

function buildProfileIdShort(profileId: string): string {
  if (profileId.startsWith("agt_")) {
    return `agt_${profileId.slice("agt_".length, "agt_".length + 5)}`;
  }

  return profileId.slice(0, 5);
}

function normalizeRequiredProfileId(profileId: string): string {
  const normalized = String(profileId ?? "").trim();
  if (normalized.length === 0) {
    throw new Error("Space mention labels require a non-empty profileId.");
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = trimmedStringFromUnknown(value);
  return normalized.length > 0 ? normalized : null;
}
