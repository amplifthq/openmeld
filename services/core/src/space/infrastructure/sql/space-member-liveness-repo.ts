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

export const MEMBER_PROFILE_LIVENESS_MIN_OBSERVATIONS = 2;

const ELIGIBLE_MEMBER_LIVENESS_EVIDENCE = `
  FROM space_member_profile_liveness
  JOIN space_members USING (profile_id)
  WHERE space_members.status = 'active'
    AND space_members.profile_kind_snapshot = 'agent'
    AND observation_count >= ?
`;

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
): number {
  const rows = sql
    .exec<{ observation_count: number }>(
      `
      INSERT INTO space_member_profile_liveness (
        profile_id,
        first_not_found_at_ms,
        last_not_found_at_ms,
        observation_count
      )
      SELECT profile_id, ?2, ?2, 1 FROM space_members
      WHERE profile_id = ?1 AND status = 'active' AND profile_kind_snapshot = 'agent'
      ON CONFLICT(profile_id) DO UPDATE SET
        last_not_found_at_ms = excluded.last_not_found_at_ms,
        observation_count = observation_count + 1
      RETURNING observation_count
    `,
      input.profileId,
      input.nowMs
    )
    .toArray();
  return rows[0]?.observation_count ?? 0;
}

export function recordConfirmedMemberProfileDeletionObservation(
  sql: SqlStorage,
  input: {
    minAgeMs: number;
    minObservations: number;
    nowMs: number;
    profileId: string;
  }
): void {
  const firstNotFoundAtMs = Math.max(0, input.nowMs - input.minAgeMs);
  sql.exec(
    `
      INSERT INTO space_member_profile_liveness (
        profile_id,
        first_not_found_at_ms,
        last_not_found_at_ms,
        observation_count
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        first_not_found_at_ms = MIN(
          first_not_found_at_ms,
          excluded.first_not_found_at_ms
        ),
        last_not_found_at_ms = excluded.last_not_found_at_ms,
        observation_count = MAX(
          observation_count,
          excluded.observation_count
        )
    `,
    input.profileId,
    firstNotFoundAtMs,
    input.nowMs,
    input.minObservations
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
        ${ELIGIBLE_MEMBER_LIVENESS_EVIDENCE}
          AND first_not_found_at_ms <= ?
        ORDER BY first_not_found_at_ms ASC
        LIMIT 25
      `,
      input.minObservations,
      input.nowMs - input.minAgeMs
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
    minObservations: number;
  }
): number | null {
  const rows = sql
    .exec<{ first_not_found_at_ms: number | null }>(
      `
        SELECT MIN(first_not_found_at_ms) AS first_not_found_at_ms
        ${ELIGIBLE_MEMBER_LIVENESS_EVIDENCE}
      `,
      input.minObservations
    )
    .toArray();
  const earliest = rows[0]?.first_not_found_at_ms;
  if (typeof earliest !== "number") {
    return null;
  }
  return earliest + input.minAgeMs;
}
