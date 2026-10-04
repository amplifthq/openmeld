import type { PostgresDatabase } from "@openmeld/db/postgresql";
export type SlackTeammateInvitationDeliveryClaim = {
  actorSlackUserId: string;
  actorUserId: string;
  interactionId: string;
  organizationId: string;
  slackTeamId: string;
  targetDisplayName: string;
  targetEmail: string | null;
  targetSlackUserId: string;
};
export type SlackInvitedMemberOnboarding = {
  interactionId: string;
  joinedProfileId: string;
  joinedUserId: string;
  organizationId: string;
  researchTaskId: string | null;
  slackTeamId: string;
  targetDisplayName: string;
  targetSlackUserId: string;
};
export type PendingSlackTeammateInvitationDelivery =
  SlackTeammateInvitationDeliveryClaim & {
    updatedAtMs: number;
  };
export async function listPendingSlackTeammateInvitationDeliveries(input: {
  beforeOrAtMs: number;
  db: PostgresDatabase;
  limit?: number;
}): Promise<PendingSlackTeammateInvitationDelivery[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 16, 64));
  const result = await input.db.query<{
    actor_slack_user_id: string;
    actor_user_id: string;
    interaction_id: string;
    organization_id: string;
    slack_team_id: string;
    target_display_name: string;
    target_email: string | null;
    target_slack_user_id: string;
    updated_at_ms: number;
  }>({
    text: `
        SELECT
          actor_slack_user_id,
          actor_user_id,
          interaction_id,
          organization_id,
          slack_team_id,
          target_display_name,
          target_email,
          target_slack_user_id,
          updated_at_ms
        FROM "openmeld"."slack_teammate_invitation_deliveries"
        WHERE status = 'pending' AND updated_at_ms <= $1
        ORDER BY updated_at_ms ASC NULLS FIRST, interaction_id ASC NULLS FIRST, target_slack_user_id ASC NULLS FIRST
        LIMIT $2
      `,
    values: [input.beforeOrAtMs, limit],
  });
  return result.rows.map((row) => ({
    actorSlackUserId: row.actor_slack_user_id,
    actorUserId: row.actor_user_id,
    interactionId: row.interaction_id,
    organizationId: row.organization_id,
    slackTeamId: row.slack_team_id,
    targetDisplayName: row.target_display_name,
    targetEmail: row.target_email,
    targetSlackUserId: row.target_slack_user_id,
    updatedAtMs: row.updated_at_ms,
  }));
}
export async function claimSlackTeammateInvitationDelivery(input: {
  actorSlackUserId: string;
  actorUserId: string;
  db: PostgresDatabase;
  interactionId: string;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
  targetDisplayName: string;
  targetEmail: string | null;
  targetSlackUserId: string;
}): Promise<SlackTeammateInvitationDeliveryClaim | null> {
  const result = await input.db.query({
    text: `
        INSERT INTO "openmeld"."slack_teammate_invitation_deliveries" (
          interaction_id,
          slack_team_id,
          organization_id,
          actor_slack_user_id,
          actor_user_id,
          target_slack_user_id,
          target_email,
          target_display_name,
          status,
          message_ts,
          failure_code,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NULL, NULL, $9, $10)
        ON CONFLICT DO NOTHING
      `,
    values: [
      input.interactionId,
      input.slackTeamId,
      input.organizationId,
      input.actorSlackUserId,
      input.actorUserId,
      input.targetSlackUserId,
      input.targetEmail,
      input.targetDisplayName,
      input.nowMs,
      input.nowMs,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    return null;
  }
  return {
    actorSlackUserId: input.actorSlackUserId,
    actorUserId: input.actorUserId,
    interactionId: input.interactionId,
    organizationId: input.organizationId,
    slackTeamId: input.slackTeamId,
    targetDisplayName: input.targetDisplayName,
    targetEmail: input.targetEmail,
    targetSlackUserId: input.targetSlackUserId,
  };
}
export async function completeSlackTeammateInvitationDelivery(input: {
  claim: SlackTeammateInvitationDeliveryClaim;
  db: PostgresDatabase;
  failureCode: string | null;
  messageTs: string | null;
  nowMs: number;
  status: "delivered" | "failed" | "outcome_unknown";
}): Promise<void> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."slack_teammate_invitation_deliveries"
        SET status = $1, message_ts = $2, failure_code = $3, updated_at_ms = $4
          ${input.status === "delivered" ? ", onboarding_status = 'waiting_for_join'" : ""}
        WHERE interaction_id = $5
          AND target_slack_user_id = $6
          AND status = 'pending'
      `,
    values: [
      input.status,
      input.messageTs,
      input.failureCode,
      input.nowMs,
      input.claim.interactionId,
      input.claim.targetSlackUserId,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    throw new Error(
      "Slack teammate invitation delivery claim is no longer pending."
    );
  }
}
export async function claimJoinedSlackInvitedMembers(input: {
  candidates: ReadonlyArray<{
    interactionId: string;
    joinedProfileId: string;
    joinedUserId: string;
    targetSlackUserId: string;
  }>;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<SlackInvitedMemberOnboarding[]> {
  const claimed: SlackInvitedMemberOnboarding[] = [];
  for (const candidate of input.candidates) {
    const onboardingClaim = {
      text: `
          UPDATE "openmeld"."slack_teammate_invitation_deliveries"
          SET
            onboarding_status = 'starting',
            joined_user_id = $1,
            joined_profile_id = $2,
            updated_at_ms = $3
          WHERE interaction_id = $4
            AND target_slack_user_id = $5
            AND status = 'delivered'
            AND onboarding_status = 'waiting_for_join'
            AND EXISTS (
              SELECT 1
              FROM "openmeld"."slack_user_identity_links" AS identity_link
              WHERE identity_link.organization_id = slack_teammate_invitation_deliveries.organization_id
                AND identity_link.slack_team_id = slack_teammate_invitation_deliveries.slack_team_id
                AND identity_link.slack_user_id = slack_teammate_invitation_deliveries.target_slack_user_id
                AND identity_link.openmeld_user_id = $6
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "openmeld"."slack_teammate_invitation_deliveries" AS existing
              WHERE existing.organization_id = slack_teammate_invitation_deliveries.organization_id
                AND existing.slack_team_id = slack_teammate_invitation_deliveries.slack_team_id
                AND existing.target_slack_user_id = slack_teammate_invitation_deliveries.target_slack_user_id
                AND existing.status = 'delivered'
                AND existing.onboarding_status IN ('starting', 'researching', 'completed')
                AND (
                  existing.interaction_id <> slack_teammate_invitation_deliveries.interaction_id
                  OR existing.target_slack_user_id <> slack_teammate_invitation_deliveries.target_slack_user_id
                )
            )
        `,
      values: [
        candidate.joinedUserId,
        candidate.joinedProfileId,
        input.nowMs,
        candidate.interactionId,
        candidate.targetSlackUserId,
        candidate.joinedUserId,
      ],
    };
    const claimResult = await input.db.query(onboardingClaim);
    if (Number(claimResult.rowCount ?? 0) === 1) {
      const row = await input.db
        .query<SlackInvitedMemberOnboardingRow>({
          text: `
            SELECT *
            FROM "openmeld"."slack_teammate_invitation_deliveries"
            WHERE interaction_id = $1
              AND target_slack_user_id = $2
              AND onboarding_status = 'starting'
              AND joined_user_id = $3
            LIMIT 1
          `,
          values: [
            candidate.interactionId,
            candidate.targetSlackUserId,
            candidate.joinedUserId,
          ],
        })
        .then((result) => result.rows[0] ?? null);
      if (!row) {
        throw new Error(
          "Slack invited-member onboarding claim lost its identity-bound row."
        );
      }
      claimed.push(mapSlackInvitedMemberOnboarding(row));
      continue;
    }
    const existingIdentity = await input.db
      .query<{
        openmeld_user_id: string;
      }>({
        text: `
          SELECT openmeld_user_id
          FROM "openmeld"."slack_user_identity_links"
          WHERE slack_user_id = $1
            AND slack_team_id = (
              SELECT slack_team_id
              FROM "openmeld"."slack_teammate_invitation_deliveries"
              WHERE interaction_id = $2
                AND target_slack_user_id = $3
              LIMIT 1
            )
          LIMIT 1
        `,
        values: [
          candidate.targetSlackUserId,
          candidate.interactionId,
          candidate.targetSlackUserId,
        ],
      })
      .then((result) => result.rows[0] ?? null);
    if (
      existingIdentity &&
      existingIdentity.openmeld_user_id !== candidate.joinedUserId
    ) {
      await markSlackInvitedMemberIdentityMismatch({
        ...candidate,
        db: input.db,
        nowMs: input.nowMs,
      });
      continue;
    }
    await markDuplicateSlackInvitedMemberOnboarding({
      ...candidate,
      db: input.db,
      nowMs: input.nowMs,
    });
  }
  return claimed;
}
async function markSlackInvitedMemberIdentityMismatch(input: {
  db: PostgresDatabase;
  interactionId: string;
  joinedUserId: string;
  nowMs: number;
  targetSlackUserId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_teammate_invitation_deliveries"
        SET
          onboarding_status = 'failed',
          onboarding_failure_code = 'identity_link_mismatch',
          updated_at_ms = $1
        WHERE interaction_id = $2
          AND target_slack_user_id = $3
          AND status = 'delivered'
          AND onboarding_status = 'waiting_for_join'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."slack_user_identity_links" AS identity_link
            WHERE identity_link.slack_team_id = slack_teammate_invitation_deliveries.slack_team_id
              AND identity_link.slack_user_id = slack_teammate_invitation_deliveries.target_slack_user_id
              AND identity_link.openmeld_user_id <> $4
          )
      `,
    values: [
      input.nowMs,
      input.interactionId,
      input.targetSlackUserId,
      input.joinedUserId,
    ],
  });
}
async function markDuplicateSlackInvitedMemberOnboarding(input: {
  db: PostgresDatabase;
  interactionId: string;
  joinedProfileId: string;
  joinedUserId: string;
  nowMs: number;
  targetSlackUserId: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_teammate_invitation_deliveries"
        SET
          onboarding_status = 'failed',
          joined_user_id = $1,
          joined_profile_id = $2,
          onboarding_failure_code = 'duplicate_invitation',
          updated_at_ms = $3
        WHERE interaction_id = $4
          AND target_slack_user_id = $5
          AND status = 'delivered'
          AND onboarding_status = 'waiting_for_join'
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."slack_teammate_invitation_deliveries" AS existing
            WHERE existing.organization_id = slack_teammate_invitation_deliveries.organization_id
              AND existing.slack_team_id = slack_teammate_invitation_deliveries.slack_team_id
              AND existing.target_slack_user_id = slack_teammate_invitation_deliveries.target_slack_user_id
              AND existing.status = 'delivered'
              AND existing.onboarding_status IN ('starting', 'researching', 'completed')
              AND (
                existing.interaction_id <> slack_teammate_invitation_deliveries.interaction_id
                OR existing.target_slack_user_id <> slack_teammate_invitation_deliveries.target_slack_user_id
              )
          )
      `,
    values: [
      input.joinedUserId,
      input.joinedProfileId,
      input.nowMs,
      input.interactionId,
      input.targetSlackUserId,
    ],
  });
}
export async function listActiveSlackInvitedMemberOnboardings(input: {
  db: PostgresDatabase;
  limit?: number;
}): Promise<SlackInvitedMemberOnboarding[]> {
  const result = await input.db.query<SlackInvitedMemberOnboardingRow>({
    text: `
        SELECT *
        FROM "openmeld"."slack_teammate_invitation_deliveries"
        WHERE status = 'delivered'
          AND onboarding_status IN ('starting', 'researching')
        ORDER BY updated_at_ms ASC NULLS FIRST
        LIMIT $1
      `,
    values: [input.limit ?? 10],
  });
  return result.rows.map(mapSlackInvitedMemberOnboarding);
}
export async function attachSlackInvitedMemberResearchTask(input: {
  db: PostgresDatabase;
  interactionId: string;
  nowMs: number;
  researchTaskId: string;
  targetSlackUserId: string;
}): Promise<void> {
  await requireOnboardingUpdate(
    input.db,
    `
      UPDATE "openmeld"."slack_teammate_invitation_deliveries"
      SET onboarding_status = 'researching', research_task_id = $1, updated_at_ms = $2
      WHERE interaction_id = $3
        AND target_slack_user_id = $4
        AND onboarding_status = 'starting'
    `,
    [
      input.researchTaskId,
      input.nowMs,
      input.interactionId,
      input.targetSlackUserId,
    ]
  );
}
export async function completeSlackInvitedMemberOnboarding(input: {
  db: PostgresDatabase;
  interactionId: string;
  messageTs: string;
  nowMs: number;
  researchTaskId: string;
  targetSlackUserId: string;
}): Promise<void> {
  await requireOnboardingUpdate(
    input.db,
    `
      UPDATE "openmeld"."slack_teammate_invitation_deliveries"
      SET onboarding_status = 'completed', welcome_message_ts = $1, updated_at_ms = $2
      WHERE interaction_id = $3
        AND target_slack_user_id = $4
        AND onboarding_status = 'researching'
        AND research_task_id = $5
    `,
    [
      input.messageTs,
      input.nowMs,
      input.interactionId,
      input.targetSlackUserId,
      input.researchTaskId,
    ]
  );
}
export async function failSlackInvitedMemberOnboarding(input: {
  db: PostgresDatabase;
  failureCode: string;
  interactionId: string;
  nowMs: number;
  targetSlackUserId: string;
}): Promise<void> {
  await requireOnboardingUpdate(
    input.db,
    `
      UPDATE "openmeld"."slack_teammate_invitation_deliveries"
      SET onboarding_status = 'failed', onboarding_failure_code = $1, updated_at_ms = $2
      WHERE interaction_id = $3
        AND target_slack_user_id = $4
        AND onboarding_status IN ('starting', 'researching')
    `,
    [
      input.failureCode,
      input.nowMs,
      input.interactionId,
      input.targetSlackUserId,
    ]
  );
}
type SlackInvitedMemberOnboardingRow = {
  interaction_id: string;
  joined_profile_id: string;
  joined_user_id: string;
  organization_id: string;
  research_task_id: string | null;
  slack_team_id: string;
  target_display_name: string;
  target_slack_user_id: string;
};
function mapSlackInvitedMemberOnboarding(
  row: SlackInvitedMemberOnboardingRow
): SlackInvitedMemberOnboarding {
  return {
    interactionId: row.interaction_id,
    joinedProfileId: row.joined_profile_id,
    joinedUserId: row.joined_user_id,
    organizationId: row.organization_id,
    researchTaskId: row.research_task_id,
    slackTeamId: row.slack_team_id,
    targetDisplayName: row.target_display_name,
    targetSlackUserId: row.target_slack_user_id,
  };
}
async function requireOnboardingUpdate(
  db: PostgresDatabase,
  sql: string,
  values: unknown[]
): Promise<void> {
  const result = await db.query({ text: sql, values: [...values] });
  if (Number(result.rowCount ?? 0) !== 1) {
    throw new Error(
      "Slack invited-member onboarding state is no longer current."
    );
  }
}
