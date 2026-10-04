import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
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
  db: PostgresDatabase;
  organizationId: string;
  slackTeamId: string;
}): Promise<SlackUserIdentityLinkRecord[]> {
  const result = await input.db.query<SlackUserIdentityLinkRow>({
    text: `
        SELECT
          identity_link.organization_id,
          identity_link.slack_team_id,
          identity_link.slack_user_id,
          identity_link.openmeld_user_id,
          identity_link.source,
          identity_link.created_at_ms,
          (
            SELECT token.slack_user_display_name
            FROM "openmeld"."slack_user_identity_link_tokens" AS token
            WHERE token.slack_team_id = identity_link.slack_team_id
              AND token.slack_user_id = identity_link.slack_user_id
            ORDER BY token.issued_at_ms DESC NULLS LAST
            LIMIT 1
          ) AS provider_user_display_name
        FROM "openmeld"."slack_user_identity_links" AS identity_link
        WHERE identity_link.organization_id = $1
          AND identity_link.slack_team_id = $2
        ORDER BY identity_link.created_at_ms ASC NULLS FIRST, identity_link.slack_user_id ASC NULLS FIRST
      `,
    values: [input.organizationId, input.slackTeamId],
  });
  return result.rows.map(mapSlackUserIdentityLinkRow);
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
  db: PostgresDatabase;
  slackTeamId: string;
  slackUserId: string;
}): Promise<SlackUserIdentityLinkRecord | null> {
  const row = await input.db
    .query<SlackUserIdentityLinkRow>({
      text: `
        SELECT
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        FROM "openmeld"."slack_user_identity_links"
        WHERE slack_team_id = $1
          AND slack_user_id = $2
        LIMIT 1
      `,
      values: [input.slackTeamId, input.slackUserId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapSlackUserIdentityLinkRow(row) : null;
}
export async function readSlackUserIdentityLinksForUsers(input: {
  db: PostgresDatabase;
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
    const result = await input.db.query<SlackUserIdentityLinkRow>({
      text: `
          SELECT
            organization_id,
            slack_team_id,
            slack_user_id,
            openmeld_user_id,
            source,
            created_at_ms
          FROM "openmeld"."slack_user_identity_links"
          WHERE organization_id = $1
            AND slack_team_id = $2
            AND slack_user_id = ANY($3::text[])
        `,
      values: [input.organizationId, input.slackTeamId, chunk],
    });
    records.push(...result.rows.map(mapSlackUserIdentityLinkRow));
  }
  return records;
}
export async function insertSlackUserIdentityLinkIfAbsent(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  source: SlackUserIdentityLinkSource;
  openmeldUserId: string;
}): Promise<SlackUserIdentityLinkRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(slack_team_id, slack_user_id) DO NOTHING
      `,
    values: [
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.source,
      input.nowMs,
    ],
  });
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
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  source: SlackUserIdentityLinkSource;
  openmeldUserId: string;
}): Promise<SlackUserIdentityLinkRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          source = excluded.source
        WHERE slack_user_identity_links.openmeld_user_id = excluded.openmeld_user_id
      `,
    values: [
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.source,
      input.nowMs,
    ],
  });
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
  db: PostgresDatabase;
  nowMs: number;
  openmeldUserId: string;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
}): QueryConfig {
  return {
    text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, 'explicit', $5)
        ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          source = excluded.source,
          created_at_ms = excluded.created_at_ms
      `,
    values: [
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
      input.nowMs,
    ],
  };
}
export async function deleteSlackUserIdentityLinkIfMatches(input: {
  db: PostgresDatabase;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  openmeldUserId: string;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        DELETE FROM "openmeld"."slack_user_identity_links"
        WHERE organization_id = $1
          AND slack_team_id = $2
          AND slack_user_id = $3
          AND openmeld_user_id = $4
      `,
    values: [
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
    ],
  });
  return Number(result.rowCount ?? 0) === 1;
}
export async function disconnectSlackUserIdentityLink(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  db: PostgresDatabase;
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
  const auditStatement = {
    text: `
        INSERT INTO "openmeld"."center_agent_audit_journal" (
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
        SELECT $1, $2, $3, $4, NULL, NULL, NULL, $5, $6, NULL, $7
        WHERE EXISTS (
          SELECT 1
          FROM "openmeld"."slack_user_identity_links"
          WHERE organization_id = $8
            AND slack_team_id = $9
            AND slack_user_id = $10
            AND openmeld_user_id = $11
        )
      `,
    values: [
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
      input.openmeldUserId,
    ],
  };
  const deleteStatement = {
    text: `
        DELETE FROM "openmeld"."slack_user_identity_links"
        WHERE organization_id = $1
          AND slack_team_id = $2
          AND slack_user_id = $3
          AND openmeld_user_id = $4
      `,
    values: [
      input.organizationId,
      input.slackTeamId,
      input.slackUserId,
      input.openmeldUserId,
    ],
  };
  const results = await input.db.transaction(
    async (client) =>
      [
        await client.query(auditStatement),
        await client.query(deleteStatement),
      ] as const
  );
  const result = results.at(-1);
  if (!result) {
    throw new Error("Slack identity link delete batch returned no result");
  }
  return Number(result.rowCount ?? 0) === 1;
}
export function prepareReconcileSlackUserIdentityLinksForWorkspaceMoveStatements(input: {
  db: PostgresDatabase;
  organizationId: string;
  slackTeamId: string;
}): readonly QueryConfig[] {
  const moveEligibleLinks = {
    text: `
        UPDATE "openmeld"."slack_user_identity_links"
        SET organization_id = $1
        WHERE slack_team_id = $2
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."members"
            WHERE members.organization_id = $3
              AND members.user_id = slack_user_identity_links.openmeld_user_id
          )
      `,
    values: [input.organizationId, input.slackTeamId, input.organizationId],
  };
  const deleteIneligibleLinks = {
    text: `
        DELETE FROM "openmeld"."slack_user_identity_links"
        WHERE slack_team_id = $1
          AND organization_id <> $2
      `,
    values: [input.slackTeamId, input.organizationId],
  };
  return [moveEligibleLinks, deleteIneligibleLinks];
}
export async function insertSlackIdentityLinkToken(input: {
  claimedByUserId?: string;
  db: PostgresDatabase;
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
  | {
      status: "inserted";
    }
  | {
      status: "source_delivery_already_claimed";
      token: SlackIdentityLinkTokenRecord;
    }
> {
  const sourceDeliveryId = input.sourceDeliveryId ?? null;
  const insertToken = {
    text: `
        INSERT INTO "openmeld"."slack_user_identity_link_tokens" (
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
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, 0, $11, $12
        WHERE $13::text IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM "openmeld"."slack_user_identity_link_tokens"
            WHERE source_delivery_id = $14
              AND expires_at_ms > $15
          )
      `,
    values: [
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
      input.issuedAtMs,
    ],
  };
  const supersedePreviousTokens = {
    text: `
        UPDATE "openmeld"."slack_user_identity_link_tokens"
        SET expires_at_ms = GREATEST(
          issued_at_ms + 1,
          LEAST(expires_at_ms, $1)
        )
        WHERE slack_team_id = $2
          AND slack_user_id = $3
          AND consumed_at_ms IS NULL
          AND token_hash <> $4
          AND expires_at_ms > $5
          AND ($6::text IS NOT NULL OR source_delivery_id IS NULL)
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."slack_user_identity_link_tokens" AS inserted
            WHERE inserted.token_hash = $7
          )
      `,
    values: [
      input.issuedAtMs,
      input.slackTeamId,
      input.slackUserId,
      input.tokenHash,
      input.issuedAtMs,
      sourceDeliveryId,
      input.tokenHash,
    ],
  };
  const [insertResult] = await input.db.transaction(
    async (client) =>
      [
        await client.query(insertToken),
        await client.query(supersedePreviousTokens),
      ] as const
  );
  if ((insertResult.rowCount ?? 0) > 0) {
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
  db: PostgresDatabase;
  nowMs: number;
  sourceDeliveryId: string;
}): Promise<SlackIdentityLinkTokenRecord | null> {
  const row = await input.db
    .query<SlackIdentityLinkTokenRow>({
      text: `
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
        FROM "openmeld"."slack_user_identity_link_tokens"
        WHERE source_delivery_id = $1
          AND expires_at_ms > $2
        ORDER BY issued_at_ms DESC NULLS LAST
        LIMIT 1
      `,
      values: [input.sourceDeliveryId, input.nowMs],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapSlackIdentityLinkTokenRow(row) : null;
}
export async function expireSlackIdentityLinkToken(input: {
  db: PostgresDatabase;
  expiredAtMs: number;
  tokenHash: string;
}): Promise<void> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_user_identity_link_tokens"
        SET expires_at_ms = GREATEST(
          issued_at_ms + 1,
          LEAST(expires_at_ms, $1)
        )
        WHERE token_hash = $2
          AND consumed_at_ms IS NULL
      `,
    values: [input.expiredAtMs, input.tokenHash],
  });
}
export async function readActiveSlackIdentityLinkToken(input: {
  db: PostgresDatabase;
  nowMs: number;
  tokenHash: string;
}): Promise<SlackIdentityLinkTokenRecord | null> {
  const row = await input.db
    .query<SlackIdentityLinkTokenRow>({
      text: `
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
        FROM "openmeld"."slack_user_identity_link_tokens"
        WHERE token_hash = $1
          AND organization_id IS NOT NULL
          AND delivery_scope IN (
            'slack_direct_message',
            'slack_ephemeral',
            'slack_oidc'
          )
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $2
        LIMIT 1
      `,
      values: [input.tokenHash, input.nowMs],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapSlackIdentityLinkTokenRow(row) : null;
}
export async function readSlackIdentityLinkTokenForUser(input: {
  db: PostgresDatabase;
  nowMs: number;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<SlackIdentityLinkTokenRecord | null> {
  const row = await input.db
    .query<SlackIdentityLinkTokenRow>({
      text: `
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
        FROM "openmeld"."slack_user_identity_link_tokens"
        WHERE token_hash = $1
          AND organization_id IS NOT NULL
          AND delivery_scope IN (
            'slack_direct_message',
            'slack_ephemeral',
            'slack_oidc'
          )
          AND expires_at_ms > $2
          AND (
            claimed_by_user_id IS NULL
            OR claimed_by_user_id = $3
          )
          AND (
            consumed_at_ms IS NULL
            OR consumed_by_user_id = $4
          )
        LIMIT 1
      `,
      values: [
        input.tokenHash,
        input.nowMs,
        input.openmeldUserId,
        input.openmeldUserId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapSlackIdentityLinkTokenRow(row) : null;
}
export async function claimSlackIdentityLinkTokenForUser(input: {
  claimedAtMs: number;
  db: PostgresDatabase;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<SlackIdentityLinkClaimResult> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."slack_user_identity_link_tokens"
        SET
          claimed_at_ms = $1,
          claimed_by_user_id = $2
        WHERE token_hash = $3
          AND organization_id = $4
          AND slack_team_id = $5
          AND slack_user_id = $6
          AND delivery_scope IN (
            'slack_direct_message',
            'slack_ephemeral',
            'slack_oidc'
          )
          AND claimed_by_user_id IS NULL
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $7
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
            WHERE slack_team_id = $8
              AND organization_id = $9
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "openmeld"."slack_user_identity_link_tokens" AS claimed_token
            WHERE claimed_token.slack_team_id = $10
              AND claimed_token.slack_user_id = $11
              AND claimed_token.token_hash <> $12
              AND claimed_token.claimed_by_user_id IS NOT NULL
              AND claimed_token.claimed_by_user_id <> $13
              AND claimed_token.consumed_at_ms IS NULL
              AND claimed_token.expires_at_ms > $14
          )
      `,
    values: [
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
      input.claimedAtMs,
    ],
  });
  if ((result.rowCount ?? 0) > 0) {
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
  db: PostgresDatabase;
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
  const consumeToken = {
    text: `
        UPDATE "openmeld"."slack_user_identity_link_tokens"
        SET
          consumed_at_ms = $1,
          consume_nonce = $2,
          consumed_by_user_id = $3
        WHERE token_hash = $4
          AND organization_id = $5
          AND slack_team_id = $6
          AND slack_user_id = $7
          AND claimed_at_ms IS NOT NULL
          AND claimed_by_user_id = $8
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $9
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
            WHERE slack_team_id = $10
              AND organization_id = $11
          )
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."members"
            WHERE organization_id = $12
              AND user_id = $13
          )
      `,
    values: [
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
      input.openmeldUserId,
    ],
  };
  const auditReplacement = {
    text: `
        INSERT INTO "openmeld"."center_agent_audit_journal" (
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
        SELECT $1, $2, $3, $4, NULL, NULL, NULL, $5, $6, NULL, $7
        WHERE EXISTS (
          SELECT 1
          FROM "openmeld"."slack_user_identity_link_tokens" AS token
          WHERE token.token_hash = $8
            AND token.consume_nonce = $9
            AND token.consumed_at_ms = $10
            AND token.consumed_by_user_id = $11
            AND token.organization_id = $12
            AND token.slack_team_id = $13
            AND token.slack_user_id = $14
        ) AND EXISTS (
          SELECT 1
          FROM "openmeld"."slack_user_identity_links" AS identity_link
          WHERE identity_link.slack_team_id = $15
            AND identity_link.slack_user_id = $16
            AND identity_link.openmeld_user_id <> $17
        )
      `,
    values: [
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
      input.openmeldUserId,
    ],
  };
  const upsertLink = {
    text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
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
          $1,
          'explicit',
          $2
        FROM "openmeld"."slack_user_identity_link_tokens"
        WHERE token_hash = $3
          AND consume_nonce = $4
          AND consumed_at_ms = $5
          AND claimed_by_user_id = $6
          AND organization_id = $7
          AND slack_team_id = $8
          AND slack_user_id = $9
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
            WHERE slack_team_id = $10
              AND organization_id = $11
          )
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."members"
            WHERE organization_id = $12
              AND user_id = $13
          )
        ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          source = excluded.source,
          created_at_ms = excluded.created_at_ms
      `,
    values: [
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
      input.openmeldUserId,
    ],
  };
  const results = await input.db.transaction(
    async (client) =>
      [
        await client.query(consumeToken),
        await client.query(auditReplacement),
        await client.query(upsertLink),
      ] as const
  );
  const consumeResult = results[0];
  const auditResult = results[1];
  const linkResult = results[2];
  if (!((consumeResult.rowCount ?? 0) > 0)) {
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
  if (!((linkResult.rowCount ?? 0) > 0)) {
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
    replacedExistingLink: (auditResult.rowCount ?? 0) > 0,
    status: "linked",
  };
}
export async function advanceSlackIdentityContinuationAttempt(input: {
  currentAttempt: number;
  db: PostgresDatabase;
  nowMs: number;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<number> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."slack_user_identity_link_tokens"
        SET continuation_attempt = continuation_attempt + 1
        WHERE token_hash = $1
          AND claimed_by_user_id = $2
          AND consumed_by_user_id = $3
          AND consumed_at_ms IS NOT NULL
          AND continuation_attempt = $4
          AND expires_at_ms > $5
      `,
    values: [
      input.tokenHash,
      input.openmeldUserId,
      input.openmeldUserId,
      input.currentAttempt,
      input.nowMs,
    ],
  });
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
