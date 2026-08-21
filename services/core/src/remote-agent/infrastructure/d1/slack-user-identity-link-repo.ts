import type { MessageChannelIdentityLinkAuditRecord } from "../../application/message-channel-identity-link-audit";

export type SlackUserIdentityLinkSource = "explicit" | "email_auto";

export type SlackIdentityLinkDeliveryScope =
  | "slack_direct_message"
  | "slack_ephemeral"
  | "slack_oidc";

export type SlackUserIdentityLinkRecord = {
  createdAtMs: number;
  organizationId: string;
  providerUserDisplayName?: string | null;
  slackTeamId: string;
  slackUserId: string;
  source: SlackUserIdentityLinkSource;
  openmeldUserId: string;
};

export type SlackIdentityLinkTokenRecord = {
  claimedAtMs: number | null;
  claimedByUserId: string | null;
  continuationAttempt: number;
  consumedByUserId: string | null;
  consumedAtMs: number | null;
  deliveryScope: SlackIdentityLinkDeliveryScope;
  expiresAtMs: number;
  issuedAtMs: number;
  membershipRequirement: "allow_enrollment" | "current_member";
  organizationId: string;
  slackTeamId: string;
  slackUserDisplayName: string;
  slackUserId: string;
  sourceDeliveryId: string | null;
  tokenHash: string;
};

export type SlackIdentityLinkConsumeResult =
  | {
      link: SlackUserIdentityLinkRecord;
      replacedExistingLink: boolean;
      status: "linked";
    }
  | {
      link: SlackUserIdentityLinkRecord;
      replacedExistingLink: false;
      status: "replayed";
    }
  | {
      status: "invalid";
    };

export type SlackIdentityLinkClaimResult =
  | {
      status: "claimed" | "replayed";
      token: SlackIdentityLinkTokenRecord;
    }
  | {
      status: "invalid";
    };

type SlackUserIdentityLinkRow = {
  created_at_ms: number;
  organization_id: string;
  provider_user_display_name?: string | null;
  slack_team_id: string;
  slack_user_id: string;
  source: SlackUserIdentityLinkSource;
  openmeld_user_id: string;
};

export async function readSlackUserIdentityLinksForOrganization(input: {
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
}): Promise<SlackUserIdentityLinkRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          identity_link.organization_id,
          identity_link.slack_team_id,
          identity_link.slack_user_id,
          identity_link.openmeld_user_id,
          identity_link.source,
          identity_link.created_at_ms,
          (
            SELECT token.slack_user_display_name
            FROM slack_user_identity_link_tokens AS token
            WHERE token.slack_team_id = identity_link.slack_team_id
              AND token.slack_user_id = identity_link.slack_user_id
            ORDER BY token.issued_at_ms DESC
            LIMIT 1
          ) AS provider_user_display_name
        FROM slack_user_identity_links AS identity_link
        WHERE identity_link.organization_id = ?
          AND identity_link.slack_team_id = ?
        ORDER BY identity_link.created_at_ms ASC, identity_link.slack_user_id ASC
      `
    )
    .bind(input.organizationId, input.slackTeamId)
    .all<SlackUserIdentityLinkRow>();
  return result.results.map(mapSlackUserIdentityLinkRow);
}

type SlackIdentityLinkTokenRow = {
  claimed_at_ms: number | null;
  claimed_by_user_id: string | null;
  continuation_attempt: number;
  consumed_by_user_id: string | null;
  consumed_at_ms: number | null;
  delivery_scope: string | null;
  expires_at_ms: number;
  issued_at_ms: number;
  membership_requirement: "allow_enrollment" | "current_member";
  organization_id: string;
  slack_team_id: string;
  slack_user_display_name: string;
  slack_user_id: string;
  source_delivery_id: string | null;
  token_hash: string;
};

// Leave room for the Organization and workspace bindings under D1's
// 100-bound-parameter query limit.
const SLACK_USER_IDENTITY_LINK_QUERY_CHUNK_SIZE = 90;

export async function readSlackUserIdentityLink(input: {
  db: D1Database;
  slackTeamId: string;
  slackUserId: string;
}): Promise<SlackUserIdentityLinkRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        FROM slack_user_identity_links
        WHERE slack_team_id = ?
          AND slack_user_id = ?
        LIMIT 1
      `
    )
    .bind(input.slackTeamId, input.slackUserId)
    .first<SlackUserIdentityLinkRow>();

  return row ? mapSlackUserIdentityLinkRow(row) : null;
}

