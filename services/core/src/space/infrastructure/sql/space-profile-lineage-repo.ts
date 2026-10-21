import type { CachedProfileLineage } from "../../rules/privacy/profile-lineage";

type SpaceProfileLineageRow = {
  owner_user_id: string;
  creator_profile_ids_json: string;
  covered_profile_ids_json: string;
  fetched_at_ms: number;
};

// Space-local copy of Auth's resolved Profile lineage for one owner. Auth owns
// the fact; this row only lets a re-created Space object reuse a recent read.
// Use is bounded by the freshness rule in rules/privacy/profile-lineage.ts.
export function ensureSpaceProfileLineageTable(sql: SqlStorage): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS space_profile_lineage (
      owner_user_id TEXT PRIMARY KEY,
      creator_profile_ids_json TEXT NOT NULL,
      covered_profile_ids_json TEXT NOT NULL,
      fetched_at_ms INTEGER NOT NULL
    )
  `);
}

export function readSpaceProfileLineage(
  sql: SqlStorage,
  ownerUserId: string
): CachedProfileLineage | null {
  const row = sql
    .exec<SpaceProfileLineageRow>(
      `
        SELECT
          owner_user_id,
          creator_profile_ids_json,
          covered_profile_ids_json,
          fetched_at_ms
        FROM space_profile_lineage
        WHERE owner_user_id = ?
        LIMIT 1
      `,
      ownerUserId
    )
    .toArray()[0];
  if (!row) {
    return null;
  }
  const creatorProfileIdByProfileId = parseCreatorProfileIdMap(
    row.creator_profile_ids_json
  );
  const coveredProfileIds = parseProfileIdList(row.covered_profile_ids_json);
  if (!(creatorProfileIdByProfileId && coveredProfileIds)) {
    return null;
  }
  return {
    creatorProfileIdByProfileId,
    coveredProfileIds,
    fetchedAtMs: Number(row.fetched_at_ms),
  };
}

export function writeSpaceProfileLineage(
  sql: SqlStorage,
  ownerUserId: string,
  lineage: CachedProfileLineage
): void {
  sql.exec(
    `
      INSERT INTO space_profile_lineage (
        owner_user_id,
        creator_profile_ids_json,
        covered_profile_ids_json,
        fetched_at_ms
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_user_id) DO UPDATE SET
        creator_profile_ids_json = excluded.creator_profile_ids_json,
        covered_profile_ids_json = excluded.covered_profile_ids_json,
        fetched_at_ms = excluded.fetched_at_ms
      WHERE excluded.fetched_at_ms >= space_profile_lineage.fetched_at_ms
    `,
    ownerUserId,
    JSON.stringify(lineage.creatorProfileIdByProfileId),
    JSON.stringify(lineage.coveredProfileIds),
    lineage.fetchedAtMs
  );
}

function parseCreatorProfileIdMap(
  value: string
): Record<string, string | null> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (
    !entries.every(
      ([profileId, creatorProfileId]) =>
        profileId.length > 0 &&
        (creatorProfileId === null || typeof creatorProfileId === "string")
    )
  ) {
    return null;
  }
  return Object.fromEntries(entries) as Record<string, string | null>;
}

function parseProfileIdList(value: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (
    !(
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string" && item.length > 0)
    )
  ) {
    return null;
  }
  return parsed as string[];
}
