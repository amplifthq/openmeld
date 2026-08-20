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
  db: D1Database;
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
  await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_message_channel_identity_link_tokens (
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
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0
        FROM openMeldRemoteAgent_lark_platform_channel_connections
        WHERE connection_id = ?
          AND provider = ?
          AND organization_id = ?
          AND status = 'connected'
      `
    )
    .bind(
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
      input.organizationId
    )
    .run();
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
  db: D1Database;
  nowMs: number;
  tokenHash: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
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
        FROM openMeldRemoteAgent_message_channel_identity_link_tokens AS token
        INNER JOIN openMeldRemoteAgent_lark_platform_channel_connections AS connection
          ON connection.connection_id = token.connection_id
          AND connection.provider = token.provider
          AND connection.organization_id = token.organization_id
        WHERE token.token_hash = ?
          AND token.consumed_at_ms IS NULL
          AND token.expires_at_ms > ?
          AND connection.status = 'connected'
        LIMIT 1
      `
    )
    .bind(input.tokenHash, input.nowMs)
    .first<RemoteAgentMessageChannelIdentityLinkTokenRow>();
  return row ? mapTokenRow(row) : null;
}

export async function readRemoteAgentMessageChannelIdentityLinkTokenForUser(input: {
  db: D1Database;
  nowMs: number;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
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
        FROM openMeldRemoteAgent_message_channel_identity_link_tokens AS token
        INNER JOIN openMeldRemoteAgent_lark_platform_channel_connections AS connection
          ON connection.connection_id = token.connection_id
          AND connection.provider = token.provider
          AND connection.organization_id = token.organization_id
        LEFT JOIN openMeldRemoteAgent_lark_platform_identity_links AS link
          ON link.provider = token.provider
          AND link.connection_id = token.connection_id
          AND link.provider_user_id = token.provider_user_id
        WHERE token.token_hash = ?
          AND token.expires_at_ms > ?
          AND connection.status = 'connected'
          AND (
            (token.consumed_at_ms IS NULL AND (
              token.claimed_by_user_id IS NULL
              OR token.claimed_by_user_id = ?
            ))
            OR link.openmeld_user_id = ?
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
    .first<RemoteAgentMessageChannelIdentityLinkTokenRow>();
  return row ? mapTokenRow(row) : null;
}

export async function claimRemoteAgentMessageChannelIdentityLinkToken(input: {
  claimedAtMs: number;
  db: D1Database;
  token: RemoteAgentMessageChannelIdentityLinkTokenRecord;
  openmeldUserId: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_identity_link_tokens
        SET
          claimed_by_user_id = ?,
          claimed_at_ms = COALESCE(claimed_at_ms, ?)
        WHERE token_hash = ?
          AND consumed_at_ms IS NULL
          AND expires_at_ms > ?
          AND (
            claimed_by_user_id IS NULL
            OR claimed_by_user_id = ?
          )
      `
    )
    .bind(
      input.openmeldUserId,
      input.claimedAtMs,
      input.token.tokenHash,
      input.claimedAtMs,
      input.openmeldUserId
    )
    .run();
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
  | { status: "invalid" };

export async function consumeRemoteAgentMessageChannelIdentityLinkToken(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  consumeNonce: string;
  db: D1Database;
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
  const consume = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_identity_link_tokens
        SET consumed_at_ms = ?, consume_nonce = ?
        WHERE token_hash = ?
          AND provider = ?
          AND connection_id = ?
          AND provider_user_id = ?
          AND organization_id = ?
          AND consumed_at_ms IS NULL
          AND claimed_by_user_id = ?
          AND expires_at_ms > ?
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_channel_connections AS connection
            WHERE connection.connection_id = ?
              AND connection.provider = ?
              AND connection.organization_id = ?
              AND connection.status = 'connected'
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
          FROM openMeldRemoteAgent_message_channel_identity_link_tokens AS token
          WHERE token.token_hash = ?
            AND token.consume_nonce = ?
            AND token.consumed_at_ms = ?
            AND token.claimed_by_user_id = ?
            AND token.provider = ?
            AND token.connection_id = ?
            AND token.provider_user_id = ?
            AND token.organization_id = ?
        ) AND EXISTS (
          SELECT 1
          FROM openMeldRemoteAgent_lark_platform_identity_links AS identity_link
          WHERE identity_link.provider = ?
            AND identity_link.connection_id = ?
            AND identity_link.provider_user_id = ?
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
      input.openmeldUserId
    );
  const link = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_identity_links (
          provider,
          connection_id,
          provider_user_id,
          organization_id,
          openmeld_user_id,
          resolution_source,
          created_at_ms
        )
        SELECT provider, connection_id, provider_user_id, organization_id, ?, 'explicit', ?
        FROM openMeldRemoteAgent_message_channel_identity_link_tokens
        WHERE token_hash = ?
          AND consume_nonce = ?
          AND consumed_at_ms = ?
          AND claimed_by_user_id = ?
          AND provider = ?
          AND connection_id = ?
          AND provider_user_id = ?
          AND organization_id = ?
          AND EXISTS (
            SELECT 1
            FROM members
            WHERE organization_id = ?
              AND user_id = ?
          )
        ON CONFLICT(provider, connection_id, provider_user_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          openmeld_user_id = excluded.openmeld_user_id,
          resolution_source = excluded.resolution_source,
          created_at_ms = excluded.created_at_ms
      `
    )
    .bind(
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
      input.openmeldUserId
    );
  const results = await input.db.batch([consume, auditReplacement, link]);
  const consumeResult = results[0];
  const auditResult = results[1];
  const linkResult = results[2];
  if (didWriteRows(consumeResult)) {
    if (!didWriteRows(linkResult)) {
      throw new Error(
        "Message Channel identity token was consumed without writing its identity link"
      );
    }
    return {
      replacedExistingLink: didWriteRows(auditResult),
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
  db: D1Database;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<number> {
  const nextAttempt = input.currentAttempt + 1;
  await input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_message_channel_identity_link_tokens
        SET continuation_attempt = ?
        WHERE token_hash = ?
          AND continuation_attempt = ?
          AND consumed_at_ms IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM openMeldRemoteAgent_lark_platform_identity_links AS link
            WHERE link.provider = openMeldRemoteAgent_message_channel_identity_link_tokens.provider
              AND link.connection_id = openMeldRemoteAgent_message_channel_identity_link_tokens.connection_id
              AND link.provider_user_id = openMeldRemoteAgent_message_channel_identity_link_tokens.provider_user_id
              AND link.openmeld_user_id = ?
          )
      `
    )
    .bind(
      nextAttempt,
      input.tokenHash,
      input.currentAttempt,
      input.openmeldUserId
    )
    .run();
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
  db: D1Database;
  tokenHash: string;
}): Promise<RemoteAgentMessageChannelIdentityLinkTokenRecord | null> {
  const row = await input.db
    .prepare(
      `
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
        FROM openMeldRemoteAgent_message_channel_identity_link_tokens
        WHERE token_hash = ?
        LIMIT 1
      `
    )
    .bind(input.tokenHash)
    .first<RemoteAgentMessageChannelIdentityLinkTokenRow>();
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