export async function readSlackUserIdentityLinksForUsers(input: {
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
  slackUserIds: readonly string[];
}): Promise<SlackUserIdentityLinkRecord[]> {
  const slackUserIds = [...new Set(input.slackUserIds)];
  const records: SlackUserIdentityLinkRecord[] = [];

  for (
    let offset = 0;
    offset < slackUserIds.length;
    offset += SLACK_USER_IDENTITY_LINK_QUERY_CHUNK_SIZE
  ) {
    const chunk = slackUserIds.slice(
      offset,
      offset + SLACK_USER_IDENTITY_LINK_QUERY_CHUNK_SIZE
    );
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await input.db
      .prepare(
        `
          SELECT
            organization_id,
            slack_team_id,
            slack_user_id,
            openmeld_user_id,
            source,
            created_at_ms
          FROM slack_user_identity_links
          WHERE organization_id = ?
            AND slack_team_id = ?
            AND slack_user_id IN (${placeholders})
        `
      )
      .bind(input.organizationId, input.slackTeamId, ...chunk)
      .all<SlackUserIdentityLinkRow>();
    records.push(...result.results.map(mapSlackUserIdentityLinkRow));
  }

  return records;
}

export async function insertSlackUserIdentityLinkIfAbsent(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  source: SlackUserIdentityLinkSource;
  openmeldUserId: string;
}): Promise<SlackUserIdentityLinkRecord> {
  await input.db
    .prepare(
      `
        INSERT INTO slack_user_identity_links (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(slack_team_id, slack_user_id) DO NOTHING
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.source,
      input.nowMs
    )
    .run();

  const record = await readSlackUserIdentityLink({
    db: input.db,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
  });
  if (!record) {
    throw new Error("Slack user identity link write lost its row");
  }
  return record;
}

export async function upsertSlackUserIdentityLinkForSameUser(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  source: SlackUserIdentityLinkSource;
  openmeldUserId: string;
}): Promise<SlackUserIdentityLinkRecord> {
  await input.db
    .prepare(
      `
        INSERT INTO slack_user_identity_links (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          source = excluded.source
        WHERE slack_user_identity_links.openmeld_user_id = excluded.openmeld_user_id
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.source,
      input.nowMs
    )
    .run();

  const record = await readSlackUserIdentityLink({
    db: input.db,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
  });
  if (!record) {
    throw new Error("Slack user identity link write lost its row");
  }
  return record;
}

export function prepareUpsertSlackOAuthInstallerIdentityLinkStatement(input: {
  db: D1Database;
  nowMs: number;
  openmeldUserId: string;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT INTO slack_user_identity_links (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, 'explicit', ?)
        ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          source = excluded.source,
          created_at_ms = excluded.created_at_ms
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.nowMs
    );
}

export async function deleteSlackUserIdentityLinkIfMatches(input: {
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  openmeldUserId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        DELETE FROM slack_user_identity_links
        WHERE organization_id = ?
          AND slack_team_id = ?
          AND slack_user_id = ?
          AND openmeld_user_id = ?
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

export async function disconnectSlackUserIdentityLink(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  openmeldUserId: string;
}): Promise<boolean> {
  if (input.audit.action !== "disconnect_message_channel_identity_link") {
    throw new Error("Slack identity disconnect has invalid audit action");
  }
  if (input.audit.organizationId !== input.organizationId) {
    throw new Error("Slack identity disconnect has mismatched audit scope");
  }
  const auditStatement = input.db
    .prepare(
      `
        INSERT INTO center_agent_audit_journal (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          source_native_delivery_id,
          created_at
        )
        SELECT ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1
          FROM slack_user_identity_links
          WHERE organization_id = ?
            AND slack_team_id = ?
            AND slack_user_id = ?
            AND openmeld_user_id = ?
        )
      `
    )
    .bind(
      input.audit.id,
      input.audit.organizationId,
      input.audit.actorProfileId,
      input.audit.action,
      "message_channel_identity_link",
      input.audit.resourceId,
      input.audit.createdAtMs,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId
    );
  const deleteStatement = input.db
    .prepare(
      `
        DELETE FROM slack_user_identity_links
        WHERE organization_id = ?
          AND slack_team_id = ?
          AND slack_user_id = ?
          AND openmeld_user_id = ?
      `
    )
    .bind(
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId
    );
  const results = await input.db.batch([auditStatement, deleteStatement]);
  const result = results.at(-1);
  if (!result) {
    throw new Error("Slack identity link delete batch returned no result");
  }
  return Number(result.meta?.changes ?? 0) === 1;
}

export function prepareReconcileSlackUserIdentityLinksForWorkspaceMoveStatements(input: {
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
}): readonly D1PreparedStatement[] {
  const moveEligibleLinks = input.db
    .prepare(
      `
        UPDATE slack_user_identity_links
        SET organization_id = ?
        WHERE slack_team_id = ?
          AND EXISTS (
            SELECT 1
            FROM members
            WHERE members.organization_id = ?
              AND members.user_id = slack_user_identity_links.openmeld_user_id
          )
      `
    )
    .bind(input.organizationId, input.slackTeamId, input.organizationId);
  const deleteIneligibleLinks = input.db
    .prepare(
      `
        DELETE FROM slack_user_identity_links
        WHERE slack_team_id = ?
          AND organization_id <> ?
      `
    )
    .bind(input.slackTeamId, input.organizationId);

  return [moveEligibleLinks, deleteIneligibleLinks];
}

export async function insertSlackIdentityLinkToken(input: {
  claimedByUserId?: string;
  db: D1Database;
  deliveryScope: SlackIdentityLinkDeliveryScope;
  expiresAtMs: number;
  issuedAtMs: number;
  organizationId: string;
  slackTeamId: string;
  slackUserDisplayName: string;
  slackUserId: string;
  sourceDeliveryId?: string | null;
  tokenHash: string;
}): Promise<
  | { status: "inserted" }
  | {
      status: "source_delivery_already_claimed";
      token: SlackIdentityLinkTokenRecord;
    }
> {
  const sourceDeliveryId = input.sourceDeliveryId ?? null;
  const insertToken = input.db
    .prepare(
      `
        INSERT INTO slack_user_identity_link_tokens (
          token_hash,
          organization_id,
          slack_team_id,
          slack_user_id,
          slack_user_display_name,
          issued_at_ms,
          expires_at_ms,
          claimed_at_ms,
          claimed_by_user_id,
          membership_requirement,
          consumed_at_ms,
          consumed_by_user_id,
          continuation_attempt,
          delivery_scope,
          source_delivery_id
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?
        WHERE ? IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM slack_user_identity_link_tokens
            WHERE source_delivery_id = ?
              AND expires_at_ms > ?
          )
      `
    )
    .bind(
      input.tokenHash,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.slackUserDisplayName,
      input.issuedAtMs,
      input.expiresAtMs,
      input.claimedByUserId ? input.issuedAtMs : null,
      input.claimedByUserId ?? null,
      input.claimedByUserId ? "current_member" : "allow_enrollment",
      input.deliveryScope,
      sourceDeliveryId,
      sourceDeliveryId,
      sourceDeliveryId,
      input.issuedAtMs
    );
  const supersedePreviousTokens = input.db
    .prepare(
      `
        UPDATE slack_user_identity_link_tokens
        SET expires_at_ms = MAX(
          issued_at_ms + 1,
          MIN(expires_at_ms, ?)
        )
        WHERE slack_team_id = ?
          AND slack_user_id = ?
          AND consumed_at_ms IS NULL
          AND token_hash <> ?
          AND expires_at_ms > ?
          AND (? IS NOT NULL OR source_delivery_id IS NULL)
          AND EXISTS (
            SELECT 1
            FROM slack_user_identity_link_tokens AS inserted
            WHERE inserted.token_hash = ?
          )
      `
    )
    .bind(
      input.issuedAtMs,
      input.slackTeamId,
      input.slackUserId,
      input.tokenHash,
      input.issuedAtMs,
      sourceDeliveryId,
      input.tokenHash
    );
  const [insertResult] = await input.db.batch([
    insertToken,
    supersedePreviousTokens,
  ]);
  if (didWriteRows(insertResult)) {
    return { status: "inserted" };
  }
  if (sourceDeliveryId) {
    const token = await readActiveSlackIdentityLinkTokenForSourceDelivery({
      db: input.db,
      nowMs: input.issuedAtMs,
      sourceDeliveryId,
    });
    if (
      token?.organizationId === input.organizationId &&
      token.slackTeamId === input.slackTeamId &&
      token.slackUserId === input.slackUserId
    ) {
      return { status: "source_delivery_already_claimed", token };
    }
    if (token) {
      throw new Error(
        "Slack identity-link source delivery is already claimed by another identity"
      );
    }
  }
  throw new Error("Slack identity-link token was not inserted");
}

export async function readActiveSlackIdentityLinkTokenForSourceDelivery(input: {
  db: D1Database;
  nowMs: number;
  sourceDeliveryId: string;
}): Promise<SlackIdentityLinkTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          token_hash,
          organization_id,
          slack_team_id,
          slack_user_id,
          slack_user_display_name,
          issued_at_ms,
          expires_at_ms,
          claimed_at_ms,
          claimed_by_user_id,
          membership_requirement,
          consumed_at_ms,
          consumed_by_user_id,
          continuation_attempt,
          delivery_scope,
          source_delivery_id
        FROM slack_user_identity_link_tokens
        WHERE source_delivery_id = ?
          AND expires_at_ms > ?
        ORDER BY issued_at_ms DESC
        LIMIT 1
      `
    )
    .bind(input.sourceDeliveryId, input.nowMs)
    .first<SlackIdentityLinkTokenRow>();
  return row ? mapSlackIdentityLinkTokenRow(row) : null;
}

export async function expireSlackIdentityLinkToken(input: {
  db: D1Database;
  expiredAtMs: number;
  tokenHash: string;
}): Promise<void> {
  await input.db
    .prepare(
      `
        UPDATE slack_user_identity_link_tokens
        SET expires_at_ms = MAX(
          issued_at_ms + 1,
          MIN(expires_at_ms, ?)
        )
        WHERE token_hash = ?
          AND consumed_at_ms IS NULL
      `
    )
    .bind(input.expiredAtMs, input.tokenHash)
    .run();
}

export async function readActiveSlackIdentityLinkToken(input: {
  db: D1Database;
  nowMs: number;
  tokenHash: string;
}): Promise<SlackIdentityLinkTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          token_hash,
          organization_id,
          slack_team_id,
          slack_user_id,
          slack_user_display_name,
          issued_at_ms,
          expires_at_ms,
          claimed_at_ms,
          claimed_by_user_id,
          membership_requirement,
          consumed_at_ms,
          consumed_by_user_id,
          continuation_attempt,
          delivery_scope,
          source_delivery_id
        FROM slack_user_identity_link_tokens
        WHERE token_hash = ?
          AND organization_id IS NOT NULL
          AND delivery_scope IN (
            'slack_direct_message',
            'slack_ephemeral',
            'slack_oidc'
          )
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
        LIMIT 1
      `
    )
    .bind(input.tokenHash, input.nowMs)
    .first<SlackIdentityLinkTokenRow>();

  return row ? mapSlackIdentityLinkTokenRow(row) : null;
}

