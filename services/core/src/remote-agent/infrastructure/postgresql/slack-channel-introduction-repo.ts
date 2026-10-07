import type { PostgresDatabase } from "@openmeld/db/postgresql";
export type SlackChannelIntroductionManifestChannel = {
  botWasChannelMember: boolean;
  slackChannelId: string;
  slackChannelName: string;
};
export type SlackChannelIntroductionRun = {
  acknowledgementTs: string | null;
  dmChannelId: string;
  interactionId: string;
  organizationId: string;
  organizationInviteUrl: string | null;
  requesterSlackUserId: string;
  slackTeamId: string;
  status:
    | "ack_pending"
    | "failed"
    | "outcome_unknown"
    | "ready"
    | "recovery_notice_delivered"
    | "recovery_notice_failed"
    | "recovery_notice_outcome_unknown"
    | "recovery_notice_pending"
    | "recovery_notice_submitting";
};
export type SlackChannelIntroductionItemClaim = {
  attemptCount: number;
  botWasChannelMember: boolean;
  claimId: string;
  run: SlackChannelIntroductionRun & {
    acknowledgementTs: string;
  };
  slackChannelId: string;
  slackChannelName: string;
};
export type PendingSlackChannelIntroductionAcknowledgement = {
  dmChannelId: string;
  interactionId: string;
  slackTeamId: string;
  updatedAtMs: number;
};
export type SlackChannelIntroductionRecoveryNotice = {
  attemptCount: number;
  dmChannelId: string;
  interactionId: string;
  slackTeamId: string;
  updatedAtMs: number;
};
type SlackChannelIntroductionRunRow = {
  acknowledgement_ts: string | null;
  dm_channel_id: string;
  interaction_id: string;
  organization_id: string;
  organization_invite_url: string | null;
  requester_slack_user_id: string;
  slack_team_id: string;
  status: SlackChannelIntroductionRun["status"];
};
type SlackChannelIntroductionItemRow = {
  bot_was_channel_member: number;
  position: number;
  slack_channel_id: string;
  slack_channel_name: string;
};
const STALE_CHANNEL_INTRODUCTION_CLAIM_MS = 5 * 60_000;
export async function listPendingSlackChannelIntroductionAcknowledgements(input: {
  beforeOrAtMs: number;
  db: PostgresDatabase;
  interactionId?: string;
  limit?: number;
}): Promise<PendingSlackChannelIntroductionAcknowledgement[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 16, 64));
  const runs = await input.db.query<{
    dm_channel_id: string;
    interaction_id: string;
    slack_team_id: string;
    updated_at_ms: number;
  }>({
    text: `
        SELECT interaction_id, slack_team_id, dm_channel_id, updated_at_ms
        FROM "openmeld"."slack_channel_introduction_runs"
        WHERE status = 'ack_pending'
          AND updated_at_ms <= $1
          AND ($2::text IS NULL OR interaction_id = $3)
        ORDER BY updated_at_ms ASC NULLS FIRST, interaction_id ASC NULLS FIRST
        LIMIT $4
      `,
    values: [
      input.beforeOrAtMs,
      input.interactionId ?? null,
      input.interactionId ?? null,
      limit,
    ],
  });
  return runs.rows.map((run) => ({
    dmChannelId: run.dm_channel_id,
    interactionId: run.interaction_id,
    slackTeamId: run.slack_team_id,
    updatedAtMs: run.updated_at_ms,
  }));
}
export async function scheduleSlackChannelIntroductionRecoveryNotice(input: {
  db: PostgresDatabase;
  failureCode: string;
  interactionId: string;
  nowMs: number;
}): Promise<boolean> {
  const scheduled = await input.db
    .query<{
      interaction_id: string;
    }>({
      text: `
        UPDATE "openmeld"."slack_channel_introduction_runs"
        SET
          status = 'recovery_notice_pending',
          acknowledgement_ts = NULL,
          recovery_notice_ts = NULL,
          failure_code = $1,
          updated_at_ms = $2
        WHERE interaction_id = $3 AND status = 'ack_pending'
        RETURNING interaction_id
      `,
      values: [input.failureCode, input.nowMs, input.interactionId],
    })
    .then((result) => result.rows[0] ?? null);
  return scheduled !== null;
}
export async function claimSlackChannelIntroductionRecoveryNotice(input: {
  db: PostgresDatabase;
  interactionId?: string;
  nowMs: number;
}): Promise<SlackChannelIntroductionRecoveryNotice | null> {
  const candidate = await input.db
    .query<{
      interaction_id: string;
    }>({
      text: `
        SELECT interaction_id
        FROM "openmeld"."slack_channel_introduction_runs"
        WHERE status = 'recovery_notice_pending'
          AND ($1::text IS NULL OR interaction_id = $2)
        ORDER BY updated_at_ms ASC NULLS FIRST, interaction_id ASC NULLS FIRST
        LIMIT 1
      `,
      values: [input.interactionId ?? null, input.interactionId ?? null],
    })
    .then((result) => result.rows[0] ?? null);
  if (!candidate) {
    return null;
  }
  const claimed = await input.db
    .query<{
      dm_channel_id: string;
      interaction_id: string;
      recovery_notice_attempt_count: number;
      slack_team_id: string;
      updated_at_ms: number;
    }>({
      text: `
        UPDATE "openmeld"."slack_channel_introduction_runs"
        SET
          status = 'recovery_notice_submitting',
          recovery_notice_attempt_count = recovery_notice_attempt_count + 1,
          updated_at_ms = $1
        WHERE interaction_id = $2 AND status = 'recovery_notice_pending'
        RETURNING
          interaction_id,
          slack_team_id,
          dm_channel_id,
          recovery_notice_attempt_count,
          updated_at_ms
      `,
      values: [input.nowMs, candidate.interaction_id],
    })
    .then((result) => result.rows[0] ?? null);
  return claimed
    ? {
        attemptCount: claimed.recovery_notice_attempt_count,
        dmChannelId: claimed.dm_channel_id,
        interactionId: claimed.interaction_id,
        slackTeamId: claimed.slack_team_id,
        updatedAtMs: claimed.updated_at_ms,
      }
    : null;
}
export async function listStaleSlackChannelIntroductionRecoveryNotices(input: {
  beforeOrAtMs: number;
  db: PostgresDatabase;
  interactionId?: string;
  limit?: number;
}): Promise<SlackChannelIntroductionRecoveryNotice[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 16, 64));
  const result = await input.db.query<{
    dm_channel_id: string;
    interaction_id: string;
    recovery_notice_attempt_count: number;
    slack_team_id: string;
    updated_at_ms: number;
  }>({
    text: `
        SELECT
          interaction_id,
          slack_team_id,
          dm_channel_id,
          recovery_notice_attempt_count,
          updated_at_ms
        FROM "openmeld"."slack_channel_introduction_runs"
        WHERE status = 'recovery_notice_submitting'
          AND updated_at_ms <= $1
          AND ($2::text IS NULL OR interaction_id = $3)
        ORDER BY updated_at_ms ASC NULLS FIRST, interaction_id ASC NULLS FIRST
        LIMIT $4
      `,
    values: [
      input.beforeOrAtMs,
      input.interactionId ?? null,
      input.interactionId ?? null,
      limit,
    ],
  });
  return result.rows.map((row) => ({
    attemptCount: row.recovery_notice_attempt_count,
    dmChannelId: row.dm_channel_id,
    interactionId: row.interaction_id,
    slackTeamId: row.slack_team_id,
    updatedAtMs: row.updated_at_ms,
  }));
}
export async function completeSlackChannelIntroductionRecoveryNotice(input: {
  db: PostgresDatabase;
  interactionId: string;
  messageTs: string;
  nowMs: number;
}): Promise<void> {
  const completed = await input.db
    .query<{
      interaction_id: string;
    }>({
      text: `
        UPDATE "openmeld"."slack_channel_introduction_runs"
        SET
          status = 'recovery_notice_delivered',
          recovery_notice_ts = $1,
          updated_at_ms = $2
        WHERE interaction_id = $3 AND status = 'recovery_notice_submitting'
        RETURNING interaction_id
      `,
      values: [input.messageTs, input.nowMs, input.interactionId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!completed) {
    throw new Error(
      "Slack channel introduction recovery notice was not claimed"
    );
  }
}
export async function settleSlackChannelIntroductionRecoveryNoticeFailure(input: {
  db: PostgresDatabase;
  failureCode: string;
  interactionId: string;
  nowMs: number;
  status:
    | "recovery_notice_failed"
    | "recovery_notice_outcome_unknown"
    | "recovery_notice_pending";
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_channel_introduction_runs"
        SET
          status = $1,
          recovery_notice_ts = NULL,
          failure_code = $2,
          updated_at_ms = $3
        WHERE interaction_id = $4 AND status = 'recovery_notice_submitting'
      `,
    values: [input.status, input.failureCode, input.nowMs, input.interactionId],
  });
}
export async function createSlackChannelIntroductionManifest(input: {
  channels: readonly SlackChannelIntroductionManifestChannel[];
  db: PostgresDatabase;
  dmChannelId: string;
  interactionId: string;
  nowMs: number;
  organizationId: string;
  organizationInviteUrl: string | null;
  requesterSlackUserId: string;
  slackTeamId: string;
}): Promise<{
  created: boolean;
  run: SlackChannelIntroductionRun;
}> {
  if (input.channels.length === 0) {
    throw new Error("Slack channel introduction requires at least one channel");
  }
  const manifestCreationId = crypto.randomUUID();
  const results = await input.db.transaction(async (client) =>
    Promise.all([
      client.query({
        text: `
          INSERT INTO "openmeld"."slack_channel_introduction_runs" (
            interaction_id,
            manifest_creation_id,
            slack_team_id,
            organization_id,
            requester_slack_user_id,
            dm_channel_id,
            organization_invite_url,
            status,
            acknowledgement_ts,
            failure_code,
            created_at_ms,
            updated_at_ms
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'ack_pending', NULL, NULL, $8, $9)
          ON CONFLICT DO NOTHING
        `,
        values: [
          input.interactionId,
          manifestCreationId,
          input.slackTeamId,
          input.organizationId,
          input.requesterSlackUserId,
          input.dmChannelId,
          input.organizationInviteUrl,
          input.nowMs,
          input.nowMs,
        ],
      }),
      ...input.channels
        .map((channel, position) => ({
          text: `
            INSERT INTO "openmeld"."slack_channel_introduction_items" (
              interaction_id,
              slack_channel_id,
              slack_channel_name,
              position,
              bot_was_channel_member,
              status,
              claim_id,
              attempt_count,
              failure_code,
              created_at_ms,
              updated_at_ms
            )
            SELECT $1, $2, $3, $4, $5, 'ready', NULL, 0, NULL, $6, $7
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = $8 AND manifest_creation_id = $9
            ON CONFLICT DO NOTHING
          `,
          values: [
            input.interactionId,
            channel.slackChannelId,
            channel.slackChannelName,
            position,
            channel.botWasChannelMember ? 1 : 0,
            input.nowMs,
            input.nowMs,
            input.interactionId,
            manifestCreationId,
          ],
        }))
        .map((query) => client.query(query)),
    ])
  );
  const manifest = await readSlackChannelIntroductionManifest({
    db: input.db,
    interactionId: input.interactionId,
  });
  if (!manifest) {
    throw new Error("Slack channel introduction manifest was not persisted");
  }
  assertSameManifest({ actual: manifest, expected: input });
  return {
    created: Number(results[0].rowCount ?? 0) === 1,
    run: manifest.run,
  };
}
export async function completeSlackChannelIntroductionAcknowledgement(input: {
  acknowledgementTs: string;
  db: PostgresDatabase;
  interactionId: string;
  nowMs: number;
}): Promise<void> {
  const result = await input.db
    .query<{
      interaction_id: string;
    }>({
      text: `
        UPDATE "openmeld"."slack_channel_introduction_runs"
        SET
          status = 'ready',
          acknowledgement_ts = $1,
          failure_code = NULL,
          updated_at_ms = $2
        WHERE interaction_id = $3 AND status = 'ack_pending'
        RETURNING interaction_id
      `,
      values: [input.acknowledgementTs, input.nowMs, input.interactionId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!result) {
    throw new Error(
      "Slack channel introduction acknowledgement was no longer pending"
    );
  }
}
export async function failSlackChannelIntroductionAcknowledgement(input: {
  db: PostgresDatabase;
  failureCode: string;
  interactionId: string;
  nowMs: number;
  outcomeUnknown: boolean;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_channel_introduction_runs"
        SET
          status = $1,
          acknowledgement_ts = NULL,
          failure_code = $2,
          updated_at_ms = $3
        WHERE interaction_id = $4 AND status = 'ack_pending'
      `,
    values: [
      input.outcomeUnknown ? "outcome_unknown" : "failed",
      input.failureCode,
      input.nowMs,
      input.interactionId,
    ],
  });
}
export async function claimNextSlackChannelIntroductionItem(input: {
  db: PostgresDatabase;
  interactionId?: string;
  nowMs: number;
}): Promise<SlackChannelIntroductionItemClaim | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_channel_introduction_items"
        SET
          status = 'ready',
          claim_id = NULL,
          updated_at_ms = $1
        WHERE status = 'submitting' AND updated_at_ms <= $2
      `,
    values: [input.nowMs, input.nowMs - STALE_CHANNEL_INTRODUCTION_CLAIM_MS],
  });
  const candidate = await input.db
    .query<{
      interaction_id: string;
      slack_channel_id: string;
    }>({
      text: `
        SELECT i.interaction_id, i.slack_channel_id
        FROM "openmeld"."slack_channel_introduction_items" AS i
        INNER JOIN "openmeld"."slack_channel_introduction_runs" AS r
          ON r.interaction_id = i.interaction_id
        WHERE
          i.status = 'ready'
          AND r.status = 'ready'
          AND ($1::text IS NULL OR i.interaction_id = $2)
        ORDER BY r.created_at_ms ASC NULLS FIRST, i.position ASC NULLS FIRST
        LIMIT 1
      `,
      values: [input.interactionId ?? null, input.interactionId ?? null],
    })
    .then((result) => result.rows[0] ?? null);
  if (!candidate) {
    return null;
  }
  const claimId = crypto.randomUUID();
  const claimed = await input.db
    .query<{
      attempt_count: number;
      bot_was_channel_member: number;
      slack_channel_id: string;
      slack_channel_name: string;
    }>({
      text: `
        UPDATE "openmeld"."slack_channel_introduction_items"
        SET
          status = 'submitting',
          claim_id = $1,
          attempt_count = attempt_count + 1,
          updated_at_ms = $2
        WHERE
          interaction_id = $3
          AND slack_channel_id = $4
          AND status = 'ready'
        RETURNING
          attempt_count,
          bot_was_channel_member,
          slack_channel_id,
          slack_channel_name
      `,
      values: [
        claimId,
        input.nowMs,
        candidate.interaction_id,
        candidate.slack_channel_id,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!claimed) {
    return null;
  }
  const run = await readSlackChannelIntroductionRun({
    db: input.db,
    interactionId: candidate.interaction_id,
  });
  if (!(run && run.status === "ready" && run.acknowledgementTs)) {
    await releaseSlackChannelIntroductionItemClaim({
      claim: {
        claimId,
        interactionId: candidate.interaction_id,
        slackChannelId: candidate.slack_channel_id,
      },
      db: input.db,
      nowMs: input.nowMs,
    });
    return null;
  }
  return {
    attemptCount: claimed.attempt_count,
    botWasChannelMember: claimed.bot_was_channel_member === 1,
    claimId,
    run: { ...run, acknowledgementTs: run.acknowledgementTs },
    slackChannelId: claimed.slack_channel_id,
    slackChannelName: claimed.slack_channel_name,
  };
}
export async function completeSlackChannelIntroductionItemClaim(input: {
  claim: SlackChannelIntroductionItemClaim;
  db: PostgresDatabase;
  failureCode: string | null;
  nowMs: number;
  status: "failed" | "outcome_unknown" | "submitted";
}): Promise<void> {
  const result = await input.db
    .query<{
      status: string;
    }>({
      text: `
        UPDATE "openmeld"."slack_channel_introduction_items"
        SET
          status = $1,
          claim_id = NULL,
          failure_code = $2,
          updated_at_ms = $3
        WHERE
          interaction_id = $4
          AND slack_channel_id = $5
          AND status = 'submitting'
          AND claim_id = $6
        RETURNING status
      `,
      values: [
        input.status,
        input.failureCode,
        input.nowMs,
        input.claim.run.interactionId,
        input.claim.slackChannelId,
        input.claim.claimId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!result) {
    throw new Error(
      "Slack channel introduction item claim was no longer current"
    );
  }
}
export async function releaseSlackChannelIntroductionItemClaim(input: {
  claim: {
    claimId: string;
    interactionId: string;
    slackChannelId: string;
  };
  db: PostgresDatabase;
  nowMs: number;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_channel_introduction_items"
        SET
          status = 'ready',
          claim_id = NULL,
          failure_code = NULL,
          updated_at_ms = $1
        WHERE
          interaction_id = $2
          AND slack_channel_id = $3
          AND status = 'submitting'
          AND claim_id = $4
      `,
    values: [
      input.nowMs,
      input.claim.interactionId,
      input.claim.slackChannelId,
      input.claim.claimId,
    ],
  });
}
async function readSlackChannelIntroductionManifest(input: {
  db: PostgresDatabase;
  interactionId: string;
}): Promise<{
  channels: SlackChannelIntroductionManifestChannel[];
  run: SlackChannelIntroductionRun;
} | null> {
  const run = await readSlackChannelIntroductionRun(input);
  if (!run) {
    return null;
  }
  const result = await input.db.query<SlackChannelIntroductionItemRow>({
    text: `
        SELECT
          slack_channel_id,
          slack_channel_name,
          position,
          bot_was_channel_member
        FROM "openmeld"."slack_channel_introduction_items"
        WHERE interaction_id = $1
        ORDER BY position ASC NULLS FIRST
      `,
    values: [input.interactionId],
  });
  return {
    channels: result.rows.map((row) => ({
      botWasChannelMember: row.bot_was_channel_member === 1,
      slackChannelId: row.slack_channel_id,
      slackChannelName: row.slack_channel_name,
    })),
    run,
  };
}
async function readSlackChannelIntroductionRun(input: {
  db: PostgresDatabase;
  interactionId: string;
}): Promise<SlackChannelIntroductionRun | null> {
  const row = await input.db
    .query<SlackChannelIntroductionRunRow>({
      text: `
        SELECT
          interaction_id,
          slack_team_id,
          organization_id,
          requester_slack_user_id,
          dm_channel_id,
          organization_invite_url,
          status,
          acknowledgement_ts
        FROM "openmeld"."slack_channel_introduction_runs"
        WHERE interaction_id = $1
        LIMIT 1
      `,
      values: [input.interactionId],
    })
    .then((result) => result.rows[0] ?? null);
  return row
    ? {
        acknowledgementTs: row.acknowledgement_ts,
        dmChannelId: row.dm_channel_id,
        interactionId: row.interaction_id,
        organizationId: row.organization_id,
        organizationInviteUrl: row.organization_invite_url,
        requesterSlackUserId: row.requester_slack_user_id,
        slackTeamId: row.slack_team_id,
        status: row.status,
      }
    : null;
}
function assertSameManifest(input: {
  actual: {
    channels: readonly SlackChannelIntroductionManifestChannel[];
    run: SlackChannelIntroductionRun;
  };
  expected: {
    channels: readonly SlackChannelIntroductionManifestChannel[];
    dmChannelId: string;
    interactionId: string;
    organizationId: string;
    organizationInviteUrl: string | null;
    requesterSlackUserId: string;
    slackTeamId: string;
  };
}): void {
  const sameRun =
    input.actual.run.interactionId === input.expected.interactionId &&
    input.actual.run.slackTeamId === input.expected.slackTeamId &&
    input.actual.run.organizationId === input.expected.organizationId &&
    input.actual.run.requesterSlackUserId ===
      input.expected.requesterSlackUserId &&
    input.actual.run.dmChannelId === input.expected.dmChannelId &&
    input.actual.run.organizationInviteUrl ===
      input.expected.organizationInviteUrl;
  const sameChannels =
    input.actual.channels.length === input.expected.channels.length &&
    input.actual.channels.every((channel, index) => {
      const expected = input.expected.channels[index];
      return (
        expected?.slackChannelId === channel.slackChannelId &&
        expected.slackChannelName === channel.slackChannelName &&
        expected.botWasChannelMember === channel.botWasChannelMember
      );
    });
  if (!(sameRun && sameChannels)) {
    throw new Error(
      "Slack channel introduction interaction was reused with a different manifest"
    );
  }
}
