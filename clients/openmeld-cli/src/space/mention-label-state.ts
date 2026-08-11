import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  createSpaceTargetCatalog,
  type SpaceTargetCatalog,
} from "@openmeld/space";

export type SpaceMentionLabelState = {
  exactMentionLabels: readonly string[];
  primaryMentionLabel: string;
};

const targetCatalogBySnapshot = new WeakMap<
  SpaceMembersSnapshot,
  SpaceTargetCatalog
>();
const mentionLabelStateBySnapshot = new WeakMap<
  SpaceMembersSnapshot,
  ReadonlyMap<string, SpaceMentionLabelState>
>();

export function resolvePrimarySpaceMentionLabel(input: {
  profileId: string | null | undefined;
  snapshot: SpaceMembersSnapshot | null | undefined;
}): string | null {
  return resolveSpaceMentionLabelState(input)?.primaryMentionLabel ?? null;
}

export function resolveSpaceMentionLabelState(input: {
  profileId: string | null | undefined;
  snapshot: SpaceMembersSnapshot | null | undefined;
}): SpaceMentionLabelState | null {
  const profileId =
    typeof input.profileId === "string" ? input.profileId.trim() : "";
  if (!(profileId && input.snapshot)) {
    return null;
  }

  return (
    resolveSpaceMentionLabelStateByProfileId(input.snapshot).get(profileId) ??
    null
  );
}

export function buildSpacePrimaryMentionLabelByProfileId(
  snapshot: SpaceMembersSnapshot
): ReadonlyMap<string, string> {
  return new Map(
    [...resolveSpaceMentionLabelStateByProfileId(snapshot)].map(
      ([profileId, labelState]) => [profileId, labelState.primaryMentionLabel]
    )
  );
}

function resolveSpaceMentionLabelStateByProfileId(
  snapshot: SpaceMembersSnapshot
): ReadonlyMap<string, SpaceMentionLabelState> {
  const cachedState = mentionLabelStateBySnapshot.get(snapshot);
  if (cachedState) {
    return cachedState;
  }

  const labelStateByProfileId = new Map<string, SpaceMentionLabelState>();
  for (const [profileId, entry] of resolveSpaceTargetCatalog(snapshot)
    .byProfileId) {
    labelStateByProfileId.set(profileId, {
      exactMentionLabels: entry.exactMentionLabels,
      primaryMentionLabel: entry.primaryMentionLabel,
    });
  }

  mentionLabelStateBySnapshot.set(snapshot, labelStateByProfileId);
  return labelStateByProfileId;
}

function resolveSpaceTargetCatalog(
  snapshot: SpaceMembersSnapshot
): SpaceTargetCatalog {
  const cachedCatalog = targetCatalogBySnapshot.get(snapshot);
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const targetCatalog = createSpaceTargetCatalog(snapshot);
  targetCatalogBySnapshot.set(snapshot, targetCatalog);
  return targetCatalog;
}
