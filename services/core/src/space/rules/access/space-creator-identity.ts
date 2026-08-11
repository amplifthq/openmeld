export function normalizeSpaceCreatorProfileId(
  creator:
    | {
        profileId?: unknown;
        profile?: unknown;
      }
    | null
    | undefined
): string | null {
  if (!creator || typeof creator !== "object") {
    return null;
  }

  if (typeof creator.profileId === "string") {
    const normalized = creator.profileId.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  if (typeof creator.profile === "string") {
    const normalized = creator.profile.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return null;
}

export function normalizeSpaceCreatorOwnerUserId(
  creator:
    | {
        ownerUserId?: unknown;
      }
    | null
    | undefined
): string | null {
  if (!creator || typeof creator !== "object") {
    return null;
  }

  if (typeof creator.ownerUserId !== "string") {
    return null;
  }
  const normalized = creator.ownerUserId.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeOwnerUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
