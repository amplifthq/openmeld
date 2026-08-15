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
  status: "ack_pending" | "failed" | "outcome_unknown" | "ready";
};

export type SlackChannelIntroductionItemClaim = {
  attemptCount: number;
  botWasChannelMember: boolean;
  claimId: string;
  run: SlackChannelIntroductionRun & { acknowledgementTs: string };
  slackChannelId: string;
  slackChannelName: string;
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

export async function createSlackChannelIntroductionManifest(input: {
  channels: readonly SlackChannelIntroductionManifestChannel[];
  db: D1Database;
  dmChannelId: string;
  interactionId: string;
  nowMs: number;
  organizationId: string;
  organizationInviteUrl: string | null;
  requesterSlackUserId: string;
  slackTeamId: string;
}): Promise<{ created: boolean; run: SlackChannelIntroductionRun }> {
  if (input.channels.length === 0) {
    throw new Error("Slack channel introduction requires at least one channel");
  }
  const manifestCreationId = crypto.randomUUID();
  const results = await input.db.batch([
    input.db
      .prepare(
        `
          INSERT INTO slack_channel_introduction_runs (
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
          VALUES (?, ?, ?, ?, ?, ?, ?, 'ack_pending', NULL, NULL, ?, ?)
          ON CONFLICT DO NOTHING
        `
      )
      .bind(
        input.interactionId,
        manifestCreationId,
        input.slackTeamId,
        input.organizationId,
        input.requesterSlackUserId,
        input.dmChannelId,
        input.organizationInviteUrl,
        input.nowMs,
        input.nowMs
      ),
    ...input.channels.map((channel, position) =>
      input.db
        .prepare(
          `
            INSERT INTO slack_channel_introduction_items (
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
            SELECT ?, ?, ?, ?, ?, 'ready', NULL, 0, NULL, ?, ?
            FROM slack_channel_introduction_runs
            WHERE interaction_id = ? AND manifest_creation_id = ?
            ON CONFLICT DO NOTHING
          `
        )
        .bind(
          input.interactionId,
          channel.slackChannelId,
          channel.slackChannelName,
          position,
          channel.botWasChannelMember ? 1 : 0,
          input.nowMs,
          input.nowMs,
          input.interactionId,
          manifestCreationId
        )
    ),
  ]);
  const manifest = await readSlackChannelIntroductionManifest({
    db: input.db,
    interactionId: input.interactionId,
  });
  if (!manifest) {
    throw new Error("Slack channel introduction manifest was not persisted");
  }
  assertSameManifest({ actual: manifest, expected: input });
  return {
    created: Number(results[0]?.meta.changes ?? 0) === 1,
    run: manifest.run,
  };
}

export async function completeSlackChannelIntroductionAcknowledgement(input: {
  acknowledgementTs: string;
  db: D1Database;
  interactionId: string;
  nowMs: number;
}): Promise<void> {
  const result = await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_runs
        SET
          status = 'ready',
          acknowledgement_ts = ?,
          failure_code = NULL,
          updated_at_ms = ?
        WHERE interaction_id = ? AND status = 'ack_pending'
        RETURNING interaction_id
      `
    )
    .bind(input.acknowledgementTs, input.nowMs, input.interactionId)
    .first<{ interaction_id: string }>();
  if (!result) {
    throw new Error(
      "Slack channel introduction acknowledgement was no longer pending"
    );
  }
}

export async function failSlackChannelIntroductionAcknowledgement(input: {
  db: D1Database;
  failureCode: string;
  interactionId: string;
  nowMs: number;
  outcomeUnknown: boolean;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_runs
        SET
          status = ?,
          acknowledgement_ts = NULL,
          failure_code = ?,
          updated_at_ms = ?
        WHERE interaction_id = ? AND status = 'ack_pending'
      `
    )
    .bind(
      input.outcomeUnknown ? "outcome_unknown" : "failed",
      input.failureCode,
      input.nowMs,
      input.interactionId
    )
    .run();
}

