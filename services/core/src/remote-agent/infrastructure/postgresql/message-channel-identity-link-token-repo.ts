import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { MessageChannelIdentityLinkAuditRecord } from "../../application/message-channel-identity-link-audit";
import type { RemoteAgentLarkPlatformProvider } from "./lark-platform-channel-connection-repo";
import { readRemoteAgentLarkPlatformIdentityLink } from "./lark-platform-identity-link-repo";
export type RemoteAgentMessageChannelIdentityLinkTokenRecord = {
  claimedAtMs: number | null;
  claimedByUserId: string | null;
  connectionId: string;
  continuationAttempt: number;
  consumeNonce: string | null;
  consumedAtMs: number | null;
  expiresAtMs: number;
  issuedAtMs: number;
  linkPurpose: "continue_request" | "optional_setup";
  membershipRequirement: "allow_enrollment" | "current_member";
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserDisplayName: string;
  providerUserId: string;
  sourceDeliveryId: string;
  tokenHash: string;
};
type RemoteAgentMessageChannelIdentityLinkTokenRow = {
  claimed_at_ms: number | null;
  claimed_by_user_id: string | null;
  connection_id: string;
  continuation_attempt: number;
  consume_nonce: string | null;
  consumed_at_ms: number | null;
  expires_at_ms: number;
  issued_at_ms: number;
  link_purpose: "continue_request" | "optional_setup";
  membership_requirement: "allow_enrollment" | "current_member";
  organization_id: string;
  provider: RemoteAgentLarkPlatformProvider;
  provider_user_display_name: string;
  provider_user_id: string;
  source_delivery_id: string;
  token_hash: string;
};
export async function insertRemoteAgentMessageChannelIdentityLinkToken(input: {
  claimedByUserId?: string;
  connectionId: string;
  db: PostgresDatabase;
  expiresAtMs: number;
  issuedAtMs: number;
  linkPurpose?: "continue_request" | "optional_setup";
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserDisplayName: string;
  providerUserId: string;
  sourceDeliveryId?: string;
  tokenHash: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens" (
          token_hash,
          provider,
          connection_id,
          provider_user_id,
          provider_user_display_name,
          organization_id,
          source_delivery_id,
          link_purpose,
          issued_at_ms,
          expires_at_ms,
          claimed_by_user_id,
          claimed_at_ms,
          membership_requirement,
          consumed_at_ms,
          consume_nonce,
          continuation_attempt
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, NULL, 0
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        WHERE connection_id = $14
          AND provider = $15
          AND organization_id = $16
          AND status = 'connected'
      `,
    values: [
      input.tokenHash,
      input.provider,
      input.connectionId,
      input.providerUserId,
      input.providerUserDisplayName,
      input.organizationId,
      input.sourceDeliveryId ?? `legacy:${input.tokenHash}`,
      input.linkPurpose ?? "optional_setup",
      input.issuedAtMs,
      input.expiresAtMs,
      input.claimedByUserId ?? null,
      input.claimedByUserId ? input.issuedAtMs : null,
      input.claimedByUserId ? "current_member" : "allow_enrollment",
      input.connectionId,
      input.provider,
      input.organizationId,
    ],
  });
  const record = await readActiveRemoteAgentMessageChannelIdentityLinkToken({
    db: input.db,
    nowMs: input.issuedAtMs,
    tokenHash: input.tokenHash,
  });
  if (
    !record ||
    record.connectionId !== input.connectionId ||
    record.organizationId !== input.organizationId ||
    record.provider !== input.provider ||
    record.providerUserId !== input.providerUserId ||
    record.claimedByUserId !== (input.claimedByUserId ?? null) ||
    record.membershipRequirement !==
      (input.claimedByUserId ? "current_member" : "allow_enrollment")
  ) {
    throw new Error(
      "Message Channel identity link token does not match a connected provider"
    );
  }
  return record;
}
export async function readActiveRemoteAgentMessageChannelIdentityLinkToken(input: {
  db: PostgresDatabase;
  nowMs: number;
  tokenHash: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  const row = await input.db
    .query<RemoteAgentMessageChannelIdentityLinkTokenRow>({
      text: `
        SELECT
          token.token_hash,
          token.provider,
          token.connection_id,
          token.provider_user_id,
          token.provider_user_display_name,
          token.organization_id,
          token.source_delivery_id,
          token.link_purpose,
          token.issued_at_ms,
          token.expires_at_ms,
          token.claimed_by_user_id,
          token.claimed_at_ms,
          token.membership_requirement,
          token.consumed_at_ms,
          token.consume_nonce,
          token.continuation_attempt
        FROM "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens" AS token
        INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" AS connection
          ON connection.connection_id = token.connection_id
          AND connection.provider = token.provider
          AND connection.organization_id = token.organization_id
        WHERE token.token_hash = $1
          AND token.consumed_at_ms IS NULL
          AND token.expires_at_ms > $2
          AND connection.status = 'connected'
        LIMIT 1
      `,
      values: [input.tokenHash, input.nowMs],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapTokenRow(row) : null;
}
export async function readRemoteAgentMessageChannelIdentityLinkTokenForUser(input: {
  db: PostgresDatabase;
  nowMs: number;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  const row = await input.db
    .query<RemoteAgentMessageChannelIdentityLinkTokenRow>({
      text: `
        SELECT
          token.token_hash,
          token.provider,
          token.connection_id,
          token.provider_user_id,
          token.provider_user_display_name,
          token.organization_id,
          token.source_delivery_id,
          token.link_purpose,
          token.issued_at_ms,
          token.expires_at_ms,
          token.claimed_by_user_id,
          token.claimed_at_ms,
          token.membership_requirement,
          token.consumed_at_ms,
          token.consume_nonce,
          token.continuation_attempt
        FROM "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens" AS token
        INNER JOIN "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" AS connection
          ON connection.connection_id = token.connection_id
          AND connection.provider = token.provider
          AND connection.organization_id = token.organization_id
        LEFT JOIN "openmeld"."openMeldRemoteAgent_lark_platform_identity_links" AS link
          ON link.provider = token.provider
          AND link.connection_id = token.connection_id
          AND link.provider_user_id = token.provider_user_id
        WHERE token.token_hash = $1
          AND token.expires_at_ms > $2
          AND connection.status = 'connected'
          AND (
            (token.consumed_at_ms IS NULL AND (
              token.claimed_by_user_id IS NULL
              OR token.claimed_by_user_id = $3
            ))
            OR link.openmeld_user_id = $4
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
  return row ? mapTokenRow(row) : null;
}
export async function claimRemoteAgentMessageChannelIdentityLinkToken(input: {
  claimedAtMs: number;
  db: PostgresDatabase;
  token: RemoteAgentMessageChannelIdentityLinkTokenRecord;
  openmeldUserId: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens"
        SET
          claimed_by_user_id = $1,
          claimed_at_ms = COALESCE(claimed_at_ms, $2)
        WHERE token_hash = $3
          AND consumed_at_ms IS NULL
          AND expires_at_ms > $4
          AND (
            claimed_by_user_id IS NULL
            OR claimed_by_user_id = $5
          )
      `,
    values: [
      input.openmeldUserId,
      input.claimedAtMs,
      input.token.tokenHash,
      input.claimedAtMs,
      input.openmeldUserId,
    ],
  });
  const claimed = await readRemoteAgentMessageChannelIdentityLinkTokenForUser({
    db: input.db,
    nowMs: input.claimedAtMs,
    tokenHash: input.token.tokenHash,
    openmeldUserId: input.openmeldUserId,
  });
  return claimed?.claimedByUserId === input.openmeldUserId ? claimed : null;
}
export type RemoteAgentMessageChannelIdentityLinkConsumeResult =
  | {
      replacedExistingLink: boolean;
      status: "linked";
    }
  | {
      replacedExistingLink: false;
      status: "replayed";
    }
  | {
      status: "invalid";
    };
export async function consumeRemoteAgentMessageChannelIdentityLinkToken(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  consumeNonce: string;
  db: PostgresDatabase;
  nowMs: number;
  token: RemoteAgentMessageChannelIdentityLinkTokenRecord;
  openmeldUserId: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkConsumeResult> {
  if (input.audit.action !== "replace_message_channel_identity_link") {
    throw new Error(
      "Message Channel identity replacement has invalid audit action"
    );
  }
  if (
    input.audit.organizationId !== input.token.organizationId ||
    input.audit.createdAtMs !== input.nowMs
  ) {
    throw new Error(
      "Message Channel identity replacement has mismatched audit scope"
    );
  }
  const consume = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens"
        SET consumed_at_ms = $1, consume_nonce = $2
        WHERE token_hash = $3
          AND provider = $4
          AND connection_id = $5
          AND provider_user_id = $6
          AND organization_id = $7
          AND consumed_at_ms IS NULL
          AND claimed_by_user_id = $8
          AND expires_at_ms > $9
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" AS connection
            WHERE connection.connection_id = $10
              AND connection.provider = $11
              AND connection.organization_id = $12
              AND connection.status = 'connected'
          )
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."members"
            WHERE organization_id = $13
              AND user_id = $14
          )
      `,
    values: [
      input.nowMs,
      input.consumeNonce,
      input.token.tokenHash,
      input.token.provider,
      input.token.connectionId,
      input.token.providerUserId,
      input.token.organizationId,
      input.openmeldUserId,
      input.nowMs,
      input.token.connectionId,
      input.token.provider,
      input.token.organizationId,
      input.token.organizationId,
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
          FROM "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens" AS token
          WHERE token.token_hash = $8
            AND token.consume_nonce = $9
            AND token.consumed_at_ms = $10
            AND token.claimed_by_user_id = $11
            AND token.provider = $12
            AND token.connection_id = $13
            AND token.provider_user_id = $14
            AND token.organization_id = $15
        ) AND EXISTS (
          SELECT 1
          FROM "openmeld"."openMeldRemoteAgent_lark_platform_identity_links" AS identity_link
          WHERE identity_link.provider = $16
            AND identity_link.connection_id = $17
            AND identity_link.provider_user_id = $18
            AND identity_link.openmeld_user_id <> $19
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
      input.token.tokenHash,
      input.consumeNonce,
      input.nowMs,
      input.openmeldUserId,
      input.token.provider,
      input.token.connectionId,
      input.token.providerUserId,
      input.token.organizationId,
      input.token.provider,
      input.token.connectionId,
      input.token.providerUserId,
      input.openmeldUserId,
    ],
  };
  const link = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_lark_platform_identity_links" (
          provider,
          connection_id,
          provider_user_id,
          organization_id,
          openmeld_user_id,
          resolution_source,
          created_at_ms
        )
        SELECT provider, connection_id, provider_user_id, organization_id, $1, 'explicit', $2
        FROM "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens"
        WHERE token_hash = $3
          AND consume_nonce = $4
          AND consumed_at_ms = $5
          AND claimed_by_user_id = $6
          AND provider = $7
          AND connection_id = $8
          AND provider_user_id = $9
          AND organization_id = $10
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."members"
            WHERE organization_id = $11
              AND user_id = $12
          )
        ON CONFLICT(provider, connection_id, provider_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          resolution_source = excluded.resolution_source,
          created_at_ms = excluded.created_at_ms
      `,
    values: [
      input.openmeldUserId,
      input.nowMs,
      input.token.tokenHash,
      input.consumeNonce,
      input.nowMs,
      input.openmeldUserId,
      input.token.provider,
      input.token.connectionId,
      input.token.providerUserId,
      input.token.organizationId,
      input.token.organizationId,
      input.openmeldUserId,
    ],
  };
  const results = await input.db.transaction(
    async (client) =>
      [
        await client.query(consume),
        await client.query(auditReplacement),
        await client.query(link),
      ] as const
  );
  const consumeResult = results[0];
  const auditResult = results[1];
  const linkResult = results[2];
  if ((consumeResult.rowCount ?? 0) > 0) {
    if (!((linkResult.rowCount ?? 0) > 0)) {
      throw new Error(
        "Message Channel identity token was consumed without writing its identity link"
      );
    }
    return {
      replacedExistingLink: (auditResult.rowCount ?? 0) > 0,
      status: "linked",
    };
  }
  const [consumedToken, identityLink] = await Promise.all([
    readRemoteAgentMessageChannelIdentityLinkToken({
      db: input.db,
      tokenHash: input.token.tokenHash,
    }),
    readRemoteAgentLarkPlatformIdentityLink({
      connectionId: input.token.connectionId,
      db: input.db,
      provider: input.token.provider,
      providerUserId: input.token.providerUserId,
    }),
  ]);
  return consumedToken?.consumedAtMs !== null &&
    consumedToken?.claimedByUserId === input.openmeldUserId &&
    identityLink?.organizationId === input.token.organizationId &&
    identityLink.openmeldUserId === input.openmeldUserId
    ? { replacedExistingLink: false, status: "replayed" }
    : { status: "invalid" };
}
export async function advanceRemoteAgentMessageChannelIdentityContinuationAttempt(input: {
  currentAttempt: number;
  db: PostgresDatabase;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<number> {
  const nextAttempt = input.currentAttempt + 1;
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens"
        SET continuation_attempt = $1
        WHERE token_hash = $2
          AND continuation_attempt = $3
          AND consumed_at_ms IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldRemoteAgent_lark_platform_identity_links" AS link
            WHERE link.provider = "openMeldRemoteAgent_message_channel_identity_link_tokens".provider
              AND link.connection_id = "openMeldRemoteAgent_message_channel_identity_link_tokens".connection_id
              AND link.provider_user_id = "openMeldRemoteAgent_message_channel_identity_link_tokens".provider_user_id
              AND link.openmeld_user_id = $4
          )
      `,
    values: [
      nextAttempt,
      input.tokenHash,
      input.currentAttempt,
      input.openmeldUserId,
    ],
  });
  const token = await readRemoteAgentMessageChannelIdentityLinkToken({
    db: input.db,
    tokenHash: input.tokenHash,
  });
  if (token?.continuationAttempt !== nextAttempt) {
    throw new Error(
      "Message Channel identity continuation attempt did not advance."
    );
  }
  return nextAttempt;
}
async function readRemoteAgentMessageChannelIdentityLinkToken(input: {
  db: PostgresDatabase;
  tokenHash: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  const row = await input.db
    .query<RemoteAgentMessageChannelIdentityLinkTokenRow>({
      text: `
        SELECT
          token_hash,
          provider,
          connection_id,
          provider_user_id,
          provider_user_display_name,
          organization_id,
          source_delivery_id,
          link_purpose,
          issued_at_ms,
          expires_at_ms,
          claimed_by_user_id,
          claimed_at_ms,
          membership_requirement,
          consumed_at_ms,
          consume_nonce,
          continuation_attempt
        FROM "openmeld"."openMeldRemoteAgent_message_channel_identity_link_tokens"
        WHERE token_hash = $1
        LIMIT 1
      `,
      values: [input.tokenHash],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapTokenRow(row) : null;
}
function mapTokenRow(
  row: RemoteAgentMessageChannelIdentityLinkTokenRow
): RemoteAgentMessageChannelIdentityLinkTokenRecord {
  return {
    claimedAtMs: row.claimed_at_ms,
    claimedByUserId: row.claimed_by_user_id,
    connectionId: row.connection_id,
    continuationAttempt: row.continuation_attempt,
    consumeNonce: row.consume_nonce,
    consumedAtMs: row.consumed_at_ms,
    expiresAtMs: row.expires_at_ms,
    issuedAtMs: row.issued_at_ms,
    linkPurpose: row.link_purpose,
    membershipRequirement: row.membership_requirement,
    organizationId: row.organization_id,
    provider: row.provider,
    providerUserDisplayName: row.provider_user_display_name,
    providerUserId: row.provider_user_id,
    sourceDeliveryId: row.source_delivery_id,
    tokenHash: row.token_hash,
  };
}
