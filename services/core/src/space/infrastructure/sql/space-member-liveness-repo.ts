export type SpaceMemberProfileLivenessEvidence = {
  profileId: string;
  firstNotFoundAtMs: number;
  lastNotFoundAtMs: number;
  observationCount: number;
};

type SpaceMemberProfileLivenessRow = {
  profile_id: string;
  first_not_found_at_ms: number;
  last_not_found_at_ms: number;
  observation_count: number;
};

// Evidence ledger for "the auth owner authoritatively reported this agent
// member's profile as deleted". Read paths only record observations here;
// membership state changes happen in the Space background alarm after the
// threshold below is met and a fresh re-verification still says not_found.
export function recordMemberProfileNotFoundObservation(
  sql: SqlStorage,
  input: {
    nowMs: number;
    profileId: string;
  }
): void {
  sql.exec(
    `
      INSERT INTO space_member_profile_liveness (
        profile_id,
        first_not_found_at_ms,
        last_not_found_at_ms,
        observation_count
      )
      VALUES (?, ?, ?, 1)
      ON CONFLICT(profile_id) DO UPDATE SET
        last_not_found_at_ms = excluded.last_not_found_at_ms,
        observation_count = observation_count + 1
    `,
    input.profileId,
    input.nowMs,
    input.nowMs
  );
}

export function clearMemberProfileLivenessEvidence(
  sql: SqlStorage,
  profileId: string
): void {
  sql.exec(
    "DELETE FROM space_member_profile_liveness WHERE profile_id = ?",
    profileId
  );
}

export function listDueMemberProfileLivenessEvidence(
  sql: SqlStorage,
  input: {
    minAgeMs: number;
    minObservations: number;
    nowMs: number;
  }
): SpaceMemberProfileLivenessEvidence[] {
  const rows = sql
    .exec<SpaceMemberProfileLivenessRow>(
      `
        SELECT profile_id, first_not_found_at_ms, last_not_found_at_ms, observation_count
        FROM space_member_profile_liveness
        WHERE first_not_found_at_ms <= ?
          AND observation_count >= ?
        ORDER BY first_not_found_at_ms ASC
        LIMIT 25
      `,
      input.nowMs - input.minAgeMs,
      input.minObservations
    )
    .toArray();
  return rows.map((row) => ({
    profileId: row.profile_id,
    firstNotFoundAtMs: row.first_not_found_at_ms,
    lastNotFoundAtMs: row.last_not_found_at_ms,
    observationCount: row.observation_count,
  }));
}

export function readNextMemberProfileLivenessAlarmAtMs(
  sql: SqlStorage,
  input: {
    minAgeMs: number;
  }
): number | null {
  const rows = sql
    .exec<{ first_not_found_at_ms: number | null }>(
      `
        SELECT MIN(first_not_found_at_ms) AS first_not_found_at_ms
        FROM space_member_profile_liveness
      `
    )
    .toArray();
  const earliest = rows[0]?.first_not_found_at_ms;
  if (typeof earliest !== "number") {
    return null;
  }
  return earliest + input.minAgeMs;
}