export async function claimNextSlackChannelIntroductionItem(input: {
  db: D1Database;
  interactionId?: string;
  nowMs: number;
}): Promise<SlackChannelIntroductionItemClaim | null> {
  await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_items
        SET
          status = 'ready',
          claim_id = NULL,
          updated_at_ms = ?
        WHERE status = 'submitting' AND updated_at_ms <= ?
      `
    )
    .bind(input.nowMs, input.nowMs - STALE_CHANNEL_INTRODUCTION_CLAIM_MS)
    .run();
  await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_runs
        SET
          status = 'outcome_unknown',
          failure_code = 'acknowledgement_outcome_unknown',
          updated_at_ms = ?
        WHERE status = 'ack_pending' AND updated_at_ms <= ?
      `
    )
    .bind(input.nowMs, input.nowMs - STALE_CHANNEL_INTRODUCTION_CLAIM_MS)
    .run();

  const candidate = await input.db
    .prepare(
      `
        SELECT i.interaction_id, i.slack_channel_id
        FROM slack_channel_introduction_items AS i
        INNER JOIN slack_channel_introduction_runs AS r
          ON r.interaction_id = i.interaction_id
        WHERE
          i.status = 'ready'
          AND r.status = 'ready'
          AND (? IS NULL OR i.interaction_id = ?)
        ORDER BY r.created_at_ms ASC, i.position ASC
        LIMIT 1
      `
    )
    .bind(input.interactionId ?? null, input.interactionId ?? null)
    .first<{ interaction_id: string; slack_channel_id: string }>();
  if (!candidate) {
    return null;
  }

  const claimId = crypto.randomUUID();
  const claimed = await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_items
        SET
          status = 'submitting',
          claim_id = ?,
          attempt_count = attempt_count + 1,
          updated_at_ms = ?
        WHERE
          interaction_id = ?
          AND slack_channel_id = ?
          AND status = 'ready'
        RETURNING
          attempt_count,
          bot_was_channel_member,
          slack_channel_id,
          slack_channel_name
      `
    )
    .bind(
      claimId,
      input.nowMs,
      candidate.interaction_id,
      candidate.slack_channel_id
    )
    .first<{
      attempt_count: number;
      bot_was_channel_member: number;
      slack_channel_id: string;
      slack_channel_name: string;
    }>();
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
  db: D1Database;
  failureCode: string | null;
  nowMs: number;
  status: "failed" | "outcome_unknown" | "submitted";
}): Promise<void> {
  const result = await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_items
        SET
          status = ?,
          claim_id = NULL,
          failure_code = ?,
          updated_at_ms = ?
        WHERE
          interaction_id = ?
          AND slack_channel_id = ?
          AND status = 'submitting'
          AND claim_id = ?
        RETURNING status
      `
    )
    .bind(
      input.status,
      input.failureCode,
      input.nowMs,
      input.claim.run.interactionId,
      input.claim.slackChannelId,
      input.claim.claimId
    )
    .first<{ status: string }>();
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
  db: D1Database;
  nowMs: number;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE slack_channel_introduction_items
        SET
          status = 'ready',
          claim_id = NULL,
          failure_code = NULL,
          updated_at_ms = ?
        WHERE
          interaction_id = ?
          AND slack_channel_id = ?
          AND status = 'submitting'
          AND claim_id = ?
      `
    )
    .bind(
      input.nowMs,
      input.claim.interactionId,
      input.claim.slackChannelId,
      input.claim.claimId
    )
    .run();
}

async function readSlackChannelIntroductionManifest(input: {
  db: D1Database;
  interactionId: string;
}): Promise<{
  channels: SlackChannelIntroductionManifestChannel[];
  run: SlackChannelIntroductionRun;
} | null> {
  const run = await readSlackChannelIntroductionRun(input);
  if (!run) {
    return null;
  }
  const result = await input.db
    .prepare(
      `
        SELECT
          slack_channel_id,
          slack_channel_name,
          position,
          bot_was_channel_member
        FROM slack_channel_introduction_items
        WHERE interaction_id = ?
        ORDER BY position ASC
      `
    )
    .bind(input.interactionId)
    .all<SlackChannelIntroductionItemRow>();
  return {
    channels: result.results.map((row) => ({
      botWasChannelMember: row.bot_was_channel_member === 1,
      slackChannelId: row.slack_channel_id,
      slackChannelName: row.slack_channel_name,
    })),
    run,
  };
}

async function readSlackChannelIntroductionRun(input: {
  db: D1Database;
  interactionId: string;
}): Promise<SlackChannelIntroductionRun | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          interaction_id,
          slack_team_id,
          organization_id,
          requester_slack_user_id,
          dm_channel_id,
          organization_invite_url,
          status,
          acknowledgement_ts
        FROM slack_channel_introduction_runs
        WHERE interaction_id = ?
        LIMIT 1
      `
    )
    .bind(input.interactionId)
    .first<SlackChannelIntroductionRunRow>();
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
