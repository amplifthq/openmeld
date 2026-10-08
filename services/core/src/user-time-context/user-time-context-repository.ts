import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  resolveUserTimeContext,
  USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS,
  USER_TIME_ZONE_OBSERVATION_REFRESH_MS,
  userTimeZoneObservationSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  UserRequestTimeContext,
  UserTimeContext,
  UserTimeZoneObservation,
} from "@openmeld/schemas/types";

type UserTimeContextRow = {
  time_zone: string;
  source: UserTimeZoneObservation["source"];
  observed_at_ms: number;
};

export async function readUserTimeContext(
  db: PostgresDatabase,
  userId: string
): Promise<UserTimeContext> {
  const result = await db.query<UserTimeContextRow>({
    text: 'SELECT time_zone, source, observed_at_ms FROM "openmeld"."user_time_contexts" WHERE user_id = $1',
    values: [userId],
  });
  const row = result.rows[0];
  return resolveUserTimeContext(
    row
      ? {
          timeZone: row.time_zone,
          source: row.source,
          observedAtMs: row.observed_at_ms,
        }
      : null
  );
}

export async function recordUserTimeZoneObservation(input: {
  db: PostgresDatabase;
  userId: string;
  observation: UserTimeZoneObservation;
  nowMs: number;
}): Promise<void> {
  const parsed = userTimeZoneObservationSchema.safeParse(input.observation);
  if (!parsed.success) {
    return;
  }
  // One atomic writer handles precedence and refresh limits. In-flight older
  // requests cannot overwrite a newer observation from the same priority.
  // Interactive observations can preempt racing Service writes. Same-value
  // calls do not update the row during the daily refresh interval.
  await input.db.query({
    text: `INSERT INTO "openmeld"."user_time_contexts" AS current (user_id, time_zone, source, observed_at_ms)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone,
        source = EXCLUDED.source, observed_at_ms = EXCLUDED.observed_at_ms
      WHERE (EXCLUDED.observed_at_ms >= current.observed_at_ms
          OR (current.source = 'service' AND EXCLUDED.source <> 'service'))
        AND (EXCLUDED.source <> 'service' OR current.source = 'service'
          OR current.observed_at_ms <= $5)
        AND (EXCLUDED.time_zone <> current.time_zone
          OR (current.source = 'service' AND EXCLUDED.source <> 'service')
          OR current.observed_at_ms <= $6)`,
    values: [
      input.userId,
      parsed.data.timeZone,
      parsed.data.source,
      input.nowMs,
      input.nowMs - USER_TIME_ZONE_INTERACTIVE_PRIORITY_MS,
      input.nowMs - USER_TIME_ZONE_OBSERVATION_REFRESH_MS,
    ],
  });
}

export async function resolveUserRequestTimeContext(input: {
  db: PostgresDatabase | null;
  context?: OpenMeldRequestContext | null;
  submittedAtMs: number;
}): Promise<UserRequestTimeContext> {
  const actor = input.context?.actorContext;
  // The authenticated principal owns the row. A claimed client environment
  // cannot select a different user or add authority.
  const userId = actor?.callerPrincipalId?.trim();
  const authenticatedUser = userId && actor?.ownerUserId === userId;
  const observation = authenticatedUser
    ? userTimeZoneObservationSchema.safeParse(
        input.context?.userTimeZoneObservation
      )
    : null;
  if (observation?.success && userId) {
    if (input.db) {
      await recordUserTimeZoneObservation({
        db: input.db,
        userId,
        observation: observation.data,
        nowMs: input.submittedAtMs,
      });
    }
    return {
      submittedAtMs: input.submittedAtMs,
      userTime: { ...observation.data, observedAtMs: input.submittedAtMs },
    };
  }
  return {
    submittedAtMs: input.submittedAtMs,
    userTime:
      input.db && authenticatedUser && userId
        ? await readUserTimeContext(input.db, userId)
        : resolveUserTimeContext(null),
  };
}
