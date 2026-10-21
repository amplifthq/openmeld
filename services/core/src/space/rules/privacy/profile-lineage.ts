import type { CoreBindings } from "../../../lib/bindings";

export type CreatorProfileIdsByProfileId = Record<string, string | null>;

export async function loadCreatorProfileIdsByOwnerUserId(input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  ownerUserId?: string;
  onError?: (error: unknown, ownerUserId: string) => void;
}): Promise<CreatorProfileIdsByProfileId | undefined> {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) {
    return undefined;
  }

  const authRpc = input.authRpc;
  if (!authRpc?.listProfileLineage) {
    return undefined;
  }

  try {
    const result = await authRpc.listProfileLineage({
      ownerUserId,
    });
    if (!result.ok) {
      return undefined;
    }

    return Object.fromEntries(
      result.profiles.map((profile) => [
        profile.profileId,
        normalizeOptionalText(profile.creatorProfileId),
      ])
    ) as CreatorProfileIdsByProfileId;
  } catch (error) {
    input.onError?.(error, ownerUserId);
    return undefined;
  }
}

// Lineage decides whether a same-owner viewer may see an Agent's local origin
// facts and which Profiles outrank a Wake's target, so a cached copy must not
// keep granting access long after Auth changed it (for example, after an
// intermediate Agent Profile was deleted). A copy is usable only while it is
// younger than the maximum age and covers every Profile the Space currently
// needs; past the refresh age it is still served while one background reload
// replaces it, so warm Spaces do not wait on Auth at the boundary.
export const PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS = 8 * 60 * 1000;
export const PROFILE_LINEAGE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

export type CachedProfileLineage = {
  creatorProfileIdByProfileId: CreatorProfileIdsByProfileId;
  // Profiles the read was expected to cover, including ones Auth no longer
  // lists. Absent entries stay absent (fail closed) without forcing reloads.
  coveredProfileIds: readonly string[];
  fetchedAtMs: number;
};

export type CachedProfileLineageUse = "fresh" | "refresh" | "reload";

export function classifyCachedProfileLineage(input: {
  cached: CachedProfileLineage | null;
  nowMs: number;
  requiredProfileIds: Iterable<string>;
}): CachedProfileLineageUse {
  const cached = input.cached;
  if (!cached) {
    return "reload";
  }
  const ageMs = input.nowMs - cached.fetchedAtMs;
  if (
    !Number.isFinite(ageMs) ||
    ageMs < 0 ||
    ageMs >= PROFILE_LINEAGE_CACHE_MAX_AGE_MS
  ) {
    return "reload";
  }
  const covered = new Set(cached.coveredProfileIds);
  for (const profileId of input.requiredProfileIds) {
    if (
      !(
        covered.has(profileId) ||
        Object.hasOwn(cached.creatorProfileIdByProfileId, profileId)
      )
    ) {
      return "reload";
    }
  }
  return ageMs >= PROFILE_LINEAGE_CACHE_REFRESH_AGE_MS ? "refresh" : "fresh";
}

export async function resolveViewerCreatorProfileIdsByProfileId(input: {
  authRpc?: CoreBindings["OPENMELD_AUTH_WORKER"];
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  onError?: (error: unknown, ownerUserId: string) => void;
}): Promise<CreatorProfileIdsByProfileId | undefined> {
  const viewerOwnerUserId = normalizeOptionalText(input.viewerOwnerUserId);
  const viewerProfileId = normalizeOptionalText(input.viewerProfileId);
  if (!(viewerOwnerUserId && viewerProfileId)) {
    return undefined;
  }

  return await loadCreatorProfileIdsByOwnerUserId({
    authRpc: input.authRpc,
    ownerUserId: viewerOwnerUserId,
    onError: input.onError,
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
