const LEADING_MENTION_MARKERS = /^@+/;

// Legacy snapshots used the Profile ID as a missing-name placeholder. It is
// identity, not a name, including mention labels derived from that placeholder.
export function normalizeSpaceMemberNameSnapshot(
  profileId: string,
  value: string | null | undefined
): string | null {
  const name = value?.trim();
  const label = name?.replace(LEADING_MENTION_MARKERS, "").toLowerCase();
  const id = profileId.trim().toLowerCase();
  return name && label !== id && !label?.startsWith(`${id}-`) ? name : null;
}
