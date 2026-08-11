export type SpaceCursorRecord = {
  v: 1;
  spaceId: string;
  profileId: string;
  lastSeenTs?: number;
  role?: string;
  mentionAlias?: string;
  createdAt: string;
  updatedAt: string;
};

export function normalizeStoredSpaceCursorRecord(input: {
  raw: string;
  profileId: string;
  requestSpaceId: string;
  nowIso?: string;
}): SpaceCursorRecord | null {
  try {
    const parsed = JSON.parse(input.raw) as Partial<SpaceCursorRecord>;
    const hasLastSeenTs = Object.hasOwn(parsed, "lastSeenTs");
    const parsedLastSeenTs = hasLastSeenTs
      ? parseStoredLastSeenTs(parsed.lastSeenTs)
      : undefined;
    if (
      parsed.v !== 1 ||
      parsed.profileId !== input.profileId ||
      parsedLastSeenTs === null
    ) {
      return null;
    }

    const now = input.nowIso ?? new Date().toISOString();
    const role = normalizeStoredCursorString(parsed.role);
    const mentionAlias = normalizeStoredCursorString(parsed.mentionAlias);
    return {
      v: 1,
      // A single DO instance can be addressed by name or hex id aliases.
      // Cursor records are keyed by profile identity under this DO, so always return
      // the current request-facing space id.
      spaceId: input.requestSpaceId,
      profileId: parsed.profileId,
      ...(typeof parsedLastSeenTs === "number"
        ? { lastSeenTs: parsedLastSeenTs }
        : {}),
      ...(role ? { role } : {}),
      ...(mentionAlias ? { mentionAlias } : {}),
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : now,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : now,
    };
  } catch {
    return null;
  }
}

function parseStoredLastSeenTs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeStoredCursorString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
