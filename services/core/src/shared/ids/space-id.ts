const SPACE_ID_HEX_REGEX = /^[0-9a-f]{64}$/i;

export function isHexSpaceId(spaceId: string): boolean {
  return SPACE_ID_HEX_REGEX.test(spaceId);
}

export function normalizeHexSpaceId(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    return null;
  }
  return isHexSpaceId(normalized) ? normalized : null;
}