export async function readSlackIdentityLinkTokenForUser(input: {
  db: D1Database;
  nowMs: number;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<SlackIdentityLinkTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          token_hash,
          organization_id,
          slack_team_id,
          slack_user_id,
          slack_user_display_name,
          issued_at_ms,
          expires_at_ms,
          claimed_at_ms,
          claimed_by_user_id,
          membership_requirement,
          consumed_at_ms,
          consumed_by_user_id,
          continuation_attempt,
          delivery_scope,
          source_delivery_id
        FROM slack_user_identity_link_tokens
        WHERE token_hash = ?
          AND organization_id IS NOT NULL
          AND delivery_scope IN (
            'slack_direct_message',
            'slack_ephemeral',
            'slack_oidc'
          )
          AND expires_at_ms > ?
          AND (
            claimed_by_user_id IS NULL
            OR claimed_by_user_id = ?
          )
          AND (
            consumed_at_ms IS NULL
            OR consumed_by_user_id = ?
          )
        LIMIT 1
      `
    )
    .bind(
      input.tokenHash,
      input.nowMs,
      input.openmeldUserId,
      input.openmeldUserId
    )
    .first<SlackIdentityLinkTokenRow>();

  return row ? mapSlackIdentityLinkTokenRow(row) : null;
}

export async function claimSlackIdentityLinkTokenForUser(input: {
  claimedAtMs: number;
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<SlackIdentityLinkClaimResult> {
  const result = await input.db
    .prepare(
      `
        UPDATE slack_user_identity_link_tokens
        SET
          claimed_at_ms = ?,
          claimed_by_user_id = ?
        WHERE token_hash = ?
          AND organization_id = ?
          AND slack_team_id = ?
          AND slack_user_id = ?
          AND delivery_scope IN (
            'slack_direct_message',
            'slack_ephemeral',
            'slack_oidc'
          )
          AND claimed_by_user_id IS NULL
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_slack_workspace_bindings
            WHERE slack_team_id = ?
              AND organization_id = ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM slack_user_identity_link_tokens AS claimed_token
            WHERE claimed_token.slack_team_id = ?
              AND claimed_token.slack_user_id = ?
              AND claimed_token.token_hash <> ?
              AND claimed_token.claimed_by_user_id IS NOT NULL
              AND claimed_token.claimed_by_user_id <> ?
              AND claimed_token.consumed_at_ms IS NULL
              AND claimed_token.expires_at_ms > ?
          )
      `
    )
    .bind(
      input.claimedAtMs,
      input.openmeldUserId,
      input.tokenHash,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.claimedAtMs,
      input.slackTeamId,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.tokenHash,
      input.openmeldUserId,
      input.claimedAtMs
    )
    .run();
  if (didWriteRows(result)) {
    const token = await readSlackIdentityLinkTokenForUser({
      db: input.db,
      nowMs: input.claimedAtMs,
      tokenHash: input.tokenHash,
      openmeldUserId: input.openmeldUserId,
    });
    if (!token) {
      throw new Error("Slack identity link claim lost its token");
    }
    return { status: "claimed", token };
  }

  const replayToken = await readSlackIdentityLinkTokenForUser({
    db: input.db,
    nowMs: input.claimedAtMs,
    tokenHash: input.tokenHash,
    openmeldUserId: input.openmeldUserId,
  });
  return replayToken?.claimedAtMs
    ? { status: "replayed", token: replayToken }
    : { status: "invalid" };
}

export async function consumeSlackIdentityLinkTokenAndUpsertUserLink(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  consumeNonce: string;
  db: D1Database;
  consumedAtMs: number;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<SlackIdentityLinkConsumeResult> {
  if (input.audit.action !== "replace_message_channel_identity_link") {
    throw new Error("Slack identity replacement has invalid audit action");
  }
  if (
    input.audit.organizationId !== input.organizationId ||
    input.audit.createdAtMs !== input.consumedAtMs
  ) {
    throw new Error("Slack identity replacement has mismatched audit scope");
  }
  const consumeToken = input.db
    .prepare(
      `
        UPDATE slack_user_identity_link_tokens
        SET
          consumed_at_ms = ?,
          consume_nonce = ?,
          consumed_by_user_id = ?
        WHERE token_hash = ?
          AND organization_id = ?
          AND slack_team_id = ?
          AND slack_user_id = ?
          AND claimed_at_ms IS NOT NULL
          AND claimed_by_user_id = ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_slack_workspace_bindings
            WHERE slack_team_id = ?
              AND organization_id = ?
          )
          AND EXISTS (
            SELECT 1
            FROM members
            WHERE organization_id = ?
              AND user_id = ?
          )
      `
    )
    .bind(
      input.consumedAtMs,
      input.consumeNonce,
      input.openmeldUserId,
      input.tokenHash,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.consumedAtMs,
      input.slackTeamId,
      input.organizationId,
      input.organizationId,
      input.openmeldUserId
    );
  const auditReplacement = input.db
    .prepare(
      `
        INSERT INTO center_agent_audit_journal (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          source_native_delivery_id,
          created_at
        )
        SELECT ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1
          FROM slack_user_identity_link_tokens AS token
          WHERE token.token_hash = ?
            AND token.consume_nonce = ?
            AND token.consumed_at_ms = ?
            AND token.consumed_by_user_id = ?
            AND token.organization_id = ?
            AND token.slack_team_id = ?
            AND token.slack_user_id = ?
        ) AND EXISTS (
          SELECT 1
          FROM slack_user_identity_links AS identity_link
          WHERE identity_link.slack_team_id = ?
            AND identity_link.slack_user_id = ?
            AND identity_link.openmeld_user_id <> ?
        )
      `
    )
    .bind(
      input.audit.id,
      input.audit.organizationId,
      input.audit.actorProfileId,
      input.audit.action,
      "message_channel_identity_link",
      input.audit.resourceId,
      input.audit.createdAtMs,
      input.tokenHash,
      input.consumeNonce,
      input.consumedAtMs,
      input.openmeldUserId,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId
    );
  const upsertLink = input.db
    .prepare(
      `
        INSERT INTO slack_user_identity_links (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        SELECT
          organization_id,
          slack_team_id,
          slack_user_id,
          ?,
          'explicit',
          ?
        FROM slack_user_identity_link_tokens
        WHERE token_hash = ?
          AND consume_nonce = ?
          AND consumed_at_ms = ?
          AND claimed_by_user_id = ?
          AND organization_id = ?
          AND slack_team_id = ?
          AND slack_user_id = ?
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_slack_workspace_bindings
            WHERE slack_team_id = ?
              AND organization_id = ?
          )
          AND EXISTS (
            SELECT 1
            FROM members
            WHERE organization_id = ?
              AND user_id = ?
          )
        ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          source = excluded.source,
          created_at_ms = excluded.created_at_ms
      `
    )
    .bind(
      input.openmeldUserId,
      input.consumedAtMs,
      input.tokenHash,
      input.consumeNonce,
      input.consumedAtMs,
      input.openmeldUserId,
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.slackTeamId,
      input.organizationId,
      input.organizationId,
      input.openmeldUserId
    );
  const results = await input.db.batch([
    consumeToken,
    auditReplacement,
    upsertLink,
  ]);
  const consumeResult = results[0];
  const auditResult = results[1];
  const linkResult = results[2];

  if (!didWriteRows(consumeResult)) {
    const existingLink = await readSlackUserIdentityLink({
      db: input.db,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
    });
    if (existingLink?.openmeldUserId !== input.openmeldUserId) {
      return { status: "invalid" };
    }
    const replayToken = await readSlackIdentityLinkTokenForUser({
      db: input.db,
      nowMs: input.consumedAtMs,
      tokenHash: input.tokenHash,
      openmeldUserId: input.openmeldUserId,
    });
    return replayToken?.consumedAtMs
      ? {
          link: existingLink,
          replacedExistingLink: false,
          status: "replayed",
        }
      : { status: "invalid" };
  }
  if (!didWriteRows(linkResult)) {
    throw new Error(
      "Slack identity link token was consumed without writing its identity link"
    );
  }
  return {
    link: {
      createdAtMs: input.consumedAtMs,
      openmeldUserId: input.openmeldUserId,
      organizationId: input.organizationId,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      source: "explicit",
    },
    replacedExistingLink: didWriteRows(auditResult),
    status: "linked",
  };
}

export async function advanceSlackIdentityContinuationAttempt(input: {
  currentAttempt: number;
  db: D1Database;
  nowMs: number;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<number> {
  await input.db
    .prepare(
      `
        UPDATE slack_user_identity_link_tokens
        SET continuation_attempt = continuation_attempt + 1
        WHERE token_hash = ?
          AND claimed_by_user_id = ?
          AND consumed_by_user_id = ?
          AND consumed_at_ms IS NOT NULL
          AND continuation_attempt = ?
          AND expires_at_ms > ?
      `
    )
    .bind(
      input.tokenHash,
      input.openmeldUserId,
      input.openmeldUserId,
      input.currentAttempt,
      input.nowMs
    )
    .run();
  const token = await readSlackIdentityLinkTokenForUser({
    db: input.db,
    nowMs: input.nowMs,
    tokenHash: input.tokenHash,
    openmeldUserId: input.openmeldUserId,
  });
  if (!token) {
    throw new Error(
      "Slack identity continuation attempt lost its claimed token"
    );
  }
  return token.continuationAttempt;
}

function mapSlackUserIdentityLinkRow(
  row: SlackUserIdentityLinkRow
): SlackUserIdentityLinkRecord {
  return {
    createdAtMs: row.created_at_ms,
    organizationId: row.organization_id,
    providerUserDisplayName: row.provider_user_display_name ?? null,
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    source: row.source,
    openmeldUserId: row.openmeld_user_id,
  };
}

function mapSlackIdentityLinkTokenRow(
  row: SlackIdentityLinkTokenRow
): SlackIdentityLinkTokenRecord {
  if (
    row.delivery_scope !== "slack_direct_message" &&
    row.delivery_scope !== "slack_ephemeral" &&
    row.delivery_scope !== "slack_oidc"
  ) {
    throw new Error("Slack identity link token has an unsupported delivery");
  }
  return {
    claimedAtMs: row.claimed_at_ms,
    claimedByUserId: row.claimed_by_user_id,
    continuationAttempt: row.continuation_attempt,
    consumedByUserId: row.consumed_by_user_id,
    consumedAtMs: row.consumed_at_ms,
    deliveryScope: row.delivery_scope,
    expiresAtMs: row.expires_at_ms,
    issuedAtMs: row.issued_at_ms,
    membershipRequirement: row.membership_requirement,
    organizationId: row.organization_id,
    slackTeamId: row.slack_team_id,
    slackUserDisplayName: row.slack_user_display_name,
    slackUserId: row.slack_user_id,
    sourceDeliveryId: row.source_delivery_id,
    tokenHash: row.token_hash,
  };
}

function didWriteRows(result: unknown): boolean {
  const meta = (
    result as { meta?: { changes?: unknown; rows_written?: unknown } }
  ).meta;
  if (typeof meta?.changes === "number") {
    return meta.changes > 0;
  }
  if (typeof meta?.rows_written === "number") {
    return meta.rows_written > 0;
  }
  return false;
}
