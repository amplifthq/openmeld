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

export async function claimSlackTeammateInvitationDelivery(input: {
  actorSlackUserId: string;
  actorUserId: string;
  db: D1Database;
  interactionId: string;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
  targetDisplayName: string;
  targetEmail: string | null;
  targetSlackUserId: string;
}): Promise<SlackTeammateInvitationDeliveryClaim | null> {
  const result = await input.db
    .prepare(
      `
        INSERT INTO slack_teammate_invitation_deliveries (
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
        ON CONFLICT DO NOTHING
      `
    )
    .bind(
      input.interactionId,
      input.slackTeamId,
      input.organizationId,
      input.actorSlackUserId,
      input.actorUserId,
      input.targetSlackUserId,
      input.targetEmail,
      input.targetDisplayName,
      input.nowMs,
      input.nowMs
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
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
  db: D1Database;
  failureCode: string | null;
  messageTs: string | null;
  nowMs: number;
  status: "delivered" | "failed" | "outcome_unknown";
}): Promise<void> {
  const result = await input.db
    .prepare(
      `
        UPDATE slack_teammate_invitation_deliveries
        SET status = ?, message_ts = ?, failure_code = ?, updated_at_ms = ?
          ${input.status === "delivered" ? ", onboarding_status = 'waiting_for_join'" : ""}
        WHERE interaction_id = ?
          AND target_slack_user_id = ?
          AND status = 'pending'
      `
    )
    .bind(
      input.status,
      input.messageTs,
      input.failureCode,
      input.nowMs,
      input.claim.interactionId,
      input.claim.targetSlackUserId
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
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
  db: D1Database;
  nowMs: number;
}): Promise<SlackInvitedMemberOnboarding[]> {
  const claimed: SlackInvitedMemberOnboarding[] = [];
  for (const candidate of input.candidates) {
    const row = await input.db
      .prepare(
        `
          UPDATE slack_teammate_invitation_deliveries
          SET
            onboarding_status = 'starting',
            joined_user_id = ?,
            joined_profile_id = ?,
            updated_at_ms = ?
          WHERE interaction_id = ?
            AND target_slack_user_id = ?
            AND status = 'delivered'
            AND onboarding_status = 'waiting_for_join'
            AND NOT EXISTS (
              SELECT 1
              FROM slack_teammate_invitation_deliveries AS existing
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
          RETURNING *
        `
      )
      .bind(
        candidate.joinedUserId,
        candidate.joinedProfileId,
        input.nowMs,
        candidate.interactionId,
        candidate.targetSlackUserId
      )
      .first<SlackInvitedMemberOnboardingRow>();
    if (row) {
      claimed.push(mapSlackInvitedMemberOnboarding(row));
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

async function markDuplicateSlackInvitedMemberOnboarding(input: {
  db: D1Database;
  interactionId: string;
  joinedProfileId: string;
  joinedUserId: string;
  nowMs: number;
  targetSlackUserId: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE slack_teammate_invitation_deliveries
        SET
          onboarding_status = 'failed',
          joined_user_id = ?,
          joined_profile_id = ?,
          onboarding_failure_code = 'duplicate_invitation',
          updated_at_ms = ?
        WHERE interaction_id = ?
          AND target_slack_user_id = ?
          AND status = 'delivered'
          AND onboarding_status = 'waiting_for_join'
          AND EXISTS (
            SELECT 1
            FROM slack_teammate_invitation_deliveries AS existing
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
      `
    )
    .bind(
      input.joinedUserId,
      input.joinedProfileId,
      input.nowMs,
      input.interactionId,
      input.targetSlackUserId
    )
    .run();
}

export async function listActiveSlackInvitedMemberOnboardings(input: {
  db: D1Database;
  limit?: number;
}): Promise<SlackInvitedMemberOnboarding[]> {
  const result = await input.db
    .prepare(
      `
        SELECT *
        FROM slack_teammate_invitation_deliveries
        WHERE status = 'delivered'
          AND onboarding_status IN ('starting', 'researching')
        ORDER BY updated_at_ms ASC
        LIMIT ?
      `
    )
    .bind(input.limit ?? 10)
    .all<SlackInvitedMemberOnboardingRow>();
  return result.results.map(mapSlackInvitedMemberOnboarding);
}

export async function attachSlackInvitedMemberResearchTask(input: {
  db: D1Database;
  interactionId: string;
  nowMs: number;
  researchTaskId: string;
  targetSlackUserId: string;
}): Promise<void> {
  await requireOnboardingUpdate(
    input.db,
    `
      UPDATE slack_teammate_invitation_deliveries
      SET onboarding_status = 'researching', research_task_id = ?, updated_at_ms = ?
      WHERE interaction_id = ?
        AND target_slack_user_id = ?
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
  db: D1Database;
  interactionId: string;
  messageTs: string;
  nowMs: number;
  researchTaskId: string;
  targetSlackUserId: string;
}): Promise<void> {
  await requireOnboardingUpdate(
    input.db,
    `
      UPDATE slack_teammate_invitation_deliveries
      SET onboarding_status = 'completed', welcome_message_ts = ?, updated_at_ms = ?
      WHERE interaction_id = ?
        AND target_slack_user_id = ?
        AND onboarding_status = 'researching'
        AND research_task_id = ?
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
  db: D1Database;
  failureCode: string;
  interactionId: string;
  nowMs: number;
  targetSlackUserId: string;
}): Promise<void> {
  await requireOnboardingUpdate(
    input.db,
    `
      UPDATE slack_teammate_invitation_deliveries
      SET onboarding_status = 'failed', onboarding_failure_code = ?, updated_at_ms = ?
      WHERE interaction_id = ?
        AND target_slack_user_id = ?
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
  db: D1Database,
  sql: string,
  values: unknown[]
): Promise<void> {
  const result = await db
    .prepare(sql)
    .bind(...values)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new Error(
      "Slack invited-member onboarding state is no longer current."
    );
  }
}
