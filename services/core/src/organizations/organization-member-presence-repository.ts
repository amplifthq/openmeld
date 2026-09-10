import {
  HUMAN_PRESENCE_IDLE_MS,
  HUMAN_PRESENCE_LEASE_MS,
} from "@openmeld/schemas";
import type { OrganizationMemberPresenceBody } from "@openmeld/schemas/types";

// Expired rows retain ordering for delayed requests; they are not activity history.
const SESSION_RETENTION_MS = 24 * 60 * 60_000;

export async function recordOrganizationMemberPresence(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
  humanProfileId: string;
  nowMs: number;
  report: OrganizationMemberPresenceBody;
}): Promise<void> {
  const { db, organizationId, userId, humanProfileId, nowMs, report } = input;
  const interactionAt = report.foreground && report.interaction ? nowMs : 0;
  const expiresAt = report.foreground ? nowMs + HUMAN_PRESENCE_LEASE_MS : nowMs;
  await db.batch([
    db
      .prepare(`DELETE FROM organization_member_presence_sessions
      WHERE organization_id = ? AND user_id = ? AND updated_at_ms < ?`)
      .bind(organizationId, userId, nowMs - SESSION_RETENTION_MS),
    db
      .prepare(`INSERT INTO organization_member_presence_sessions
      (organization_id, user_id, session_id, human_profile_id, sequence,
       last_interaction_at_ms, expires_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, user_id, session_id) DO UPDATE SET
        sequence = excluded.sequence,
        last_interaction_at_ms = CASE WHEN excluded.last_interaction_at_ms > 0
          THEN excluded.last_interaction_at_ms ELSE organization_member_presence_sessions.last_interaction_at_ms END,
        expires_at_ms = excluded.expires_at_ms,
        updated_at_ms = excluded.updated_at_ms
      WHERE excluded.sequence > organization_member_presence_sessions.sequence
        AND excluded.human_profile_id = organization_member_presence_sessions.human_profile_id`)
      .bind(
        organizationId,
        userId,
        report.sessionId,
        humanProfileId,
        report.sequence,
        interactionAt,
        expiresAt,
        nowMs
      ),
  ]);
}

export async function listOnlineOrganizationMembers(input: {
  db: D1Database;
  organizationId: string;
  nowMs: number;
}): Promise<Array<{ user_id: string; human_profile_id: string }>> {
  const result = await input.db
    .prepare(`SELECT DISTINCT user_id, human_profile_id
    FROM organization_member_presence_sessions
    WHERE organization_id = ? AND expires_at_ms > ? AND last_interaction_at_ms > ?`)
    .bind(
      input.organizationId,
      input.nowMs,
      input.nowMs - HUMAN_PRESENCE_IDLE_MS
    )
    .all<{ user_id: string; human_profile_id: string }>();
  return result.results;
}
