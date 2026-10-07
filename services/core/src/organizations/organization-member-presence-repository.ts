import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  HUMAN_PRESENCE_IDLE_MS,
  HUMAN_PRESENCE_LEASE_MS,
} from "@openmeld/schemas";
import type { OrganizationMemberPresenceBody } from "@openmeld/schemas/types";

// Expired rows retain ordering for delayed requests; they are not activity history.
const SESSION_RETENTION_MS = 24 * 60 * 60_000;
export async function recordOrganizationMemberPresence(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
  humanProfileId: string;
  nowMs: number;
  report: OrganizationMemberPresenceBody;
}): Promise<void> {
  const { db, organizationId, userId, humanProfileId, nowMs, report } = input;
  const interactionAt = report.foreground && report.interaction ? nowMs : 0;
  const expiresAt = report.foreground ? nowMs + HUMAN_PRESENCE_LEASE_MS : nowMs;
  await db.transaction(
    async (client) =>
      [
        await client.query({
          text: `DELETE FROM "openmeld"."organization_member_presence_sessions"
      WHERE organization_id = $1 AND user_id = $2 AND updated_at_ms < $3`,
          values: [organizationId, userId, nowMs - SESSION_RETENTION_MS],
        }),
        await client.query({
          text: `INSERT INTO "openmeld"."organization_member_presence_sessions"
      (organization_id, user_id, session_id, human_profile_id, sequence,
       last_interaction_at_ms, expires_at_ms, updated_at_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT(organization_id, user_id, session_id) DO UPDATE SET
        sequence = excluded.sequence,
        last_interaction_at_ms = CASE WHEN excluded.last_interaction_at_ms > 0
          THEN excluded.last_interaction_at_ms ELSE organization_member_presence_sessions.last_interaction_at_ms END,
        expires_at_ms = excluded.expires_at_ms,
        updated_at_ms = excluded.updated_at_ms
      WHERE excluded.sequence > organization_member_presence_sessions.sequence
        AND excluded.human_profile_id = organization_member_presence_sessions.human_profile_id`,
          values: [
            organizationId,
            userId,
            report.sessionId,
            humanProfileId,
            report.sequence,
            interactionAt,
            expiresAt,
            nowMs,
          ],
        }),
      ] as const
  );
}
export async function listOnlineOrganizationMembers(input: {
  db: PostgresDatabase;
  organizationId: string;
  nowMs: number;
}): Promise<
  Array<{
    user_id: string;
    human_profile_id: string;
  }>
> {
  const result = await input.db.query<{
    user_id: string;
    human_profile_id: string;
  }>({
    text: `SELECT DISTINCT user_id, human_profile_id
    FROM "openmeld"."organization_member_presence_sessions"
    WHERE organization_id = $1 AND expires_at_ms > $2 AND last_interaction_at_ms > $3`,
    values: [
      input.organizationId,
      input.nowMs,
      input.nowMs - HUMAN_PRESENCE_IDLE_MS,
    ],
  });
  return result.rows;
}
